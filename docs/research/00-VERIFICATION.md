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

### 4. parakeet-mlx timestamps — docs 02 vs 06 conflicted (RESOLVED)

Doc 02's table said parakeet-mlx timestamps were "⚠ Not implemented"; doc 06
said "✅ Yes". Checked the primary source
(`raw.githubusercontent.com/senstella/parakeet-mlx/master/README.md` — note
the default branch is `master`, not `main`):

> "Enable word-level timestamps in SRT/VTT outputs"
> "`AlignedToken`: Word/token-level alignments with precise timestamps"

**Doc 06 is right; doc 02 was wrong.** Corrected.

### Caveats on doc 06

- **Speed figures are internally inconsistent.** Its summary table says
  parakeet-mlx is "20–30x" RTF, its benchmark table says "~68x" on M3, and
  the agent's own summary said 68x. Treat all as order-of-magnitude only.
- **"$99/year ... one-time cost"** — the agent wrote both. Apple Developer
  Program is **$99/year, recurring**.
- **`com.adobe.CSXS.11`** is CEP-version-specific. Supporting AE 2020–2026
  spans several CSXS versions, so debug mode may need a key per version.

### 5. EV vs OV code signing — CONFIRMED (doc 07)

Doc 07 claims EV certificates no longer grant instant SmartScreen bypass, and
recommends the cheaper OV cert. This is the single most expensive decision in
that document (~$250/yr difference), so it was checked independently.

**Confirmed.** Microsoft removed EV's instant-reputation behavior in 2024;
EV-signed files now build SmartScreen reputation per file hash exactly as
OV-signed files do. The change was made because malware operators were
acquiring EV certs through shell companies specifically to inherit that
instant trust. EV retains verified-publisher display and remains required for
kernel-mode drivers — neither relevant to a CEP plugin.

**Buy OV.** EV is not worth the premium here.

### Caveats on doc 07

- **"~15,000 downloads to build reputation" is not credible as stated.**
  Microsoft does not publish a threshold, and reputation accrues per file hash
  with no public formula. Treat as folklore, not a number to plan against.
- The document ends with "UNVERIFIED items: None", which is itself an
  overconfidence signal — every prior agent found things it could not source.
  Its Gumroad fee and file-size figures are agent-reported from Gumroad's help
  pages; re-check at launch, since store terms change.

## Still open

- Audio-only render from the AE render queue: both docs mark the exact output
  module API as UNVERIFIED. Needs hands-on testing in AE.
- `TextDocument.fillColor` assignment reliability — doc 01 flags it UNVERIFIED
  and suggests a Fill effect instead. Needs testing.
