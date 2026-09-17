"""FastAPI service the Capset CEP panel talks to over localhost.

Contract lives in docs/schema.md. Transcription is submitted as a job and
polled, because a synchronous call would hang the panel on real footage.
"""

from __future__ import annotations

import logging
import os
import secrets
import shutil
import socket
import tempfile
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .engines.base import EngineUnavailable
from .engines.onnx_asr_engine import OnnxAsrEngine
from .jobs import JobStore
from .models import TranscriptionResult
from .transcribe import Transcriber

from . import logging_setup
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
# Model loading runs on a worker thread, so /health stays answerable while a
# ~600 MB first-run download is in progress. Previously load() ran inline in
# the async lifespan, blocking the event loop: /health did not answer AT ALL
# for the whole download, and the panel sat on "Checking transcription
# service..." with no way to know anything was happening.
model_loading = False


def _load_model_in_background() -> None:
    global load_error, model_loading
    model_loading = True
    try:
        transcriber.load()
        log.info("model ready")
    except EngineUnavailable as exc:
        load_error = str(exc)
        log.error("model load failed: %s", exc)
    except Exception as exc:
        load_error = f"{type(exc).__name__}: {exc}"
        log.exception("unexpected error loading the model")
    finally:
        model_loading = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Daemon thread: loading must never hold up shutdown, and a half-finished
    # download is resumable — huggingface_hub caches partial fetches.
    threading.Thread(
        target=_load_model_in_background, name="capset-model-load", daemon=True
    ).start()
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
        "status": "loading" if model_loading else "ok",
        "model_loaded": transcriber.is_loaded(),
        "model_loading": model_loading,
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
    diagnostics = None
    if result.diagnostics is not None:
        d = result.diagnostics
        diagnostics = {
            "duration_sec": d.duration_sec,
            "sample_rate": d.sample_rate,
            "peak": d.peak,
            "rms": d.rms,
            "speech_spans": d.speech_spans,
            "chunks": d.chunks,
            "source_format": d.source_format,
        }
    return {
        "duration_sec": result.duration_sec,
        "full_text": result.full_text,
        # Carried even on a successful result: zero words is the case where
        # the user most needs to know what was actually measured, and that is
        # exactly when the rest of this payload is empty.
        "diagnostics": diagnostics,
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


# Callers we will read a local path for. The service binds to 127.0.0.1, so
# in practice every caller is already on this machine; this is the belt to
# that pair of braces, and it is what keeps `path` from becoming an arbitrary
# file read if the bind address is ever widened.
_LOOPBACK = frozenset({"127.0.0.1", "::1", "localhost", "testclient"})

# A secret the panel can read and a web page cannot.
#
# The loopback check above is not the boundary it looks like. A browser
# running on this machine IS 127.0.0.1, so any page the user visits can POST
# to this service -- a form-encoded POST is a CORS "simple request" and needs
# no preflight -- and read the answer, because CORS here allows every origin.
# Confirmed by request: an arbitrary local path came back 202 with
# Access-Control-Allow-Origin: *, and a path that did not exist came back 400
# naming it, which is a file-existence oracle for the whole filesystem. Any
# readable WAV or AIFF on the machine could be submitted and its transcript
# read back.
#
# What a page cannot do is read a file. The token is written next to the port,
# in a directory only a local process can reach, so the panel has it and a web
# page does not. Sending it in a header is also what forces a preflight on
# cross-origin requests, so the simple-request route closes too.
#
# Regenerated every run: it lives as long as the process and never goes to
# disk anywhere but the port file.
TOKEN_HEADER = "x-capset-token"
_TOKEN = secrets.token_urlsafe(32)


def _require_token(request: Request) -> None:
    """Reject anything that cannot prove it read the port file."""
    if secrets.compare_digest(request.headers.get(TOKEN_HEADER, ""), _TOKEN):
        return
    raise HTTPException(
        status_code=401,
        detail=(
            "missing or wrong %s. The panel reads it from the port file; a "
            "web page cannot." % TOKEN_HEADER
        ),
    )


def _local_source(request: Request, path: str) -> str:
    """Validate a path the panel asked us to read in place.

    After Effects has just written this file, the panel is on this machine,
    and the file is often hundreds of megabytes of PCM -- an hour of 48 kHz
    stereo is ~690 MB. Uploading it means holding it in the panel's heap as a
    base64 string, a binary string and a byte array at once, then again as a
    multipart body, then again as the service's own temp copy. Reading it
    where it already is costs none of that and cannot corrupt it in transit.
    """
    client = request.client.host if request.client else None
    if client not in _LOOPBACK:
        raise HTTPException(
            status_code=403,
            detail="path submissions are only accepted from this machine",
        )
    source = Path(path)
    if not source.is_file():
        raise HTTPException(status_code=400, detail=f"no such file: {path}")
    try:
        with source.open("rb") as handle:
            handle.read(1)
    except OSError as exc:
        raise HTTPException(
            status_code=400, detail=f"cannot read {path}: {exc}"
        ) from exc
    return str(source)


@app.post("/jobs", status_code=202)
async def create_job(
    request: Request,
    file: UploadFile = File(None),
    path: str = Form(None),
) -> dict:
    _require_token(request)
    if not transcriber.is_loaded():
        raise HTTPException(
            status_code=503,
            detail=load_error or "model still loading",
        )
    if path is None and file is None:
        raise HTTPException(
            status_code=422, detail="send either a file upload or a local path"
        )

    if path is not None:
        source = _local_source(request, path)
        # Not ours: After Effects wrote it and the panel may still want it.
        ours = False
    else:
        suffix = Path(file.filename or "").suffix or ".wav"
        fd, source = tempfile.mkstemp(suffix=suffix, prefix="capset-")
        with os.fdopen(fd, "wb") as handle:
            shutil.copyfileobj(file.file, handle)
        ours = True

    def work(job):
        try:
            result = transcriber.transcribe(
                source,
                on_progress=lambda p, stage: _update(job, p, stage),
                should_cancel=job._cancel.is_set,
            )
            return _result_to_dict(result)
        finally:
            # An upload is scratch; never leave it behind, even on failure.
            # A path the caller gave us is theirs and must survive.
            if ours:
                Path(source).unlink(missing_ok=True)

    job = request.app.state.jobs.submit(work)
    return {"id": job.id, "state": job.state.value}


def _update(job, progress: float, stage: str) -> None:
    job.progress = progress
    job.stage = stage


@app.get("/jobs/{job_id}")
def get_job(request: Request, job_id: str) -> dict:
    _require_token(request)
    job = request.app.state.jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    return job.to_dict()


@app.delete("/jobs/{job_id}", status_code=202)
def cancel_job(request: Request, job_id: str) -> dict:
    _require_token(request)
    store = request.app.state.jobs
    if store.get(job_id) is None:
        raise HTTPException(status_code=404, detail="no such job")
    return {"id": job_id, "cancelled": store.cancel(job_id)}


def _pick_port(preferred: int, host: str) -> int:
    """Return a bindable port, falling back to any free one.

    A hardcoded port dies badly: uvicorn exits, and because the build is
    windowed the process vanishes with no dialog. The panel then shows the
    same "service not running" as a machine where it was never installed.
    The most likely squatter is a leftover Capset backend.
    """
    for candidate in (preferred, 0):
        try:
            probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind((host, candidate))
            chosen = probe.getsockname()[1]
            probe.close()
            if candidate != preferred:
                log.warning("port %d unavailable; using %d", preferred, chosen)
            return chosen
        except OSError:
            continue
    return preferred


def _publish_port(port: int) -> None:
    """Write the live port where the panel can find it.

    Without this a fallback port is useless — the panel would keep asking
    8756 and conclude the service is down.

    The panel reads this file through ExtendScript (capsetPortFile in
    panel/jsx/capset.jsx), which resolves the same directory by hand. The
    two must stay in step.
    """
    try:
        path = logging_setup.data_dir() / config.PORT_FILE_NAME
        path.parent.mkdir(parents=True, exist_ok=True)
        # Port first, token second. A reader that only wants the port can
        # still parseInt the whole thing -- it stops at the newline -- so this
        # stays readable by anything that read the old one-line format.
        path.write_text("%d\n%s\n" % (port, _TOKEN), encoding="utf-8")
        try:
            os.chmod(path, 0o600)
        except OSError:
            # Best effort. On Windows the directory is already per-user.
            pass
        log.info("listening on %d (published to %s)", port, path)
    except Exception as exc:
        log.warning("could not publish the port file: %s", exc)


def main() -> None:
    import uvicorn

    # log_config=None: do NOT let uvicorn install its own logging. Its
    # colourized formatter probes sys.stdout.isatty(), which is fatal in a
    # windowed build, and we have already configured rotating file logging in
    # logging_setup. Uvicorn's records still reach our handlers via the root
    # logger, so nothing is lost.
    port = _pick_port(config.PORT, config.HOST)
    _publish_port(port)

    uvicorn.run(
        app,
        host=config.HOST,
        port=port,
        log_config=None,
        access_log=False,
    )


if __name__ == "__main__":
    main()
