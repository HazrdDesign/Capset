# Capset

Auto-captioning for **After Effects**. Transcribes audio locally with NVIDIA
Parakeet and builds timed, styled, animated text layers directly on the AE
timeline — no cloud, no SRT round-trip, no manual keyframing.

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
| Backend (Parakeet, chunking, job API) | Implemented, 194 tests |
| Panel (UI, segmentation, style sync) | Implemented, 307 tests |
| Installer (Windows + macOS scripts, CI) | Implemented, shipping |
| **Verified inside After Effects** | **Partly — see below** |

501 automated tests, green in CI.

The plugin now runs in real After Effects, and the first sessions there found
four failures in a row that no amount of testing had caught: a one-character
typo that stopped the host script parsing at all, a project sample rate the
speech engine rejects outright, a silent render reported as a successful
transcription of nothing, and — once the rest worked — animations that were
never being applied, because the range selector was sweeping the wrong way.

Each of those hid the next, which is the thing to expect from here: nothing
could be learned about the animations until Add Captions ran at all. What has
run in a real host now works; what has not run is still unproven, and the list
of what falls in that second group is in
[`docs/RELEASE-NOTES-v0.1.md`](docs/RELEASE-NOTES-v0.1.md).

The pattern behind all four is worth naming, because it is the one that keeps
biting: each was verified by reading documentation rather than by running the
code, against a test suite that shared the code's own assumptions. The fakes
in `panel/tests/` have since been taught the semantics they were missing.

To cut a release, see [`docs/RELEASING.md`](docs/RELEASING.md).

## Phases

1. **Backend** — Parakeet via ONNX with VAD chunking; measure CPU speed.
2. **Panel** — CEP panel, audio extraction, segmentation (smart / word-by-word).
3. **Animation** — *restarting.* The procedural animator machinery works and
   stays; the preset library and its preview grid were pulled from the panel
   because too many presets read as the same animation. Next: capture an
   animation built by hand in After Effects, the way the Update tab already
   captures type. See [`panel/dormant/README.md`](panel/dormant/README.md).
4. **Packaging** — Windows + macOS installers.

## Platforms

Windows and macOS. The panel is portable; the ASR runtime and installer are
per-platform (CUDA on Windows, CoreML/Metal on Apple Silicon).
