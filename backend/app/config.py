"""Central config for the Capset transcription service."""

from __future__ import annotations

import os
from pathlib import Path

HOST = os.environ.get("CAPSET_HOST", "127.0.0.1")

# TODO(phase1): a fixed port is fragile in the field. If anything already
# holds it -- most likely a Capset backend left over from a previous AE
# session -- uvicorn exits with "address already in use" and the panel sees
# a connection refused with no explanation. Observed in local testing.
# The panel should GET /health first and reuse a healthy existing instance,
# and the service should fall back to a free port and advertise it (a small
# file in the user data dir) rather than dying.
PORT = int(os.environ.get("CAPSET_PORT", "8756"))

# Parakeet TDT 0.6B. v2 is English-only; v3 is multilingual. Both are far
# smaller than the 1.1B checkpoint and score better on the Open ASR
# Leaderboard, so there is no reason to carry the larger model.
#   English only:  nemo-parakeet-tdt-0.6b-v2
#   Multilingual:  nemo-parakeet-tdt-0.6b-v3
MODEL_NAME = os.environ.get("CAPSET_MODEL", "nemo-parakeet-tdt-0.6b-v3")

# Quantization. int8 roughly halves the on-disk model at a small accuracy
# cost, which matters because the installer ships the weights.
MODEL_QUANTIZATION = os.environ.get("CAPSET_QUANTIZATION", "int8")

MODEL_CACHE_DIR = Path(
    os.environ.get("CAPSET_MODEL_DIR", Path(__file__).resolve().parent.parent / "models")
)

# ONNX Runtime execution providers, in priority order. CUDA on Windows/Linux
# with an NVIDIA GPU, CoreML on Apple Silicon, CPU everywhere as the floor.
# CUDA does not exist on macOS, so the macOS path is CoreML or CPU only.
PROVIDERS = os.environ.get("CAPSET_PROVIDERS", "auto")

# Model input contract: Parakeet expects 16 kHz mono.
SAMPLE_RATE = 16_000

# Most Parakeet builds cap out at 20-30s per call. 20 is the safe side.
MAX_CHUNK_S = float(os.environ.get("CAPSET_MAX_CHUNK_S", "20.0"))
OVERLAP_S = float(os.environ.get("CAPSET_OVERLAP_S", "2.0"))

# Finished jobs are held this long so the panel can collect results, then
# dropped to bound memory.
JOB_RETENTION_S = float(os.environ.get("CAPSET_JOB_RETENTION_S", "3600"))
