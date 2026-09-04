"""Where the service looks for the speech model.

The installer ships the weights beside the executable so a shipped Capset
never contacts Hugging Face -- not at install, not on first use. Resolving
that directory has one trap that is worth a test each time it is touched:

    onnx_asr's resolver does `if self.local_dir.exists(): self.offline = True`

So handing it a directory that exists but is EMPTY does not mean "download
into here". It means "work offline", and the model load then fails with
nothing to load. An empty directory is the single worst input, and it is
exactly what a half-finished install or a cleaned build tree leaves behind.
"""

from __future__ import annotations

from pathlib import Path

from app import config


def test_a_populated_directory_is_used(tmp_path, monkeypatch):
    root = tmp_path / "backend"
    (root / "model").mkdir(parents=True)
    (root / "model" / "encoder.onnx").write_bytes(b"weights")

    monkeypatch.setattr(config, "__file__", str(root / "app" / "config.py"))
    assert config._bundled_model_dir() == str(root / "model")


def test_an_empty_directory_is_ignored(tmp_path, monkeypatch):
    """The trap. Reporting it would make the model impossible to load."""
    root = tmp_path / "backend"
    (root / "model").mkdir(parents=True)

    monkeypatch.setattr(config, "__file__", str(root / "app" / "config.py"))
    assert config._bundled_model_dir() is None, (
        "an empty model directory makes onnx_asr refuse to download; the "
        "cache path must take over instead"
    )


def test_no_directory_at_all_falls_back_to_the_cache(tmp_path, monkeypatch):
    root = tmp_path / "backend"
    (root / "app").mkdir(parents=True)
    monkeypatch.setattr(config, "__file__", str(root / "app" / "config.py"))
    assert config._bundled_model_dir() is None


def test_a_frozen_build_looks_beside_the_executable(tmp_path, monkeypatch):
    """Frozen, the layout is <app>/backend/capset-backend.exe + <app>/backend/model."""
    app_dir = tmp_path / "installed" / "backend"
    (app_dir / "model").mkdir(parents=True)
    (app_dir / "model" / "encoder.onnx").write_bytes(b"weights")

    monkeypatch.setattr(config.sys, "frozen", True, raising=False)
    monkeypatch.setattr(config.sys, "executable", str(app_dir / "capset-backend.exe"))
    assert config._bundled_model_dir() == str(app_dir / "model")


def test_an_unreadable_path_resolves_to_none_rather_than_raising(monkeypatch):
    """A slow first run beats a service that cannot start at all."""
    def explode(*_a, **_k):
        raise OSError("permission denied")

    monkeypatch.setattr(Path, "is_dir", explode)
    assert config._bundled_model_dir() is None


def test_the_environment_override_wins(tmp_path, monkeypatch):
    """CAPSET_MODEL_DIR is how a developer points at their own copy."""
    import importlib

    override = tmp_path / "elsewhere"
    override.mkdir()
    monkeypatch.setenv("CAPSET_MODEL_DIR", str(override))
    reloaded = importlib.reload(config)
    try:
        assert reloaded.MODEL_DIR == str(override)
    finally:
        monkeypatch.delenv("CAPSET_MODEL_DIR", raising=False)
        importlib.reload(config)
