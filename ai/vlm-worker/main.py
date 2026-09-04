import os

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from caption import CaptionError, analyze_image

app = FastAPI(title="PicTune VLM Worker")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/caption")
async def caption(image: UploadFile = File(...)):
    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="empty image")

    suffix = os.path.splitext(image.filename or "")[1] or ".jpg"

    try:
        result = analyze_image(image_bytes, suffix=suffix)
    except CaptionError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return JSONResponse(result)
