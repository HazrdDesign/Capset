# Installer / Bundling

Phase 1, step 3 (see `backend/README.md`). Do not start this until
`app/transcribe.py` and `app/main.py` are confirmed working in a normal
dev venv first.

## Goal

A single self-contained .exe that:
- requires no user-side Python, CUDA toolkit, or pip installs
- launches the FastAPI service on `localhost:8756`
- the UXP panel can shell out to / launch on demand, or the user runs once
  and leaves running in the background (decide based on how bundling goes —
  a persistent background service avoids reload time per session, but adds
  "is it running" UX complexity for the panel to handle)

## Known risk areas (address these first, not last)

- **CUDA + PyTorch bundling size and portability.** PyInstaller doesn't
  always correctly detect PyTorch's CUDA extension modules or NeMo's
  dynamic imports. Expect to need explicit `--hidden-import` flags and
  probably a custom `.spec` file rather than the default one-liner build.
- **NVIDIA driver dependency.** Bundling CUDA runtime libraries doesn't
  remove the need for the *user's* machine to have a compatible NVIDIA
  driver installed. This can't be bundled away — document as a minimum
  requirement (specific driver version TBD once dev environment's CUDA
  version is confirmed).
- **Model weights.** Decide whether weights ship inside the .exe (simplest
  for the user, makes for a very large installer — likely multiple GB) or
  download on first run (smaller installer, requires internet on first
  launch, needs a progress/status UI in the panel for that wait).
- **Fallback plan**: if PyInstaller + CUDA proves too fragile, an
  ONNX-exported version of Parakeet run via ONNXRuntime (with the
  DirectML or CUDA execution provider) is a lighter-weight and more
  portable alternative at inference time — bigger one-time conversion
  effort, much simpler bundle after that. Worth a quick spike if the
  PyInstaller route stalls for more than a day or two.

## Build command (once app works)

```bash
cd backend
pyinstaller --name parakeet-service --onefile app/main.py
```

This is a starting point, not a final command — expect to need a proper
`.spec` file once hidden imports and data files (model weights, if bundled)
need to be specified explicitly.
