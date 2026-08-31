# Capset

Auto-captioning for **After Effects**. Transcribes audio locally with NVIDIA
Parakeet and builds timed, styled, animated text layers directly on the AE
timeline — no cloud, no SRT round-trip, no manual keyframing.

Personal project (HAZRD).

## Why

Existing tools apply caption *animations* well in Premiere but leave After
Effects underserved. Capset targets AE specifically, with two things the
current options don't do:

- **Duration-adaptive animations.** Animations are generated procedurally and
  scale to each caption's length, so a 0.3s word and a 2.5s phrase both resolve
  early instead of dragging. Preset/marker-driven tools can't do this.
- **Global restyle.** A single controller layer that every caption is
  expression-linked to, so font, color, and animation update everywhere at
  once — still hand-editable per layer.

## Layout

```
backend/    Local ASR service (Parakeet via ONNX). Audio in, word timestamps out.
panel/      CEP extension: panel UI, ExtendScript, animation engine. (Phase 2)
installer/  Windows .exe (Inno Setup) and macOS .pkg builds.
docs/       Architecture, API schema, research.
```

Start with **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — it carries the
current decisions and supersedes the original scaffold where they conflict.

## Status

| Component | State |
|---|---|
| Backend (Parakeet, chunking, job API) | Implemented, 59 tests |
| Panel (UI, segmentation, timing, animations) | Implemented, 48 tests |
| Installer (Windows + macOS scripts, CI) | Implemented, unbuilt |
| **Verified inside After Effects** | **Not yet** |

107 automated tests, green in CI. The After Effects integration has not been
run in After Effects — the ExtendScript follows Adobe's scripting reference
rather than a live host. That is the next thing worth doing, and it will
shake out more than additional code will.

To cut a release, see [`docs/RELEASING.md`](docs/RELEASING.md).

## Phases

1. **Backend** — Parakeet via ONNX with VAD chunking; measure CPU speed.
2. **Panel** — CEP panel, audio extraction, segmentation (word / phrase / smart).
3. **Animation** — procedural text animators, preview grid, controller rig.
4. **Packaging** — Windows + macOS installers.

## Platforms

Windows and macOS. The panel is portable; the ASR runtime and installer are
per-platform (CUDA on Windows, CoreML/Metal on Apple Silicon).
