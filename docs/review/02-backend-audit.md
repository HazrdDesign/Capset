# Backend audit: transcription timing, audio decode, VAD, performance

Scope: `backend/app/{audio,chunking,tokens,vad,transcribe,jobs,main}.py`,
`backend/app/engines/onnx_asr_engine.py`, `backend/tests/`, plus the panel-side
offset consumer (`panel/js/main.js`, `panel/jsx/capset.jsx`) to close the loop
on where chunk-relative time becomes an AE layer's `inPoint`. Review only, no
files modified. All arithmetic below was executed (not eyeballed) — see the
inline scripts; every synthetic-input claim is reproducible against the
current tree.

All 84 backend tests pass as of this review (`python3 -m pytest -q` → `84
passed`).

---

## CRITICAL

### 1. The shipped VAD (energy gate) can silently drop most of a video's dialogue — a single loud non-speech sound is enough

`backend/app/vad.py:83-98` (`_energy_spans`) is not a rarely-hit fallback. Per
`requirements.txt:20-33` and `vad.py:8-14`, `silero-vad` is **deliberately not
shipped** (it drags in PyTorch). So for every real user, on every job,
`_silero_spans` raises `ModuleNotFoundError`, `detect_speech` (`vad.py:47-59`)
falls into the `except`, and `_energy_spans` is the actual, only VAD that
runs in production. It is not a safety net for an edge case — it *is* the
product's VAD.

Its threshold (`vad.py:96`):

```python
threshold = max(np.percentile(rms, 30) * 2.0, np.max(rms) * 0.05)
```

This has two independent failure modes, and they compound:

**(a) The `P30 × 2` term alone rejects near-continuous speech.** I swept
speech duty-cycle (0.6s speech bursts / silence, `speech_frac` = fraction of
time occupied by speech) with no transient at all:

| speech_frac | actual speech | detected coverage |
|---|---|---|
| 0.9 | 18.0s | **0.0s** (0 spans) |
| 0.7 | 14.1s | **0.0s** (0 spans) |
| 0.5 | 10.2s | 18.5s (6 spans) |
| 0.3 | 6.0s | 9.0s (10 spans) |

Once speech occupies ≳60–70% of the clip — i.e. a talking-head or
voice-over video, arguably the primary use case for a captioning plugin —
the 30th-percentile-of-frame-RMS sits *inside* the speech-loudness
distribution rather than in a silence floor, so doubling it pushes the
threshold above almost all real speech. Result: `voiced` is `False`
everywhere, `_energy_spans` returns `[]`.

This half is **self-correcting**: `detect_speech` only returns `_energy_spans`'s
result `if spans:` (`vad.py:56-57`); an empty list falls through to
`return [(0.0, duration)]` — the whole file becomes one span and every word
still gets transcribed (just without VAD-quality chunk cuts). Confirmed:
`vad.py:61`.

**(b) A single loud non-speech transient converts the safe empty-list case
into a dangerous non-empty, wrong one.** I built 12s of continuous quiet
speech-like signal (RMS ≈ 0.03, ~92% duty cycle — i.e. inside the failure
band from (a)) and added one 30ms loud burst (RMS ≈ 0.9, e.g. a door
close, a camera bump, a knuckle-crack, a stinger sound effect) at t = 6.0s.
Exact arithmetic from the real function:

```
P30(rms)        = 0.02960
max(rms)        = 0.89122   (the 30ms transient)
threshold        = max(P30*2 = 0.05921, max*0.05 = 0.04456) = 0.05921
typical speech frame RMS (excluding the transient) ≈ 0.02997
frames clearing threshold: 1 / 400
```

`_energy_spans(audio, 48000)` → `[(5.85, 6.18)]`. `detect_speech(...)` →
`[(5.85, 6.18)]`. **11.04s of real, continuous speech produces zero
captions; only a 0.33s window around the door-close-like sound is
transcribed at all**, and the job completes normally — no error, no
warning, `state: "done"`. The one non-empty (but almost entirely wrong)
span defeats the `if spans:` safety net from (a), because the mechanism
that made the *whole clip* safe (nothing clears threshold → fall back to
whole-file) is bypassed the moment *anything at all* clears the
(already-too-high) threshold — even something that isn't speech.

Reproduction (paste into `backend/` with the venv active):

```python
from app.vad import _energy_spans
import numpy as np
rate = 48000; n = int(12.0*rate); rng = np.random.default_rng(0)
audio = np.zeros(n, dtype=np.float32)
mask = np.ones(n, dtype=bool)
for gap in np.arange(0.9, 12.0, 1.0):
    s, e = int(gap*rate), int(min(12.0, gap+0.08)*rate); mask[s:e] = False
audio[mask] = rng.normal(0, 0.03, n).astype(np.float32)[mask]
b0 = int(6.0*rate); audio[b0:b0+int(0.03*rate)] = rng.normal(0, 0.9, int(0.03*rate)).astype(np.float32)
print(_energy_spans(audio, rate))   # -> [(5.85, 6.18)]
```

**Why this matters more than a mistiming bug**: the goal states captions
must be accurately timed, but this failure is strictly worse than mistimed
— it's *absent*. A user narrating over B-roll who claps once, sets a coffee
cup down near the mic, or has a single louder word in an otherwise even
delivery can get a caption file that covers 3% of their video with no
indication anything went wrong.

**Root cause is compounded by zero test coverage**: there is no
`test_vad.py` anywhere in `backend/tests/` (confirmed — the directory
contains exactly `test_api.py`, `test_audio.py`, `test_chunking.py`,
`test_entrypoint.py`, `test_headless.py`, `test_requirements.py`,
`test_tokens.py`, `test_transcribe.py`; grepping the whole tree for
`detect_speech(` shows the only real caller is `transcribe.py:58`, and
every test that touches transcription monkeypatches `detect_speech` away
entirely — `test_transcribe.py:52-55`, `test_api.py:29-30`). The actual
math in `_energy_spans`/`_merge_flags` — the code that is the *only* VAD
running for every shipped user — has never been exercised by a single
assertion.

**Suggested direction** (not a fix, just where I'd start): the asymmetry is
the problem — a poorly-calibrated *non-empty* result is trusted completely,
while an empty result is distrusted and safety-netted. A cheap improvement
with no new dependency: if the total detected-speech duration is
suspiciously small relative to file duration (e.g. `<15%` for a file with no
long true-silence stretches, or just: if `voiced.mean()` is very low *and*
`np.ptp(rms)` / `max` shows a single dominant outlier frame), prefer the
whole-file fallback over a suspiciously tiny span set. That doesn't fix the
underlying threshold, but it stops a single transient from being trusted
over 11 seconds of real speech.

---

## IMPORTANT

### 2. 32-bit float / `WAVE_FORMAT_EXTENSIBLE` WAV renders hard-fail, ungracefully, and are untested

`audio.py:56-64` (`_read_wav`) uses the stdlib `wave` module. `wave`'s
`_read_fmt_chunk` only accepts `wFormatTag == 1` (PCM); anything else —
including format 3 (IEEE float, common for "32-bit float" / high-bit-depth
audio output presets) and format `0xFFFE` (`WAVE_FORMAT_EXTENSIBLE`, common
for 24-bit and multichannel WAV from professional tools) — raises
`wave.Error("unknown format: %r")`. Verified directly against this Python:

```
>>> wave.open(<32-bit-float WAV>)
wave.Error: unknown format: 3
```

Nothing in `panel/jsx/capset.jsx:305-317` (`capsetFindAudioTemplate`)
constrains which output-module template gets picked — it matches *any*
template whose name contains `/wav/i`, `/aif/i`, or `/audio/i`
(`capset.jsx:327-335`), including arbitrary user-created templates. A
custom "WAV Audio (32-bit float)" template — a completely ordinary thing for
an audio-conscious AE user to have saved — routes straight into this crash
path.

It's not silent: `jobs.py:94-97` catches `Exception` generically and stores
`f"{type(exc).__name__}: {exc}"` as `job.error`, so the panel gets
`"Error: unknown format: 3"` rather than a hang or a 500. But it is not
wrapped as `AudioError`, so the user sees a raw library message instead of
the friendly, actionable text every other `audio.py` failure path produces
(compare `AudioError("compressed AIFF (...) is not supported — render
uncompressed audio")` at `audio.py:91-94`). `test_audio.py` has no case for
format-tag 3 or 0xFFFE WAV at all — every WAV test (`test_reads_16bit_mono_wav`,
`test_reads_32bit_wav`, etc.) writes through Python's own `wave` module using
`setsampwidth`, which only ever produces PCM.

### 3. `bench.py` cannot run — the tool meant to answer "where is time spent" is broken

`bench.py:27` imports `probe_duration` from `app.audio`:

```python
from app.audio import load_audio, probe_duration  # noqa: E402
```

`app/audio.py` defines no such function (confirmed by grep across the whole
backend — the only occurrences of `probe_duration` in the repository are the
import and the one call site in `bench.py:83`). Any invocation of
`python bench.py <file>` fails immediately with `ImportError`. This is the
script whose own docstring says *"Measure real transcription speed. Run this
before promising anything... Measure; do not design around a guess."* — and
`docs/ARCHITECTURE.md:288` currently asserts "10-minute video transcribes in
~25 seconds" (24x RTF) without any working way to verify it in this repo
today. Not a captioning-correctness bug, but directly relevant to the
performance half of this audit: the throughput numbers driving the "ASR is
not the bottleneck" architecture decision are currently unverifiable
in-repo.

### 4. `test_reads_8bit_wav` cannot catch a broken 8-bit conversion — including a badly inverted one

`test_audio.py:71-76`:

```python
def test_reads_8bit_wav(tmp_path):
    audio, _ = load_audio(write_wav(tmp_path / "8.wav", tone(0.1), width=1))
    assert audio.dtype == np.float32
    assert np.abs(audio).max() < 1.01
    assert np.abs(audio).max() > 0.1, "signal should survive, not flatten"
```

Unlike the 16-bit and 32-bit tests, which assert `np.allclose(audio,
expected, atol=1e-3)` (a real waveform-shape check), this only bounds the
peak amplitude. Every other width's test would fail if the reconstruction
were wrong; this one only fails if the signal is flattened or clipped. I
patched two plausible bugs into the 8-bit path (`audio.py:35`,
`(uint8 - 128.0) / 128.0`) and reran the equivalent of this test's exact
assertions against each:

- **Off-by-one center** (`- 127.0` instead of `- 128.0`, a classic 8-bit
  fencepost): passes both assertions (`max ≈ 1.0`, `>0.1`) while measurably
  failing a `allclose(atol=1e-3)` comparison against the source tone.
- **Signed reinterpret with no `+128` bias** (treat the byte as `int8`
  directly): passes both assertions too, while producing a waveform with
  **correlation −0.78** against the true signal — i.e. substantially
  inverted/aliased, not just imprecise.

So this test would currently pass against a materially broken 8-bit decoder.
(The reason `allclose(atol=1e-3)` isn't used here is legitimate — 8-bit
quantization noise is ~1/128 ≈ 0.0078, wider than that tolerance — but the
fix is a looser `allclose`/correlation check, not no check.) 8-bit PCM is an
unlikely AE output choice in practice, which is why this is IMPORTANT and
not CRITICAL, but per the audit's goal 7 it is a concrete example of a test
that would not fail if the code it names were broken.

---

## MINOR

### 5. AIFF 8-bit samples are read as WAV-style unsigned; AIFF 8-bit PCM is signed

`_pcm_to_float32` (`audio.py:33-35`) hard-codes "8-bit PCM is unsigned,
centred on 128" for every caller, including the AIFF path (`_read_aiff`
calls the same function at `audio.py:121` with no per-format branch for
1-byte width). That comment is correct for WAV/RIFF, but AIFF's SSND sample
data is specified as signed two's-complement PCM at every bit depth,
including 8-bit — unlike WAV. A genuine 8-bit AIFF render would be decoded
with a 128-count DC bias and would come out as noise-like garbage, which
would then likely fail VAD and/or produce nonsense transcription (a
correctness issue if it triggers), not merely a quality one. I did not find
any AE stock or documented custom template producing 8-bit output (16/24-bit
are the practical range), so this is unlikely to be hit in the field, and
there's no test exercising it either way (`test_audio.py`'s only AIFF
fixture writer, `write_aiff` at `test_audio.py:93-101`, always writes
16-bit).

### 6. `plan_chunks` doesn't bound `overlap_s` relative to `max_chunk_s`, allowing runaway chunk counts under misconfiguration

`chunking.py:36-39` only validates `0 <= overlap_s < max_chunk_s`, not
`overlap_s < max_chunk_s / 2`. Both are operator-tunable via
`CAPSET_MAX_CHUNK_S`/`CAPSET_OVERLAP_S` env vars (`config.py:59-60`). I
verified the *correctness* of `merge_chunks` holds even under extreme
overlap (`overlap_s=15` against `max_chunk_s=20`, `step=5`, producing 3-way
overlapping chunks plus a truncated tail chunk on a 47s span) — the
adjacent-pairwise-midpoint design tiles perfectly regardless (48/48 expected
words recovered, no duplicates, no gaps; see the stress test transcript in
the review session). So this is **not a timing bug**. It is, however, an
unbounded-cost footgun: as `overlap_s → max_chunk_s`, `step → 0` and a long
span generates proportionally unbounded chunks (e.g. `step=0.001s` on a
130s span → ~130,000 chunks), each a separate ASR call. Not reachable
through the panel UI today (no exposed setting), only via env var, so
severity is low.

### 7. `config.SAMPLE_RATE` is a live footgun default, currently unused on the real path

`config.py:56` defines `SAMPLE_RATE = 16_000` explicitly documented as "NOT
used for decoding any more." It is still wired as the default parameter of
`detect_speech(audio, sample_rate=SAMPLE_RATE)` (`vad.py:35-37`). The one
production call site, `transcribe.py:58`, always passes the real rate from
`load_audio`, so today this default is dead code, confirmed by grep (the
only two occurrences of `detect_speech(` in `backend/app` are the
definition and that one call). But it's exactly the kind of default that
turns into the "single most consequential bug in a captioning pipeline"
(the module's own docstring, `chunking.py:5-8`) the day someone adds a
second call site (a script, a test, a future feature) and forgets the
explicit rate — VAD span times would then be computed as if every file were
16kHz, silently misplacing every chunk boundary for anything rendered at
44.1/48/96kHz.

### 8. Job-state fields are read/written across threads without the store's lock; a very late `cancel()` can discard a just-completed transcript

`jobs.py`: `JobStore._run` (the worker thread) writes `job.state`,
`job.progress`, `job.stage`, `job.result` (`jobs.py:83-99`) with no lock;
`JobStore.get`/`cancel` (`jobs.py:101-110`) only lock the dict lookup, not
the field reads that follow in `main.py`'s `get_job`/`cancel_job`. Under
CPython's GIL, individual attribute get/set is atomic, so this cannot crash
or corrupt a value — reads just aren't guaranteed to see a fully "coherent"
snapshot (e.g., `progress` updated but `stage` not yet, for one poll). Not a
caption-timing bug. Separately: `_run` (`jobs.py:85-93`) checks
`job._cancel.is_set()` only *after* `work(job)` returns and *before* setting
`state`. If `cancel()` (`jobs.py:105-110`) fires in that narrow window — the
transcription has already fully and successfully completed — the job is
marked `CANCELLED` and the completed `result` is discarded (`to_dict`,
`jobs.py:56-57`, only serializes `result` when `state is DONE`). This
matches the code's evident intent ("Work that honours cancellation returns
early; do not overwrite," `jobs.py:87`) — respecting an explicit cancel over
a result the user said they didn't want — so I'm not calling it a bug, but
it does mean a cancel requested in the last instant of a job silently throws
away a good transcript rather than surfacing it. Worth confirming that's the
intended product behavior.

### 9. Cancellation is only checked between chunks, never mid-chunk

`transcribe.py:66-69` checks `cancelled()` once per loop iteration, before
`slice_audio`/`transcribe_chunk`. A chunk already submitted to the engine
(up to `MAX_CHUNK_S` = 20s of audio) always runs to completion before a
cancel takes effect. Given the documented ~24x realtime throughput, worst
case is under a second of extra latency per chunk — reasonable, and matches
the module's stated design — but worth naming since goal 6 asked
specifically about mid-chunk cancellation.

### 10. `_read_aiff` reads the entire file into memory at once (`path.read_bytes()`, `audio.py:74`), and widening (e.g., 24-bit → 32-bit) doubles the sample buffer again

For very long renders (multi-hour comps) this is a real memory/latency cost;
for the short-to-medium clips a captioning tool is typically used on it's
immaterial. No action needed unless long-form use becomes a stated target.

---

## PERFORMANCE notes (no correctness risk)

- **Where time is actually spent**: per `docs/ARCHITECTURE.md:288` and the
  engine module's own docstring (`onnx_asr_engine.py:1-8`), ASR at ~24x RTF
  is explicitly *not* the bottleneck — the preceding After Effects audio
  render is. I could not independently re-verify the 24x figure here because
  `bench.py` is currently broken (finding 3) and no ONNX model is present in
  this environment; treat the RTF claim as unverified pending a fix to that
  script.
- **Overlap re-transcription cost is real but modest, and shouldn't be cut**:
  with the shipped defaults (`MAX_CHUNK_S=20`, `OVERLAP_S=2`, `chunking.py:21-22`),
  each internal chunk boundary re-transcribes 2s of audio. For an N-chunk
  file the total waste is `(N-1) × 2s`; e.g. a 10-minute, continuously-talky
  video (~34 chunks at the current step of 18s) re-transcribes about 66s out
  of ~666s processed — roughly 10% overhead. That's a correctness feature
  (it's what stops a word being lost or duplicated at a hard chunk cut,
  `chunking.py:18-20`), not waste to remove — goal priority here is
  correctness first, and the merge logic (finding "VERIFIED" section below)
  is provably lossless across that overlap. I would not touch it.
- **Obvious win with no correctness risk**: chunks are transcribed one at a
  time in a Python `for` loop (`transcribe.py:66-80`), each a separate call
  into `self._model.recognize(...)` (`onnx_asr_engine.py:110`). If the
  underlying `onnx_asr` model/ONNX Runtime session supports batched inference
  (common for CTC/RNNT/TDT ONNX exports), batching same-length-padded chunks
  into fewer `recognize` calls would cut per-call Python/session overhead
  without touching the chunk-planning or stitching logic at all — the
  highest-leverage speed change that doesn't touch timing-critical code.
  Worth checking against the installed `onnx_asr` version's API before
  assuming it's free, since `_tokens_from_result` (`onnx_asr_engine.py:172-204`)
  already has to defensively handle multiple result shapes across versions.
- **Single worker thread is the right call, not a bottleneck**: `jobs.py:64-67`
  serializes with `max_workers=1`, justified by the model not being
  guaranteed thread-safe and CPU/GPU contention from real concurrency
  anyway (`jobs.py:1-7`). This is a local, single-user desktop plugin — one
  AE session, one render at a time — so inter-job concurrency isn't the
  lever; intra-job batching (above) is.
- Silero, on a developer machine that happens to have it installed, is
  reloaded from disk via `load_silero_vad(onnx=True)` on *every single job*
  (`vad.py:64-67`, inside `_silero_spans`, no caching/singleton). Irrelevant
  to shipped builds (not a dependency), but worth a one-line note if Silero
  is ever wired in for real per the module's own suggested next step
  (`vad.py:13-14`).

---

## VERIFIED CORRECT

Shown with the arithmetic, not asserted.

### 24-bit PCM sign extension (`_pcm_to_float32`, `audio.py:38-44`)

```python
as_bytes = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
widened = np.zeros((as_bytes.shape[0], 4), dtype=np.uint8)
widened[:, 1:] = as_bytes
samples = widened.view("<i4").flatten().astype(np.float32) / (2 ** 31)
```

For 3 LE bytes `[b0, b1, b2]` (`b2` the sign byte), this places them at
byte-offsets 1,2,3 of a 4-byte little-endian word — i.e. the bit pattern of
the 24-bit two's-complement value `V`, shifted left 8 bits, landing `V`'s own
sign bit exactly at bit 31 of the 32-bit word. That is a textbook correct
sign-extending widen, confirmed numerically:

| 24-bit input | widened int32 | expected (`V×256`) |
|---|---|---|
| `0x7FFFFF` (max positive) | 0.99999988 after `/2^31` | matches `0x7FFFFF/2^23` |
| `0x800000` (min negative, −8388608) | exactly −1.0 | matches `−8388608/2^23 = −1.0` |
| `0xFFFFFF` (−1) | −1.1920929e-07 | matches `−1/2^23` |

Dividing by `2^31` after the ×256 widen is equivalent to dividing the true
24-bit value by `2^23` — the correct normalization for 24-bit signed PCM.
Correct.

### 80-bit IEEE-extended sample-rate decode (`_extended_to_float`, `audio.py:124-132`)

```python
value = sign * mantissa * 2.0 ** (exponent - 16383 - 63)
```

This is the standard 80-bit x87-extended formula (explicit integer bit,
no hidden-bit adjustment, unbiased exponent `e - 16383`, mantissa treated as
a 64-bit integer so an extra `-63` normalizes it to `[1,2)`). Verified with
an independent encoder (not reusing the function under test) round-tripped
through the actual decoder for 8000, 11025, 22050, 32000, 44100, 48000,
88200, 96000, 192000 Hz — every value decoded back exactly. Correct for all
normal (non-denormal) sample rates, which is the entire realistic input
space (AIFF never stores a denormalized sample rate).

### AIFF big-endian → little-endian conversion (`_read_aiff`, `audio.py:108-121`)

- 16/32-bit (`audio.py:110-114`): parses the bytes as big-endian
  (`dtype=">i2"/">i4"`), then `.astype("<i2"/"<i4")` — numpy re-encodes the
  *same numeric value* into little-endian bytes; this is a correct
  byte-order conversion, not a naive byte-reversal (which would be wrong for
  anything but a pure reversal-symmetric format). Confirmed by the passing
  `test_reads_big_endian_aiff` (16-bit round-trip via the real `aifc` module,
  `atol=1e-3`).
- 24-bit (`audio.py:115-119`): reverses each 3-byte group
  (`triples[:, ::-1]`), which for a 3-byte field *is* the correct
  transform from big-endian to little-endian (there's no "parse as a
  number" step needed for a pure byte-order flip at 3 bytes — the two
  operations coincide). Then it's fed through the already-verified 24-bit
  path above.
- `sowt` handling (`audio.py:95, 110, 115`): correctly recognized as "already
  little-endian" and the swap is skipped rather than applied; `NONE`/`twos`
  correctly treated as standard big-endian needing the swap.

### Format sniffing over extension (`load_audio`, `audio.py:141-157`)

Magic bytes (`RIFF`/`FORM`) are checked before falling back to the file
extension — covers AE writing a WAV with a misleading `.aiff` name.
Confirmed by `test_content_is_trusted_over_extension`.

### Chunk planning + overlap-midpoint merge (`chunking.py`)

Exhaustively checked, including beyond what the existing tests cover:

- The default-config regression the module's docstring calls out by name
  (dropped chunk offset → drifting captions) is directly guarded by
  `test_captions_do_not_drift_across_chunks` (`test_chunking.py:102-120`) and
  exercised through the real orchestrator by
  `test_words_land_in_absolute_time_not_chunk_time`
  (`test_transcribe.py:69-81`).
- The overlap-midpoint dedup (`chunking.py:89-104`) is provably correct even
  under conditions well beyond the shipped defaults: I stress-tested it with
  `overlap_s=15, max_chunk_s=20` (step=5) against a 47s span, producing
  three-way-overlapping chunks *and* a truncated final chunk — 48/48 expected
  one-per-second words recovered, zero duplicates, zero gaps. This holds
  because each chunk's kept window is bounded only by its *immediate*
  neighbor's midpoint, and consecutive midpoints are provably spaced by
  exactly `step` regardless of how many chunks physically overlap in audio —
  so the windows always tile the timeline exactly once each, even in
  configurations the shipped defaults never reach.
- Half-open interval convention (`lower <= w.start < upper`,
  `chunking.py:104`) means a word exactly on a midpoint is assigned to the
  *later* chunk and never double-counted — matches the docstring
  (`chunking.py:78-81`) and `test_overlap_boundary_keeps_words_on_both_sides`.
- Final `merged.sort(...)` (`chunking.py:106`) makes output order independent
  of input order, confirmed by `test_merge_sorts_out_of_order_input`.

### End-to-end offset propagation, backend through the AE panel

Traced the full chain goal 1 asks for:

1. `load_audio` returns the *true* file sample rate (`audio.py:56-64`,
   `audio.py:78-121`); `transcribe.py:53-58` passes it straight through to
   `detect_speech` and (per chunk) to `engine.transcribe_chunk` — confirmed
   live by `test_native_sample_rate_is_passed_to_the_engine`
   (`test_transcribe.py:149-171`), which fails loudly if a hardcoded rate is
   ever substituted.
2. Chunk-relative token times → chunk-relative word times
   (`tokens.py:28-81`, tested word-for-word in `test_tokens.py`) → absolute
   time via exactly one `+ chunk.start` (`chunking.py:61-71`, invoked once
   per chunk at `chunking.py:90`).
3. `main.py:91-104` serializes `words[].start/end` as-is (no further
   transform) into the job result.
4. Panel: `main.js:308-326` (`captionsFromTranscription`) takes
   `source.start` — which is `comp.workAreaStart` for an in/out-scoped render
   or `0` for a full-comp render (`capset.jsx:361-364`) — as `offset`, and
   `segmentation.js` groups words into captions using their existing
   absolute-within-render `start`/`end` without adding or subtracting
   anything (confirmed: no `offset` term anywhere in
   `panel/js/lib/segmentation.js`).
5. `capset.jsx:843-844` applies the offset **exactly once**:
   `layer.inPoint = capsetSnap(comp, offset + caption.start)`.
6. `capsetSnap` (`capset.jsx:44-47`) rounds `inPoint` and `outPoint`
   independently to the nearest frame from their own absolute values, so
   frame-snapping error cannot accumulate across captions.

No double-offset, no dropped offset, no unit mismatch found anywhere in this
chain. This is the single highest-consequence path in the product and it
checks out.

### Job orchestration / single-worker serialization

`JobStore` (`jobs.py:63-76`) uses a single-worker `ThreadPoolExecutor`, so
two jobs can never run concurrently and there's no contention over the
(possibly non-thread-safe) model. `_run` checks for a pre-emptive cancel
before ever calling `work()` (`jobs.py:79-82`), so a job cancelled while
still `QUEUED` never starts.

### Token→word BPE merge (`tokens.py`)

Marker-only tokens, unmarked leading tokens, punctuation attachment, and
confidence averaging (including the `None`-confidence case) are all covered
by tests that check exact output values rather than absence of a crash
(`test_tokens.py`, all 12 tests) — these are the good example to contrast
against finding 4.

---

## Summary for the two stated goals

**Accurate timing**: the offset/chunk-stitch arithmetic itself (the thing
the module docstrings worry about by name) is solid and I could not break
it, including under pathological overlap configurations. The one place
timing correctness actually fails in this codebase isn't arithmetic at all —
it's **detection**: the shipped VAD can hand the stitcher a confidently
wrong, non-empty span list, and everything downstream faithfully times
captions for the wrong 3% of the file (finding 1). Fix that before anything
else here.

**Speed**: ASR is credibly not the bottleneck (per the architecture doc), the
overlap tax is small and shouldn't be cut for speed, and the one concrete,
low-risk lever is batching per-chunk `recognize()` calls if the runtime
supports it. Fix `bench.py` (finding 3) before making any further speed
claims or changes — right now there's no working way to measure whether a
change helped.
