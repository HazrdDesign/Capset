# AE Parakeet Captions

A self-contained After Effects captioning plugin. Transcribes the active comp's
audio with NVIDIA's Parakeet model (fully local, no cloud calls) and generates
correctly-timed, styled, animatable caption layers directly on the AE timeline —
CapCut-style captions with zero manual keyframing and no SRT round-trip.

## Why this exists

Captioneer (existing AE plugin) already does Parakeet-based captioning, but
lacks global style controls — every text layer has to be restyled individually.
This project's differentiator: a single controller layer (AE Slider/Dropdown/
Color Controls) that every generated caption layer is expression-linked to, so
font, color, animation preset, etc. update everywhere at once, while still
being fully hand-editable per layer if needed.

## Architecture

Two independent pieces that only talk over localhost HTTP:

1. **`backend/`** — Python service running Parakeet locally. Takes an
   audio/video file, returns word-level timestamps as JSON. Bundled into a
   single self-contained .exe (PyInstaller) — no user-side Python/CUDA setup
   required.
2. **`panel/`** (not yet scaffolded — Phase 2) — UXP panel for After Effects.
   Renders scratch audio from the active comp, POSTs it to the local backend,
   takes the returned JSON, and generates caption layers + the controller rig
   with expressions wired up.

## Build phases

- **Phase 1 (current focus)**: Get the Parakeet pipeline working standalone.
  Script → FastAPI service → PyInstaller bundle → confirm it runs on a clean
  machine. See `backend/README.md`.
- **Phase 2**: UXP panel — audio extraction from AE, HTTP call to backend,
  text layer generation with segmentation options (word/sentence/smart).
- **Phase 3**: Controller layer generation + expression wiring (style +
  animation presets, CapCut-style).
- **Phase 4**: Packaging/installer polish (.exe + .zxp bundled installer),
  distribution.

## Status

Phase 1 in progress. See `backend/README.md` for current state and next steps.
