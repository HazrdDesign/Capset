"""
FastAPI service exposing the Parakeet transcriber over localhost HTTP.

This is the layer the future UXP panel talks to. Do not build this out
until app/transcribe.py works correctly as a standalone script first —
see backend/README.md, Phase 1 build order.
"""

import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile

from app.config import HOST, MODEL_CACHE_DIR, MODEL_NAME, PORT
from app.transcribe import ParakeetTranscriber

app = FastAPI(title="AE Parakeet Captions — Transcription Service")

transcriber = ParakeetTranscriber(MODEL_NAME, MODEL_CACHE_DIR)


@app.on_event("startup")
def load_model() -> None:
    # Model load happens once here, not per-request — Parakeet load time
    # is nontrivial and the panel should treat "server up" and "model
    # ready" as separate states (see /health).
    transcriber.load()


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "model_loaded": transcriber.is_loaded(),
    }


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)) -> dict:
    if not transcriber.is_loaded():
        raise HTTPException(status_code=503, detail="Model still loading")

    # Write upload to a temp file — NeMo/most ASR pipelines expect a file
    # path, not an in-memory stream.
    suffix = Path(file.filename).suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        result = transcriber.transcribe(tmp_path)
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    return {
        "duration_sec": result.duration_sec,
        "full_text": result.full_text,
        "words": [
            {
                "text": w.text,
                "start": w.start,
                "end": w.end,
                "confidence": w.confidence,
            }
            for w in result.words
        ],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT)
