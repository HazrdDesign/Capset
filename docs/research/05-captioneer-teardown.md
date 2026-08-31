# Captioneer teardown — evidence from installer screenshots

Source: four installer screenshots + one extension-manager screenshot supplied
by the project owner, 2026-08-31. This supersedes assumptions in the original
scaffold about how Captioneer is built.

## What the screenshots actually prove

### Install path (screenshot 3 — the important one)

The progress dialog shows this file being extracted:

```
C:\...\extensions\com.aescripts.captioneer\js\assets\lib\whisper\windows\gpu\cublas64_12.dll
```

Every segment of that path is informative:

| Segment | What it proves |
|---|---|
| `\extensions\` | CEP extensions directory. Captioneer is a **CEP** extension. |
| `com.aescripts.captioneer` | Reverse-DNS CEP bundle ID, `aescripts` namespace (sold via aescripts.com). |
| `\js\assets\lib\` | Assets live under the **JavaScript panel** tree — a CEP/HTML panel layout. |
| `\whisper\` | **The ASR engine is Whisper, not Parakeet.** |
| `\windows\gpu\` | Platform- and compute-split native binaries. A sibling `windows\cpu\` almost certainly exists. |
| `cublas64_12.dll` | CUDA 12 cuBLAS — a GPU-accelerated **native** build. |

### Corrections to prior assumptions

**1. Captioneer does not use Parakeet.** The original scaffold README states
"Captioneer (existing AE plugin) already does Parakeet-based captioning."
The install tree says `whisper`. Everything downstream of that assumption
needs re-examining.

**2. Captioneer does not bundle NeMo or PyTorch.** Native DLLs under
`js/assets/lib/` is the signature of a C++ library called from a JS panel —
almost certainly **whisper.cpp** (the `gpu`/`cpu` build split and cuBLAS
dependency match whisper.cpp's CUDA build exactly). A Python runtime would
not live in a `js/assets` directory.

**3. This is why the installer is only ~400 MB.** No Python, no PyTorch, no
NeMo. Native binary plus a quantized GGML/GGUF model. The multi-GB
PyInstaller problem the scaffold treats as its highest-risk item is a problem
**Captioneer never had**, because it never took that route.

### Other screenshots

- **1, 2, 4** — Wizard chrome, EULA step, "Captioneer LLC", left banner
  images on welcome/finish pages. This is almost certainly **Inno Setup**
  (that is Inno's default wizard layout). NSIS is the only other realistic
  candidate; Inno is the better match.
- **4** — "Please restart Premiere Pro and After Effects now." Captioneer
  installs into **both** hosts. Its AE support exists but, per the project
  owner, lacks the animation features present in Premiere.
- **5** — Anastasiy's Extension Manager listing Captioneer 1.8.1, compatible
  2026–2020, alongside other CEP extensions (Atom, AutoCaption, Flow,
  Frame.io). Note this manager **lists** installed extensions; it did not
  install Captioneer — the .exe did. Independent confirmation of CEP.

## Consequences for Capset

1. **CEP is confirmed by a shipping competitor**, not just by documentation.
2. **The native-runtime route is proven viable at ~400 MB.** Skip the
   NeMo/PyTorch/PyInstaller path entirely rather than treating ONNX as a
   fallback.
3. **Accuracy is an opening.** A 400 MB installer implies a small/quantized
   Whisper model (base or small), which sits well below Parakeet TDT 0.6B on
   the Open ASR Leaderboard. Shipping Parakeet at a comparable installer size
   is a genuine, defensible differentiator — *provided* CPU-side speed is
   measured and acceptable.
4. **Ship a GPU path and a CPU path.** Captioneer's `windows\gpu\` split is
   the model to copy. The scaffold's "GPU required" stance would exclude a
   large share of AE users; Captioneer evidently does not require one.
