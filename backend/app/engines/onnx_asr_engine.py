"""Parakeet via `onnx-asr` -- the shared Windows/macOS engine.

Chosen over parakeet-mlx (faster, but macOS-only, so it would mean a second
implementation and test matrix) and sherpa-onnx (smaller, but long-form VAD
would be hand-rolled). At ~24x real time a 10-minute video transcribes in
well under a minute, which is already far below the After Effects audio
render that precedes it -- ASR is not the bottleneck, so a second codebase
buys nothing. See docs/ARCHITECTURE.md section 6.4.

NOTE: this module cannot be exercised without the model present. The timing
logic it feeds (tokens.py, chunking.py) is pure and is covered by tests.
"""

from __future__ import annotations

import logging

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
    ):
        self.model_name = model_name or config.MODEL_NAME
        self.quantization = quantization or config.MODEL_QUANTIZATION
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
            if config.MODEL_DIR:
                # Only when the caller has genuinely populated it — see the
                # note in config.py about the resolver's offline behaviour.
                kwargs["path"] = config.MODEL_DIR
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
        return _tokens_from_result(result)

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
        providers = ", ".join(onnxruntime.get_available_providers())
        return True, f"onnxruntime {onnxruntime.__version__}; providers: {providers}"

    def describe(self) -> dict:
        return {
            "engine": self.name,
            "model": self.model_name,
            "quantization": self.quantization,
            "providers": self._providers or "default",
            "loaded": self.is_loaded(),
        }


def _tokens_from_result(result) -> list[Token]:
    """Normalize an onnx-asr result into our Token list.

    The library's result shape has moved between versions, so this accepts
    the shapes seen in the wild rather than assuming one. If none match we
    raise loudly: silently returning no tokens would surface much later as
    "captions are empty" with no clue why.
    """
    timestamps = getattr(result, "timestamps", None)
    if timestamps is None:
        timestamps = getattr(result, "tokens", None)
    if timestamps is None and isinstance(result, (list, tuple)):
        timestamps = result

    if timestamps is None:
        raise EngineUnavailable(
            "onnx-asr result exposed no timestamps -- was the model loaded "
            "with .with_timestamps()?"
        )

    tokens: list[Token] = []
    for item in timestamps:
        if isinstance(item, (list, tuple)):
            text, start, end = item[0], float(item[1]), float(item[2])
            conf = float(item[3]) if len(item) > 3 and item[3] is not None else None
        else:
            text = getattr(item, "token", None) or getattr(item, "text", "")
            start = float(getattr(item, "start", 0.0))
            end = float(getattr(item, "end", start))
            raw_conf = getattr(item, "confidence", None)
            conf = float(raw_conf) if raw_conf is not None else None
        tokens.append(Token(text=text, start=start, end=end, confidence=conf))
    return tokens
