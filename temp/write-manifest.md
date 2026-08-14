<!-- PRISM:FM -->
---
prism: "1.0"
type: template
audience:
  - agent
  - human
agent:
  skip:
    - H
  navigate:
    - entry-template
  directives:
    - "Jump to #entry-template — declare every file here before writing it"
    - "Read this file FIRST on every session resume — before plan.md"
    - "Status: Writing entries with missing sentinel = incomplete file — finish before anything else"
status: stable
updated: "2026-05-14"
---
<!-- PRISM:FM -->

<!-- [A] -->
<!-- WHAT: Write Intent Log — tracks every file write; checked first on every session resume -->
<!-- [A:gist] Navigate: #entry-template (copy block, declare file before writing). Resume check: Status: Writing + missing sentinel = incomplete → finish first. Status lifecycle: Declared → Writing → §Complete → ✓ Verified. -->
<!-- [/A] -->

# write-manifest.md — Write Intent Log
> **Extends:** AGENT.md §09.4 | **Location:** `_wip/write-manifest.md` (lifecycle: WIP)
> Declare every file before writing it. Check this first on every session resume.

---

<!-- [H] -->
<!-- WHY: Operational steps — agents derive protocol from AGENT.md §09.4 + gist above -->
## HOW TO USE

### Before writing any file:
1. Add a new entry block below with `Status: Declared`
2. Fill all fields — planned sections must be specific, not vague
3. Change status to `Writing` immediately before the first write operation

### After completing a file:
1. Add sentinel `✓ AGENT:COMPLETE` as the final line of the file
2. Update status to `§Complete`

### On session resume (run this first — before plan.md):
1. Scan all entries — find any with `Status: Writing` or `Status: §Complete`
2. Open the physical file → check for `✓ AGENT:COMPLETE` sentinel
3. Sentinel missing → `Status: Incomplete` → finish the file before anything else
4. Sentinel present → `Status: ✓ Verified` → safe to continue
<!-- [/H] -->

---

## Status Lifecycle

```
Declared → Writing → §Complete → ✓ Verified
                  ↘ Incomplete (sentinel missing on resume)
                        ↓
                  [complete file] → §Complete → ✓ Verified
```

| Status | Meaning |
|---|---|
| `Declared` | Intent logged; file not yet started |
| `Writing` | Active write in progress this session |
| `§Complete` | File written + sentinel added; not yet verified on resume |
| `✓ Verified` | Sentinel confirmed present on resume; file is complete |
| `Incomplete` | Sentinel missing on resume; file must be completed before proceeding |

---

## Entry Template

```
### [filename.ext]
- Path:              [full path from project root]
- Session:           [date + session number e.g. 2026-05-11 / S1]
- Status:            Declared
- Task ref:          [plan.md phase + step e.g. Phase 2 / Step B.3]
- Planned sections:
    - [ ] [section name — be specific]
    - [ ] [section name]
    - [ ] [section name]
- Est. lines:        [approximate]
- Sentinel added:    No
- Notes:             [anything the next session needs to know]
```

---

## Active Entries

<!-- AGENT: Add new entries here. Never delete — update Status only. -->
<!-- AGENT: Keep entries in reverse chronological order — newest at top. -->

*No entries yet. Add one before writing your first file this session.*

---

## Verified / Archived Entries

<!-- AGENT: Move entries here once Status = ✓ Verified. Keeps Active section clean. -->

*None yet.*

---

<!-- ✓ AGENT:COMPLETE -->
