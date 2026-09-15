import os
import sys
import threading
import unittest
from pathlib import Path

AI_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_DIR))
sys.path.insert(0, str(AI_DIR / "vlm-worker"))
os.environ["LLAMA_SERVER_PARALLEL"] = "2"

from caption import CaptionError, _available_slots, acquire_slot, slots, wait_idle


class FakeResponse:
    def __init__(self, result):
        self.result = result

    def raise_for_status(self):
        pass

    def json(self):
        return self.result


class FakeClient:
    def __init__(self, result):
        self.result = result

    async def get(self, url):
        return FakeResponse(self.result)


class SlotTests(unittest.IsolatedAsyncioTestCase):
    async def test_requires_two_configured_slots(self):
        valid = FakeClient([
            {"id": 0, "is_processing": False},
            {"id": 1, "is_processing": False},
        ])
        self.assertEqual(len(await slots(valid)), 2)

        invalid = FakeClient([{"id": 0, "is_processing": False}])
        with self.assertRaises(CaptionError):
            await slots(invalid)

    async def test_local_pool_assigns_each_slot_once(self):
        event = threading.Event()
        first = await acquire_slot(event)
        second = await acquire_slot(event)
        try:
            self.assertEqual({first, second}, {0, 1})
        finally:
            _available_slots.put_nowait(first)
            _available_slots.put_nowait(second)

    async def test_wait_idle_checks_only_the_assigned_slot(self):
        client = FakeClient([
            {"id": 0, "is_processing": False},
            {"id": 1, "is_processing": True},
        ])
        await wait_idle(client, 0)


if __name__ == "__main__":
    unittest.main()
