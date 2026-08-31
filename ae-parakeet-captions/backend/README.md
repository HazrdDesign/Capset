# Backend — Parakeet Transcription Service

Standalone local service. Input: audio/video file. Output: word-level
timestamps as JSON. No cloud calls, no external API keys — everything runs
on the user's machine (GPU required; NVIDIA Parakeet models are CUDA-based).

## Phase 1 goals (build order)

1. **Get Parakeet running in a plain script first** — no server, no bundling,
   just confirm the model loads locally and produces word-level (not just
   sentence-level) timestamps from an audio file. This is the highest-risk
   step; everything else depends on it working correctly.
   - Use NVIDIA NeMo's ASR toolkit (`nemo_toolkit[asr]`) with a Parakeet
     checkpoint (e.g. `nvidia/parakeet-tdt-1.1b` or similar — check NGC/
     HuggingFace for the current recommended checkpoint, model names change).
   - Confirm output includes per-word start/end timestamps and confidence
     scores, not just full-transcript text. NeMo's RNNT/TDT decoders support
     timestamp output — this needs to be explicitly enabled, it's not always
     on by default.
   - Test with a short local audio clip (extract a WAV from any test video
     with ffmpeg) before worrying about video input at all.

2. **Wrap in FastAPI** once step 1 produces correct word timestamps.
   - Single endpoint: `POST /transcribe` — accepts an uploaded file, returns
     JSON matching `docs/schema.md`.
   - Add a `GET /health` endpoint for the UXP panel to check the backend is
     up before attempting a transcription request.
   - Model should load once at server startup, not per-request (Parakeet
     model load time is nontrivial — don't repeat it per call).

3. **PyInstaller bundling** — do this early, don't leave it to the end.
   - CUDA + PyTorch + NeMo bundling with PyInstaller is the highest-risk part
     of the whole project: large file sizes, driver/runtime version
     mismatches, hidden imports NeMo needs that PyInstaller won't
     auto-detect.
   - Test on a clean-ish environment (different venv at minimum, ideally a
     different machine or VM) before assuming it works.
   - If full bundling proves too fragile, fallback options to consider later:
     ONNX-exported Parakeet (lighter runtime, no NeMo/PyTorch dependency at
     inference time) — bigger upfront conversion effort but a much lighter
     and more reliable final installer.

4. **Confirm standalone .exe serves requests** end to end: run the .exe with
   no dev environment active, hit `/health`, then `/transcribe` with a real
   file, confirm correct JSON comes back.

## Non-goals for Phase 1

- No AE integration yet (that's Phase 2/panel).
- No segmentation logic (word/sentence/smart grouping) — that happens on the
  panel side once this returns raw word timestamps. This service's only job
  is: audio in, word timestamps out.
- No controller/expression/animation logic — irrelevant to this piece.

## Setup (local dev)

```bash
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```

Requires an NVIDIA GPU with CUDA available for any real Parakeet inference —
this cannot be meaningfully developed/tested on CPU-only hardware beyond
checking that imports resolve.

## Run (dev)

```bash
python -m app.main
```

Server starts on `http://localhost:8756` (see `app/config.py` to change).
