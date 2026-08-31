# Capset — architecture decisions

Supersedes the original `ae-parakeet-captions/` scaffold where they conflict.
Decisions here are backed by `docs/research/` (see `00-VERIFICATION.md` for
what was independently confirmed vs. agent-reported).

Status: proposed, 2026-08-31. Open questions marked **OPEN**.

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
project's highest risk. The teardown shows Captioneer ships a ~400 MB
installer precisely because it never took that route.

Three corrections to the scaffold:

**2.1 — "GPU required; NVIDIA Parakeet models are CUDA-based" is wrong.**
Parakeet runs on CPU via ONNX Runtime. Requiring an NVIDIA GPU would exclude
every Mac user and most laptops. Ship both paths, as Captioneer does
(`windows\gpu\` implies a sibling `windows\cpu\`).

**2.2 — `MODEL_NAME = "nvidia/parakeet-tdt-1.1b"` is the wrong checkpoint.**
The 1.1B model is ~4.5 GB. **parakeet-tdt-0.6b-v2** (English) or **v3**
(multilingual) is ~2.5 GB full precision and materially smaller quantized,
while scoring *better* on the Open ASR Leaderboard (6.05% WER for v2).

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
capset-setup.exe  (Inno Setup)
├── CEP extension  → C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\design.hazrd.capset\
│   ├── CSXS/manifest.xml
│   ├── index.html + panel JS
│   ├── jsx/            (ExtendScript: layer generation, animators, rig)
│   ├── animations/     (JSON definitions + preview .mp4 loops)
│   └── assets/lib/asr/windows/{cpu,gpu}/   ← Captioneer's layout
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

## 6. Backend API changes

The existing `docs/schema.md` word-list contract is **good** and should be
kept — flat words out, segmentation on the panel side, is the right split.
Two gaps:

**6.1 — Synchronous `POST /transcribe` will hang the panel.** A 10-minute
video may take minutes. Needs a job model: `POST /jobs` → `202` + job id;
`GET /jobs/{id}` → `{state, progress, result}`. Progress is naturally
available from VAD chunk counts.

**6.2 — `@app.on_event("startup")` is deprecated** in current FastAPI; use a
`lifespan` context manager.

---

## Open questions

1. **CPU transcription speed** — measure before the CPU path is promised. (§2)
2. **Repository layout** — `ae-parakeet-captions/` predates the Capset name
   and the CEP decision. Proposed: flatten to `backend/`, `panel/`,
   `installer/`, `docs/`. Not done unilaterally.
3. **Model download vs. bundle** — bundling gives a ~400 MB installer and
   offline install; downloading on first run gives a small installer but needs
   network and progress UI. Captioneer appears to bundle.
