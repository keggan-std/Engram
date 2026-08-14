<!-- PRISM:FM -->
---
prism: "1.0"
type: reference
audience:
  - agent
  - human
agent:
  skip:
    - H
  navigate: []
  directives:
    - "Read on resume when navigating a dense or large file (>150 lines or >3 exports)"
    - "Append one block per file mapped — never overwrite existing blocks"
    - "Complements project-structure.md — directory layer is there, file-internal layer is here"
status: stable
updated: "2026-05-14"
---
<!-- PRISM:FM -->

<!-- [A] -->
<!-- WHAT: File-level anatomy maps — entry points, exports, internal sections, dependency graph -->
<!-- [A:gist] Append one block per dense file (>150 lines / >3 exports). Two templates: File Map (module) · Mini App Anatomy (single-file app). Worked example is [H]. -->
<!-- [/A] -->

# file-architecture.md — File-Level Architecture Maps
> **Extends:** AGENT.md §05.3 | **Complements:** `docs/project-structure.md`
> `project-structure.md` = directory layer (folders, lifecycle dirs, module boundaries)
> `file-architecture.md` = file-internal layer (anatomy, exports, entry points, dependency graph)

---

<!-- [H] -->
<!-- WHY: Threshold guidance — agent derives when to add a block from the [A] gist above -->
## HOW TO USE

- Add a block per file that is **dense, critical, or non-obvious** in structure
- Threshold: any file exceeding ~150 lines or exporting more than 3 public symbols
- Update a block whenever a file's internal structure changes significantly
- Agent reads this on resume to navigate large files without a full re-read
<!-- [/H] -->

---

## File Map Template

Copy this block for each file you need to document:

```markdown
### [filename.ext] — [one-line purpose]

| Property | Value |
|---|---|
| **Path** | [full path from project root] |
| **Type** | [Component · Hook · Store · Service · Utility · Schema · Config · Entry Point] |
| **Lines** | [current line count] |
| **Last mapped** | [date + what changed] |

**Entry Point / How it's loaded:**
[How does the system reach this file? Import path, lazy load, route, CLI command, etc.]

**Exported Surface (public API):**
```
export function [name]([params]): [return type]   // [one-line purpose]
export const   [name]: [type]                      // [one-line purpose]
export default [name]                              // [one-line purpose]
```

**Internal Section Map:**
```
L1   – L30:   [what lives here — imports, constants, types]
L31  – L90:   [section name — what it does]
L91  – L150:  [section name — what it does]
L151 – L210:  [section name — what it does]
```
*Use §BEGIN/§END markers in the file itself to match these ranges (AGENT.md §09.4)*

**Dependency Graph (this file → what it imports):**
```
[filename.ext]
  ├── [import] from '[path]'   // [why — what it provides]
  ├── [import] from '[path]'   // [why]
  └── [import] from '[path]'   // [why]
```

**Consumed by (what imports this file):**
- `[path/to/consumer.ext]` — uses `[specific export]`
- `[path/to/consumer.ext]` — uses `[specific export]`

**Watch-outs:**
- [anything load-bearing, shared, or dangerous to modify]
- [NOTE: or WARN: level concerns]
```

---

## Mini App Anatomy Template

> Use when the entire application lives in one or a small number of dense files.
> Common in: scripts, CLI tools, single-file React apps, Jupyter notebooks, serverless functions.

```markdown
### [app-name] — Mini App Anatomy

| Property | Value |
|---|---|
| **Entry file** | [filename.ext] |
| **Total lines** | [count] |
| **Architecture pattern** | [e.g. Single-file React · Express monolith · CLI script · Lambda handler] |
| **Last mapped** | [date] |

**Boot sequence (how the app starts):**
```
1. [first thing that runs — e.g. env load, DB connect, React render]
2. [second]
3. [third — until app is serving/ready]
```

**Internal Zones (top → bottom of file):**
```
Zone 1: Imports & Config        L1   – L[N]
  └── [what lives here]

Zone 2: Types & Constants       L[N] – L[N]
  └── [what lives here]

Zone 3: Core Logic / Engine     L[N] – L[N]
  └── [what lives here — the load-bearing section]

Zone 4: UI Layer / Handlers     L[N] – L[N]
  └── [what lives here]

Zone 5: Bootstrap / Export      L[N] – L[end]
  └── [app entry call, ReactDOM.render, module.exports, etc.]
```

**State map (for stateful apps):**
```
[state variable]   managed by [hook/store/global]   affects [which zones/components]
[state variable]   managed by [hook/store/global]   affects [which zones/components]
```

**External dependencies this file touches directly:**
- `[package]` — used for [purpose] — imported at L[N]

**Critical functions (load-bearing — do not modify without full trace):**
```
[functionName]()  L[N]–L[N]   WHY: [why this is critical]
```

**Known fragile areas:**
- L[N]–L[N]: [what's fragile and why — maps to a WARN: comment in the file]
```

---

<!-- [H] -->
<!-- WHY: Worked example is human learning reference — templates above are the agent-actionable content -->
## Worked Example — Single-File React App

```markdown
### App.jsx — Product Catalog Mini App (single-file)

| Property | Value |
|---|---|
| **Path** | src/App.jsx |
| **Type** | Entry Point · Component · Store (co-located) |
| **Lines** | 312 |
| **Last mapped** | 2026-05-11 — search feature added (L180–L240) |

**Entry Point:**
`index.js` → `ReactDOM.createRoot().render(<App />)`

**Exported Surface:**
```
export default App    // root component — consumed only by index.js
```

**Internal Section Map:**
```
L1   – L18:   Imports (React, Zustand, API client, components)
L19  – L45:   Constants (PAGE_LIMIT=50, DEBOUNCE_MS=300, API_BASE)
L46  – L90:   useProductStore — Zustand slice (products, loading, error)
L91  – L140:  useSearchStore  — Zustand slice (query, results, searching)
               §BEGIN: search-store / §END: search-store
L141 – L179:  API functions (fetchProducts, searchProducts)
L180 – L240:  SearchBar component (debounced input, clear button)
               §BEGIN: search-bar / §END: search-bar
L241 – L285:  ProductList component (renders products or search results)
L286 – L312:  App root — layout, conditional render, ReactDOM bootstrap
```

**Dependency Graph:**
```
App.jsx
  ├── react              // useState, useEffect, useCallback
  ├── zustand            // WHY: co-located stores; no separate store files in mini app
  ├── axios              // WHY: interceptor handles auth token globally
  └── ./components/Spinner  // only external component import
```

**Consumed by:**
- `index.js` — default import, renders into #root

**Watch-outs:**
- L46–L90: useProductStore is shared by ProductList AND SearchBar — mutations affect both
- L141: axios instance carries auth interceptor — do not replace with fetch() here
- L286: Bootstrap is at bottom — any syntax error above silently prevents render
```
<!-- [/H] -->

---

<!-- ✓ AGENT:COMPLETE -->
