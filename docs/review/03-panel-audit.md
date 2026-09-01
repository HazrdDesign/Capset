# Panel Audit — capset.jsx and the CEP panel

Scope: `panel/jsx/capset.jsx`, `panel/jsx/json2.jsx`, `panel/js/main.js`,
`panel/js/lib/{timing,segmentation,srt,backend,updates}.js`, `panel/index.html`,
`panel/CSXS/manifest.xml`, `panel/tests/`, `docs/schema.md`.

Method: static read-through plus cross-reference against the documented AE
scripting object model from memory (no live After Effects host was
available). Every AE API call is labelled **VERIFIED** (matches a
well-documented, widely-used pattern I have high confidence in),
**VERIFIED (moderate confidence)**, or **UNVERIFIED** (cannot confirm without
a live host — do not trust without testing). `panel/js/main.js` and the
`js/lib/*.js` files run as ordinary browser JS inside the CEP Chromium
process, not ExtendScript, so ES3 rules do not apply to them.

Sanity check performed: stripping the ExtendScript-only `#include` line, both
`capset.jsx` and `json2.jsx` parse cleanly under Node/V8 (`node --check`).
This is informational only — it proves the files are syntactically valid
*some* dialect of JS, not that ExtendScript's specific engine accepts every
construct, but it is useful corroborating evidence for the `in`-as-property
question below. All 81 existing unit tests (`npm test` in `panel/`) pass;
`capset.jsx` and `main.js` have **zero** automated test coverage (expected —
ExtendScript can't run under Node — but worth stating plainly: nothing below
has ever been machine-checked, only read).

---

## WILL FAIL IN AE

Nothing found that I can assert with confidence will hard-fail (throw at
parse time or on first call). The two candidates below were investigated and
downgraded — see RISKY.

---

## LIKELY BUG

### 1. The "controller rig" — the stated differentiator feature — is dead code and never runs

`panel/jsx/capset.jsx:512-532` (`capsetLinkToController`) is the function
that actually wires expressions from a caption's Position and Source Text to
the controller null's "Font Size" / "Baseline %" / "Fill Colour" sliders —
this is the mechanism the file's own header comment (`capset.jsx:443-455`)
describes as *"the original project differentiator: Captioneer requires
restyling every layer by hand."*

It is called from exactly one place: `capsetBuildController`
(`capset.jsx:534-570`). I searched all of `panel/js/main.js` and
`panel/index.html` for any call to `capsetBuildController` — **there is
none**:

```
$ grep -rn "capsetBuildController" panel/js/ panel/index.html
(no matches)
```

The only reachable path that creates a controller is
`capsetBuildCaptions` (`capset.jsx:802-881`) via `options.parentToController`
(`capset.jsx:830-833`, wired from the "Parent to Controller" checkbox,
`panel/index.html:76`, `panel/js/main.js:273`). That path calls
`capsetEnsureController` and does a plain `layer.parent = controller`
(`capset.jsx:851-853`) — ordinary AE Transform-parenting, nothing more. It
**never calls `capsetLinkToController`**.

Net effect: checking "Parent to Controller" creates a null named "Capset
Controller" carrying three Slider/Color Control effects that are completely
inert — no expression anywhere reads them. Dragging "Font Size" or "Fill
Colour" on that null does nothing to any caption. The one thing that *does*
work is that the captions inherit the null's Transform (so moving/scaling
the null moves them together) — but that's a side benefit of ordinary
parenting, not the "style everywhere at once" feature being sold. This is
not a crash; it is a fully-silent feature that does not do what the UI and
code comments both claim it does.

**Fix direction**: either call `capsetLinkToController` for each created
layer inside `capsetBuildCaptions`'s parenting branch, or delete the
unreachable `capsetBuildController`/`capsetLinkToController` pair and the
"Parent to Controller" checkbox's implied promise.

### 2. "Include effects" (Update tab) is silently a no-op

`panel/index.html:112` — the "Include effects" checkbox, checked by
default — feeds `copyEffects` and `effects` into the `capsetSyncStyle`
payload (`panel/js/main.js:406-411`). `capsetSyncStyle`
(`panel/jsx/capset.jsx:722-766`) never reads `payload.copyEffects` or
`payload.effects` anywhere in its body — grep confirms:

```
$ grep -n "payload\.copyEffects\|payload\.effects" panel/jsx/capset.jsx
(no matches)
```

The function that *would* copy effects, `capsetCopyEffects`
(`capset.jsx:690-716`), is never called from `capsetSyncStyle` or anywhere
else in the file — it is unreachable dead code (see RISKY #1 for why it
would also be dangerous if wired up as-is).

Net effect: a user syncs style with "Include effects" checked (the default),
gets a success toast — `"Styled N layer(s) across M comp(s)."`
(`main.js:414-415`) — and no effects are copied, with no indication anything
was skipped.

### 3. `precompose` breaks the "rebuild replaces, not stacks" guarantee

`capset.jsx:857-868`:

```js
var pre = comp.layers.precompose(indices, "Capset Captions", true);
pre.name = CAPSET_PREFIX + "captions";
```

`LayerCollection.precompose()` returns the new **`CompItem`** (the
composition project item), not the layer that now sits in the original comp
in place of the moved layers. `pre.name = ...` renames the *composition*,
not that replacement layer. The replacement layer in the timeline is named
after the second argument to `precompose()`, i.e. literally `"Capset
Captions"` (space-separated) — which does **not** start with `CAPSET_PREFIX`
("Capset__", double underscore) — so `capsetIsCapsetLayer`
(`capset.jsx:887-889`) returns `false` for it.

Consequences, both reachable from the UI (`opt-precompose`, `index.html:75`):
- Re-running "Add Captions" after a precomposed build: the replace-loop at
  `capset.jsx:822-828` scans the *active comp*, which now contains just the
  one un-prefixed precomp layer — none of the old caption layers (they're
  inside the new sub-comp) match the prefix check, so nothing is removed,
  and a second, independent set of captions/precomp is added alongside the
  first. Captions stack instead of replacing, contradicting the explicit
  design intent stated at `capset.jsx:819-820`.
- "Remove all Capset captions" (`capsetClearCaptions`, `capset.jsx:769-796`)
  will not find or remove a precomposed set either, for the same reason.

**Confirmed via `precompose()`'s documented return type** (`CompItem`) —
VERIFIED against the standard scripting reference signature
`precompose(layerIndicies, name, moveAllAttributes) : CompItem`.

---

## RISKY

### 1. `capsetRenderAudio` calls `renderQueue.render()`, which renders every queued item — not just the one it added

`capset.jsx:399`: `app.project.renderQueue.render();`

`RenderQueue.render()` renders **every item in the queue with status
"Queued"** (`.render === true`), in queue order, not only the item this
function just added (`capset.jsx:379-380`). The function never inspects or
temporarily disables any *pre-existing* queue items before calling
`.render()`, and never restores their state afterward. If the user already
had one or more items queued for output (a very plausible state — someone
mid-export, or someone who queues several comps before stepping away), a
single click of "Add Captions" will also render all of those: unexpected
multi-minute/GB renders, disk writes to output paths the user didn't ask
for right now, and a very slow "busy" panel for a reason that has nothing to
do with captions. This is a real risk to "must be fast" and arguably to
"must never corrupt the user's project" in spirit (unwanted overwritten
output files).

Only the *new* item is removed afterward (`capset.jsx:430-432`, correctly,
via `try { item.remove(); }`), so this isn't a stray-queue-item problem —
it's a scope-of-render problem. **VERIFIED** that `RenderQueue.render()`
processes all queued items — this is documented, standard behavior, not an
edge case.

**Fix direction**: snapshot every pre-existing item's `.render` boolean,
force them all to `false`, run `render()`, then restore — the same
save/restore pattern already used correctly for the work area.

### 2. The render's actual Time Span is never set — the returned `start` offset may not match what was actually rendered

`capset.jsx:342-441` manipulates `comp.workAreaStart`/`workAreaDuration`
to control what gets rendered, but never calls `item.getSettings()` /
`item.setSettings()` (or any equivalent) to set the render item's **Time
Span** to "Work Area Only" — it only ever touches the *comp's* work area and
implicitly assumes the render item's default Time Span setting will honor
it.

This matters because AE's Render Settings default Time Span is not
guaranteed to be "Work Area Only" for a freshly-added queue item — it can
default to "Length of Comp", and in some versions/sessions it can mirror
whatever the *user last used* in the Render Settings dialog. I could not
confirm which applies here without a live host — **UNVERIFIED**, but the
consequence if it defaults to "Length of Comp" is serious:

- **"Full Composition" scope** (`payload.scope !== "inout"`,
  `capset.jsx:374-377`): forces the work area to the full comp before
  rendering. Harmless either way — the render covers the whole comp
  regardless of Time Span default, so this path likely works by
  coincidence.
- **"In to Out" scope**: the work area is deliberately left untouched
  (`capset.jsx:374`, the mutation is skipped). If Time Span defaults to
  "Length of Comp" rather than "Work Area Only", the actual rendered audio
  would span the **whole composition**, not just the work area — but the
  function still returns `start: comp.workAreaStart` (a non-zero value,
  `capset.jsx:363`). The panel then adds that `start` as `timeOffset` to
  every transcribed word (`main.js:325`, `capset.jsx:809, 843-844`),
  shifting **every caption layer forward by the full work-area-start
  amount** relative to where the words are actually spoken in the render.
  Every caption would land at the wrong time — this is precisely the class
  of bug goal #6 was hunting for, and it hinges entirely on an assumption
  about AE's default Render Settings that this code never enforces and this
  review could not confirm.

`docs/schema.md:94-97` explicitly documents that "the panel still has to
offset against wherever the work area starts in the comp" — confirming the
*design intent* matches what `capset.jsx` attempts, but not that the
*render itself* is actually constrained the way the offset math assumes.

**Fix direction**: explicitly set the render item's Time Span via
`item.setSettings({"Time Span": "Work Area Only"})` (or whatever the correct
settable key literally is on the target AE versions — confirm against a live
host) rather than relying on the default, for both scopes.

### 3. `app.executeCommand`/menu-command Copy-Paste in `capsetCopyEffects` — currently unreachable, but a live landmine if ever wired up

`capset.jsx:690-716`. Even though this is dead code today (see LIKELY BUG
#2), the task explicitly asked me to trace it, and the "Include effects"
checkbox strongly implies someone intends to wire it up later, so:

- `targetLayer.selected = true` (`capset.jsx:709`) **adds** to the current
  selection rather than replacing it — nothing clears the prior selection
  first (not even the source layer, which is never explicitly selected by
  this function at all — only its individual effect *properties* are marked
  `.selected = true`, `capset.jsx:700`). If the caller's context already has
  the source layer selected (plausible — the whole workflow is "restyle a
  layer, select it, capture, sync"), `Paste` would execute with **both**
  source and target layers selected simultaneously, and After Effects'
  `Paste` command applies to every selected layer — not guaranteed to
  affect only the target. There is no save/restore of the layer selection
  anywhere in this function or its would-be caller.
- It permanently overwrites the OS **clipboard** via `executeCommand(Copy)`
  with no attempt to save/restore prior clipboard contents.
- `app.findMenuCommandId("Copy")` / `("Paste")` — the manifest declares
  `<Locale Code="All"/>` (`panel/CSXS/manifest.xml:25`), i.e. this panel is
  meant to run on non-English After Effects installs. Whether
  `findMenuCommandId` matches against the literal English menu string
  regardless of UI locale, or requires the localized string, I could not
  confirm — **UNVERIFIED**, and if it requires localization this silently
  returns 0/invalid and the whole copy silently fails (caught by the
  `try/catch` at `capset.jsx:711-713`, returning `0` — so at least it fails
  soft, not hard).
- More fundamentally: `executeCommand`-driven Copy/Paste depends on which
  panel currently has UI focus (Effect Controls vs Timeline vs Composition),
  which scripting cannot set or query. There is no way to guarantee `Paste`
  lands on effects rather than, say, pasting a duplicate layer.

None of this fires today because nothing calls this function. Flagging it so
that if LIKELY BUG #2 is "fixed" by simply calling `capsetCopyEffects`, it
isn't fixed into a new, worse bug.

### 4. `capsetAudibleLayers` never checks the per-layer Audio switch

`capset.jsx:286-302` decides which layers "will actually contribute to the
render" using `layer.hasAudio`, `layer.enabled`, and `layer.solo`
(VERIFIED — `AVLayer.hasAudio`/`.solo` and `Layer.enabled` are real,
documented properties) — but After Effects layers have a **separate** Audio
toggle (the speaker icon in the Timeline) distinct from the Video/eye toggle
that `.enabled` controls. I'm reasonably confident this is exposed to
scripting as a distinct boolean (commonly referenced as
`AVLayer.audioEnabled`) but could not confirm the exact property name
against a live host — **UNVERIFIED property name, but the gap in logic is
real regardless of the exact name**: a layer with video hidden
(`enabled = false`) but audio switch on would be silently excluded from the
`audible` list here even though AE may still render its sound, and
conversely a layer with audio switched off but video on would be wrongly
counted as audible. Either direction produces a `layers` field in the
result (`capset.jsx:425`, surfaced to the user at `main.js:293-294`) that
doesn't match what's actually in the rendered file, and in the audio-off
case could cause the "No audible audio" guard (`capset.jsx:353-358`) to
under- or over-fire.

### 5. `host()` has no timeout — a hung `evalScript` leaves the UI busy forever

`panel/js/main.js:72-90`. `cs.evalScript` calls into ExtendScript
synchronously on the host side; the Promise it wraps only resolves when
AE's callback fires. If the host script never returns control (a modal
dialog somehow triggered by `executeCommand`, an infinite loop, or AE itself
hanging on a slow/stuck render — see RISKY #6 below), every caller's
`setBusy(true)`/`setBusy(false)` pattern (e.g. `main.js:330-373`) never
reaches its `.then(function () { setBusy(false); })`, and every button in
`setBusy`'s list (`main.js:55-56`) stays disabled indefinitely with no
way to recover short of reloading the panel. No timeout/cancel exists
anywhere in the bridge.

### 6. `renderQueue.render()` and the layer-build loop are both synchronous and can block the entire After Effects UI thread

Goal #8. `capset.jsx:399` (`app.project.renderQueue.render();`) is a
blocking call — the whole `evalScript` call, and with it all of After
Effects, is unresponsive for the full render duration, with the panel only
able to show a static "Rendering audio…" string (`main.js:290`) since no
progress can be reported mid-script. Separately, `capsetBuildCaptions`
(`capset.jsx:802-881`) creates one `addText()` layer per caption plus, for
each, a full animator build (`capsetApplyAnimation` →
`capsetAddPhase`, `capset.jsx:156-237`, each adding an animator, a selector,
per-property keyframes and eased tangents) inside one synchronous loop. In
"word by word" mode (`opt-split`, `index.html:77`) on a long video this can
be hundreds to low thousands of layers built in one blocking call. Neither
path is inherently a bug, but both work directly against the stated "must be
fast" goal, and neither has any user-facing progress or cancel affordance
during the blocking portion.

### 7. "Full Composition" / "In to Out" is silently ignored for SRT/VTT import

`captionsFromSrt()` (`main.js:299-306`) always returns `offset: 0` and is
called unconditionally regardless of the "duration" radio group
(`index.html:65-72`), which sits in the same "Create" section visible
regardless of which "Captions" source is selected. Selecting "Captions
File" + "In to Out" gives no indication that the In/Out choice has no effect
on file-derived captions — the SRT's own absolute timestamps are used
as-is. This may well be the *correct* behavior (SRT timestamps are already
absolute-to-source), but the UI doesn't communicate that the control is
inert for this source, which is a plausible source of "my captions are at
the wrong time" reports.

### 8. `phase.ease.in` — dot-access to a reserved word, inconsistent with the file's own defensive pattern

`capset.jsx:182`:
```js
var easeIn = phase.ease && phase.ease.in !== undefined ? phase.ease.in : 33;
```
uses **dot notation** on `in`, a reserved word — while the structurally
identical case two functions later, `capset.jsx:246,249`
(`animation["in"]`), deliberately uses **bracket notation** for the same
key, strongly suggesting the author already knew `in` needed special
handling here and simply missed this one call site. Per the ECMAScript
grammar (`IdentifierName`, which is a superset of `Identifier` that
explicitly includes current reserved words), `.in` after a dot has been
valid syntax since ES3, and stripping the one ExtendScript-only line and
running it through Node's parser confirms the file is syntactically valid
JS as written. I could not run it inside ExtendScript itself, so I'm not
elevating this to "will fail" — but given goal #1's framing (a single parse
failure kills the entire file) and the author's own inconsistency, I'd
normalize this to `phase.ease["in"]` before shipping rather than rely on my
assessment.

### 9. `options.precompose` + `options.parentToController` together

`capset.jsx:851-853` parents each caption to the controller *before*
`capset.jsx:861-864` precomposes those same captions into a new
sub-composition. The controller stays behind in the parent comp; the
captions move into the new sub-comp. A layer's parent must be in the same
composition, so precomposing children whose parent is excluded from the
selection breaks that parenting relationship (silently, since scripting
suppresses the interactive warning dialog AE would normally show for this).
Low practical impact today because the parent link isn't doing anything
expression-wise (see LIKELY BUG #1) — but worth fixing alongside that bug,
since fixing #1 would make this combination actively lose the expression
link on every precomposed build.

### 10. 2D position result assigned to what may be a 3D property

`capsetLinkToController`'s Position expression (`capset.jsx:514-518`)
always returns a 2-element array `[x, y]`. If a caption layer's 3D switch is
ever turned on (not done by Capset, but nothing prevents a user from doing
it by hand afterward, and it isn't guarded against), `Transform → Position`
becomes a 3D spatial property expecting 3 values, and I could not confirm
whether AE auto-pads a 2-element expression result to 3D or throws a red
expression error — **UNVERIFIED**, low-probability path (only reachable if
finding #1 above is fixed and a user then manually 3D-enables a caption
layer), but cheap to harden with a third `0` if fixed.

### 11. Minor inconsistency: `capsetReplaceAnimation` skips the `|| "{}"` default

Every other JSON-parsing entry point defends against an empty/undefined
payload (e.g. `capset.jsx:349, 537, 725, 772, 805`: `JSON.parse(payloadJson
|| "{}")`). `capset.jsx:897` is the one exception:
`JSON.parse(payloadJson)`. Low impact — `main.js:434-438` always sends a
real JSON string — but inconsistent, and a `JSON.parse(undefined)` call
elsewhere would throw on the literal string `"undefined"`; harmless here
only because the outer `try/catch` (`capset.jsx:895-961`) is entered before
`beginUndoGroup`, so a throw here is caught cleanly with no leaked undo
group (see VERIFIED OK #2).

### 12. `checkForUpdates` chain has no top-level `.catch`

`main.js:501`: `loadConfig().then(function () { checkForUpdates(false); });`
— no `.catch` on the outer chain. `UpdateChecker.check()` traps its own
`fetch` failures (`updates.js:145-152`), so this is unlikely to actually
reject in practice, but if `showUpdate()` (`main.js:107-119`, called from
inside `checkForUpdates`'s `.then`, `main.js:128`) ever throws (e.g. a
missing DOM element), that becomes an unhandled promise rejection with no
user-visible effect beyond a console warning. Low severity, worth a
`.catch` for hygiene.

### 13. `layer.inPoint` is set before `layer.outPoint` on freshly-created layers

`capset.jsx:843-844`:
```js
layer.inPoint = capsetSnap(comp, offset + caption.start);
layer.outPoint = capsetSnap(comp, offset + caption.end);
```
If a newly-`addText()`-ed layer's *default* `outPoint` is ever earlier than
the target `inPoint` being assigned (I could not confirm the default
in/out AE assigns to a freshly added text layer against a live host —
**UNVERIFIED**), setting `inPoint` first could throw
("in point must be before out point"), aborting the build loop partway
through with some caption layers already created and others not. Because
this is all inside the outer `try/finally` (`capset.jsx:803-881`), the undo
group still closes correctly (one Ctrl+Z fully reverts — see VERIFIED OK
#2), so this is not a corruption risk, just a partial-build/no-rollback UX
risk if it is in fact reachable.

---

## VERIFIED OK

### 1. ES3 compliance — no violations found in `capset.jsx` or `json2.jsx`

Searched both files for `let`/`const` declarations, arrow functions,
`Array.prototype.forEach/map/filter`, `Object.keys`, and `String.prototype.trim`
— **zero matches** in either file:

```
$ grep -nE "\blet[[:space:]]|\bconst[[:space:]]|=>|\.forEach\(|\.map\(|\.filter\(|Object\.keys|\.trim\(" \
    panel/jsx/capset.jsx panel/jsx/json2.jsx
(no matches)
```
No trailing commas in object/array literals either. All loops are indexed
`for` with `var`; all JSON access goes through `json2.jsx`'s
`#include`-provided polyfill (`capset.jsx:18`), which correctly guards
against clobbering a native `JSON` if one exists (`json2.jsx:157, 384, 441`)
so it's safe whether or not the host engine already has one. `panel/js/lib/*.js`
and `panel/js/main.js` are **not** ExtendScript (they run in the CEP
Chromium/CEF process) so ES5+ features there (`.forEach`, `.map`, arrow-free
but otherwise modern-ish patterns) are not a concern and are used freely and
correctly.

### 2. Undo-group safety — every mutating entry point is correctly guarded

Checked all seven mutating ExtendScript entry points —
`capsetRenderAudio` (`capset.jsx:342-441`), `capsetBuildController`
(`534-570`, unreachable but still correctly written), `capsetSyncStyle`
(`722-766`), `capsetClearCaptions` (`769-796`), `capsetBuildCaptions`
(`802-881`), `capsetReplaceAnimation` (`894-961`), `capsetClearAnimations`
(`963-994`) — against the pattern:

- an `undoOpen` flag, initialized `false`,
- every early validation/throw (missing comp, empty payload, no targets,
  etc.) happens **before** `app.beginUndoGroup(...)`,
- `undoOpen = true` is set on the line immediately *after* `beginUndoGroup`,
  never before it,
- the `finally` block's `if (undoOpen) app.endUndoGroup();` is unconditional
  and is the last statement in every `finally`,
- in `capsetRenderAudio`, the two other cleanup actions inside `finally`
  (render-queue item removal, work-area restore) are each independently
  wrapped in their own `try/catch` so a failure in either cannot prevent
  `endUndoGroup()` from running (`capset.jsx:429-440`).

I found no path in any of these seven functions where an early return or a
thrown error leaves a `beginUndoGroup` unmatched, and no path where
`endUndoGroup` could be called twice or called without a matching begin.
This part of the design is solid.

### 3. Core AE API surface — matches the documented scripting object model

The following are used in ways consistent with the standard, documented AE
ExtendScript object model. I have high confidence in each from repeated
exposure to Adobe's own scripting guide and widely-published scripts, but
none of this was run against a live host, so treat as "matches the spec I
know," not "confirmed working":

- `app.project.activeItem`, `instanceof CompItem` — `capset.jsx:36-37`
- `CompItem.width/height/duration/frameRate/frameDuration/workAreaStart/workAreaDuration/numLayers` — `capset.jsx:58-65, 360-364, 372-377`
- `comp.layers.addText(text)`, `comp.layers.addNull()` — `capset.jsx:476, 841`
- `LayerCollection.precompose(indices, name, moveAllAttributes)` returns
  `CompItem` — `capset.jsx:862` (see LIKELY BUG #3 for the misuse of the
  return value, not the call itself)
- `layer.property("Source Text")` / `.value` as `TextDocument`,
  round-tripped through `setValue()` — `capset.jsx:82-85, 655-671`
- `TextDocument` properties used: `justification`, `font`, `fontSize`,
  `tracking`, `leading`, `applyFill`, `fillColor`, `applyStroke`,
  `strokeColor`, `strokeWidth`, `strokeOverFill` — `capset.jsx:84, 612-627, 658-671`
- `ParagraphJustification.CENTER_JUSTIFY` — `capset.jsx:84`
- `layer.property("Transform").property("Position")` — `capset.jsx:93-95, 678-681`
- `"ADBE Text Properties" → "ADBE Text Animators" → addProperty("ADBE Text Animator")`,
  then `"ADBE Text Animator Properties"` / `"ADBE Text Selectors" →
  addProperty("ADBE Text Selector")` — `capset.jsx:122-136, 161-169` —
  matches the canonical text-animator-building pattern from Adobe's own
  scripting guide example.
- `CAPSET_PROPERTY_MATCH` matchNames (`ADBE Text Position 3D`, `ADBE Text
  Scale 3D`, `ADBE Text Rotation`, `ADBE Text Opacity`, `ADBE Text Blur`,
  `capset.jsx:107-113`) and `ADBE Text Percent Offset`
  (`capset.jsx:229-231`) match the documented Animator Property list.
- `new KeyframeEase(speed, influence)` and
  `prop.setTemporalEaseAtKey(keyIndex, inArray, outArray)` — `capset.jsx:211-219`
  — signature matches the documented API; the 1-based key indexing
  (`n-1`/`n` after exactly two `setValueAtTime` calls on a freshly-added
  property, `capset.jsx:200-201, 215-219`) is internally consistent.
- `"ADBE Slider Control"` / `"ADBE Slider Control-0001"`,
  `"ADBE Color Control"` / `"ADBE Color Control-0001"` — `capset.jsx:484-499`
  — matches the standard Slider/Color Control scripting pattern.
- `App.project.expressionEngine` starting with `"javascript"` as the
  JS-engine test — `capset.jsx:459` — matches the documented (AE 16.0+)
  property, consistent with the manifest's declared minimum host of AE 17.0
  (`panel/CSXS/manifest.xml:22`).
- `outputModule.templates` (array of template name strings) and
  `outputModule.applyTemplate(name)` — `capset.jsx:321-335, 392` — matches
  the documented API, and the stated reason for using a template rather
  than `setSettings()` (`Format` being read-only) is corroborated by
  `docs/ARCHITECTURE.md:218-222`, i.e. this was apparently confirmed once
  already, just not re-verified here against a live host.
- `Folder.temp`, `new File(...)`, `.fsName`, `.exists` — `capset.jsx:394-418`
  — standard ExtendScript File/Folder I/O, not AE-specific.
- Using `\r` (not `\n`) to join multi-line caption text before
  `addText()` (`capset.jsx:839`) matches the well-known AE quirk that
  Source Text line breaks must be carriage returns to render as separate
  lines.

### 4. Time-offset arithmetic is internally consistent with the documented backend contract

`docs/schema.md:94-97` states word timestamps are absolute within the
*submitted file* and that "the panel still has to offset against wherever
the work area starts in the comp." The panel does exactly that:
`captionsFromTranscription` threads `source.start` through as `offset`
(`main.js:308-328`), `capsetBuildCaptions` adds it to every caption's
`start`/`end` before assigning `layer.inPoint`/`outPoint`
(`capset.jsx:809, 843-844`), and the `scope` string (`"composition"` vs.
`"inout"`) is threaded unchanged from the HTML radio value
(`index.html:66-72`) through `main.js` to `capset.jsx:362-365`'s exact
string comparison, with no naming mismatch anywhere in the chain. The
arithmetic itself is correct; the only open question is whether the
underlying render actually starts where `capsetRenderAudio` claims it does
(RISKY #2).

### 5. `timing.js`, `segmentation.js`, `srt.js`, `backend.js`, `updates.js`

All five are pure, unit-tested (81/81 passing), and read as correct on
inspection — clamping, proportional in/out scaling, greedy phrase
segmentation with sentence-end/gap/budget breaks, SRT/VTT timecode parsing
(handles both `,` and `.` decimal separators and optional VTT hour field),
and version comparison all look sound. No AE-specific risk here since none
of this runs in ExtendScript.

---

## Other notes

- **`build/payload/panel/`** is a generated copy of `panel/` produced by
  `installer/build_payload.py` for packaging. It has already diverged from
  `panel/` (`diff` confirms `capset.jsx` and `main.js` differ between the
  two trees) — i.e. it's stale relative to the current source, not a second
  copy of the bug surface to audit separately. Regenerate it before any
  release build; don't hand-edit it.
- **Test coverage gap**: `capset.jsx` (ExtendScript) and `main.js` (panel
  glue/bridge) have no automated tests at all — only the five pure `lib/`
  modules are covered. Given this file has never executed inside AE, the
  single highest-value next step is running it against a real composition
  and working through each function in this report in order, starting with
  LIKELY BUG #1-#3 and RISKY #1-#2, since those affect the core "select a
  comp, hit Add Captions, get correctly-timed layers" path most directly.
