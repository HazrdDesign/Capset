<!--
  The body of the GitHub Release for v0.5.0.

  release.yml resolves this path from the tag. If the next release is numbered
  differently, rename this file to match (RELEASE-NOTES-v<version>.md, or
  RELEASE-NOTES-v<major.minor>.md to cover a whole series) or the workflow
  publishes a stub instead.
-->

# Capset v0.5.0

Local auto-captioning for After Effects: transcribes with NVIDIA Parakeet on
your machine and generates timed text layers on the timeline.

> **Pre-release.** The changes below are tested — 330 panel tests, 194
> backend — but have not yet been run inside a live After Effects.

## What's new in this build

**Caption layers are named after what they say.** The timeline used to read
`Capset__cap_1`, `Capset__cap_2`, `Capset__cap_3` — serial numbers on layers
whose entire content is a line of prose. A caption reading "Hi everyone." is
now a layer called `Hi everyone.`, so you can read the transcript straight
down the layer stack and find the line you want without clicking through them.

You can rename them, too. What marks a layer as one of Capset's is now a tag
in its comment field rather than its name, so a rename no longer hides the
layer from **Sync Style** or from a rebuild. Captions built by earlier
versions are still recognised by their old names.

**Export .SRT.** A new button on the Insert tab writes the captions in the
current composition to a `Capset SRT` folder beside your saved project file.

It reads the **timeline**, not the transcript, so anything you have changed
since — a retimed layer, a fixed typo, a caption you deleted — is in the file
that comes out. Precomposed captions are found inside their precomp and timed
against the composition you are looking at. If the project has never been
saved there is nowhere to write next to, and it says so rather than leaving
the file somewhere you would not find it.

**Parent to Controller no longer throws the captions out of frame.** Ticking
it put every caption off the bottom-right corner of the composition. The
controller null itself was fine, which is what made it look like a null
placement problem — the captions were the part in the wrong place.

A parented layer's position is measured from its parent, not from the
composition, and the expression driving the captions was calculating a
composition point. So each caption was placed that far *down and to the
right of the null* instead of at that spot in the frame — half a comp width
and half a comp height out, every time. The expression now converts between
the two, and keeps working if you unparent a caption later.

The controller's **Baseline %** slider also started at 82 while captions are
built at 85, so parenting nudged everything up by 3% of the comp for no
reason. Both read the same number now.

## Install

1. Run the `Capset-Setup-*.exe` from the Assets below.
2. Restart After Effects.
3. **Window → Extensions → Capset**.

Upgrading over an existing install is fine — Setup stops the running
transcription service itself before replacing files.

## Using it

**Insert** — select the layer with the dialogue, choose Full Composition or In
to Out, and hit **Add Captions**. No file dialog: After Effects renders the
audio and Capset transcribes it. Or switch to *Captions File* to import an
SRT/VTT instead. **Export .SRT** writes the captions back out again.

**Update** — restyle one caption layer by hand, select it, **Capture style**,
then **Sync Style** across the composition or the whole project.

Captions inherit your current Character panel settings, so whatever you last
used carries through. Style one layer, then push it everywhere.

## Known limitations

- **Not yet run in After Effects.** Everything here passes its tests, and this
  project's history says that is not the same thing.
- **No animation.** Captions arrive timed and styled but static, as in v0.4.0.
- **Unsigned.** Windows SmartScreen will warn — *More info* → *Run anyway*.
- **The model ships inside the installer**, so nothing is downloaded at
  install or on first use. The cost is the installer's size.
- **Windows only.** The macOS installer builds locally but is not in CI and is
  not notarized.
