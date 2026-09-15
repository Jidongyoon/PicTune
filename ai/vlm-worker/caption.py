import asyncio
import base64
import json
import os

import httpx
from job_runner import JobCancelled, check_cancel

LLAMA_SERVER_URL = os.getenv("LLAMA_SERVER_URL", "http://127.0.0.1:8003").rstrip("/")
LLAMA_SERVER_PARALLEL = int(os.getenv("LLAMA_SERVER_PARALLEL", "1"))
if LLAMA_SERVER_PARALLEL < 1:
    raise ValueError("LLAMA_SERVER_PARALLEL must be a positive integer")

_available_slots = asyncio.Queue()
for _slot_id in range(LLAMA_SERVER_PARALLEL):
    _available_slots.put_nowait(_slot_id)

PROMPT = (
    "Analyze this image for the purpose of generating background music. "
    "Respond with ONLY a single JSON object (no markdown, no code fences, no extra text) "
    "with exactly these fields: "
    'scene (string, brief description of the scene), '
    'mood (array of 1-3 short mood words), '
    'energy (one of "low", "medium", "high"), '
    'genre (string, a music genre that fits the image), '
    'tempo (string, e.g. "slow", "moderate", "fast"), '
    'instruments (array of 2-4 instrument names), '
    'texture (string, short description of the sound texture), '
    'musicgen_prompt (string, one sentence combining tempo, mood, genre and instruments, '
    "written as a prompt for a text-to-music model). "
    "Example format: "
    '{"scene": "...", "mood": ["..."], "energy": "low", "genre": "...", '
    '"tempo": "...", "instruments": ["..."], "texture": "...", "musicgen_prompt": "..."}'
)

REQUIRED_FIELDS = [
    "scene",
    "mood",
    "energy",
    "genre",
    "tempo",
    "instruments",
    "texture",
    "musicgen_prompt",
]


class CaptionError(RuntimeError):
    pass


def _extract_json(text: str) -> dict:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("no JSON object found in model output")
    return json.loads(text[start : end + 1])


async def slots(client):
    response = await client.get(LLAMA_SERVER_URL + "/slots")
    response.raise_for_status()
    result = response.json()
    expected_ids = set(range(LLAMA_SERVER_PARALLEL))
    if (
        not isinstance(result, list)
        or len(result) != LLAMA_SERVER_PARALLEL
        or any(not isinstance(slot, dict) or "is_processing" not in slot for slot in result)
        or {slot.get("id") for slot in result} != expected_ids
    ):
        raise CaptionError(
            "llama-server slot count must match LLAMA_SERVER_PARALLEL "
            f"({LLAMA_SERVER_PARALLEL}) and expose --slots"
        )
    return result


async def wait_idle(client, slot_id):
    # Do not release this slot or acknowledge cancellation while its inference may live.
    # Connection errors are retried; cancel API returns 202 while confirmation is pending.
    while True:
        try:
            state = next(slot for slot in await slots(client) if slot["id"] == slot_id)
            if not state["is_processing"]:
                return
        except (httpx.HTTPError, CaptionError, StopIteration):
            pass
        await asyncio.sleep(.2)


async def acquire_slot(cancel_event):
    while True:
        check_cancel(cancel_event)
        try:
            return await asyncio.wait_for(_available_slots.get(), .1)
        except asyncio.TimeoutError:
            pass


async def analyze_image(image_bytes, cancel_event):
    slot_id = await acquire_slot(cancel_event)
    try:
        return await _analyze_image(image_bytes, cancel_event, slot_id)
    finally:
        _available_slots.put_nowait(slot_id)


async def _analyze_image(image_bytes, cancel_event, slot_id):
    check_cancel(cancel_event)
    encoded = base64.b64encode(image_bytes).decode()
    payload = {
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + encoded}},
        ]}],
        "stream": True, "max_tokens": 400, "temperature": .2,
        "response_format": {"type": "json_object"},
        "id_slot": slot_id,
    }
    headers_received = asyncio.Event()
    async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=5), trust_env=False) as client:
        await slots(client)  # Fail configuration errors before submitting a request.
        check_cancel(cancel_event)
        async def receive():
            parts = []
            async with client.stream("POST", LLAMA_SERVER_URL + "/v1/chat/completions", json=payload) as response:
                response.raise_for_status()
                headers_received.set()
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        chunk = json.loads(data)
                        if "error" in chunk:
                            raise CaptionError(str(chunk["error"]))
                        for choice in chunk.get("choices", []):
                            parts.append(choice.get("delta", {}).get("content") or "")
            return "".join(parts)
        request = asyncio.create_task(receive())
        try:
            while not request.done():
                # Wait for acceptance before closing the stream, preventing a late-start race.
                if cancel_event.is_set() and headers_received.is_set():
                    request.cancel()
                    break
                await asyncio.sleep(.05)
            try:
                raw_output = await request
            except asyncio.CancelledError:
                raise JobCancelled()
        finally:
            if not request.done():
                request.cancel()
            await asyncio.gather(request, return_exceptions=True)
            # Dedicated server: no clients other than this single-worker adapter.
            await wait_idle(client, slot_id)
    check_cancel(cancel_event)
    try:
        data = _extract_json(raw_output)
        if not isinstance(data, dict) or not isinstance(data.get("musicgen_prompt"), str) or not data["musicgen_prompt"].strip():
            raise ValueError("missing musicgen_prompt")
        for field in REQUIRED_FIELDS:
            data.setdefault(field, None)
        return data
    except (ValueError, TypeError) as exc:
        raise CaptionError("VLM returned invalid analysis JSON") from exc
