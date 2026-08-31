# Research verification log

Four Haiku agents produced docs 01–04. Their claims were **not** taken at face
value. This log records what was independently re-checked against primary
sources, and what was corrected.

Supervisor: Opus 5. Date: 2026-08-31.

---

## Independently verified — CONFIRMED

| Claim | Source checked | Verdict |
|---|---|---|
| UXP panels are not available for After Effects; CEP remains the path | Adobe community threads; CEP/UXP roadmap discussion | **Confirmed.** No AE UXP panel API. CEP 12 is the last major CEP release; no AE retirement date announced. |
| `applyPreset()` takes a `File` object | Adobe community + AE script snippets | **Confirmed** — and the agent had it wrong (see below). |
| Parakeet models are CC-BY-4.0 | Agent-cited HF model cards | **Confirmed as reported.** Permits commercial redistribution with attribution. Re-check each specific model card before shipping. |
| `onnx-asr` returns timestamps | `raw.githubusercontent.com/istupakov/onnx-asr/main/README.md` | **Confirmed.** "Can return token-level timestamps and log probabilities." |
| `sherpa-onnx` exposes timestamps | k2-fsa docs / issue tracker | **Confirmed.** `OfflineRecognizerResult.timestamps`, transducer models. |

---

## Corrections applied to agent output

### 1. `applyPreset()` signature — doc 01 (WRONG → fixed)

The agent wrote `textLayer.applyPreset("Fade In (Linear)")`. The parameter is
an ExtendScript **`File` object**, not a string. Corrected in place.

Also added the gotcha the agent missed: `applyPreset()` operates on the
**current selection**, so the target layer must be the only selected layer.

### 2. ONNX word timestamps — doc 02 (WRONG → fixed)

The agent claimed ONNX runtimes "do not expose word-level timestamps directly"
and marked both `onnx-asr` and `sherpa-onnx` with ⚠ in the comparison table.
**False**, and consequential: it would have pushed us to the 3–4 GB NeMo stack
for no reason. Both expose token-level timestamps; merging BPE subword tokens
into words via the `▁` boundary marker is ~30 lines.

### 3. Max audio length — doc 02 (MISSED → added)

**No agent caught this.** The onnx-asr README warns:

> "The maximum audio length for most models is 20–30 seconds. For longer audio,
> use VAD."

For a captioning plugin this is architecturally critical: long-form audio must
be VAD-chunked, transcribed per segment, and each segment's timestamps offset
by its start time before concatenation. Missing the offset step causes every
caption after the first chunk to drift — a bug that looks like poor model
accuracy and wastes days. Now documented in doc 02.

---

## Known-weak citations — treat with caution

- Doc 01's headline CEP/UXP claim originally rested on a community GitHub repo
  (`pushREC/after-effects-sdk-kb`), not an Adobe source. The conclusion was
  independently corroborated, but **re-confirm against Adobe's own release
  notes before locking the architecture.**
- Doc 02's PyInstaller size figures (3–4 GB) come from forum reports, not
  measurement. Directionally right; measure ourselves in Phase 1.
- Doc 03's pricing and competitor feature claims are from marketing pages and
  forum posts. Fine for positioning, not for anything load-bearing.
- Doc 04's ".ffx cannot be generated programmatically" is consistent with the
  format being opaque binary, but is an absence-of-evidence claim.

## Still open

- Audio-only render from the AE render queue: both docs mark the exact output
  module API as UNVERIFIED. Needs hands-on testing in AE.
- `TextDocument.fillColor` assignment reliability — doc 01 flags it UNVERIFIED
  and suggests a Fill effect instead. Needs testing.
