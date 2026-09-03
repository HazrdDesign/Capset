# Research: getting audio out of After Effects, and why it is slow

**Date:** September 3, 2026
**Why:** Three of the first four real-After-Effects bugs came from the Render
Queue audio path, and the comparison being made is "Captioneer does this
flawlessly and FAST". This is the record of what the alternatives actually are,
so the question does not get re-argued from memory.

**Confidence is marked per claim.** Nothing here has been tested against a real
host; that is exactly the failure mode this project keeps hitting.

---

## Summary

| Route | Gets the comp mix? | Needs a decoder? | Verdict |
|---|---|---|---|
| Render Queue (current) | Yes | No | Correct, slow, fragile |
| Conformed audio cache (`.cfa`) | **No** | Yes (undocumented) | **Dead end** |
| Read source media directly | No | Yes | Fast, but wrong for mixed comps |
| Adobe Media Encoder | Yes | No | Still a full render |
| C++ AEGP audio suites | Yes | No | Not reachable from CEP |

The honest position: **there is no fast path that is also correct.** Everything
faster than the Render Queue gets you the *source file's* audio rather than
what the composition actually sounds like.

---

## 1. The conformed audio cache is a dead end

After Effects conforms imported audio to `.cfa` files under
`…/Adobe/Common/Media Cache Files/` (Windows: `%APPDATA%`, macOS:
`~/Library/Caches`), controlled by **Media & Disk Cache** preferences.
*(Official Adobe documentation.)*

It looked like the obvious shortcut. It is not, for two independent reasons:

1. **A `.cfa` is per source file, not per composition.** It contains the
   conformed audio of one piece of footage. It carries no layer levels, no
   mute/solo, no audio effects, no time remapping, no nested comps, no mix.
   *(High confidence.)* For a captioning plugin that means a voiceover under a
   music bed comes back mixed exactly as the source file has it, not as the
   comp sounds.
2. **The format is undocumented and there is no parser.** No open-source `.cfa`
   reader exists; reading one means reverse-engineering a proprietary binary.
   *(Community/inference — a forum post suggests the payload may be raw PCM,
   untested.)*

**Do not pursue this.** It fails the correctness requirement before the
engineering cost is even relevant.

## 2. Why the Render Queue path is slow

No published benchmarks for audio-only renders were found. The cost is
inferred: After Effects evaluates the whole composition — every layer, effect,
time remap and nested comp — mixes it, and writes the file, with the UI thread
blocked while it does. *(Inference plus community reports.)*

The important consequence is that this cost is **inherent to getting the comp
mix**. Anything that skips it is skipping the mix.

## 3. What CEP actually allows

CEP panels run in CEF with Node.js available: `require('child_process')` and
`require('fs')` both work, so the panel can spawn a bundled binary and read
arbitrary files. *(High confidence; official CEP resources plus community.)*
Caveats: `cep_node.require()` is needed in some CEP 8+ contexts, absolute paths
are required, and Console APIs do not work on Windows.

This matters because Capset already ships a Python backend. If the panel could
locate the source file, the backend could decode it directly and skip the
Render Queue entirely — which is the most likely explanation for a competitor
being faster. *(Inference, medium confidence — Captioneer is closed source and
its method is not documented.)*

## 4. Locating source media

`app.project.item(n).mainSource.file` and `AVLayer.source.file` give the backing
file; `proxySource.file` and `mainSource.missingFootagePath` cover proxies and
missing footage. *(Official API.)*

**The hard limit:** a layer whose source is a precomp returns a `CompItem`, not
a file. There is no file to read, so the direct-source route simply cannot serve
nested compositions. *(High confidence.)*

## 5. Where this leaves us

The current path is the correct one and should stay the default. A future fast
path is possible but is a **different feature with different semantics**, and
must be presented as such rather than as an optimisation:

> When the selection is a single audio-bearing footage layer with no audio
> effects, no time remapping and full level, the source file's audio is
> identical to the comp mix for that layer — so it can be read directly and
> transcribed without rendering.

That is a real and common case (one voiceover layer), it is cheap to detect
conservatively, and it would fall back to rendering whenever any of those
conditions fails. It is worth doing **only after** the current path is verified
working in a real host: adding a second audio route while the first one is
still unproven would double the surface area of a system that has already
shipped three audio bugs.

---

## Sources

- [After Effects memory and storage (media cache)](https://helpx.adobe.com/after-effects/using/memory-storage1.html)
- [Managing the media cache database](https://helpx.adobe.com/media-encoder/using/media-cache-database.html)
- [Scripting guide: FileSource](https://ae-scripting.docsforadobe.dev/sources/filesource/)
- [Scripting guide: FootageItem](https://ae-scripting.docsforadobe.dev/item/footageitem/)
- [C++ SDK: accessing audio data](https://ae-plugins.docsforadobe.dev/audio/accessing-audio-data/)
- [CEP and Node.js](https://fenomas.com/2014/08/cep-5-node-js-en/)
- [Adobe-CEP samples](https://github.com/Adobe-CEP/Samples)
- [Captioneer documentation](https://docs.captioneer.com/after-effects/after-effects-plugin)
