import sys
from pathlib import Path
from uuid import UUID

import httpx
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from job_runner import JobRunner
from caption import analyze_image, CaptionError, slots

app = FastAPI(title="PicTune VLM Worker")
jobs = JobRunner()


@app.get("/health")
async def health():
    try:
        async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
            await slots(client)
        return {"status": "ok"}
    except (httpx.HTTPError, CaptionError):
        raise HTTPException(503, "llama-server unavailable or misconfigured")


@app.post("/cancel/{job_id}")
async def cancel(job_id: UUID):
    result = await jobs.cancel(str(job_id))
    return JSONResponse(result, status_code=202 if result["status"] == "cancelling" else 200)


@app.post("/caption")
async def caption(image: UploadFile = File(...), x_job_id: UUID = Header(...)):
    job_id = str(x_job_id)
    jobs.check(job_id)
    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="empty image")
    try:
        return await jobs.run(job_id, lambda event: analyze_image(image_bytes, event))
    except (CaptionError, httpx.HTTPError) as exc:
        raise HTTPException(502, "VLM inference failed") from exc
