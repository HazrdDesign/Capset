<!--
  The body of the GitHub Release for v0.7.0.

  release.yml resolves this path from the tag. If the next release is numbered
  differently, rename this file to match (RELEASE-NOTES-v<version>.md, or
  RELEASE-NOTES-v<major.minor>.md to cover a whole series) or the workflow
  publishes a stub instead.
-->

# Capset v0.7.0

Local auto-captioning for After Effects: transcribes with NVIDIA Parakeet on
your machine and generates timed text layers on the timeline.

A third tab, **Proofread**: every caption in the composition in one list,
with its text and timing editable in place.

## What's new in this build

**Proofread every caption from one list.** Open the Proofread tab and every
Capset caption in the active composition is listed in time order: its in and
out timecode, how long it is on screen, and its text underneath. This
includes captions inside a Capset precomp, shown at their time on the
timeline you are looking at.

- **Fix a typo:** click into the text and type. Enter saves and moves to the
  next caption; Shift+Enter adds a line break; Esc throws the typing away.
  The caption keeps its font, size and colour, and the layer is renamed to
  match, unless you had renamed it yourself.
- **Retime without dragging:** type a timecode into the in or out field, the
  way you would in After Effects (`00:00:04:12`, `4:12` or `412` all work).
  **↑ / ↓** nudge it a frame, **Shift** for ten, and `+3` or `-3` nudges by
  typing.
- **Go to:** moves the playhead to the caption and selects its layer.

**Find & replace.** The find box filters the list as you type. **⇄** opens
Replace: fix a name the transcriber got wrong in every caption at once. It
matches plain text, not patterns. **Match case** is off unless you tick it.

**Problem flags.** Captions worth a second look get a ⚠, and hovering it says
why:

- **Overlap:** it is still on screen when the next caption starts.
- **Blink:** a one or two frame gap before the next caption, so the screen
  flashes empty between them.
- **Short:** on screen for under 0.2 seconds.
- **Fast:** more than 20 characters a second, too quick to read. Single-word
  captions are exempt, so word-by-word mode is not flagged throughout.

The **⚠ to check** button shows only the flagged captions. **Fix overlaps**
pulls back every caption that runs into the next one and closes every blink,
leaving each caption's start where the words start.

**Time shift.** Move every caption earlier or later by a number of frames. Or
tick *Only from the selected caption on* to move just the rest of the
composition from that point. Captions are moved rather than trimmed, so
anything keyframed on them moves too.

**Split and merge.**

- **Split:** click in a caption's text where it should break and press
  **Split**. The second half is a copy of the layer, with the same look,
  effects and controller link. The split time is placed in proportion to the
  text on either side; adjust it from the timecode fields.
- **Merge ↓:** folds the next caption into this one.

**Safe to use alongside the timeline.** Every change is one **Undo** in After
Effects. If a caption changed in After Effects since the list was read, by
hand or by an undo, the panel refuses to write over it, says so, and reads
the list again. The list is also read again whenever you come back to the
panel.

## Please test by hand

- Build captions, open Proofread, and check the order and timecodes against
  the timeline.
- Retype a caption: its text and layer name should change, its style should
  not. Do it once with **Parent to Controller** on, and check the controller
  still drives size and colour.
- Retime with typing and with ↑ / ↓, then press Cmd/Ctrl+Z once per change.
- Change a caption in the timeline, then edit the same caption in the panel
  before clicking back into it. Expect a refusal and a refreshed list.
- Repeat with **Precompose captions** on.
- Split a caption, then check the new half has the same effects and follows
  the controller. Merge it back.
- In a 29.97 drop-frame composition, and one with a start timecode other than
  zero, check the panel shows the same timecode as the timeline.

## Install

**Windows**: run `Capset-Setup-0.7.0.exe`, restart After Effects, then open
**Window → Extensions → Capset**.

**macOS**: open `Capset-0.7.0.pkg` (right-click → Open if Gatekeeper
objects), restart After Effects, then open **Window → Extensions → Capset**.
The installer needs an administrator password, because it writes to
`/Library/Application Support`.

You can install over an existing version on both.

## Known limitations

- **Proofread lists Capset captions only.** Titles and other text layers in
  the comp are left out on purpose.
- **Captions with keyframed Source Text are refused** rather than edited. Edit
  those in the timeline.
- **Text styled per character is flattened** when retyped: the whole caption
  takes the style of its first character.
- **After Effects 2020 and 2021 find captions by layer position** rather than
  by a permanent layer ID, which those versions do not have. The panel
  checks each caption still says what it said before writing to it, so the
  worst case is a refusal and a refreshed list, never an edit to the wrong
  layer.
- Unchanged from v0.6.5: the Mac build is still unproven in a real copy of
  After Effects, and both installers are unsigned.
