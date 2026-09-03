"""HTTP contract tests. No model, no ffmpeg -- both are faked."""

import io
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import config, main as main_mod, transcribe as transcribe_mod
from app.jobs import JobState
from app.transcribe import Transcriber
from tests.test_transcribe import FakeEngine


def _wait(client, job_id, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/jobs/{job_id}").json()
        if body["state"] in ("done", "error", "cancelled"):
            return body
        time.sleep(0.01)
    pytest.fail(f"job {job_id} did not finish within {timeout}s")


@pytest.fixture
def client(monkeypatch):
    # Signal, not zeros: the transcriber now rejects silent audio outright
    # rather than reporting a successful transcription of nothing.
    _t = np.linspace(0, 30, int(30 * config.SAMPLE_RATE), endpoint=False)
    audio = (0.25 * np.sin(2 * np.pi * 220.0 * _t)).astype(np.float32)
    monkeypatch.setattr(transcribe_mod, "load_audio", lambda *a, **k: (audio, config.SAMPLE_RATE))
    monkeypatch.setattr(transcribe_mod, "detect_speech", lambda *a, **k: [(0.0, 30.0)])

    engine = FakeEngine()
    engine.load()
    monkeypatch.setattr(main_mod, "transcriber", Transcriber(engine))
    monkeypatch.setattr(main_mod, "load_error", None)

    with TestClient(main_mod.app) as c:
        yield c


def _upload():
    return {"file": ("clip.wav", io.BytesIO(b"fake bytes"), "audio/wav")}


def test_health_reports_loaded(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["model_loaded"] is True


def test_submit_returns_202_and_job_id(client):
    """The contract is 202 plus a pollable id -- not a particular state.

    The worker starts immediately, so with a fast engine the job can already
    be "done" by the time the response is serialized. Asserting
    queued-or-running here was a race that failed intermittently.
    """
    response = client.post("/jobs", files=_upload())
    assert response.status_code == 202
    body = response.json()

    assert body["id"]
    assert body["state"] in {s.value for s in JobState}
    # The id must actually be pollable, which is the point of the 202.
    assert client.get(f"/jobs/{body['id']}").status_code == 200


def test_job_completes_with_schema_shaped_result(client):
    job_id = client.post("/jobs", files=_upload()).json()["id"]
    body = _wait(client, job_id)

    assert body["state"] == "done", body.get("error")
    assert body["progress"] == 1.0
    result = body["result"]

    # Contract from docs/schema.md.
    assert set(result) == {"duration_sec", "full_text", "words", "diagnostics"}
    assert result["duration_sec"] == pytest.approx(30.0)
    assert result["words"]
    first = result["words"][0]
    assert set(first) == {"text", "start", "end", "confidence"}
    assert isinstance(first["text"], str)


def test_diagnostics_reach_the_panel_over_http(client):
    """The panel can only explain an empty transcript if these survive the
    serialisation step -- which is where they were dropped before."""
    job_id = client.post("/jobs", files=_upload()).json()["id"]
    body = _wait(client, job_id)

    diagnostics = body["result"]["diagnostics"]
    assert diagnostics is not None
    assert set(diagnostics) == {
        "duration_sec", "sample_rate", "peak", "rms", "speech_spans", "chunks"
    }
    assert diagnostics["peak"] == pytest.approx(0.25, abs=0.01)
    assert diagnostics["sample_rate"] == config.SAMPLE_RATE
    assert diagnostics["chunks"] >= 1


def test_result_words_are_ordered_and_absolute(client):
    job_id = client.post("/jobs", files=_upload()).json()["id"]
    words = _wait(client, job_id)["result"]["words"]

    starts = [w["start"] for w in words]
    assert starts == sorted(starts)
    # Proves offsets were applied: a 30s file cannot be covered by one
    # sub-20s chunk, so words must exist past the chunk limit.
    assert max(starts) > config.MAX_CHUNK_S


def test_unknown_job_is_404(client):
    assert client.get("/jobs/does-not-exist").status_code == 404


def test_cancel_unknown_job_is_404(client):
    assert client.delete("/jobs/does-not-exist").status_code == 404


def test_cancel_accepts_a_known_job(client):
    job_id = client.post("/jobs", files=_upload()).json()["id"]
    assert client.delete(f"/jobs/{job_id}").status_code == 202


def test_uploads_are_not_left_behind(client, tmp_path, monkeypatch):
    """Scratch uploads must be cleaned up; they are whole video files."""
    import tempfile

    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    job_id = client.post("/jobs", files=_upload()).json()["id"]
    _wait(client, job_id)

    leftovers = list(tmp_path.glob("capset-*"))
    assert leftovers == [], f"temp uploads left behind: {leftovers}"


def test_rejects_upload_when_model_not_loaded(monkeypatch):
    """A failed load must surface as 503 with the reason, not a hung job."""
    from app.engines.base import EngineUnavailable

    class FailingEngine(FakeEngine):
        def load(self):
            raise EngineUnavailable("model missing")

    monkeypatch.setattr(main_mod, "transcriber", Transcriber(FailingEngine()))
    monkeypatch.setattr(main_mod, "load_error", None)

    with TestClient(main_mod.app) as c:
        response = c.post("/jobs", files=_upload())
        assert response.status_code == 503
        assert "model missing" in response.json()["detail"]


def test_health_reports_degraded_when_load_failed(monkeypatch):
    """Exercises the real failure path: lifespan catches EngineUnavailable."""
    from app.engines.base import EngineUnavailable

    class FailingEngine(FakeEngine):
        def load(self):
            raise EngineUnavailable("onnx-asr is not installed")

    monkeypatch.setattr(main_mod, "transcriber", Transcriber(FailingEngine()))
    monkeypatch.setattr(main_mod, "load_error", None)

    with TestClient(main_mod.app) as c:
        body = c.get("/health").json()
        assert body["status"] == "degraded"
        assert body["model_loaded"] is False
        assert "onnx-asr" in body["error"]
