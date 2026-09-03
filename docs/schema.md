# Backend API contract

The contract between the local transcription service and the Capset CEP
panel. Keep it stable: the panel's segmentation logic (word / phrase / smart)
is built against this shape.

Base URL: `http://127.0.0.1:8756` (see the port caveat in `backend/app/config.py`).

## Why jobs rather than one call

Transcription of real footage takes long enough that a synchronous
`POST /transcribe` would hang the panel with no progress and no way to
cancel. Work is submitted, then polled.

---

## `GET /health`

```json
{
  "status": "ok",
  "model_loaded": true,
  "engine": {
    "engine": "onnx-asr",
    "model": "nemo-parakeet-tdt-0.6b-v3",
    "quantization": "int8",
    "providers": ["CoreMLExecutionProvider", "CPUExecutionProvider"],
    "loaded": true
  }
}
```

If the model fails to load the service still answers, with
`"status": "degraded"`, `"model_loaded": false`, and an `"error"` string. The
panel should show that message rather than a generic failure — a silent
"not ready" forever is the worst outcome.

Poll this before submitting. `model_loaded: false` with `status: "ok"` means
the model is still loading; show a starting-up state.

---

## `POST /jobs`

Multipart upload, field name `file`. Returns **202**:

```json
{ "id": "3f1a...", "state": "queued" }
```

**503** if the model is not loaded; `detail` carries the reason.

---

## `GET /jobs/{id}`

```json
{
  "id": "3f1a...",
  "state": "running",
  "progress": 0.42,
  "stage": "transcribing 4/9",
  "created_at": 1756612345.12,
  "finished_at": null
}
```

`state` is one of `queued`, `running`, `done`, `error`, `cancelled`.
`progress` is 0.0–1.0 and never decreases. `stage` is display text.

On `done`, a `result` field is present:

```json
{
  "duration_sec": 12.34,
  "full_text": "hello world",
  "diagnostics": {
    "duration_sec": 12.34,
    "sample_rate": 16000,
    "peak": 0.63,
    "rms": 0.08,
    "speech_spans": 3,
    "chunks": 1
  },
  "words": [
    { "text": "hello", "start": 0.12, "end": 0.48, "confidence": 0.98 },
    { "text": "world", "start": 0.52, "end": 0.91, "confidence": 0.95 }
  ]
}
```

On `error`, an `error` field carries the message.

### About `diagnostics`

What the backend measured about the audio it was given. Present on every
successful result and may be `null` only if it could not be computed.

It exists for the case where `words` is empty. "0 words" is indistinguishable
from a silent render, a mis-selected layer and a genuine absence of speech, and
a real user lost an evening to that ambiguity — the panel reported a successful
transcription of nothing after After Effects handed it a silent WAV. `peak` and
`rms` are 0–1 amplitudes; `speech_spans` and `chunks` say how the audio was
divided up before the model saw it.

Audio that is *entirely* silent never reaches this shape: it fails the job with
an explanatory error instead, because it is a problem the user can fix rather
than a transcription result.

**404** for an unknown id. Finished jobs are retained for one hour, then
dropped.

### About `words`

- Flat, ordered, word-level. Sentence/line/smart grouping is **not** done
  here — segmentation is a user setting, not a transcription concern, so it
  belongs to the panel.
- `start` / `end` are seconds, float, **absolute within the submitted file**.
  The engine returns chunk-relative times; the backend shifts them back
  before they reach this API. The panel still has to offset against wherever
  the work area starts in the comp.
- `confidence` is per word, averaged over its tokens, or `null` if the engine
  reports none. Useful later for flagging words worth double-checking.

---

## `DELETE /jobs/{id}`

Requests cancellation. Returns **202** with `{"id": ..., "cancelled": true}`.
Cancellation is cooperative — it takes effect at the next chunk boundary.
**404** for an unknown id.
