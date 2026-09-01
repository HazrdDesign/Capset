#!/usr/bin/env python3
"""Measure real transcription speed. Run this before promising anything.

The CPU number is the one that decides whether Capset can honestly ship to
users without an NVIDIA GPU -- notably every Mac. Research cited an
unverified RTFx of 1.38 for CPU, which would mean a 10-minute video takes
~7 minutes. Measure; do not design around a guess.

Usage:
    python bench.py path/to/audio.wav
    python bench.py path/to/audio.wav --providers CPUExecutionProvider
    python bench.py path/to/audio.wav --repeat 3
"""

from __future__ import annotations

import argparse
import platform
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import config  # noqa: E402
from app.audio import load_audio  # noqa: E402
from app.engines.onnx_asr_engine import OnnxAsrEngine  # noqa: E402
from app.transcribe import Transcriber  # noqa: E402


def describe_machine() -> dict:
    info = {
        "platform": platform.platform(),
        "machine": platform.machine(),
        "python": platform.python_version(),
    }
    try:
        import onnxruntime as ort

        info["onnxruntime"] = ort.__version__
        info["available_providers"] = ort.get_available_providers()
    except ImportError:
        info["onnxruntime"] = "not installed"
    return info


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", help="audio or video file to transcribe")
    parser.add_argument("--providers", default=None,
                        help="comma-separated ONNX providers, e.g. CPUExecutionProvider")
    parser.add_argument("--model", default=None)
    parser.add_argument("--quantization", default=None)
    parser.add_argument("--repeat", type=int, default=1,
                        help="runs after the warm-up (default 1)")
    args = parser.parse_args()

    path = Path(args.audio)
    if not path.exists():
        print(f"error: {path} not found", file=sys.stderr)
        return 1

    print("=== machine ===")
    for key, value in describe_machine().items():
        print(f"  {key}: {value}")

    engine = OnnxAsrEngine(
        model_name=args.model,
        quantization=args.quantization,
        providers=args.providers,
    )
    transcriber = Transcriber(engine)

    print("\n=== loading model ===")
    load_started = time.perf_counter()
    transcriber.load()
    load_s = time.perf_counter() - load_started
    print(f"  model load: {load_s:.2f}s")
    for key, value in engine.describe().items():
        print(f"  {key}: {value}")

    # Duration comes from the decode itself. There is no separate probe any
    # more: probing meant running ffprobe, and ffmpeg was dropped entirely
    # when After Effects took over rendering the audio.
    decode_started = time.perf_counter()
    audio, sample_rate = load_audio(path)
    decode_s = time.perf_counter() - decode_started
    duration = len(audio) / sample_rate
    print(f"\n=== input ===\n  {path.name}: {duration:.2f}s audio")
    print(f"  decode: {decode_s:.2f}s")

    # Warm-up: the first pass pays for lazy graph init and would otherwise
    # make the headline number look worse than steady state.
    print("\n=== warm-up ===")
    warm_started = time.perf_counter()
    result = transcriber.transcribe(path)
    print(f"  {time.perf_counter() - warm_started:.2f}s, {len(result.words)} words")

    timings = []
    for run in range(args.repeat):
        started = time.perf_counter()
        result = transcriber.transcribe(path)
        elapsed = time.perf_counter() - started
        timings.append(elapsed)
        print(f"  run {run + 1}: {elapsed:.2f}s  (RTFx {duration / elapsed:.1f})")

    best = min(timings)
    median = statistics.median(timings)
    print("\n=== result ===")
    print(f"  audio duration : {duration:.2f}s")
    print(f"  median         : {median:.2f}s   RTFx {duration / median:.1f}")
    print(f"  best           : {best:.2f}s   RTFx {duration / best:.1f}")
    print(f"  words          : {len(result.words)}")
    print(f"\n  A 10-minute video would take ~{600 / (duration / median):.0f}s "
          f"at this rate (excluding model load).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
