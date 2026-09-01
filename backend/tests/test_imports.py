"""Import every shipped module.

bench.py sat broken for several commits: it imported probe_duration, which was
deleted when ffmpeg was dropped. Nothing imported it, so nothing noticed --
the failure was waiting for whoever next tried to measure performance.

A module that is never imported by the test suite is a module that can rot.
"""

from __future__ import annotations

import importlib
import pkgutil
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent

# Modules that legitimately need a dependency the test environment omits on
# purpose (onnxruntime and onnx-asr are ~200 MB and the suite fakes the
# engine). Import failures for anything else are real.
OPTIONAL = {"app.engines.onnx_asr_engine"}


def _module_names() -> list[str]:
    names = []
    for info in pkgutil.walk_packages([str(BACKEND / "app")], prefix="app."):
        names.append(info.name)
    for script in BACKEND.glob("*.py"):
        if script.name != "conftest.py":
            names.append(script.stem)
    return sorted(names)


@pytest.mark.parametrize("name", _module_names())
def test_module_imports(name: str) -> None:
    try:
        importlib.import_module(name)
    except ImportError as exc:
        missing = getattr(exc, "name", "") or ""
        if name in OPTIONAL and missing in {"onnxruntime", "onnx_asr", "huggingface_hub"}:
            pytest.skip(f"{name} needs {missing}, deliberately absent here")
        raise
