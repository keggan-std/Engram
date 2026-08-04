# Project State — read this first

**Generated:** 2026-08-04 · **Source:** Engram `memory.db` · **Branch:** `fr/d3-storage` @ `abb18d4`

> **Generated artifact — never hand-edit.** Produced by
> [`scripts/generate-state.mjs`](../scripts/generate-state.mjs) from Engram's own memory.
> If you find yourself editing this file, the answer is to fix the record it came from.
> A register kept by discipline is audit finding F5 repeating (observation #30).

---

## Where we are

| | |
|---|---|
| **Working branch** | `fr/d3-storage` @ `abb18d4` — docs(FR-D4): DEFERRED-CHANGES D5 was too soft — reclassified CRITICAL |
| **Published line** | `main` @ `1afe18f` — docs: v1.12.0 release notes, README Android Studio section, version bump |
| **Pushed?** | **No. This branch has no upstream — nothing has been published from it.** |
| **Uncommitted** | **3 file(s)** — `docs/STATE.md`, `docs/foundations/03-storage.md`, `tests/storage/` |
| **Store** | schema V25 · 33 sessions · 24 decisions · 87 observations · 96 file notes |

**Latest active decision — #24:** FR-D3 ADOPTED — Engram's storage is sound and its retrieval is not; the worst defect is not that memory cannot be found but that a wrong memory can be refreshed into looking current.

**Nothing is marked in progress.**

---

## Last 3 sessions

| # | Agent | Did what |
|---|---|---|
| **33** | `FR-D3-Storage` | _(in progress)_ |
| **32** | `claude-opus-5-orchestrator` | Handoff session. Created handoff #7 for the FR-D3 agent with startup friction, method notes and inherited findings. Acknowledged the two dead 2026-08-01 handoffs (#1, #2) that STATE.md says to ignore… |
| **31** | `claude-opus-5-orchestrator` | FR-D4 Concurrency & Multi-Agent domain review complete — 5 of 10 domains done. |

Summaries above are the **first sentence** of a much longer record — sessions have no
`headline` field yet (schema gap 1). Full text: `engram_session(action:"get_history")`.

---

## Open and blocked

**49 open tasks.** The ones that gate everything else:

| # | Task | State |
|---|---|---|
| **11** | MASTER PLAN: Engram direction, workspace reorganisation, and change ledger | critical · backlog |
| **33** | FR-D1 T6 — import must stop previewing what it will not do (honest dry run first, then implement) | critical · backlog |
| **34** | FR-D1 T7 — bump better-sqlite3 past the SQLite WAL-reset fix (3.51.3+) | critical · backlog |
| **35** | FR-D3 — fts_file_notes has no triggers: 94 file notes are unsearchable and nothing reports it | critical · backlog |
| **38** | FR-D2 T1 — server-resolved provenance on every memory row (author, route, trust tier) | critical · backlog |

### Handoff

**Read #7** — from `claude-opus-5-orchestrator`, 2026-08-04 (already acknowledged).
FR-D4 complete and merged (5 of 10 domains).

---

## What previous agents flagged as worth improving

Newest first. Suggestions left *for the next agent* — these are not tracked tasks.

| Obs | Kind | Flag |
|---|---|---|
| **#83** | friction | SEVENTH occurrence of the convention #7 tool-call syntax error — and this one is inside handoff #7 itself, the record whose entire purpose was to warn the next agent about it. |
| **#80** | friction | SIXTH occurrence of the convention #7 tool-call syntax error, this time by a different agent and model than the five in observation #59. |
| **#59** | friction | FIVE OCCURRENCES OF THE SAME AGENT-SIDE TOOL-CALL SYNTAX ERROR IN ONE SESSION, and the fifth corrupted the session record itself. |
| **#47** | idea | HEADLINE RECOMMENDATION - the generated capability surface. |
| **#41** | concern | COUNTER-EVIDENCE 1: A stale/frozen register is argued to be actively worse than no register because it looks authoritative while misleading readers — "Your Risk Register Is Already Dead" (2… |
| **#35** | idea | carto-src's mode-detection decision table (STEP 0: first-match-wins ordered conditions producing one of Map/Remap/Dry-run/Document-only/Skip) plus its explicit write-failure handling table… |
| **#30** | concern | CRITICAL COUNTER-ARGUMENT to "build a ledger where work signs in and off": Engram ALREADY HAD a ledger, and the ledger became the disinformation source. |
| **#29** | idea | ghostwriter's doc-scaffold.js SCAFFOLDS registry (per doc-type: ordered sections, required/optional flags, writeLast flags, dependency notes, fastMode drop list) is HIGH reusability for Eng… |

Observations have no resolved/superseded state, so "still relevant" cannot be queried —
this is newest-first, not open-only (schema gap 2). Full text:
`engram_memory(action:"get_observations")`.

---

## Where to go next

1. **This file.**
2. [`README.md`](README.md) — the documentation router.
3. [`foundations/00-CHARTER.md`](foundations/00-CHARTER.md) — the spec the review executes from.
4. `engram_memory(action:"get_file_notes")` **before opening any source file.**
   96 files are already noted — do not re-read the codebase.

<!-- PROJECT_STATE:GENERATED -->
