"""Audio loading: anything ffmpeg can read -> 16 kHz mono float32.

Parakeet's input contract is 16 kHz mono. Video files, non-16k audio, and
multi-channel sources all go through ffmpeg, which is bundled with the
installer (LGPL -- attribution required in the EULA).
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np

from .config import SAMPLE_RATE


class AudioError(RuntimeError):
    pass


def ffmpeg_path() -> str:
    """Locate ffmpeg: alongside the bundled app first, then the system."""
    bundled = Path(__file__).resolve().parent.parent / "vendor" / "ffmpeg"
    for candidate in (bundled / "ffmpeg", bundled / "ffmpeg.exe"):
        if candidate.exists():
            return str(candidate)
    found = shutil.which("ffmpeg")
    if not found:
        raise AudioError(
            "ffmpeg not found. It ships with the installer; for a dev "
            "checkout install it or set it on PATH."
        )
    return found


def ffprobe_path() -> str:
    bundled = Path(__file__).resolve().parent.parent / "vendor" / "ffmpeg"
    for candidate in (bundled / "ffprobe", bundled / "ffprobe.exe"):
        if candidate.exists():
            return str(candidate)
    found = shutil.which("ffprobe")
    if not found:
        raise AudioError("ffprobe not found alongside ffmpeg")
    return found


def probe_duration(path: str | Path) -> float:
    """Duration in seconds, via ffprobe."""
    cmd = [
        ffprobe_path(), "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json", str(path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise AudioError(f"ffprobe failed: {proc.stderr.strip()}")
    try:
        return float(json.loads(proc.stdout)["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError) as exc:
        raise AudioError(f"could not read duration: {exc}") from exc


def load_audio(path: str | Path, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Decode to mono float32 in [-1, 1] at `sample_rate`.

    Decoded to raw s16le on stdout and converted in-process, which avoids a
    temp WAV and keeps the dependency surface to ffmpeg alone.
    """
    cmd = [
        ffmpeg_path(), "-nostdin", "-v", "error",
        "-i", str(path),
        "-f", "s16le", "-acodec", "pcm_s16le",
        "-ac", "1", "-ar", str(sample_rate),
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise AudioError(f"ffmpeg failed: {proc.stderr.decode(errors='replace').strip()}")
    if not proc.stdout:
        raise AudioError("no audio stream found in input")

    pcm = np.frombuffer(proc.stdout, dtype=np.int16)
    return (pcm.astype(np.float32) / 32768.0).copy()


def slice_audio(
    audio: np.ndarray, start_s: float, end_s: float, sample_rate: int = SAMPLE_RATE
) -> np.ndarray:
    """Extract [start_s, end_s) as samples, clamped to the array."""
    start = max(0, int(round(start_s * sample_rate)))
    end = min(len(audio), int(round(end_s * sample_rate)))
    if end <= start:
        return np.zeros(0, dtype=np.float32)
    return audio[start:end]
