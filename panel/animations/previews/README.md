# Animation previews

Pre-rendered loops shown in the panel's animation grid. CEP has no live
render-to-panel path, so previews must be baked — the same approach Motion Bro
and Animation Composer use.

**These are generated, not hand-made.** `tools/render-previews.jsx` builds a
preview comp per animation, applies the animation through the *same*
`capsetApplyAnimation` the panel uses, and queues it for render. A preview
therefore cannot drift from what actually gets applied to a caption.

## Regenerating

1. Open After Effects (any project).
2. **File → Scripts → Run Script File…** → `tools/render-previews.jsx`
3. Render the queue.

Output lands here as `<animation-id>.mp4`, matching the `preview` field in
`../animations.json`.

## Missing previews are safe

The panel degrades to a "no preview" placeholder when a file is absent, so a
partially-rendered library still works. These files are gitignored (`*.mp4`)
— they are build artifacts, and they ship inside the installer rather than
the repo.
