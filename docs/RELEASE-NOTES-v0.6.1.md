<!--
  The body of the GitHub Release for v0.6.1.

  release.yml resolves this path from the tag. If the next release is numbered
  differently, rename this file to match (RELEASE-NOTES-v<version>.md, or
  RELEASE-NOTES-v<major.minor>.md to cover a whole series) or the workflow
  publishes a stub instead.
-->

# Capset v0.6.1

Local auto-captioning for After Effects: transcribes with NVIDIA Parakeet on
your machine and generates timed text layers on the timeline.

This release is entirely about the captions themselves — where they get cut,
and how long they stay up. Nothing about the backend, the installers or the
transcription changed.

> **Still under test.** Numbered as a patch for that reason rather than by
> what changed: there is a new segmentation mode in here and the timing of
> every caption moved, which is ordinarily a minor bump.

## What's new in this build

**Captions are cut where a person would cut them.** A caption used to close
the moment one more word would not fit, so whatever was left over became the
next caption however little it was. Five evenly-spoken words against a
vertical comp's four-word budget gave *"I really enjoyed making"* and then
*"this."* on a layer of its own, with nothing in the delivery cutting there —
the break had landed on a word count. The break is now moved rather than
left: words come back off the end of the caption before it until the tail is a
sensible length, giving *"I really enjoyed"* / *"making this."*

Two cuts are never moved, because they belong to the speaker rather than the
arithmetic: a pause long enough to break on, and a full stop. A short caption
after either of those is correct, and "Right." is a caption.

**Captions stay on screen between phrases.** They used to end exactly on their
last word, which was wrong twice over. A caption cut mid-breath cleared a
frame or two before the next one arrived, so the screen blinked between them —
a single frame at 24fps, over and over through a normal sentence. And a
caption holding one short word ("Wait." at 0.18s) was gone before it could be
read.

A caption now runs on until the next one starts, or 1.2 seconds past its last
word, whichever comes first. Over a twenty-second clip on a vertical comp that
takes the screen from four blanks totalling 3.5s down to one of 0.45s — and
the one that remains is a beat the speaker actually took. A longer silence
still clears the screen, because by then they really have stopped.

**What never changes is when a caption appears.** It goes up the instant its
first word is spoken, in every mode. Reading time is only ever taken off the
end, never bought by starting a caption early — sync against the audio is the
only reference a viewer has.

Word-by-word is still brief by nature, and that is the mode rather than a
fault in it: a word spoken in 0.12s cannot stay up past the next word without
the next caption arriving late. The screen no longer blanks between them, so
it reads as fast rather than broken.

**There is a Sentence option.** Segmentation now offers **Smart**, **Sentence**
and **Word-by-Word**: cut where the speaker paused, cut where they punctuated,
or do not group at all. Sentence takes its line width from the composition —
42 characters is a broadcast measure and on a 1080-wide frame a line that long
runs off both edges — but never where it cuts. A sentence is a sentence on any
comp.

**A work-area rebuild replaces only the work area.** Adding captions clears the
Capset layers already in the composition, so running it twice does not leave
two sets fighting over the same frames. With in and out points set it cleared
them anyway, so redoing one line word by word threw away the whole pass around
it. Now only the caption layers inside the work area are replaced, which makes
the obvious workflow possible: Smart over the whole composition, then
Word-by-Word over the one line that needs it.

One exception, and the panel says so when it happens: if the captions already
there are precomposed, all of them are replaced. A range cannot reach inside a
precomposition — those captions are layers of another composition, and
removing the layer holding them takes the rest with it.

## Install

**Windows** — run `Capset-Setup-0.6.1.exe`, restart After Effects,
**Window → Extensions → Capset**.

**macOS** — open `Capset-0.6.1.pkg` (right-click → Open if Gatekeeper
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
