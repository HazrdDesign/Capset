# Capset

Auto-captioning for **After Effects**. Transcribes audio locally with NVIDIA
Parakeet and builds timed, styled text layers directly on the AE timeline — no
cloud, no SRT round-trip, no manual keyframing.

Audio never leaves the machine. The speech model ships inside the installer,
so there is nothing to download on first use and no account to sign into.

## What it does

- **Transcribes the composition** you are working in. Select the layer with
  the dialogue, choose the whole comp or just the work area, and the captions
  arrive as ordinary text layers you can edit like any others.
- **Cuts where the speaker does.** Captions break on the pauses in the speech
  rather than on a word count, sized to the composition — a 9:16 comp gets
  short, punchy captions; a 16:9 comp gets broadcast-shaped ones.
- **Global restyle.** Style one caption by hand, then push that style across
  the composition or the whole project.
- **Imports and exports SRT**, so captions can come from, or go to, anywhere
  else in the pipeline.

Segmentation offers **Smart** (grouped on the pauses), **Sentence** (grouped
on punctuation), and **Word-by-Word**.

## Layout

```
backend/    Local ASR service (Parakeet via ONNX). Audio in, word timestamps out.
panel/      CEP extension: panel UI and ExtendScript host.
installer/  Windows .exe (Inno Setup) and macOS .pkg builds.
docs/       Architecture, API schema, release notes.
```

**[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** carries the current design
decisions and the reasoning behind them.

## Status

| Component | State |
|---|---|
| Backend (Parakeet, chunking, job API) | Implemented, 213 tests |
| Panel (UI, segmentation, style sync) | Implemented, 392 tests |
| Installer (Windows + macOS scripts, CI) | Implemented, shipping |

605 automated tests, green in CI.

Pre-release. The Windows build runs in After Effects and is in regular use.
The macOS package is built and verified in CI but has not yet been installed
on a Mac, so it is unproven. Caption animation is not in this build: captions
arrive timed and styled but static.

**v0.6.3 is the latest published release. v0.6.4 is merged, green and waiting
to be tagged** — see [`docs/RELEASING.md`](docs/RELEASING.md), which carries
the commands to do it and a note on why v0.6.3 shipped short of its own
notes. Published releases are at
[Releases](https://github.com/HazrdDesign/Capset/releases).

## Platforms

Windows and macOS (Apple Silicon only — the speech runtime publishes macOS
builds for `arm64` alone). The panel is portable; the ASR runtime and
installer are per-platform.

## Licence

Copyright (c) 2026 Jose Lopez. All rights reserved. Licensed, not sold — see
[`LICENSE.txt`](LICENSE.txt), which also lists the third-party components and
their licences.
