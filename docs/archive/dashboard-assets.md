# Engram Dashboard — Production Asset Specifications

> **Status:** Ready for design production
> **Last updated:** 2026-03-01
> **Design reference:** `dashboard-design.md`

All assets listed here cannot be produced through code alone. Each entry includes the full description, dimensions, file format, usage context, and style notes needed to brief a designer or generate the asset.

---

## 1. Wordmark / Logo

### 1.1 Primary Wordmark (Horizontal)

**Description:**
The word "engram" set in a geometric, slightly condensed sans-serif. All lowercase. No icon companion in horizontal form — the logotype stands alone. The "e" aperture should be slightly open, giving the mark a feeling of expansion rather than containment (aligning with the concept of memory that grows). There is no border, no badge, no container shape. The type IS the brand.

**Dimensions:** Vector — output at 240×40px reference. Provide SVG + PNG @1x and @2x.

**Format:** SVG (primary), PNG (fallback)

**Variants required:**
- Light (for dark backgrounds): `#f0f0f0` letterforms
- Dark (for light backgrounds): `#111111` letterforms
- Accent (for accent-color contexts): `#c9a96e` letterforms
- Monochrome reverse (pure white): for use on photography or complex backgrounds

**Style notes:**
- Typeface: Geist or similar — clean, modern, slightly technical. If a custom letterform treatment is applied, it should be subtle: perhaps the "g" descender has a slight geometric quality, or the letter spacing is slightly tracked out (+20 to +40 letter-spacing units).
- Absolutely no gradients, shadows, outlines, or decorative elements.
- The mark should feel at home alongside Vercel, Linear, Raycast wordmarks in terms of visual register — considered and minimal.
- Kerning must be manually adjusted, especially the "en" and "gr" pairs.

**Usage:** Sidebar top-left (24px height rendered), about page, favicon source, marketing.

---

### 1.2 Icon Mark (Square)

**Description:**
A compact mark for contexts where the full wordmark doesn't fit (favicon, app icon, notification icon). The concept: a stylized "E" rotated or abstracted to suggest a node in a network, or a memory engram — a trace left behind. One approach: a simple geometric glyph formed from intersecting lines or a minimal node-graph fragment (3 dots connected by 2 lines, arranged in a slight diagonal). Another approach: the letter "e" reduced to its essential skeleton — a single arc and a horizontal bar. The mark must be immediately recognizable at 16×16px.

**Dimensions:** Vector — output at 512×512px. Provide SVG + PNG @1x, @2x, @4x.

**Format:** SVG + PNG + ICO (favicon set: 16, 32, 48, 180, 192, 512px)

**Variants required:**
- Default (on dark bg): light mark on transparent
- Light bg: dark mark on transparent
- App icon (macOS/Windows): mark on `#141414` rounded background, padding 15%

**Style notes:**
- Grid: 48-unit inner grid; 6-unit outer safe zone.
- Stroke weight if stroke-based: 3.5 units on 48-unit grid.
- No color fill — use only the mark's form itself.
- Must read at 16×16 favicon size without becoming a blob.

---

## 2. Dashboard UI Illustrations

### 2.1 Empty State — No Instances Found

**Description:**
A minimal, abstract illustration suggesting a network search that found nothing. Visual: A few faint node-connection lines arranged loosely, converging toward a center point with a softly rendered empty circle at the center. The circle has a subtle dotted-line border suggesting "searching" or "expecting something here." The overall feeling is patient emptiness, not failure.

**Dimensions:** 280×160px (rendered in the empty state container, 2× export: 560×320px)

**Format:** SVG (preferred — can be animated in future) or PNG @2x

**Color guidance:**
- All elements in `--text-tertiary` (#555555) with 60% opacity — extremely faint
- The central circle border uses a dashed stroke: `stroke-dasharray: 4 3`
- No fills, only strokes
- Must look appropriate on `--bg-base` (#0d0d0d) background

**Style notes:**
- Abstract, not literal. Do not draw a computer or a database icon.
- Connection lines should be thin (1px rendered) and irregular — organic, not grid-aligned.
- The composition should have negative space as the dominant element.

---

### 2.2 Empty State — No Decisions Recorded

**Description:**
An abstract representation of an empty record or blank page of memory. Concept: Three horizontal lines suggesting text content — all extremely faint, one partially resolved (more visible than the others) suggesting the beginning of a thought that wasn't completed. Below the lines, a small right-angle bracket symbol (like a code prompt `>`) with a blinking cursor, implying "waiting for input from the agent."

**Dimensions:** 240×140px (@2x: 480×280px)

**Format:** SVG or PNG @2x

**Color guidance:**
- Lines and bracket in `--text-tertiary`, 50% opacity
- The cursor: `--accent` (#c9a96e), 70% opacity — the only warm color in the illustration

**Style notes:**
- Minimal to the point of near-invisibility. The purpose is to fill the empty space without competing with the instructional text below it.

---

### 2.3 Empty State — No Tasks

**Description:**
Three small squares arranged in a loose horizontal spread, each square slightly rotated differently (5°, 0°, -7°), suggesting cards in a Kanban board that haven't been placed yet. The squares are outlined only (no fill), with rounded corners. The arrangement feels un-started, ready-to-be-filled.

**Dimensions:** 200×100px (@2x: 400×200px)

**Format:** SVG or PNG @2x

**Color guidance:** `--text-tertiary` at 50% opacity. Uniform — all elements the same tone.

---

### 2.4 Empty State — No Sessions Yet

**Description:**
A vertical timeline line, thin, terminating at the top in a faint dot. The dot is the only thing on the timeline — representing a single entry point with nothing recorded yet. Below the dot, the line trails off with decreasing opacity until invisible.

**Dimensions:** 80×180px (@2x: 160×360px)

**Format:** SVG or PNG @2x

**Color guidance:** Line gradient from `--text-tertiary` at 40% (top) to 0% opacity (bottom). Dot: `--text-tertiary` at 60%.

---

### 2.5 Conflict Resolution Illustration (Informational)

**Description:**
Used in the conflict resolution panel header when a conflict is first detected — before the user interacts with it. Two opposing arrows pointing at each other, converging toward a central vertical line. The left arrow is slightly heavier (representing Instance A, the "primary"). The right arrow is slightly lighter. The central line has a thin gap at the meeting point — the conflict zone.

**Dimensions:** 360×80px (@2x: 720×160px)

**Format:** SVG

**Color guidance:**
- Left arrow: `--text-primary` at 80% opacity
- Right arrow: `--text-secondary` at 60%
- Gap line indicator: `--status-conflict` (#c05050) at 40% — subtle red hint

---

### 2.6 Welcome / First Launch Illustration

**Description:**
Used on the welcome screen shown to first-time users. An abstract network with 4–5 nodes (dots) connected by lines. One node is slightly larger and brighter — representing the "home" instance. The other nodes are connected but faint, representing not-yet-connected instances. The composition is asymmetric and slightly off-center for visual interest.

**Dimensions:** 400×240px (@2x: 800×480px)

**Format:** SVG (will be subtly animated: nodes gently pulse at slightly different rates using CSS animations once in the React component)

**Color guidance:**
- Connecting lines: `--border-default` (#303030)
- Faint nodes: `--text-tertiary` (#555555)
- Home node: `--accent` (#c9a96e), 90% opacity, with a soft 12px radius glow (`box-shadow: 0 0 12px --accent at 30%`)
- Background: transparent

**Style notes:**
- Lines should not be perfectly straight — apply a slight quadratic curve to each
- Nodes are plain circles, no icons inside
- Outer nodes should be smaller (8px) than home node (14px)

---

## 3. Favicon & App Icons

### 3.1 Favicon Set

Derived from Icon Mark (1.2 above). No new design needed — just exports.

**Required files:**
- `favicon.ico` — 16×16, 32×32, 48×48 embedded
- `favicon-16x16.png`
- `favicon-32x32.png`
- `apple-touch-icon.png` — 180×180px, icon mark on `#141414` background, 27px radius corner
- `android-chrome-192x192.png`
- `android-chrome-512x512.png`
- `og-image.png` — 1200×630px (see Section 4)

---

## 4. Social / Marketing Assets

### 4.1 Open Graph Image (og:image)

**Description:**
The image shown when the dashboard or project is shared on social media / in link previews. Clean, dark background. Left side: the Engram wordmark (large, ~120px height). Right side: a subtle representation of data — perhaps 3 rows of faint horizontal lines in a "table" arrangement. Bottom-left: very small text "Local AI Memory Dashboard" in `--text-secondary` tone.

**Dimensions:** 1200×630px

**Format:** PNG

**Color guidance:**
- Background: `#0d0d0d`
- Wordmark: `#f0f0f0`
- Decorative table lines: `#303030`
- Accent line (1px horizontal separator): `#c9a96e` at 40%

**Style notes:**
- No photography. Pure type and geometric elements.
- A very subtle noise texture (3–5% opacity grain) over the entire image is acceptable for depth.

---

## 5. UI Pattern Assets (not producible in CSS/SVG alone)

### 5.1 Noise Texture Overlay

**Description:**
A tileable noise texture used optionally as a very subtle overlay on surfaces to add tactile depth without introducing color. Think: the texture you see on high-end dark UI work where surfaces feel like matte paper rather than flat filled rectangles.

**Dimensions:** 256×256px tileable

**Format:** PNG (transparent, grayscale noise only)

**Specification:**
- Gaussian noise, fine grain (2–3px particle size average)
- Maximum opacity when used: 3–5% over any surface
- Must tile seamlessly
- Zero color — pure luminance variation

**Usage:** Applied as `::after` pseudo-element on `--bg-surface` and `--bg-overlay` elements in CSS. Optional — only use if it improves perceived quality on high-DPI screens.

---

### 5.2 Connection Line Pattern (Sidebar Footer)

**Description:**
A small, static decorative element for the bottom-left corner of the sidebar, below the Settings nav item. Intentionally obscure — suggests circuitry or neural connections without being literal. 3–4 angular lines meeting at shared vertices, perfectly geometric, like a fragment of a PCB trace or a partial neural diagram. Extremely subtle — this is a whisper of texture, not a graphic element.

**Dimensions:** 52×40px

**Format:** SVG (inline in component)

**Color guidance:** `--border-subtle` (#252525) — almost invisible on dark background

---

## 6. Asset Delivery Format

All assets delivered as:
- SVG: in `packages/engram-dashboard/src/assets/svg/`
- PNG exports: in `packages/engram-dashboard/public/`
- Favicon files: in `packages/engram-dashboard/public/`

Naming convention:
```
logo-horizontal-light.svg
logo-horizontal-dark.svg
logo-horizontal-accent.svg
logo-mark.svg
logo-mark-on-dark.png (512px)
empty-no-instances.svg
empty-no-decisions.svg
empty-no-tasks.svg
empty-no-sessions.svg
conflict-illustration.svg
welcome-illustration.svg
og-image.png
noise-texture.png
sidebar-decoration.svg
favicon.ico
favicon-16x16.png
favicon-32x32.png
apple-touch-icon.png
android-chrome-192x192.png
android-chrome-512x512.png
```
