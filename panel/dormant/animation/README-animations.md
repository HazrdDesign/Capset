# Animation library

`animations.json` is the whole library. Definitions are data rather than
`.ffx` binaries: `.ffx` cannot be generated programmatically, bakes fixed
keyframes that cannot adapt to caption duration, and is near-impossible to
remove cleanly when swapping. Everything here is generated procedurally under
the `Capset__` prefix, so replacing an animation is an exact teardown and
rebuild.

## Previews are rendered live

The panel animates the cards itself, from these same definitions, in
`js/lib/preview.js`.

The original design used pre-rendered video loops, the way Motion Bro and
Animation Composer do. It did not survive contact with reality: the loops had
to be rendered by running a script inside After Effects, `*.mp4` is
gitignored, and nothing in the build produced them — so the shipped panel
showed "no preview" on every card. A preview that only exists if someone
remembers to render it is not a preview.

Driving previews from the definitions means they cannot drift from what gets
applied, and they cost no build step, no files and no download. They are an
approximation: keyframe influence becomes a cubic bezier, the range selector's
sweep becomes a fixed stagger, and the text is the panel's font rather than the
comp's. They show the character of the motion — punch, overshoot, direction,
colour, stagger — which is what someone picking from a grid is choosing
between.

## Adding an animation

Add an entry to `animations.json`. Fields:

| field | meaning |
| --- | --- |
| `id` | stable identifier; also names the generated animators |
| `name`, `description` | shown in the panel |
| `tags` | free-form, for filtering |
| `basedOn` | `characters`, `words` or `lines` — the range selector's basis |
| `spansLayer` | `true` if the animation is meant to run the caption's full length (karaoke), which opts it out of the resolve-early cap |
| `in`, `out` | the phases; omit `out` for animations that cut rather than exit |

Inside a phase:

| field | meaning |
| --- | --- |
| `fraction`, `min`, `max` | phase length as a share of the layer, clamped to seconds |
| `properties` | what to animate |
| `ease.in`, `ease.out` | After Effects keyframe **influence** percentages, applied to the incoming and outgoing side of every key. Higher influence means a more gradual change at that side — so an entrance that punches has a high `in` (decelerate into place) and a low `out` (leave the start pose immediately). AE's own Easy Ease is 33. |

A property is `{type, from, to}` plus an optional `overshoot`:

- `type` is one of `position`, `scale`, `rotation`, `opacity`, `blur`,
  `fillColor`, `strokeColor`, `strokeWidth`, `tracking`.
- `overshoot` above 1 makes the property travel past its target and settle
  back. It is measured against the **travel**, so `1.2` on a slide from
  `[0,-80]` to `[0,0]` peaks at `[0,20]`. This is what makes a caption feel
  like a short-form punch rather than an interpolation.
- `"$textColor"` as a value resolves to the layer's own fill colour at apply
  time, so a colour flash settles on the colour the user chose instead of
  overwriting it.

`panel/tests/preview.test.js` samples every shipped animation end to end, so a
malformed entry fails the build rather than the panel.
