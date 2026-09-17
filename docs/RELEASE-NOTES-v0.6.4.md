<!--
  The body of the GitHub Release for v0.6.4.

  release.yml resolves this path from the tag. If the next release is numbered
  differently, rename this file to match (RELEASE-NOTES-v<version>.md, or
  RELEASE-NOTES-v<major.minor>.md to cover a whole series) or the workflow
  publishes a stub instead.
-->

# Capset v0.6.4

Local auto-captioning for After Effects: transcribes with NVIDIA Parakeet on
your machine and generates timed text layers on the timeline.

Scoped rebuilds and a closed hole in the transcription service. A patch number
for a security fix and three behaviour fixes, because the build is still under
test — see the note on numbering in `docs/RELEASING.md`.

> **v0.6.3 shipped early.** It was tagged at a commit that predated four of
> the changes its notes described, so the work below is not in the installers
> published there, whatever that release page says. If you are running
> v0.6.3, this is the build to take.

## What's new in this build

**The transcription service now requires a token.** It runs on your machine
and listens only on localhost, which sounds airtight and is not: a web page
you visit is also running on your machine, and could reach it. Any page could
ask the service whether a given file existed, and have it transcribe any audio
file it could read. The panel now proves it can read the service's own port
file — something a web page cannot do — and the service refuses anything that
cannot. Nothing changes in how the panel is used.

**Captions no longer hold past the out point.** A work-area rebuild is meant
to replace only the stretch between the in and out markers, and its last
caption was running on for over a second beyond the out — on top of the
captions the rebuild had deliberately left standing. It is clamped to the out
point now.

**A section rebuild can no longer clear the composition by accident.** The
reported failure — everything after the out point disappearing on a work-area
run — has one shape that is indistinguishable from the feature not working at
all: the run loses the stretch it was meant to rebuild within, and a rebuild
with no stretch replaces every caption there is. The panel now states which
kind of run it meant, separately from the stretch itself, and the two are
checked against each other. If they disagree, the run stops and says so with
nothing changed. It also names the seconds it replaced within, rather than
saying "in the work area" whether the stretch was right or wrong.

**Long comps use far less memory.** Checking the audio level allocated about
four times the size of the audio itself — roughly 2.8 GB on an hour-long
comp — to produce two numbers. It now allocates almost nothing and runs
faster, which matters most on the long renders that were closest to the edge.

> **Known issue.** The guard above is a guard, not a diagnosis. The underlying
> report is still not reproduced — layer removal is scoped correctly in every
> test that covers it — so treat "run Smart over the comp, then Word-by-Word
> on one line" as unproven. What has changed is that the worst outcome now
> refuses instead of happening quietly. **If you see that refusal, please
> report it:** its message is the evidence that has been missing.

## Install

**Windows** — run `Capset-Setup-0.6.4.exe`, restart After Effects,
**Window → Extensions → Capset**.

**macOS** — open `Capset-0.6.4.pkg` (right-click → Open if Gatekeeper
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
