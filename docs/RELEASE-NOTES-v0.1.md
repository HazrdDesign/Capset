<!--
  This file is the body of EVERY GitHub Release — release.yml points
  body_path at this exact path for every version, v0.1.0 through whatever
  ships next. It does not change automatically. Every release from v0.1.0
  to v0.1.8 shipped this same text unedited, including "no animation
  previews" long after previews existed. Update the "What's new" section
  and anything below it stops being true of before publishing a release.
-->

# Capset

Local auto-captioning for After Effects: transcribes with NVIDIA Parakeet on
your machine and generates timed, animated text layers.

> **Pre-release — read this before installing.**
> The code is tested (344 automated tests: 133 backend, 211 panel), and the
> ExtendScript host script is now exercised end-to-end against a simulated
> After Effects environment rather than only read for correctness — that
> testing found and fixed several real bugs before this build. It has
> **still never been run inside real After Effects.** Treat this as a build
> to try and report on, not production software.

## What's new in this build

Since the last tested build, three problems that would have surfaced on
first real use were found and fixed:

- **Add Captions used to render everything in your Render Queue**, not just
  its own audio — including anything you had queued for delivery. It now
  renders only its own item and puts your queue back exactly as it was,
  even if the render fails.
- **A caption-cutting bug could silently discard most of a take.** One loud
  moment early in the audio — a door, a mic bump — could push the
  speech-detection threshold above the actual dialogue, so a take with 11
  seconds of speech could yield a few hundred milliseconds of captions with
  no error shown. Fixed and covered by tests that reproduce the exact
  failure.
- **Selecting the audio layer now actually drives what gets transcribed.**
  Previously Capset always rendered the whole composition mix regardless of
  selection, so a voiceover under a music bed was transcribed together with
  the music. Select the layer with the dialogue and hit Add Captions; with
  nothing selected it still falls back to everything audible.

Also new:

- **A real animation library.** The starting set was generic (fade, slide,
  bounce). It is now short-form-style presets — Word Pop, Hormozi, Karaoke
  Fill, Impact, Bounce Up, Tighten, Typewriter — with working overshoot
  (the actual "punch"), which was declared in the old presets but never
  implemented.
- **Live animation previews**, sampled directly in the panel from the same
  definitions applied to your captions. The previous plan needed
  pre-rendered video loops that were never produced, so every card showed
  "no preview" — that path is gone.
- **Save your own animation presets.** Tweak the timing or properties,
  save it with a name, and it shows up in the grid with its own live
  preview, stored in your user folder so it survives updates.
- **The backend now starts itself.** Previously it only ran if the
  installer's final "start the service" step fired — after a reboot, a
  crash, or a manual quit, the panel just said "not running" with no way to
  recover except finding the executable yourself. It now launches on
  demand when the panel opens, finds a free port on its own, and the panel
  discovers wherever it landed.
- **Precompose, Parent to Controller, and Copy Effects all actually work
  now.** Each looked functional but silently did nothing (or, for
  Precompose, actively broke on a second run) until this build.

## What's in it

- **Local transcription.** NVIDIA Parakeet via ONNX Runtime. No cloud, no
  API keys. CUDA on Windows when an NVIDIA GPU is present, CPU otherwise.
- **Select the audio, hit Add Captions.** No file dialog. Select the layer
  with the dialogue and Capset transcribes it; select nothing and it
  transcribes everything audible in the composition.
- **Three segmentation modes.** Word-by-word, phrase (broadcast style — 42
  characters per line, following Netflix practice), and smart, which reads
  the comp's aspect ratio and picks a layout: a vertical comp gets short
  punchy captions, a horizontal one gets traditional two-line subtitles.
- **Duration-adaptive animations**, with a real short-form preset library
  and live previews in the panel — see "What's new" above. Each animation
  scales to the caption it is on, so a 0.3s word resolves early instead of
  a fixed animation still moving after the word has gone.
- **Save and reuse your own presets**, alongside the built-in library.
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

Upgrading over an existing install is fine — Setup stops the running
transcription service itself before replacing files. You do not need to hunt
for it in Task Manager. The backend also now starts itself the first time the
panel needs it, so there is nothing to launch by hand afterward either.

## Using it

**Insert** — select the layer with the dialogue, choose Full Composition or
In to Out, and hit **Add Captions**. No file dialog: After Effects renders
the audio and Capset transcribes it. With nothing selected it falls back to
everything audible in the composition — useful, but mixing music into the
input costs recognition accuracy, so selecting the voice layer is worth
doing. Or switch to *Captions File* to import an SRT/VTT instead.

**Update** — restyle one caption layer by hand, select it, **Capture style**,
then **Sync Style** across the composition or the whole project.

**Animate** — pick a preset (or one you saved) and apply it to selected
layers or all captions, after the captions exist. Hover a card in the grid
for a live preview.

Captions inherit your current Character panel settings, so whatever you last
used carries through.

The installer places the extension in the Adobe CEP extensions folder and
enables unsigned extensions, since this build is not code-signed.

## Known limitations

- **Not run in real After Effects yet.** Extensive testing against a
  simulated host caught real bugs (see "What's new"), but match names,
  precompose semantics, and Character panel behaviour in an actual host
  remain unverified. This is the biggest remaining unknown.
- **Unsigned.** Windows SmartScreen will warn — *More info* → *Run anyway*.
  Some antivirus may flag the PyInstaller binary; this is a known
  false-positive pattern for unsigned Python bundles.
- **The model is downloaded, not bundled** (~600 MB from Hugging Face). The
  installer offers to fetch it during setup — a tick box you can decline —
  and it is cached afterwards, so it downloads **once per machine**, not per
  launch. Skipping it just moves the wait to the first transcription.
- **Windows only.** The macOS build is written but not yet produced; it needs
  a macOS runner and Apple signing.
- **CPU speed is unmeasured.** `backend/bench.py` exists to answer this. Until
  it has been run on real hardware, CPU-only performance is unknown.
- **Speech detection is an energy-based gate, not a neural VAD.** The
  obvious package for that pulls PyTorch and would have made the installer
  several gigabytes, so proper VAD is deferred to a future ONNX
  implementation. The gate's threshold logic and a regression that could
  silently discard speech are fixed and covered by tests, but it remains
  simpler than a trained model.
- **Animation previews are an approximation of After Effects**, not a
  render of it: keyframe easing becomes a browser animation curve and the
  text uses the panel's own font. They convey the shape of the motion —
  punch, overshoot, direction, colour — accurately, but are not
  pixel-identical to the applied result.

## Requirements

- Windows 10/11, After Effects 2020 or later
- An NVIDIA GPU is optional but much faster
- Internet on first launch, for the model download

## Third-party

Parakeet is CC BY 4.0 (NVIDIA). Full attribution in `LICENSE.txt`.
