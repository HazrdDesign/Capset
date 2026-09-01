"""Running with no console attached must not crash the service.

A windowed PyInstaller build sets sys.stdout and sys.stderr to None.
Libraries that assume they exist then explode at import or configuration
time — uvicorn's formatter calls sys.stdout.isatty() unconditionally, which
took down v0.1.5 before it could serve a single request.
"""

import inspect
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent


def test_entrypoint_replaces_missing_streams():
    """Simulate a windowed build and confirm the guard repairs the streams."""
    script = (
        "import sys, os;"
        "sys.stdout = None; sys.stderr = None;"
        f"sys.path.insert(0, {str(BACKEND)!r});"
        "import capset_service;"
        "assert sys.stdout is not None, 'stdout still None';"
        "assert sys.stderr is not None, 'stderr still None';"
        "sys.stdout.write('ok');"
        "open(os.environ['RESULT'], 'w').write('PASS')"
    )
    result_path = BACKEND / ".headless-result"
    env = dict(os.environ, RESULT=str(result_path))
    proc = subprocess.run([sys.executable, "-c", script], env=env,
                          capture_output=True, text=True)
    try:
        assert proc.returncode == 0, proc.stderr
        assert result_path.read_text() == "PASS"
    finally:
        result_path.unlink(missing_ok=True)


def test_uvicorn_formatter_survives_the_guard():
    """The exact failure from v0.1.5, with the guard applied."""
    script = (
        "import sys;"
        "sys.stdout = None; sys.stderr = None;"
        f"sys.path.insert(0, {str(BACKEND)!r});"
        "import capset_service;"
        "from uvicorn.logging import DefaultFormatter;"
        "DefaultFormatter('%(message)s')"
    )
    proc = subprocess.run([sys.executable, "-c", script],
                          capture_output=True, text=True)
    assert proc.returncode == 0, (
        "uvicorn's formatter still crashes without a console:\n" + proc.stderr
    )


def test_uvicorn_is_not_allowed_to_configure_logging():
    """log_config=None is what stops uvicorn installing that formatter."""
    from app import main as main_mod

    source = inspect.getsource(main_mod.main)
    assert "log_config=None" in source, (
        "uvicorn.run must pass log_config=None; its default logging probes "
        "sys.stdout.isatty() and is fatal in a windowed build"
    )
