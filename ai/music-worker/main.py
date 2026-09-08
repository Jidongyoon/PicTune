import asyncio
import sys
from pathlib import Path
from uuid import UUID

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from job_runner import JobRunner
from music import generate_wav

app = FastAPI(title="PicTune Music Worker")
jobs = JobRunner()


class GenerateRequest(BaseModel):
    prompt: str
    seconds: float = Field(default=8.0, ge=1, le=30)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/cancel/{job_id}")
async def cancel(job_id: UUID):
    result = await jobs.cancel(str(job_id))
    return JSONResponse(result, status_code=202 if result["status"] == "cancelling" else 200)


@app.post("/generate")
async def generate(req: GenerateRequest, x_job_id: UUID = Header(...)):
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="prompt is required")
    wav_bytes = await jobs.run(
        str(x_job_id),
        lambda event: asyncio.to_thread(generate_wav, req.prompt, req.seconds, event),
    )
    return Response(content=wav_bytes, media_type="audio/wav")
