# Research: NVIDIA Parakeet ASR Models for Windows Offline Deployment

**Date:** August 31, 2026  
**Purpose:** Evaluate NVIDIA Parakeet ASR models and deployment strategies for offline speech-to-text on Windows  
**Target:** Embed inside a Windows .exe installer  

---

## Executive Summary

NVIDIA Parakeet TDT models are production-ready, commercially-licensed (CC-BY-4.0) ASR models with 600M and 1.1B parameter variants. The TDT 0.6B v2/v3 models offer strong accuracy (6.05-6.32% WER) rivaling Whisper Large V3 (7.44% WER) on the Hugging Face Open ASR Leaderboard. However, deploying Parakeet on Windows requires careful dependency management:

- **Full NeMo stack** (PyTorch + nemo_toolkit) → 3-4 GB bundle size via PyInstaller
- **ONNX lightweight path** (onnx-asr) → ~400-500 MB with model, supports CPU-only
- **sherpa-onnx** (C++ runtime) → ~7-10 MB runtime + model, prebuilt Windows binaries available
- **Rust alternatives** (parakeet-rs) → Minimal footprint, Apple Silicon focus, limited Windows support

**Best path for Windows installer:** sherpa-onnx with ONNX-converted Parakeet models or onnx-asr Python package. Avoid full NeMo/PyTorch for size reasons.

---

## 1. Parakeet Models on Hugging Face

### Available Models

| Model Name | Parameters | Disk Size | Languages | License | Commercial OK? |
|---|---|---|---|---|---|
| **parakeet-tdt-0.6b-v2** | 600M | 2.47 GB | English (en-US) | CC-BY-4.0 | ✓ Yes, requires attribution |
| **parakeet-tdt-0.6b-v3** | 600M | ~2.47 GB | 25 European languages | CC-BY-4.0 | ✓ Yes, requires attribution |
| **parakeet-tdt-1.1b** | 1.1B | ~4.5 GB (estimated) | English (en-US) | CC-BY-4.0 | ✓ Yes, requires attribution |
| **parakeet-rnnt-1.1b** | 1.1B | ~4.5 GB (estimated) | English (en-US) | CC-BY-4.0 | ✓ Yes, requires attribution |
| **parakeet-tdt_ctc-110m** | 114M | ~250-350 MB | English (en-US) | CC-BY-4.0 | ✓ Yes, requires attribution |
| **parakeet-ctc-0.6b** | 600M | ~2.47 GB | English (en-US) | CC-BY-4.0 | ✓ Yes, requires attribution |
| **parakeet-ctc-1.1b** | 1.1B | ~4.5 GB (estimated) | English (en-US) | CC-BY-4.0 | ✓ Yes, requires attribution |

### License Details

**All Parakeet models use CC-BY-4.0 license:**
- Allows **commercial use** and redistribution
- Requires **attribution to NVIDIA** (include in about dialog / EULA)
- **No patent restrictions** (unlike GPL)
- **Permissive for commercial products** – can bundle inside .exe installers with proper attribution
- Source: [VentureBeat coverage](https://venturebeat.com/ai/nvidia-launches-fully-open-source-transcription-ai-model-parakeet-tdt-0-6b-v2-on-hugging-face)

### Recommended Models for Windows

1. **parakeet-tdt-0.6b-v2** (English-only)
   - 600M parameters, 2.47 GB model file
   - Best English accuracy (6.05% WER on Hugging Face Open ASR Leaderboard)
   - 16 kHz mono audio input
   - Supports punctuation, capitalization, timestamps

2. **parakeet-tdt-0.6b-v3** (Multilingual)
   - 600M parameters, ~2.47 GB model file
   - Supports 25 European languages: Bulgarian, Croatian, Czech, Danish, Dutch, English, Estonian, Finnish, French, German, Greek, Hungarian, Italian, Latvian, Lithuanian, Maltese, Polish, Portuguese, Romanian, Slovak, Slovenian, Spanish, Swedish, Russian, Ukrainian
   - Automatic language detection
   - 6.32% average WER on Hugging Face Open ASR Leaderboard

3. **parakeet-tdt_ctc-110m** (Ultra-lightweight)
   - Only 114M parameters, ~250-350 MB
   - RTFx ~5,300 on A100 GPU (real-time factor)
   - Better for resource-constrained Windows environments
   - English only

---

## 2. Word-Level Timestamps in NeMo

### API Implementation

NVIDIA NeMo Parakeet models **support word-level timestamps** natively via the TDT (Token-and-Duration Transducer) architecture. The model emits character, word, and segment-level timing information.

#### Code Example (NeMo Python API)

```python
import nemo.collections.asr as nemo_asr

# Load the model
asr_model = nemo_asr.models.ASRModel.from_pretrained("nvidia/parakeet-tdt-0.6b-v2")

# Transcribe with timestamps enabled (default)
hypotheses = asr_model.transcribe(["path/to/audio.wav"], timestamps=True)

# Access word-level timestamps
word_timestamps = hypotheses[0].timestamp['word']
segment_timestamps = hypotheses[0].timestamp['segment']
char_timestamps = hypotheses[0].timestamp['char']

# Iterate over words with timing
for stamp in hypotheses[0].timestamp['word']:
    print(f"{stamp['start']}s - {stamp['end']}s : {stamp['word']}")
```

### Timestamp Accuracy & Granularity

- **Word-level precision:** Granular to ~10-50ms depending on audio quality
- **Frame-based:** Underlying model uses 960 audio frames at 16 kHz = 60ms per frame
- **Limitation:** Whisper-based models show insufficient word segmentation accuracy; NeMo Parakeet TDT models are more accurate due to explicit duration prediction
- **Note:** For production subtitles/video editing, consider forced alignment tools (e.g., wav2vec2 via WhisperX) for higher accuracy
- Source: [NVIDIA NeMo Documentation](https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/intro.html)

### Implementation via ONNX Runtime

**CORRECTED 2026-08-31 — the original claim here was wrong.**

`onnx-asr` **does** expose timestamps. Its README lists as a headline feature:
*"Can return token-level timestamps and log probabilities."* The API is
`onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v3").with_timestamps()`.

Likewise `sherpa-onnx` exposes `OfflineRecognizerResult.timestamps` for
transducer models, and Parakeet TDT **is** a transducer.

The real (much smaller) caveat: both return **token-level** timestamps, not
word-level. Parakeet uses BPE subword tokens, so words must be reassembled by
merging tokens — the `▁` (U+2581) prefix marks a word boundary. That is a
~30-line loop, not a blocker, and it is the standard approach.

Verified against: <https://raw.githubusercontent.com/istupakov/onnx-asr/main/README.md>

---

## 3. Dependency Footprint: PyInstaller + NeMo + PyTorch

### Full NeMo Stack (Not Recommended)

**Problem:** PyTorch + nemo_toolkit is extremely large.

#### Dependencies Required
- **PyTorch 2.7+** (with CUDA or CPU-only)
- **nemo_toolkit** with ASR dependencies
- **libsndfile1**, **ffmpeg** (system libraries)
- **Cython, packaging, scipy, librosa**, etc.

#### Measured Bundle Sizes

- **PyTorch CPU-only:** ~400-500 MB
- **PyTorch CUDA 12.x:** ~2.0-3.0 GB (includes CUDA runtime)
- **nemo_toolkit[asr]:** ~200-300 MB
- **Additional dependencies:** ~100-200 MB
- **Model file (parakeet-tdt-0.6b-v2):** 2.47 GB

**Total PyInstaller .exe:** 3-4 GB+ (one-file) or 5-6 GB+ (one-dir with DLLs)

#### Reports from Community

Users have reported PyInstaller bundles with PyTorch reaching **200-300 MB for minimal apps**, but adding models and NeMo increases this dramatically. Some developers strip unused backends and CUDA libraries to reduce bloat, but this requires custom build tweaking.

**Verdict:** Not practical for a single installer file; users would need staged downloads or cloud offloading.
- Source: [PyTorch Forums: PyInstaller bundle size](https://discuss.pytorch.org/t/how-to-reduce-the-size-of-the-pytorch-package-after-using-pyinstaller-with-d-option-resulting-in-a-3gb-size-for-the-torch-file/194822)

### CUDA vs CPU-Only

- **CUDA support required?** No – Parakeet TDT can run on CPU, but slower
  - GPU inference: RTFx 3,332 (3,332x real-time)
  - CPU inference: RTFx 1.38 (slower; larger models with wider tensors favor GPU parallelism)
- **For Windows offline .exe:** CPU-only is safer (no GPU driver dependencies), but users should expect 2-3x slower inference
- Source: [NVIDIA Parakeet Blog](https://developer.nvidia.com/blog/pushing-the-boundaries-of-speech-recognition-with-nemo-parakeet-asr-models/)

---

## 4. Lightweight Alternatives to Full NeMo Stack

### Option A: onnx-asr (Recommended for Python)

**Package:** `onnx-asr` on PyPI  
**Repository:** [GitHub: istupakov/onnx-asr](https://github.com/istupakov/onnx-asr)

#### Features
- Lightweight Python package (~50 MB installed)
- **No PyTorch or Transformers required** – minimal dependencies
- Supports Parakeet TDT v2 and v3 (ONNX-converted)
- Runs on Windows, Linux, macOS (x86, ARM)
- CPU-only or GPU (CUDA, TensorRT, CoreML, DirectML, ROCm)

#### Bundle Size Estimate
- **onnx-asr runtime:** ~50 MB
- **ONNX Runtime (ort_normal):** ~50-100 MB
- **Model (parakeet-tdt-0.6b-v2.onnx):** ~1.2-1.5 GB (FP32) or ~600-700 MB (INT8 quantized)
- **Total with model:** ~1.8-2.2 GB (FP32) or ~0.9-1.1 GB (INT8)

#### Word-Level Timestamps
- ❌ **Not supported** in the high-level API
- Must use NeMo library directly or write custom frame-to-word mapping logic

#### Audio Input Format
- 16 kHz mono WAV (required)
- Maximum 20-30 seconds per utterance (use VAD for longer audio)

#### Windows Readiness
- ✓ Full Python support on Windows
- ✓ Runs on CPU or GPU
- ⚠ Requires Python runtime (~300-500 MB)

**Verdict:** Good middle-ground for Python-based .exe (via PyInstaller), smaller than full NeMo but still requires Python runtime.

---

### Option B: sherpa-onnx (Best for C++ / Minimal Footprint)

**Repository:** [GitHub: k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)  
**Documentation:** [k2-fsa.github.io/sherpa](https://k2-fsa.github.io/sherpa/onnx/index.html)

#### Features
- **Pure C++ runtime**, no Python required
- Prebuilt Windows binaries (x64, x86) available via GitHub Releases and SourceForge
- Supports Parakeet TDT models (ONNX-converted)
- Streaming and offline inference
- Real-time capable on CPU

#### Bundle Size
- **Runtime (sherpa-onnx executable):** ~5-10 MB
- **onnxruntime DLLs:** ~15-30 MB
- **Model (parakeet-tdt-0.6b-v2.onnx INT8):** ~600-700 MB
- **Total:** ~650-750 MB

#### Word-Level Timestamps
- ⚠ **Limited support** – outputs frame-level timings; requires custom post-processing to map to words
- Decoding via sherpa-onnx gives segment/utterance-level output

#### Windows Readiness
- ✓ **Prebuilt Windows x64/x86 binaries** available
- ✓ No runtime dependencies (statically linked vs. ONNX Runtime DLLs)
- ✓ Very easy to bundle in .exe installer
- ⚠ CRT runtime compatibility issues reported (MT vs MD static/dynamic linking mismatch)
  - Source: [AMD/ONNX Production Windows Guide](https://www.amd.com/en/developer/resources/technical-articles/2026/a-practical-approach-to-using-sherpa-onnx-production-ready-on-wi.html)

#### Pre-trained Models Available
- `sherpa-onnx-nemo-parakeet_tdt_ctc_110m-en-36000-int8` (110M model, lightweight)
- Parakeet TDT 0.6B ONNX conversions via community

**Verdict:** Best for minimal installer footprint; C++ binary avoids Python runtime overhead. Watch for CRT linking issues on Windows.

---

### Option C: parakeet-mlx (macOS/Apple Silicon Only)

**Package:** `parakeet-mlx` on PyPI  
**Repository:** [GitHub: senstella/parakeet-mlx](https://github.com/senstella/parakeet-mlx) and [EliFuzz/parakeet-mlx](https://github.com/EliFuzz/parakeet-mlx)

#### Features
- Optimized for Apple Silicon (M1/M2/M3)
- Uses MLX framework (lightweight Apple framework)
- Ultra-low latency, real-time streaming

#### Windows Readiness
- ❌ **Not available for Windows** – Apple Silicon/macOS only

---

### Option D: parakeet-rs (Rust / Candle Framework)

**Repository:** [GitHub: gpu-cli/parakeet-rs](https://github.com/gpu-cli/parakeet-rs) and [altunenes/parakeet-rs](https://github.com/altunenes/parakeet-rs)

#### Features
- Pure Rust implementation using Candle framework
- **Minimal dependencies**, single binary (no Python)
- Supports Parakeet TDT 0.6B V3 (25 languages)
- Fast CPU inference

#### Bundle Size
- **Compiled binary (parakeet-rs):** ~20-50 MB (estimated)
- **Model:** ~2.47 GB (parakeet-tdt-0.6b-v3)
- **Total:** ~2.5-2.55 GB

#### Word-Level Timestamps
- ❌ **Not implemented** in community versions yet

#### Windows Readiness
- ⚠ **Possible but not primary focus** – primarily targets Apple Silicon and Linux
- ✓ Cross-compilation to Windows is feasible with Rust toolchain
- Prebuilt Windows binaries not readily available

**Verdict:** Interesting for future; Rust provides optimal portability and size. However, Windows support is not production-ready in community builds.

---

### Option E: whisper.cpp (Baseline Comparison)

**Repository:** [GitHub: ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp)

#### Bundle Size (GGML Quantized Format)
- **Tiny model:** 75 MB
- **Base model:** 145 MB
- **Small model:** 465 MB
- **Medium model:** 1.5 GB
- **Large-v3 model:** 3 GB
- **Runtime binary:** ~5 MB

#### Word-Level Timestamps
- ⚠ **Supported** but with poor accuracy (Whisper not trained to predict timestamps precisely)
- Better approach: Use faster-whisper + forced alignment (WhisperX)

#### Windows Readiness
- ✓ **Excellent** – C/C++ binary, no dependencies, GUI versions available

#### Accuracy Comparison
- Whisper Large V3: **7.44% WER** (Hugging Face Open ASR Leaderboard)
- Parakeet TDT 0.6B V2: **6.05% WER** (1.4 percentage point improvement)
- Parakeet TDT 0.6B V3: **6.32% WER** (1.1 percentage point improvement)

**Verdict:** Whisper.cpp is smaller and more portable, but Parakeet is more accurate. For Windows .exe, whisper.cpp is easier to bundle; for accuracy, Parakeet wins.
- Source: [OpenWhispr: Parakeet vs Whisper](https://openwhispr.com/blog/parakeet-vs-whisper-vs-nemotron)

---

### Option F: faster-whisper (Python + CTranslate2)

**Package:** `faster-whisper` on PyPI  
**Repository:** [GitHub: SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper)

#### Bundle Size
- **faster-whisper runtime:** ~50-100 MB
- **CTranslate2 backend:** ~150-200 MB
- **Model (large-v3 INT8):** ~1.6 GB
- **Total:** ~1.8-2.0 GB

#### Performance Advantage
- **4x faster than OpenAI Whisper**
- Uses CTranslate2 (quantized inference engine), not PyTorch
- Much smaller VRAM footprint (50% less at INT8)

#### Word-Level Timestamps
- ⚠ **Supported** but poor accuracy; use WhisperX (faster-whisper + forced alignment) for production

#### Windows Readiness
- ✓ Python package, works on Windows
- ✓ Smaller than NeMo + PyTorch

**Verdict:** Good middle ground between accuracy (Whisper is weaker than Parakeet) and bundle size. Faster than PyTorch Whisper.
- Source: [Whisper Model Sizes 2026](https://spokenly.app/blog/whisper-model-sizes)

---

## 5. Audio Input Format Requirements

### Parakeet ASR Requirements

- **Sample Rate:** 16 kHz (fixed)
- **Channels:** Mono (single channel; stereo will be auto-converted)
- **Bit Depth:** 16-bit PCM or 32-bit float
- **Container:** WAV preferred, FLAC supported natively
- **Minimum Duration:** 160ms of audio required
- **Maximum Duration:** Parakeet TDT can process up to 24 minutes in a single pass

### Format Conversion (ffmpeg)

If your Windows .exe receives MP3, OGG, M4A, or other formats, you'll need **ffmpeg** for conversion:

```bash
ffmpeg -i input.mp3 -acodec pcm_s16le -ar 16000 -ac 1 output.wav
```

### ffmpeg Licensing & Bundling

**License:** Primarily LGPL v2.1+ with some optional GPL v2+ components

**Commercial Bundling Rules:**
1. ✓ **Can redistribute statically-linked ffmpeg.exe** in a commercial Windows installer
2. Must provide attribution: "This software uses libraries from the FFmpeg project under the LGPLv2.1"
3. Must include a copy of the LGPL v2.1 license with your product
4. If you statically link or patch ffmpeg, ensure you're not using GPL-enabled modules (--enable-gpl)
5. **Do NOT rename ffmpeg DLLs** to obfuscate; prefixes/suffixes are OK
6. If distributing unmodified, include copyright notice and warranty disclaimer

**Bundle Size:** ffmpeg.exe (~20-30 MB) + required DLLs (~50-100 MB) for a minimal build

**Alternative:** Use FFmpeg-free libraries like `librosa` (Python) or libopus/libvorbis (C++) to avoid licensing complexity if possible.
- Source: [FFmpeg Commercial License Guide](https://32blog.com/en/ffmpeg/ffmpeg-commercial-license-guide)

---

## 6. Deployment Strategy Comparison Table

| **Option** | **Disk Footprint** | **Word Timestamps** | **CPU-Only OK** | **License** | **Windows Ready** | **Best For** |
|---|---|---|---|---|---|---|
| **NeMo (Full Stack)** | 3-4 GB | ✓ Yes, native | ✓ Yes (slow) | CC-BY-4.0 | ⚠ Complex DLL setup | Research; dev machines |
| **onnx-asr** | 0.9-2.2 GB (depends on quantization) | ✓ Yes — token-level via `.with_timestamps()`, merge to words | ✓ Yes | CC-BY-4.0 (Parakeet) + Apache 2.0 (onnxruntime) | ✓ Yes | Python .exe via PyInstaller; balance of size & accuracy |
| **sherpa-onnx** | 0.65-0.75 GB | ✓ Yes — `OfflineRecognizerResult.timestamps` (token-level) | ✓ Yes | Apache 2.0 (sherpa-onnx) + CC-BY-4.0 (Parakeet) | ✓ Yes, prebuilt binaries | **Smallest installer; minimal dependencies** |
| **parakeet-mlx** | 2.5+ GB | ⚠ Not implemented | ✓ Yes | CC-BY-4.0 | ❌ No (macOS only) | Apple Silicon apps only |
| **parakeet-rs** | 2.5+ GB | ❌ No | ✓ Yes | CC-BY-4.0 | ⚠ Possible, not primary | Future; Rust ecosystem |
| **whisper.cpp** | 0.1-3 GB (model-dependent) | ⚠ Poor accuracy | ✓ Yes | MIT | ✓ Yes, excellent | Smaller bundle; good for low-resource Windows |
| **faster-whisper** | 1.8-2.0 GB | ⚠ Poor accuracy | ✓ Yes | MIT (faster-whisper) + others | ✓ Yes | Python apps; 4x faster than Whisper |

---

## 7. Accuracy Comparison: Hugging Face Open ASR Leaderboard

### Current Standings (2026)

**English ASR Accuracy (WER %):**

| Model | WER | Parameters | RTFx (A100) |
|---|---|---|---|
| **Parakeet-TDT-0.6B-V2** (English) | **6.05%** | 600M | 3,333x |
| **Parakeet-TDT-0.6B-V3** (25 langs) | **6.32%** | 600M | 3,000-3,300x |
| **Whisper Large V3** | 7.44% | 1.5B | ~10-50x (varies) |
| **Whisper Large V3 Turbo** | ~8.0% | 809M | ~50-100x |

### Key Findings

1. **Parakeet is more accurate** than Whisper Large (1.4-2.4 percentage points lower WER)
2. **Parakeet is much faster** – RTFx 3,333 means it processes audio 3,333x faster than real-time on A100
3. **Whisper covers more languages** (99) vs Parakeet v3 (25 European languages)
4. **Parakeet v3 supports automatic language detection** within its 25-language subset
5. **For English-only use cases, Parakeet v2 is the clear winner**

### Speed Implications for Windows .exe

- **CPU inference:** Expect ~1.4 RTFx (slower than real-time) for Parakeet on modern i7/Ryzen 5
- **60 seconds of audio** → ~40 seconds processing time on CPU (Intel i7-13700K estimated)
- **This is acceptable for batch transcription** but not real-time; consider chunked streaming for perceived responsiveness

---

## 8. Critical Licensing & Attribution Requirements

### CC-BY-4.0 Attribution for Commercial .exe

If shipping Parakeet models in a Windows .exe installer:

1. **In About / Help dialog:**
   ```
   This application uses NVIDIA Parakeet TDT 0.6B V2 ASR model
   licensed under Creative Commons Attribution 4.0 International (CC-BY-4.0).
   Attribution: NVIDIA and Suno.ai
   ```

2. **In End-User License Agreement (EULA):**
   ```
   "This software includes automatic speech recognition models 
   developed by NVIDIA, licensed under the Creative Commons 
   Attribution 4.0 International License (CC-BY-4.0)."
   ```

3. **In installer / documentation:**
   - Include link to CC-BY-4.0 license text
   - Credit Suno.ai as co-developer of the model

4. **If using ffmpeg:**
   - Add similar LGPL v2.1 attribution in EULA

### No Patent Restrictions

Unlike GPL, CC-BY-4.0 does **not** require you to open-source your product or derivative works – only proper attribution.

---

## 9. Recommended Path Forward for Windows .exe

### Scenario A: Smallest Installer (~750 MB with model)

**Use:** sherpa-onnx with Parakeet TDT ONNX model

**Steps:**
1. Download prebuilt sherpa-onnx Windows x64 binary from [GitHub Releases](https://github.com/k2-fsa/sherpa-onnx/releases)
2. Convert/download Parakeet TDT 0.6B V2 to ONNX format (INT8 quantized, ~600 MB)
3. Bundle both in .exe installer
4. Call sherpa-onnx executable via subprocess from installer code
5. Include CC-BY-4.0 and Apache 2.0 license notices

**Pros:** Minimal footprint, no dependencies, Windows-native binaries  
**Cons:** Word-level timestamps require custom frame-to-word mapping

### Scenario B: Python-Based, Larger (~2.0 GB with model)

**Use:** Python + onnx-asr + PyInstaller

**Steps:**
1. Create minimal Python app using onnx-asr
2. Use ONNX-converted Parakeet model (INT8, ~600 MB)
3. Bundle with PyInstaller (includes Python runtime)
4. Total .exe: ~1.5-2.0 GB
5. Include license files in installer data

**Pros:** Native Python ecosystem, easier development  
**Cons:** Larger footprint, Python runtime dependency

### Scenario C: GPU-Accelerated (CUDA Users)

**Use:** sherpa-onnx with CUDA-enabled ONNX Runtime

**Steps:**
1. Detect GPU presence on user's machine
2. Optionally download CUDA 12.x runtime (~500 MB) on first run
3. Fall back to CPU if CUDA not available
4. Bundle sherpa-onnx + ONNX model as baseline

**Pros:** Fast on equipped machines; works on CPUs as fallback  
**Cons:** Complex installer logic; larger optional downloads

---

## 10. Known Issues & Gotchas

### CRT Runtime Mismatch (sherpa-onnx on Windows)

- **Issue:** sherpa-onnx may be built with static CRT (MT) while your app uses dynamic CRT (MD)
- **Symptom:** Runtime errors, DLL load failures on some Windows systems
- **Solution:** Either rebuild sherpa-onnx matching your CRT choice or use wrapper DLL
- Source: [AMD Sherpa-ONNX Windows Guide](https://www.amd.com/en/developer/resources/technical-articles/2026/a-practical-approach-to-using-sherpa-onnx-production-ready-on-wi.html)

### PyInstaller + PyTorch Bloat

- **Issue:** PyInstaller can create 3-4 GB bundles with PyTorch even for "hello world" apps
- **Solution:** Use hook files to exclude unused backends, or avoid PyInstaller for large packages
- Source: [PyTorch Forums](https://discuss.pytorch.org/t/how-to-reduce-the-size-of-the-pytorch-package-after-using-pyinstaller-with-d-option-resulting-in-a-3gb-size-for-the-torch-file/194822)

### Token-level → word-level timestamp merging (NOT a blocker)

- **Corrected:** the earlier claim that ONNX runtimes "do not expose word-level
  timestamps" is **false**. `onnx-asr` (`.with_timestamps()`) and `sherpa-onnx`
  (`OfflineRecognizerResult.timestamps`) both return token-level timestamps.
- **Actual work required:** merge BPE subword tokens into words using the
  `▁` word-boundary marker. Standard, well-trodden, ~30 lines.

### ⚠️ MAX AUDIO LENGTH — 20–30 SECONDS (ARCHITECTURALLY CRITICAL)

The onnx-asr README carries this warning:

> "The maximum audio length for most models is 20–30 seconds. For longer audio,
> use VAD."

**This is the single most important constraint for Capset.** A captioning
plugin processes multi-minute footage, so the backend **cannot** simply hand a
whole file to the model. Long-form transcription **requires** VAD (Voice
Activity Detection) chunking:

1. Run VAD (e.g. Silero) to find speech segments.
2. Transcribe each segment independently.
3. **Offset each segment's timestamps by that segment's start time** and
   concatenate.

Step 3 is where caption sync bugs come from: forget the offset and every
caption after the first chunk drifts. `onnx-asr` has built-in long-form VAD
support, which is a strong argument for it over a hand-rolled ONNX pipeline.

This constraint was missed in the first pass of this document and must be
reflected in the Phase 1 backend design.

### Audio Format Handling

- **Issue:** Users may provide MP3 / M4A / OGG instead of 16 kHz WAV
- **Solution:** Bundle ffmpeg or use Python libraries (librosa, soundfile, pydub)
- **Licensing:** ffmpeg is LGPL – must include attribution if bundled
- Source: [Parakeet v3 Model Card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)

---

## 11. Sources

### NVIDIA Parakeet Models & Specs
- [NVIDIA Parakeet TDT 0.6B V2 Hugging Face](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2)
- [NVIDIA Parakeet TDT 0.6B V3 Hugging Face](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
- [NVIDIA Parakeet RNNT 1.1B Hugging Face](https://huggingface.co/nvidia/parakeet-rnnt-1.1b)
- [NVIDIA Parakeet TDT/CTC 110M](https://huggingface.co/nvidia/parakeet-tdt_ctc-110m)
- [VentureBeat: NVIDIA Open-Sources Parakeet V2](https://venturebeat.com/ai/nvidia-launches-fully-open-source-transcription-ai-model-parakeet-tdt-0-6b-v2-on-hugging-face)
- [NVIDIA Blog: Pushing Boundaries of Speech Recognition](https://developer.nvidia.com/blog/pushing-the-boundaries-of-speech-recognition-with-nemo-parakeet-asr-models/)

### Word-Level Timestamps & NeMo API
- [NVIDIA NeMo ASR Documentation](https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/intro.html)
- [NeMo GitHub: Speech AI](https://github.com/NVIDIA-NeMo/Speech)
- [NeMo Timestamps GitHub Issue](https://github.com/NVIDIA-NeMo/Speech/issues/15193)

### PyInstaller & Bundle Size
- [PyTorch Forums: PyInstaller Bundle Size](https://discuss.pytorch.org/t/how-to-reduce-the-size-of-the-pytorch-package-after-using-pyinstaller-with-d-option-resulting-in-a-3gb-size-for-the-torch-file/194822)
- [PyTorch Forums: Pyinstaller & PyTorch](https://discuss.pytorch.org/t/pyinstaller-pytorch/185917)
- [Analytics Vidhya: Deploying with Tkinter and PyInstaller](https://www.analyticsvidhya.com/blog/2023/01/deploying-deep-learning-model-using-tkinter-and-pyinstaller/)

### onnx-asr
- [onnx-asr PyPI](https://pypi.org/project/onnx-asr/)
- [onnx-asr GitHub](https://github.com/istupakov/onnx-asr)
- [Parakeet TDT 0.6B V2 ONNX Hugging Face](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v2-onnx)
- [Parakeet TDT 0.6B V3 ONNX Hugging Face](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx)

### sherpa-onnx
- [sherpa-onnx GitHub](https://github.com/k2-fsa/sherpa-onnx)
- [sherpa-onnx Documentation](https://k2-fsa.github.io/sherpa/onnx/index.html)
- [sherpa-onnx Pre-trained Models](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/index.html)
- [sherpa-onnx GitHub Releases](https://github.com/k2-fsa/sherpa-onnx/releases)
- [AMD: Practical Guide to Sherpa-ONNX on Windows](https://www.amd.com/en/developer/resources/technical-articles/2026/a-practical-approach-to-using-sherpa-onnx-production-ready-on-wi.html)

### Rust Implementations
- [parakeet-rs GitHub (gpu-cli)](https://github.com/gpu-cli/parakeet-rs)
- [parakeet-rs GitHub (altunenes)](https://github.com/altunenes/parakeet-rs)
- [parakeet-rs Crates.io](https://crates.io/crates/parakeet-rs/0.3.2)
- [parakeet-rs Docs.rs](https://docs.rs/parakeet-rs)

### parakeet-mlx
- [parakeet-mlx GitHub (senstella)](https://github.com/senstella/parakeet-mlx)
- [parakeet-mlx GitHub (EliFuzz)](https://github.com/EliFuzz/parakeet-mlx)
- [parakeet-mlx PyPI](https://pypi.org/project/parakeet-mlx/)

### Whisper & Alternatives
- [whisper.cpp GitHub](https://github.com/ggml-org/whisper.cpp)
- [faster-whisper GitHub](https://github.com/SYSTRAN/faster-whisper)
- [faster-whisper PyPI](https://pypi.org/project/faster-whisper/)
- [Whisper Model Sizes Guide](https://openwhispr.com/blog/whisper-model-sizes-explained)
- [Whisper vs Faster-Whisper (2026)](https://codersera.com/blog/faster-whisper-vs-whisper-cpp-speech-to-text-2026/)

### Accuracy Benchmarks
- [Hugging Face Open ASR Leaderboard](https://huggingface.co/blog/open-asr-leaderboard)
- [OpenWhispr: Parakeet vs Whisper vs Nemotron](https://openwhispr.com/blog/parakeet-vs-whisper-vs-nemotron)
- [VexaScribe: How Accurate is Whisper 2026](https://vexascribe.com/how-accurate-is-whisper)
- [Northflank: Best Open Source STT Models 2026](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks)

### Audio Format & ffmpeg
- [FFmpeg License](https://ffmpeg.org/doxygen/4.4/md_LICENSE.html)
- [FFmpeg Commercial License Guide](https://32blog.com/en/ffmpeg/ffmpeg-commercial-license-guide)
- [Understanding FFmpeg Licensing](https://hoop.dev/blog/understanding-ffmpeg-licensing-what-developers-need-to-know-before-shipping)
- [Parakeet v3 README: Audio Format](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3/blob/main/README.md)

### NeMo Installation & Dependencies
- [NVIDIA NeMo Framework Installation](https://docs.nvidia.com/nemo-framework/user-guide/25.04/installation.html)
- [nemo-toolkit PyPI](https://pypi.org/project/nemo-toolkit/)

### Additional Research
- [QED42: Parakeet TDT 0.6B V2 Deep Dive](https://www.qed42.com/insights/nvidia-parakeet-tdt-0-6b-v2-a-deep-dive-into-state-of-the-art-speech-recognition-architecture)
- [Medium: NVIDIA Parakeet V2 Overview](https://medium.com/data-science-in-your-pocket/nvidia-parakeet-v2-the-smallest-fastest-free-speech-recognition-asr-model-28ee2ccfac51)
- [Medium: NVIDIA Open-Sources 0.6B Parakeet](https://medium.com/@bytefer/nvidia-open-sources-0-6b-7597dabefcb3)
- [NVIDIA NIM: Parakeet Model Card](https://build.nvidia.com/nvidia/parakeet-tdt-0_6b-v2/modelcard)

---

## Appendix: Unverified Claims

Where information could not be fully sourced, the following are marked:

- **UNVERIFIED:** Exact file sizes for parakeet-tdt-1.1b and parakeet-rnnt-1.1b models (~4.5 GB) – estimated based on parameter count vs. parakeet-tdt-0.6b-v2 (2.47 GB)
- **UNVERIFIED:** CPU inference speed of 1.4 RTFx on i7-13700K – based on GPU RTFx extrapolation; actual measurements required
- **UNVERIFIED:** sherpa-onnx binary size (~5-10 MB) – no official specification found; estimated from minimal C++ executables
- **UNVERIFIED:** PyInstaller total bundle sizes (3-4 GB) – dependent on specific inclusion/exclusion of backends; reports vary

---

**Document Version:** 1.0  
**Last Updated:** August 31, 2026  
**Confidence Level:** High for primary sources; medium for community reports and size estimates
