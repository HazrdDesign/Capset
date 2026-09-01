"""The selftest is the gate that stops a broken bundle shipping.

It exists because /health answers even when the engine cannot load a model,
so "the service responds" proves nothing. v0.1.3 shipped that way, and v0.1.4
shipped again after the selftest was added but checked too little — it
imported onnxruntime and onnx_asr and stopped, missing huggingface_hub, which
onnx_asr imports inside a function.

These tests pin what it must reach for, so the next lazily-imported
dependency does not slip through the same gap a third time.
"""

from __future__ import annotations

import ast
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent / "app" / "engines" / "onnx_asr_engine.py"
SPEC = Path(__file__).resolve().parent.parent / "capset-backend.spec"


def _selftest_source() -> str:
    tree = ast.parse(ENGINE.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "selftest":
            return ast.get_source_segment(ENGINE.read_text(encoding="utf-8"), node) or ""
    raise AssertionError("selftest is gone from the engine")


def test_selftest_imports_onnxruntime_and_onnx_asr() -> None:
    source = _selftest_source()
    assert "import onnxruntime" in source
    assert "import onnx_asr" in source


def test_selftest_reaches_the_symbols_the_download_path_uses() -> None:
    # Importing huggingface_hub alone is not enough: it is the download
    # entry points that must resolve.
    source = _selftest_source()
    assert "hf_hub_download" in source
    assert "snapshot_download" in source


def test_selftest_reports_the_transfer_path() -> None:
    # hf_xet missing is a silent fallback to slower HTTP downloads. Reporting
    # it turns "the download feels slow" into a line in the CI log.
    #
    # Checks for the IMPORT, not the name: the name also appears in the
    # fallback message, so a substring check passes even with the import
    # deleted. Caught by mutating exactly that.
    tree = ast.parse(_selftest_source().lstrip())
    imported = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    assert "hf_xet" in imported, f"selftest imports only {sorted(imported)}"


def test_missing_hf_xet_is_not_treated_as_a_failure() -> None:
    # huggingface_hub degrades gracefully without it, so failing the build
    # would refuse a bundle that works.
    source = _selftest_source()
    xet = source[source.index("hf_xet"):]
    assert "return False" not in xet.split("providers")[0]


def test_every_lazily_imported_dependency_is_bundled() -> None:
    # PyInstaller finds imports by scanning bytecode. Anything imported inside
    # a function body, in a dependency's dependency, is invisible to it — the
    # exact shape that broke two releases.
    spec = SPEC.read_text(encoding="utf-8")
    for module in ("onnx_asr", "onnxruntime", "huggingface_hub", "hf_xet"):
        assert f'"{module}"' in spec, f"{module} is not collected by the spec"
