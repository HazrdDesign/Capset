"""Guard the dependency budget.

The installer's whole viability rests on not shipping PyTorch. This caught a
real regression: `silero-vad` looks like a small ONNX VAD package but
hard-depends on torch and torchaudio, which would have taken the installer
from ~400 MB to 3-4 GB — silently, in the first release.
"""

from pathlib import Path

import pytest

REQUIREMENTS = Path(__file__).resolve().parent.parent / "requirements.txt"

# Packages that pull a deep-learning framework, directly or transitively.
BANNED = {
    "torch": "PyTorch — the 3-4 GB bundle the ONNX architecture exists to avoid",
    "torchaudio": "pulls PyTorch",
    "torchvision": "pulls PyTorch",
    "nemo_toolkit": "pulls PyTorch",
    "nemo-toolkit": "pulls PyTorch",
    "tensorflow": "comparable size to PyTorch",
    "jax": "pulls a full accelerator stack",
    "silero-vad": "hard-depends on torch>=1.12 and torchaudio>=0.12",
    "transformers": "pulls a framework in most configurations",
}


def _requirements() -> list[str]:
    lines = []
    for raw in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        lines.append(line)
    return lines


def _name(requirement: str) -> str:
    for separator in (">=", "==", "<=", "~=", ">", "<", "[", ";"):
        requirement = requirement.split(separator)[0]
    return requirement.strip().lower()


def test_requirements_file_exists():
    assert REQUIREMENTS.is_file()


@pytest.mark.parametrize("banned,reason", sorted(BANNED.items()))
def test_no_heavyweight_dependency(banned, reason):
    names = {_name(r) for r in _requirements()}
    assert banned.lower() not in names, (
        f"{banned} is in requirements.txt — {reason}. "
        "See docs/ARCHITECTURE.md section 2."
    )


def test_onnx_runtime_is_present():
    """The engine cannot run without it, and it must not silently vanish."""
    names = {_name(r) for r in _requirements()}
    assert "onnx-asr" in names
    assert "onnxruntime" in names


def test_every_requirement_is_version_pinned():
    """An unpinned dependency can pull in a heavy transitive dep on any build."""
    unpinned = [
        r for r in _requirements()
        if not any(op in r for op in (">=", "==", "~=", "<="))
    ]
    assert not unpinned, f"unpinned requirements: {unpinned}"
