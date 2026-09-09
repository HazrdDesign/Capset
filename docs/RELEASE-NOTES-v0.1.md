<!--
  The notes for the v0.1 series, and nothing else.

  This file used to be the body of EVERY GitHub Release: release.yml had this
  exact path hardcoded, so v0.1.2 through v0.3.2 all shipped this text — by
  the end describing a plugin three minor versions behind, including "no
  animation previews" long after previews existed and had since been removed
  again. The workflow now resolves the notes from the tag
  (docs/RELEASE-NOTES-v<version>.md, or the v<major.minor>.md series file),
  so each release needs its own. Leave this one as the record of v0.1.
-->

# Capset

Local auto-captioning for After Effects: transcribes with NVIDIA Parakeet on
your machine and generates timed, animated text layers.

> **Pre-release — read this before installing.**
> The code is tested (410 automated tests: 148 backend, 262 panel) and has now
> been **run inside real After Effects for the first time**. That found four
> real bugs in a row that no amount of testing had caught, all fixed in this
> build. It is closer to working than any previous release and still not
> proven: treat this as a build to try and report on, not production software.

## What's new in this build

The first real runs inside After Effects found four failures, each of which
made the plugin unusable in a different way. All four are fixed.

- **Add Captions did nothing at all.** A single character in the host script —
  an unescaped `/` inside a regular expression — stopped After Effects
  parsing the file. Because a parse error kills the whole file rather than one
  function, *every* button broke at once, showing either "Unable to execute
  script at line 660" or "Unexpected host response". Fixed, with a check that
  makes this class of typo fail the test suite instead of the plugin.

- **A 96 kHz project crashed the transcription.** The speech engine accepts
  only a fixed set of sample rates and rejects everything else outright rather
  than converting — the opposite of what its documentation implies. Audio at
  any other rate is now resampled before it gets there, so an unusual project
  audio setting is no longer a failure.

- **A silent render was reported as a successful transcription of nothing.**
  If After Effects handed Capset audio with no sound in it, the pipeline
  transcribed the silence and cheerfully reported "0 words → 0 captions" —
  sending you to look for a transcription bug that was really a render
  setting. Silence is now caught in two places, before and after the render,
  and says which switch to go and check. Every transcription also reports what
  it measured (length, level, how the audio was divided), so an empty result
  explains itself.

- **The animations were not being applied.** This is the big one. Every
  entrance was built with its range selector sweeping the wrong way, and in
  After Effects a range selector controls *how much* of an animation reaches
  each character — so the animator's influence went from nothing, to
  everything, back to nothing, and each character sat at its normal size and
  full opacity at both ends of the phase. Scale entrances never started small.
  Fades never faded. "Pop" did not pop. Every keyframe was real and nothing
  read them. Fixed, and the test suite now checks the resulting *motion*
  rather than that keyframes were written.

Also new, once the animations actually ran:

- **A real spring.** Animations settle now — past the target, back short of
  it, converging — instead of a single overshoot that arrives and leaves at
  constant speed.
- **Fourteen presets**, up from seven: Word Pop, Hormozi, Impact, Bounce Up,
  Flash, Rise, Drop, Squash, Spin, Blur In, Shout, Karaoke Fill, Tighten and
  Typewriter. The short-form pops are retuned to the timings the styles they
  imitate actually use.
- **Animation length in frames or seconds.** The old "resolve within %" slider
  was a cap rather than a length and did nothing at all on any caption of 1.2
  seconds or longer, at any position. Length can now be set outright and
  applies identically to every caption, while still being shortened on a
  caption too short to hold it.
- **Apply to all captions now uses your settings.** It was falling back to
  built-in defaults and ignoring the panel entirely.
- **Removing every caption asks first**, and changing a setting while a
  transcription is running no longer silently changes the result you get.

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
- **Fourteen animation presets** with live previews in the panel, each
  settling on a spring rather than a single overshoot — see "What's new"
  above. Set a length in frames or seconds to give every caption the same
  timing, or leave it on Auto to scale each animation to its own caption so a
  0.3s word resolves early instead of still moving after the word has gone.
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

- **Only just run in real After Effects.** The four failures above were
  found in the first sessions, and each one hid the next: nothing could be
  learned about the animations until Add Captions ran at all. Expect more of
  the same. Precompose semantics, Character panel behaviour and several
  render-queue settings remain unverified against a real host, and the fix for
  audio output uses a setting name that is documented by the community rather
  than by Adobe.
- **Unsigned.** Windows SmartScreen will warn — *More info* → *Run anyway*.
  Some antivirus may flag the PyInstaller binary; this is a known
  false-positive pattern for unsigned Python bundles.
- **The model ships inside the installer** (~600 MB of it). Nothing is
  downloaded, at install or on first use, so Capset works on a machine that
  has never had network access and does not depend on a third-party account
  staying public under the same name. The cost is that the installer is around
  1 GB and every update re-ships the weights, even when only the panel
  changed. (Earlier v0.1 builds downloaded the model during setup instead;
  that is gone.)
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
