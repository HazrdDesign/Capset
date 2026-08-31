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

set -euo pipefail

VERSION="${1:-0.1.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD="$ROOT/build"
PAYLOAD="$BUILD/payload"
ROOTDIR="$BUILD/pkgroot"
DIST="$ROOT/dist"
IDENTIFIER="design.hazrd.capset"

echo "==> Staging payload"
python3 "$ROOT/installer/build_payload.py" \
  --backend-dist "$ROOT/backend/dist/capset-backend" \
  --version "$VERSION"

echo "==> Laying out install root"
rm -rf "$ROOTDIR"
mkdir -p "$ROOTDIR/Library/Application Support/Adobe/CEP/extensions/$IDENTIFIER"
mkdir -p "$ROOTDIR/Library/Application Support/Capset"
cp -R "$PAYLOAD/panel/." \
      "$ROOTDIR/Library/Application Support/Adobe/CEP/extensions/$IDENTIFIER/"
cp -R "$PAYLOAD/backend/." "$ROOTDIR/Library/Application Support/Capset/"

# Apple Silicon refuses to execute unsigned arm64 binaries outright -- SIGKILL,
# not a warning, and not bypassable. Ad-hoc signing satisfies that and needs no
# Apple account. This is separate from notarisation: skip notarisation and you
# get a Gatekeeper prompt; skip this and the build simply does not run.
echo "==> Ad-hoc signing binaries"
find "$ROOTDIR/Library/Application Support/Capset" -type f -perm -u+x -print0 |
  while IFS= read -r -d '' bin; do
    codesign --force --sign - "$bin" 2>/dev/null || true
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
    <options customize="never" require-scripts="false" hostArchitectures="arm64,x86_64"/>
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
