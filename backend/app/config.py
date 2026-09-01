"""Central config for the Capset transcription service."""

from __future__ import annotations

import os
import sys  # noqa: F401  (used by the frozen entry point)
from pathlib import Path  # noqa: F401

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
# Deliberately NOT passed to onnx_asr.load_model(). Its resolver treats an
# existing local_dir as a signal to go offline:
#
#     if self.local_dir.exists(): self.offline = True
#
# so handing it a directory we created but have not populated makes it refuse
# to download at all. The Hugging Face cache default already does the right
# thing — it checks the cache first (local_files_only=True) and only reaches
# the network when the files are genuinely absent, so the model downloads
# once and is reused forever after.
#
# Set CAPSET_MODEL_DIR only if you have already populated that directory.
MODEL_DIR = os.environ.get("CAPSET_MODEL_DIR") or None

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

# Finished jobs are held this long so the panel can collect results, then
# dropped to bound memory.
JOB_RETENTION_S = float(os.environ.get("CAPSET_JOB_RETENTION_S", "3600"))
