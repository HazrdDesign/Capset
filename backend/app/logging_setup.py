"""Logging that survives having no console.

The shipped binary is windowed — there is no terminal, so stderr goes
nowhere. Everything is written to a rotating file in the user's data
directory instead, which is what support asks for when something breaks.
"""

from __future__ import annotations

import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_NAME = "backend.log"
MAX_BYTES = 2 * 1024 * 1024
BACKUP_COUNT = 3


def data_dir() -> Path:
    """Per-user, writable, and conventional for each platform.

    Never next to the executable: that is under Program Files, which is not
    writable without elevation, so writing there would fail silently for
    exactly the users who need the diagnostics.

    The panel resolves this same path in ExtendScript (capsetPortFile in
    panel/jsx/capset.jsx) to find the published port. Neither runtime can
    read the other's constants, so the two must be changed together; the
    shape is pinned by tests on both sides.
    """
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return Path(base) / "Capset"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Capset"
    return Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")) / "capset"


def log_dir() -> Path:
    """Where the rotating log lives.

    Derived from data_dir() everywhere except macOS, where logs belong in
    ~/Library/Logs by convention and support asks for them there.
    """
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Logs" / "Capset"
    return data_dir() / "logs"


def configure(level: int = logging.INFO) -> Path | None:
    """Attach a rotating file handler. Returns the log path, or None."""
    formatter = logging.Formatter(
        "%(asctime)s %(levelname)-7s %(name)s: %(message)s"
    )
    root = logging.getLogger()
    root.setLevel(level)

    # Keep console output when one exists — running from source should still
    # print, and losing that would make development worse to fix packaging.
    if sys.stderr is not None and not getattr(sys, "frozen", False):
        stream = logging.StreamHandler()
        stream.setFormatter(formatter)
        root.addHandler(stream)

    try:
        directory = log_dir()
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / LOG_NAME
        handler = RotatingFileHandler(
            path, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
        )
        handler.setFormatter(formatter)
        root.addHandler(handler)
        return path
    except Exception:
        # A read-only or unusual profile must not stop the service starting.
        return None
