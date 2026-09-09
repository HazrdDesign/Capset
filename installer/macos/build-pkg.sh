#!/usr/bin/env bash
# Build a macOS .pkg for Capset.
#
# Must run ON macOS: pkgbuild/productbuild are macOS-only, and PyInstaller is
# not a cross-compiler.
#
#   ./installer/macos/build-pkg.sh 0.1.0
#
# Signing and notarisation are opt-in via environment variables. Without them
# the package still builds and installs, but Gatekeeper makes the user go to
# System Settings > Privacy & Security > Open Anyway.
#
#   DEVELOPER_ID_INSTALLER="Developer ID Installer: Name (TEAMID)"
#   NOTARY_PROFILE="capset"      # from: xcrun notarytool store-credentials
#
# The speech model is bundled when CAPSET_MODEL_DIR points at a populated
# directory (stage one with `python backend/capset_service.py --stage-model`).
# Without it the package still builds, but the installed Capset downloads
# ~600 MB on first use -- the dependency bundling exists to remove.
#
#   CAPSET_MODEL_DIR="$PWD/build/model"

set -euo pipefail

VERSION="${1:-0.1.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD="$ROOT/build"
PAYLOAD="$BUILD/payload"
ROOTDIR="$BUILD/pkgroot"
DIST="$ROOT/dist"
IDENTIFIER="design.hazrd.capset"

# PyInstaller is not a cross-compiler and neither is it a universal builder:
# it produces a binary for the interpreter it runs under, and onnxruntime
# publishes macOS wheels for arm64 only (no x86_64, no universal2). So this
# package is Apple Silicon only, and it says so in the distribution below
# rather than installing on an Intel Mac and failing at launch.
ARCH="$(uname -m)"
case "$ARCH" in
  arm64)  HOST_ARCHS="arm64" ;;
  x86_64) HOST_ARCHS="x86_64" ;;
  *) echo "unsupported build architecture: $ARCH" >&2; exit 1 ;;
esac
echo "==> Building for $HOST_ARCHS"

echo "==> Staging payload"
STAGE_ARGS=(
  --backend-dist "$ROOT/backend/dist/capset-backend"
  --version "$VERSION"
)
if [ -n "${CAPSET_MODEL_DIR:-}" ]; then
  STAGE_ARGS+=(--model-dir "$CAPSET_MODEL_DIR")
else
  echo "    NOTE: CAPSET_MODEL_DIR is not set, so no speech model is bundled."
  echo "    The installed Capset will download it on first use."
fi
python3 "$ROOT/installer/build_payload.py" "${STAGE_ARGS[@]}"

echo "==> Laying out install root"
rm -rf "$ROOTDIR"
mkdir -p "$ROOTDIR/Library/Application Support/Adobe/CEP/extensions/$IDENTIFIER"
mkdir -p "$ROOTDIR/Library/Application Support/Capset"
cp -R "$PAYLOAD/panel/." \
      "$ROOTDIR/Library/Application Support/Adobe/CEP/extensions/$IDENTIFIER/"
cp -R "$PAYLOAD/backend/." "$ROOTDIR/Library/Application Support/Capset/"
if [ -d "$PAYLOAD/model" ]; then
  # app/config._bundled_model_dir() looks for "model" beside the executable.
  echo "==> Bundling the speech model"
  cp -R "$PAYLOAD/model" "$ROOTDIR/Library/Application Support/Capset/model"
fi

# Tell the panel where the backend is, so it can start the service on demand.
# The install location is fixed on macOS, unlike Windows, but the panel reads
# the same file on both platforms rather than carrying two code paths.
printf '%s' "/Library/Application Support/Capset/capset-backend" > \
  "$ROOTDIR/Library/Application Support/Adobe/CEP/extensions/$IDENTIFIER/backend-path.txt"

# Apple Silicon refuses to execute unsigned arm64 binaries outright -- SIGKILL,
# not a warning, and not bypassable. Ad-hoc signing satisfies that and needs no
# Apple account. This is separate from notarisation: skip notarisation and you
# get a Gatekeeper prompt; skip this and the build simply does not run.
#
# Every Mach-O file, not just the ones with the executable bit: a PyInstaller
# bundle is mostly .so and .dylib, the loader checks those too, and they are
# not marked executable. Signing only what `find -perm -u+x` turns up leaves
# the libraries unsigned and the backend dies on first import.
echo "==> Ad-hoc signing binaries"
find "$ROOTDIR/Library/Application Support/Capset" -type f \
     \( -perm -u+x -o -name '*.so' -o -name '*.dylib' \) -print0 |
  while IFS= read -r -d '' bin; do
    # Skip anything that is not actually Mach-O (scripts, data files that
    # happen to carry the executable bit).
    if file -b "$bin" | grep -q 'Mach-O'; then
      codesign --force --sign - --timestamp=none "$bin" || {
        echo "::error::could not ad-hoc sign $bin" >&2
        exit 1
      }
    fi
  done

echo "==> Building component package"
mkdir -p "$DIST" "$BUILD/scripts"
cat > "$BUILD/scripts/postinstall" <<'POST'
#!/bin/bash
# CEP will not load an unsigned extension unless debug mode is on, and this
# build is unsigned. The CSXS version differs per host release, so set them
# all; keys for versions that are not installed are harmless.
for v in 9 10 11 12; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 2>/dev/null || true
done
exit 0
POST
chmod 755 "$BUILD/scripts/postinstall"

pkgbuild \
  --root "$ROOTDIR" \
  --identifier "$IDENTIFIER" \
  --version "$VERSION" \
  --scripts "$BUILD/scripts" \
  --install-location "/" \
  "$BUILD/capset-component.pkg"

echo "==> Building distribution package"
cat > "$BUILD/distribution.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="1">
    <title>Capset $VERSION</title>
    <organization>design.hazrd</organization>
    <options customize="never" require-scripts="false" hostArchitectures="$HOST_ARCHS"/>
    <license file="LICENSE.txt"/>
    <pkg-ref id="$IDENTIFIER"/>
    <choices-outline><line choice="default"><line choice="$IDENTIFIER"/></line></choices-outline>
    <choice id="default"/>
    <choice id="$IDENTIFIER" visible="false"><pkg-ref id="$IDENTIFIER"/></choice>
    <pkg-ref id="$IDENTIFIER" version="$VERSION" onConclusion="none">capset-component.pkg</pkg-ref>
</installer-gui-script>
XML
cp "$ROOT/LICENSE.txt" "$BUILD/LICENSE.txt"

UNSIGNED="$BUILD/Capset-$VERSION-unsigned.pkg"
productbuild \
  --distribution "$BUILD/distribution.xml" \
  --package-path "$BUILD" \
  --resources "$BUILD" \
  "$UNSIGNED"

FINAL="$DIST/Capset-$VERSION.pkg"
if [ -n "${DEVELOPER_ID_INSTALLER:-}" ]; then
  echo "==> Signing package"
  # NOTE: .pkg needs "Developer ID Installer", NOT "Developer ID Application".
  productsign --sign "$DEVELOPER_ID_INSTALLER" "$UNSIGNED" "$FINAL"
else
  echo "==> No DEVELOPER_ID_INSTALLER set; leaving package unsigned"
  cp "$UNSIGNED" "$FINAL"
fi

if [ -n "${NOTARY_PROFILE:-}" ]; then
  echo "==> Notarising (this waits for Apple)"
  xcrun notarytool submit "$FINAL" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$FINAL"
else
  echo "==> No NOTARY_PROFILE set; skipping notarisation."
  echo "    Users will need System Settings > Privacy & Security > Open Anyway."
fi

echo "==> Done: $FINAL"
