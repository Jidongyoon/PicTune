"""Single API process per worker. Models outlive jobs; cancellation never kills them."""
import asyncio
import threading
import time
from fastapi import HTTPException


class JobCancelled(Exception):
    pass


def check_cancel(event):
    if event.is_set():
        raise JobCancelled()


class JobRunner:
    def __init__(self):
        self.tasks = {}
        self.events = {}
        self.cancelled = {}
        self.lock = asyncio.Lock()

    def check(self, job_id):
        now = time.monotonic()
        self.cancelled = {key: expiry for key, expiry in self.cancelled.items() if expiry > now}
        if job_id in self.cancelled:
            raise HTTPException(409, "job cancelled")

    async def cancel(self, job_id):
        self.cancelled[job_id] = time.monotonic() + 3600
        event = self.events.get(job_id)
        if event is not None:
            event.set()
        task = self.tasks.get(job_id)
        if task is not None:
            # Never task.cancel(): cancelling a to_thread await does not stop its thread.
            try:
                await asyncio.wait_for(asyncio.shield(task), 5)
            except asyncio.TimeoutError:
                return {"status": "cancelling"}
            except Exception:
                pass  # Task is finished, including its cleanup, before acknowledging.
        return {"status": "cancelled"}

    async def run(self, job_id, operation):
        self.check(job_id)
        if job_id in self.tasks:
            raise HTTPException(409, "job already running")
        event = threading.Event()
        self.events[job_id] = event
        task = asyncio.create_task(self._run(job_id, event, operation))
        self.tasks[job_id] = task
        def finish(done):
            self.tasks.pop(job_id, None)
            self.events.pop(job_id, None)
            if not done.cancelled():
                done.exception()  # Consume errors if the HTTP caller disconnected.
        task.add_done_callback(finish)
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            event.set()
            self.cancelled[job_id] = time.monotonic() + 3600
            raise
        except JobCancelled:
            raise HTTPException(409, "job cancelled")

    async def _run(self, job_id, event, operation):
        # A queued cancellation does not wait for the currently running inference.
        while True:
            check_cancel(event)
            try:
                await asyncio.wait_for(self.lock.acquire(), .1)
                break
            except asyncio.TimeoutError:
                pass
        try:
            check_cancel(event)
            self.check(job_id)
            result = await operation(event)
            check_cancel(event)
            return result
        finally:
            self.lock.release()  # Only after actual inference and cleanup have ended.
