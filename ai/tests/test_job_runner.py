import asyncio
import sys
import threading
import time
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from job_runner import JobRunner, check_cancel


class CancellationTests(unittest.IsolatedAsyncioTestCase):
    async def test_running_cancel_waits_for_thread_and_reuses_model(self):
        jobs = JobRunner()
        model = object()
        identities = []
        started = threading.Event()
        cleaned = threading.Event()
        def inference(event):
            identities.append(id(model))
            started.set()
            try:
                while True:
                    check_cancel(event)
                    time.sleep(.01)
            finally:
                time.sleep(.1)  # Simulate outstanding native operation/cleanup.
                cleaned.set()
        first = asyncio.create_task(jobs.run("first", lambda event: asyncio.to_thread(inference, event)))
        while not started.is_set():
            await asyncio.sleep(.01)
        async def second_op(event):
            self.assertTrue(cleaned.is_set())
            identities.append(id(model))
            return b"wav"
        second = asyncio.create_task(jobs.run("second", second_op))
        result = await jobs.cancel("first")
        self.assertEqual(result["status"], "cancelled")
        self.assertTrue(cleaned.is_set())
        with self.assertRaises(HTTPException) as error:
            await first
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(await second, b"wav")
        self.assertEqual(identities, [id(model), id(model)])

    async def test_cancel_before_start_and_while_queued(self):
        jobs = JobRunner()
        async def forbidden(event):
            self.fail("Cancelled operation started")
        await jobs.cancel("early")
        with self.assertRaises(HTTPException):
            await jobs.run("early", forbidden)
        await jobs.lock.acquire()
        request = asyncio.create_task(jobs.run("queued", forbidden))
        await asyncio.sleep(.02)
        self.assertEqual((await jobs.cancel("queued"))["status"], "cancelled")
        with self.assertRaises(HTTPException):
            await request
        self.assertTrue(jobs.lock.locked())
        jobs.lock.release()

    async def test_slow_cancellation_reports_pending_until_work_stops(self):
        jobs = JobRunner()
        started = asyncio.Event()
        release = asyncio.Event()
        async def operation(event):
            started.set()
            await release.wait()
            check_cancel(event)
        request = asyncio.create_task(jobs.run("slow", operation))
        await started.wait()
        result = await jobs.cancel("slow")
        self.assertEqual(result["status"], "cancelling")
        self.assertTrue(jobs.lock.locked())
        release.set()
        self.assertEqual((await jobs.cancel("slow"))["status"], "cancelled")
        with self.assertRaises(HTTPException):
            await request

    async def test_disconnected_caller_does_not_release_lock_early(self):
        jobs = JobRunner()
        started = threading.Event()
        release = threading.Event()
        def operation(event):
            started.set()
            release.wait(2)
            check_cancel(event)
        request = asyncio.create_task(jobs.run("disconnect", lambda event: asyncio.to_thread(operation, event)))
        while not started.is_set():
            await asyncio.sleep(.01)
        request.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await request
        self.assertTrue(jobs.lock.locked())
        release.set()
        await jobs.cancel("disconnect")
        self.assertFalse(jobs.lock.locked())


if __name__ == "__main__":
    unittest.main()
