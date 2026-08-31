"""
Central config for the transcription service.

Kept deliberately tiny and flat — this whole service does one job.
"""

HOST = "127.0.0.1"
PORT = 8756  # arbitrary high port, unlikely to collide with anything else

# TODO(phase1-step1): confirm the actual checkpoint name/source once
# validated in the standalone script test. Model names on NGC/HuggingFace
# change; do not assume this string is correct without checking current docs.
MODEL_NAME = "nvidia/parakeet-tdt-1.1b"

# Directory the bundled .exe will look for model weights in, if we end up
# shipping weights alongside the binary rather than downloading on first run.
# Revisit once bundling strategy (Phase 1 step 3) is decided.
MODEL_CACHE_DIR = "./models"
