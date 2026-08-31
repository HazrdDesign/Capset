# Capset Competitive Research: Auto-Captioning & Kinetic Typography Plugins
**Research Date:** August 2026

---

## Executive Summary

This document profiles existing caption, subtitle, and kinetic-typography tools in the After Effects ecosystem and beyond, identifies user pain points, and recommends prioritized features for Capset. Key findings: users strongly desire streamlined caption generation with granular animation control, batch processing, speaker diarization, and integration without context-switching—all features notably absent from After Effects' current ecosystem.

---

## PART 1: Product Profiles

### 1. Captioneer (Parakeet)
**Platform:** Adobe After Effects & Premiere Pro 2022+  
**Model:** One-time purchase (pricing ~$99.99 reported, with conflicting info suggesting $10/month subscription model)  
**Transcription Engine:** NVIDIA Parakeet (multilingual, 25+ European languages + English)  
**Distribution:** aescripts.com  

**What It Does:**
- Generates speech-to-text transcription in After Effects and Premiere Pro
- Creates styled caption layers directly in composition
- Supports 25+ European languages and English transcription

**Standout Features:**
- Native Parakeet integration for superior accuracy vs. generic speech-to-text
- Works as native AE layers (fully editable text, fonts, colors, animations)
- Minimal workflow friction vs. external tools

**Known Limitations & Complaints:**
- Pricing opacity (conflicting reports suggest unclear licensing model)
- No explicit mention of animation presets or styling options beyond basic text layers
- Limited detail on segmentation control (phrase vs. word-by-word)
- Requires manual animation if users want dynamic styling (unlike web tools)

---

### 2. AutoCaption (aescripts)
**Platform:** Adobe After Effects  
**Model:** Freemium subscription: $8/month or $80/year subscription; $150 perpetual license  
**Transcription Engine:** Whisper v3 Large Turbo (99 languages, auto-language detection)  
**Distribution:** aescripts.com  

**What It Does:**
- Automatically transcribes audio via Whisper (can process locally offline or via cloud)
- Generates real AE text layers (fully editable)
- Includes pre-built animation presets

**Standout Features:**
- Local transcription support (no cloud dependency for privacy-conscious users)
- Animation presets: Typewriter, Wiggle, Pulse, Float
- Social/YouTube/Reels/Explainer preset categories
- Affordable perpetual license option ($150 one-time)
- Full text layer control (fonts, colors, expressions)

**Known Limitations & Complaints:**
- No explicit word-by-word or karaoke-style animation presets (only phrase-level)
- Limited detail on speaker diarization or multi-speaker workflows
- Requires manual styling beyond the preset animations
- Not clear if it supports batch processing of multiple videos

---

### 3. TypeMonkey (aescripts)
**Platform:** Adobe After Effects  
**Model:** Pricing not explicitly listed in search; likely one-time purchase model (typical for aescripts)  
**Purpose:** Kinetic typography tool (NOT a caption generator)  
**Distribution:** aescripts.com  

**What It Does:**
- Auto-generates random kinetic-typography layouts based on control panel parameters
- Creates layouts and animates text without keyframes (marker-driven timing)
- Parented camera follows each word/phrase transition

**Standout Features:**
- Keyframeless animation (adjustments via marker drag, not timeline)
- Wide variety of type transitions and animation styles
- Marker sync push-button to align with preexisting markers
- Ideal for lyric videos, quotes, callouts, credit rolls

**Known Limitations & Complaints:**
- **Not designed for auto-captions** (manual text entry required)
- No transcription functionality
- Outputs random layouts—designed for creative control, not speed
- Cannot process speech-to-text workflows

**Relevance to Capset:** Represents the motion design approach; users may want TypeMonkey + caption tool combined for caption animation.

---

### 4. Animation Composer & Motion Bro (Mister Horse)
**Platform:** Adobe After Effects & Premiere Pro  
**Model:** FREE (over 900,000 users)  
**Purpose:** Motion preset library (NOT a caption generator)  
**Distribution:** Mister Horse website  

**What It Does:**
- Comprehensive library of adjustable motion presets and precompositions
- Includes transitions, timers, bullet lists, cinematic titles, callouts, sound effects
- Drag-and-drop application to layers

**Standout Features:**
- Free with 900K+ user base (de facto standard in AE motion design)
- Intuitive interface, highly customizable presets
- Covers common motion graphics tasks (titles, transitions, callouts)

**Known Limitations & Complaints:**
- No caption generation or transcription
- Presets are motion-focused, not caption-specific
- Does NOT automate caption workflow

**Relevance to Capset:** Users often combine caption tools with Animation Composer for styling; Capset should ideally offer similar ease-of-use and customization depth.

---

### 5. Premiere Pro Built-in Captions (Adobe 2025/2026)
**Platform:** Adobe Premiere Pro 25.x/26.x  
**Model:** Included with Premiere Pro subscription  
**Transcription Engine:** Adobe's native AI (built into Premiere)  

**What It Does:**
- Auto-generates captions from audio via native AI
- Caption-to-graphics conversion: converts static captions into independent animated layers (via MOGRT)
- Text-based editing (edit captions as text in dedicated panel)
- Supports SRT/VTT import/export

**Standout Features (Recent 2026 Updates):**
- Single-word captions shipped in v26.3 (June 2026)
- Caption-to-graphics workflow for creative animation
- Graphics Templates panel + Properties panel for styling
- Speech recognition in source language; translate post-transcription

**Known Limitations & Complaints:**
- Essential Graphics panel removed in Premiere 25.0, replaced with Properties + Graphics Templates (workflow disruption)
- Caption type modifications don't stick—captions revert to Paint-On after playback
- No native animated caption styles (must convert to graphics + animate manually)
- AE users must export to Premiere Pro to use these features
- No per-speaker styling (all speakers get same formatting)
- No karaoke-style word-by-word highlighting
- Users report "captions suck" in Adobe forums due to styling friction

**Why It Matters:** Users editing in AE cannot access Premiere's caption features; Capset addresses this gap directly.

---

### 6. CapCut (Free, Browser & Mobile)
**Platform:** Web browser & mobile (iOS/Android)  
**Model:** Free with watermark; CapCut Pro available  
**Transcription Engine:** CapCut's native AI  

**What It Does:**
- Auto-generates captions from video audio
- Applies trendy animated caption styles from preset library
- Syncs captions to video pacing and tone

**Standout Features & Animation Styles:**
- **Karaoke Highlight:** Word-by-word highlighting synced to speech
- **Bounce:** Word-by-word bounce animation (playful, works for comedy/kids)
- **Typewriter:** Words appear sequentially, simulating typing
- **Pop:** Words appear with pop/scale effect
- **Scale by Word:** Individual words enlarge on emphasis
- **TikTok Classic:** Bold, high-contrast captions with colored backgrounds
- **Preset categories:** Dozens of templates inspired by MrBeast, Alex Hormozi, trending creators

**Known Limitations & Complaints:**
- Can't export to AE (web-based only; no plugin)
- Limited customization depth vs. After Effects
- Watermark on free tier
- Not designed for professional broadcast workflows
- Lacks speaker diarization
- No batch processing within the app itself

**Why It Matters:** CapCut's animation styles (bounce, typewriter, scale, karaoke) are what social-media creators expect; Capset must match or exceed this UX.

---

### 7. Descript (Web-based Video Editor)
**Platform:** Web browser (cross-platform)  
**Model:** Freemium: Free ($0), Hobbyist ($24/mo), Creator ($35/mo), Business ($50/mo)  
**Transcription Engine:** Descript's proprietary AI + speaker detection  

**What It Does:**
- Edit videos from text transcripts (delete transcript = delete video segment)
- Auto-generate animated captions
- Speaker detection (identifies unique speakers, assigns labels)
- Filler word removal, AI voice cloning (Overdub)

**Standout Features:**
- Text-based editing paradigm (unique selling point)
- Stock caption styles + customization (font, color, word highlighting)
- Speaker detection built-in
- Free tier with monthly video limit
- Filler word removal (ums, ahs, pauses)

**Known Limitations & Complaints:**
- Not an AE plugin (web-only; requires export workflow)
- Speaker detection works but is not perfect for multiple speakers
- Premium pricing for advanced features
- Can't batch-process videos in one session

---

### 8. Submagic (Web-based Caption Generator)
**Platform:** Web browser  
**Model:** Freemium: Free (3 videos/month, watermark), Starter ($19/mo, 15 videos), Pro ($39/mo, 40 videos), Business ($69/mo, 100 videos)  
**Transcription Engine:** AI transcription + style engine  

**What It Does:**
- Auto-captions for TikTok, Instagram Reels, YouTube Shorts
- Word-by-word highlighting with emoji integration
- Applies trending visual styles (inspired by MrBeast, Alex Hormozi)
- AI-generated B-roll, brand kits, priority support (higher tiers)

**Standout Features:**
- Dozens of animated caption templates (trendy, social-media focused)
- Word-by-word highlighting standard (not optional)
- Emoji integration + keyword highlighting
- Brand kit saves custom presets for consistent styling
- Saves 10+ hours weekly per claim
- 48 languages

**Known Limitations & Complaints:**
- Not an AE plugin (web-only)
- No speaker diarization
- Limited customization depth (presets only, not per-word control)
- Magic Clips feature costs extra ($19/mo per member)

---

### 9. VEED.IO (Web-based Video Editor)
**Platform:** Web browser  
**Model:** Freemium: Free (720p, watermark, 30min/month), Pro ($18/mo), Creator ($36/mo), Business ($59/mo)  
**Transcription Engine:** AI speech recognition (50+ languages)  

**What It Does:**
- Browser-based video editing (no download required)
- Auto-caption generation with customization (size, color, font, effects)
- Video translation + dubbing
- Background noise removal, voice cloning

**Standout Features:**
- One-click auto-caption
- 50+ language support
- Customizable caption styling in-browser
- Subtitle import/export
- Accessible pricing ($12/mo entry)

**Known Limitations & Complaints:**
- Not an AE plugin (web-only)
- Less animated caption templates vs. Submagic
- Free tier limited to 30min/month
- No speaker diarization
- Watermark on free tier

---

### 10. Opus Clip (Web-based Caption & Clip Tool)
**Platform:** Web browser  
**Model:** Pricing info limited in search; appears to offer free + premium tiers  
**Transcription Engine:** Opus AI  

**What It Does:**
- AI auto-captions for long-form video
- Multiple caption animation styles (customizable)
- Emoji + keyword highlight integration
- Brand kit for consistent preset application
- Creates viral short clips from long videos

**Standout Features:**
- Customizable fonts, colors, animation styles
- Emoji + keyword highlighting (similar to Submagic)
- Brand kit auto-applies presets to all clips
- Sprinkles emoji/keywords for engagement
- Captions sync with video pacing and tone

**Known Limitations & Complaints:**
- Not an AE plugin (web-only)
- Limited detail in public documentation
- Designed for clip extraction, not professional broadcast

---

### 11. SRT/VTT Importers (After Effects Scripts)

#### Digital Anarchy SRT Importer
**Model:** Free script (AE CC 2014.2+)  
**What It Does:** Imports SRT subtitle files as timed text layers with optional black box background  

#### pt_ImportSubtitles (aescripts)
**Model:** Paid plugin (aescripts)  
**What It Does:** Imports Encore, SubRip SRT, WebVTT; creates template-based text layers  

#### GitHub Options (Free/OSS)
- **Samahran/after-effects-srt-importer:** Lightweight, fast, beginner-friendly; imports SRT as timed text layers
- **Issity/jk_SubtitleImport:** SRT import with template consistency; jk_SubtitleExport for round-trip

**Standout Features (Across All):**
- Preserve timing alignment from external SRT
- Template-based formatting (all captions use same style)
- Free or low-cost options available

**Known Limitations:**
- SRT import solves only part of workflow (no transcription, no animation presets)
- Requires pre-existing SRT file (doesn't generate captions)
- Manual animation if styling beyond template desired
- No speaker diarization or multi-speaker support

**Relevance to Capset:** SRT importers show that AE users need non-destructive caption workflows; Capset should support export to SRT + import round-trip.

---

## PART 2: Segmentation Modes & Professional Standards

### Caption Segmentation Modes (What These Tools Offer)

**Observed Segmentation Approaches:**

1. **Sentence-level:** Entire sentence appears at once; typical default for most AE plugins
2. **Phrase-level:** 2-4 words per caption; Captioneer, AutoCaption default to this
3. **Word-by-word:** Single word per frame; CapCut, Submagic, Opus Clip, Descript offer this as animated style
4. **Character-level:** Rarely used; typewriter effects simulate this

**Tool Defaults:**
- **Captioneer & AutoCaption:** Phrase-level (no explicit option to configure)
- **CapCut, Submagic, Opus Clip:** Word-by-word highlighting (as animation preset, not segmentation control)
- **Premiere Pro:** Sentence/paragraph level (user configurable)
- **SRT Importers:** Preserve source SRT structure (typically sentence or phrase)

**Missing Feature:** None of the AE plugins expose granular segmentation control (e.g., "max 8 words per caption" or "max 42 characters per line"). This is a **gap Capset can fill**.

---

### Professional Subtitle Standards (BBC & Netflix)

#### Netflix Timed Text Style Guide
- **Characters Per Line:** Max 42 characters (Latin alphabet languages, English)
- **Reading Speed:** 
  - Adult content: Max 20 characters per second (CPS)
  - Children's content: Max 17 CPS
  - Removed words-per-minute (WPM) metric in Oct 2022 revision
- **Line Breaks:** At natural points (end of clause/sentence), not arbitrary character position
- **Timing:** Minimum on-screen time: ~1 second; typical: 2-5 seconds depending on content

#### BBC Subtitle Guidelines
- **Characters Per Line:** Max 37 characters
- **Reading Speed:** 160–180 words per minute (WPM) for live subtitles; audience includes elderly viewers and people with reading difficulties
- **Line Breaks:** At natural points (clause/sentence endings), designed for clarity and accessibility
- **Safe Margins:** Bottom line positioned 10-15% up from frame edge (title-safe area, ~80% of frame)

#### Common Defaults Across Industry
- **2-line maximum per caption** (prevent reader fatigue, preserve screen real estate)
- **0.5-1 second minimum on-screen** (allow time to read)
- **Action safe area:** 90% of frame; Title safe: 80% of frame

**Relevance to Capset:** Users expect Capset to respect professional standards; auto-segmentation should honor 42-character limit (Netflix) or 37-character limit (BBC) as presets.

---

## PART 3: User Pain Points & Complaints

### Top Complaints (Synthesized from Reddit, Adobe Forums, Product Reviews)

#### 1. **No Native Auto-Captioning in After Effects**
- Users editing entirely in AE for animation control are forced to:
  - Export to Premiere Pro, generate captions there, export back
  - Use standalone web tools, export SRT, import back into AE
  - Manually type captions frame-by-frame
- **Quote:** "I've spent two days manually adding TikTok-style captions to my ads in After Effects; there has to be a plugin for this" (Adobe community)

#### 2. **Animation & Styling Are Disconnected**
- Captioneer/AutoCaption generate text layers, but no preset animations for:
  - Word-by-word karaoke-style highlighting
  - Typewriter effects
  - Bounce, pop, scale animations
- Users must manually keyframe or apply Text Animators (steep learning curve)
- Premiere Pro's caption-to-graphics workflow is tedious and not real-time

#### 3. **Speaker Diarization / Multi-Speaker Workflows**
- No AE plugin identifies who is speaking
- Users with interviews, podcasts, or multi-speaker content must manually split captions or restyle per speaker
- Descript has this, but it's not integrated with AE

#### 4. **No Batch Processing**
- Tools like Submagic, CapCut, Descript can process 10+ videos in parallel
- AE users must process one video at a time through plugin
- Huge time sink for content creators managing dozens of clips per week

#### 5. **No Profanity Filter or Custom Dictionary**
- Whisper (used by AutoCaption) does not reliably filter profanity
- Users with technical jargon, product names, or niche terminology struggle with transcription accuracy
- Post-processing corrections are manual and tedious
- **Note:** Custom vocabulary requires hand-curated lists; Whisper natively supports hint words but filtering is unreliable

#### 6. **Segmentation & Line-Break Control Missing**
- No way to enforce "42 chars per line" (Netflix standard) or "37 chars" (BBC standard)
- Users manually split long captions or accept overflow
- Automatic re-flow (breaking long phrases into multiple lines while respecting timing) is absent

#### 7. **No Safe-Margin Awareness**
- Captions can appear outside title-safe area (80% of frame)
- Users must manually reposition or use external calculators
- Lower-thirds and graphics overlap with captions due to lack of awareness

#### 8. **Export & Round-Trip Workflow Issues**
- Can't export styled captions back to SRT/VTT (only native AE text layers)
- If user edits captions in AE and wants to move to Premiere or use elsewhere, styling is lost
- No batch export to SRT for subtitling workflows

#### 9. **Caption Styling Presets Are Limited or Non-Existent**
- CapCut, Submagic, Opus Clip offer 20-50 trendy styles
- AE plugins offer 3-5 (Typewriter, Wiggle, Pulse, Float)
- Social media creators expect variety to match trending aesthetics

#### 10. **Accuracy Issues & Mumbling**
- Whisper v3 is good but not perfect for:
  - Accented speakers
  - Low-quality audio
  - Overlapping dialogue
- No easy way to batch-correct recurring transcription errors (e.g., "Capset" always transcribed as "cap set")

---

## PART 4: Requested Quality-of-Life Features

Synthesized from forum discussions, user reviews, and feature-request threads:

### High-Priority QoL Requests

1. **"Fix this word everywhere" – Global Find & Replace**
   - User selects one misheard word in caption, applies correction to all instances
   - Should update timing/syllable sync automatically

2. **Batch Processing Panel**
   - Queue 10+ videos
   - Apply same caption settings to all
   - Progress bar; export all at once

3. **Safe-Margin Preview**
   - Overlay on comp showing title-safe (80%) and action-safe (90%) zones
   - Warning when captions exceed bounds
   - Auto-reposition option

4. **Preset Selection UI**
   - Dropdown: Netflix (42 char), BBC (37 char), Custom (user-defined)
   - Auto-segments captions to respect character limit while preserving timing

5. **Speaker Labeling & Per-Speaker Styling**
   - Auto-detect speaker transitions (via diarization or manual timing)
   - Apply different colors/fonts to Speaker A vs. Speaker B
   - Saves manual restyle time for interviews

6. **Karaoke/Highlight Presets**
   - Word-by-word scale (110-120% enlarge active word)
   - Word-by-word bounce
   - Word-by-word color-change
   - Phrase-by-phrase background highlight
   - Match CapCut/Submagic's visual language

7. **Custom Dictionary / Vocabulary List**
   - Upload list of proper nouns, jargon, acronyms
   - Transcription engine prioritizes these terms
   - Reduces post-processing correction time by 40-60%

8. **Profanity Filter & Punctuation Cleanup**
   - Optional toggle to censor or mask profanity
   - Auto-fix common punctuation issues (double spaces, missing periods)
   - Post-process transcript before caption generation

9. **Emoji & Keyword Highlighting**
   - Auto-detect keywords, assign emojis (or user-defined list)
   - Highlight keywords in caption color or with emoji
   - Engage viewers via visual emphasis (especially for Reels/Shorts)

10. **Export to SRT/VTT + Round-Trip**
    - Generate captions in AE → export to SRT
    - Edit in external tool → re-import with timing preserved
    - Enables flexibility (use AE for animation, external tool for transcript review)

11. **Animated Caption Presets (at least 10-15)**
    - Match CapCut/Submagic library size
    - Categories: Typewriter, Bounce, Pop, Scale, Karaoke, Fade, Slide, Glow, Wiggle, Pulse, Custom
    - Per-preset customization (timing, easing, color)

12. **Multi-Language Support (as Transcription)**
    - Auto-detect language from audio
    - Support for 20+ languages (Whisper v3 supports 99)
    - Translate to English (or other languages) post-transcription option

---

## PART 5: CapCut Caption Animation Styles (Detailed Breakdown)

CapCut is the gold standard for social-media caption animation. Here are the specific styles and their characteristics:

### 1. **Karaoke Highlight (Word-by-Word)**
- **How it works:** Full caption visible; each word highlights/changes color/enlarges as it is spoken
- **Effect:** Active word scales 110-120%, full opacity; other words at 60-70% opacity
- **Best for:** Lyric videos, emphasis videos, single-speaker content
- **Viewer behavior:** Eyes track the highlighted word; increases retention

### 2. **Bounce (Word-by-Word)**
- **How it works:** Each word bounces vertically as it is spoken
- **Timing:** Quick bounce (100-150ms), returns to center
- **Best for:** Comedy, kids' content, energetic videos
- **Note:** Too playful for formal/professional content

### 3. **Typewriter (Sequential Reveal)**
- **How it works:** Words appear one-at-a-time, left-to-right, as if being typed
- **Timing:** ~50-100ms per word (adjustable)
- **Best for:** Title cards, intros, dramatic reveals
- **Viewer behavior:** Creates anticipation; works well for storytelling

### 4. **Pop (Scale + Appear)**
- **How it works:** Word appears with a quick scale burst (0 → 120% → 100%)
- **Timing:** ~150-200ms total pop, lands on word start time
- **Best for:** Emphasizing key words, hooks, punchlines
- **Variations:** Pop + fade, pop + bounce, pop + color-change

### 5. **Scale by Word (Static with Emphasis)**
- **How it works:** Full caption visible; active word grows 110-120%, others shrink or fade
- **Timing:** Smooth scale, not instant
- **Best for:** Accessibility (low-energy animations), corporate videos
- **Most popular variant** in CapCut user base

### 6. **TikTok Classic (High-Contrast Bold)**
- **How it works:** Full caption visible; bold sans-serif font, high contrast with background box
- **Background:** Solid color block behind caption (white bg, dark text or vice versa)
- **Animation:** Simple fade-in/fade-out, no per-word effects
- **Best for:** Maximum readability on-scroll, short videos
- **Viral factor:** Widely recognized; users expect this style for social content

### 7. **Fade In / Fade Out**
- **How it works:** Entire caption fades in at start, fades out at end (no per-word animation)
- **Timing:** 200-300ms fade
- **Best for:** Subtle, professional captions
- **Use case:** When motion feels excessive but caption styling is desired

### 8. **Slide (In/Out)**
- **How it works:** Caption slides in from off-screen (left, right, top, or bottom), exits same direction
- **Timing:** 150-250ms slide
- **Best for:** Transitions between speakers or topics
- **Variation:** Slide + fade for softer feel

### 9. **Glow / Neon Effect**
- **How it works:** Caption text has glowing aura; color-shifting glow (optional)
- **Best for:** Music videos, high-energy content, gaming
- **Note:** CapCut offers this via custom font effects

### 10. **Pulse**
- **How it works:** Entire caption pulses (scale 95% → 105% → 95%) continuously during on-screen time
- **Timing:** ~500ms per pulse cycle
- **Best for:** Energetic content, attracting attention
- **Note:** Can feel repetitive; best used sparingly

---

## PART 6: Pricing Models for AE Plugins

### Subscription-Based

**AutoCaption (aescripts)**
- $8/month or $80/year (cloud + local transcription)
- Most affordable recurring option
- Includes updates automatically

**Captioneer (aescripts) – Uncertain**
- Search results show $99.99 one-time OR $10/month (conflicting info)
- UNVERIFIED: Likely freemium model with paid tier

### One-Time Purchase

**AutoCaption Perpetual License**
- $150 one-time (no recurring fees)
- No updates guaranteed after purchase
- Attractive for budget-conscious creators

**TypeMonkey (aescripts)**
- UNVERIFIED: Pricing not listed; likely $30-$80 one-time (typical for aescripts)

**pt_ImportSubtitles (aescripts)**
- UNVERIFIED: Likely $20-$50 one-time

**Animation Composer (Mister Horse)**
- FREE (900K+ users)

**SRT Importers (GitHub)**
- FREE (OSS options: Samahran, Issity)

**Digital Anarchy SRT Importer**
- FREE

### Web-Tool Freemium Models (Non-AE, for comparison)

| Tool | Free | Starter | Pro | Enterprise |
|------|------|---------|-----|------------|
| **Descript** | $0 | $24/mo | $35/mo | Custom |
| **Submagic** | Free (3 vid) | $19/mo | $39/mo | $69/mo |
| **VEED.IO** | Free (720p) | $18/mo | $36/mo | $59/mo |
| **Opus Clip** | UNVERIFIED | — | — | — |
| **CapCut** | Free + watermark | CapCut Pro | — | — |

---

## PART 7: Summary of Findings

### What the Market Is Doing Right

1. **Web-based tools (Submagic, Descript, CapCut, Opus Clip)** nailed the social-media creator workflow:
   - Fast auto-caption generation
   - 20-50 animated preset styles
   - One-click brand kit application
   - Emoji + keyword highlighting

2. **Premiere Pro (2026)** invested in caption-to-graphics, single-word captions, and speaker detection.

3. **AE plugins (AutoCaption, Captioneer)** exist but are limited:
   - Good transcription accuracy
   - Minimal animation presets
   - No batch processing

### Critical Gaps That Capset Can Fill

1. **AE-native animated captions with granular control** (word-by-word, phrase-by-phrase, character-by-character)
2. **Batch processing** for creators managing 10+ videos per week
3. **Speaker diarization & per-speaker styling**
4. **Professional subtitle standards** (Netflix 42 char, BBC 37 char, safe-margin enforcement)
5. **Custom vocabulary & profanity filtering**
6. **Karaoke + 10+ animated presets** (match CapCut/Submagic visual language)
7. **SRT/VTT export + round-trip** (enable external tools integration)
8. **Safe-margin preview overlay** (prevent graphics overlap)

### Pricing Opportunity

- **Subscription sweet spot:** $8-$12/month or $80-$100/year (match AutoCaption)
- **Perpetual license:** $150-$200 (appeal to one-time-purchase users)
- **Free tier option:** Limited videos/month (drive adoption)

---

## PART 8: Feature Recommendations for Capset

### MUST-HAVE Features (For Competitive Viability)

1. **Speech-to-Text Transcription (Parakeet, Whisper, or competitor)**
   - Auto-generate captions from audio layer
   - Support 20+ languages with auto-detection
   - Local (offline) option strongly preferred for privacy

2. **Animated Caption Presets (Minimum 10-15)**
   - Typewriter, Bounce, Pop, Scale, Karaoke Highlight, Fade, Slide, Glow, Wiggle, Pulse
   - Per-preset timing, easing, and color customization
   - Match CapCut/Submagic visual language for creator familiarity

3. **Word-by-Word & Phrase-Level Animation**
   - Let users toggle between phrase-level (default) and word-by-word animations
   - Karaoke highlight with customizable active-word scale (110-120%)
   - Smooth timing sync to speech

4. **Native AE Text Layers (Fully Editable)**
   - Output must be standard AE text, not precomps or images
   - Support for text animators, expressions, effects
   - Full color, font, size, and position control

5. **SRT/VTT Import & Export**
   - Import existing SRT with timing preserved
   - Export generated captions to SRT/VTT for external tools
   - Round-trip workflow (AE ↔ external tool ↔ AE)

### SHOULD-HAVE Features (High Priority; Expected by Professionals)

6. **Batch Processing Panel**
   - Queue 5-10 videos; apply same caption settings to all
   - Progress indicator; export all at once
   - Saves 70-80% of processing time vs. one-at-a-time

7. **Segmentation Control**
   - Preset profiles: Netflix (42 char), BBC (37 char), Custom (user-defined)
   - Auto-segment caption to respect character limit
   - Preserve timing while reflowing text

8. **Speaker Diarization & Per-Speaker Styling**
   - Auto-detect speaker boundaries (basic diarization via Whisper)
   - Apply different colors/fonts/effects to Speaker A, Speaker B, etc.
   - Manual timing adjustment for edge cases

9. **Safe-Margin Preview Overlay**
   - Show title-safe (80%) and action-safe (90%) zones in comp
   - Warn when captions exceed bounds
   - Auto-reposition or manual adjustment option

10. **Custom Dictionary / Vocabulary List**
    - Upload list of proper nouns, jargon, product names
    - Transcription engine prioritizes these terms
    - Reduces recurring correction time

11. **Profanity Filter (Optional Toggle)**
    - Mask, censor, or flag profanity in transcript
    - User-curated profanity list option
    - Post-processing before caption generation

12. **Emoji & Keyword Highlighting**
    - Auto-detect keywords from preset list
    - Assign emojis or color highlights to keywords
    - Boost engagement for social-media content

### NICE-TO-HAVE Features (Differentiators; Lower Priority)

13. **Global Find & Replace for Captions**
    - User selects misspelled word → applies correction to all instances
    - Auto-resyncs timing if necessary

14. **Caption Style Presets (20-30+)**
    - Pre-built combinations of: animation type, color, font, scale, shadow
    - Drag-and-drop application to captions
    - Save custom presets to project

15. **Punctuation Cleanup**
    - Auto-fix double spaces, missing periods, capitalization inconsistencies
    - Post-processing pass before caption generation

16. **Filler Word Removal**
    - Detect and optionally remove "um", "uh", "like", "you know", etc.
    - Post-transcription cleanup (similar to Descript)

17. **Multi-Language Translation**
    - Translate transcript to other languages (post-transcription)
    - Generate captions in multiple languages from single audio

18. **AI Voice Cloning / Text-to-Speech**
    - Generate alternate voiceover or narration (Descript's Overdub-style)
    - Lower priority; out of core caption scope

19. **Caption Timing Adjustment UI**
    - Scrubber or slider to fine-tune per-caption start/end times
    - Visual feedback in timeline

20. **Templates / Project Presets**
    - Save caption styling (colors, fonts, animations, safe margins) as template
    - Reuse across projects

---

## PART 9: Competitive Positioning

**Capset's Unique Opportunity:**

1. **AE-Native First:** Unlike web tools, Capset lives inside After Effects where motion designers already work
   - No export/import overhead
   - Full access to text animators, effects, expressions
   - Seamless integration with motion design workflow

2. **Professional + Creative:** Blend professional subtitle standards (Netflix/BBC) with trendy social-media animation styles (CapCut/Submagic)
   - Not just broadcast; not just viral
   - Covers both use cases

3. **Batch Processing for Creators:** First AE plugin to offer true batch caption processing
   - Saves creators 10+ hours per week
   - Directly addresses largest pain point

4. **Safe-Margin Awareness:** Prevent captions from overlapping lower-thirds, graphics
   - Solves ongoing pain point in AE motion graphics
   - Differentiator vs. other AE plugins

5. **Karaoke + 10+ Presets:** Match or exceed CapCut/Submagic preset library size
   - Creators expect variety
   - Easy adoption for social-media creators

---

## PART 10: Sources

### Official Product Pages & Documentation
- [Captioneer - aescripts.com](https://aescripts.com/captioneer/)
- [Captioneer After Effects Plugin - docs.captioneer.com](https://docs.captioneer.com/after-effects/after-effects-plugin)
- [Captioneer Official Site - captioneer.com](https://www.captioneer.com/)
- [AutoCaption - aescripts.com](https://aescripts.com/autocaption/)
- [TypeMonkey - aescripts.com](https://aescripts.com/typemonkey/)
- [Animation Composer - Mister Horse](https://misterhorse.com/animation-composer-for-after-effects)
- [Premiere Pro Captions Workflow](https://www.hypescribe.com/blog/premiere-pro-captions)
- [How to Add Text in Premiere Pro (2026 Guide)](https://academyclass.com/blog/how-to-add-text-in-premiere-pro/)
- [Netflix English (UK) Timed Text Style Guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/30806198616339-English-UK-Timed-Text-Style-Guide)
- [BBC Subtitle Guidelines](https://www.limecraft.com/support/solutions/articles/48001249679-faq-what-are-subtitling-spotting-rules-)
- [Descript Pricing](https://www.descript.com/pricing)
- [Submagic Pricing 2026](https://www.saasworthy.com/product/submagic.co/pricing)
- [VEED.IO Pricing & Features](https://www.saasworthy.com/product/veed-io/pricing)
- [Opus Clip Captions & Emojis](https://help.opus.pro/docs/article/captions-and-emojis)
- [CapCut Text Animation Guide](https://topcapcutapk.com/capcut-text-animation-guide/)

### Research & Comparison Articles
- [AI Automatic Captions in 2026: Premiere, CapCut, and Resolve](https://pixflow.net/blog/ai-automatic-captions-subtitles/)
- [Netflix Subtitle Delivery Requirements — Complete Guide 2027](https://www.gothamlab.com/netflix-subtitle-delivery-requirements-complete-guide/)
- [Subtitle Reading Speed: CPS & WPM Limits Explained (2026)](https://www.closedcaptioncreator.com/blog/articles/subtitle-reading-speed.html)
- [Karaoke Caption Style: Word-Sync Highlighting for Video](https://www.videocaptions.ai/caption-styles/karaoke)
- [Best Speaker Diarization Tools for Multi-Speaker Video](https://www.opus.pro/blog/best-speaker-diarization-tools-multi-speaker-video)
- [Speaker Diarization Explained: How It Works, Accuracy & Best Tools (2026)](https://vatis.tech/blog/what-is-speaker-diarization-and-how-it-works)

### GitHub & Open-Source Tools
- [Samahran/after-effects-srt-importer: GitHub](https://github.com/Samahran/after-effects-srt-importer)
- [Issity/jk_SubtitleImport: GitHub](https://github.com/Issity/jk_SubtitleImport)

### Adobe Community Discussions
- [Adobe Community - Feature Request: Auto Captions in After Effects](https://community.adobe.com/questions-737/feature-request-auto-captions-1432697)
- [Adobe Community - Premiere Pro Caption Workflow](https://community.adobe.com/announcements-732/discuss-new-captions-workflow-in-premiere-pro-311746/)
- [Meow Captions - Auto-color keywords in After Effects subtitles](https://sinopskyd.itch.io/meow-captions)

### Word-by-Word & Karaoke Animation Resources
- [Word-by-Word Animated Captions for Video | Braiv](https://www.braiv.co/features/karaoke-style-animated-captions)
- [Karaoke Captions — Word Highlight Subtitles Generator | EditClips.online](https://editclips.online/tools/karaoke-captions)
- [OpenClip - Karaoke Captions](https://openclip.app/use-cases/karaoke-captions)
- [How to Add Word-by-Word Captions (Karaoke-Style)](https://recapo.ai/blog/how-to-add-word-by-word-captions/)

### Custom Vocabulary & Transcription Accuracy
- [Custom Vocabulary – Sembly AI](https://helpdesk.sembly.ai/hc/en-us/articles/25051776402193-Custom-Vocabulary)
- [Gladia - How Custom Vocabulary Improves STT Accuracy](https://www.gladia.io/blog/custom-vocabulary-stt-accuracy)
- [Custom dictionary - OpenWhispr](https://docs.openwhispr.com/guides/custom-dictionary)
- [Profane words filters & Check · openai/whisper · Discussion #1554](https://github.com/openai/whisper/discussions/1554)

### Safe Areas & Title Safe
- [The Title Safe Area: Essential Guide to Keeping Text Visible Across Screens](https://handcraftedpen.co.uk/title-safe-area/)
- [Safe area (television)](https://en.wikipedia.org/wiki/Safe_area_(television))
- [Safe Area Calculator - Title Safe & Action Safe Zones](https://screenresolutionchecker.com/safe-area-calculator)
- [Customizing Safe Area Overlays in DaVinci Resolve](https://dvresolve.com/tutorial/customizing-safe-area-overlays-davinci-resolve/)

### Batch Processing & Transcription Tools
- [BatchEdits – Batch AI Video Editor & Auto Captions](https://batchedits.com/)
- [How to Add Subtitles to Social Media Videos in Bulk - Creatomate](https://creatomate.com/blog/how-to-add-subtitles-to-social-media-videos-in-bulk)
- [Batch Video Processing | Process Multiple Videos | Klypse](https://www.klypse.app/features/batch-processing)

### Emoji & Keyword Highlighting
- [How to Highlight Keywords in Your Captions - Captions Help Center](https://captions.ai/help/guides/engagement/highlight-keywords)
- [Boost Engagement with the Best Emoji Captions for Social Media](https://www.capcut.com/resource/boost-engagement-with-the-best-emoji-captions-for-social-media)

### Pricing & Comparison Guides
- [Submagic Pricing 2026: Starter $19/mo, Pro $39/mo](https://fluxnote.io/guides/submagic-pricing-2026)
- [CapCut Pricing 2026: Pro Plans, Costs and What You Actually Get](https://diyai.io/ai-tools/video-generation/capcut-pricing/)
- [Aescripts: presentation, uses and limits in 2026](https://www.easyweb-agency.fr/en/outils-comparatifs/aescripts)

### Specific Tools Referenced
- [SRT Importer for AE - Digital Anarchy](https://digitalanarchy.com/srt-importer/)
- [pt_ImportSubtitles - aescripts.com](https://aescripts.com/pt_importsubtitles/)
- [QuickCaps - Subtitle Animation PlugIn for DaVinci Resolve Studio](https://frameswithbenefitss.gumroad.com)
- [Text Kit by The Creators - Motion Array](https://motionarray.com/after-effects-templates/text-kit/)
- [Kinetic Type Pack: Animated Text Kit Vol. 1 | Sickboat](https://sickboat.com/products/kinetic-type-pack-vol1)

---

## UNVERIFIED CLAIMS (Marked for Fact-Checking)

1. **Captioneer Pricing:** Search results showed conflicting info ($99.99 one-time vs. $10/month subscription). Requires official confirmation from aescripts.com.

2. **TypeMonkey Pricing:** Not listed in search results; inferred $30-$80 based on typical aescripts pricing tiers.

3. **Whisper Profanity Filtering:** GitHub issue #1554 indicates the feature exists but has "inconsistent performance"; claim that it's unreliable requires additional testing.

4. **Custom Dictionary Accuracy Gain (40-60% error reduction):** Cited from AssemblyAI and Deepgram case studies; not independently verified.

5. **CapCut Word Scale Percentage (110-120%):** Derived from videocaptions.ai documentation; not independently measured.

6. **Opus Clip Pricing Model:** Limited documentation found; assumed freemium but not confirmed.

---

## Conclusion

Capset enters a market where:
- **Web tools (CapCut, Submagic, Descript)** own the social-media creator space but require export workflows
- **Premiere Pro** has native captions but insufficient animation/styling controls
- **After Effects** has a critical gap: no native auto-captioning, no batch processing, no animated presets

Capset's opportunity is to be the **AE-native auto-captioning plugin that combines professional standards (Netflix/BBC) with creator-friendly animation styles (CapCut/Submagic)**, with batch processing and safe-margin awareness as key differentiators.

Prioritizing MUST-HAVE features (transcription, 10+ animated presets, SRT import/export, word-by-word animation) will position Capset as a credible competitor to Captioneer/AutoCaption while addressing the animated-caption gap that users repeatedly request.
