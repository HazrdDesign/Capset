# macOS .pkg Installer Build & Code Signing Guide

**For:** Adobe CEP extension + bundled Python service on macOS

---

## 1. pkgbuild — Component Package Creation

### Purpose
Creates a component package (`.pkg`) from a payload directory. Component packages are the building blocks that `productbuild` later wraps into a distribution package.

### Command Syntax

```bash
pkgbuild \
  --root <payload-directory> \
  --identifier <com.company.product> \
  --version <version-string> \
  --install-location <destination-path> \
  [--scripts <scripts-directory>] \
  [--ownership preserve] \
  <output.pkg>
```

### Parameters

| Parameter | Example | Purpose |
|-----------|---------|---------|
| `--root` | `./Contents` | Source directory containing all files to install |
| `--identifier` | `com.hazrd.capset` | Unique reverse-domain identifier for the package |
| `--version` | `1.0.0` | Package version (used for upgrade checking) |
| `--install-location` | `/Library/Application Support/Adobe/CEP/extensions/design.hazrd.capset` | Target installation path on user's system |
| `--scripts` | `./Scripts` | Directory containing preinstall/postinstall scripts |
| `--ownership` | `preserve` | Keep original file ownership; use `copy` to reassign to root |

### Complete Example

```bash
# Build a component package for an Adobe CEP extension
pkgbuild \
  --root ./payload \
  --identifier com.hazrd.capset.extension \
  --version 1.0.0 \
  --install-location "/Library/Application Support/Adobe/CEP/extensions/design.hazrd.capset" \
  --scripts ./Scripts \
  --ownership preserve \
  ./capset-extension.pkg
```

### Payload Structure Example

```
payload/
├── Library/
│   └── Application Support/
│       └── Adobe/
│           └── CEP/
│               └── extensions/
│                   └── design.hazrd.capset/
│                       ├── manifest.xml
│                       ├── JSX/
│                       ├── HTML/
│                       └── resources/
└── usr/
    └── local/
        └── bin/
            └── capset-daemon
```

---

## 2. productbuild — Distribution Package Creation

### Purpose
Wraps one or more component packages into a distribution package with UI, license agreement, welcome screen, and installation logic defined in `distribution.xml`.

### Command Syntax

```bash
productbuild \
  --distribution <distribution.xml> \
  --package-path <path-to-packages> \
  [--resources <resources-directory>] \
  <output-distribution.pkg>
```

### Parameters

| Parameter | Example | Purpose |
|-----------|---------|---------|
| `--distribution` | `distribution.xml` | Path to distribution definition XML file |
| `--package-path` | `.` | Directory containing component .pkg files referenced in distribution.xml |
| `--resources` | `./Resources` | Directory with assets (license.txt, welcome.html, etc.) |

### Complete Example

```bash
# Build the final distribution package
productbuild \
  --distribution distribution.xml \
  --package-path . \
  --resources ./Resources \
  Capset-1.0.0.pkg
```

### Auto-generating distribution.xml

If you don't have a distribution.xml, `productbuild` can create a basic one:

```bash
# Generate a minimal distribution.xml from your component package
productbuild \
  --synthesize \
  --package capset-extension.pkg \
  distribution.xml
```

Then edit the generated `distribution.xml` to customize.

---

## 3. distribution.xml — Installation Configuration

### Minimal Distribution XML Example

```xml
<?xml version="1.0" encoding="UTF-8"?>
<installer-gui-script minSpecVersion="2">
    <title>Capset 1.0.0</title>
    
    <welcome file="welcome.html"/>
    <license file="license.txt"/>
    <readme file="readme.txt"/>
    
    <choices-outline>
        <line choice="capsetExtension"/>
    </choices-outline>
    
    <choice id="capsetExtension" 
            title="Capset Adobe Extension + Python Service"
            description="Installs the Capset CEP extension and bundled Python daemon.">
        <pkg-ref id="com.hazrd.capset.extension"/>
    </choice>
    
    <pkg-ref id="com.hazrd.capset.extension" 
             version="1.0.0" 
             onConclusion="None">capset-extension.pkg</pkg-ref>
    
</installer-gui-script>
```

### Key Elements

| Element | Attributes | Purpose |
|---------|-----------|---------|
| `installer-gui-script` | `minSpecVersion` | Root element; use `minSpecVersion="2"` for OS X 10.6.6+ |
| `title` | — | Product name shown in installer |
| `welcome` | `file` | Path to welcome.html (relative to `--resources` dir) |
| `license` | `file` | Path to license.txt file |
| `readme` | `file` | Path to readme.txt file |
| `choices-outline` | — | Container for installation choices |
| `line` | `choice` | Reference to a choice ID |
| `choice` | `id`, `title`, `description` | Install option presented to user |
| `pkg-ref` | `id`, `version`, `onConclusion` | Reference to a component package |

### Resource Files

- `welcome.html` — HTML shown on welcome screen
- `license.txt` — Plaintext or RTF license
- `readme.txt` — Additional info
- These must be in the directory passed to `productbuild --resources`

---

## 4. Preinstall & Postinstall Scripts

### Script Directory Structure

Scripts must be placed in a `Scripts/` directory referenced by pkgbuild's `--scripts` parameter.

```
Scripts/
├── preinstall       (optional)
├── postinstall      (optional)
├── preupgrade       (optional)
└── postupgrade      (optional)
```

### Requirements

- **No file extensions** — named `preinstall`, not `preinstall.sh`
- **Executable permissions** — `chmod 755 <script-name>` **before** building the package
- **Shebang line** — e.g., `#!/bin/bash` at the top
- **Shell** — Runs under `/bin/sh` by default

### Script Execution

| Script | When Runs | Return Code Behavior |
|--------|-----------|---------------------|
| `preinstall` | Before payload extraction | Non-zero return **cancels** installation |
| `postinstall` | After payload extracted and copied | Runs regardless of exit code |

### Environment Variables

Scripts receive standard parameters:

```bash
#!/bin/bash

FULL_PATH="$1"         # Full path to the package being installed
TARGET_LOCATION="$2"   # Full path to target installation directory
MOUNT_POINT="$3"       # Mountpoint of installation disk
BOOT_ROOT="$4"         # Root directory of currently booted system (usually "/")
```

### Example Postinstall Script

```bash
#!/bin/bash

# Install example: start Python daemon on macOS
# $1 = full path to package
# $2 = target installation directory
# $3 = mount point
# $4 = system root

INSTALL_DIR="/usr/local/bin"
PLIST_DIR="/Library/LaunchDaemons"
DAEMON_NAME="com.hazrd.capset-daemon"

# Copy daemon binary if not already present
if [ ! -f "$INSTALL_DIR/capset-daemon" ]; then
    cp "$INSTALL_DIR/capset-daemon" "$INSTALL_DIR/capset-daemon"
    chmod 755 "$INSTALL_DIR/capset-daemon"
fi

# Install LaunchDaemon plist if it exists
if [ -f "$PLIST_DIR/$DAEMON_NAME.plist" ]; then
    # Set proper permissions
    chmod 644 "$PLIST_DIR/$DAEMON_NAME.plist"
    chown root:wheel "$PLIST_DIR/$DAEMON_NAME.plist"
    
    # Load the daemon (requires root, which installer provides)
    launchctl load "$PLIST_DIR/$DAEMON_NAME.plist"
fi

exit 0
```

### Creating Executable Scripts

**Before** building the package:

```bash
chmod 755 Scripts/postinstall Scripts/preinstall
```

Verify permissions:

```bash
ls -la Scripts/
# Output should show: -rwxr-xr-x  ... postinstall
```

---

## 5. Code Signing Binaries

### Ad-hoc Signing (`codesign -s -`)

**For development/local testing only.**

```bash
codesign -s - /path/to/binary
```

**What it does:**
- Signs with a temporary "ad-hoc" identity (no private key)
- Satisfies Apple Silicon requirement to have a signature
- Code can run locally but **will be blocked by Gatekeeper on other Macs if quarantine flag is set**
- Not suitable for distribution

**Why it matters for Apple Silicon:**
- Arm64 native code **cannot execute unsigned**
- Ad-hoc signature is the minimum requirement
- Gatekeeper may still reject it when copied to another Mac (quarantine issue)

### Developer ID Signing

**For distribution and production.**

```bash
codesign -s "Developer ID Application: Your Name (ABCD123456)" \
  -f \
  --options runtime \
  --timestamp \
  /path/to/binary
```

**Parameters:**
- `-s "identifier"` — Certificate identity (must be in Keychain)
- `-f` — Force overwrite existing signature
- `--options runtime` — Enables hardened runtime (required for notarization)
- `--timestamp` — Include timestamp authority (for long-term validity)

**Finding your certificate name:**

```bash
# List all Developer ID Application certificates in Keychain
security find-certificate -c "Developer ID Application" | grep '"labl"'

# Or use Keychain Access GUI to view full names
```

### Verifying Signatures

```bash
# Check if binary is signed
codesign -v /path/to/binary

# Show detailed signing info
codesign -d -v /path/to/binary

# Verify signature is valid for hardened runtime
codesign -d --entitlements :- /path/to/binary
```

---

## 6. productsign — Sign Distribution Package

**CRITICAL DISTINCTION:**
- Use **Developer ID Installer** certificate for `.pkg` files (distribution packages)
- **NOT** Developer ID Application
- Wrong certificate type causes: "The installer archive will fail on the destination Mac"

### Command Syntax

```bash
productsign \
  --sign "Developer ID Installer: Your Name (ABCD123456)" \
  [--timestamp] \
  <unsigned-distribution.pkg> \
  <signed-distribution.pkg>
```

### Parameters

| Parameter | Purpose |
|-----------|---------|
| `--sign` | Full certificate name (must be Developer ID Installer type) |
| `--timestamp` | Include timestamp (optional but recommended for long-term validity) |

### Complete Example

```bash
# Sign the distribution package
productsign \
  --sign "Developer ID Installer: Hazrd (ABC123XYZ789)" \
  --timestamp \
  Capset-unsigned.pkg \
  Capset-1.0.0.pkg
```

### Verifying Package Signature

```bash
# Check package signature validity
pkgutil --check-signature Capset-1.0.0.pkg

# Output on valid package:
# Certificate Chain:
#   1. Developer ID Installer: Hazrd (ABC123XYZ789)
#   ...
# Valid on this system.
```

### Certificate Validity Impact

- If your Developer ID Installer certificate **expires**, signed packages will **no longer launch**
- You must **re-sign packages** with a valid certificate
- Users cannot work around an expired Developer ID signature

---

## 7. Notarization — Apple's Malware Scan

### Prerequisites

1. **Developer ID program membership** (Apple Developer account with Developer ID)
2. **Credentials stored** in Keychain (via `notarytool store-credentials`)
3. **Signed package** (with Developer ID Installer certificate from § 6)

### Step 1: Store Notarization Credentials

Two authentication methods available:

#### Option A: App Store Connect API Key (Recommended)

```bash
# Create/obtain an API key from https://appstoreconnect.apple.com/access/api
# Key ID = 10 alphanumeric characters
# Issuer ID = UUID format

xcrun notarytool store-credentials "capset-notarization" \
  --key ~/Downloads/AuthKey_ABCD123456.p8 \
  --key-id ABCD123456 \
  --issuer 12345678-1234-1234-1234-123456789012
```

#### Option B: Apple ID + App-Specific Password

```bash
xcrun notarytool store-credentials "capset-notarization" \
  --apple-id your-apple-id@example.com \
  --password your-app-specific-password \
  --team-id ABCD123456
```

**Then enter your Keychain password when prompted.**

### Step 2: Submit Package for Notarization

```bash
xcrun notarytool submit Capset-1.0.0.pkg \
  --keychain-profile "capset-notarization" \
  --wait
```

**Parameters:**
- `--keychain-profile` — Name from `store-credentials` step
- `--wait` — Block and wait for completion (polls Apple's service)
  - Without `--wait`, command returns immediately; you must poll status manually
  - With `--wait`, typical completion is 5-15 minutes, can take hours
  - Exit code 0 = notarization successful

### Step 3: Retrieve Notarization Log (on failure)

```bash
# If submission fails, retrieve the log for details
xcrun notarytool log <submission-id> \
  --keychain-profile "capset-notarization"

# submission-id is returned by submit command or available from:
xcrun notarytool retrieve-results <package-filename> \
  --keychain-profile "capset-notarization"
```

### Step 4: Staple Notarization Ticket

Once notarization succeeds, attach the ticket to the package:

```bash
xcrun stapler staple Capset-1.0.0.pkg
```

**What stapling does:**
- Embeds the notarization ticket **inside** the .pkg file
- Users **don't need** internet connection to verify on first run
- Without stapling, users need network access for Gatekeeper to phone home to Apple

### Verifying Staple

```bash
# Check if ticket is stapled
xcrun stapler validate Capset-1.0.0.pkg

# Output on success:
# Processing Capset-1.0.0.pkg
# The staple and validate action worked!
```

### Complete Notarization Workflow

```bash
#!/bin/bash
set -e

PKG="Capset-1.0.0.pkg"
PROFILE="capset-notarization"

echo "Signing package with Developer ID Installer..."
productsign \
  --sign "Developer ID Installer: Hazrd (ABC123XYZ789)" \
  --timestamp \
  Capset-unsigned.pkg \
  "$PKG"

echo "Submitting for notarization (this may take 5-60 minutes)..."
xcrun notarytool submit "$PKG" \
  --keychain-profile "$PROFILE" \
  --wait

echo "Stapling notarization ticket..."
xcrun stapler staple "$PKG"

echo "Verifying staple..."
xcrun stapler validate "$PKG"

echo "Done! Package is ready for distribution."
```

---

## 8. Gatekeeper Behavior — Unsigned/Un-notarized Packages

### Unsigned Package (`-` flag, ad-hoc signed, or no signature)

On modern macOS (Monterey+):

1. User downloads `.pkg` file
2. File gets **quarantine flag** set (metadata)
3. User double-clicks installer
4. **Gatekeeper blocks**, shows dialog: *"Cannot open '[Package]' because it is from an unidentified developer."*

### User's Steps to Override

The user must:

1. **Dismiss** the error dialog
2. Open **System Settings** → **Privacy & Security**
3. Scroll to bottom, find **Security** section
4. Click **"Open Anyway"** button next to the blocked package
5. Confirm again in the dialog that appears
6. Installation proceeds

### Gatekeeper Checks

Gatekeeper validates (in order):

1. Is the package **code signed** with a Developer ID?
2. Is the certificate **valid and not expired**?
3. Is the package **notarized** by Apple (recent macOS)?

**Result if all fail:** Package cannot run without user override.

### Developer ID Signed but Not Notarized

- **Monterey (10.12)**: Runs without notarization
- **Ventura (13) - Sonoma (14)**: Warns but allows install after override
- **Sequoia (15)+**: Increasingly strict; notarization recommended

### Fully Notarized & Signed

- No warnings
- Gatekeeper recognizes as safe
- Users see **no security dialogs**

---

## 9. Universal Binaries — arm64 + x86_64

### Check Binary Architecture

```bash
# List architectures in a binary
lipo -info /path/to/binary

# Output example:
# Architectures in the file: x86_64 arm64

# Get detailed info
lipo -detailed_info /path/to/binary
```

### Create Universal Binary from Two Slices

```bash
# Combine arm64 and x86_64 binaries into universal
lipo -create \
  arm64_binary \
  x86_64_binary \
  -output universal_binary
```

**Example:**

```bash
# Build Python daemon for both architectures, then combine
lipo -create \
  ./build/arm64/capset-daemon \
  ./build/x86_64/capset-daemon \
  -output ./payload/usr/local/bin/capset-daemon
```

### Extract Specific Architecture

```bash
# Extract arm64 slice from universal binary
lipo -thin arm64 universal_binary -output arm64_binary

# Extract x86_64 slice
lipo -thin x86_64 universal_binary -output x86_64_binary
```

### Re-signing Universal Binaries

After using `lipo -create`, the resulting binary has **old signatures** from each slice. Re-sign:

```bash
# Re-sign the universal binary (overwrites old signatures)
codesign -s "Developer ID Application: Your Name (ABC123)" \
  -f \
  --options runtime \
  --timestamp \
  universal_binary
```

The `-f` flag is **required** to overwrite the old ad-hoc signatures from each architecture.

---

## 10. GitHub Actions CI/CD — Building & Signing on macOS Runner

### Runner Selection

```yaml
runs-on: macos-latest
```

or

```yaml
runs-on: macos-13  # or macos-14, macos-15 for specific versions
```

- `macos-latest` uses the most recent available image
- Runner includes Xcode, pkgbuild, productbuild, codesign, etc.

### Storing Certificates as Secrets

1. **Convert .p12 to Base64:**

```bash
# On your local Mac
base64 -i MyCertificate.p12 -o MyCertificate.p12.base64
```

2. **Add to GitHub Secrets:**
   - Go to Repo → Settings → Secrets and Variables → Actions
   - Create secrets:
     - `BUILD_CERTIFICATE_BASE64` = (content of .p12.base64)
     - `BUILD_CERTIFICATE_PASSWORD` = (password for .p12)
     - `KEYCHAIN_PASSWORD` = (password for temporary keychain; can be anything)

### Workflow Example — Build & Sign Package

```yaml
name: Build macOS Installer

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build:
    runs-on: macos-latest
    
    env:
      DEVELOPER_DIR: /Applications/Xcode.app/Contents/Developer
    
    steps:
    - uses: actions/checkout@v4
    
    # Create temporary Keychain and import certificate
    - name: Setup Keychain
      env:
        CERTIFICATE_BASE64: ${{ secrets.BUILD_CERTIFICATE_BASE64 }}
        CERTIFICATE_PASSWORD: ${{ secrets.BUILD_CERTIFICATE_PASSWORD }}
        KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
      run: |
        # Create temporary keychain
        security create-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
        security default-keychain -s build.keychain
        security unlock-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
        
        # Import certificate
        echo "$CERTIFICATE_BASE64" | base64 --decode > certificate.p12
        security import certificate.p12 \
          -k build.keychain \
          -P "$CERTIFICATE_PASSWORD" \
          -T /usr/bin/codesign \
          -T /usr/bin/productsign
        
        # Allow codesign to use the certificate without prompting
        security set-key-partition-list -S apple-tool:,apple: -k "$KEYCHAIN_PASSWORD" build.keychain
        
        # Clean up
        rm certificate.p12
      
    - name: Build Component Package
      run: |
        pkgbuild \
          --root ./payload \
          --identifier com.hazrd.capset.extension \
          --version 1.0.0 \
          --install-location "/Library/Application Support/Adobe/CEP/extensions/design.hazrd.capset" \
          --scripts ./Scripts \
          --ownership preserve \
          ./capset-extension.pkg
    
    - name: Build Distribution Package
      run: |
        productbuild \
          --distribution distribution.xml \
          --package-path . \
          --resources ./Resources \
          Capset-unsigned.pkg
    
    - name: Sign Package
      env:
        CERTIFICATE_NAME: ${{ secrets.DEVELOPER_ID_INSTALLER_NAME }}
      run: |
        productsign \
          --sign "$CERTIFICATE_NAME" \
          --timestamp \
          Capset-unsigned.pkg \
          Capset-1.0.0.pkg
    
    - name: Verify Signature
      run: |
        pkgutil --check-signature Capset-1.0.0.pkg
    
    - name: Upload Artifact
      uses: actions/upload-artifact@v3
      with:
        name: capset-installer
        path: Capset-1.0.0.pkg
    
    # Clean up keychain
    - name: Cleanup
      if: always()
      run: |
        security delete-keychain build.keychain || true
```

### Additional Secrets Needed

Add to GitHub Secrets:
- `DEVELOPER_ID_INSTALLER_NAME` = `"Developer ID Installer: Your Name (ABC123)"`

### Important Notes

- **Keychain is temporary** — created during job, deleted after
- **macOS runners are ephemeral** — no secrets left behind
- **Signing credentials in environment** — use `${{ secrets.* }}` to inject safely
- **Build succeeds locally?** Test signing locally first, then replicate in Actions

---

## 11. Building .pkg on Linux

### Short Answer

**No.** Strictly requires macOS.

- `pkgbuild` and `productbuild` are Apple tools, only available on macOS
- `.pkg` format is native to macOS only

### Cross-Platform Alternative: apepkg

For Linux CI/CD builds, use **apepkg** (port of munki-pkg):

```bash
# Installation on Linux (requires Python)
pip install apepkg

# Build .pkg from Linux
apepkg build -o Capset-1.0.0.pkg payload/
```

- Uses open-source tools (`xar`, `bomutils`)
- Produces standard macOS `.pkg` files
- Works in Docker, GitHub Actions Linux runners, etc.

**Caveat:** `apepkg` generates **unsigned packages**. You must:

1. Build the `.pkg` on Linux with apepkg
2. Transfer to macOS
3. Sign with `productsign` (requires macOS)
4. Notarize (requires macOS + Developer ID account)

### Recommendation

- **Develop on macOS** using native tools (`pkgbuild`, `productbuild`)
- **CI/CD on macOS runner** (GitHub Actions `macos-latest`)
- Simpler, fewer moving parts

---

## Checklist — End-to-End Build & Sign Workflow

- [ ] **Prepare payload directory** with CEP extension files and Python binary
- [ ] **Create Scripts/postinstall** (make executable: `chmod 755`)
- [ ] **Create distribution.xml** with title, welcome, license
- [ ] **Create resource files** (welcome.html, license.txt, readme.txt)
- [ ] **Build component package** with `pkgbuild`
- [ ] **Build distribution package** with `productbuild`
- [ ] **Code sign** binaries (Python daemon) with Developer ID Application
- [ ] **Sign package** with `productsign` and Developer ID Installer
- [ ] **Obtain Developer ID Installer certificate** (if not already done)
- [ ] **Set up notarization credentials** with `notarytool store-credentials`
- [ ] **Notarize package** with `xcrun notarytool submit --wait`
- [ ] **Staple ticket** with `xcrun stapler staple`
- [ ] **Verify staple** with `xcrun stapler validate`
- [ ] **Test install** on a clean VM (if possible)

---

## Sources

- [Distribution XML Reference](https://developer.apple.com/library/archive/documentation/DeveloperTools/Reference/DistributionDefinitionRef/Chapters/Distribution_XML_Ref.html)
- [About Distribution Definition Files](https://developer.apple.com/library/archive/documentation/DeveloperTools/Reference/DistributionDefinitionRef/Chapters/Introduction.html)
- [Packaging Mac Software for Distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
- [TN3147: Migrating to the Latest Notarization Tool](https://developer.apple.com/documentation/technotes/tn3147-migrating-to-the-latest-notarization-tool)
- [Customizing the Notarization Workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
- [Signing Mac Software with Developer ID](https://developer.apple.com/developer-id/)
- [Building a Universal macOS Binary](https://developer.apple.com/documentation/apple-silicon/building-a-universal-macos-binary)
- [Code Signing Guide — Code Signing Tasks](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html)
- [Code Signing Guide — Code Requirement Language](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/RequirementLang/RequirementLang.html)
- [Gatekeeper and Runtime Protection in macOS](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web)
- [Safely Open Apps on Your Mac](https://support.apple.com/en-us/102445)
- [Sign a Mac Installer Package with a Developer ID Certificate](https://help.apple.com/xcode/mac/current/en.lproj/deve51ce7c3d.html)
- [GitHub Actions: Installing an Apple Certificate on macOS Runners](https://docs.github.com/en/actions/deployment/deploying-xcode-applications/installing-an-apple-certificate-on-macos-runners-for-xcode-development)
- [Apple Developer Forums — Code Signing & Notarization](https://developer.apple.com/forums/topics/code-signing-topic/)
- [Build an OSX .pkg Installer from Linux](https://gist.github.com/SchizoDuckie/2a1a1cc71284e6463b9a)
- [apepkg — macOS Package Builder for Linux](https://github.com/peetinc/ape-pkg)

---

## Unverified Notes

**UNVERIFIED:** Exact behavior of newer macOS versions (Sequoia 15+) regarding notarization enforcement — documentation is still evolving. Test on target OS versions.

**UNVERIFIED:** apepkg maintainability and feature parity with Apple's native tools — verify for production use.
