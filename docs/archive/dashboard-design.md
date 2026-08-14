# Engram Dashboard — Design System & UX Specification

> **Status:** Ready to implement
> **Last updated:** 2026-03-01
> **Related:** `dashboard-plan.md` (architecture), `dashboard-assets.md` (production assets)

---

## 1. Design Philosophy

**The Engram dashboard should feel like an intelligent instrument, not a web app.**

The user is a developer or technical lead who cares about precision and speed. They open this tool because they need to understand what their AI agents have been doing, find a specific memory, make a decision, or audit history. Every design choice must serve that purpose.

**Five non-negotiable principles:**

1. **Calm authority.** Dark by default. Monochrome palette with a single warm accent. No color unless it carries meaning (status, alert, category). No gradients for decoration.
2. **Density with breathing room.** Tables, not cards. Rows are compact. Spacing uses a strict 4px grid — nothing feels cramped, nothing wastes space.
3. **Motion = information.** Transitions are purposeful. An element moves because something changed, not because it's time to be dramatic. Duration: 80–200ms. Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (spring-like finish).
4. **Keyboard first.** Every action reachable without a mouse. J/K row navigation. Cmd+K command palette. No operation requires more than 3 keystrokes from anywhere.
5. **Alive, not busy.** The interface reacts to real events (new session, conflict detected, task updated) with subtle status pulses. The live indicator in the corner should feel like a heartbeat, not a spinner.

---

## 2. Color System

### Foundations

The palette is near-monochrome. Color communicates status, never decoration.

```
Background layer system (dark mode, default):
  --bg-base:         #0d0d0d   ← root background
  --bg-surface:      #141414   ← sidebar, panels
  --bg-elevated:     #1a1a1a   ← cards, table rows on hover
  --bg-overlay:      #222222   ← modals, dropdowns, tooltips
  --bg-input:        #1a1a1a   ← all input fields

Border system:
  --border-subtle:   #252525   ← table dividers, section separators
  --border-default:  #303030   ← standard component borders
  --border-strong:   #484848   ← focused inputs, selected rows

Text system:
  --text-primary:    #f0f0f0   ← headings, critical labels
  --text-secondary:  #888888   ← metadata, timestamps, captions
  --text-tertiary:   #555555   ← disabled, placeholder
  --text-accent:     #c9a96e   ← warm gold — the single accent color

Accent (warm gold):
  --accent:          #c9a96e   ← primary accent
  --accent-hover:    #d9be8a   ← hover state of accent
  --accent-dim:      #c9a96e1a ← 10% alpha — subtle accent fill
  --accent-ring:     #c9a96e40 ← 25% alpha — focus rings

Status colors (semantic only — never decorative):
  --status-active:   #4a9e6a   ← green  — active, healthy, ok
  --status-stale:    #b89030   ← amber  — stale, warning, pending
  --status-conflict: #c05050   ← red    — conflict, error, blocked
  --status-archived: #484848   ← gray   — archived, inactive
  --status-new:      #5a8fbf   ← blue   — new, in progress
```

### Light Mode (system-detected)

Light mode is available but secondary. Same accent. Surfaces invert: backgrounds go near-white, text goes near-black. Status colors desaturate 10% for bright screens.

```
  --bg-base:         #f5f5f3
  --bg-surface:      #ffffff
  --bg-elevated:     #f0f0ee
  --bg-overlay:      #ffffff
  --border-subtle:   #e8e8e6
  --border-default:  #d8d8d6
  --text-primary:    #111111
  --text-secondary:  #666666
  --text-accent:     #9a7a4a   ← accent darkened for legibility on white
```

---

## 3. Typography

Single typeface family throughout. No decorative fonts.

```
Font family:    "Geist Mono" for all monospace (file paths, IDs, code)
                "Geist" (or system-ui fallback) for all prose and UI labels
                Fallback stack: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif

Scale (rem, base = 16px):
  --text-xs:     0.6875rem  (11px) — badges, micro-labels
  --text-sm:     0.8125rem  (13px) — table cells, form labels, metadata
  --text-base:   0.9375rem  (15px) — body text, descriptions
  --text-lg:     1.125rem   (18px) — section headings, panel titles
  --text-xl:     1.375rem   (22px) — page headings
  --text-2xl:    1.75rem    (28px) — overview stat numbers only

Line heights:
  --leading-tight:  1.25  — headings
  --leading-normal: 1.5   — body text
  --leading-loose:  1.75  — description blocks

Font weights:
  400 — body text, labels
  500 — table column headers, nav items
  600 — page titles, stat numbers, emphasis
  No 700+ weights except in logos/wordmark
```

---

## 4. Spacing & Layout

```
Spacing scale (4px base unit):
  4px   0.25rem   --space-1   ← icon padding, tight gaps
  8px   0.5rem    --space-2   ← inline element gaps
  12px  0.75rem   --space-3   ← table cell padding (vertical)
  16px  1rem      --space-4   ← standard component padding
  24px  1.5rem    --space-6   ← section gaps
  32px  2rem      --space-8   ← major section breaks
  48px  3rem      --space-12  ← page-level padding

Border radius:
  --radius-sm:   3px    ← badges, tags
  --radius-md:   6px    ← inputs, buttons, cards
  --radius-lg:   10px   ← panels, modals
  --radius-full: 9999px ← pills, avatars

Layout dimensions:
  --sidebar-width:       220px (collapsed: 52px — icon only)
  --detail-panel-width:  420px (slides in from right)
  --topbar-height:       48px
  --table-row-height:    40px (compact), 56px (expanded first line)
  --command-palette-width: 580px (centered, max 90vw)

Breakpoints (tailwind custom):
  sm: 640px    (minimum supported: 1280×800 — never smaller than this)
  md: 1024px
  lg: 1440px
  xl: 1920px
  2xl: 2560px  (4K)
```

---

## 5. Motion & Animation

Every animation has a purpose. Zero motion just for style.

```
Timing:
  --duration-fast:    80ms   ← badge color change, focus ring
  --duration-default: 150ms  ← hover states, button press
  --duration-enter:   200ms  ← panel slide-in, modal open
  --duration-exit:    120ms  ← always faster than enter

Easing:
  --ease-default:  cubic-bezier(0.16, 1, 0.3, 1)   ← spring — all slide/expand
  --ease-out:      cubic-bezier(0, 0, 0.2, 1)       ← opacity fades
  --ease-in:       cubic-bezier(0.4, 0, 1, 1)       ← exit animations only

Rules:
  - Reduce motion: @media (prefers-reduced-motion: reduce) disables all transitions
    and replaces with instant state changes. No exceptions.
  - No looping animations unless they indicate a live state (heartbeat, spinner)
  - Spinners: 400ms rotation, linear. Only shown after 200ms of pending state.
  - Skeleton loaders: shimmer sweep, 1200ms, runs 2 cycles max then stops
```

---

## 6. Component Specifications

### 6.1 Shell Layout

```
┌─ Shell (100vw × 100vh) ─────────────────────────────────────────────┐
│ ┌─ Sidebar (220px) ─┐ ┌─ Main Area (flex-1) ──────────────────────┐│
│ │ [Logo/wordmark]   │ │ ┌─ TopBar (48px) ─────────────────────────┐││
│ │                   │ │ │ Breadcrumb     [Search] [Notif] [Avatar] │││
│ │ [InstanceSwitch]  │ │ └─────────────────────────────────────────┘││
│ │                   │ │                                             ││
│ │ ─── Memory ────── │ │  Page Content Area                         ││
│ │  Sessions         │ │  (full height - 48px; overflow-y: scroll)  ││
│ │  Decisions        │ │                                             ││
│ │  File Notes       │ │                                             ││
│ │  Tasks            │ │                                             ││
│ │  Conventions      │ │                                             ││
│ │  Changes          │ │                                             ││
│ │  Milestones       │ └─────────────────────────────────────────────┘│
│ │                   │                                                │
│ │ ─── Multi ─────── │  Detail Panel (420px, slides from right)      │
│ │  Instances        │  visible when a row is selected               │
│ │  Analytics        │                                                │
│ │  Import           │                                                │
│ │                   │                                                │
│ │ ─── bottom ─────  │                                                │
│ │  [● Live]         │                                                │
│ │  Settings         │                                                │
│ └───────────────────┘                                                │
└──────────────────────────────────────────────────────────────────────┘
```

**Sidebar micro-interactions:**
- Hover on nav item: left border `--accent` appears (2px, 200ms ease)
- Active item: `--bg-elevated` fill + `--text-primary` + `--accent` left border
- Collapse: sidebar shrinks to 52px icon-only; icons remain; tooltip on hover shows label
- Collapse toggle: button at bottom of sidebar; arrow icon rotates 180° on state change
- The `[● Live]` indicator pulses (opacity 1→0.4→1, 2s, infinite) when WS is connected; turns amber when disconnected

### 6.2 Data Table (core component — used everywhere)

Default: compact rows. All tables share the same base component.

```
Row anatomy (40px height):
  [8px] [checkbox 16px] [8px] [primary cell flex-1] [metadata cells...] [actions 32px] [8px]

Column header:
  - 13px, weight 500, --text-secondary
  - Click to sort: unsorted → ascending (↑) → descending (↓) → unsorted
  - Active sort column: --text-primary
  - Resize handle appears on hover of column border (drag)

Row states:
  default:     background transparent; border-bottom --border-subtle
  hover:       background --bg-elevated; transition 80ms
  selected:    background --accent-dim; left border 2px --accent
  focused:     same as selected + --accent-ring outline
  expanded:    row grows; detail content appears below with 12px padding;
               background --bg-elevated maintained while expanded
  loading:     shimmer overlay on row content (skeleton loader)

Row expansion:
  - Click anywhere on row (not on action buttons): expand/collapse
  - Expanded state shows full content of all truncated fields
  - Expand animates: max-height 0 → auto, 200ms --ease-default
  - Collapse: max-height → 0, 120ms --ease-in

Keyboard navigation:
  j / ↓       move selection down
  k / ↑       move selection up
  Enter       expand/collapse selected row
  e           edit selected row (if editable)
  d           delete selected (shows confirmation)
  /           focus search input
  Escape      clear selection / close expanded row
  Space       toggle checkbox on selected row
  Shift+↑/↓  range select

Pagination:
  - Load-more button at bottom (not page numbers — cursor pagination)
  - "Showing 50 of 1,243" text left; "Load 50 more" button right
  - Auto-load on scroll to bottom (IntersectionObserver)
```

### 6.3 Status Badge

Used for: decision status, task status, file-note confidence, instance health.

```
Sizes:  sm (20px h, 11px text) | md (24px h, 13px text)
Shape:  pill (--radius-full), 6px horizontal padding

Colors mapped to status tokens:
  "active" / "enforced" / "healthy"  → --status-active background (10% alpha), text (full)
  "stale" / "pending" / "warning"    → --status-stale
  "superseded" / "conflict" / "error"→ --status-conflict
  "archived" / "done" / "inactive"   → --status-archived
  "in_progress" / "new"              → --status-new
  "high" priority                    → --status-conflict
  "medium" priority                  → --status-stale
  "low" priority                     → --status-archived

Micro-interaction:
  - Color transition on status change: 150ms ease
  - New badge (just appeared in list): brief scale 1→1.06→1 pulse, 300ms
```

### 6.4 Command Palette (Cmd+K)

```
Behavior:
  - Opens: Cmd+K (mac), Ctrl+K (win/linux) — globally, anywhere in the app
  - Also: "/" when no input is focused
  - Closes: Escape, or click outside, or selecting an item

Appearance:
  - Modal overlay: background rgba(0,0,0,0.5), backdrop-filter blur(4px)
  - Palette: centered, 580px wide, max-height 480px, --bg-overlay, --radius-lg
  - Opens with scale 0.96→1 + opacity 0→1, 150ms --ease-default
  - Closes: scale 1→0.96 + opacity 1→0, 100ms --ease-in

Input:
  - Full-width, borderless inside palette
  - Placeholder: "Search memory, jump to page, run action..."
  - Monospace font for file paths, ID numbers

Results:
  - Grouped sections: "Jump to", "Memory", "Actions", "Settings"
  - Each result: icon (16px) + label + secondary text (right-aligned)
  - Keyboard: ↑/↓ to navigate; Enter to execute
  - Highlighted match text: --accent color, not background highlight
  - Max 5 results per section; "Show all N results →" at section bottom
  - Empty state: "No results for '...'" + suggestion to use full search
```

### 6.5 Detail Panel (slide-in)

Opens when any row is selected. Covers the right 420px of the main area.

```
Anatomy:
  [TopBar: close button (×) + entity type + ID]
  [Title / primary field — text-xl, full wrap]
  [Metadata row: agent · timestamp · session link]
  [Divider]
  [Body content — varies by entity type]
  [Divider]
  [Actions row: Edit, Delete, Annotate, Copy link]
  [Annotations section (collapsible)]

Animation:
  Open: translateX(100%) → translateX(0), 200ms --ease-default
  Close: translateX(0) → translateX(100%), 120ms --ease-in
  Main content shifts left as panel opens (flex layout — no overlay)

Detail view per entity:
  Decision: decision text → rationale → tags → supersedes_id (if any) → linked sessions
  File Note: path (monospace) → purpose → summary → confidence dot → layer → staleness
  Task: title → description → priority badge → status → assigned agent → created session
  Session: agent → start/end time → duration → summary → changes count → decisions created
  Convention: rule text → category → enforced toggle (interactive) → when added
  Change: file path → change_type → description → impact_scope → session link
```

### 6.6 Instance Switcher

Located at top of sidebar.

```
Display: current instance label (truncated to 16 chars) + small instance-count badge
         if viewing all instances: "All Instances" + count

Hover: background --bg-elevated, cursor pointer

Click: dropdown opens (popover, 220px wide):
  - "All Instances" option at top
  - Divider
  - One row per instance:
    [health-dot 8px] [label] [project_root truncated] [active badge if current session]
  - "Add instance / refresh" at bottom

Health dot colors:
  Connected + active session last <5min: pulsing green
  Connected + no recent session: solid green
  Stale (last heartbeat > 2min): amber
  Unreachable: red
```

### 6.7 Loading States

```
Initial page load:
  - Skeleton rows: same height as real rows, shimmer animation
  - Show 12 skeleton rows max
  - After 200ms of pending (never flash for fast responses)

Inline mutations (optimistic):
  - Row updates instantly (optimistic); shows subtle --accent-dim background
  - On confirm from server: flash once to normal (150ms transition)
  - On error: row reverts; red left border appears; inline error message

Full-page transitions:
  - Route change: current page fades out (opacity 1→0, 80ms); new page fades in (0→1, 150ms)
  - No layout shift during transitions

Empty states:
  - Each empty view has: 48px icon (outline, --text-tertiary) + heading + 1-line explanation
    + primary action button where applicable
  - "No decisions found" + "Your AI agent hasn't called record_decision yet." + [Docs link]
```

### 6.8 Notification Toast

```
Position: bottom-right, 16px from edges
Width: 320px
Stack: up to 3 toasts visible; oldest auto-dismissed after 4s

Toast anatomy:
  [left color bar 3px] [icon 16px] [title 13px 500] [message 13px 400] [×]

Colors by type:
  info:    --status-new left bar
  success: --status-active left bar
  warning: --status-stale left bar
  error:   --status-conflict left bar

Animation:
  Enter: translateY(16px) + opacity 0 → normal, 200ms --ease-default
  Exit:  translateX(100%) + opacity 1→0, 150ms --ease-in (on dismiss or timeout)
  Stack: when new toast arrives while others visible, existing toasts shift up (translateY transition)
```

---

## 7. Per-Page Design Specifications

### 7.1 Overview (/)

The single place to understand the health and activity of all instances at a glance.

```
Layout:
  [Page title: "Overview"] [instance filter: "All Instances" dropdown]

  Row 1 — Stat widgets (6 across):
    Sessions | Decisions | File Notes | Tasks | Conventions | Changes
    Each widget:
      - Large number (--text-2xl, 600 weight)
      - Label below (--text-sm, --text-secondary)
      - Delta chip: "+3 today" in --status-active or --status-stale color
      - Click navigates to that entity's full page

  Row 2 — Activity Chart (full width):
    - Bar chart: sessions per day, last 30 days
    - Bar color: --accent at 60% opacity; hover: 100%
    - X axis: dates (abbreviated); Y axis: count (auto-scaled)
    - Hover tooltip: date + count + agent breakdown (small colored dots)
    - Height: 200px

  Row 3 — Two columns:
    Left (60%): Recent Sessions list
      - Last 8 sessions; compact rows
      - Each: agent label + relative time + duration + changes count badge
      - "View all sessions →" link at bottom

    Right (40%): Active Instances panel
      - One card per instance; health status
      - Instance label + project root + last active + health dot
      - Conflict badge overlay if conflicts detected
```

**Micro-interactions:**
- Stat numbers count up from 0 on first load (300ms, linear counter animation)
- WS `session_started` event: sessions stat number increments with subtle flash; new row prepends to Recent Sessions with slide-down animation (translateY -20px → 0, 200ms)
- WS `conflict_detected`: conflict badge appears on instance card with scale pulse

---

### 7.2 Decisions (/decisions)

```
Layout:
  [Page title: "Decisions"] [Count badge] [New Decision button (Phase 2)]
  [Filter bar: status | tags | text search | date range]
  [Table]

Table columns:
  Checkbox | Status badge | Decision text (primary, truncated 2 lines) |
  Tags (up to 3 pills, overflow +N) | Session | Age | Actions (⋯)

Sort defaults: newest first
Filter defaults: status=active

Expanded row shows:
  Full decision text (no truncation)
  Rationale (italic, --text-secondary)
  Tags (all)
  Supersedes decision ID (if any, linked)
  All sessions where this decision was active

Actions (⋯ menu):
  Edit (Phase 2) | Mark Superseded (Phase 2) | Copy ID | Annotate | Delete
```

**Micro-interactions:**
- Status badge color change when toggling superseded: transition 150ms
- "Superseded" rows: entire row text at 60% opacity (`--text-secondary` color)
- New decision created by agent: row prepends; slides in + accent-dim background fades out over 1.5s

---

### 7.3 File Notes (/file-notes)

```
Layout:
  [Page title: "File Notes"] [Count + coverage %] [Sort: staleness | path | confidence]
  [Filter: staleness threshold | confidence | layer]
  [Table]

Table columns:
  Path (monospace, primary) | Purpose (truncated) | Confidence dot |
  Staleness (relative time since last update) | Layer | Session | Actions

Confidence dot visualization:
  3 dots stacked vertically, each 6px circle
  high:   3 dots filled --status-active
  medium: 2 dots filled --status-stale, 1 empty
  low:    1 dot filled --status-conflict, 2 empty

Staleness coloring:
  < 2 hours:   --text-secondary (normal)
  2–24 hours:  --status-stale
  > 24 hours:  --status-conflict + "Stale" badge

Expanded row:
  Full file path (monospace, selectable)
  Executive summary (full text)
  Dependencies list (if any)
  Layer badge + complexity badge
  Last updated session (linked)
```

---

### 7.4 Tasks (/tasks)

Board view (default) and list view toggle.

```
Board view:
  Columns: Backlog | In Progress | Blocked | Done
  Each column:
    - Header: column name + count badge
    - Cards in column (sorted by priority desc within column)
    - "New task" ghost card at bottom of each column (Phase 2)

Task card anatomy:
  [Priority left border: 2px colored stripe]
  [Title (2 lines max)]
  [Agent badge] [relative time]
  [Description preview (1 line, --text-secondary)]

Card priority border colors:
  critical: --status-conflict
  high:     --status-stale
  medium:   --accent (warm gold)
  low:      --border-default

Drag-and-drop (Phase 2): cards draggable between columns; drops update status via API

List view:
  Standard table; columns: Priority | Title | Status | Agent | Age | Actions
  Priority shown as colored badge + text

Both views: keyboard shortcut 'v' toggles board/list
```

**Micro-interactions:**
- WS `task_updated`: the card/row pulses (accent-dim flash, 400ms) in place; status badge transitions
- Drag card: card lifts (box-shadow appears, scale 1→1.02, 80ms); drop: card settles with subtle bounce (spring easing)

---

### 7.5 Sessions (/sessions)

Timeline-oriented. Chronological, newest first.

```
Layout:
  [Page title: "Sessions"] [Instance filter] [Date range picker]
  [Timeline list]

Timeline item (56px default, expands):
  Left: vertical line (2px, --border-default) + dot (8px, status-colored)
  Content: [Agent badge] [Start time] [Duration chip] [Changes count badge] [Decisions count badge]
  Summary text (1 line, --text-secondary)

Dot colors:
  Active (no end_time): pulsing --status-active
  Completed: --border-strong (static)
  Long session (>2h): --status-stale

Expanded item:
  Full summary text
  Changes list (compact: file path + change_type)
  Decisions created (linked)
  File notes created/updated (count)
  End time + total duration
```

---

### 7.6 Instances (/instances)

```
Layout:
  [Page title: "Instances"] [Refresh scan button]

  Grid of instance cards (2 columns on 1440px; 3 on 1920px):

Instance card (compact, 200px height):
  [Header: instance label + health dot]
  [project_root in monospace, truncated with tooltip on hover]
  [IDE detected (if known)]
  [Last active: relative time]
  [Sharing mode badge]
  [Metrics row: sessions count + decisions count]

Card states:
  healthy: standard border
  stale:   --status-stale border + amber dot
  conflict: --status-conflict border + conflict badge overlay
  self:    --accent border (this instance)

Click card: slide-in detail panel showing:
  Full instance info → cross-instance decisions/tasks query results → sharing config toggle

"No other instances found" empty state with instruction to ensure MCP server is running
```

---

### 7.7 Analytics (/analytics)

```
Layout:
  [Page title: "Analytics"] [Date range]

  Section 1 — Activity:
    Full-width activity chart (larger version of Overview chart)
    30-day bar chart + agent breakdown stacked bars

  Section 2 — Memory Health (two columns):
    Left: Staleness report — table of stale file notes sorted by staleness desc
    Right: Decision health — decisions without rationale, without tags, or superseded >30d

  Section 3 — Coverage:
    File note coverage heatmap (Phase 2)
    Treemap visualization: each file in project = cell; color = has note / missing / stale
    Cells sized by estimated importance (line count or recency)
```

---

### 7.8 Settings (/settings)

```
Layout: Single-column sections with dividers

Sections:
  Connection
    - Currently connected instances (pills with × to disconnect)
    - Add instance: port input + connect button

  Appearance
    - Theme: Dark / Light / System (segmented control, 3 options)
    - Sidebar: expanded / collapsed default (toggle)

  API Token
    - Token ID displayed (last 8 chars only): ••••••••abcd1234
    - "Rotate token" button → confirmation modal → new token + copy button
    - Warning: "Rotating invalidates the current token immediately"

  Keyboard Shortcuts
    - Table: Action | Shortcut | (Edit button, Phase 2)
    - Non-editable in Phase 1; display only

  Privacy Mode
    - Toggle: "Blur all content when window loses focus"
    - Keyboard shortcut to toggle: shown next to toggle

  About
    - Engram version + wordmark
    - Project repo link
    - "Check for updates" button
```

---

## 8. Micro-Interaction Catalog (Complete)

| Trigger | Element | Animation | Duration | Notes |
|---|---|---|---|---|
| Page navigate (any route) | Page content | Fade out/in | 80ms + 150ms | No layout shift |
| Row hover | Any table row | Background → --bg-elevated | 80ms | Instant feel |
| Row select (click) | Table row | Background → --accent-dim + left border | 150ms | Also opens detail panel |
| Row expand | Table row | max-height 0→auto | 200ms spring | Content fades in offset 30ms |
| Badge status change | Status badge | Color transition | 150ms | Seen on task status update |
| New row prepends (WS) | Table | Slide down + accent-dim flash | 200ms + 1.5s | Flash fades after 1.5s |
| Stat number update (WS) | Stat widget | Number increments | 300ms counter | Linear, integer steps |
| Conflict badge appears | Instance card | Scale 1→1.06→1 + color | 300ms spring | Draws attention non-aggressively |
| WS connected | Live dot | Pulse opacity 1→0.4 loop | 2s infinite | Stops when disconnected |
| WS disconnected | Live dot | Turn amber, pulse faster | 1s infinite | Urgent but not alarming |
| WS reconnecting | Live dot + toast | Amber + toast: "Reconnecting..." | — | Toast auto-dismisses on reconnect |
| Panel open (detail) | Detail panel | Slide in from right | 200ms spring | Main area shifts left |
| Panel close | Detail panel | Slide out to right | 120ms ease-in | Faster than open |
| Command palette open | Palette | Scale 0.96→1 + fade | 150ms spring | Overlay fades in behind |
| Command palette close | Palette | Scale 1→0.96 + fade | 100ms ease-in | — |
| Toast enter | Toast | Slide up + fade in | 200ms spring | From bottom-right corner |
| Toast exit | Toast | Slide right + fade | 150ms ease-in | On dismiss or timeout |
| Toast stack | Existing toasts | Shift up (translateY) | 200ms spring | When new toast arrives |
| Button press | Any button | scale 0.98 | 80ms | Release: bounce back |
| Sidebar collapse | Sidebar | width 220→52px | 200ms spring | Icons remain; labels fade |
| Input focus | Any input | Border → --border-strong + ring | 80ms | Ring: --accent-ring |
| Input error | Any input | Red border + shake | 80ms + 150ms | Shake: ±4px, 3 cycles |
| Drag start | Task card | scale 1→1.02 + shadow | 80ms | Lifted state |
| Card drop | Task card | Spring settle + shadow fade | 200ms | Subtle bounce at landing |
| Optimistic update | Any row | Accent-dim background | 150ms | Fades when server confirms |
| Server error on save | Any row | Revert + red border | 150ms | Error message appears inline |
| Privacy mode on | All content | blur(8px) | 150ms | Full content areas |
| Privacy mode off | All content | blur(0px) | 150ms | — |
| Skeleton → real data | Loading rows | Crossfade | 200ms | No layout shift |
| Tooltip appear | Any tooltip | Fade + 4px translate | 100ms | Hover delay: 400ms |

---

## 9. Accessibility Specifications

| Requirement | Implementation |
|---|---|
| WCAG 2.1 AA | All color combinations meet 4.5:1 contrast ratio minimum |
| Screen reader | All icons paired with `aria-label`; table cells use `role="cell"` |
| Focus management | Modal/panel open moves focus to first interactive element; close returns to trigger |
| Focus ring | Visible on all interactive elements; uses `--accent-ring` outline |
| Touch targets | Minimum 44×44px for all clickable elements; table action buttons have expanded hit area |
| Keyboard nav | Full app navigable without mouse; see per-component keyboard map |
| Reduced motion | `@media (prefers-reduced-motion)` disables all transitions; instant state changes |
| High contrast | Follows OS high-contrast mode preference |
| Font scaling | All font sizes in `rem`; scales with browser/OS preference |
| Color blind | Status never conveyed by color alone — always paired with icon or label |

---

## 10. Dark/Light Mode Toggle

- Default: system preference via `prefers-color-scheme`
- Manual override: stored in `localStorage` + Zustand `ui.store.ts`
- CSS: all color tokens defined as `:root` CSS vars plus `[data-theme="light"]` overrides
- Transition: `transition: background-color 200ms, color 200ms, border-color 200ms` on `<html>` element

---

*Assets required to implement this design system are catalogued in `dashboard-assets.md`.*
