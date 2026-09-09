<!--
  The body of the GitHub Release for v0.6.0.

  release.yml resolves this path from the tag. If the next release is numbered
  differently, rename this file to match (RELEASE-NOTES-v<version>.md, or
  RELEASE-NOTES-v<major.minor>.md to cover a whole series) or the workflow
  publishes a stub instead.
-->

# Capset v0.6.0

Local auto-captioning for After Effects: transcribes with NVIDIA Parakeet on
your machine and generates timed text layers on the timeline.

> **Pre-release.** The macOS package below has never been installed on a Mac —
> it is built and verified in CI, which is not the same thing.

## What's new in this build

**There is a Mac installer.** `Capset-0.6.0.pkg` is attached to this release
alongside the Windows `.exe`, built on the same commit by the same workflow.
It installs the panel to
`/Library/Application Support/Adobe/CEP/extensions/design.hazrd.capset`, the
backend and the speech model to `/Library/Application Support/Capset`, and
enables unsigned CEP extensions so After Effects will load the panel.

Two things a Mac tester needs to know before they start:

- **Apple Silicon only** (M1 and later). Not a shortcut taken to ship sooner:
  the speech runtime publishes macOS builds for Apple Silicon alone, so an
  Intel version would mean a second speech engine rather than a build option.
  The installer refuses an Intel Mac rather than installing and then failing.
- **Gatekeeper will object.** The package is not notarized, which needs a paid
  Apple Developer account. Right-click the `.pkg` → **Open**, or go to System
  Settings → Privacy & Security → **Open Anyway** after the first refusal.
  Everything inside is ad-hoc signed, which is what makes it run at all on
  Apple Silicon — that part is not optional and is done.

Nothing about the Windows build changed in this release.

## Install

**Windows** — run `Capset-Setup-0.6.0.exe`, restart After Effects,
**Window → Extensions → Capset**.

**macOS** — open `Capset-0.6.0.pkg` (right-click → Open if Gatekeeper
objects), restart After Effects, **Window → Extensions → Capset**. The
installer needs an administrator password: it writes to
`/Library/Application Support`.

Upgrading over an existing install is fine on both.

## Using it

**Insert** — select the layer with the dialogue, choose Full Composition or In
to Out, and hit **Add Captions**. After Effects renders the audio and Capset
transcribes it locally; nothing leaves the machine. Or switch to *Captions
File* to import an SRT/VTT. **Export .SRT** writes the captions back out to a
`Capset SRT` folder beside your saved project.

**Update** — restyle one caption layer by hand, select it, **Capture style**,
then **Sync Style** across the composition or the whole project.

## Known limitations

- **The Mac build is unproven.** CI builds it, runs its self-test, starts the
  backend and requires a real answer from it — but no one has installed the
  package on a Mac or opened the panel in After Effects on one. That is what
  this release is for.
- **First transcription on a Mac may be slow** relative to a Windows machine
  with an NVIDIA GPU: there is no CUDA on Apple Silicon, so the engine runs on
  CoreML or the CPU.
- **No animation.** Captions arrive timed and styled but static.
- **Unsigned on both platforms.** Windows SmartScreen warns; macOS Gatekeeper
  warns. Both are passable, per Install above.
- **The model ships inside both installers**, so nothing is downloaded at
  install or on first use. The cost is their size.
