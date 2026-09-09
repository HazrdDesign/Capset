<!--
  The body of the GitHub Release for v0.4.0.

  release.yml resolves this path from the tag: v0.4.0 finds
  RELEASE-NOTES-v0.4.0.md, and falls back to RELEASE-NOTES-v0.4.md if only a
  series file exists. Write one per release. If neither is there the workflow
  publishes a stub pointing at the commit log rather than attaching some other
  release's notes, which is what it did for eleven tags.
-->

# Capset v0.4.0

Local auto-captioning for After Effects: transcribes with NVIDIA Parakeet on
your machine and generates timed text layers on the timeline.

> **Pre-release.** 501 automated tests (194 backend, 307 panel) and real use
> inside After Effects behind it, but this build's changes are new: the panel
> layout, the caption position and the timing fix below have been tested
> against fakes and not yet watched in a live host. Treat it as a build to try
> and report on.

## What's new in this build

**A word no longer hangs on screen.** Smart segmentation would occasionally
strand the last word of a sentence on a layer of its own and hold it there for
seconds after it was spoken — usually with music under the dialogue, which
made it look like the music was confusing the grouping. It was not. Parakeet
reports only a *start* time for each token, and the last token of every chunk
was being given the chunk's own length as its end. Chunks are cut from
detected speech, and speech detection holds on through background music, so
the final word inherited the whole music tail — and the grouping, seeing a
caption far over its duration budget, split the caption before it and left
that word alone. Both symptoms, one bad number. A word can no longer be
stretched past the length of a word.

**The panel is two tabs: Insert and Update.** The Animate tab is gone. Too
many of its presets read as the same animation under different names, and the
preview cards approximated the real animation closely enough to be believed
rather than checked — which is not a preview, it is a sales pitch. The engine
that generates and removes animators in After Effects is untouched and still
tested; what comes back is a way to build an animation by hand in AE and
capture it, the way the Update tab already captures type.

**Captions land in one place.** "Keep inside title-safe" has been removed. It
could not do what its label promised: title-safe is about the whole block of
text, and the block's size comes from your Character panel settings — which
Capset deliberately inherits and therefore cannot know. Captions are now
centred at 85% of comp height on every build: the subtitle band on 16:9 and on
9:16 alike. Moving a caption and pushing it with **Sync Style** still works
exactly as before.

**The service status is a dot.** "Ready — nemo-parakeet-tdt-0.6b-v3" took a
full row across the top of a panel docked into a narrow column, to say
something you never need to act on. Healthy is now a small dot in the tab row.
Anything else — still loading the model, failed, not running — opens the full
message and the re-check button, because those you do need to act on.

**Segmentation is Smart or Word-by-Word.** Three words per caption was neither
the punchy social rhythm nor a break the speaker actually made, so it is no
longer offered.

**Remove all Capset captions is red**, and looks like the destructive button
it is.

**The panel is orange.** New palette throughout — warm dark greys, orange for
the action on each tab, the progress bar and the update banner.

**Releases stop shipping the wrong notes.** Every release from v0.1.2 to
v0.3.2 was published with v0.1's release notes as its body, because the
workflow had that one path hardcoded. It now resolves the notes from the tag.

## Install

1. Run the `Capset-Setup-*.exe` from the Assets below.
2. Restart After Effects.
3. **Window → Extensions → Capset**.

Upgrading over an existing install is fine — Setup stops the running
transcription service itself before replacing files.

## Using it

**Insert** — select the layer with the dialogue, choose Full Composition or In
to Out, and hit **Add Captions**. No file dialog: After Effects renders the
audio and Capset transcribes it. With nothing selected it falls back to
everything audible in the composition — useful, but mixing music into the
input costs recognition accuracy, so selecting the voice layer is worth doing.
Or switch to *Captions File* to import an SRT/VTT instead.

**Update** — restyle one caption layer by hand, select it, **Capture style**,
then **Sync Style** across the composition or the whole project.

Captions inherit your current Character panel settings, so whatever you last
used carries through. Style one layer, then push it everywhere.

## Known limitations

- **This build's changes have not been run in After Effects.** Everything here
  passes its tests, and this project's own history says that is not the same
  thing: the first live session found four failures in a row that the suite
  had not caught. The caption position, the collapsed status dot and the new
  styling are the parts to look at first.
- **No animation.** Captions arrive timed and styled but static. This is a
  deliberate step backwards for one release — see above.
- **Unsigned.** Windows SmartScreen will warn — *More info* → *Run anyway*.
  Some antivirus may flag the PyInstaller binary; this is a known
  false-positive pattern for unsigned Python bundles.
- **The model ships inside the installer**, so nothing is downloaded at
  install or on first use and Capset works on a machine that has never had
  network access. The cost is the installer's size.
- **Windows only.** The macOS installer builds locally but is not in CI and is
  not notarized.
