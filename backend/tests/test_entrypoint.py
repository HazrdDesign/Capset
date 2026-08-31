"""Guard the frozen entry point.

PyInstaller runs its entry script as a top-level module, not as part of a
package. Pointing it at `app/main.py` therefore builds fine and then dies at
startup with "attempted relative import with no known parent package" — a
green build producing a dead binary. That shipped in v0.1.0.
"""

import ast
import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
SPEC = BACKEND / "capset-backend.spec"
ENTRYPOINT = BACKEND / "capset_service.py"


def test_entrypoint_exists():
    assert ENTRYPOINT.is_file(), "the frozen entry point is missing"


def test_spec_points_at_the_wrapper_not_the_package_module():
    """app/main.py as the entry script is exactly the bug."""
    spec = SPEC.read_text(encoding="utf-8")
    analysis = re.search(r"Analysis\(\s*(?:#[^\n]*\n\s*)*\[([^\]]*)\]", spec, re.S)
    assert analysis, "could not find the Analysis() script list in the spec"
    scripts = analysis.group(1)
    assert "capset_service.py" in scripts
    assert "app/main.py" not in scripts, (
        "PyInstaller entry must not be app/main.py — its relative imports "
        "break when run as a top-level script"
    )


def test_entrypoint_uses_no_relative_imports():
    """A relative import here would reintroduce the exact failure."""
    tree = ast.parse(ENTRYPOINT.read_text(encoding="utf-8"))
    relative = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.level and node.level > 0
    ]
    assert not relative, (
        "the frozen entry point must use absolute imports only; found "
        f"{len(relative)} relative import(s)"
    )


def test_entrypoint_imports_the_app_package():
    source = ENTRYPOINT.read_text(encoding="utf-8")
    assert "from app.main import main" in source
