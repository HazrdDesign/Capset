# Capset v0.1

First build. Local auto-captioning for After Effects: transcribes with NVIDIA
Parakeet on your machine and generates timed, animated text layers.

> **Pre-release — read this before installing.**
> The code is tested (124 automated tests), but **the After Effects
> integration has not yet been run inside After Effects.** The ExtendScript
> follows Adobe's scripting reference rather than a verified live host, so
> expect rough edges in layer generation and animation. Treat this as a
> build to try and report on, not production software.

## What's in it

- **Local transcription.** NVIDIA Parakeet via ONNX Runtime. No cloud, no
  API keys. CUDA on Windows when an NVIDIA GPU is present, CPU otherwise.
- **Three segmentation modes.** Word-by-word, phrase (broadcast style — 42
  characters per line, following Netflix practice), and smart, which reads
  the comp's aspect ratio and picks a layout: a vertical comp gets short
  punchy captions, a horizontal one gets traditional two-line subtitles.
- **Duration-adaptive animations.** Six to start (Fade, Pop In, Rise,
  Typewriter, Slide In, Bounce). Each animation scales to the caption it is
  on, so a 0.3s word resolves at 33% of its length and a 2.5s phrase at 18%
  — instead of a fixed animation still moving after a short word has gone.
  Preset- and marker-driven tools cannot do this; it is the main reason
  Capset generates animators rather than applying `.ffx` files.
- **Swap animations freely.** Replace on selected layers or on all of them.
  Everything Capset creates is prefixed, so a swap is an exact teardown and
  rebuild rather than a guess at what a preset added.
- **Global restyle.** One controller layer every caption is
  expression-linked to — change font size, colour or baseline once and every
  caption follows, while each layer stays individually editable.

## Install

1. Run the `Capset-Setup-*.exe` from the Assets below.
2. Restart After Effects.
3. **Window → Extensions → Capset**.

## Using it

**Insert** — choose Full Composition or In to Out and hit **Add Captions**.
No file dialog: After Effects renders the composition's audio, so what gets
transcribed is what you actually hear — mix, levels, solo/mute and audio
effects included. Or switch to *Captions File* to import an SRT/VTT instead.

**Update** — restyle one caption layer by hand, select it, **Capture style**,
then **Sync Style** across the composition or the whole project.

**Animate** — pick an animation and apply it to selected layers or all
captions, after the captions exist.

Captions inherit your current Character panel settings, so whatever you last
used carries through.

The installer places the extension in the Adobe CEP extensions folder and
enables unsigned extensions, since this build is not code-signed.

## Known limitations

- **Not run in After Effects yet.** The most likely failures are in layer
  generation and animator match names.
- **Unsigned.** Windows SmartScreen will warn — *More info* → *Run anyway*.
  Some antivirus may flag the PyInstaller binary; this is a known
  false-positive pattern for unsigned Python bundles.
- **The model is downloaded, not bundled** (~600 MB from Hugging Face). The
  installer offers to fetch it during setup — a tick box you can decline —
  and it is cached afterwards, so it downloads **once per machine**, not per
  launch. Skipping it just moves the wait to the first transcription.
- **Windows only.** The macOS build is written but not yet produced; it needs
  a macOS runner and Apple signing.
- **No animation previews.** The preview grid shows placeholders — the loops
  are generated from After Effects and have not been rendered yet.
- **Rendering the composition audio mix is unverified.** When the selected
  layer is not a plain audio/video file, Capset falls back to the render
  queue, and the audio-only output template name varies by After Effects
  version. Selecting a footage layer directly avoids that path entirely.
- **CPU speed is unmeasured.** `backend/bench.py` exists to answer this. Until
  it has been run on real hardware, CPU-only performance is unknown.
- **Speech detection uses a simple energy gate**, not a neural VAD. The
  obvious package for that pulls PyTorch and would have made the installer
  several gigabytes, so proper VAD is deferred to an ONNX implementation.
  Chunk boundaries are therefore less clean, but never incorrect — chunk
  length limits and timestamp offsets are enforced regardless.

## Requirements

- Windows 10/11, After Effects 2020 or later
- An NVIDIA GPU is optional but much faster
- Internet on first launch, for the model download

## Third-party

Parakeet is CC BY 4.0 (NVIDIA). ffmpeg is LGPL 2.1. Full attribution in
`LICENSE.txt`.
