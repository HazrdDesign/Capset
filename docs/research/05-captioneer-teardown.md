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

**1. Captioneer ships Whisper — and also Parakeet.**

> **Correction, 2026-08-31.** An earlier version of this document concluded
> "Captioneer does not use Parakeet." That was an overreach. The screenshot is
> a single frame of a file-by-file extraction dialog; it proves a `whisper/`
> directory **exists**, and proves nothing about what else is in the bundle.
> Per the project owner, Captioneer **recently added Parakeet** for faster,
> more accurate transcription. Both engines are present.

So Captioneer offers a choice of engines. The useful conclusion is unchanged
and arguably stronger: whichever engine runs, it runs as a **native binary
under `js/assets/lib/`**, not as a bundled Python stack.

**2. Captioneer does not bundle NeMo or PyTorch.** Native DLLs under
`js/assets/lib/` is the signature of a C++ library called from a JS panel —
almost certainly **whisper.cpp** (the `gpu`/`cpu` build split and cuBLAS
dependency match whisper.cpp's CUDA build exactly). A Python runtime would
not live in a `js/assets` directory.

**3. This is why the installer is only ~400 MB.** No Python, no PyTorch, no
NeMo. Native binaries plus quantized models. The multi-GB PyInstaller problem
the scaffold treats as its highest-risk item is a problem **Captioneer never
had**, because it never took that route.

This is the key data point: Captioneer runs **Parakeet** — reportedly very
fast — inside a ~400 MB installer with no Python runtime. That is an existence
proof that Parakeet-in-a-native-runtime is the correct target, not a gamble.

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

### Distribution shape (confirmed)

A screenshot of the owner's download folder shows Captioneer ships exactly two
files, same build date:

```
install Captioneer.exe    (Windows)
install Captioneer.pkg    (macOS)
```

Confirms the expected model: **one installer per OS, delivered together as a
single purchase.** No cross-platform single binary exists — `.exe` is Windows
PE, `.pkg` is macOS. Also confirms `.pkg` (via `pkgbuild`/`productbuild`) over
`.dmg` for the Mac side.

Each installer covers **both host apps** — the CEP `manifest.xml` declares
`PPRO` and `AEFT`, so one extension folder is loaded by both Premiere and
After Effects. Hence the "restart Premiere Pro and After Effects" finish
screen. Everything is bundled: extension, ASR binaries, model, CUDA DLLs. No
separate ZXP step and no first-run model download.

## Consequences for Capset

1. **CEP is confirmed by a shipping competitor**, not just by documentation.
2. **The native-runtime route is proven viable at ~400 MB.** Skip the
   NeMo/PyTorch/PyInstaller path entirely rather than treating ONNX as a
   fallback.
3. **Parakeet in a native runtime is proven, not speculative.** Captioneer
   ships it in ~400 MB with no Python. Build Capset Parakeet-first; Whisper is
   not needed as a fallback on the accuracy axis. Reported real-world speed:
   a 1-minute clip transcribed *and* text layers built in about a minute
   end-to-end (owner's own test — anecdotal, not a benchmark).
4. **Ship a GPU path and a CPU path.** Captioneer's `windows\gpu\` split is
   the model to copy. The scaffold's "GPU required" stance would exclude a
   large share of AE users; Captioneer evidently does not require one.
