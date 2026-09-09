"""Parakeet via `onnx-asr` -- the shared Windows/macOS engine.

Chosen over parakeet-mlx (faster, but macOS-only, so it would mean a second
implementation and test matrix) and sherpa-onnx (smaller, but long-form VAD
would be hand-rolled). At ~24x real time a 10-minute video transcribes in
well under a minute, which is already far below the After Effects audio
render that precedes it -- ASR is not the bottleneck, so a second codebase
buys nothing. See docs/ARCHITECTURE.md section 6.4.

NOTE: loading and running the model needs the weights present. Parsing its
OUTPUT does not -- _tokens_from_result is pure, and the absence of tests for
it is how a completely wrong reading of the result shape shipped three times.
See tests/test_engine_result.py.
"""

from __future__ import annotations

import logging
import math

import numpy as np

from .. import config
from ..models import Token
from .base import EngineUnavailable

log = logging.getLogger(__name__)


def _resolve_providers(setting: str) -> list[str] | None:
    """Pick ONNX Runtime execution providers.

    "auto" asks onnxruntime what this machine actually has and orders them
    best-first. CUDA is Windows/Linux + NVIDIA only; CoreML is the Apple
    Silicon path. CPU is always the floor.
    """
    if setting and setting != "auto":
        return [p.strip() for p in setting.split(",") if p.strip()]

    try:
        import onnxruntime as ort
    except ImportError:
        return None

    available = set(ort.get_available_providers())
    preferred = ["CUDAExecutionProvider", "CoreMLExecutionProvider", "CPUExecutionProvider"]
    ordered = [p for p in preferred if p in available]
    return ordered or None


class OnnxAsrEngine:
    name = "onnx-asr"

    def __init__(
        self,
        model_name: str | None = None,
        quantization: str | None = None,
        providers: str | None = None,
        model_dir: str | None = None,
    ):
        self.model_name = model_name or config.MODEL_NAME
        self.quantization = quantization or config.MODEL_QUANTIZATION
        # Explicit for the build-time staging step, which downloads into a
        # directory that does not exist yet. At runtime this is None and the
        # configured path (the bundled weights, or the cache) is used.
        self.model_dir = model_dir or config.MODEL_DIR
        self._providers = _resolve_providers(
            providers if providers is not None else config.PROVIDERS
        )
        self._model = None

    def load(self) -> None:
        try:
            import onnx_asr
        except ImportError as exc:  # pragma: no cover - needs the real package
            # Report the ACTUAL failure. `import onnx_asr` immediately does
            # `import onnxruntime`, and ModuleNotFoundError subclasses
            # ImportError — so a missing onnxruntime used to surface here as
            # "onnx-asr is not installed", sending people to reinstall the
            # wrong package. Name what really failed.
            missing = getattr(exc, "name", None) or "onnx_asr"
            raise EngineUnavailable(
                f"could not import the ASR engine: {type(exc).__name__}: {exc} "
                f"(missing module: {missing}). In a packaged build this means "
                f"the bundle is incomplete, not that you need to pip install "
                f"anything."
            ) from exc

        log.info(
            "loading %s (quantization=%s, providers=%s)",
            self.model_name,
            self.quantization,
            self._providers or "default",
        )
        try:
            kwargs = {}
            if self.model_dir:
                # A populated directory makes the resolver work offline, which
                # is what the bundled weights rely on. An EMPTY one makes it
                # refuse to download at all, so config._bundled_model_dir()
                # only reports a directory that actually has files in it.
                kwargs["path"] = self.model_dir
            if self.quantization:
                kwargs["quantization"] = self.quantization
            if self._providers:
                kwargs["providers"] = self._providers
            model = onnx_asr.load_model(self.model_name, **kwargs)
            # Token-level timestamps are opt-in; without this the engine
            # returns text only and there is nothing to time captions from.
            self._model = model.with_timestamps()
        except Exception as exc:  # pragma: no cover - needs the real package
            raise EngineUnavailable(f"failed to load {self.model_name}: {exc}") from exc

    def is_loaded(self) -> bool:
        return self._model is not None

    def transcribe_chunk(self, audio: np.ndarray, sample_rate: int) -> list[Token]:
        if self._model is None:
            raise EngineUnavailable("engine not loaded")
        result = self._model.recognize(audio, sample_rate=sample_rate)
        # The chunk's own length bounds the last token, which otherwise has no
        # end: the model gives each token a START time and nothing else.
        duration = len(audio) / sample_rate if sample_rate else 0.0
        return _tokens_from_result(result, duration)

    def fetch_model(self) -> tuple[bool, str]:
        """Download the weights now, or confirm they are already cached.

        onnx_asr checks its cache first (local_files_only=True) and only
        reaches the network when the files are genuinely missing, so calling
        this repeatedly is cheap and re-running the installer will not
        re-download a model the user already has.
        """
        try:
            self.load()
        except EngineUnavailable as exc:
            return False, str(exc)
        except Exception as exc:  # pragma: no cover - needs the real package
            return False, f"{type(exc).__name__}: {exc}"
        return True, f"{self.model_name} ({self.quantization}) is ready"

    @staticmethod
    def selftest() -> tuple[bool, str]:
        """Can the ASR stack be imported at all? No model download.

        Exists because /health answers even when the engine is unusable, so a
        smoke test that only checks the service responds cannot tell a working
        bundle from a broken one. v0.1.3 shipped exactly that way.
        """
        try:
            import onnxruntime
        except Exception as exc:
            return False, f"onnxruntime import failed: {type(exc).__name__}: {exc}"
        try:
            import onnx_asr  # noqa: F401
        except Exception as exc:
            return False, f"onnx_asr import failed: {type(exc).__name__}: {exc}"

        # Checking only the two imports above is NOT enough — that is what
        # v0.1.4 did, and it shipped broken. onnx_asr resolves model weights
        # through huggingface_hub, imported inside a function in resolver.py,
        # so the failure surfaces at model-load time rather than at import.
        # Reach for the exact symbols the download path uses.
        try:
            from huggingface_hub import hf_hub_download, snapshot_download  # noqa: F401
        except Exception as exc:
            return False, (
                f"huggingface_hub import failed: {type(exc).__name__}: {exc} "
                "— model weights could not be downloaded"
            )

        # hf_xet accelerates the model download. Its absence is NOT a failure:
        # huggingface_hub falls back to plain HTTP with a warning. It is
        # reported so a bundle that quietly lost it is visible in CI output
        # rather than showing up as "the download feels slow" months later.
        try:
            import hf_xet  # noqa: F401
            transfer = "xet"
        except Exception:
            transfer = "http (hf_xet not bundled; downloads will be slower)"

        providers = ", ".join(onnxruntime.get_available_providers())
        return True, (
            f"onnxruntime {onnxruntime.__version__}; providers: {providers}; "
            f"model transfer: {transfer}"
        )

    def describe(self) -> dict:
        return {
            "engine": self.name,
            "model": self.model_name,
            "quantization": self.quantization,
            "providers": self._providers or "default",
            # Surfaced on /health so "did it use the weights we shipped, or go
            # and download its own?" is answerable without reading a log.
            "bundled": bool(self.model_dir),
            "loaded": self.is_loaded(),
        }


# A token with no following token has no end time. Parakeet's encoder steps
# 0.01s per frame with a subsampling factor of 8, so a token spans about this
# long; used only for the final token of a chunk whose duration is unknown.
_NOMINAL_TOKEN_S = 0.08

# The longest a chunk's FINAL token may be stretched.
#
# Every other token ends where the next one starts, which is real information.
# The last one has nothing after it, so its end used to be taken from the
# chunk's own duration -- and that is not an end time, it is an upper bound.
# Chunks are planned from VAD speech spans, and the energy gate keeps a span
# open through background music, so a chunk routinely runs seconds past the
# last word spoken in it. The final word then inherited that whole tail: one
# word left on screen for six seconds after it was said, and (because the
# panel's phrase grouping closes a caption whose span exceeds the duration
# budget) stranded on a caption of its own.
#
# A generous ceiling for one spoken word. Long enough that a drawn-out word
# keeps its real length, short enough that a music tail cannot be mistaken
# for one.
_MAX_FINAL_TOKEN_S = 0.6


def _tokens_from_result(result, duration: float = 0.0) -> list[Token]:
    """Turn an onnx-asr TimestampedResult into our Token list.

    The real shape, from onnx_asr.asr.TimestampedResult:

        text        str          the whole transcript
        tokens      list[str]    one vocab piece per token, carrying the
                                 U+2581 word-boundary marker tokens.py needs
        timestamps  list[float]  one START TIME per token -- plain numbers,
                                 not objects, and no end times at all
        logprobs    list[float]  log probability per token (so negative)

    Getting this wrong is what shipped in v0.2.x through v0.3.0. The previous
    version iterated `timestamps` treating each entry as an object with
    `.text`/`.start`/`.end`. Every entry is a float, so `getattr(item, "text",
    "")` returned "" for all of them, every Token came out blank, and
    merge_tokens_to_words dropped the lot -- zero captions from a transcript
    the model had produced perfectly, sitting untouched in `result.text`.

    A token ends where the next one starts; the last ends at the end of the
    chunk, or _MAX_FINAL_TOKEN_S after it started, whichever comes first.
    That is an approximation -- the model does not report ends -- but it is
    contiguous and monotonic, which is what caption timing needs.
    """
    text = getattr(result, "text", "") or ""
    pieces = getattr(result, "tokens", None)
    starts = getattr(result, "timestamps", None)
    logprobs = getattr(result, "logprobs", None)

    if starts is None or pieces is None:
        # Loud on purpose. Returning [] here is indistinguishable from silence
        # to everything downstream, which is exactly how the bug above hid for
        # three releases behind "0 words -> 0 captions".
        if text.strip():
            raise EngineUnavailable(
                "onnx-asr returned text (%r) but no %s, so the words cannot be "
                "timed. Was the model loaded with .with_timestamps()?"
                % (text[:60], "timestamps" if starts is None else "tokens")
            )
        return []

    if len(pieces) != len(starts):
        # Pair what we can rather than dropping everything, but never silently.
        log.warning(
            "onnx-asr returned %d token(s) and %d timestamp(s); pairing %d",
            len(pieces), len(starts), min(len(pieces), len(starts)),
        )

    count = min(len(pieces), len(starts))
    tokens: list[Token] = []
    for index in range(count):
        start = float(starts[index])
        if index + 1 < count:
            end = float(starts[index + 1])
        else:
            # The chunk's duration bounds this token; it does not measure it.
            end = min(
                max(duration, start + _NOMINAL_TOKEN_S),
                start + _MAX_FINAL_TOKEN_S,
            )
        # logprobs are log probabilities and therefore <= 0. Passing one
        # straight through as "confidence" would report -0.31 for a token the
        # model was 73% sure of.
        confidence = None
        if logprobs is not None and index < len(logprobs):
            confidence = math.exp(float(logprobs[index]))
        tokens.append(Token(text=pieces[index], start=start, end=end,
                            confidence=confidence))
    return tokens
