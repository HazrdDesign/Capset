<!--
  The body of the GitHub Release for v0.6.3.

  release.yml resolves this path from the tag. If the next release is numbered
  differently, rename this file to match (RELEASE-NOTES-v<version>.md, or
  RELEASE-NOTES-v<major.minor>.md to cover a whole series) or the workflow
  publishes a stub instead.
-->

# Capset v0.6.3

Local auto-captioning for After Effects: transcribes with NVIDIA Parakeet on
your machine and generates timed text layers on the timeline.

Where captions break. Found by running v0.6.2 on a voice over a music bed,
which is the workflow this is actually for, and which turned out to break
every assumption underneath the previous release.

> **Still under test.** The installers are unchanged from v0.6.2.

## What's new in this build

**Captions break where the speaker held a word.** Smart was meant to cut on
the pauses and never did. There were none to cut on: the speech model reports
only when each word *starts*, so every word's end was filled in with the next
word's start and the gap between any two words measured exactly zero — all 54
of them, in the transcript this was traced through. With music under the
voice there is no silence in the audio either, so nothing that waits for quiet
can fire at all.

What does survive a music bed is how long a speaker spends on a word. In the
reported line they hang on "to" while deciding what comes next — and the hold
is not silence, it is the word itself stretched. They say "to" three times in
the clip: twice it takes 0.167s, and there it takes 0.250s. Their own normal
is the yardstick, so no assumption about how long a word "should" take is
needed, and none is made.

**Captions break on commas.** The best place to end a caption is usually
already marked in the text and nothing was reading it. Where a caption has to
end anyway, it now takes the last clause ending within reach — which is where
the sentence itself breaks. A word cut off mid-utterance ("holds me with-") is
deliberately never treated as one.

**Sentence mode keeps the sentence together, then breaks it properly.** A
sentence longer than the duration cap used to break wherever the seconds ran
out, stranding "supports me." on a layer of its own. It now breaks at the last
comma: "...and chooses me as a person," / "holds me with value and supports
me."

**Word endings are no longer invented.** Each is bounded by how long that
piece could plausibly have been spoken, so the silence between words — where
there is any — is finally visible to everything downstream.

**Captions no longer hold past the out point.** A work-area rebuild is meant
to replace only the stretch between the in and out markers, and its last
caption was running on for over a second beyond the out — on top of the
captions the rebuild had deliberately left standing. It is clamped to the out
point now.

> **Known issue.** Re-captioning a section is still not fully trustworthy:
> captions after the out point have been reported as disappearing on a
> work-area run. The layer removal is scoped correctly in every test that
> covers it and the cause is not yet found, so treat "run Smart over the comp,
> then Word-by-Word on one line" as unproven until it is.

## Install

**Windows** — run `Capset-Setup-0.6.3.exe`, restart After Effects,
**Window → Extensions → Capset**.

**macOS** — open `Capset-0.6.3.pkg` (right-click → Open if Gatekeeper
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
