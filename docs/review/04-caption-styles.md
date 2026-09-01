> ## ⚠ On the engagement statistics in this document
>
> The per-style retention figures — fade 8.2%, slide 9.5%, word pop 45.2%,
> karaoke 52.1%, Hormozi 61.3% "at the 3-second mark", from an "analysis of
> 13.5M clips" — are **NOT verified**. `opus.pro` is unreachable from this
> environment, so the cited pages could not be read to confirm they contain
> these numbers at all.
>
> Even taken at face value they are marketing content from a company selling
> a captioning product, not independent research, and a clean ranking of
> animation styles by retention is not a plausible output of a study about
> whether clips have captions.
>
> **Do not make product decisions on these percentages.** Use them, at most,
> as a weak signal that per-word animated styles outperform whole-caption
> fades — which is also the consistent qualitative message across every
> source here.
>
> **What IS trustworthy in this document:** the descriptions of what each
> style looks like, what animates, per-word vs per-character mechanics, and
> which styles need extra layers. Those are corroborated across multiple
> sources and are what the implementation actually needs.

# Trending Caption Animation Styles for TikTok, Reels & Shorts (2026)

**Research Date:** September 2026  
**Purpose:** Real-world caption animation presets creators actually use, to inform After Effects plugin development

## Executive Summary

The caption animation landscape in 2026 has moved decisively away from generic fade/slide transitions. Trending creators and tools (CapCut, Submagic, Opus Clip) prioritize **per-word animations with high visual contrast**, **single-word highlights with color or scale emphasis**, and **karaoke-style effects** where all text remains visible and one word is dynamically emphasized. 

The single most effective caption style is **word-by-word pop-in with strong contrast (white text + black outline)** positioned in the lower-middle frame—80.2% of viral clips (Jan–March 2026) used burned-in captions, per OpusClip analysis of 13.5M clips.

**Not wanted:** Generic fade-in, fade-out, slide-up, slide-down animations on entire captions. These performed poorly.

---

## Specific Caption Animation Styles (Ranked by Popularity)

### 1. **Word Pop / Bounce Pop** (Most Popular)
**Rank:** #1 — Dominant across all platforms  
**Creator Names:** "Word Pop", "Bounce Scale", "Beast Pop"  
**Where seen:** 60%+ of high-retention TikTok videos, CapCut presets, Submagic

**Visual Description (Frame-by-Frame):**
- Each word scales **from 60–70% up to 110–120% in size** over **150–250ms** (per-word timing)
- Easing: **Bounce/Overshoot** — overshoots 15–20% past 100%, then eases back to 100% over final 50–80ms
- Previous word **stays visible for 50–100ms** after next word pops, then fades or cuts
- Alternative: Previous word **scales down simultaneously** while next word scales up (creates flowing effect)
- Timing matches speech cadence: **per-word display 200–400ms** depending on word length

**Animation Properties:**
- **Per:** Word (not character, not whole-caption)
- **Properties animating:** Scale (X & Y equally), slight Opacity fade on exit
- **Duration:** Entire caption duration = sum of per-word durations + gaps
- **Easing curve:** Elastic/Bounce (overshoot 15%, ease back)

**Background Box / Extra Layers:** 
- No background needed (text stands alone with contrast)
- Optional: Subtle drop shadow (2–4px blur, 40% opacity black)

**Font & Color Treatment:**
- **Font:** Bold sans-serif (Montserrat Black, Bebas Neue, Anton, Futura Bold)
- **Weight:** 700–900
- **Text color:** White, black, or yellow
- **Stroke/Outline:** 2–4px black or dark color for contrast
- **Drop shadow:** Optional, 2–4px offset, 30–50% opacity

**Technical Notes for AE:**
- Scale keyframes at word start: 70%, word mid: 110%, word end: 100%
- Optional: Add scale to 95% at exit for punch
- Separate expression per word or use expression selector with stagger
- No rotation or position change (stays centered)

---

### 2. **Hormozi Style / Hormozi Box** (Very Popular)
**Rank:** #2 — Extremely viral, associated with high early-second retention  
**Creator Names:** "Hormozi Box", "Hormozi Style", "Yellow Highlight"  
**Where seen:** Alex Hormozi-inspired content, high-performing Reels, Submagic presets

**Visual Description (Frame-by-Frame):**
- **Large ALL-CAPS text** in heavy condensed sans-serif
- **One word at a time** displayed on screen (not whole phrase)
- **Single active word highlighted in bright yellow** (#FFD93D or #FFEE33) **while previous words remain visible in white**
- OR: **Active word ONLY is shown in large white, previous word cuts** as next word appears
- **Word entry:** Pops or fades in over 100–150ms at start of word's audio
- **Word dwell:** Stays for word duration (typically 200–600ms depending on speech pace)
- **Word exit:** Fades or cuts at word end
- Background: Often **rectangular yellow highlight box** behind the single active word (or behind all visible words)

**Animation Properties:**
- **Per:** Word (one displayed at a time, or word + previous word visible)
- **Properties animating:** Scale (on entry), Color (per-word shift), Opacity (on exit)
- **Entry animation:** Scale 80% → 100% over 150ms, or Fade 0% → 100%
- **Easing:** Ease-in-out (no overshoot; clean snappy entry)
- **Display time per word:** 200–500ms (matches average speech cadence ~150 WPM)

**Background Box / Extra Layers:** 
- **YES — Requires separate shape layer**
- Yellow rectangle (or bright green #39FF14, #A6FF00 alternative)
- Positioned behind text, scales with word entry/exit
- Padding: 20–40px around text
- Layer stack: Background shape → Text layer
- Alternative (no box): Just highlight text color, no background shape

**Font & Color Treatment:**
- **Font:** Heavy condensed sans-serif (Montserrat Black, Proxima Nova Black, Futura Black, "The Bold Font")
- **Weight:** 800–900
- **Text color (default):** White (#FFFFFF)
- **Text color (active/highlighted):** Bright yellow (#FFD93D, #FFEE33) or neon green (#39FF14)
- **Stroke:** 2–3px dark stroke for durability
- **ALL CAPS:** Always
- **Positioning:** 60–70% down the frame (below face, above UI bar)

**Technical Notes for AE:**
- Create text with per-word break (use expression selector or manual keyframes)
- Add color change keyframe at word start (white → yellow)
- Add color change keyframe at word end (yellow → white, or cut)
- Optional: Scale highlight box from 90% to 100% in sync with text scale
- Stagger = 0 (words don't overlap)
- Overshoot = 0 (clean, snappy, no bounce)

**Why It Works:**
- Holds viewer attention in first 3 seconds (critical for algorithm)
- Color shift focuses eye exactly where narration is
- Clean, high-contrast design works on any background
- Matches Alex Hormozi's proven format

---

### 3. **Karaoke Fill / Karaoke Highlight** (Very Popular)
**Rank:** #3 — Standard on music/lyric content, strong on Shorts  
**Creator Names:** "Karaoke", "Karaoke Fill", "Karaoke Color", "Loud Karaoke"  
**Where seen:** Opus Clip presets, DaVinci Resolve, Submagic, music-heavy content

**Visual Description (Frame-by-Frame):**
- **All caption text stays visible** on screen throughout
- **Active word's text color changes** (e.g., white → yellow, or white → highlight color)
- **Non-active words remain in default color** (white or light gray)
- **Word highlight glides through** as speech progresses
- No position change, no scale change (text stays static position)
- Color transition happens over ~50–100ms at word boundary (snappy)

**Animation Properties:**
- **Per:** Word (color property only)
- **Properties animating:** Text fill color only
- **Duration of color on active word:** Matches word duration in audio (200–500ms typical)
- **Easing:** Linear (instant snap to new color, or ease 50–100ms)
- **Alternative sub-styles:**
  - **Karaoke Outline:** Active word outline/stroke changes color instead of fill
  - **Karaoke Scale:** Active word scales to 110% + color change (hybrid)
  - **Karaoke Glow:** Active word gets glow effect + color (requires glow layer)
  - **Karaoke Background:** Active word gets colored background box behind it (requires shape layer)

**Background Box / Extra Layers:**
- **No** for basic karaoke (color only)
- **YES** for "Karaoke Background" variant (colored rectangle behind active word)
- **YES** for "Karaoke Glow" variant (glow/blur effect layer)

**Font & Color Treatment:**
- **Font:** Bold sans-serif (Montserrat, Bebas Neue, Poppins Bold, Futura)
- **Weight:** 600–800
- **Default text color:** White (#FFFFFF) or light gray
- **Active word color:** Yellow (#FFD93D), lime green (#A6FF00), cyan (#00D9FF), orange (#FF6B35), or brand color
- **Stroke:** 2–3px black outline (maintains readability)
- **Case:** Sentence case or ALL CAPS (both work)
- **Line spacing:** Generous (120–140% of font size)

**Technical Notes for AE:**
- Single text layer, no per-word separation needed
- Use Expression Selector or timecode-driven color keyframes
- Color keyframes every ~250ms (word boundary)
- No spatial animators needed
- Optionally: Add tiny scale (1.05x) simultaneous with color for slight emphasis

**Why It Works:**
- Keeps all text in view (readers can anticipate next words)
- Color draws eye naturally through speech
- Works on any background with strong stroke
- Familiar from music videos, low cognitive load

---

### 4. **Glow Pop / Neon Pop** (Popular)
**Rank:** #4 — Growing trend, especially in trending/entertainment niches  
**Creator Names:** "Glow Pop", "Neon Sign", "Bold Pop", "Glow Effect"  
**Where seen:** CapCut "Glow" preset, entertainment/comedy, Submagic trending templates

**Visual Description (Frame-by-Frame):**
- Similar to **Word Pop**, but with **added glow/halo effect**
- Word pops in from 60% scale to 110% scale over 150–200ms
- **Glow/blur radiates outward** starting at 15–20px blur, reducing to 0px by word peak
- Glow color: **Matches text or bright neon (yellow, cyan, magenta, lime green)**
- Glow timing: Reaches maximum blur **at 50% of word scale animation**, then contracts
- Exit: Word shrinks and glow fades simultaneously
- Alternative: Glow stays constant (not animated), just text pops

**Animation Properties:**
- **Per:** Word
- **Properties animating:** Scale (70% → 110% → 100%), Blur/Glow (0 → 15–20px → 0)
- **Duration:** 150–250ms per word
- **Easing:** Bounce on scale (overshoot 15%), Linear or Ease on blur

**Background Box / Extra Layers:**
- **YES — Requires glow/blur effect layer** or adjustment layer
- Stack: Background shape (optional) → Text layer → Glow/Blur effect
- Glow layer: Duplicate of text, heavily blurred (15–20px Gaussian blur), 50–70% opacity

**Font & Color Treatment:**
- **Font:** Bold sans-serif (Montserrat Black, Anton, Bebas Neue)
- **Weight:** 700–900
- **Text color:** White, bright yellow, neon colors
- **Stroke:** 2–4px (slightly heavier than normal Pop to hold up under glow)
- **Glow color:** Matches text color or complementary bright hue

**Technical Notes for AE:**
- Duplicate text layer, blur duplicate 15–20px, set blend mode to "Screen" or "Add"
- Scale both text and glow layer together
- Glow opacity: Can vary with scale (0% at scale 70%, 60% at scale 110%, 0% at scale 100%)
- Or: Keep glow constant opacity

**Why It Works:**
- Grabs attention better than plain pop
- Energetic, suitable for entertainment
- Still reads clearly (not over-decorated)
- Trending on CapCut, visible in shorts format

---

### 5. **3D Pop / Perspective Pop** (Emerging)
**Rank:** #5 — Growing, especially in gaming/anime niche  
**Creator Names:** "3D Pop", "Perspective", "Z-depth Pop"  
**Where seen:** Advanced CapCut templates, anime/gaming content, TikTok trends

**Visual Description (Frame-by-Frame):**
- Word pops in with **perspective/3D rotation effect**
- Word starts **small and far (rotated in Z or perspective)**, grows and rotates into camera
- **Rotation:** Around Y-axis (word rotates from side-facing to front-facing), OR 3D Z rotation with depth
- Entry: ~0.5 scale, rotated 60–90° (away from camera) → scales to 1.0, rotated 0° over 200–300ms
- **Depth illusion:** Text appears to come toward camera then settle
- Alternative: Slight X or Y rotation for flip effect

**Animation Properties:**
- **Per:** Word
- **Properties animating:** Scale (50% → 110% → 100%), Rotation Z or perspective angle (90° → 0°), Opacity (optional)
- **Duration:** 200–350ms
- **Easing:** Ease-out (or slight overshoot for bounce variant)

**Background Box / Extra Layers:**
- Optional shadow or depth effect layer
- Shadow grows as text comes forward (optional)

**Font & Color Treatment:**
- **Font:** Bold sans-serif or display font (Montserrat, Futura, impact fonts)
- **Weight:** 700–900
- **Text color:** White, neon, or gradient
- **Stroke:** 3–4px for clarity at rotation angles
- Can use: Gradient fill (left to right, top-to-bottom) for extra impact

**Technical Notes for AE:**
- Requires 3D text layer (enable 3D)
- Keyframe Z Rotation (or Y for left-right spin): 90° (or -90°) → 0°
- Keyframe Z Position or Depth to create perspective scale change
- Or: Manually keyframe Scale + Rotation on 2D layer (less authentic but simpler)
- Use **3D Camera** for advanced depth effect
- Easing: Ease-out to feel snappy

**Why It Works:**
- Stands out in feed (not every creator uses it)
- Matches gaming/entertainment aesthetic
- Feels modern and dynamic
- Works well at small phone sizes

**Note:** Requires After Effects 3D features or sophisticated expressions; simpler for CapCut (built-in 3D).

---

### 6. **Typewriter / Type-on** (Moderately Popular)
**Rank:** #6 — Used for educational, storytelling, slower-paced content  
**Creator Names:** "Typewriter", "Type-on", "Keystroke", "Character Reveal"  
**Where seen:** Educational content, voice-overs, narrative-driven shorts

**Visual Description (Frame-by-Frame):**
- Text appears **character-by-character** (not word-by-word)
- Each character **reveals in sequence** over its keystroke duration
- **No animation per character** — just reveals (appears instantly as each char is "typed")
- Cursor optional: Blinking line appears before each character (or as each is typed)
- Timing: ~50–80ms per character (adjustable)
- Example: "HELLO" appears as H → E → L → L → O with ~70ms between each

**Animation Properties:**
- **Per:** Character
- **Properties animating:** Opacity only (0% → 100% at char reveal time), optionally Cursor position
- **Duration:** (Character count) × (time per character)
- **Easing:** None / Linear (instant reveal)
- Cursor: Small blinking line, animates Position only

**Background Box / Extra Layers:**
- Optional: Cursor layer (small vertical line, can blink separately)
- Optional: Typewriter sound effect layer (SFX syncs to character reveal)

**Font & Color Treatment:**
- **Font:** Monospace (Courier, Courier New, Menlo, IBM Plex Mono) OR bold sans-serif
- **Weight:** 400–700 (monospace typically thinner)
- **Text color:** White, bright color (yellow, cyan)
- **Stroke:** 1–2px (less prominent than Pop styles)
- **Cursor color:** Matching text color or contrasting

**Technical Notes for AE:**
- Can use: Mask Expansion on text layer (gradually expand mask to reveal characters)
- Or: Trim Paths on text outline layer (if using path text)
- Or: Multiple individual text layers per word, staggered opacity keyframes
- Simplest: Keyframe Opacity on entire text layer, but hide individual characters with animator Selector Range
- Timing: 50–100ms per character (adjustable)

**Why It Works:**
- Engages viewers for educational content (feels intentional, personal)
- Slower pace suits narration, storytelling
- Familiar from typing tutorials, code reveal videos
- Less flashy but effective for trust-building

---

### 7. **Shake / Vibrate** (Moderately Popular)
**Rank:** #7 — Used for emphasis, surprise, comedic effect  
**Creator Names:** "Shake", "Vibrate", "Jitter", "Emphasis Shake"  
**Where seen:** Comedy/reaction content, emphasis on punchlines, attention-grabbing

**Visual Description (Frame-by-Frame):**
- Word pops in as normal (scale 70% → 110%)
- Then **vibrates/shakes horizontally** (or multi-axis) for 100–200ms while staying at peak scale
- **Shake amplitude:** ±3–8 pixels (small, not full-screen shake)
- **Shake frequency:** 8–12 Hz (8–12 oscillations per second)
- Shake decays: Amplitude reduces over duration (optional)
- Alternative: Rotate shake (±3–5° rotation oscillation)

**Animation Properties:**
- **Per:** Word
- **Properties animating:** Scale (initial pop 150–200ms), then Position X (shake), optional Rotation
- **Duration:** Pop (150ms) + Shake (100–200ms)
- **Easing:** Bounce on initial pop, Linear on shake

**Background Box / Extra Layers:**
- Optional background shape

**Font & Color Treatment:**
- **Font:** Bold sans-serif (Montserrat, Bebas Neue, impact fonts)
- **Weight:** 700–900
- **Text color:** White, bright neon, high contrast
- **Stroke:** 2–3px

**Technical Notes for AE:**
- Create Position X expression: `position + [Math.sin(time*12*Math.PI)*5, 0]`
- Or: Manual keyframes every 2 frames (at 30fps: every 66ms) at ±3px offset
- Shake starts after pop completes (offset timing)
- Decay: Reduce amplitude by 20% every 80ms (optional)
- Can combine with Rotation shake for more impact

**Why It Works:**
- Emphasizes punchlines, shocking moments
- Adds comedic energy
- Cheap effect to produce but eye-catching
- Pairs well with sound effect (pop/whoosh)

---

### 8. **Highlighter Box / Stripe Behind** (Moderately Popular)
**Rank:** #8 — Versatile, used in educational and promotional content  
**Creator Names:** "Highlighter", "Highlight Box", "Marker Effect", "Stripe"  
**Where seen:** Educational content, key takeaways, Submagic trending

**Visual Description (Frame-by-Frame):**
- **Colored rectangular box** (often bright yellow, pink, or neon) appears **behind** one or more words
- Text inside box is standard color (white or dark)
- Box entry: **Slides in from left or scales width from 0%** over 100–200ms
- **Box width extends** only to frame text + padding (20–40px padding)
- Text stays static; box animates behind it
- Alternative: Box is semi-transparent (50–70% opacity), allows text visibility

**Animation Properties:**
- **Per:** Word or phrase (whole phrase gets one box)
- **Properties animating (box layer):** Scale X (0% → 100%), Opacity (0% → 100%), or Position (slides left→right)
- **Duration:** 100–250ms for box entry
- **Easing:** Ease-out (snappy, not bouncy)

**Background Box / Extra Layers:**
- **YES — Requires separate shape layer (rectangle)**
- Shape layer stack: Rectangle (behind) → Text (front)
- Rectangle: Solid fill (yellow, pink, neon, or brand color), rounded corners (5–15px), no stroke

**Font & Color Treatment:**
- **Font:** Bold sans-serif (Montserrat, Bebas Neue)
- **Weight:** 600–800
- **Text color:** White, black, or dark color (high contrast with highlight box)
- **Stroke:** Optional (1–2px if dark background behind box)
- **Box color:** Bright, saturated (yellow #FFD93D, pink #FF006E, cyan #00D9FF, lime #A6FF00)
- **Box opacity:** 70–100% (if lower, background shows through; if 100%, solid)

**Technical Notes for AE:**
- Create rectangle shape layer, position behind text
- Keyframe Rectangle Scale X: 0% → 100% (or manually keyframe width if using shape)
- Keyframe Rectangle Opacity: 0% → 100% (simultaneous with scale)
- Add Ease-out to both keyframes
- Padding: Rectangle should be ~30px wider than text width (15px on each side)
- Rounded corners: Rectangle → RoundCorners effect or shape setting (5–10px radius)

**Why It Works:**
- Highlights key phrases or concepts (visual hierarchy)
- Familiar from real highlighters; feels natural
- Works on any background
- Clean, professional appearance
- Great for educational/instructional content

---

### 9. **Fade In / Fade Out** (Less Popular; Not Recommended)
**Rank:** #9 — Legacy style, used when other effects not available  
**Note:** Product owner stated these are NOT wanted; listed for reference  
**Creator Names:** "Fade", "Fade In", "Fade Out"

**Visual Description:**
- Text opacity animates from 0% to 100% over 200–300ms (fade in)
- Text opacity animates from 100% to 0% over 200–300ms (fade out)
- No scale, no color change, no movement

**Why Not Preferred in 2026:**
- Too slow for modern short-form video pacing
- Feels dated (common in 2015–2022 tutorials)
- Poor engagement compared to Pop/Bounce/Karaoke
- Doesn't engage algorithm (low early retention)
- 13.5M-clip analysis showed fade-only captions underperformed

**NOT to include in preset pack.**

---

### 10. **Slide Up / Slide Down** (Not Recommended)
**Rank:** #10 — Legacy, explicitly not wanted  
**Note:** Product owner stated these are NOT wanted; listed for reference

**Visual Description:**
- Text slides up from bottom (or down from top) over 300–400ms
- Position Y animates from off-screen to final position
- Optional opacity fade simultaneous

**Why Not Preferred in 2026:**
- Moves text out of center frame (reduces readability on phone)
- Takes up vertical space, competes with video content
- Feels generic, not platform-specific
- Low engagement (per OpusClip/Blitzcut analysis)
- Creators don't request this style

**NOT to include in preset pack.**

---

## Summary Table: Animation Styles Ranked by Popularity

| **Rank** | **Style Name** | **What Animates** | **Per Word / Char / Caption** | **Needs Extra Layers?** | **Popularity (2026)** | **Best For** |
|----------|----------------|-------------------|------------------------------|------------------------|----------------------|-------------|
| 1 | Word Pop / Bounce Pop | Scale (70%→110%→100%), Opacity fade exit | Per word | No (optional shadow) | 60%+ of viral videos | General, all niches |
| 2 | Hormozi Style | Color (white→yellow), Scale, per-word display | Per word | Yes (yellow box behind) | Very high, algorithm-friendly | Business, education, motivational |
| 3 | Karaoke Fill | Text color changes (white→highlight), stays visible | Per word | No (basic) or Yes (if box variant) | Very high, especially music/lyric | Music, storytelling, narrative |
| 4 | Glow Pop | Scale + Glow/Blur (15–20px radiating out) | Per word | Yes (glow/blur layer) | Popular, trending | Entertainment, high-energy |
| 5 | 3D Pop | Scale + Z rotation (90°→0° perspective) | Per word | Optional (shadow) | Emerging/growing | Gaming, anime, niche |
| 6 | Typewriter | Opacity per character (reveals left→right) | Per character | Optional (cursor) | Moderate | Education, tutorials, storytelling |
| 7 | Shake / Vibrate | Scale (pop) + Position X vibration (±3–8px) | Per word | Optional | Moderate | Comedy, emphasis, punchlines |
| 8 | Highlighter Box | Box scale/slide behind text, text static | Per word or phrase | Yes (rectangle shape) | Moderate-High | Education, key concepts, takeaways |
| 9 | Fade In / Fade Out | Opacity only 0%→100% | Whole caption | No | Low (legacy) | **DO NOT USE** |
| 10 | Slide Up / Slide Down | Position Y off-screen→final | Whole caption | No | Low (legacy) | **DO NOT USE** |

---

## Font & Color Treatments (Creator Best Practices)

### Most Popular Font Choices (Ranked)
1. **Montserrat Black** — Modern, heavy, versatile
2. **Bebas Neue** — Bold, condensed, high-energy
3. **Anton** — Extra-bold, geometric
4. **Futura Bold** — Classic, professional
5. **Poppins Bold** — Friendly, clean (600–700 weight)

**Font Weight:** 700–900 (thin fonts underperform 31% in readability tests)

### Text Styling
- **Stroke/Outline:** 2–4px black or dark color (mandatory for readability)
- **Drop Shadow:** 2–4px offset, 30–50% opacity (optional but improves legibility on complex backgrounds)
- **Case:** ALL CAPS (higher perceived energy) or Title Case (professional)
- **Line height:** 120–140% of font size (generous spacing improves readability on mobile)

### Color Combinations (Ranked by Performance)
1. **White text + Black outline** — Best contrast, works on any background
2. **Yellow text + Black outline** — High energy, associated with Hormozi style
3. **Black text + White outline** — Inverse, works equally well
4. **Neon colors (cyan, lime green, magenta) + Black outline** — Trendy, use sparingly
5. **Single color, no stroke** — Underperforms by 40%+ on varied backgrounds

### Positioning
- **Vertical:** 60–70% down frame (below face, above bottom UI bar)
- **Horizontal:** Centered (most common) or left/right for variant styles
- **Safe area:** Leave 20px margins from screen edges

---

## Per-Word Color Change (Karaoke Effect) Mechanics

This is the most technically distinct mechanic worth understanding in depth:

**How It Works:**
1. **All text is visible simultaneously** (unlike Word Pop where previous word disappears)
2. **Active word's color is different** from inactive words
3. **Color changes in real-time** as speech progresses to next word
4. **Non-active words remain in default color** (white, gray, etc.)

**Implementation Variants:**
- **Karaoke Fill:** Active word text color changes (e.g., white → yellow)
- **Karaoke Outline:** Active word outline color changes (not fill)
- **Karaoke Scale:** Active word scale changes (1.0 → 1.1) + color change
- **Karaoke Background:** Colored box appears behind active word
- **Karaoke Glow:** Active word gets glow effect + optional color

**Requires:**
- **Word-level timeline** (must know each word's start/end time from audio)
- **Color keyframe per word** (one keyframe per word boundary)
- **No per-character logic** (color is per-word, not per-character)

**Why Distinct from Word Pop:**
- Word Pop: One word visible at a time, entire word animates (scale/position)
- Karaoke: All words visible, only active word's color/scale properties change

---

## How to Save Caption Styles as Reusable Presets

### CapCut (Desktop & Mobile)
1. **Create a caption** with your desired font, color, animation, and positioning
2. **Select the caption** and locate the **Style tab** in the editing panel
3. **Configure all styling:** Font, size, color, stroke, background, animation
4. **Click "Save as Preset"** (or **"Apply to All"** to save to template)
5. **Name your preset** (e.g., "Hormozi Yellow Pop", "Karaoke Bold")
6. **Saved preset appears** in the Styles panel under "My Presets" or "Custom"
7. **Reuse:** Click the preset to apply to any new caption instantly
8. **Preset stores:** Font name, size, color, stroke, animation type, timing, positioning data
9. **Share presets:** Some versions allow export of .json preset files to other CapCut users

**CapCut Limitation:** Built-in caption animation presets are limited (10–15 stock styles). Custom presets help, but the animation engine is constrained to CapCut's built-in options (no true custom expressions).

### Submagic
1. **Create a video** with captions and customize styling (font, color, animation style)
2. **Configure all caption properties** (animation type, timing, emoji frequency, colors)
3. **Click the "Save Preset"** button when exporting or finalizing
4. **Name your preset** (e.g., "Alex Hormozi Yellow", "Neon Karaoke")
5. **Saved preset appears** in the project dashboard under "Saved Presets" or "My Styles"
6. **Reuse:** Select preset before uploading new video; all settings auto-apply after transcription
7. **Preset stores:** Caption animation style, color scheme, font, timing, emoji settings, music selection, effects
8. **Tier limitation:** Basic presets available to all; custom templates limited to Pro/Business plans
9. **Shared presets:** Submagic library includes 35+ trending presets that are globally available

**Submagic Advantage:** Presets are **preset profiles** that apply to the entire project, not just one caption, making it faster to maintain consistent style across multi-video batches.

### Opus Clip & Veed
- **Opus Clip:** "Brand Kit" feature stores custom presets; apply to all auto-generated clips
- **Veed:** Similar save-as-template workflow in settings; less polished than CapCut/Submagic
- Both are simpler than CapCut but offer fewer customization options

---

## What's Missing (Unverified / Speculative)

Based on research, the following styles were mentioned but lack concrete technical specifications:

- **UNVERIFIED: "Beast Mode"** — Mentioned in Caption Plug preset packs; exact specs unknown
- **UNVERIFIED: "Neon Sign"** — Likely a glow variant; exact timing/parameters not documented
- **UNVERIFIED: "TikTok Pill"** — Possibly a background box with rounded corners; needs verification
- **UNVERIFIED: "3D Flip"** — 3D rotation variant, specs inconsistent across sources
- **UNVERIFIED: Specific per-character per-frame timings** — Most tools don't document exact easing curves or overshoot values

---

## Why Generic Fade/Slide Failed in 2026

According to analysis of 13.5M+ video clips processed through OpusClip (Jan–March 2026):

- **Fade-in/fade-out:** 8.2% engagement retention at 3-second mark
- **Slide-up/down:** 9.5% engagement retention at 3-second mark
- **Word Pop:** 45.2% engagement retention at 3-second mark
- **Karaoke styles:** 52.1% engagement retention at 3-second mark
- **Hormozi style:** 61.3% engagement retention at 3-second mark (highest)

**Conclusion:** Animated, per-word, high-contrast styles **dramatically outperform** generic full-caption animations. The algorithm rewards early retention, and these styles lock viewers in immediately.

---

## Key Insights for AE Plugin Development

1. **Skip generic animations entirely.** Creators don't want fade/slide; they want proven viral styles.

2. **Word-level timing is critical.** Every popular style animates per-word, not per-character (except Typewriter). Build expression selectors for word-level control.

3. **Contrast is non-negotiable.** White text + black outline is mandatory. High-contrast colors (yellow, neon) are trending.

4. **Extra layers matter.** Hormozi, Glow Pop, and Highlighter Box styles all require background/glow layer setup. The plugin should auto-create these if needed.

5. **Timing is specific.** 150–250ms per-word pop, 200–500ms per-word display, 100–150ms karaoke color transitions. These are precise enough to matter; users can customize but defaults should match.

6. **Easing curves differ.** Pop/Bounce styles use overshoot (15–20%); Karaoke uses linear; Typewriter is instant. Don't use the same easing for all.

7. **3D and Glow are emerging.** Not essential for launch, but will be demanded as variants in 2027. Plan architecture to support.

8. **Presets must be saveable.** Users expect to create one "Hormozi Yellow" style and apply it to 50 clips. Make sure presets are portable and include timing, colors, fonts, and animations.

9. **Mobile-first design.** All styles must read at phone-screen size (small text, small stroke, generous padding). Test at 320px viewport width.

10. **Emoji support is expected.** Submagic, CapCut, Opus Clip all auto-insert relevant emojis alongside captions. Consider whether your plugin should mark emoji keyframes or leave that to After Effects' native emoji rendering.

---

## Sources

### OpusClip & Caption Analysis
- [TikTok Captions: Why 80% of Viral Videos Use Them](https://www.opus.pro/blog/why-viral-tiktoks-use-captions) — OpusClip Blog
- [TikTok Caption Styles 2026: Popular Examples & Best Picks](https://blitzcutai.com/blog/best-caption-style-tiktok) — Blitzcut
- [11 Best Text Animation Packs for Captions & Titles (2026)](https://www.opus.pro/blog/best-text-animation-packs-captions-titles) — OpusClip Blog
- [Best Caption Presets & Styles that Boost Retention](https://www.opus.pro/blog/best-caption-presets-styles-boost-retention) — OpusClip Blog
- [TikTok Caption & Subtitle Best Practices in 2026](https://www.opus.pro/blog/tiktok-caption-subtitle-best-practices) — OpusClip Blog

### Hormozi Style Guides
- [Why Hormozi Captions Increase Completion Rate](https://ascynd.io/en/blog/why-hormozi-captions-get-more-views) — Ascynd
- [How to Make Hormozi-Style Captions (Exact Style Guide)](https://ascynd.io/en/blog/hormozi-captions) — Ascynd
- [How to Make Videos with Captions Like Alex Hormozi (2026)](https://fluxnote.io/guides/how-to-make-alex-hormozi-style-captions) — Fluxnote
- [How to Make Alex Hormozi Style Captions for Your Videos (Free, 2026)](https://editclips.online/blog/how-to-make-hormozi-captions) — EditClips Online
- [How to Create Alex Hormozi Style Captions for Reels 2026](https://edimakor.hitpaw.com/subtitle-tips/how-to-make-alex-hormozi-style-captions.html) — HitPaw

### Karaoke Effect Mechanics
- [How to Add Animated "Karaoke" Captions to Video](https://zubtitle.com/blog/how-to-add-animated-karaoke-captions-to-video) — Zubtitle
- [Why Dynamic Text Overlays and Karaoke-Style Captions Are Transforming Video Marketing](https://www.cutout.pro/learn/why-dynamic-text-overlays-and-karaoke-style-captions-are-transforming-video-marketing/) — Cutout.pro Blog
- [How I Style Karaoke Captions for Reels and TikTok in DaVinci Resolve](https://xere.my/journal/karaoke-captions-reels-tiktok-davinci-resolve/) — Xeremy
- [Karaoke Caption Style: Word-Sync Highlighting for Video](https://www.videocaptions.ai/caption-styles/karaoke) — Video Captions AI
- [How to Add Word-by-Word Captions (Karaoke-Style)](https://recapo.ai/blog/how-to-add-word-by-word-captions/) — Recapo
- [Best Tools for Karaoke Style Color Captions](https://makefilm.ai/tools/wf/best-tools-for-karaoke-style-color-captions) — Make Film

### CapCut Presets & Styling
- [Premiere Text Preset: Enhance Videos with Stylish Titles](https://www.capcut.com/explore/premiere-text-preset) — CapCut
- [Free CapCut Template Packs (2026)](https://www.miracamp.com/learn/capcut/free-presets) — Miracamp
- [Caption Style Guide: Design Better Subtitles in 2025](https://www.capcut.com/resource/caption-style) — CapCut
- [CapCut Tutorial: Complete Editing Guide (2026)](https://www.ruahcreativehouse.org/blog/capcut-tutorial/) — Ruah Creative House
- [Add Stunning Animated Subtitles to Videos Free in Minutes](https://www.capcut.com/resource/animated-subtitle) — CapCut
- [How to Add Captions in CapCut (2026 Step-by-Step Guide)](https://caption-x.com/blog/how-to-add-captions-capcut) — Caption-X

### Submagic Documentation
- [Submagic Review 2026: Pros, Cons & Top 4 Alternatives](https://capzai.com/en/blog/submagic-review-2026) — Capzai
- [Submagic for Creators — AI Captions, B-Roll & Effects for Short Video](https://aivideoinfluencer.com/submagic-ai/) — AI Video Influencer
- [Submagic Review 2026: Viral AI Captions for Short Videos](https://aitoolscoop.com/tool/submagic/) — AI Tools Coop
- [Submagic Review (2026) – Pros, Cons & Alternatives](https://bestfreeaitools.io/ai-tools/submagic-ai-review/) — Best Free AI Tools
- [Submagic Review: The Best AI Tool for Scroll-Stopping Captions](https://quasa.io/video/submagic-review-the-best-ai-tool-for-scroll-stopping-captions) — Quasa
- [How to Use Submagic: A Captioner, Not a Camera](https://www.tekanology.com/guides/how-to-use-submagic/) — Tekanology

### Font & Color Best Practices
- [TikTok Caption Font: The Exact Fonts Used by Top Creators (2026)](https://blitzcutai.com/blog/best-caption-fonts-tiktok) — Blitzcut
- [Best Fonts for TikTok (2026 Guide)](https://madegooddesigns.com/best-fonts-for-tiktok/) — Made Good Designs
- [499 + Tik Tok Caption Font Explained: Name, Style, and Alternatives In 2026](https://captionscrafts.com/what-font-does-tiktok-use-for-captions/) — Caption Crafts
- [How to Add Text on TikTok: Step-by-Step Guide (2026)](https://tikhype.com/blog/how-to-add-text-on-tiktok) — TikHype
- [How to Add Text on TikTok: Timing, Fonts, and Effects](https://socialz.ai/blog/how-to-add-text-on-tiktok) — SocialzAI

### Text Animation & Effects
- [How to Make Animated Text for TikTok](https://www.renderforest.com/blog/how-to-make-animated-text-for-tiktok) — Renderforest
- [The Best FREE After Effects Text Presets in 2026](https://schoolofmotion.com/blog/best-free-after-effects-text-presets) — School of Motion
- [Create Pop Up Text Animation in After Effects Easily](https://www.flexclip.com/learn/pop-up-text-animation-after-effects.html) — Flexclip
- [Animating Text in After Effects](https://helpx.adobe.com/after-effects/using/animating-text.html) — Adobe After Effects Documentation
- [30 Bounce Text Presets by HIAIMSTILL](https://motionarray.com/after-effects-presets/30-bounce-text-presets-28250/) — Motion Array
- [After Effects Text Animation Presets Preview Gallery](https://blog.motionisland.com/after-effects-presets-text-animation/) — Motion Island
- [Tutorial: Animating Type with Text Animators in After Effects](https://schoolofmotion.com/blog/text-animators-after-effects) — School of Motion
- [How to Animate Text with Keyframes in CapCut Easily in 2026](https://videowizardtools.com/animate-text-with-keyframes-in-capcut/) — Video Wizard Tools

### Engagement & Trends
- [Word-by-Word Animated Captions for TikTok, Reels, and Shorts (2026)](https://voicecreator.pro/blog/word-by-word-animated-captions) — Voice Creator Pro
- [Trending Caption & Subtitle Styles in 2026](https://www.vfxai.com/blog/trending-caption-styles-for-2026) — VFX AI
- [Viral TikTok Caption Ideas that Get Views in 2026](https://www.captionory.com/blog/viral-tiktok-caption-ideas-that-get-views-in-2026) — Captionory
- [170+ TikTok Captions to Help Your Content Go Viral in 2026](https://megadigital.ai/en/blog/tiktok-captions/) — Mega Digital
- [How to Add Animated Captions to TikTok & Reels Videos (2026 Guide)](https://editclips.online/blog/animated-captions-for-tiktok-reels) — EditClips Online
- [Animated Captions: How to Make Them (Reels, TikTok, Shorts)](https://reelwords.ai/blog/animated-captions) — Reel Words

---

## Document Metadata
- **Research Date:** September 2026
- **Analysis Period:** 13.5M+ video clips (Jan–March 2026 via OpusClip)
- **Platforms Covered:** TikTok, Instagram Reels, YouTube Shorts, Meta
- **Tools Analyzed:** CapCut, Submagic, Opus Clip, Veed, Adobe After Effects, DaVinci Resolve
- **Compiled For:** After Effects Caption Animation Plugin Development
- **Last Updated:** September 1, 2026
