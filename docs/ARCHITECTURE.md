# Capset — architecture decisions

Supersedes the original `ae-parakeet-captions/` scaffold where they conflict.
Decisions here are backed by `docs/research/` (see `00-VERIFICATION.md` for
what was independently confirmed vs. agent-reported).

Status: backend and panel implemented; running inside After Effects.
Open questions marked **OPEN**. Last updated 2026-09-09.

---

## 1. Host integration: CEP

**Decision: CEP panel + ExtendScript. Not UXP.**

There is no UXP panel API for After Effects. CEP 11/12 is the only path, and
CEP 12 is the last major CEP release (no AE retirement date announced).
Independently confirmed, and corroborated by the Captioneer teardown — a
shipping competitor uses CEP with 2026–2020 host compatibility.

**Scaffold changes required:** every reference to a "UXP panel" becomes
"CEP panel". `.zxp` was the correct instinct and stays.

---

## 2. ASR engine: Parakeet via ONNX, CPU and GPU paths

**Decision: ONNX runtime is the primary path, not a fallback. No NeMo, no
PyTorch, no CUDA toolkit dependency.**

The scaffold treats PyInstaller + NeMo + PyTorch + CUDA as the main route and
ONNX as a contingency, while also (correctly) flagging that route as the
project's highest risk. Captioneer ships **Parakeet** in a ~400 MB installer
with no Python runtime — an existence proof that Parakeet in a native runtime
is the right target rather than a gamble.

**Capset is Parakeet-first.** Whisper is not planned as a fallback: Parakeet
beats it on both accuracy and speed. The engine interface below keeps a second
engine possible without designing for one now.

Three corrections to the scaffold:

**2.1 — "GPU required; NVIDIA Parakeet models are CUDA-based" is wrong.**
Parakeet runs on CPU via ONNX Runtime. Requiring an NVIDIA GPU would exclude
every Mac user and most laptops. Ship both paths, as Captioneer does
(`windows\gpu\` implies a sibling `windows\cpu\`).

**2.2 — `MODEL_NAME = "nvidia/parakeet-tdt-1.1b"` is the wrong checkpoint.**
The 1.1B model is ~4.5 GB. **parakeet-tdt-0.6b-v2** (English) or **v3**
(multilingual) is ~2.5 GB full precision and materially smaller quantized,
while scoring *better* on the Open ASR Leaderboard (6.05% WER for v2).

**2.3a — The VAD package is a PyTorch trap.** `silero-vad` on PyPI looks like
a small ONNX VAD, but hard-depends on `torch>=1.12` **and**
`torchaudio>=0.12` — base requirements, not extras. Adding it drags all of
PyTorch into the bundle and takes the installer from ~400 MB to 3–4 GB, which
is the exact outcome this whole section exists to avoid. It is deliberately
**not** in `requirements.txt`; `app/vad.py` imports it lazily and degrades to
an energy gate. `tests/test_requirements.py` enforces the budget.

**2.3 — Audio longer than 20–30s must be VAD-chunked.** Most Parakeet models
cap out there. Long-form requires: VAD segment → transcribe each → **offset
each segment's timestamps by its start time** → concatenate. Skipping the
offset makes every caption after the first chunk drift, which presents as bad
model accuracy. `onnx-asr` has built-in VAD long-form support.

### Engine choice

| | `onnx-asr` (Python) | `sherpa-onnx` (C++) |
|---|---|---|
| Installer size | ~500–600 MB | **~400 MB** (matches Captioneer) |
| Dev velocity | **High** — pure Python | Lower — native build/bind |
| Long-form VAD | **Built in** | Hand-rolled |
| Timestamps | token-level, `.with_timestamps()` | token-level, `OfflineRecognizerResult.timestamps` |

**Decision: build behind a swappable `AsrEngine` interface. Prototype on
`onnx-asr`; ship on whichever measures better.** The existing schema already
isolates this cleanly — the panel never learns which engine ran.

Both return **token-level** timestamps. Parakeet uses BPE, so words are
reassembled by merging on the `▁` (U+2581) word-boundary marker. ~30 lines.

**OPEN — must be measured in Phase 1:** CPU transcription speed. Research
cited an unverified RTFx of 1.38 on CPU, which if accurate means a 10-minute
video takes ~7 minutes. That is the single number that decides whether the
CPU path is a real product or just a fallback. Measure before committing.

---

## 3. Animation engine: procedural text animators

**Decision: generate AE text animators procedurally. `.ffx` import is a
secondary escape hatch, not the engine.**

Three reasons, in order of weight:

**3.1 — Baked keyframes cannot adapt to caption duration.** A word-by-word
layer may live 0.3s; a phrase 2.5s. `.ffx` stores fixed keyframes with no
time-offset control, so a preset tuned for one duration resolves far too late
on the other. This is exactly the Mister Horse failure mode described by the
project owner, and it is intrinsic to marker/keyframe-driven presets.

**3.2 — Clean replacement.** Removing an applied `.ffx` means reverse-engineering
whatever it added. Animators generated under a known prefix
(`Capset__PopIn`) can be torn down and rebuilt precisely — which is what makes
"replace animation on selected / on all" reliable rather than fragile.

**3.3 — `.ffx` cannot be generated programmatically.** It is opaque binary.
Every animation in the library would have to be hand-authored in AE and saved.
Procedural animations ship as JSON.

### Duration-adaptive timing (the differentiator)

Every animation declares its in/out phases as a **fraction of layer duration**,
clamped to absolute bounds:

```
inDur  = clamp(layerDur * inFraction,  minIn,  maxIn)
outDur = clamp(layerDur * outFraction, minOut, maxOut)

# hard guarantee: the in-animation always resolves early
inDur  = min(inDur, layerDur * maxInFraction)   # e.g. 0.5

# collision guard for very short words
if inDur + outDur > layerDur * 0.9:
    scale = (layerDur * 0.9) / (inDur + outDur)
    inDur *= scale; outDur *= scale
```

With `inFraction=0.25, minIn=0.10, maxIn=0.45, maxInFraction=0.5`:

| Layer duration | in-animation | resolves at |
|---|---|---|
| 0.30s (one short word) | 0.10s | 33% |
| 0.60s (one word) | 0.15s | 25% |
| 2.50s (phrase) | 0.45s | 18% |

Always inside the first half, never "resolving way too late" on short words.

**Corrected after first real use.** The fraction model is now the `Auto` option
rather than the only one, because scaling every animation to its caption has a
cost that was not obvious until captions were on a timeline: the same preset
runs for a different length on every caption, so it never has a consistent
feel. Word Pop ran for 0.105s, 0.180s and 0.220s on captions of 0.35s, 0.6s and
1.2s. A length set in **frames or seconds** now applies identically everywhere,
and the clamps above still apply to it — an explicit length is shortened on a
caption too short to hold it, which is the guarantee this model existed to
provide.

`maxInFraction` was exposed as a 20–50% "resolve within" slider and **it did
nothing**. It is a cap, not a length, and `inMax` bound first on almost
everything: on any caption of 1.2s or longer the slider produced an identical
duration at every position. It survives as an explicit cap alongside the length
control; `panel/tests/timing.test.js` pins the old inert behaviour so the
replacement cannot regress into it.

**Easing** is set per keyframe via `setTemporalEaseAtKey` with `KeyframeEase`
(speed + influence), so each animation ships its own curve and the user can
override globally. Marker-driven preset systems cannot offer this.

### How a range selector actually works

The single most important fact about this system, and its absence from these
docs is why the animations shipped not working at all.

A range selector **does not delay an animation per character**. It scales *how
much of the animator reaches each character*. Adobe's wording:

> At 0%, the animator properties do not affect the characters.

So an animator whose selector covers nothing has **no effect whatsoever**,
regardless of what its property keyframes say. Getting the sweep backwards does
not produce a worse animation; it produces no animation.

`capsetAddPhase` originally swept the selector's **Offset** from -100 to +100
with Start/End at their 0/100 defaults. That covers nothing at -100, everything
at 0, and nothing again at +100 — so influence went **0% → 100% → 0%** and every
character sat at its natural pose at *both ends* of every phase. Scale
entrances never started small; opacity entrances never faded in. Every keyframe
was real and nothing read them.

The correct construction, and what is in the code now: leave End at 100 and
animate **Start from 0 to 100**. At Start=0 the range covers the whole text and
every unit sits in the animator's pose; as Start travels to 100 the range's
leading edge crosses the text and units resolve to their natural pose one after
another. That edge *is* the stagger. Exits run the same sweep backwards, so
they end in their pose rather than starting there.

Word Pop on the four characters of "word", before and after:

| t | before | after |
|---|---|---|
| 0.00 | 100% / 100% | **58% / 0%** — the from-pose, which never appeared |
| 0.10 | 100% / 100% | 100% / 100% (first character resolved) |
| 0.30 | 100% / 100% | 105% / 75% (last character mid-punch, overshoot reading) |
| 0.40 | 100% / 100% | 100% / 100% |

**Why the tests did not catch it.** `panel/tests/fake-ae.js` modelled a range
selector as a bag with a couple of properties and no semantics, so every
animation test could assert only that an animator had been *created* carrying
certain keyframes — never that the resulting motion was the motion intended.
`panel/tests/ae-text-animator.js` now models the evaluation (per-unit coverage
blended against the natural pose) and the animation tests assert motion.

**The Animate tab was removed from the panel (2026-09).** Not the animator
code — `capsetApplyAnimation`, `capsetAddPhase`, `capsetSpringKeys` and
`capsetRemoveAnimators` are still in `capset.jsx`, still tested against the
range-selector model in `panel/tests/ae-text-animator.js`, and are what any
replacement writes into. What went is the *library and its UI*: 14 presets
assembled from the same in/out phase primitives, which is why several of them
read as the same animation under different names, and a preview grid that
approximated the engine closely enough to be believed rather than checked.

The library, the preview engine, the preset store and the tuning bench live
in `panel/dormant/animation/` with their tests still running. The direction
they are kept for is **capture rather than authoring**: animate a layer by
hand in After Effects and read its animators back into a definition, the way
`capsetCaptureStyle` already does for type. That inverts the problem the
preview grid was solving — a card naming an animation the user built
themselves does not have to sell it to them.

**Known limitation, not yet addressed.** Because the animator's property values
are themselves keyframed, characters the selector edge has not reached yet
drift together rather than holding the from-pose until their turn. The classic
construction holds property values static and lets the selector do all the
work, which punches harder but leaves nowhere to put an overshoot keyframe.
That is a tuning decision for the library, not a correctness one.

---

## 4. Animation previews

**Decision: the panel animates the previews itself, from the same JSON the
host script applies.** See `panel/js/lib/preview.js`.

The original decision here was pre-rendered video loops, the way Mister Horse
and SonDuck do it, generated from the procedural engine via a render script.
It was reversed after the fact that killed it turned up in review: the loops
could only be produced by running a script inside After Effects, `*.mp4` is
gitignored, and no build step produced them — so every shipped card read "no
preview". A preview that exists only if someone remembers to render it is not
a preview, and a manual render step before every release is a step that will
eventually be skipped.

CEP panels are Chromium, so sampling the definitions and driving DOM elements
costs no build step, no assets and no download, and the preview cannot drift
from the animation because it reads the same data. One `requestAnimationFrame`
loop serves the whole grid and stops when nothing is hovered or selected, so
an idle panel costs nothing.

It is an approximation and is documented as one: keyframe influence becomes a
cubic bezier, the range selector's sweep becomes a fixed stagger, and the text
is the panel's font. It conveys punch, overshoot, direction, colour and
stagger — what someone picking from a grid is actually choosing between.

**Superseded (2026-09).** The reasoning above is sound and the previews did
work — but they were solving the wrong problem. An approximation is what you
need when someone is choosing between animations they have never seen; it is
not what you need when the animations themselves are the weak part. Live
previews of a library that under-delivers make the library look better than it
is, which is the opposite of useful. See the note in §3: the code is dormant,
not deleted, and the next step is capturing hand-built animations instead of
approximating hand-written ones.

**On Essential Graphics:** the EGP authors `.mogrt` files for *Premiere*. It
is not an in-AE reusable animation library and does not help here.

---

## 4a. Caption placement and pacing

**Decision: one position, two pacing modes.**

**Position is not a user setting.** Captions are centred at 85% of comp
height. There was a "Keep inside title-safe" checkbox choosing between 80%
and 88%, and it was incoherent: title-safe is a property of the whole text
*block*, and the block's size comes from the user's Character panel settings —
which the panel deliberately inherits and therefore does not know. Moving an
anchor point cannot keep type of an unknown size inside a safe area, so the
control promised something it had no way to deliver. 85% is the subtitle band
itself: below the action on 16:9, clear of platform UI on 9:16, clear of the
frame edge on both. `style.positionY` still overrides it, because Sync Style
sends a captured position and must not be fought.

**Layer names are the caption text; the comment field is the identity.**
Captions were named `Capset__cap_1`, `Capset__cap_2` — serial numbers on
layers whose entire content is a line of prose, in a timeline where reading
the transcript down the layer stack is exactly what a person wants. The name
is now the caption's own text (newlines flattened to spaces, since a layer
name is one line). Recognition moved to a tag written into each layer's
`comment` (`CAPSET_TAG`), which is invisible unless the Comment column is
shown and survives the user renaming a layer — which they can now reasonably
do. `capsetIsCapsetLayer` still accepts the old name prefix, because every
project already built has captions carrying it and nothing else.

One consequence, worth naming because it is the sort of thing that bites
later: layer names are no longer unique. Two captions reading "Yeah." share a
name, so anything keyed by name had to move to the layer index —
`capsetCaptionLayerTimes`/`capsetReplaceAnimation`, and the selection that
Sync Style borrows and puts back.

**Two pacing modes are offered, not seven.** `segmentation.js` implements
fixed-count (one/two/three), rhythm (phrase/smart/parts) and sentence modes,
and they all still resolve — a project saved by an older version can name one.
The panel offers **Smart** and **Word-by-Word**. Three words per caption was
dropped because there is no editorial reason to reach for it: it is neither
the punchy social rhythm nor a break the speaker actually made.

**A word held for six seconds (fixed 2026-09).** Smart occasionally stranded
the last word of a sentence on its own layer and left it on screen for
seconds. The cause was in the backend, not the grouping: Parakeet reports only
a *start* time per token, and the last token of a chunk was given the chunk's
own duration as its end. Chunks come from VAD speech spans and the energy gate
holds a span open through background music, so the final word inherited the
whole music tail — and the phrase grouper, seeing a caption whose span blew
the duration budget, closed the caption before it and left it alone. The
chunk's duration is an upper bound on that token, not a measurement of it;
`_MAX_FINAL_TOKEN_S` now caps it.

---

## 4b. SRT export

**Decision: export from the timeline, not from the transcript, and write
beside the project file.**

The captions the user wants in an SRT are the ones on their timeline, which
by then may differ from what came back from the model: a retimed layer, a
fixed typo, a deleted caption. Exporting a remembered transcript would
quietly disagree with what they can see, so `capsetCaptionsForExport` reads
the caption layers themselves, descending into a Capset precomp and shifting
its times by the precomp layer's `startTime`.

Formatting lives in `panel/js/lib/srt.js` beside the parser, not in
ExtendScript: timecode arithmetic is worth testing, and After Effects is the
hardest place to run a test. The host reads the layers and writes the file;
the panel turns one into the other. Milliseconds are **rounded** — AE reports
times derived from frames, so an in-point at exactly 2s arrives as
1.9999999999999998 and a truncating formatter writes 00:00:01,999.

The file goes in a `Capset SRT` folder beside the saved project. It needs no
dialog, and it is the one folder the user already thinks of as this job's.
An unsaved project has no such folder; that is refused with the reason rather
than falling back to somewhere they will never look.

---

## 5. Packaging and installer

**Decision: Inno Setup `.exe`, mirroring Captioneer's proven shape.**

```
capset-setup.exe (Inno Setup, Windows) / Capset.pkg (macOS, signed + notarized)
├── CEP extension  → <platform CEP extensions dir>\design.hazrd.capset\
│   ├── CSXS/manifest.xml
│   ├── index.html + panel JS
│   ├── jsx/            (ExtendScript: layer generation, animators, rig)
│   ├── animations/     (JSON definitions; previews render live in the panel)
│   └── assets/lib/asr/{windows,macos}/{cpu,gpu}/   ← Captioneer's layout
├── model weights     (Parakeet ONNX, quantized)
└── ffmpeg.exe        (audio extraction from video; LGPL — attribute)
```

Notes:

- A signed `.zxp` is **not required** when an installer copies the folder
  directly. Still worth producing for a manual-install path; sign with
  `ZXPSignCmd` (self-signed is accepted).
- The extension-manager screenshot only *lists* installed extensions — the
  `.exe` did the installing.
- **Licensing:** Parakeet is CC-BY-4.0 (commercial redistribution permitted
  with attribution); ffmpeg is LGPL. Both need EULA attribution. Re-confirm
  the specific model card before shipping.

---

## 5a. Getting audio out of After Effects

**Decision: After Effects renders the audio. Capset ships no media decoder.**

Earlier drafts hedged between reading the source file with ffmpeg and
rendering from AE. Doing both was the wrong answer — two code paths, and a
~100 MB dependency carried for the weaker one.

**Why rendering wins:**

- **It is the correct audio.** Reading a footage file gets that file's audio.
  Rendering gets what the user actually *hears*: comp mix, levels, solo and
  mute states, audio effects, time remapping, nested comps. A project with
  two audio layers, or a compressor on the voiceover, transcribes the wrong
  thing under a direct read.
- **No decoder to bundle.** AE writes uncompressed PCM. `onnx-asr` reads WAV
  natively, which is exactly why it advertises "no need for FFmpeg". Dropping
  ffmpeg removes ~100 MB from the installer and an LGPL obligation.
- **One code path.** No branching on whether the selection happens to be a
  single plain file.

Supporting evidence: the project owner recalls Captioneer exporting an
**AIFF** before analysing. AIFF is what After Effects' audio-only output
produces, which suggests Captioneer renders from AE too.

### How the two risks are handled

**A template must be used; the format cannot be set directly.** The output
module's `Format` property is **read-only to scripting** — `setSettings()`
rejects it with *"Invalid Value for key: `<Format>`. Property is read-only"* —
so `applyTemplate()` is the only programmatic way to change what AE writes.
Setting the output filename's extension does not change the format.

Template names are therefore searched rather than guessed, since they vary by
version and locale: `capsetRenderAudio` enumerates `outputModule.templates`
and matches WAV, then AIFF, then anything containing "audio".

**AIFF is a likely outcome, not an edge case.** After Effects' stock output
module templates include **"AIFF 48kHz"**, and WAV may not be present at all
on a given install. This lines up with the project owner recalling Captioneer
exporting an AIFF. `app/audio.py` reads both formats directly —
**do not "simplify" the AIFF reader away.**
Both are simple uncompressed IFF-style containers, so the reader is ~150
lines of pure Python and numpy with no dependency. Notably it does **not**
use the stdlib `aifc`, which was removed in Python 3.13 and would break the
build on a newer interpreter.

Audio is passed at its **native rate** (AE typically renders 48 kHz);
onnx-asr resamples with its own bundled ONNX resamplers. Claiming 16 kHz for
48 kHz audio would make every timestamp three times too large, so a test
asserts the real rate reaches the engine.

**Cost:** rendering is slower than reading a file, and the render queue is
briefly used. Correctness and one less bundled dependency are worth it.

---

## 6. Cross-platform: Windows and macOS

**Decision: both. The panel is portable; the ASR runtime and installer are
not.**

CEP itself is cross-platform, so the panel, ExtendScript, and animation engine
are write-once. Three things do not carry over:

**6.1 — The GPU path is entirely different.** `cublas64_12.dll` is CUDA, which
is NVIDIA-only, and a `.dll` is Windows-only by definition. Apple Silicon has
no CUDA at all. macOS acceleration means CoreML / Metal / the Neural Engine
instead, which is a different execution provider and a different binary.

This likely explains Captioneer's `windows\gpu\` namespace: the directory is
platform-scoped because the accelerated builds *must* be.

**6.2 — Two installers.** Inno Setup is Windows-only. macOS needs a signed
`.pkg` or `.dmg`, plus **notarization** — without it Gatekeeper blocks a
downloaded installer. That requires a paid Apple Developer account and is a
real, recurring cost line, not a build flag.

**6.3 — CEP install paths differ**, so the installer needs per-platform target
directories.

**6.4 — macOS engine: `onnx-asr` + CoreML EP. Same engine as Windows.**

Parakeet runs well on Apple Silicon three ways:

| Option | RTF | Cross-platform? |
|---|---|---|
| `onnx-asr` + CoreML EP | ~24–32x | **Yes — same code as Windows** |
| `parakeet-mlx` | ~20–68x (sources disagree) | No — macOS only |
| `sherpa-onnx` | ~16x | Yes |

`parakeet-mlx` is likely fastest and does support word-level timestamps
(`AlignedToken`). It is still **not** the right choice: it is macOS-only, so
adopting it means a second ASR implementation, second set of bugs, second test
matrix — for speed we do not need.

At 24x RTF a 10-minute video transcribes in ~25 seconds, well under the AE
audio render that precedes it. **ASR is not the bottleneck**, so a second
codebase buys nothing. `parakeet-mlx` stays behind the `AsrEngine` interface
as a later optimization if Mac users ever ask for it.

**6.5 — Confirmed macOS facts**

- After Effects 24.0+ runs natively on Apple Silicon, and **CEP extensions are
  fully supported natively** — no Rosetta.
- CEP paths: `/Library/Application Support/Adobe/CEP/extensions` (system) and
  `~/Library/Application Support/Adobe/CEP/extensions` (user).
- Debug mode: `defaults write com.adobe.CSXS.<n> PlayerDebugMode 1` — `<n>` is
  CEP-version-specific, so supporting AE 2020–2026 may need several keys.
- **Ad-hoc signing is a hard build requirement, independent of certificates.**
  On Apple Silicon the OS refuses to execute *any* unsigned arm64 binary —
  SIGKILL, not a warning, and it cannot be bypassed. Every native ASR binary
  we ship must carry at least an ad-hoc signature (`codesign -s -`). This is
  free and needs no Apple account, but skipping it means the Mac build simply
  does not run. Distinct from notarization below.
- Notarization is **mandatory for a warning-free install**; there is no exemption for free software.
  Sign → `xcrun notarytool` → staple. Apple Developer Program is **$99/year,
  recurring**.
- No single tool builds both installers. Two pipelines: Inno Setup (Windows),
  `pkgbuild`/`productbuild` (macOS).
- Ship universal (arm64 + x86_64) for now; arm64-only becomes reasonable once
  Intel Mac support ends.

---

## 7. Backend API changes

The existing `docs/schema.md` word-list contract is **good** and should be
kept — flat words out, segmentation on the panel side, is the right split.
Two gaps:

**7.1 — Synchronous `POST /transcribe` will hang the panel.** A 10-minute
video may take minutes. Needs a job model: `POST /jobs` → `202` + job id;
`GET /jobs/{id}` → `{state, progress, result}`. Progress is naturally
available from VAD chunk counts.

**7.2 — `@app.on_event("startup")` is deprecated** in current FastAPI; use a
`lifespan` context manager.

---

## Open questions

1. **CPU transcription speed** — still unmeasured. `backend/bench.py` exists
   to answer it; run it on real hardware before the CPU path is promised. (§2)
2. ~~Repository layout~~ — **done.** Flattened to `backend/`, `panel/`,
   `installer/`, `docs/`.
3. ~~macOS ASR runtime~~ — **decided:** `onnx-asr` + CoreML EP, shared with
   Windows (§6.4). Notarization cost confirmed at $99/yr recurring.
4. **Ship signed or unsigned for v1?** Unsigned installs on both platforms —
   Windows shows SmartScreen ("More info" → "Run anyway"), macOS requires
   System Settings → Privacy & Security → Open Anyway. Both passable. The
   real risk is Windows AV false positives, which PyInstaller binaries attract
   and which can quarantine silently rather than prompt. Certs total roughly
   $165–250/yr (OV + Apple). Reasonable to ship v1 unsigned and add certs once
   revenue justifies.
5. **Model download vs. bundle** — *resolved: bundled.* Downloading gives a
   small installer but needs network, progress UI, and a third-party account
   that stays public under the same repository name — a dependency on someone
   else's hosting decisions for a plugin that is otherwise entirely local.
   Bundling costs a ~1 GB installer and re-ships the weights on every update.
   The installer lays them beside the executable, where
   `app/config._bundled_model_dir()` finds them; a source checkout finds
   nothing there and falls back to the Hugging Face cache. Captioneer appears
   to bundle too.
