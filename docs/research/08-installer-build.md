# Windows Installer Build Research: Python Service + Adobe CEP Extension

**Date:** August 31, 2026  
**Scope:** PyInstaller, Inno Setup, GitHub Actions integration  
**Verified:** Official documentation from pyinstaller.org, jrsoftware.org, docs.github.com, and community reports

---

## A. PyInstaller

### 1. `--onefile` vs `--onedir` for FastAPI/uvicorn Service

**Recommendation:** Use `--onedir` for services bundled inside an installer.

**Justification:**
- **Startup Time:** One-file bundles are "a little slower to start up" than one-folder bundles because the bootloader creates a temporary directory and extracts contents to it on each startup
- **Installer Perspective:** For a service installed in `Program Files`, startup overhead compounds; `--onedir` keeps extracted files in place
- **Antivirus Impact:** One-file requires extraction on each run, triggering more antivirus checks; one-dir avoids this
- **Debugging:** One-dir mode is much easier to diagnose problems in
- **Deployment:** One-dir is more transparent for an installer — all service files are visible on disk at `{installdir}/service/`

**When to Use --onefile:**
- Desktop GUI applications where single icon is user-friendly
- Portable applications
- Not ideal for Windows services

**When to Use --onedir:**
- Services (your use case)
- Applications bundled in installers
- When startup performance matters

---

### 2. PyInstaller Spec File: Complete Minimal Example

**Generate the spec file first:**
```bash
pyi-makespec --onedir --name MyService --add-data "data:data" --hidden-import uvicorn.logging MyService.py
```

**Minimal `.spec` file structure:**

```python
# MyService.spec
# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['MyService.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('data', 'data'),  # (source_path, dest_folder_in_bundle)
        ('models/model.onnx', 'models'),
        ('config.yaml', '.'),
    ],
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops.auto',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan.on',
        'fastapi',
        'pydantic',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludedimports=[],
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
    name='MyService',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # Disable UPX to reduce antivirus false positives
    console=True,  # True for service, False for GUI
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='icon.ico',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='MyService',
)
```

**Key Parameters:**
- `datas`: List of tuples `(source_path, dest_folder)` — paths are relative to project root
- `hiddenimports`: List of module names to forcibly include
- `console=True`: Shows console window (needed for services)
- `console=False`: Hides console (GUI apps)
- `icon='icon.ico'`: Path to 256×256 .ico file
- `upx=False`: Prevents UPX compression (reduces false positives)

---

### 3. Hidden Imports: Uvicorn and FastAPI

**Verified Hidden Imports Required:**

```python
hiddenimports=[
    # Uvicorn dynamic loaders (requires hook or explicit imports)
    'uvicorn.logging',
    'uvicorn.loops.auto',          # Selects event loop at runtime
    'uvicorn.protocols.http.auto',  # Selects HTTP protocol at runtime
    'uvicorn.protocols.websockets.auto',  # Selects WebSocket protocol
    'uvicorn.lifespan.on',          # Lifespan event handling
    
    # FastAPI and dependencies
    'fastapi',
    'pydantic',
    'pydantic.json',
    'sqlalchemy.dialects.sqlite',   # If using SQLAlchemy
]
```

**Why needed:**
- Uvicorn uses dynamic imports with `importlib` to select protocols and event loops at runtime
- PyInstaller's static analysis misses these, so they must be explicitly declared
- PyInstaller has a hook for uvicorn (`Hook-uvicorn.py` in PyInstaller's hooks directory), but explicit declaration is more reliable

**Alternative: Use `collect_submodules()`**
```python
from PyInstaller.utils.hooks import collect_submodules
hiddenimports=collect_submodules('uvicorn') + ['fastapi', 'pydantic']
```

---

### 4. Bundling Large Data Files (ONNX Models)

**Pattern for Runtime Access:**

```python
import sys
import os

def get_bundle_dir():
    """Return path to bundled data files.
    
    When running as:
    - One-dir bundle: returns path to _internal folder
    - One-file bundle: returns path to temp extraction folder
    - Source code: returns path to project directory
    """
    if getattr(sys, 'frozen', False):
        # Running as bundled executable
        bundle_dir = sys._MEIPASS
    else:
        # Running as source
        bundle_dir = os.path.abspath(os.path.dirname(__file__))
    return bundle_dir

# Load ONNX model
def load_model():
    bundle_dir = get_bundle_dir()
    model_path = os.path.join(bundle_dir, 'models', 'model.onnx')
    
    # Verify file exists before loading
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model not found at {model_path}")
    
    import onnx
    model = onnx.load(model_path)
    return model
```

**In `.spec` file:**
```python
datas=[
    ('models/model.onnx', 'models'),  # Bundles models/model.onnx → {bundle}/models/model.onnx
    ('data', 'data'),                  # Copies entire data/ folder
]
```

**Path Resolution:**
| Mode | `sys._MEIPASS` |
|------|---|
| `--onedir` | `<install_dir>/MyService/_internal` |
| `--onefile` | Windows temp folder (e.g., `C:\Users\...\AppData\Local\Temp\_MEI...`) |
| Source | Project root directory |

---

### 5. Antivirus False Positives

**Root Causes:**
1. **UPX Compression:** PyInstaller's default UPX packing is a classic antivirus red flag
2. **No PE Metadata:** Executable lacks company name, version, copyright — these are positive trust signals
3. **ML-based Detection:** Antivirus ML models treat "unknown executable that unpacks code" as suspicious
4. **CheckSum:** Different PyInstaller versions produce different checksums, requiring re-memorization by AV engines

**Mitigation Strategies (in order of effectiveness):**

| Strategy | Impact | Effort |
|----------|--------|--------|
| Disable UPX (`upx=False`) | **High** — removes classic red flag | Minimal |
| Add PE Metadata + Code Signing | **High** — provides trust signals | Medium (requires certificate) |
| Generate on latest PyInstaller | Medium | Low |
| Avoid one-file mode | Low-Medium | Low |

**Implementation:**

```python
# In .spec file
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='MyService',
    debug=False,
    upx=False,  # <-- Disable UPX
    console=True,
    icon='icon.ico',
)
```

**Code Signing (Advanced):**
Use Windows `signtool.exe` to sign the executable after PyInstaller completes:
```bash
signtool sign /f certificate.pfx /p password /t http://timestamp.server /d "My Service" MyService.exe
```

---

## B. Inno Setup

### 6. Minimal Complete `.iss` Script

**Minimal working example:**

```ini
; MyService-Setup.iss
; Inno Setup Script for Python Service + Adobe CEP Extension

[Setup]
AppName=My Service
AppVersion=1.0.0
AppPublisher=My Company
DefaultDirName={autopf}\MyService
DefaultGroupName=My Company\My Service
OutputDir=.\output
OutputBaseFilename=MyService-Setup-1.0.0
PrivilegesRequired=admin
WizardStyle=modern
UninstallDisplayIcon={app}\MyService.exe
Compression=lzma
SolidCompression=yes

[Dirs]
Name: "{app}\logs"
Name: "{app}\data"
Name: "{commoncf32}\Adobe\CEP\extensions\com.mycompany.myservice"

[Files]
; Python service executable and data
Source: "dist\MyService\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "dist\MyService\_internal\*"; DestDir: "{app}\_internal"; Flags: ignoreversion recursesubdirs createallsubdirs

; Adobe CEP Extension
Source: "extension\*"; DestDir: "{commoncf32}\Adobe\CEP\extensions\com.mycompany.myservice"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\My Service"; Filename: "{app}\MyService.exe"
Name: "{group}\Uninstall My Service"; Filename: "{uninstallexe}"
Name: "{commondesktop}\My Service"; Filename: "{app}\MyService.exe"

[Run]
; Enable PlayerDebugMode for CEP development
Filename: "reg"; Parameters: "add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f"; Flags: runhidden; Description: "Enabling Adobe CEP debug mode"

; Optional: Start service after installation
; Filename: "net"; Parameters: "start MyService"; Flags: runhidden; Description: "Starting service"

[UninstallDelete]
Type: dirifempty; Name: "{app}\logs"
Type: dirifempty; Name: "{app}\data"
Type: filesandordirs; Name: "{commoncf32}\Adobe\CEP\extensions\com.mycompany.myservice"

[Registry]
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
```

**Sections Overview:**
- `[Setup]`: Global installer configuration
- `[Dirs]`: Create directories at install time
- `[Files]`: Source files → destination mapping
- `[Icons]`: Shortcuts (Start Menu, Desktop)
- `[Run]`: Commands executed during/after installation
- `[Registry]`: Registry entries to create
- `[UninstallDelete]`: Clean up on uninstall

---

### 7. Installing to Common Files (Adobe CEP Extensions)

**Correct Path Constants:**

```ini
; 32-bit Common Files (works on both 32-bit and 64-bit Windows)
DestDir: "{commoncf32}\Adobe\CEP\extensions\com.mycompany.myservice"

; Alternative: Let Inno Setup auto-select based on architecture
DestDir: "{commoncf}\Adobe\CEP\extensions\com.mycompany.myservice"
```

**Path Constant Reference:**

| Constant | Resolves To (64-bit Windows) |
|----------|---|
| `{commoncf32}` | `C:\Program Files (x86)\Common Files` |
| `{commoncf64}` | `C:\Program Files\Common Files` |
| `{commoncf}` | `{commoncf32}` (unless 64-bit install mode) |
| `{pf}` | `C:\Program Files` |
| `{pf32}` | `C:\Program Files (x86)` |
| `{pf64}` | `C:\Program Files` |

**Complete CEP Installation Section:**

```ini
[Files]
; Source: local_extension_folder/*
Source: "build\extension\*"; DestDir: "{commoncf32}\Adobe\CEP\extensions\com.mycompany.myservice"; Flags: ignoreversion recursesubdirs createallsubdirs

; Include manifest.xml, CSXS metadata
Source: "build\extension\manifest.xml"; DestDir: "{commoncf32}\Adobe\CEP\extensions\com.mycompany.myservice"
Source: "build\extension\CSXS\manifest.xml"; DestDir: "{commoncf32}\Adobe\CEP\extensions\com.mycompany.myservice\CSXS"
```

---

### 8. Recursive Folder Inclusion

**Syntax for copying entire folder tree:**

```ini
[Files]
Source: "sourcefolder\*"; DestDir: "{app}\destinationfolder"; Flags: ignoreversion recursesubdirs createallsubdirs
```

**Flags Explanation:**
- `recursesubdirs`: Include all subdirectories recursively
- `createallsubdirs`: Create empty directories too (not just directories containing files)
- `ignoreversion`: Overwrite existing files regardless of version

**Real-World Examples:**

```ini
; Copy entire _internal folder (PyInstaller dependencies)
Source: "dist\MyService\_internal\*"; DestDir: "{app}\_internal"; Flags: ignoreversion recursesubdirs createallsubdirs

; Copy CEP extension with all assets, scripts, HTML
Source: "extension\*"; DestDir: "{commoncf32}\Adobe\CEP\extensions\com.mycompany.myservice"; Flags: ignoreversion recursesubdirs createallsubdirs

; Copy configuration templates
Source: "templates\*"; DestDir: "{app}\templates"; Flags: ignoreversion recursesubdirs createallsubdirs
```

---

### 9. Registry Key in `[Registry]` Section

**Syntax:**

```ini
[Registry]
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
```

**Complete Reference:**

| Parameter | Description | Example |
|-----------|---|---|
| `Root` | Registry hive | `HKCU` (current user) or `HKLM` (local machine) |
| `Subkey` | Path within hive | `Software\Adobe\CSXS.11` |
| `ValueType` | Data type | `string`, `dword`, `binary`, `expandsz` |
| `ValueName` | Entry name | `PlayerDebugMode` |
| `ValueData` | Value | `1` (for string/dword) |
| `Flags` | Options | `deletevalue` (remove on uninstall) |

**Multiple Registry Entries:**

```ini
[Registry]
; Enable debug mode for CSXS 11 (CC 2025)
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue

; Enable debug mode for CSXS 9 (CC 2018)
Root: HKCU; Subkey: "Software\Adobe\CSXS.9"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue

; Application-specific registry setting
Root: HKCU; Subkey: "Software\My Company\My Service"; ValueType: string; ValueName: "InstallPath"; ValueData: "{app}"; Flags: uninsdeletekey
```

**CSXS Versions Reference:**
- `CSXS.11`: CC 2025
- `CSXS.9`: CC 2018
- `CSXS.8`: CC 2017
- `CSXS.7`: CC 2016

---

### 10. Key `[Setup]` Directives

**Essential Configuration:**

```ini
[Setup]
; Application Identity
AppName=My Service
AppVersion=1.0.0
AppPublisher=My Company
AppPublisherURL=https://mycompany.com

; Installation Paths
DefaultDirName={autopf}\MyService          ; Program Files\MyService
DefaultGroupName=My Company\My Service     ; Start Menu folder
UninstallDisplayIcon={app}\MyService.exe

; Admin Privileges
PrivilegesRequired=admin                   ; Require admin to install
                                          ; Options: none, poweruser, admin

; Output Configuration
OutputDir=.\output                         ; Where to save .exe installer
OutputBaseFilename=MyService-Setup-1.0.0  ; Installer filename (without .exe)

; Compression & Presentation
Compression=lzma                           ; Compression method: lzma, bzip2, zip
SolidCompression=yes                       ; One block (better ratio)
WizardStyle=modern                         ; UI style: classic, modern

; Misc
AllowNetworkDrive=no
AllowUNCPath=no
ShowLanguageDialog=no
LanguageDetectionMethod=none

; Optional: Wizard Images
WizardImageFile=images\wizard-large.bmp    ; 164×314 pixels
WizardSmallImageFile=images\wizard-small.bmp ; 55×58 pixels
```

**Reference Table:**

| Directive | Purpose | Example |
|-----------|---------|---------|
| `AppName` | Application name | `My Service` |
| `AppVersion` | Displayed version | `1.0.0` |
| `DefaultDirName` | Default install path | `{autopf}\MyApp` |
| `DefaultGroupName` | Start Menu folder | `My Company\My App` |
| `PrivilegesRequired` | Admin requirement | `admin`, `poweruser`, `none` |
| `OutputDir` | Installer output path | `.\output` |
| `OutputBaseFilename` | Installer filename | `MyService-1.0.0` |
| `Compression` | Algorithm | `lzma`, `bzip2`, `zip` |
| `SolidCompression` | Single block | `yes` / `no` |
| `WizardStyle` | UI appearance | `modern`, `classic` |

---

### 11. Code Signing with SignTool

**Basic SignTool Setup in `[Setup]`:**

```ini
[Setup]
; ... other directives ...

; Standard signing (SHA1 or SHA256 only)
SignTool=mycodesign "signtool.exe sign /f $qC:\path\to\certificate.pfx$q /p MyPassword /t http://timestamp.digicert.com /d $qMy Service$q $p"

; Dual-sign for broad compatibility (SHA1 + SHA256)
SignTool=mysign1 "signtool.exe sign /f $qC:\path\to\certificate.pfx$q /p MyPassword /t http://timestamp.digicert.com /fd sha1 /d $qMy Service$q $p"
SignTool=mysign2 "signtool.exe sign /f $qC:\path\to\certificate.pfx$q /p MyPassword /as /t http://timestamp.digicert.com /fd sha256 /td sha256 $p"
```

**SignTool Variables:**

| Variable | Meaning |
|----------|---------|
| `$p` | File path to sign |
| `$q` | Quote character (for paths with spaces) |
| `$f` | Full file path |

**Real-World Example:**

```ini
SignTool=codesign "C:\Program Files (x86)\Microsoft SDKs\Windows\v10.0A\bin\NETFX 4.8 Tools\signtool.exe sign /f C:\certs\mycompany.pfx /p $q%CERT_PASSWORD%$q /t http://timestamp.digicert.com /d $qMy Service v1.0$q /du https://mycompany.com $p"
```

**Pre-Requisites:**
1. Obtain a code-signing certificate (EV or standard) from a trusted CA
2. Export certificate as `.pfx` file with password
3. Have `signtool.exe` available (part of Windows SDK)
4. Have internet access to timestamp server during build

**Timestamp Servers (Popular):**
- `http://timestamp.digicert.com` (DigiCert)
- `http://timestamp.globalsign.com/gs/timestamp` (GlobalSign)
- `http://timestamp.sectigo.com` (Sectigo)

---

### 12. Inno Setup on GitHub Actions `windows-latest`

**Current Status (August 2026):**

Inno Setup is **NOT pre-installed** on `windows-latest` runners. You must install it explicitly.

**Installation via Chocolatey:**

```yaml
- name: Install Inno Setup
  run: choco install innosetup -y
```

**Verification:**

```bash
iscc --version  # Should output version if installed
```

**Using GitHub Actions Marketplace Action:**

```yaml
- name: Build Installer with Inno Setup
  uses: Minionguyjpro/Inno-Setup-Action@v1.2.2
  with:
    path: MyService-Setup.iss
    options: /O".\output"
```

**Runner Information:**
- `windows-latest` currently maps to `windows-2022` or `windows-2025`
- Neither includes Inno Setup by default
- Chocolatey is pre-installed on all Windows runners
- Installation time: ~30 seconds via choco

---

## C. GitHub Actions

### 13. Complete Workflow: PyInstaller + Inno Setup + Release

**Minimal working workflow (`.github/workflows/build-windows-installer.yml`):**

```yaml
name: Build Windows Installer

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      version:
        description: 'Release version (e.g., 1.0.0)'
        required: true
        type: string

jobs:
  build:
    runs-on: windows-latest
    permissions:
      contents: write
      packages: read
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
          cache: 'pip'
      
      - name: Install Python dependencies
        run: |
          python -m pip install --upgrade pip
          pip install pyinstaller
          pip install -r requirements.txt
      
      - name: Build executable with PyInstaller
        run: |
          pyinstaller --onedir --name MyService --add-data "data:data" --hidden-import uvicorn.logging MyService.py
      
      - name: Install Inno Setup
        run: choco install innosetup -y
      
      - name: Build installer with Inno Setup
        run: |
          iscc "MyService-Setup.iss"
      
      - name: Get version from tag or input
        id: version
        run: |
          if ("${{ github.ref }}" -match "refs/tags/v(.+)") {
            $version = $matches[1]
          } elseif ("${{ github.event.inputs.version }}" -ne "") {
            $version = "${{ github.event.inputs.version }}"
          } else {
            $version = "0.0.0-dev"
          }
          echo "VERSION=$version" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
      
      - name: Create GitHub Release
        id: create_release
        uses: softprops/action-gh-release@v1
        if: startsWith(github.ref, 'refs/tags/') || github.event_name == 'workflow_dispatch'
        with:
          files: output/MyService-Setup-*.exe
          generate_release_notes: true
          draft: false
          prerelease: false
          tag_name: ${{ steps.version.outputs.VERSION }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Key Points:**
- Runs on `windows-latest`
- Caches pip dependencies for faster builds
- Installs Inno Setup via Chocolatey
- Uses `softprops/action-gh-release@v1` for uploading
- Requires `contents: write` permission

---

### 14. Permissions Block for Release Operations

**Required permissions for creating/uploading releases:**

```yaml
permissions:
  contents: write     # Required: create releases, upload files
  packages: read      # Optional: if pulling from GitHub Packages
```

**Full permission reference:**

```yaml
permissions:
  actions: read|write
  checks: read|write
  contents: read|write          # Needed for releases
  deployments: read|write
  id-token: read|write
  issues: read|write
  discussions: read|write
  packages: read|write
  pages: read|write
  pull-requests: read|write
  repository-projects: read|write
  security-events: read|write
  statuses: read|write
```

**Minimal for Releases:**
```yaml
permissions:
  contents: write
```

**Fine-Grained Token Note:**
If using a fine-grained personal access token instead of `GITHUB_TOKEN`, it also needs the "Workflows" repository permission (write).

---

### 15. Manual Workflow Trigger with Version Input

**Workflow definition with `workflow_dispatch`:**

```yaml
name: Build Windows Installer

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Release version (e.g., 1.0.0)'
        type: string
        required: true
        default: '1.0.0'
      
      environment:
        description: 'Build environment'
        type: choice
        required: false
        default: 'production'
        options:
          - development
          - staging
          - production
      
      include_debug:
        description: 'Include debug symbols'
        type: boolean
        required: false
        default: false
  
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: windows-latest
    env:
      BUILD_VERSION: ${{ github.event.inputs.version || '0.0.0-tag' }}
      BUILD_ENV: ${{ github.event.inputs.environment || 'production' }}
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Display inputs
        run: |
          echo "Version: ${{ github.event.inputs.version }}"
          echo "Environment: ${{ github.event.inputs.environment }}"
          echo "Debug: ${{ github.event.inputs.include_debug }}"
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      
      - name: Build with version
        run: |
          # Use input version in build
          $version = "${{ github.event.inputs.version }}"
          if (-not $version) {
            $version = (git describe --tags --always)
          }
          echo "Building version: $version"
          
          # Pass to PyInstaller or .iss script
          python -c "print('Version: ' + '$version')"
```

**Access input values in steps:**
```yaml
${{ github.event.inputs.version }}        # String input
${{ github.event.inputs.environment }}    # Choice input
${{ github.event.inputs.include_debug }}  # Boolean (true/false)
```

**Trigger manually:**
- Go to **Actions** tab → **Build Windows Installer** → **Run workflow**
- Fill in version, select options, click **Run workflow**

---

## Sources

### PyInstaller
- [Using PyInstaller — PyInstaller 6.22.2 documentation](https://pyinstaller.org/en/stable/usage.html)
- [What PyInstaller Does and How It Does It — PyInstaller 6.22.2](https://pyinstaller.org/en/stable/operating-mode.html)
- [Using Spec Files — PyInstaller 6.22.2 documentation](https://pyinstaller.org/en/stable/spec-files.html)
- [Run-time Information — PyInstaller 6.22.2 documentation](https://pyinstaller.org/en/stable/runtime-information.html)
- [PyInstaller on GitHub: antivirus issues](https://github.com/orgs/pyinstaller/discussions/5946)
- [PyInstaller GitHub: UPX false positives](https://github.com/pyinstaller/pyinstaller/issues/6754)
- [iancleary/pyinstaller-fastapi — FastAPI + PyInstaller example](https://github.com/iancleary/pyinstaller-fastapi)

### Inno Setup
- [Directory Constants — jrsoftware.org](https://jrsoftware.org/ishelp/topic_consts.htm)
- [[Setup] section — jrsoftware.org](https://jrsoftware.org/ishelp/topic_setupsection.htm)
- [[Files] section — jrsoftware.org](https://jrsoftware.org/ishelp/topic_filessection.htm)
- [[Registry] section — jrsoftware.org](https://jrsoftware.org/ishelp/topic_registrysection.htm)
- [[Dirs] section — jrsoftware.org](https://jrsoftware.org/ishelp/topic_dirssection.htm)
- [[Setup]: DefaultDirName — jrsoftware.org](https://jrsoftware.org/ishelp/topic_setup_defaultdirname.htm)
- [[Setup]: SignTool — jrsoftware.org](https://jrsoftware.org/ishelp/topic_setup_signtool.htm)
- [Inno Setup FAQ — jrsoftware.org](https://jrsoftware.org/isfaq.php)
- [Adobe CEP Extensions Installation — Adobe-CEP/Getting-Started-guides](https://github.com/Adobe-CEP/Getting-Started-guides/issues/47)
- [Minionguyjpro/Inno-Setup-Action — GitHub Marketplace](https://github.com/Minionguyjpro/Inno-Setup-Action)

### GitHub Actions
- [Workflow syntax for GitHub Actions — GitHub Docs](https://docs.github.com/enterprise-cloud@latest/actions/using-workflows/workflow-syntax-for-github-actions)
- [softprops/action-gh-release — GitHub Marketplace](https://github.com/softprops/action-gh-release)
- [REST API endpoints for releases — GitHub Docs](https://docs.github.com/en/rest/releases/releases?apiVersion=2026-03-10)
- [GitHub Actions permissions — GitHub Community Discussion](https://github.com/orgs/community/discussions/68252)
- [WasathTheekshana/pipeline-input-widgets — workflow_dispatch examples](https://github.com/WasathTheekshana/pipeline-input-widgets)

### Community Examples
- [JackMcKew/pyinstaller-action-windows-example](https://github.com/JackMcKew/pyinstaller-action-windows-example)
- [thonny/packaging/windows/inno_setup.iss](https://github.com/thonny/thonny/blob/master/packaging/windows/inno_setup.iss)
- [OpenDroneMap/innosetup.iss](https://github.com/OpenDroneMap/ODM/blob/master/innosetup.iss)

---

## Unverified / Proxy-Blocked

The following were referenced in searches but could not be fully fetched due to network proxy restrictions:
- Full Inno Setup SignTool examples from `jrsoftware.org/ishelp/topic_setup_signtool.htm`
- Complete PyInstaller spec-files documentation examples

These should be verified directly at the official URLs if implementation requires additional details.

---

## Quick Reference

### PyInstaller Command
```bash
pyinstaller --onedir --name MyService --console --add-data "data:data" --hidden-import uvicorn.logging --icon icon.ico MyService.py
```

### Inno Setup Compilation
```bash
iscc /O".\output" MyService-Setup.iss
```

### GitHub Actions Release Upload
```bash
gh release upload v1.0.0 dist/MyService-Setup-1.0.0.exe
```

