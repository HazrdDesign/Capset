#!/usr/bin/env python3
"""Frozen entry point for the Capset transcription service.

PyInstaller runs its entry script as a top-level module, not as part of a
package, so `app/main.py`'s relative imports (`from . import config`) raise
"attempted relative import with no known parent package" the moment the
bundled exe starts. The build succeeds; the binary is dead.

This module exists solely to be that entry point: it imports `app` as a real
package using absolute imports, leaving `app/main.py` a proper package module
so `python -m app.main` and the test suite keep working unchanged.

    pyinstaller capset-backend.spec
"""

from __future__ import annotations

import sys
from pathlib import Path

# Running from a source checkout, `backend/` is not necessarily on sys.path.
# Frozen, PyInstaller has already placed the package; this is a harmless no-op.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from app.main import main  # noqa: E402  (must follow the sys.path fix above)

if __name__ == "__main__":
    main()
