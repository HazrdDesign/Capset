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


def _selftest() -> int:
    """`--selftest`: prove the ASR stack imports, without downloading a model.

    The service answers /health even when the engine is unusable — that is
    deliberate, so the panel can explain itself — which means "the binary
    responds" is not evidence the bundle is complete. v0.1.3 shipped exactly
    that way. This exits non-zero on a broken bundle so CI can refuse it.
    """
    from app.engines.onnx_asr_engine import OnnxAsrEngine

    ok, message = OnnxAsrEngine.selftest()
    print(("OK: " if ok else "FAIL: ") + message)
    return 0 if ok else 1


def _fetch_model() -> int:
    """`--fetch-model`: warm the model cache, then exit.

    Run by the installer so the ~600 MB download happens once, visibly, at
    install time rather than silently stalling the first transcription. It is
    a no-op when the model is already on the machine, so reinstalling or
    upgrading does not download it again.
    """
    from app.engines.onnx_asr_engine import OnnxAsrEngine

    print("Checking for the speech model (this may take a while on first run)...")
    ok, message = OnnxAsrEngine().fetch_model()
    print(("OK: " if ok else "FAILED: ") + message)
    # Never fail the installer over this: the backend downloads on demand
    # anyway, so a flaky network at install time must not block installation.
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        raise SystemExit(_selftest())
    if "--fetch-model" in sys.argv:
        raise SystemExit(_fetch_model())
    main()
