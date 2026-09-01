"""FastAPI service the Capset CEP panel talks to over localhost.

Contract lives in docs/schema.md. Transcription is submitted as a job and
polled, because a synchronous call would hang the panel on real footage.
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .engines.base import EngineUnavailable
from .engines.onnx_asr_engine import OnnxAsrEngine
from .jobs import JobStore
from .models import TranscriptionResult
from .transcribe import Transcriber

from .logging_setup import configure as configure_logging

_LOG_PATH = configure_logging()
log = logging.getLogger("capset")
if _LOG_PATH:
    log.info("logging to %s", _LOG_PATH)

transcriber = Transcriber(OnnxAsrEngine())

# The job store owns a thread pool, so it is created per-app in `lifespan`
# and kept on `app.state` rather than as a module global. A module-level
# store would be shut down by the first app shutdown and could never be
# restarted in the same process.

# Set when model load fails, so /health can explain itself instead of the
# panel seeing a silent "not ready" forever.
load_error: str | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global load_error
    try:
        transcriber.load()
        log.info("model ready")
    except EngineUnavailable as exc:
        # Do not take the process down: the panel polls /health and can show
        # a useful message, which beats a connection refused.
        load_error = str(exc)
        log.error("model load failed: %s", exc)
    app.state.jobs = JobStore(retention_s=config.JOB_RETENTION_S)
    try:
        yield
    finally:
        app.state.jobs.shutdown()


app = FastAPI(title="Capset transcription service", lifespan=lifespan)

# The panel is a CEP page, which is not a normal web origin. Bound to
# localhost only, so this stays a local IPC channel rather than a service.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    payload = {
        "status": "ok",
        "model_loaded": transcriber.is_loaded(),
        "engine": transcriber.engine.describe(),
        # Surfaced so the panel can tell the user where to find diagnostics
        # now that the service runs without a console.
        "log_path": str(_LOG_PATH) if _LOG_PATH else None,
    }
    if load_error:
        payload["status"] = "degraded"
        payload["error"] = load_error
    return payload


def _result_to_dict(result: TranscriptionResult) -> dict:
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


@app.post("/jobs", status_code=202)
async def create_job(request: Request, file: UploadFile = File(...)) -> dict:
    if not transcriber.is_loaded():
        raise HTTPException(
            status_code=503,
            detail=load_error or "model still loading",
        )

    suffix = Path(file.filename or "").suffix or ".wav"
    fd, tmp_path = tempfile.mkstemp(suffix=suffix, prefix="capset-")
    with os.fdopen(fd, "wb") as handle:
        shutil.copyfileobj(file.file, handle)

    def work(job):
        try:
            result = transcriber.transcribe(
                tmp_path,
                on_progress=lambda p, stage: _update(job, p, stage),
                should_cancel=job._cancel.is_set,
            )
            return _result_to_dict(result)
        finally:
            # The upload is scratch; never leave it behind, even on failure.
            Path(tmp_path).unlink(missing_ok=True)

    job = request.app.state.jobs.submit(work)
    return {"id": job.id, "state": job.state.value}


def _update(job, progress: float, stage: str) -> None:
    job.progress = progress
    job.stage = stage


@app.get("/jobs/{job_id}")
def get_job(request: Request, job_id: str) -> dict:
    job = request.app.state.jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    return job.to_dict()


@app.delete("/jobs/{job_id}", status_code=202)
def cancel_job(request: Request, job_id: str) -> dict:
    store = request.app.state.jobs
    if store.get(job_id) is None:
        raise HTTPException(status_code=404, detail="no such job")
    return {"id": job_id, "cancelled": store.cancel(job_id)}


def main() -> None:
    import uvicorn

    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level="info")


if __name__ == "__main__":
    main()
