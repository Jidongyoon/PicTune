import asyncio

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from music import generate_wav

app = FastAPI(title="PicTune Music Worker")

# 1 Pod = 1 MusicGen model = 1 concurrent generation (PicTune.md 섹션 9)
_generation_lock = asyncio.Semaphore(1)


class GenerateRequest(BaseModel):
    prompt: str
    seconds: float = 8.0


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/generate")
async def generate(req: GenerateRequest):
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="prompt is required")

    async with _generation_lock:
        wav_bytes = await asyncio.to_thread(generate_wav, req.prompt, req.seconds)

    return Response(content=wav_bytes, media_type="audio/wav")
