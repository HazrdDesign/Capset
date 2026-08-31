# Transcription Response Schema

This is the contract between the backend and the future UXP panel. Keep this
stable — the panel's segmentation logic (word/sentence/smart grouping) will
be built against this shape.

## `POST /transcribe` response

```json
{
  "duration_sec": 12.34,
  "words": [
    {
      "text": "hello",
      "start": 0.12,
      "end": 0.48,
      "confidence": 0.98
    },
    {
      "text": "world",
      "start": 0.52,
      "end": 0.91,
      "confidence": 0.95
    }
  ],
  "full_text": "hello world"
}
```

- `words`: flat list, in order, word-level only. Sentence/line/smart grouping
  is NOT done here — that's the panel's job, since segmentation preference is
  a user setting (word-by-word / sentence / smart), not a transcription
  concern.
- `start` / `end`: seconds, float, relative to the start of the submitted
  audio file (i.e. relative to the AE work area that was rendered out, not
  absolute comp time — the panel is responsible for offsetting these against
  wherever the work area actually starts in the comp).
- `confidence`: per-word confidence score if the model provides it. Useful
  later for flagging low-confidence words in the panel UI (e.g. highlighting
  words the user should double check) — not used in Phase 1.

## `GET /health` response

```json
{
  "status": "ok",
  "model_loaded": true
}
```

Panel should poll this before attempting a transcription request, and can use
`model_loaded: false` to show a "starting up" state if the backend is still
loading the model after launch.
