# Dormant code

Nothing in here is loaded by the panel or copied into the installer payload
(`installer/build_payload.py` excludes the whole directory). It is kept in the
tree, with its tests still running in CI, because it is the starting point for
work that is planned rather than abandoned — code that rots quietly in git
history is code that gets rewritten from scratch.

## `animation/`

The Animate tab was removed from the panel: most of the shipped presets did
not read as distinct animations, and the preview cards approximated an
animation engine closely enough to mislead rather than to inform.

What is still live, in `panel/jsx/capset.jsx`, is the part that talks to After
Effects: `capsetApplyAnimation`, `capsetAddPhase`, `capsetSpringKeys` and
`capsetRemoveAnimators` — generating text animators under the `Capset__`
prefix and tearing them down exactly. That machinery is tested
(`panel/tests/jsx-behaviour.test.js`, which reads the library below) and is
what a future feature would write into, so it was not removed.

What is dormant here:

| File | What it is |
|---|---|
| `animations.json` | The 14-preset library. Still read by the JSX behaviour tests. |
| `timing.js` | Duration-adaptive in/out timing (`computeTimings`). |
| `preview.js` | Samples a definition in JavaScript to drive the DOM preview cards. |
| `presets.js` | Save/load/merge user-authored definitions in the user data folder. |
| `animation-tuner.html` | Standalone bench for hand-tuning definitions in a browser. |
| `README-animations.md` | The library's own notes. |

### The direction this is being kept for

Authoring animations in After Effects by hand and **capturing** them — the
mirror of `capsetCaptureStyle`, which reads a styled layer back into a
definition — rather than hand-writing JSON and approximating it in a preview
card. On that path `presets.js` (storage) and the JSX animator code are
reusable more or less as they stand; `preview.js` largely stops being needed,
because a card naming an animation the user built themselves does not have to
sell it to them.
