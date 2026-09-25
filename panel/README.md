# panel/ — CEP extension for After Effects

The UI, the segmentation logic, and the ExtendScript that builds caption
layers.

CEP rather than UXP because After Effects has no UXP panel API — see
[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §1.

## Layout

```
CSXS/manifest.xml      Extension manifest (AEFT, 2020-2026).
index.html             Panel UI: three tabs, Insert, Update and Proofread.
css/panel.css          Styling, tuned to AE's dark theme.
js/lib/segmentation.js Word / phrase / smart grouping.       [pure, tested]
js/lib/backend.js      Transcription service client.         [pure, tested]
js/lib/launcher.js     Starts the backend on demand.         [pure, tested]
js/lib/cepfile.js      Reads the rendered audio as bytes.    [pure, tested]
js/lib/srt.js          SRT / VTT import, SRT export.         [pure, tested]
js/lib/updates.js      Update manifest checking.             [pure, tested]
js/lib/proofread.js    Proofread tab: timecode, flags, edits. [pure, tested]
js/main.js             DOM glue and ExtendScript calls.
js/vendor/             CSInterface.js from Adobe.
jsx/capset.jsx         Host script: render, layers, style sync, SRT export,
                       proofreading edits.
jsx/json2.jsx          JSON for ES3 (public domain).
dormant/               Not loaded, not shipped. See dormant/README.md.
```

## Three design decisions worth knowing

**Captions inherit the Character panel, and land in one place.** `addText()`
picks up whatever font, size and colour the user last used, which is the point
— style one layer, then push it everywhere from the Update tab. Position is
the one thing not left to chance: centred, at 85% of comp height. A
"keep inside title-safe" option used to sit next to it and could not work,
because the size of the text block is exactly what the panel does not know.

Each layer is **named after what it says**, so the timeline reads like the
transcript. What marks a layer as Capset's is the tag in its comment field
(`CAPSET_TAG`), not its name — so renaming a caption does not orphan it from
Sync Style or from a rebuild. Layers built before the tag existed are still
recognised by the old `Capset__cap_N` name.

**Animations are generated, not applied from `.ffx`.** `.ffx` bakes fixed
keyframes that cannot adapt to caption duration — which is exactly why
preset-driven tools resolve too late on short words — cannot be generated
programmatically, and cannot be cleanly removed when swapping. Everything
`capset.jsx` creates carries a `Capset__` prefix, so replacing an animation is
an exact teardown and rebuild.

That machinery is still in `capset.jsx` and still tested, but **the Animate
tab is not in the panel**: too many of the shipped presets read as the same
animation, and the preview cards approximated the real thing convincingly
enough to mislead. The library and preview engine moved to `dormant/`, which
explains what replaces them.

**The panel renders its own audio.** After Effects writes it, so what gets
transcribed is what the user hears — comp mix, levels, solo and mute, audio
effects, time remapping — and no media decoder ships with Capset.
See `docs/ARCHITECTURE.md` §5a.

## ExtendScript is ES3

No `let`/`const`, no arrow functions, no `Array.prototype.forEach`/`map`, no
native `JSON`. `jsx/capset.jsx` uses plain `var` and indexed loops throughout,
and includes `json2.jsx` for JSON. Keep it that way — these fail at parse
time, so a single arrow function breaks the whole file.

## Test

```bash
cd panel && npm test
```

No After Effects required. Alongside the pure modules, three suites are worth
knowing about:

- `tests/wiring.test.js` runs `index.html` against `js/main.js` and fails on a
  library that is never loaded, an element that does not exist, a control
  nothing reads, or a setting read live after a run has started.
- `tests/jsx-proofread.test.js` does the same for the Proofread tab's host
  functions: an edit to a caption that changed since the list was read must
  be refused, and a batch must land whole or not at all.
- `tests/jsx-behaviour.test.js` executes `jsx/capset.jsx` against the fake
  host in `tests/fake-ae.js`, whose text-animator model
  (`tests/ae-text-animator.js`) evaluates range selectors properly — because
  a fake that only recorded which keyframes were created is how animations
  shipped applying no motion at all.

## Install for development

1. Enable unsigned extensions:
   - **Windows** — registry `HKEY_CURRENT_USER\Software\Adobe\CSXS.<n>`, string
     `PlayerDebugMode` = `1`
   - **macOS** — `defaults write com.adobe.CSXS.<n> PlayerDebugMode 1`

   `<n>` is the CEP version and differs per AE release, so supporting
   2020–2026 may need several keys set.

2. Copy or symlink this folder into the CEP extensions directory as
   `design.hazrd.capset`:
   - **Windows** — `%APPDATA%\Adobe\CEP\extensions\`
   - **macOS** — `~/Library/Application Support/Adobe/CEP/extensions/`

3. Restart After Effects. **Window → Extensions → Capset**.

The panel starts the backend itself and reports the service as a dot in the
tab row — grey while checking, orange-amber while the model loads, red with a
full message and a re-check button when something is wrong.
