# After Effects Panel Plugin Development Research (2026)

## 1. CEP vs UXP: Current State and After Effects Support

### Current Status

**UXP is NOT yet available for After Effects panels as of August 2026.**

According to Adobe's official UXP status documentation, UXP panels for After Effects have not shipped. While After Effects has UXP scripting APIs available starting from AE 22.0 (for scripting access only), there is no production panel/UI framework implemented for After Effects yet.

**CEP 11 and CEP 12 remain the official supported path for After Effects panel plugins** in 2026. Both versions are actively supported across After Effects CC 2024 and AE 2025+, with no announced deprecation date.

### Timeline Context

- **CEP**: Common Extensibility Platform (CEP) has been the standard for After Effects panel development since CS5.5
- **CEP 11/12**: Currently supported in AE 2024 and 2025
- **UXP**: Officially arrived in Premiere Pro 25.6 (December 2025), but After Effects follows behind
- **After Effects UXP**: Infrastructure is being prepared (tooling exists in Bolt UXP), but official public APIs are not yet released

### Recommendation

For After Effects panels in 2026, **use CEP (preferably CEP 12)** with ExtendScript for host communication. Plan for eventual migration to UXP when Adobe ships AE UXP support (estimated future release, not yet announced).

**Sources:**
- [UXP Status Note - GitHub pushREC/after-effects-sdk-kb](https://github.com/pushREC/after-effects-sdk-kb/blob/main/scripting/UXP-STATUS-NOTE.md)
- [Bolt UXP - Building Faster with Bolt UXP (Aug 2026)](https://blog.developer.adobe.com/en/publish/2026/08/building-plugins-faster-with-bolt-uxp-and-bolt-express)
- [UXP Arrives in Premiere (Dec 2025)](https://blog.developer.adobe.com/en/publish/2025/12/uxp-arrives-in-premiere-a-new-era-for-plugin-development)

---

## 2. Packaging Formats and Distribution

### CEP (Current Standard for After Effects)

**Format**: `.ZXP` (ZIP archive with signed certificate)

**Structure**:
```
MyExtension.zxp
├── CSXS/
│   └── manifest.xml
├── index.html
├── js/
│   ├── CSInterface.js
│   └── main.js
└── [other resources: icons, scripts, etc.]
```

**Packaging Tool**: `ZXPSignCmd` command-line tool (included in Adobe plugin SDKs)

**Mandatory Signing**: Yes — ZXP files must be signed with a valid certificate (.p12 PKCS#12 format) to install. Self-signed certificates are accepted.

### UXP (Future Standard)

**Format**: `.ccx` (ZIP archive, internally equivalent to ZXP but branded for UXP)

**Distribution Methods**:
1. **Adobe Marketplace**: Primary distribution channel (requires Developer Distribution portal registration)
2. **Direct Side-Load**: Double-click `.ccx` file to install via Creative Cloud Desktop app
3. **Enterprise Deployment**: Bundled in managed packages

**Side-Loading Capability**: Yes — UXP plugins can be distributed outside the Marketplace. Users receive a warning dialog when installing unsigned Marketplace packages, but installation proceeds with user consent.

**Note**: After Effects is not yet UXP-enabled for panels, so this applies to other CC apps (Photoshop, Premiere Pro, InDesign).

### Signing & Certificates

**ZXPSignCmd Usage**:
```bash
# Create self-signed certificate
ZXPSignCmd -selfSignedCert US California "My Company" "My Plugin" myPassword cert.p12

# Sign ZXP extension
ZXPSignCmd -sign MyPlugin/ MyPlugin.zxp cert.p12 myPassword
```

**Certificate Requirements**:
- Format: PKCS#12 (.p12)
- Self-signed: Accepted for both development and distribution
- Cross-platform: Certificate generated on macOS does NOT work on Windows (and vice versa); regenerate per platform
- Validity: No expiration check at runtime for self-signed certificates

**Sources:**
- [ZXP Resources - Adobe Developer](https://developer.adobe.com/developer-distribution/creative-cloud/docs/guides/zxp/resources)
- [ZXP Distribution Guide](https://developer.adobe.com/developer-distribution/creative-cloud/docs/guides/zxp/distribution)
- [ZXP Code Signing - Community Discussions](https://community.adobe.com/t5/get-started/zxpsigncmd-signing-extension-with-a-self-signed-certificate-on/td-p/10489966)
- [UXP Plugin Packaging - Photoshop](https://developer.adobe.com/photoshop/uxp/2022/guides/distribution/packaging-your-plugin/)
- [Install UXP Plugins - Premiere Pro](https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/install/)

---

## 3. ExtendScript API: Text Layer and Timing Operations

### Creating Text Layers

```javascript
// Create a text layer at a specific position
var comp = app.project.activeItem;
var textLayer = comp.layers.addText("Hello, World!");

// Position in timeline (in seconds)
textLayer.inPoint = 0;
textLayer.outPoint = 5;
```

### Setting and Modifying Text Content

```javascript
// Access TextDocument (source text object)
var sourceTextProp = textLayer.property("Source Text");
var textDoc = sourceTextProp.value;

// Set text content
textDoc.text = "New Text";
sourceTextProp.setValue(textDoc);

// Legacy approach (may vary by expression engine)
// In ExtendScript engine: textLayer.sourceText[0] accesses character array
// In JavaScript engine: textLayer.sourceText.value[0] requires .value accessor
```

### Setting In-Point and Out-Point

```javascript
// Set layer timing (in seconds)
textLayer.inPoint = 1.0;    // Start at 1 second
textLayer.outPoint = 10.0;  // End at 10 seconds

// Calculate duration
var duration = textLayer.outPoint - textLayer.inPoint;
```

### TextDocument Properties: Font, Size, Color

```javascript
var textDoc = textLayer.property("Source Text").value;

// Font properties
textDoc.fontFamily = "Arial";
textDoc.fontSize = 24;

// Fill color (RGB array: [R, G, B] where 0-1 range or 0-255 depending on context)
// UNVERIFIED: Exact RGB API structure varies; community suggests using Effects > Fill for reliable color control
textDoc.fillColor = [1, 1, 1];  // White (if 0-1 range)

// Apply changes
textLayer.property("Source Text").setValue(textDoc);
```

**Note**: UNVERIFIED regarding direct TextDocument.fillColor assignment. Community discussions suggest using a Fill effect or text animator for reliable color control in scripts.

### Animation Preset Application

```javascript
// CORRECTED 2026-08-31 (verified against docsforadobe + Adobe community):
// applyPreset() takes an ExtendScript File OBJECT, not a string preset name.
var thePreset = new File("C:/path/to/preset.ffx");
if (thePreset.exists) {
    theLayer.applyPreset(thePreset);
}
```

> **Correction note.** An earlier draft of this document showed
> `textLayer.applyPreset("Fade In (Linear)")`. That is **wrong** — passing a
> string does not work. The parameter is an ExtendScript `File` object.
>
> **Critical gotcha:** `applyPreset()` acts on the *selection*. The target
> layer must be the ONLY selected layer when it is called, so deselect
> everything else first and restore the selection afterward. This is the
> single most common cause of presets landing on the wrong layer.

**Preset Format**: `.ffx` (After Effects animation preset file)

**Important Considerations**:
- Ensure target layer is selected/active before applying preset
- Preset name only is typically sufficient; full path may not be required
- Presets contain keyframes, effects, and expressions

**Sources:**
- [Creating and Editing Text Layers - Adobe Help](https://helpx.adobe.com/after-effects/using/creating-editing-text-layers.html)
- [Expression Language Reference - Adobe Help](https://helpx.adobe.com/after-effects/using/expression-language-reference.html)
- [Scripting Support for Variable Font Axes](https://helpx.adobe.com/ae_en/after-effects/using/scripting-support-for-variable-font-axes.html)
- [Effects and Animation Presets Overview](https://helpx.adobe.com/after-effects/using/effects-animation-presets-overview.html)
- [After Effects TypeScript Definitions - GitHub](https://github.com/atarabi/aftereffects.d.ts/blob/master/ae.types.d.ts)
- [Script for Applying Animation Preset - Community](https://community.adobe.com/t5/after-effects/script-for-applying-animation-preset-to-layer/m-p/9707877)

---

## 4. CEP Panel to ExtendScript Communication

### CSInterface.evalScript() Method

CEP panels communicate with After Effects via `CSInterface.evalScript()`, which executes ExtendScript in the host application's ExtendScript engine.

```javascript
// In CEP panel HTML/JavaScript:
var csInterface = new CSInterface();

// Execute ExtendScript synchronously (non-blocking callback)
csInterface.evalScript(
  'var comp = app.project.activeItem; comp.layers.addText("Hello");',
  function(result) {
    console.log("Result:", result);
  }
);

// Execute a function from linked JSX file
csInterface.evalScript('myFunction(param1, param2)', callbackFunction);
```

### Manifest.xml Structure and CSXS Requirements

**Required Elements**:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ExtensionManifest xmlns="http://ns.adobe.com/CSXS/1.0">
  <!-- Extension metadata -->
  <ExtensionList>
    <Extension Id="com.example.aftereffects.mypanel">
      <!-- UI Type: Panel (for floating dockable panels) -->
      <DispatchInfoList>
        <DispatchInfo type="Panel">
          <Title>My Panel</Title>
          <Geometry>
            <Size>
              <Width>300</Width>
              <Height>400</Height>
            </Size>
            <!-- Optional: min/max sizes -->
            <MinSize>
              <Width>200</Width>
              <Height>300</Height>
            </MinSize>
          </Geometry>
          <!-- Path to panel HTML file (relative to extension root) -->
          <UI>
            <Type>HTML</Type>
            <Main>index.html</Main>
          </UI>
          <!-- ExtendScript file to execute -->
          <ScriptPath>jsx/main.jsx</ScriptPath>
        </DispatchInfo>
      </DispatchInfoList>

      <!-- Host application and version range -->
      <HostList>
        <Host Name="EVLG" Version="[15.0,99.9]"/>  <!-- After Effects 2019+ -->
      </HostList>

      <!-- CEP runtime version requirement -->
      <RequiredRuntimeList>
        <RequiredRuntime Name="CSXS" Version="12.0"/>  <!-- Or higher -->
      </RequiredRuntimeList>
    </Extension>
  </ExtensionList>
</ExtensionManifest>
```

**Key Manifest Details**:
- `Id`: Unique identifier for extension (reverse domain notation)
- `RequiredRuntime`: CSXS version (CEP 8.0 = CSXS 8, CEP 12.0 = CSXS 12)
- `HostList`: Specifies After Effects version range
- `Geometry`: Mandatory; defines panel size (width/height required, min/max optional)
- `ScriptPath`: Optional; points to .jsx file loaded at startup

### Important Timing Considerations

**Critical**: When CEP panel HTML is first loaded, the panel is **not yet fully initialized** and may fail to execute scripts. Workaround:
- Delay evalScript calls until after DOMContentLoaded or dispatch UI ready event
- Split ExtendScript into small chunks to allow CEP event queue to process

```javascript
// Delayed execution after panel ready
window.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() {
    csInterface.evalScript('// Safe to execute here');
  }, 500);
});
```

**Threading**: ExtendScript runs in the host application's main thread. Long-running scripts block the entire UI.

**Sources:**
- [CEP 12 HTML Extension Cookbook - GitHub Adobe-CEP](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md)
- [CEP 11.1 Cookbook - GitHub Adobe-CEP](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_11.x/Documentation/CEP%2011.1%20HTML%20Extension%20Cookbook.md)
- [Debugging Your Adobe Panel - Adobe Blog](https://blog.developer.adobe.com/en/publish/2019/06/debugging-your-adobe-panel)
- [Getting Started Guides - GitHub Adobe-CEP](https://github.com/Adobe-CEP/Getting-Started-guides)

---

## 5. Code Signing and Certificates for ZXP Distribution

### ZXPSignCmd Tool

**Purpose**: Command-line utility to package and sign CEP extensions into distributable `.zxp` files.

**Location**: Included in Adobe plugin development SDKs and Creative Cloud installation bundles.

**Basic Usage**:
```bash
# Create self-signed certificate (one-time)
ZXPSignCmd -selfSignedCert US California "Company Name" "Display Name" password output.p12

# Sign extension
ZXPSignCmd -sign /path/to/extension/ output.zxp output.p12 password
```

### Certificate Details

**Self-Signed Certificates**:
- Fully supported for production distribution (no Marketplace objection)
- No expiration date validation at runtime
- Format: PKCS#12 (.p12)
- Password: Required for signing operations

**Cross-Platform Compatibility**:
- CRITICAL: Certificate created on macOS CANNOT be used on Windows (and vice versa)
- Workaround: Generate separate certificates per platform using ZXPSignCmd on each OS
- Once signed, a .zxp file signed on one platform works on the other

**Signing Process**:
1. Create certificate: `ZXPSignCmd -selfSignedCert ...`
2. Sign ZXP: `ZXPSignCmd -sign sourceDir output.zxp cert.p12 password`
3. Distribute `.zxp` file; recipient installs via Extension Manager, Anastasiy's tool, or ZXPInstaller

### Mandatory Signing?

**Yes** — ZXP files must be signed to install properly. However, self-signed certificates are acceptable, so signing is not a barrier to distribution.

**Unsigned Extension Workaround** (for development only): Enable PlayerDebugMode registry key (see Section 6) to load unsigned extensions from development folders.

**Sources:**
- [ZXPSignCmd Code Signing - Community Thread](https://community.adobe.com/t5/get-started/zxpsigncmd-signing-extension-with-a-self-signed-certificate-on/td-p/10489966)
- [ZXP Distribution - Adobe Developer](https://developer.adobe.com/developer-distribution/creative-cloud/docs/guides/zxp/distribution)
- [ZXP Resources - Adobe Developer](https://developer.adobe.com/developer-distribution/creative-cloud/docs/guides/zxp/resources)

---

## 6. CEP Extension Installation: Paths, Tools, and Debug Mode

### Windows Installation Paths

**System-Level Extensions** (applies to all users):
```
C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\
C:\Program Files\Common Files\Adobe\CEP\extensions\  (64-bit alternative)
```

**User-Level Extensions** (current user only):
```
C:\Users\<USERNAME>\AppData\Roaming\Adobe\CEP\extensions\
```

**Folder Structure**:
```
C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\com.example.mypanel\
├── CSXS/
│   └── manifest.xml
├── index.html
├── js/
│   ├── CSInterface.js
│   └── main.js
└── other resources
```

**Note**: Individual extensions are placed in subdirectories named by their bundle ID (from manifest.xml `Id` attribute).

### Installation Tools (in 2026)

1. **Adobe Extension Manager** — DISCONTINUED as of CC 2015; no longer available
2. **Anastasiy's Extension Manager** — Third-party replacement; actively used (reliable with caveats)
3. **ZXPInstaller** — Standalone installer for `.zxp` files
4. **Manual Folder Copy** — Copy extension folder to CEP extensions directory (for development)

### PlayerDebugMode: Enable Unsigned Extensions

**Purpose**: Allow loading unsigned/unpackaged extensions during development (Windows and macOS).

**Windows Registry Configuration**:

Open `regedit` and navigate to:
```
HKEY_CURRENT_USER\Software\Adobe\CSXS.12
```

Create or modify string value:
```
Name: PlayerDebugMode
Type: REG_SZ (String)
Value: 1
```

**CSXS Version Mapping**:
- CEP 8: `CSXS.8`
- CEP 9: `CSXS.9`
- CEP 11: `CSXS.11`
- CEP 12: `CSXS.12`

**After Making Changes**: Restart computer (or restart After Effects and Clear Cache).

**Effect**: With PlayerDebugMode enabled, After Effects will load unsigned extensions from the CEP folders for testing purposes.

**macOS Equivalent**: Use `.plist` file at `~/Library/Preferences/com.adobe.CSXS.12.plist` instead of registry.

**Sources:**
- [CEP Panel Development Paths - Community](https://community.adobe.com/t5/after-effects/cep-panel-development-where-to-put-cep-panel-folders/m-p/11117234)
- [Debugging Your Adobe Panel - Adobe Blog (2019)](https://blog.developer.adobe.com/en/publish/2019/06/debugging-your-adobe-panel)
- [Extension Manager Discontinuation - Community](https://community.adobe.com/t5/exchange-discussions/anastasiy-s-extension-manager/td-p/10706176)
- [Windows CEP Paths Discussion - Community](https://community.adobe.com/t5/premiere-pro-discussions/for-adobe-panel-extensions-pc-windows-does-it-matter-quot-program-files-quot-vs-quot-program-files/m-p/14523210)

---

## 7. Programmatic Audio/Video Rendering and Render Queue

### Render Queue Scripting API

**Adding Composition to Render Queue**:

```javascript
var comp = app.project.activeItem;
var renderQueueItem = app.project.renderQueue.items.add(comp);
```

**Configuring Output Module**:

```javascript
// Access output module (typically index 1 for first output module)
var outputModule = renderQueueItem.outputModule(1);

// Apply output module template
outputModule.applyTemplate("ProRes HQ");  // Template name

// Set output file path
outputModule.file = new File("C:\\output\\video.mov");
```

**Render Settings**:

```javascript
// Apply render settings template
renderQueueItem.applyTemplate("Best Settings");
```

**Executing Render**:

```javascript
// Blocking render (UI freezes)
app.project.renderQueue.render();

// Non-blocking render (undocumented but used in practice)
// UNVERIFIED: renderAsync() availability and signature
if (app.project.renderQueue.renderAsync) {
  app.project.renderQueue.renderAsync();
}
```

**Checking Render Capability**:

```javascript
var canQueueInAME = app.project.renderQueue.canQueueInAME;  // Boolean
app.project.renderQueue.queueInAME(true);  // Queue to Adobe Media Encoder
```

### Audio-Only Rendering

**Output Module Configuration**:

```javascript
// After applying template, modify audio/video output settings
var outputModule = renderQueueItem.outputModule(1);

// Set output settings (format varies by output module)
// UNVERIFIED: Exact property names for audio-only control
// Likely approaches:
// 1. Use "Audio Only" output module (if available as template)
// 2. Modify "-outputSettings" parameter string

// Example with settings string (aerender syntax, not direct API)
// "Output Audio": 1, "Output Video": 0
```

### aerender.exe Command-Line Rendering

**Location**: Same directory as After Effects executable.

**Basic Usage**:
```bash
aerender -project "project.aep" -comp "CompName" -OMtemplate "ProRes HQ" -output "output.mov"
```

**Command-Line Parameters**:

```bash
# Project and composition
-project "path/to/project.aep"
-comp "Composition Name"

# Render settings template
-RStemplate "Best Settings"

# Output module template
-OMtemplate "ProRes HQ"

# Output file
-output "path/to/output.mov"

# Output module settings (override)
-outputSettings "setting1: value1, setting2: value2"

# Audio/Video configuration
# -outputSettings "Output Audio": 1, "Output Video": 0
```

**Audio-Only Rendering**:

```bash
# Use appropriate output module that includes audio only
# Or use -outputSettings with Audio ON, Video OFF
aerender -project "project.aep" -comp "AudioComp" -OMtemplate "WAV" -output "audio.wav"
```

**Help**:
```bash
aerender -help
```

### Render Queue API Limitations

- **No direct audio-only property**: UNVERIFIED whether a TextDocument.fillColor-like direct API exists for audio-only; likely requires output module template selection or -outputSettings parameter
- **Blocking behavior**: `render()` freezes UI; `renderAsync()` is undocumented but reportedly non-blocking
- **Template dependency**: Output modules and render settings rely on predefined templates; dynamic property assignment is limited

**Sources:**
- [Automated Rendering and Network Rendering - Adobe Help](https://helpx.adobe.com/after-effects/using/automated-rendering-network-rendering.html)
- [Basics of Rendering and Exporting - Adobe Help](https://helpx.adobe.com/after-effects/desktop/render-and-export/basics-of-rendering-and-exporting/basics-rendering-exporting.html)
- [Render Queue Scripting - Community](https://community.adobe.com/t5/after-effects-discussions/how-to-render-a-composition-in-after-effects-using-extendscript/m-p/13949805)
- [Output Module Templates - Community](https://community.adobe.com/t5/after-effects-discussions/how-to-set-render-queue-item-outputmodule-format-to-openexr/td-p/13947256)
- [aerender Command-Line Options - Community](https://community.adobe.com/questions-529/aerender-command-line-output-settings-53954)

---

## Summary: Recommended Plugin Architecture (2026)

### For After Effects Panel Plugins:

1. **Use CEP 12** with ExtendScript for host communication (UXP not yet available)
2. **Package as `.zxp`** with self-signed certificate using ZXPSignCmd
3. **Distribute via**:
   - Direct `.zxp` file download (user installs manually)
   - Anastasiy's Extension Manager (if seeking automated installation)
   - Adobe Marketplace (if signed and registered)
4. **Development workflow**:
   - Enable PlayerDebugMode registry key for unsigned testing
   - Place extension folder in `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\` or user AppData folder
   - Restart After Effects after changes
5. **Panel structure**:
   - `manifest.xml` (CSXS 12, host version range, geometry)
   - `index.html` (CEP UI)
   - `js/main.js` (CEP logic, calls CSInterface.evalScript)
   - `jsx/main.jsx` (ExtendScript for After Effects DOM access)

### For Rendering Automation:

- **ExtendScript via CEP**: Use `renderQueue.render()` for synchronous renders, or `queueInAME()` for offloading
- **aerender.exe**: Use for command-line batch rendering and audio-only output via `-OMtemplate` or `-outputSettings`

---

## Unverified Claims

The following claims could not be fully verified from official Adobe documentation:

1. **TextDocument.fillColor API**: Direct RGB color assignment via TextDocument object; community sources suggest using Fill effects or text animators as workaround
2. **Animation Preset Paths**: Exact path handling for custom `.ffx` presets in `applyPreset()` method
3. **renderAsync() Method**: Existence and non-blocking behavior; undocumented but reportedly used in practice
4. **Audio-Only Output Module API**: Direct ExtendScript property/method to enable audio-only rendering; likely requires template selection or command-line parameter instead

---

## Sources

### Official Adobe Documentation
- [After Effects Help: Creating and Editing Text Layers](https://helpx.adobe.com/after-effects/using/creating-editing-text-layers.html)
- [After Effects Help: Expression Language Reference](https://helpx.adobe.com/after-effects/using/expression-language-reference.html)
- [After Effects Help: Scripts](https://helpx.adobe.com/after-effects/using/scripts.html)
- [After Effects Help: Scripting Support for Variable Font Axes](https://helpx.adobe.com/ae_en/after-effects/using/scripting-support-for-variable-font-axes.html)
- [After Effects Help: Effects and Animation Presets](https://helpx.adobe.com/after-effects/using/effects-animation-presets-overview.html)
- [After Effects Help: Automated Rendering and Network Rendering](https://helpx.adobe.com/after-effects/using/automated-rendering-network-rendering.html)
- [After Effects Help: Basics of Rendering and Exporting](https://helpx.adobe.com/after-effects/desktop/render-and-export/basics-of-rendering-and-exporting/basics-rendering-exporting.html)

### Adobe Developer Resources
- [Adobe Developer: ZXP Resources](https://developer.adobe.com/developer-distribution/creative-cloud/docs/guides/zxp/resources)
- [Adobe Developer: ZXP Distribution](https://developer.adobe.com/developer-distribution/creative-cloud/docs/guides/zxp/distribution)
- [Adobe Developer: UXP Plugin Packaging (Photoshop)](https://developer.adobe.com/photoshop/uxp/2022/guides/distribution/packaging-your-plugin/)
- [Adobe Developer: Install UXP Plugins (Premiere Pro)](https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/install/)
- [Adobe Developer: Submission and Review Overview](https://developer.adobe.com/developer-distribution/creative-cloud/docs/guides/submission/overview/)

### Adobe Blogs and Announcements
- [Adobe Blog: Building Plugins Faster with Bolt UXP (August 2026)](https://blog.developer.adobe.com/en/publish/2026/08/building-plugins-faster-with-bolt-uxp-and-bolt-express)
- [Adobe Blog: UXP Changelog and Support Matrix (July 2026)](https://blog.developer.adobe.com/en/publish/2026/07/uxp-changelog-and-support-matrix)
- [Adobe Blog: UXP Arrives in Premiere (December 2025)](https://blog.developer.adobe.com/en/publish/2025/12/uxp-arrives-in-premiere-a-new-era-for-plugin-development)
- [Adobe Blog: Debugging Your Adobe Panel (2019)](https://blog.developer.adobe.com/en/publish/2019/06/debugging-your-adobe-panel)
- [Adobe Blog: How to Install UXP Plugins Using Command Line Tools (2022)](https://blog.developer.adobe.com/how-to-install-uxp-plugins-using-command-line-tools-a6a62ca4cb1a)

### GitHub Resources
- [Adobe-CEP Resources: CEP 12 HTML Extension Cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md)
- [Adobe-CEP Resources: CEP 11.1 Cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_11.x/Documentation/CEP%2011.1%20HTML%20Extension%20Cookbook.md)
- [Adobe-CEP Getting Started Guides](https://github.com/Adobe-CEP/Getting-Started-guides)
- [pushREC: After Effects SDK KB - UXP Status Note](https://github.com/pushREC/after-effects-sdk-kb/blob/main/scripting/UXP-STATUS-NOTE.md)
- [atarabi: After Effects TypeScript Definitions](https://github.com/atarabi/aftereffects.d.ts/blob/master/ae.types.d.ts)

### Community Forums and Discussions
- [Adobe Community: CEP Panel for After Effects 2025](https://community.adobe.com/questions-529/cep-panel-for-after-effects-2025-59974)
- [Adobe Community: UXP for After Effects](https://community.adobe.com/t5/after-effects-discussions/uxp-for-after-effects/td-p/13360660)
- [Adobe Community: CEP Panel Development Paths](https://community.adobe.com/t5/after-effects/cep-panel-development-where-to-put-cep-panel-folders/m-p/11117234)
- [Adobe Community: ZXPSignCmd Code Signing](https://community.adobe.com/t5/get-started/zxpsigncmd-signing-extension-with-a-self-signed-certificate-on/td-p/10489966)
- [Adobe Community: Render Queue Scripting](https://community.adobe.com/t5/after-effects-discussions/how-to-render-a-composition-in-after-effects-using-extendscript/m-p/13949805)
- [Adobe Community: Animation Preset Application](https://community.adobe.com/t5/after-effects/script-for-applying-animation-preset-to-layer/m-p/9707877)
- [Adobe Community: Anastasiy's Extension Manager](https://community.adobe.com/t5/exchange-discussions/anastasiy-s-extension-manager/td-p/10706176)
- [Adobe Community: Extension Manager Discontinuation](https://community.adobe.com/t5/download-install-discussions/extention-manager-error-code-602/m-p/10722831)

---

**Document Last Updated**: August 31, 2026  
**Research Scope**: After Effects panel plugin architecture, CEP/UXP status, packaging, installation, and scripting APIs
