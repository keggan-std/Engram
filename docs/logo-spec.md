# Engram — Logo Design Specification

**Document type:** Designer brief  
**Project:** `engram-mcp-server` — Persistent Memory Cortex for AI Coding Agents  
**Version:** 1.0  
**Date:** February 2026

---

## 1. Background & Context

**Engram** is a developer tool — a local MCP server that gives AI coding agents
persistent memory across sessions. The name comes directly from neuroscience:
an _engram_ is the hypothetical physical or biochemical substrate of a memory
trace in neural tissue — the actual mark a memory leaves on the brain.

The tool's tagline is:

> _"Persistent Memory Cortex for AI coding agents."_

The primary audience is **software developers** who use AI coding assistants
(Claude, Copilot, Cursor, Windsurf, etc.). They are technical, design-literate,
and expect tools to look sharp and professional — not playful or corporate.

The logo must communicate:

- **Memory** — permanence, persistence, something that doesn't forget
- **Intelligence** — neural, precise, structured
- **Reliability** — trustworthy, engineered, not fragile
- **Developer-native** — clean geometry, not a consumer app aesthetic

The logo will appear primarily in dark contexts (GitHub README dark mode,
terminal output, npm badge overlays) but must also work on light backgrounds.

---

## 2. Name & Wordmark

- **Primary name:** Engram
- **Capitalization:** Title case — `Engram` (not `ENGRAM`, not `engram`)
- **Package name** (secondary, technical context only): `engram-mcp-server`

The wordmark should be set in a **geometric sans-serif** typeface. Candidates:

| Typeface          | Style             | Notes                                     |
| ----------------- | ----------------- | ----------------------------------------- |
| **Inter**         | Regular or Medium | Preferred — free, ubiquitous in dev tools |
| **IBM Plex Sans** | Regular           | Technical, authoritative                  |
| **Geist**         | Regular           | Modern, clean, used by Vercel             |
| **Space Grotesk** | Regular           | Good technical character                  |

Avoid: rounded bubble fonts, slab serifs, handwritten/script, pure monospace
for logotype use.

---

## 3. Color Palette

### Primary Brand Colors

| Name              | Hex       | RGB         | Use                                                     |
| ----------------- | --------- | ----------- | ------------------------------------------------------- |
| **Memory Amber**  | `#D97706` | 217, 119, 6 | Primary accent — icon glow, active nodes, highlights    |
| **Neural Blue**   | `#007ACC` | 0, 122, 204 | Secondary accent — connections, flows, VS Code affinity |
| **Synapse Green** | `#22C55E` | 34, 197, 94 | Positive state, "connected", "active"                   |

### Background Colors

| Name           | Hex       | Use                                                   |
| -------------- | --------- | ----------------------------------------------------- |
| **Deep Slate** | `#0D1117` | GitHub dark background — primary dark canvas          |
| **Ink**        | `#1A1F2C` | Slightly warmer dark — for cards and icon backgrounds |
| **Chalk**      | `#F8FAFC` | Light mode background                                 |

### Neutral / Text Colors

| Name          | Hex       | Use                            |
| ------------- | --------- | ------------------------------ |
| **Off White** | `#E2E8F0` | Primary text on dark           |
| **Muted**     | `#64748B` | Secondary text, subtitles      |
| **Border**    | `#2D3748` | Dividers, icon stroke outlines |

### Color Usage Note

The amber (`#D97706`) is the signature color and the one most associated with
the brand. It should anchor the primary icon variant. Blue and green serve as
supporting colors in multi-color applications or to communicate state.

---

## 4. Icon Concepts

Three concepts are presented below, ordered by designer recommendation. The
**Primary Concept (A)** should be executed first; the others are alternatives.

---

### Concept A — The Persistent Node _(Recommended)_

**The idea:** A single neural node — clean, geometric, luminous — with a
self-referential connection that loops back into itself. This communicates
_memory that persists_ and _continuity across time_.

**Visual description:**

1. **Core shape:** A circle (~40% of the total icon width) centered in the
   canvas. This is the "memory node." Its fill color is Memory Amber
   (`#D97706`). On dark backgrounds it may have a soft outer glow (10–15%
   opacity amber, spread ~6px) to suggest neural luminance.

2. **Loop arc:** A single smooth arc exits the top-right of the circle,
   curves outward (like a signal being emitted), then gracefully curves back in
   and reconnects to the bottom-right of the same circle. The arc is a rounded
   stroke, 3–4px weight, same amber color or slightly lighter (`#F59E0B`). This
   loop is the _persistence metaphor_ — signal leaves and returns; memory
   doesn't escape.

3. **Connection points:** Two smaller filled circles (dots, ~6px diameter) mark
   where the arc exits and re-enters the core circle. They can be Neural Blue
   or pure white.

4. **Optional detail:** Inside the core circle, a very minimal "E" lettermark
   formed by three short horizontal strokes — evenly spaced, aligned left,
   like circuit traces. Keep it subtle; the lettermark should only be visible
   at larger sizes (32px+). At small sizes the circle and arc alone carry the
   mark.

**Negative space variant:** For small sizes (favicon, 16x16, npm badge), use
only the core circle with the loop arc — no inner lettermark. The mark reads as
a clean, looping node.

**Proportions sketch:**

```
        ___
       /   \        ← arc (rounded stroke, amber)
      |  E  |       ← core circle (amber fill)
       \___/
            \
             ·      ← connection dot (blue or white)
```

---

### Concept B — The Hexagonal Memory Web

**The idea:** A hexagon (code/structure precision) containing a minimal neural
network of 4–5 connected nodes, with one dominant central node. The hexagon
shape echoes honeycomb (organized, stored) and blockchain/network iconography
familiar to developers.

**Visual description:**

1. **Outer frame:** A regular hexagon with flat top/bottom (not pointy
   top/bottom). Thin stroke line, ~2px, Neural Blue (`#007ACC`). Slightly
   rounded corners (2px radius) to soften precision into approachability. No
   fill — transparent interior.

2. **Nodes:** 5 small filled circles distributed inside the hexagon:
    - 1 large central node (~10px) — Memory Amber fill
    - 4 smaller satellite nodes (~5px) — white or off-white fill
    - Positioned at the center and near the four inner cardinal positions
      (not touching the hexagon walls)

3. **Connections:** 4 thin lines connecting each satellite node to the central
   node. Stroke: Neural Blue, ~1.5px. Lines are straight — no curves. This
   gives a precise, engineered feel.

4. **No outer glow needed** — the hexagon frame provides sufficient visual
   anchoring.

---

### Concept C — The Infinity Synapse

**The idea:** A figure-eight / infinity symbol (`∞`) morphed so that the two
loops are slightly asymmetric — one larger (long-term memory) and one slightly
smaller (working memory) — and the cross-over point is a bright node. The
shape reads as "memory flowing" and "continuity."

**Visual description:**

1. **Base shape:** A smooth infinity-like double loop drawn as a continuous
   curved stroke (~3px), Memory Amber color. The two lobes should not be
   perfectly circular — slight horizontal elongation (think an eye shape on
   each side) gives it elegance.

2. **Center connection node:** At the cross-over center, a solid circle (~8px
   diameter), Neural Blue fill with a small white dot at center. This is the
   "synapse" — the junction where both loops meet, where memory is written.

3. **Optional tail:** From the right lobe, a very fine single line of dots
   (like signal transmission) that trails off to the right at 45°, fading to
   transparent. Subtle — only visible at 48px+.

---

## 5. Icon Grid & Spacing

Design on a **100×100** base grid (scales cleanly to all standard sizes).

- **Padding:** 8–10px inset from all edges (safe zone for all icon variants)
- **Minimum clear space around logo:** Equal to the height of the letter "E" in
  the wordmark (approximately 0.5× the icon height)
- **Icon-to-wordmark spacing:** When placed beside the wordmark, the gap
  between icon right edge and wordmark left edge should equal ~75% of the icon's
  total height

---

## 6. Deliverable Sizes

Provide all files in **SVG** (vector, primary) and **PNG** at the following
raster sizes:

| Use                     | Size                         | Format    | Background                                               |
| ----------------------- | ---------------------------- | --------- | -------------------------------------------------------- |
| GitHub README banner    | 640×640 _(icon alone)_       | SVG + PNG | Transparent                                              |
| npm badge icon          | 20×20                        | PNG       | Transparent                                              |
| Favicon                 | 32×32, 16×16                 | ICO / PNG | Transparent                                              |
| Open Graph / Social     | 1200×630 _(icon + wordmark)_ | PNG       | Deep Slate background                                    |
| VS Code extension icon  | 128×128                      | PNG       | Transparent                                              |
| App/Store icon          | 512×512                      | PNG       | Ink background (for platforms requiring non-transparent) |
| Dark mode README header | Full-width SVG banner        | SVG       | Transparent                                              |

---

## 7. Logo Variants

Provide the following combinations:

| Variant                  | Description                                                  |
| ------------------------ | ------------------------------------------------------------ |
| **Icon only (dark bg)**  | Icon on transparent background, for dark surfaces            |
| **Icon only (light bg)** | Icon adapted for white/light surfaces                        |
| **Horizontal lockup**    | Icon left + wordmark right, dark background                  |
| **Horizontal lockup**    | Icon left + wordmark right, light background                 |
| **Stacked lockup**       | Icon centered above wordmark, dark background                |
| **Monochrome (white)**   | Single-color white — for embossing, print, reversed contexts |
| **Monochrome (black)**   | Single-color black — for light print contexts                |

---

## 8. What to Avoid

- **Drop shadows** — the glow effect (if used) is sufficient; no hard shadows
- **Gradients in the wordmark** — keep the name typography flat
- **Busy backgrounds or textures** behind the icon
- **Thin strokes below 1.5px** — they will not render cleanly at small sizes
- **Neon / cyberpunk color schemes** — keep the palette anchored in the
  specified hex values; don't add purples, pinks, or fluorescents
- **Humanoid robot or anthropomorphic brain** — Engram is a technical tool, not
  a consumer AI toy
- **"Gears and cogs" developer clichés** — the neural / node metaphor is richer
  and more distinctive

---

## 9. Personality & Tone

The logo should feel like it belongs beside tools like:

- **Vercel** (clean, confident, dark-native)
- **Planetscale / Turso** (database tools with sharp identity)
- **Linear** (developer productivity, precise geometry)
- **Resend / Upstash** (developer SaaS, amber / neutral palettes)

Not:

- A consumer app icon (bright, bubbly, rounded everything)
- A corporate enterprise tool (overly formal, no personality)
- A research paper diagram (too literal, too academic)

**Three adjectives to design toward:** _Precise. Persistent. Alive._

---

## 10. Reference Materials

For inspiration and category context:

- [Turso.tech](https://turso.tech) — edge database, clean amber + dark palette
- [Upstash](https://upstash.com) — serverless Redis, strong single-color icon
- [Lucia Auth](https://lucia-auth.com) — developer auth library, elegant simple mark
- [MCP Protocol site](https://modelcontextprotocol.io) — the protocol Engram
  implements; complements well
- [SQLite logo](https://sqlite.org) — Engram uses SQLite as its store; adjacency

---

## 11. File Naming Convention

```
engram-icon-dark.svg
engram-icon-light.svg
engram-icon-dark.png              (512×512)
engram-icon-light.png             (512×512)
engram-logo-horizontal-dark.svg
engram-logo-horizontal-light.svg
engram-logo-stacked-dark.svg
engram-logo-stacked-light.svg
engram-logo-mono-white.svg
engram-logo-mono-black.svg
engram-favicon-32.png
engram-favicon-16.png
engram-og-1200x630.png
engram-vscode-128.png
```

Deliver all files in a single `.zip` archive. Include the **source file**
(Figma, Illustrator, or Sketch) alongside the exports.

---

_Questions? Contact the maintainer via the GitHub repository._  
_See [README.md](README.md) for full project context._
