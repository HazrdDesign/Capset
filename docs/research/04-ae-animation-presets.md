# After Effects Animation Presets and Library Research

## Executive Summary

This document provides comprehensive technical research on building a reusable text animation library in After Effects, with focus on Animation Presets (.ffx), scripting APIs, and CEP panel UI approaches. Key findings: **MOGRTs are NOT suitable for this use case** (Premiere-only), Animation Presets are the correct approach, and plugin-based preview strategies use pre-rendered video/GIF files rather than live rendering.

---

## 1. MOGRTs vs. Animation Presets: Architecture Decision

### Finding: MOGRTs Are Premiere Pro Centric, Not Suitable for AE

**Status: CONFIRMED**

Motion Graphics Templates (.mogrt files) are **authored in After Effects** via the Essential Graphics panel but are **consumed in Premiere Pro**. The critical limitation:

- **You cannot import a .mogrt from the library panel into After Effects** — this is a documented missing feature
- MOGRTs can be opened as AE Project files (File > Open Project > select .mogrt), but they extract as a full project, not as reusable components
- MOGRTs are designed to lock creative control while exposing only Essential Graphics properties for editors in Premiere

**The AE-Native Equivalent for Reusable Animations:**

After Effects has no built-in component/symbol system like Figma. The architecture must choose between:

1. **Animation Presets (.ffx files)** — store keyframes and effects; applied via scripting with `Layer.applyPreset()`
2. **Precompositions with Master Properties** — use Essential Graphics panel to expose controls; time-remap in main comp
3. **Scripted Null Controllers with Expressions** — build control rigs using Slider/Color/Dropdown effects linked via expressions

**Recommendation:** Use **Animation Presets** for the core animation library (easiest to apply, portable, visual browsing), optionally backed with **expression-linked null controllers** for advanced parameter control.

**Sources:**
- [Can you use Essential Graphics (mogrt files) in After Effects?](https://community.adobe.com/questions-529/can-you-use-essential-graphics-mogrt-files-in-after-effects-37655)
- [How to open mogrt files in Adobe After Effects](https://helpx.adobe.com/after-effects/desktop/using/video/creating-motion-graphics-templates-video.html)
- [Create Motion Graphics templates with Essential Graphics panel](https://helpx.adobe.com/after-effects/using/creating-motion-graphics-templates.html)
- [Import Motion Graphics Templates ideally from Libraries into AE](https://community.adobe.com/t5/after-effects-ideas/import-motion-graphics-templates-ideally-from-libraries-into-ae/idi-p/14087434)

---

## 2. Animation Presets (.ffx): Storage, Creation, and Format

### What Are Animation Presets?

Animation presets are saved collections of keyframes and effect settings that can be applied to layers. They store:

- Keyframe data with timing
- Effect parameters and values
- Text animator configurations
- Custom properties

### Disk Locations (Windows)

**Default Adobe Presets (Read-Only):**
```
C:\Program Files\Adobe\Adobe After Effects [Version]\Support Files\Presets\
```

**User-Created Presets (User-Writable):**
```
C:\Users\<YourUserName>\Documents\Adobe\After Effects [Version]\User Presets\
```

**Discovery:** Presets appear in the Effects & Presets panel only if placed in a Presets folder or subfolder. After adding presets while AE is open, use the panel's hamburger menu > "Refresh List" to reload.

### File Format: Binary, Not Editable

**Status: CONFIRMED OPAQUE**

- `.ffx` files are **binary format** — opening in a text editor yields gibberish symbols
- **No public documentation exists for the .ffx binary structure**
- .ffx files cannot be directly edited; they must be created through the AE UI ("Animation > Save Animation Preset")
- The format is proprietary and NOT reverse-engineered in public sources

### Creating Presets: Programmatic Limitations

**Status: VERY LIMITED**

There is **no direct ExtendScript API to save animation presets**. The only workaround:

```javascript
// Simulate "Save Animation Preset" menu item
app.executeCommand(3075);  // Opens save dialog; user must choose location
```

This opens a dialog but does not allow programmatic file creation. Community workarounds include:

1. **Pseudo-Effects XML Workaround:** Modify the PresetEffects.xml file to register pseudo-effects with specific matchnames
2. **External Tool Method:** Generate .ffx files via reverse-engineering or third-party converters (not documented by Adobe)

**Practical Implication:** Animation presets must be **hand-authored in After Effects and manually saved**. They cannot be generated from code. Plan for a library of pre-built .ffx files distributed with the plugin.

**Sources:**
- [Effects and animation presets in After Effects](https://helpx.adobe.com/after-effects/using/effects-animation-presets-overview.html)
- [Is there a way to save animation preset by script?](https://community.adobe.com/t5/after-effects/is-there-a-way-to-save-animation-preset-by-script/td-p/8194340)
- [Save an animation preset with a script](https://community.adobe.com/t5/after-effects-discussions/save-an-animation-preset-with-a-script-and-then-customize-the-file-explorer-it-opened/m-p/12589239)
- [Editing a .ffx file](https://community.adobe.com/t5/after-effects-discussions/editing-a-ffx-file/td-p/10814998)

---

## 3. Layer.applyPreset() Scripting API

### Exact Signature and Behavior

**Method:**
```javascript
layer.applyPreset(presetName)
```

**Parameters:**
- `presetName` (String): Name of the preset file. Extension (.ffx) is optional; path is not required if preset is in the Presets folder or user's preset folder.

**Important Behavior Notes:**

1. **Selection-Based, Not Self-Applied:** The method applies the preset to **all currently selected layers in the composition**, NOT to the layer object itself. The layer calling the method only determines which composition's layers are processed.

   ```javascript
   // Example: Apply to layer 1 specifically
   var comp = app.project.item(1);
   comp.layer(1).selected = true;
   comp.layer(1).applyPreset("My Text Reveal");  // Applies to layer 1 and any other selected layers
   ```

2. **Keyframe Placement:** Presets apply their keyframes **exactly as they were saved** — no relative time adjustment. The keyframes land starting at the current composition time (usually 0:00) or at the layer's in-point if the layer is nested/pre-comped.

   **UNVERIFIED:** Exact behavior on keyframe placement relative to in-point varies based on composition context.

3. **Works on Text Layers:** Yes, presets can be applied to text layers and will include text animators if the preset was saved from a text animator.

4. **Limitations:**
   - Cannot control WHERE keyframes land after application (they use preset's original timing)
   - No API parameter to offset keyframes in time
   - Presets don't adapt to layer duration or in-point

### Practical Usage

```javascript
var comp = app.project.activeItem;
comp.layer("Text Layer 1").selected = true;
comp.layer("Text Layer 1").applyPreset("Character Reveal - Fast");

// To adjust keyframe placement after application, manually manipulate them:
var textLayer = comp.layer("Text Layer 1");
var animator = textLayer.Text.Animators.property(1);
var selectorStart = animator.property("ADBE Text Selectors").property(1).property("ADBE Text Percent Start");
// Shift keyframes forward by 30 frames
for (var i = 1; i <= selectorStart.numKeys; i++) {
  var oldTime = selectorStart.keyTime(i);
  selectorStart.setValueAtTime(oldTime + 1.0, selectorStart.keyValue(i));  // 1 second offset
}
```

**Sources:**
- [Layer object - After Effects Scripting Guide](https://ae-scripting.docsforadobe.dev/layer/layer/)
- [Scripting applyPreset() Problem](https://community.adobe.com/t5/after-effects/scripting-applypreset-problem/m-p/10785668)
- [Script for Applying Animation Preset to Layer](https://community.adobe.com/t5/after-effects/script-for-applying-animation-preset-to-layer/td-p/9707877)
- [A small script to apply presets](https://community.adobe.com/t5/after-effects-discussions/a-small-script-to-apply-presets/m-p/10420949)

---

## 4. Text Animators and Range Selectors: Scripting API

### Creating Text Animators Programmatically

**Basic Structure:**

```javascript
var textLayer = comp.layer("Text Layer 1");
var textProperty = textLayer.Text;

// Add a new text animator
var animator = textProperty.Animators.addProperty("ADBE Text Animator");
animator.name = "My Animator";

// Add animator property (e.g., Opacity)
var animatorProps = animator.property("ADBE Text Animator Properties");
var opacityProp = animatorProps.addProperty("ADBE Text Opacity");
opacityProp.setValue(0);  // Start opacity at 0

// Add a range selector to control which characters animate
var selector = animator.property("ADBE Text Selectors").addProperty("ADBE Text Selector");
selector.name = "My Range Selector";
```

### Range Selector Properties and Units

**Available Selector Properties:**

- **ADBE Text Percent Start** — Start value (percentage or character index)
- **ADBE Text Percent End** — End value
- **ADBE Text Percent Offset** — Offset to shift the range
- **ADBE Text Range Selector Mode** — Selector type (additive, subtractive, intersect)
- **ADBE Text Selector Range Units** — Units type (percentage or index)
- **ADBE Text Selector Range Based On** — Selection basis (characters, characters excluding spaces, words, lines)

### Setting Selector Units and "Based On"

**Units (ADBE Text Selector Range Units):**
- `1` = Percent
- `2` = Index (character or word number)

**Based On (ADBE Text Selector Range Based On):**
- `1` = Characters
- `2` = Characters Excluding Spaces
- `3` = Words
- `4` = Lines

**Example: Character-by-Character Reveal**

```javascript
var textLayer = comp.layer("Text Layer 1");
var animator = textLayer.Text.Animators.addProperty("ADBE Text Animator");

// Add opacity animator
var animProps = animator.property("ADBE Text Animator Properties");
var opacityProp = animProps.addProperty("ADBE Text Opacity");
opacityProp.setValue(0);  // Invisible by default

// Add range selector
var selectorGroup = animator.property("ADBE Text Selectors");
var selector = selectorGroup.addProperty("ADBE Text Selector");

// Configure selector
selector.property("ADBE Text Selector Range Based On").setValue(1);  // Characters
selector.property("ADBE Text Selector Range Units").setValue(2);   // Index units

// Animate the selector's End property to reveal characters over time
var endProp = selector.property("ADBE Text Percent End");
endProp.setValueAtTime(0, 0);      // Start at character 0
endProp.setValueAtTime(2, 100);    // End at 100% (all characters) at 2 seconds
```

### Expression Selectors

Range selectors support **Expression Selectors** for dynamic control:

```javascript
var selectorGroup = animator.property("ADBE Text Selectors");
var expressionSelector = selectorGroup.addProperty("ADBE Text Expression Selector");

// Expression evaluated per character
expressionSelector.property("ADBE Text Selector Expression").expression = 
  "selectorValue * textIndex / textTotal";
```

In expression selectors, `textIndex`, `textTotal`, and `selectorValue` variables are available:
- `textIndex` — current character's index (0-based)
- `textTotal` — total number of characters/words/lines
- `selectorValue` — value of the expression (typically 0–1)

**Sources:**
- [Animating text in After Effects](https://helpx.adobe.com/after-effects/using/animating-text.html)
- [Add a range selector to source text expressions](https://community.adobe.com/t5/after-effects-discussions/add-a-range-selector-to-source-text-expressions/td-p/12990005)
- [Add Range Selector in Text by Script](https://community.adobe.com/t5/after-effects-discussions/add-range-selector-in-text-by-script/td-p/15132915)
- [Can you show me an example of add Animator properties to text layer using extendscript?](https://community.adobe.com/t5/after-effects-discussions/scripting-can-you-show-me-an-example-of-add-animator-properties-to-text-layer-using-extendscript/td-p/10969013)

---

## 5. Text Animator Properties Available

### Complete List of Animator Properties

**Spatial Properties:**
- **ADBE Text Anchor Point** — Position of character anchor point
- **ADBE Text Position** — X, Y, Z position offset
- **ADBE Text Scale** — X, Y scaling
- **ADBE Text Rotation** — Z rotation (2D)
- **ADBE Text Rotation X** — X-axis rotation (3D, requires per-character 3D)
- **ADBE Text Rotation Y** — Y-axis rotation (3D)
- **ADBE Text Rotation Z** — Z-axis rotation (3D)
- **ADBE Text Skew** — Skew angle
- **ADBE Text Skew Axis** — Axis for skew

**Appearance Properties:**
- **ADBE Text Opacity** — Character transparency (0–100%)
- **ADBE Text Fill Color** — RGBA color
- **ADBE Text Stroke Color** — Stroke RGBA color
- **ADBE Text Stroke Width** — Stroke thickness
- **ADBE Text Line Anchor** — Vertical alignment of stroke
- **ADBE Text Tracking** — Letter spacing
- **ADBE Text Character Offset** — Character index offset (for sequencing effects)
- **ADBE Text Blur** — Blur amount

### Accessing Properties by Matchname

```javascript
var animator = textLayer.Text.Animators.addProperty("ADBE Text Animator");
var animProps = animator.property("ADBE Text Animator Properties");

// Add specific properties by matchname
var positionProp = animProps.addProperty("ADBE Text Position");
var scaleProp = animProps.addProperty("ADBE Text Scale");
var opacityProp = animProps.addProperty("ADBE Text Opacity");
var fillColorProp = animProps.addProperty("ADBE Text Fill Color");
var trackingProp = animProps.addProperty("ADBE Text Tracking");
var blurProp = animProps.addProperty("ADBE Text Blur");
```

### Range Selector Units and "Based On" Behavior

**Percent vs. Index Units:**
- **Percent:** Start/End/Offset values are 0–100%, representing a percentage of total characters/words
- **Index:** Values are absolute character/word counts (1-based in UI, but use 0-based in scripting)

**"Based On" Options and Behavior:**

- **Characters:** Each character is counted separately; spaces are counted as characters
- **Characters Excluding Spaces:** Spaces are skipped; useful for word-by-word animation without space artifacts
- **Words:** Word boundaries detected by spaces; useful for word-by-word reveals
- **Lines:** Line breaks detected; useful for line-by-line effects

**Example: Word-by-Word Animation**

```javascript
var selector = animator.property("ADBE Text Selectors").addProperty("ADBE Text Selector");
selector.property("ADBE Text Selector Range Based On").setValue(3);    // Words
selector.property("ADBE Text Selector Range Units").setValue(2);      // Index
selector.property("ADBE Text Percent Start").setValueAtTime(0, 0);
selector.property("ADBE Text Percent Start").setValueAtTime(3, 10);   // Reveal 10 words by 3 seconds
```

**Sources:**
- [Animate text in After Effects](https://helpx.adobe.com/after-effects/using/examples-resources-text-animation.html)
- [Text range selector position value expression](https://community.adobe.com/t5/after-effects/text-range-selector-position-value-expression/td-p/11839119)
- [Text Animation - Range Selector - Specific Characters?](https://community.adobe.com/t5/after-effects-discussions/text-animation-range-selector-specific-characters/td-p/11362404)

---

## 6. Expression-Linked Control Rigs: Slider, Color, and Dropdown Controls

### Adding Expression Controls via Scripting

**Expression Controls** are effects that act as abstract parameters, not tied to visual properties. Available types:

- **ADBE Slider Control** — Single numerical slider (0–100 by default, customizable)
- **ADBE Color Control** — Color picker (RGBA)
- **ADBE Dropdown Control** — Dropdown menu (scriptable in AE 26.0x40+)
- **ADBE Angle Control** — Angle value (-360° to 360°)
- **ADBE Checkbox Control** — Boolean on/off
- **ADBE Layer Control** — Layer reference
- **ADBE Point3D Control** — 3D point (X, Y, Z)

### Adding Slider Control

```javascript
var nullLayer = comp.layer("Controller Null");

// Add Slider Control effect
var sliderEffect = nullLayer.Effects.addProperty("ADBE Slider Control");
sliderEffect.name = "Speed Multiplier";

// Access the slider's value property
var sliderValue = sliderEffect.property("Slider");
sliderValue.setValue(100);  // Default value
```

### Adding Color Control

```javascript
var colorEffect = nullLayer.Effects.addProperty("ADBE Color Control");
colorEffect.name = "Text Color";

// Set default color [R, G, B, A] where values are 0–1
colorEffect.property("Color").setValue([1, 0, 0, 1]);  // Red
```

### Adding Dropdown Menu Control (AE 26.0x40+)

**Creating with Items:**

```javascript
var dropdownEffect = nullLayer.Effects.addProperty("ADBE Dropdown Control");
dropdownEffect.name = "Animation Style";

// Set dropdown items (only works at creation time)
var dropdownMenu = dropdownEffect.property(1);  // property(1) is the actual menu
var menuItems = ["Fade In", "Slide In", "Scale Up", "(-", "Custom"];  // "(-" is a divider
dropdownMenu.setPropertyParameters(menuItems);

dropdownMenu.setValue(1);  // Default to first item (1-based indexing)
```

**Limitations:**
- Menu items can **only be set at creation time** via `setPropertyParameters()`
- Once populated, dropdown items are locked and cannot be modified
- In AE 26.0x40+, you can read dropdown items via the `propertyParameters` property

### Writing Expressions to Reference Controls

**Basic Syntax:**

```javascript
// Reference Slider Control on null layer named "Controller"
var sliderRef = thisComp.layer("Controller").effect("Speed Multiplier")("Slider");

// Use in animation (e.g., on another layer's Opacity)
thisComp.layer("Text Layer").transform.opacity * (sliderRef / 100)
```

**On Text Layer's Opacity:**

```javascript
// Driven by Slider Control on controller null
var speedCtrl = thisComp.layer("Controller").effect("Speed Multiplier")("Slider");
var animationDuration = 2;  // seconds

// Animate opacity based on slider value (0–100 maps to opacity %)
(speedCtrl / 100) * 100
```

**On Text Color:**

```javascript
// Driven by Color Control on controller null
thisComp.layer("Controller").effect("Text Color")("Color")
```

**On Text Animator via Dropdown:**

```javascript
// Use dropdown to choose animation preset
var styleDropdown = thisComp.layer("Controller").effect("Animation Style")("Dropdown");

if (styleDropdown == 1) {
  // Fade In: opacity 0 to 100
  var start = 0;
  var end = 1;
  linear(time, start, end, 0, 100)
} else if (styleDropdown == 2) {
  // Slide In: position animation
  var start = 0;
  var end = 1;
  linear(time, start, end, -100, 0)
}
```

### Complete Control Rig Example

```javascript
// Create null controller layer
var comp = app.project.activeItem;
var nullLayer = comp.layers.addNull();
nullLayer.name = "Text Animation Controller";

// Add Slider Control for speed
var speedSlider = nullLayer.Effects.addProperty("ADBE Slider Control");
speedSlider.name = "Animation Speed";
speedSlider.property("Slider").setValue(100);

// Add Color Control for text color
var colorControl = nullLayer.Effects.addProperty("ADBE Color Control");
colorControl.name = "Text Color";
colorControl.property("Color").setValue([1, 1, 1, 1]);  // White

// Add Dropdown for animation type
var dropdownEffect = nullLayer.Effects.addProperty("ADBE Dropdown Control");
dropdownEffect.name = "Animation Type";
dropdownEffect.property(1).setPropertyParameters(["Fade", "Slide", "Scale"]);
dropdownEffect.property(1).setValue(1);

// Now link text layer's opacity to slider
var textLayer = comp.layer("Text Layer 1");
var textAnimator = textLayer.Text.Animators.addProperty("ADBE Text Animator");
var opacityProp = textAnimator.property("ADBE Text Animator Properties").addProperty("ADBE Text Opacity");

// Set expression on opacity to use slider
opacityProp.expression = 'var ctrl = thisComp.layer("Text Animation Controller").effect("Animation Speed")("Slider"); ctrl';
```

**Sources:**
- [Using expression controls](https://helpx.adobe.com/after-effects/using/expression-controls.html)
- [Use expressions to create drop-down lists in Motion Graphics templates](https://helpx.adobe.com/after-effects/using/create_dropdowns_using_expressions.html)
- [Expression & Scripting Access for Dropdown Text and Keyframes in After Effects Beta 26.0x40](https://community.adobe.com/announcements-532/expression-scripting-access-for-dropdown-text-and-keyframes-in-after-effects-beta-26-0x40-314514)
- [Scripting the values in the selected dropdown menu](https://community.adobe.com/questions-529/scripting-the-values-in-the-selected-dropdown-menu-52069)
- [Change text colour with an existing slider control](https://community.adobe.com/t5/after-effects/change-text-colour-with-an-existing-slider-control/td-p/9702032)

---

## 7. Previewing Animations in CEP Panels

### Challenge: Live Rendering in Panels Is Not Practical

After Effects does **NOT support live composition rendering within a CEP panel** in a straightforward way. There is no documented API to:

- Request AE to render a composition to a buffer/canvas
- Stream live preview to the panel UI
- Trigger real-time preview playback from panel controls

### Industry Approach: Pre-Rendered Preview Files

**Motion Bro and Animation Composer Strategy:**

Both popular animation library plugins use the same approach:

1. **Pre-Render Preview Files:** Each animation preset is rendered to:
   - **MP4 video files** (most common, good quality, small file size)
   - **GIF files** (older approach, larger file size)
   - **PNG sequences** (rarely used)

2. **File Organization:** Preview files are organized in directories matching preset categories:
   ```
   Motion Bro Presets/
   ├── Transitions/
   │   ├── Fade.mp4
   │   ├── Slide.mp4
   └── Text/
       ├── Character Reveal.mp4
       └── Word Pop.mp4
   ```

3. **Panel Display:** The CEP panel displays video thumbnails/tiles using standard HTML5 `<video>` elements or GIF `<img>` elements, with play-on-hover for video previews.

4. **Rendering Workflow:** Motion Bro provides a "Render Preview Files" feature inside AE that:
   - Iterates through preset compositions
   - Renders each to a video file
   - Saves to the corresponding folder
   - This is done once per preset library, offline

### Rendering Compositions Programmatically (For Building Previews)

**Using Adobe Media Encoder or Render Queue:**

```javascript
// Queue composition for render to MP4
var comp = app.project.item(1);
var renderQueue = app.project.renderQueue;

// Add composition to render queue
var renderItem = renderQueue.items.add(comp);

// Set output module to MP4
var outputModule = renderItem.outputModule(1);
outputModule.file = new File("/path/to/preview.mp4");

// Set render settings (codec, quality, etc.)
var template = renderItem.outputModule(1).templates;
// Use a built-in template or customize settings

// Render asynchronously
if (renderQueue.canQueueInAME) {
  renderQueue.queueInAME(true);  // Send to Media Encoder
} else {
  // Render via After Effects render queue
  renderQueue.render();
}
```

**Limitations:**
- Direct MP4 output codec support is limited in recent AE versions
- Workaround: Render to **image sequence** (PNG/TGA) + use FFmpeg externally to encode video
- Async rendering via `renderAsync()` returns a callback you can hook for post-processing

### Practical CEP Panel Implementation

**HTML5 Video Preview Example:**

```html
<div class="preset-item">
  <video width="200" height="150" controls style="cursor: pointer;">
    <source src="file:///C:/presets/Character%20Reveal.mp4" type="video/mp4">
  </video>
  <p>Character Reveal</p>
  <button onclick="applyPreset('Character Reveal')">Apply</button>
</div>
```

**JavaScript CEP Panel Logic:**

```javascript
function applyPreset(presetName) {
  // Call AE scripting via csInterface
  var csInterface = new CSInterface();
  var script = `
    var comp = app.project.activeItem;
    var textLayers = [];
    for (var i = 1; i <= comp.numLayers; i++) {
      if (comp.layer(i).kind == LayerKind.TEXT) {
        comp.layer(i).selected = true;
        comp.layer(i).applyPreset("` + presetName + `");
        comp.layer(i).selected = false;
      }
    }
  `;
  
  csInterface.evalScript(script, function(result) {
    console.log("Preset applied: " + result);
  });
}
```

**Recommended Approach for This Plugin:**

1. Ship **pre-rendered MP4 files** with the plugin for each animation preset
2. Display as thumbnails/hover-to-play in the CEP panel
3. On "Apply" click, use `Layer.applyPreset()` to apply the preset
4. Optionally include a "Preview Mode" that renders the current comp with the preset applied to a temporary layer
5. For advanced users, expose a "Render Previews" feature that uses AE's render queue for custom presets

**Sources:**
- [How to create an After Effects presets pack compatible with Motion Bro](https://motionbro.com/help/how-to-create-an-after-effects-presets-pack-compatible-with-motion-bro/)
- [Motion Bro Preview](https://motionbro.com/plugin/)
- [Basics of rendering and exporting in After Effects CC](https://helpx.adobe.com/after-effects/using/basics-rendering-exporting.html)
- [Automated rendering and network rendering in After Effects](https://helpx.adobe.com/after-effects/using/automated-rendering-network-rendering.html)
- [Problem with motion bro & previewing presets](https://community.adobe.com/t5/after-effects-discussions/problem-with-motion-bro-amp-previewing-presets/td-p/12608166)

---

## 8. .ffx File Format: Binary and Opaque

### Format Status: **Undocumented Binary**

**Key Findings:**

1. **Binary, Not Text:** The .ffx format is **binary**, not XML or text-based. Opening in a text editor produces unreadable gibberish.

2. **No Public Specification:** Adobe has **not published** the .ffx file format specification. The binary structure is proprietary and reverse-engineered documentation is not available in community sources.

3. **Immutable via Script:** There is no API to programmatically:
   - Generate .ffx files from code
   - Edit existing .ffx files programmatically
   - Read/parse .ffx files to extract preset metadata

4. **Pseudo-Effects Workaround:** For advanced cases, you can register custom effects as "pseudo effects" by editing the PresetEffects.xml file, but this does NOT create portable .ffx presets.

### Can Presets Be Generated Programmatically?

**Status: NOT DIRECTLY. Workarounds Exist but Are Limited.**

**Option 1: Simulate Save Dialog (Not Recommended)**
```javascript
// This opens the save dialog but requires user interaction
app.executeCommand(3075);
```

**Option 2: XML Registration Method (Advanced)**
- Modify `PresetEffects.xml` to register pseudo effects
- Limited to effect/property registration, not full preset templates
- Not portable across systems

**Option 3: Third-Party Tools (Not Documented)**
- Some tools claim to generate .ffx files, but these are not officially supported
- Source code for .ffx generation is not publicly available

### Practical Implication for Your Plugin

**Presets must be hand-authored in After Effects:**

1. Create the animation in AE (text animators, keyframes, effects)
2. Select all animated layers/properties
3. Use **Animation > Save Animation Preset**
4. Save the .ffx file to a known folder (e.g., `plugin/presets/`)
5. Distribute the .ffx files with the plugin

**The plugin can then:**
- Browse the .ffx folder and display in the CEP panel
- Apply presets via `Layer.applyPreset()` with no need to generate files
- Store metadata separately (e.g., JSON) to describe each preset

**Example Directory Structure:**
```
capset-plugin/
├── presets/
│   ├── text-animators/
│   │   ├── Character Reveal.ffx
│   │   ├── Word Pop.ffx
│   │   └── metadata.json  // {name, description, duration, preview: "path/to/mp4"}
│   └── effects/
│       └── Color Shift.ffx
└── preview-videos/
    ├── Character Reveal.mp4
    └── Word Pop.mp4
```

**Sources:**
- [Effects and animation presets in After Effects](https://helpx.adobe.com/after-effects/using/effects-animation-presets-overview.html)
- [Editing a .ffx file](https://community.adobe.com/t5/after-effects-discussions/editing-a-ffx-file/td-p/10814998)
- [Noob friendly guide how to create pseudo effect ffx presets](https://community.adobe.com/t5/after-effects-discussions/noob-friendly-guide-how-to-create-pseudo-effect-ffx-presets-that-can-be-used-on-any-system/m-p/15208584)

---

## 9. Recommended Plugin Architecture

Based on this research, here's the optimal architecture for your animation library plugin:

### Core Components

1. **Preset Library Storage**
   - Distribute hand-authored .ffx files with the plugin
   - Store metadata (name, description, duration, preview path) in JSON

2. **CEP Panel UI**
   - Display animation presets as thumbnail grid
   - Show MP4 video previews on hover
   - "Apply" button triggers `Layer.applyPreset()`

3. **Optional Control Rig System**
   - Create null controllers with Slider/Color/Dropdown controls
   - Expose advanced users to expression-linked customization
   - Store control rig presets as .aep or as XML-based layer structures

4. **Preview System**
   - Ship pre-rendered MP4 files
   - Optionally expose "Render Previews" feature for custom presets (uses AE render queue)

### Scripting Strategy

```javascript
// Core preset application function
function applyTextAnimation(layerIndex, presetName) {
  var comp = app.project.activeItem;
  var layer = comp.layer(layerIndex);
  
  layer.selected = true;
  layer.applyPreset(presetName);
  
  // Optional: Adjust timing
  adjustPresetTiming(layer, layer.inPoint);
  
  layer.selected = false;
}

// Optional: Create control rig on null layer
function createControlRig(comp, animationPresets) {
  var nullLayer = comp.layers.addNull();
  nullLayer.name = "Animation Controls";
  
  // Add speed slider
  var speedSlider = nullLayer.Effects.addProperty("ADBE Slider Control");
  speedSlider.name = "Speed";
  
  // Add color control
  var colorCtrl = nullLayer.Effects.addProperty("ADBE Color Control");
  colorCtrl.name = "Color";
  
  // Add animation type dropdown
  var dropdown = nullLayer.Effects.addProperty("ADBE Dropdown Control");
  dropdown.name = "Animation Type";
  dropdown.property(1).setPropertyParameters(animationPresets);
  
  return nullLayer;
}
```

---

## 10. Summary of Findings

| Question | Finding | Source |
|----------|---------|--------|
| **MOGRTs in AE?** | No—MOGRTs are Premiere-only. Cannot import into AE. Use Animation Presets instead. | Adobe Help, Community |
| **Animation Presets (.ffx)** | Portable binary files stored in user presets folder. Created via UI "Save Animation Preset". | Adobe Help |
| **Layer.applyPreset()** | Applies preset to selected layers. Keyframes use preset's original timing. No time offset control. | Scripting Docs, Community |
| **Text Animators** | Can add via `addProperty("ADBE Text Animator")`. Support full property list (Position, Scale, Opacity, etc.). | Community Examples |
| **Range Selectors** | Configurable by character/word/line. Units: percent or index. Scriptable with standard property names. | Community Forums |
| **Slider/Color/Dropdown** | Can add via `addProperty()`. Expressions reference via `effect("name")("property")`. Dropdown items set at creation. | Scripting Docs |
| **Preview in Panels** | No live rendering support. Industry standard: pre-render MP4s, display as thumbnails. | Motion Bro, Plugin Examples |
| **.ffx Format** | Binary, proprietary, undocumented. **Cannot generate programmatically.** Must hand-author in AE. | Adobe + Community |

---

## Sources

- [Create Motion Graphics templates with Essential Graphics panel](https://helpx.adobe.com/after-effects/using/creating-motion-graphics-templates.html)
- [How to open mogrt files in Adobe After Effects](https://helpx.adobe.com/after-effects/desktop/using/video/creating-motion-graphics-templates-video.html)
- [Effects and animation presets in After Effects](https://helpx.adobe.com/after-effects/using/effects-animation-presets-overview.html)
- [Layer object - After Effects Scripting Guide](https://ae-scripting.docsforadobe.dev/layer/layer/)
- [Animating text in After Effects](https://helpx.adobe.com/after-effects/using/animating-text.html)
- [Using expression controls](https://helpx.adobe.com/after-effects/using/expression-controls.html)
- [Use expressions to create drop-down lists in Motion Graphics templates](https://helpx.adobe.com/after-effects/using/create_dropdowns_using_expressions.html)
- [Basics of rendering and exporting in After Effects CC](https://helpx.adobe.com/after-effects/using/basics-rendering-exporting.html)
- [How to create an After Effects presets pack compatible with Motion Bro](https://motionbro.com/help/how-to-create-an-after-effects-presets-pack-compatible-with-motion-bro/)
- [Can you use Essential Graphics (mogrt files) in After Effects?](https://community.adobe.com/questions-529/can-you-use-essential-graphics-mogrt-files-in-after-effects-37655)
- [Script for Applying Animation Preset to Layer](https://community.adobe.com/t5/after-effects/script-for-applying-animation-preset-to-layer/td-p/9707877)
- [Is there a way to save animation preset by script?](https://community.adobe.com/t5/after-effects/is-there-a-way-to-save-animation-preset-by-script/td-p/8194340)
- [Add Range Selector in Text by Script](https://community.adobe.com/t5/after-effects-discussions/add-range-selector-in-text-by-script/td-p/15132915)
- [Expression & Scripting Access for Dropdown Text and Keyframes in After Effects Beta 26.0x40](https://community.adobe.com/announcements-532/expression-scripting-access-for-dropdown-text-and-keyframes-in-after-effects-beta-26-0x40-314514)
- [Text range selector position value expression](https://community.adobe.com/t5/after-effects/text-range-selector-position-value-expression/td-p/11839119)
- [Scripting the values in the selected dropdown menu](https://community.adobe.com/questions-529/scripting-the-values-in-the-selected-dropdown-menu-52069)
- [Editing a .ffx file](https://community.adobe.com/t5/after-effects-discussions/editing-a-ffx-file/td-p/10814998)
- [Automated rendering and network rendering in After Effects](https://helpx.adobe.com/after-effects/using/automated-rendering-network-rendering.html)

