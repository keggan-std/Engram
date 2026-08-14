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
  navigate: []
  directives:
    - "Overwrite this file completely after every phase — never append"
    - "On first run: fill Project Info + Directory Tree (mark dirs as [planned])"
    - "After each phase: replace entire file with live snapshot; update status tags"
    - ".gitignore candidates section is [H] — flagging decisions go in Drift Report"
status: stable
updated: "2026-05-14"
---
<!-- PRISM:FM -->

<!-- [A] -->
<!-- WHAT: Workspace map — dual role: scaffold (first run) + live snapshot (after each phase) -->
<!-- [A:gist] Two modes: scaffold (first run — fill Project Info + tree, mark [planned]) · snapshot (after phase — overwrite entirely with live tree). Dense file internals → use file-architecture.md. -->
<!-- [/A] -->

# project-structure.md — Workspace Map
> **Extends:** AGENT.md §05.3 | **Role:** Dual — scaffold on first run; overwritten with live snapshot after each phase
> **Rule:** Agent overwrites this file completely after every phase. Never append — always replace with a fresh snapshot.

---

<!-- [H] -->
<!-- WHY: Mode instructions — agents derive scaffold/snapshot behaviour from [A] gist above -->
## HOW TO USE

### First Run (Scaffold Mode)
1. Copy → `{project-root}/docs/project-structure.md`
2. Fill **Project Info** and **Directory Tree** with the initial planned structure
3. Mark all dirs as `[planned]` until they exist on disk

### After Each Phase (Snapshot Mode)
1. Agent scans the actual workspace tree
2. Overwrites this file entirely with the live structure
3. Marks dirs as `[active]`, `[empty]`, or `[archived]`
4. Flags any orphaned files or structural drift in the **Drift Report** section
<!-- [/H] -->

---

## Project Info
- **Project:** [name]
- **Type:** [source-code | documentation | mixed/monorepo]
- **Dir prefix convention:** [underscore `_` | flat | dot `.`] *(per AGENT.md §05.4)*
- **Snapshot taken:** [date + phase — e.g. "2026-05-11, after Phase 2"]
- **Version:** [matches plan.md version]

---

## Directory Tree

> One-line description per node. Mark status in brackets.
> Status: `[active]` `[planned]` `[empty]` `[archived]` `[orphaned]`

```
{project-root}/
│
├── AGENT.md                        # Root manifest — agent directives
├── plan.md                         # Living execution plan (copy of plan-template.md)
│
├── docs/                           # [active] Documentation system
│   ├── README.md                   # Master router
│   ├── plan-template.md            # Plan schema master template
│   ├── bug-log.md                  # Bug registry master template
│   ├── project-structure.md        # THIS FILE — workspace map
│   ├── inline-comment-guide.md     # Comment convention reference
│   ├── code-standards.md           # Engineering standards reference
│   ├── agent-handoff.md            # Multi-agent contract template
│   ├── CHANGELOG.md                # Manifest system version history
│   └── decisions/                  # [planned] ADR files (auto-created on first ADR)
│       └── ADR-001-[title].md      # Example ADR — one per architectural decision
│
├── _sandbox/                       # [active] Throwaway experiments — never promote directly
├── _wip/                           # [active] Current phase execution artifacts
├── _checkpoints/                   # [active] Immutable versioned snapshots
│   └── v0.1.0-pre-[feature]/      # Example checkpoint — write-once
├── output/                         # [empty] Final Owner-approved deliverables only
├── _archive/                       # [empty] Completed/superseded artifacts — append only
│
├── src/                            # [planned] Source — replace with actual project structure
│   └── features/                   # Feature-first grouping (AGENT.md §05.1)
│       └── [feature-name]/
│           ├── [Feature].jsx       # UI shell
│           ├── [feature].logic.js  # Business logic — isolated
│           ├── [feature].styles.css# Scoped styles
│           └── [feature].schema.js # Local data contracts
│
└── [other project dirs]            # Fill in on first run
```

---

## Module Boundaries

> Define ownership and responsibility per module. Prevents cross-contamination.

| Module / Dir | Owner | Responsibility | Off-limits to |
|---|---|---|---|
| `docs/` | Agent (read) + Owner (approve) | Documentation system | Source logic |
| `_checkpoints/` | Agent (write-once) | Versioned rollback points | Any modification after creation |
| `output/` | Owner-approved only | Final deliverables | In-progress artifacts |
| `_archive/` | Agent (append-only) | Historical record | Deletion |
| `src/features/[name]/` | Owning feature agent | Encapsulated feature logic | Other feature modules |

---

## Dense Single-File Anatomy

> For files exceeding ~150 lines or with complex internal structure, use `docs/file-architecture.md` instead of this section.
> `project-structure.md` = directory layer. `file-architecture.md` = file-internal layer. They are complementary — do not duplicate maps across both.

*No dense single-file maps yet. Add a block in `docs/file-architecture.md` for any file exceeding ~150 lines.*

---

<!-- [H] -->
<!-- WHY: .gitignore candidates are human/Owner decisions — agent flags in Drift Report, never auto-applies -->
## .gitignore Candidates

> Agent flags — Owner decides whether to apply.
> Never auto-modify `.gitignore`. *(AGENT.md §05.4)*

| Directory | Reason | Recommended action |
|---|---|---|
| `_sandbox/` | Throwaway experiments — no production value | Add to `.gitignore` |
| `_wip/` | Active artifacts — may contain incomplete/broken states | Consider ignoring unless team-shared |
| `_temp/` | Temporary files — auto-generated | Add to `.gitignore` |
| `_checkpoints/` | Can be large; recoverable from git history | Owner decision |
<!-- [/H] -->

---

## Drift Report

> Populated by agent on each snapshot. Flags structural issues for Owner review.
> Agent proposes fixes — never silently restructures. *(AGENT.md §05.2)*

<!--
### Drift Report — [date]
**Orphaned files:**
- `path/to/file.js` — no active import reference found; candidate for _archive/

**Misplaced assets:**
- `src/utils/buttonHelper.js` — belongs in `features/button/` per feature-first grouping

**Structural drift:**
- `components/` dir has grown to 40 files — recommend splitting into feature domains

**Proposed cleanup plan:** [describe; await Owner approval before acting]
-->

*No drift detected yet.*

---

*project-structure.md v1.0.0 — Master template. Overwrite completely on each phase snapshot. Extends AGENT.md §05.3.*

<!-- ✓ AGENT:COMPLETE -->
