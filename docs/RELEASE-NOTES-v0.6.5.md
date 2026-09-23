<!--
  The body of the GitHub Release for v0.6.5.

  release.yml resolves this path from the tag. If the next release is numbered
  differently, rename this file to match (RELEASE-NOTES-v<version>.md, or
  RELEASE-NOTES-v<major.minor>.md to cover a whole series) or the workflow
  publishes a stub instead.
-->

# Capset v0.6.5

Local auto-captioning for After Effects: transcribes with NVIDIA Parakeet on
your machine and generates timed text layers on the timeline.

The controller rig finally does what it says, gains a full set of global
controls, and Smart captions stop running a new thought into the last one.
A patch number because the build is still under test -- see the note on
numbering in `docs/RELEASING.md`.

## What's new in this build

**Parent to Controller now works.** The Font Size and Fill Color sliders on
the *Capset Controller* null did nothing: the expression linking each caption
to them used a method After Effects quietly ignores, and swallowed the error.
They now drive every caption live. Text styling from the controller needs the
JavaScript expression engine, which is After Effects' default (*File → Project
Settings → Expressions*); on the legacy engine, position, opacity, fades and
the shadow still follow the controller.

**Ticking Parent to Controller no longer changes how captions look.** A new
controller starts from whatever your Character panel gave the captions, so the
sliders open at your current look rather than at fixed defaults.

**Existing projects upgrade in place.** A controller made by an earlier version
is brought up to date the next time you Add Captions or Sync Style: "Fill
Colour" becomes "Fill Color" and keeps its value, the new controls are added,
and nothing you already moved is reset.

**New controller controls** -- one null, every caption:

- **Text:** Font Size, Fill (on/off), Fill Color, Stroke (on/off), Stroke
  Color, Stroke Width, Tracking, Leading (0 = auto), All Caps
- **Layout:** Horizontal %, Baseline %
- **Visibility:** Opacity, Fade In (frames), Fade Out (frames) -- fades are
  measured from each caption's own in and out points
- **Shadow:** Drop Shadow (on/off), Shadow Color, Shadow Opacity, Shadow
  Distance, Shadow Softness

**Sync Style works with the controller.** When the comp has a controller, Sync
Style now writes size, fill, stroke and tracking onto it, rather than onto
layers whose controller would immediately override them.

**Smart captions no longer glue the first word after a pause onto the previous
caption.** The recognizer stamps the first word after a silence too early --
around 0.3s early, inside the silence -- so a clear 0.6s pause arrived looking
like a quick breath, and when a caption filled up it could be cut one word past
the pause. Two fixes:

- Word timings are now checked against the audio itself, so pauses are
  measured as they really are. A side benefit you will see: a caption after a
  pause now appears when the speaker actually starts talking, not a beat
  before. Voice over continuous music has no silences to find and is left
  exactly as it was.
- When a Smart caption fills up, it now prefers to end at a clear pause over
  ending wherever the word count ran out.

If the timing change ever misbehaves, setting the environment variable
`CAPSET_ALIGN_TO_AUDIO=0` before launching After Effects turns it off.

## Please test by hand

- Drag each controller slider in After Effects — all the captions should update in real time.
- Open a project made with an older version that already has a controller, and check that
  the controller's values survived the upgrade.
- Tick Drop Shadow on the controller and move its sliders. The shadow should
  appear and follow them. It is the one new control not yet confirmed in a
  real copy of After Effects.
- Re-run the clip that showed the pause bug, in both Smart and Sentence
  modes, on 16:9 and 9:16 compositions.
- Run fades at your composition's frame rate and confirm the fade duration matches the frames
  you set on the Fade In and Fade Out controls.

## Install

**Windows** — run `Capset-Setup-0.6.5.exe`, restart After Effects,
**Window → Extensions → Capset**.

**macOS** — open `Capset-0.6.5.pkg` (right-click → Open if Gatekeeper
objects), restart After Effects, **Window → Extensions → Capset**. The
installer needs an administrator password: it writes to
`/Library/Application Support`.

Upgrading over an existing install is fine on both.

## Using it

**Insert** — select the layer with the dialogue, choose Full Composition or In
to Out, pick a segmentation, and hit **Add Captions**. After Effects renders
the audio and Capset transcribes it locally; nothing leaves the machine. Or
switch to *Captions File* to import an SRT/VTT. **Export .SRT** writes the
captions back out to a `Capset SRT` folder beside your saved project.

**Update** — restyle one caption layer by hand, select it, **Capture style**,
then **Sync Style** across the composition or the whole project.

## Known limitations

- **The Mac build is still unproven.** CI builds it, runs its self-test,
  starts the backend and requires a real answer from it — but no one has
  installed the package on a Mac or opened the panel in After Effects on one.
  Unchanged from v0.6.0.
- **First transcription on a Mac may be slow** relative to a Windows machine
  with an NVIDIA GPU: there is no CUDA on Apple Silicon, so the engine runs on
  CoreML or the CPU.
- **No animation.** Captions arrive timed and styled but static.
- **Unsigned on both platforms.** Windows SmartScreen warns; macOS Gatekeeper
  warns. Both are passable, per Install above.
- **The model ships inside both installers**, so nothing is downloaded at
  install or on first use. The cost is their size.
