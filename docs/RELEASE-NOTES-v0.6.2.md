<!--
  The body of the GitHub Release for v0.6.2.

  release.yml resolves this path from the tag. If the next release is numbered
  differently, rename this file to match (RELEASE-NOTES-v<version>.md, or
  RELEASE-NOTES-v<major.minor>.md to cover a whole series) or the workflow
  publishes a stub instead.
-->

# Capset v0.6.2

Local auto-captioning for After Effects: transcribes with NVIDIA Parakeet on
your machine and generates timed text layers on the timeline.

Four bugs reported from After Effects against v0.6.1, all in where captions
land and when they appear. The installers are unchanged.

> **Still under test.** All four of these were found by running v0.6.1 on real
> footage, which is what the pre-release numbering is for.

## What's new in this build

**Captions land on the word.** Every caption was arriving late — one to six
frames on a 23.976 comp, and late every time, never early. The model does not
mark where a word begins; it marks the encoder frame where it became certain,
which is always after the sound. Measured against a real recording the whole
transcript sat 0.146s behind, so that now comes back off every word. What is
left is inside the 0.08s grid the model can answer on: about two frames either
side of nothing, instead of up to six frames in one direction.

**Captions cut where the speaker breathes.** On a 16:9 comp a caption filled
up at fourteen words and broke there, mid-phrase — "...for me to find the" /
"place that really finds me...". Fourteen words is not a place, it is a
number. A caption closed by the budget now moves its break to the clearest
pause in reach, judged against the speaker's own rhythm rather than a fixed
threshold, so a 0.35s breath is enough when the caption has to end anyway.

**Sentence mode no longer strands the last word.** A sentence running past the
duration cap put "me." on a layer of its own. That cut is made by arithmetic
exactly as a phrase cut is, and now gets the same repair.

**Moving a caption no longer warns about undo.** Every auto-caption left After
Effects reporting "Undo group mismatch, will attempt to fix" the next time a
layer was moved. The audio render held a script undo group open across the
render queue, which comes back unbalanced; the warning then surfaced at the
next undoable action, so it looked like the captions had broken the project.

## Install

**Windows** — run `Capset-Setup-0.6.2.exe`, restart After Effects,
**Window → Extensions → Capset**.

**macOS** — open `Capset-0.6.2.pkg` (right-click → Open if Gatekeeper
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
