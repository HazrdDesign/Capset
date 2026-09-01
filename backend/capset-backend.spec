# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Capset transcription service.

ONEDIR, not onefile, and deliberately so: onefile extracts the entire bundle
to a temp directory on every launch. With a ~600 MB ONNX model that is a
multi-second stall each time After Effects starts the service, and it doubles
peak disk use. onedir starts immediately and lets the installer lay the model
down once. Onefile also attracts more antivirus heuristics, which matters for
an unsigned build.

Build:  pyinstaller capset-backend.spec --noconfirm
"""

import os
from PyInstaller.utils.hooks import collect_all, collect_dynamic_libs, collect_submodules

block_cipher = None

# uvicorn resolves its protocol/loop implementations by string at runtime, so
# PyInstaller's static analysis cannot see them. Missing these is the classic
# "works in dev, ImportError in the bundle" failure.
hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
]
binaries = []
datas = []

# collect_all, not collect_dynamic_libs alone. v0.1.3 shipped the
# onnxruntime DLLs but not enough of its Python package for `import
# onnxruntime` to succeed, so onnx_asr's very first import line failed and
# the backend ran permanently degraded. Grab submodules, data files AND
# binaries for both packages rather than guessing which parts matter.
# huggingface_hub is imported inside functions in onnx_asr's resolver, so
# static analysis never sees it. v0.1.4 shipped without it and failed at
# model resolution — after starting cleanly and passing the smoke test.
# hf_xet is one layer deeper and the same shape again: huggingface_hub
# declares it as a base dependency on every 64-bit platform, but imports it
# INSIDE a function (file_download.xet_get) behind a try/except, so static
# analysis never sees it. It ships a compiled Rust extension. Missing it is
# not fatal -- huggingface_hub falls back to plain HTTP with a warning -- but
# the fallback is a slower model download, and "quietly slower" is the kind of
# thing nobody ever tracks down.
for module in ("onnx_asr", "onnxruntime", "huggingface_hub", "hf_xet"):
    try:
        mod_datas, mod_binaries, mod_hidden = collect_all(module)
    except Exception:
        # hf_xet is absent on 32-bit and unusual architectures. The others
        # failing would break the build later and more loudly, which is right.
        continue
    datas += mod_datas
    binaries += mod_binaries
    hiddenimports += mod_hidden

# Optional GPU build; absent on a CPU-only build machine.
try:
    binaries += collect_dynamic_libs("onnxruntime_gpu")
    hiddenimports += collect_submodules("onnxruntime_gpu")
except Exception:
    pass

# Model weights are laid down by the installer next to the executable rather
# than embedded here, so a model update does not mean rebuilding the binary.
# See app/config.py for the frozen-path resolution.
model_dir = os.environ.get("CAPSET_BUNDLE_MODEL_DIR")
if model_dir and os.path.isdir(model_dir):
    datas.append((model_dir, "models"))

a = Analysis(
    # NOT app/main.py: PyInstaller runs the entry script as a top-level
    # module, which breaks that file's package-relative imports at startup.
    # capset_service.py is a thin wrapper that imports `app` absolutely.
    ["capset_service.py"],
    pathex=[os.path.abspath(SPECPATH)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Trim the obvious dead weight; onnxruntime does not need any of these.
    excludes=["tkinter", "matplotlib", "PIL", "pytest", "IPython", "notebook"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="capset-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,          # UPX compression is a strong antivirus heuristic trigger
    # No console window. A terminal sitting on the user's desktop for the
    # life of their After Effects session is not acceptable, and closing it
    # by accident kills transcription. Diagnostics go to a log file instead
    # (see app/logging_setup.py) so support can still ask for them.
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,   # set to "universal2" for a universal macOS build
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="capset-backend",
)
