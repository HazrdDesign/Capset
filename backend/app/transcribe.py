"""
Core Parakeet transcription logic.

This module is deliberately independent of FastAPI — it should be fully
testable/runnable as a plain script before any API wrapping happens
(Phase 1, step 1 in backend/README.md).

TODO(phase1-step1): This is scaffolding, not working code yet. Needs:
  - Confirm correct NeMo API calls for loading a Parakeet checkpoint
  - Confirm how to request word-level timestamps from the decoder
    (not on by default for all NeMo ASR configs — verify against current
    NeMo docs/examples for the specific Parakeet variant used)
  - Handle audio preprocessing (sample rate conversion, mono downmix, etc.)
    NeMo models typically expect 16kHz mono WAV
"""

from dataclasses import dataclass


@dataclass
class Word:
    text: str
    start: float
    end: float
    confidence: float | None = None


@dataclass
class TranscriptionResult:
    duration_sec: float
    words: list[Word]
    full_text: str


class ParakeetTranscriber:
    """
    Wraps model loading + inference. Instantiate once at server startup
    (model load is expensive) and reuse across requests.
    """

    def __init__(self, model_name: str, cache_dir: str):
        self.model_name = model_name
        self.cache_dir = cache_dir
        self._model = None

    def load(self) -> None:
        """
        Load the Parakeet model into memory. Called once at startup.

        TODO: actual NeMo model loading, e.g. something along the lines of
        `nemo_asr.models.ASRModel.from_pretrained(model_name=...)` —
        confirm exact API against current NeMo version and Parakeet
        checkpoint requirements before relying on this shape.
        """
        raise NotImplementedError("Phase 1 step 1: implement model loading")

    def is_loaded(self) -> bool:
        return self._model is not None

    def transcribe(self, audio_path: str) -> TranscriptionResult:
        """
        Run inference on a local audio file path, return word-level
        timestamps.

        TODO: implement. Must ensure:
          - audio is resampled/converted to whatever format the model
            expects (verify — commonly 16kHz mono WAV for NeMo ASR models)
          - word-level timestamps are explicitly requested from the decoder
          - confidence scores extracted if the model/decoder exposes them
        """
        raise NotImplementedError("Phase 1 step 1: implement transcription")


if __name__ == "__main__":
    # Manual smoke test entry point for Phase 1 step 1.
    # Usage once implemented: python -m app.transcribe path/to/test.wav
    import sys

    from app.config import MODEL_CACHE_DIR, MODEL_NAME

    if len(sys.argv) != 2:
        print("Usage: python -m app.transcribe <audio_file>")
        sys.exit(1)

    transcriber = ParakeetTranscriber(MODEL_NAME, MODEL_CACHE_DIR)
    transcriber.load()
    result = transcriber.transcribe(sys.argv[1])

    print(f"Duration: {result.duration_sec}s")
    print(f"Full text: {result.full_text}")
    print("Words:")
    for w in result.words:
        print(f"  {w.start:.2f}-{w.end:.2f}  {w.text}  (conf={w.confidence})")
