# panel/ — CEP extension for After Effects

The UI, the segmentation and timing logic, and the ExtendScript that builds
caption layers.

CEP rather than UXP because After Effects has no UXP panel API — see
[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §1.

## Layout

```
CSXS/manifest.xml     Extension manifest (AEFT, 2020-2026).
index.html            Panel UI.
css/panel.css         Styling, tuned to AE's dark theme.
js/lib/timing.js      Duration-adaptive animation timing.  [pure, tested]
js/lib/segmentation.js Word / phrase / smart grouping.     [pure, tested]
js/lib/backend.js     Transcription service client.        [pure, tested]
js/main.js            DOM glue and ExtendScript calls.
js/vendor/            CSInterface.js from Adobe.
jsx/capset.jsx        Host script: layers, animators, swapping.
jsx/json2.jsx         JSON for ES3 (public domain).
animations/           Animation definitions + preview loops.
```

## Two design decisions worth knowing

**Timing is computed in the panel, not in ExtendScript.** `js/lib/timing.js`
is unit-tested under node; the JSX only applies the seconds it is handed. One
implementation of the rules, and it is the tested one.

**Animations are generated, not applied from `.ffx`.** `.ffx` bakes fixed
keyframes that cannot adapt to caption duration — which is exactly why
preset-driven tools resolve too late on short words — cannot be generated
programmatically, and cannot be cleanly removed when swapping. Everything
`capset.jsx` creates carries a `Capset__` prefix, so replacing an animation is
an exact teardown and rebuild. That is what makes "replace on selected / on
all" reliable.

## ExtendScript is ES3

No `let`/`const`, no arrow functions, no `Array.prototype.forEach`/`map`, no
native `JSON`. `jsx/capset.jsx` uses plain `var` and indexed loops throughout,
and includes `json2.jsx` for JSON. Keep it that way — these fail at parse
time, so a single arrow function breaks the whole file.

## Test

```bash
cd panel && npm test
```

48 tests, no AE required: timing (including a sweep proving the in-animation
always resolves within the cap), segmentation (word/phrase/smart, wrapping,
gap and sentence breaks, no word lost), and the backend client (polling,
failure, timeout, unreachable service).

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

The backend must be running (`cd backend && python -m app.main`); the panel
shows service status at the top and refuses to build without it.

## Status

**Nothing here has been executed inside After Effects yet.** The logic
modules are tested under node and the manifest is validated, but the JSX
match names and API shapes come from the scripting reference, not from a
running host. Treat `capset.jsx` as a first draft.

Open items:

- Run in AE and fix what the host rejects.
- `TextDocument.fillColor` from script is flagged UNVERIFIED in
  `docs/research/01-ae-extensibility.md`; a Fill effect is the fallback.
- Range-selector match names (`ADBE Text Range Type2`) vary across versions;
  the code degrades rather than aborting, which needs confirming.
- Preview loops in `animations/previews/` do not exist yet. The grid falls
  back to "no preview" text. They should be rendered from the procedural
  engine via `aerender` so previews cannot drift from what is applied.
- Controller rig (expression-linked global restyle) is not built yet.
