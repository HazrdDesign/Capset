"""Pin the user-data paths the panel has to resolve independently.

The backend writes the port it bound to into data_dir(); the panel finds that
file by rebuilding the same path in ExtendScript (capsetPortFile in
panel/jsx/capset.jsx), because panel JavaScript cannot read environment
variables. Neither runtime can import the other's constants, so the path is
spelled out twice and these tests are what keeps the two copies honest.

If a path moves and only one side is updated, the symptom in the field is
nasty: a backend running perfectly on a fallback port while the panel reports
"Service not running". A failing test here is the cheap version of that.
"""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest

from app import config, logging_setup

PANEL_JSX = (
    Path(__file__).resolve().parents[2] / "panel" / "jsx" / "capset.jsx"
)


def _reload(monkeypatch, platform: str, **env):
    monkeypatch.setattr(logging_setup.sys, "platform", platform)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return logging_setup


def test_windows_data_dir(monkeypatch):
    mod = _reload(monkeypatch, "win32", LOCALAPPDATA=r"C:\Users\joe\AppData\Local")
    assert mod.data_dir() == Path(r"C:\Users\joe\AppData\Local") / "Capset"


def test_windows_logs_live_under_the_data_dir(monkeypatch):
    mod = _reload(monkeypatch, "win32", LOCALAPPDATA=r"C:\Users\joe\AppData\Local")
    assert mod.log_dir() == mod.data_dir() / "logs"


def test_windows_data_dir_falls_back_when_localappdata_is_missing(monkeypatch):
    # A stripped or service account may not have it. Failing to log is
    # acceptable; failing to start is not.
    monkeypatch.setattr(logging_setup.sys, "platform", "win32")
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    assert logging_setup.data_dir().name == "Capset"


def test_macos_data_dir(monkeypatch):
    monkeypatch.setattr(logging_setup.sys, "platform", "darwin")
    monkeypatch.setattr(logging_setup.Path, "home", classmethod(lambda cls: Path("/Users/joe")))
    assert logging_setup.data_dir() == Path(
        "/Users/joe/Library/Application Support/Capset"
    )


def test_macos_logs_follow_the_platform_convention(monkeypatch):
    # NOT under Application Support: support asks for ~/Library/Logs, and
    # Console.app looks there.
    monkeypatch.setattr(logging_setup.sys, "platform", "darwin")
    monkeypatch.setattr(logging_setup.Path, "home", classmethod(lambda cls: Path("/Users/joe")))
    assert logging_setup.log_dir() == Path("/Users/joe/Library/Logs/Capset")


def test_port_file_is_not_written_into_a_shared_directory(monkeypatch):
    # An earlier draft used log_dir().parent, which on macOS is
    # ~/Library/Logs — a directory shared with every other application on the
    # machine. The port file belongs in a directory Capset owns.
    monkeypatch.setattr(logging_setup.sys, "platform", "darwin")
    monkeypatch.setattr(logging_setup.Path, "home", classmethod(lambda cls: Path("/Users/joe")))
    assert logging_setup.data_dir().name == "Capset"
    assert (logging_setup.data_dir() / config.PORT_FILE_NAME).parent.name == "Capset"


@pytest.mark.skipif(not PANEL_JSX.exists(), reason="panel sources not present")
def test_panel_resolves_the_same_windows_path():
    source = PANEL_JSX.read_text(encoding="utf-8")
    assert '$.getenv("LOCALAPPDATA")' in source
    # Escaped twice: once for ExtendScript, once here.
    assert r'local + "\\Capset\\port"' in source
    assert config.PORT_FILE_NAME == "port"


@pytest.mark.skipif(not PANEL_JSX.exists(), reason="panel sources not present")
def test_panel_resolves_the_same_macos_path():
    source = PANEL_JSX.read_text(encoding="utf-8")
    assert '"~/Library/Application Support/Capset"' in source
