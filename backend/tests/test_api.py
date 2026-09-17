"""HTTP contract tests. No model, no ffmpeg -- both are faked."""

import io
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import config, main as main_mod, transcribe as transcribe_mod
from app.audio import SourceFormat
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
    fmt = SourceFormat("WAV", 1, 16, config.SAMPLE_RATE)
    monkeypatch.setattr(
        transcribe_mod, "read_with_format",
        lambda *a, **k: (audio, config.SAMPLE_RATE, fmt),
    )
    monkeypatch.setattr(transcribe_mod, "detect_speech", lambda *a, **k: [(0.0, 30.0)])

    engine = FakeEngine()
    engine.load()
    monkeypatch.setattr(main_mod, "transcriber", Transcriber(engine))
    monkeypatch.setattr(main_mod, "load_error", None)

    # The panel proves it could read the port file; these tests stand in for
    # the panel. test_token_* below cover what happens without it.
    with TestClient(
        main_mod.app, headers={main_mod.TOKEN_HEADER: main_mod._TOKEN}
    ) as c:
        yield c


@pytest.fixture
def anonymous(client):
    """The same service as anything else on the machine sees it.

    A browser on this machine is 127.0.0.1, so the loopback check that guards
    local-path reads does not distinguish it from the panel.
    """
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
        "duration_sec", "sample_rate", "peak", "rms", "speech_spans",
        "chunks", "source_format",
    }
    assert diagnostics["peak"] == pytest.approx(0.25, abs=0.01)
    assert diagnostics["sample_rate"] == config.SAMPLE_RATE
    assert diagnostics["chunks"] >= 1
    # The rate above is always one the model accepts, so it cannot reveal a
    # mis-decoded file. This is the field that can.
    assert diagnostics["source_format"] == "WAV, 1ch, 16-bit, 16000 Hz"


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


def test_local_path_is_transcribed_without_an_upload(client, tmp_path):
    """The panel names a file the service can already reach.

    After Effects has just written it on this machine, and an hour of 48 kHz
    stereo is ~690 MB — copying it through the panel's heap and a multipart
    body is the expensive way to hand over a file that is already there.
    """
    source = tmp_path / "capset_render.wav"
    source.write_bytes(b"RIFF" + b"\x00" * 100)

    # Capture what the transcriber was actually pointed at — "the job
    # succeeded" would pass even if the path were dropped and a stale temp
    # file read instead.
    seen = []
    real = transcribe_mod.read_with_format

    def spy(target, *a, **k):
        seen.append(str(target))
        return real(target, *a, **k)

    transcribe_mod.read_with_format = spy
    try:
        body = _wait(
            client, client.post("/jobs", data={"path": str(source)}).json()["id"]
        )
    finally:
        transcribe_mod.read_with_format = real

    assert body["state"] == "done"
    assert body["result"]["words"]
    assert seen == [str(source)], "the named file was not the one transcribed"


def test_a_path_submission_leaves_the_users_file_alone(client, tmp_path):
    """The upload copy is scratch; the render is not ours to delete."""
    source = tmp_path / "capset_render.wav"
    source.write_bytes(b"RIFF" + b"\x00" * 100)
    _wait(client, client.post("/jobs", data={"path": str(source)}).json()["id"])
    assert source.exists(), "the file After Effects rendered was deleted"


def test_a_missing_path_is_refused_before_a_job_starts(client, tmp_path):
    response = client.post("/jobs", data={"path": str(tmp_path / "gone.wav")})
    assert response.status_code == 400
    assert "no such file" in response.json()["detail"]


def test_a_non_local_caller_cannot_name_a_path(client, tmp_path, monkeypatch):
    """Reading an arbitrary path is only safe because the caller is us.

    The service binds to loopback, so this cannot happen today. It is checked
    anyway: the day someone sets CAPSET_HOST to a LAN address, `path` must not
    quietly become a remote file-read primitive.
    """
    source = tmp_path / "capset_render.wav"
    source.write_bytes(b"RIFF" + b"\x00" * 100)
    response = client.post(
        "/jobs", data={"path": str(source)},
        headers={"x-forwarded-for": "10.0.0.9"},
    )
    assert response.status_code == 200 or response.status_code == 202, (
        "loopback must still be accepted"
    )

    # Now actually present as a remote client.
    import app.main as m
    original = m._LOOPBACK
    monkeypatch.setattr(m, "_LOOPBACK", frozenset())
    try:
        refused = client.post("/jobs", data={"path": str(source)})
    finally:
        monkeypatch.setattr(m, "_LOOPBACK", original)
    assert refused.status_code == 403
    assert "this machine" in refused.json()["detail"]


def test_neither_a_file_nor_a_path_is_a_clear_error(client):
    response = client.post("/jobs", data={})
    assert response.status_code == 422
    assert "file upload or a local path" in response.json()["detail"]


def test_rejects_upload_when_model_not_loaded(monkeypatch):
    """A failed load must surface as 503 with the reason, not a hung job."""
    from app.engines.base import EngineUnavailable

    class FailingEngine(FakeEngine):
        def load(self):
            raise EngineUnavailable("model missing")

    monkeypatch.setattr(main_mod, "transcriber", Transcriber(FailingEngine()))
    monkeypatch.setattr(main_mod, "load_error", None)

    with TestClient(
        main_mod.app, headers={main_mod.TOKEN_HEADER: main_mod._TOKEN}
    ) as c:
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


# --- the token -------------------------------------------------------------
#
# The service binds to loopback, which is not the boundary it appears to be:
# a web page the user visits runs on this machine too. A form-encoded POST is
# a CORS "simple request" needing no preflight, and CORS here allows every
# origin, so before the token any page could submit an arbitrary local path
# and read the answer. Measured at the time: 202 for a path that existed with
# Access-Control-Allow-Origin: *, and 400 naming the path when it did not,
# which is a file-existence oracle for the whole filesystem.


def test_jobs_needs_the_token(anonymous):
    r = anonymous.post("/jobs", data={"path": __file__},
                       headers={"Origin": "https://evil.example"})
    assert r.status_code == 401, r.text


def test_a_wrong_token_is_not_enough(anonymous):
    r = anonymous.post("/jobs", data={"path": __file__},
                       headers={main_mod.TOKEN_HEADER: "not-the-token"})
    assert r.status_code == 401


def test_the_refusal_says_nothing_about_the_path(anonymous):
    """No existence oracle: present and absent must be indistinguishable."""
    here = anonymous.post("/jobs", data={"path": __file__})
    gone = anonymous.post("/jobs", data={"path": "/definitely/not/here.wav"})
    assert here.status_code == gone.status_code == 401
    assert here.json() == gone.json()
    assert "not/here" not in gone.text


def test_reading_and_cancelling_a_job_need_the_token(client, anonymous):
    job = client.post("/jobs", files=_upload()).json()["id"]
    assert anonymous.get("/jobs/" + job).status_code == 401
    assert anonymous.delete("/jobs/" + job).status_code == 401
    # ...and the panel, holding the token, is unaffected.
    assert client.get("/jobs/" + job).status_code == 200


def test_health_stays_open(anonymous):
    """Discovery happens before the panel has read anything, and readiness
    is not worth protecting."""
    assert anonymous.get("/health").status_code == 200


def test_the_token_is_published_with_the_port(tmp_path, monkeypatch):
    """Port first so a reader that only wants the port still parses it."""
    from app import logging_setup
    monkeypatch.setattr(logging_setup, "data_dir", lambda: tmp_path)
    main_mod._publish_port(4242)
    written = (tmp_path / config.PORT_FILE_NAME).read_text(encoding="utf-8")
    lines = written.split("\n")
    assert lines[0] == "4242"
    assert lines[1] == main_mod._TOKEN
    assert len(main_mod._TOKEN) >= 32
    # int() on the whole text would fail; parseInt in ExtendScript stops at
    # the newline, which is what keeps the old readers working.
    assert int(lines[0]) == 4242
