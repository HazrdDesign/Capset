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

import os
import sys
from pathlib import Path


def _ensure_standard_streams() -> None:
    """Give the process real stdout/stderr even with no console attached.

    A windowed PyInstaller build (console=False) sets sys.stdout and
    sys.stderr to None. Plenty of libraries assume they exist — uvicorn's
    log formatter calls `sys.stdout.isatty()` unconditionally, which raises
    AttributeError and takes the whole service down before it can serve
    anything. v0.1.5 shipped exactly that way.

    Must run BEFORE uvicorn is imported. app/main.py imports it lazily inside
    main(), so doing this at module scope here is early enough.
    """
    devnull = None
    for name in ("stdout", "stderr"):
        if getattr(sys, name, None) is None:
            if devnull is None:
                devnull = open(os.devnull, "w", encoding="utf-8")
            setattr(sys, name, devnull)


_ensure_standard_streams()

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


# Kept in step with installer/build_payload.py, which enforces the same floor
# on the staged copy. See the comment there for where the number comes from.
MIN_MODEL_BYTES = 400_000_000
EXPECTED_MODEL_MB = 600


def _stage_model(target: str) -> int:
    """`--stage-model DIR`: download the weights into DIR for the installer.

    Run once at BUILD time. The installer lays the result down beside the
    executable, so a shipped Capset never contacts Hugging Face at all --
    neither at install nor at first use. That removes a dependency on a
    third-party account staying public under the same name, and removes the
    600 MB first-run wait with it.

    Strict on purpose, and exits non-zero on any doubt. The failure this
    guards against is shipping a gigabyte-sized installer whose model
    directory is empty: nothing downstream would notice, and the first
    transcription on a customer's machine would be the thing that found out.
    """
    from pathlib import Path

    from app import config
    from app.engines.onnx_asr_engine import OnnxAsrEngine

    destination = Path(target).resolve()
    if destination.exists() and any(destination.iterdir()):
        # onnx_asr treats an existing directory as "go offline", so staging
        # into one would quietly download nothing and report success.
        print("FAILED: " + str(destination) + " already exists and is not empty; "
              "remove it first so the download is known to be fresh")
        return 1

    print("Downloading " + config.MODEL_NAME + " (" + config.MODEL_QUANTIZATION +
          ") into " + str(destination))
    engine = OnnxAsrEngine(model_dir=str(destination))
    ok, message = engine.fetch_model()
    if not ok:
        print("FAILED: " + message)
        return 1

    files = sorted(p for p in destination.rglob("*") if p.is_file())
    # Hugging Face's .cache/huggingface tree is download bookkeeping for this
    # machine. It should neither ship nor count toward the model's size.
    weights = [p for p in files
               if ".cache" not in p.relative_to(destination).parts]
    total = sum(p.stat().st_size for p in weights)
    for path in weights:
        print("  %10.1f MB  %s" % (path.stat().st_size / 1e6, path.relative_to(destination)))
    print("staged %d file(s), %.0f MB (%d bytes) total"
          % (len(weights), total / 1e6, total))

    # A model this small did not really arrive. The floor is measured, not
    # guessed: the model contributes ~455 MB compressed to the installer, and
    # compression never grows a file, so on disk it is at least that. The
    # 100 MB this replaced only ever caught an empty directory -- a download
    # that died halfway through would have sailed past it and shipped an
    # installer that cannot transcribe.
    if total < MIN_MODEL_BYTES:
        print("FAILED: only %.0f MB staged. %s is around %d MB and never "
              "less than %.0f MB, so this download is incomplete."
              % (total / 1e6, config.MODEL_NAME, EXPECTED_MODEL_MB,
                 MIN_MODEL_BYTES / 1e6))
        return 1

    # Named on its own line so the release workflow's log shows the real size
    # without anyone reconstructing it from installer arithmetic afterwards.
    print("MODEL_BYTES=%d" % total)
    return 0


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
    if "--stage-model" in sys.argv:
        index = sys.argv.index("--stage-model")
        if index + 1 >= len(sys.argv):
            print("FAILED: --stage-model needs a destination directory")
            raise SystemExit(1)
        raise SystemExit(_stage_model(sys.argv[index + 1]))
    main()
