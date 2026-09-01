# Capset — architecture decisions

Supersedes the original `ae-parakeet-captions/` scaffold where they conflict.
Decisions here are backed by `docs/research/` (see `00-VERIFICATION.md` for
what was independently confirmed vs. agent-reported).

Status: backend and panel implemented (not yet run inside After Effects).
Open questions marked **OPEN**. Last updated 2026-08-31.

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
`maxInFraction` is user-exposed as the 20–50% control requested.

**Easing** is set per keyframe via `setTemporalEaseAtKey` with `KeyframeEase`
(speed + influence), so each animation ships its own curve and the user can
override globally. Marker-driven preset systems cannot offer this.

---

## 4. Animation previews

**Decision: pre-rendered video loops shipped with the plugin.** This is what
Mister Horse and SonDuck do; there is no live-render-to-panel path in CEP.

CEP panels are Chromium, so a `<video muted loop>` grid with play-on-hover
works directly. Preview assets are generated **from the procedural engine
itself** via `aerender`, so adding an animation is: write the JSON → run the
preview render script. No hand-authoring, and previews cannot drift out of
sync with the real animation.

**On Essential Graphics:** the EGP authors `.mogrt` files for *Premiere*. It
is not an in-AE reusable animation library and does not help here.

---

## 5. Packaging and installer

**Decision: Inno Setup `.exe`, mirroring Captioneer's proven shape.**

```
capset-setup.exe (Inno Setup, Windows) / Capset.pkg (macOS, signed + notarized)
├── CEP extension  → <platform CEP extensions dir>\design.hazrd.capset\
│   ├── CSXS/manifest.xml
│   ├── index.html + panel JS
│   ├── jsx/            (ExtendScript: layer generation, animators, rig)
│   ├── animations/     (JSON definitions + preview .mp4 loops)
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

Two routes, and the priority is worth revisiting.

**Direct file read (current default).** When one plain footage layer is
selected, its media file is read straight off disk and decoded with ffmpeg.
Instant, no render.

**AE render (current fallback).** The comp's audio is rendered through the
render queue.

**The fallback is arguably the more correct one.** Reading the raw file gets
the *file's* audio. Rendering from AE gets **what the user actually hears** —
the comp mix, levels, mute states, audio effects, time remapping, nested
comps. A project with two audio layers, or a compressor on the voiceover,
transcribes the wrong thing under the direct read.

Supporting evidence: the project owner recalls Captioneer exporting an
**AIFF** before analysing. AIFF is what After Effects' audio-only output
produces, which suggests Captioneer renders from AE rather than decoding the
source file.

**Why ffmpeg is still bundled either way:** After Effects' audio output
templates vary by version and locale, and the one that is available may be
AIFF rather than WAV. `onnx-asr` reads WAV; it does not promise AIFF. So
ffmpeg earns its place as a converter even when AE does the rendering — and
it is what makes the fast path work on compressed sources.

**OPEN:** make the AE render the primary path once the output-module template
names are verified against a live host. `capsetRenderAudio` already tries
WAV, then AIFF, then Audio Only, then MP3.

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
5. **Model download vs. bundle** — bundling gives a ~400 MB installer and
   offline install; downloading on first run gives a small installer but needs
   network and progress UI. Captioneer appears to bundle.
