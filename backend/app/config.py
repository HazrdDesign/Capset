"""Central config for the Capset transcription service."""

from __future__ import annotations

import os
import sys
from pathlib import Path

HOST = os.environ.get("CAPSET_HOST", "127.0.0.1")

# Preferred port, not a guarantee. If anything already holds it -- most
# likely a Capset backend left over from a previous After Effects session --
# main._pick_port falls back to any free port, because uvicorn exiting with
# "address already in use" is invisible in a windowed build: the process just
# disappears and the panel reports the service as not running.
PORT = int(os.environ.get("CAPSET_PORT", "8756"))

# The chosen port is written here, inside logging_setup.data_dir(), so the
# panel can find a service that did not land on PORT.
PORT_FILE_NAME = "port"

# Parakeet TDT 0.6B. v2 is English-only; v3 is multilingual. Both are far
# smaller than the 1.1B checkpoint and score better on the Open ASR
# Leaderboard, so there is no reason to carry the larger model.
#   English only:  nemo-parakeet-tdt-0.6b-v2
#   Multilingual:  nemo-parakeet-tdt-0.6b-v3
MODEL_NAME = os.environ.get("CAPSET_MODEL", "nemo-parakeet-tdt-0.6b-v3")

# Quantization. int8 roughly halves the on-disk model at a small accuracy
# cost, which matters because the installer ships the weights.
MODEL_QUANTIZATION = os.environ.get("CAPSET_QUANTIZATION", "int8")

# Where model weights live.
#
# onnx_asr's resolver treats an existing local_dir as a signal to go offline:
#
#     if self.local_dir.exists(): self.offline = True
#
# That is a trap for an EMPTY directory -- handing it one we created but never
# populated makes it refuse to download at all -- and exactly the behaviour we
# want for a POPULATED one. The installer lays the weights down beside the
# executable, so the shipped build finds them there and never touches the
# network; a source checkout finds nothing, falls back to the Hugging Face
# cache, and downloads once.
#
# Set CAPSET_MODEL_DIR to override, and only ever to a directory that is
# already populated.


def _bundled_model_dir() -> str | None:
    """The weights the installer laid down next to the executable.

    Returns None unless the directory exists AND has files in it, because an
    empty directory is the one input that makes the resolver refuse to work at
    all. Anything unexpected resolves to None and the cache path takes over --
    a slow first run is a far better failure than a service that cannot load
    its model.
    """
    try:
        if getattr(sys, "frozen", False):
            root = Path(sys.executable).resolve().parent
        else:
            # Source checkout: backend/model, if someone has populated it.
            root = Path(__file__).resolve().parent.parent
        candidate = root / "model"
        if candidate.is_dir() and any(candidate.iterdir()):
            return str(candidate)
    except Exception:
        pass
    return None


MODEL_DIR = os.environ.get("CAPSET_MODEL_DIR") or _bundled_model_dir()

# ONNX Runtime execution providers, in priority order. CUDA on Windows/Linux
# with an NVIDIA GPU, CoreML on Apple Silicon, CPU everywhere as the floor.
# CUDA does not exist on macOS, so the macOS path is CoreML or CPU only.
PROVIDERS = os.environ.get("CAPSET_PROVIDERS", "auto")

# Parakeet's own input rate. NOT used for decoding any more: After Effects
# renders at its project rate (typically 48 kHz) and onnx-asr resamples with
# its bundled ONNX resamplers, so audio is passed through at its native rate.
# Kept for tests and for anything that needs the model's nominal rate.
SAMPLE_RATE = 16_000

# Most Parakeet builds cap out at 20-30s per call. 20 is the safe side.
MAX_CHUNK_S = float(os.environ.get("CAPSET_MAX_CHUNK_S", "20.0"))
OVERLAP_S = float(os.environ.get("CAPSET_OVERLAP_S", "2.0"))

# How late the model reports a word, and how much to take back off it.
#
# Parakeet does not mark where a word begins; it marks the encoder frame where
# it became confident, and that is always after the sound. Measured against a
# real 23.976 comp, every word came back late and none came back early:
#
#     Going  +0.083   into  +0.250   my    +0.167   career,  +0.042
#     me     +0.125   as    +0.166   a     +0.167   person,  +0.167
#
# Mean +0.146s, which is 1.8 of the encoder's 0.08s frames -- a lag, not
# noise: noise has both signs. Taking a flat 0.146s back off every word turns
# that spread of 1 to 6 frames late into 2.5 frames either side of nothing,
# and the residual IS the 0.08s grid the model can only answer on.
#
# It is a calibration rather than a law: it comes from eight hand-measured
# words in one recording, which is eight more than were behind the previous
# value of zero. Widen the sample and this number should be revisited, which
# is why it is an environment variable and not a literal in the pipeline.
WORD_LAG_S = float(os.environ.get("CAPSET_WORD_LAG_S", "0.146"))

# Finished jobs are held this long so the panel can collect results, then
# dropped to bound memory.
JOB_RETENTION_S = float(os.environ.get("CAPSET_JOB_RETENTION_S", "3600"))

# Whether to refine word boundaries against the audio's own energy envelope
# after unlag_words (see align.py). The reported case -- a real ~0.6s silence
# measured as ~0.25s because the model stamps the word after a pause early --
# is exactly the kind of error a flat per-word calibration like WORD_LAG_S
# cannot fix, because it is not a constant offset: it only shows up across a
# real pause. On by default; the escape hatch exists for the same reason
# WORD_LAG_S is a variable and not a literal -- so a clip where it guesses
# wrong can be worked around without a code change while it is investigated.
CAPSET_ALIGN_TO_AUDIO = os.environ.get("CAPSET_ALIGN_TO_AUDIO", "1").strip().lower()
ALIGN_TO_AUDIO = CAPSET_ALIGN_TO_AUDIO not in ("0", "false", "no", "off", "")
