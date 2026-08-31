# backend/ — local transcription service

Audio or video in, word-level timestamps out. Fully local: no cloud calls,
no API keys. Parakeet via ONNX Runtime — no PyTorch, no NeMo, no CUDA
toolkit.

API contract: [`docs/schema.md`](../docs/schema.md).
Design rationale: [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §2.

## Layout

```
app/
  config.py      Settings (model, providers, chunk sizes, port).
  models.py      Token / Word / Chunk / TranscriptionResult.
  tokens.py      BPE subword tokens -> whole words.        [pure, tested]
  chunking.py    Chunk planning + absolute-time stitching. [pure, tested]
  vad.py         Speech detection for chunk boundaries.
  audio.py       ffmpeg decode -> 16 kHz mono float32.
  engines/       The swappable ASR seam.
  transcribe.py  Orchestration.
  jobs.py        Job store + worker thread.
  main.py        FastAPI service.
bench.py         Speed measurement.
```

## The two things that are easy to get wrong

**1. Parakeet caps out at ~20–30s of audio per call.** Longer input must be
split. `vad.py` finds speech spans so cuts land in silence; `chunking.py`
enforces the length limit and overlaps the pieces when a single speech run
is too long.

**2. Engines return chunk-relative timings.** Every chunk's words start again
near zero. `chunking.merge_chunks` shifts them into absolute time. Forget it
and every caption after the first chunk drifts, with the error growing per
chunk — which reads as the model degrading rather than as arithmetic. There
is a regression test named for this.

Both modules are pure — no ASR library, no audio I/O — so they are fully
tested without a model present.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

For an NVIDIA GPU on Windows/Linux, swap `onnxruntime` for
`onnxruntime-gpu` (they conflict — do not install both). On macOS the
accelerated path is CoreML; CUDA does not exist there.

`ffmpeg` must be on PATH for a dev checkout. The shipped installer bundles it
(LGPL — attribution required in the EULA).

## Run

```bash
python -m app.main          # http://127.0.0.1:8756
```

`GET /health` answers even when the model failed to load, reporting
`degraded` plus the reason.

## Test

```bash
pytest tests -q
```

47 tests, no model or ffmpeg needed — the engine and audio layers are faked.
They cover token merging, chunk planning, absolute-time stitching, the
orchestrator, and the HTTP contract.

## Benchmark

```bash
python bench.py path/to/clip.wav
python bench.py path/to/clip.wav --providers CPUExecutionProvider
```

Reports RTFx and extrapolates to a 10-minute video. **Run this before
promising CPU-only support** — it is the number that decides whether Capset
can honestly ship to users without an NVIDIA GPU, which includes every Mac.

## Status

Implemented and tested against fakes. **Not yet run against the real
model** — that needs a machine with the weights present. Open items:

- Measure real speed on CPU, CUDA, and CoreML (`bench.py`).
- Confirm the `onnx-asr` timestamp result shape. `engines/onnx_asr_engine.py`
  normalizes the shapes seen in the wild and raises loudly rather than
  silently returning nothing.
- Port collision handling (see the TODO in `config.py`).
- PyInstaller packaging.
