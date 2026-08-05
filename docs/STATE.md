# Project State — read this first

**Generated:** 2026-08-05 · **Source:** Engram `memory.db` · **Branch:** `v2-foundations` @ `43bc4cf`

> **Generated artifact — never hand-edit.** Produced by
> [`scripts/generate-state.mjs`](../scripts/generate-state.mjs) from Engram's own memory.
> If you find yourself editing this file, the answer is to fix the record it came from.
> A register kept by discipline is audit finding F5 repeating (observation #30).

---

## Where we are

| | |
|---|---|
| **Working branch** | `v2-foundations` @ `43bc4cf` — merge(FR-D8): codebase & maintainability — 9 of 10 domains complete |
| **Published line** | `main` @ `1afe18f` — docs: v1.12.0 release notes, README Android Studio section, version bump |
| **Pushed?** | **No. This branch has no upstream — nothing has been published from it.** |
| **Uncommitted** | clean |
| **Store** | schema V25 · 36 sessions · 28 decisions · 99 observations · 96 file notes |

**Latest active decision — #28:** FR-D8 ADOPTED — aim the mechanism at Law 1 only: a raw-SQL ratchet, a frozen dead-code inventory, and a repaired knip gate; no linter, no 91-site refactor.

**Nothing is marked in progress.**

---

## Last 3 sessions

| # | Agent | Did what |
|---|---|---|
| **36** | `FR-D8-CodebaseMaintainability` | FR-D8 Codebase and Maintainability complete and merged into v2-foundations — 9 of 10 domains done. |
| **35** | `FR-D9-ProcessTraceability` | FR-D9 Process and Traceability complete and merged — 8 of 10 domains. |
| **34** | `FR-D7-AgentErgonomics` | FR-D7 Agent Ergonomics complete and merged — 7 of 10 domains. |

Summaries above are the **first sentence** of a much longer record — sessions have no
`headline` field yet (schema gap 1). Full text: `engram_session(action:"get_history")`.

---

## Open and blocked

**64 open tasks.** The ones that gate everything else:

| # | Task | State |
|---|---|---|
| **11** | MASTER PLAN: Engram direction, workspace reorganisation, and change ledger | critical · backlog |
| **33** | FR-D1 T6 — import must stop previewing what it will not do (honest dry run first, then implement) | critical · backlog |
| **34** | FR-D1 T7 — bump better-sqlite3 past the SQLite WAL-reset fix (3.51.3+) | critical · backlog |
| **35** | FR-D3 — fts_file_notes has no triggers: 94 file notes are unsearchable and nothing reports it | critical · backlog |
| **38** | FR-D2 T1 — server-resolved provenance on every memory row (author, route, trust tier) | critical · backlog |

### Handoff

**Read #11** — from `FR-D8-CodebaseMaintainability`, 2026-08-05 — **not yet acknowledged**.
FR-D8 Codebase and Maintainability complete and merged into v2-foundations — 9 of 10 domains done.

---

## What previous agents flagged as worth improving

Newest first. Suggestions left *for the next agent* — these are not tracked tasks.

| Obs | Kind | Flag |
|---|---|---|
| **#99** | concern | FR-D8 SUPPRESSION ARM — the control leaked, in two ways neither charter §10.4 nor decision #25 anticipated. |
| **#97** | idea | FR-D8 PRE-REGISTERED PREDICTIONS — written before any dead-code run, any delegation, and before opening src/tools/dispatcher-memory.ts. |
| **#89** | concern | FR-D7 T7, handed to FR-D9 which owns the anti-drift machinery. |
| **#88** | friction | NINTH occurrence of the convention #7 corruption, on FR-D7's FIRST Engram write of the session, by an agent who had read handoff #8's warning about it minutes earlier and had explicitly res… |
| **#83** | friction | SEVENTH occurrence of the convention #7 tool-call syntax error — and this one is inside handoff #7 itself, the record whose entire purpose was to warn the next agent about it. |
| **#80** | friction | SIXTH occurrence of the convention #7 tool-call syntax error, this time by a different agent and model than the five in observation #59. |
| **#59** | friction | FIVE OCCURRENCES OF THE SAME AGENT-SIDE TOOL-CALL SYNTAX ERROR IN ONE SESSION, and the fifth corrupted the session record itself. |
| **#47** | idea | HEADLINE RECOMMENDATION - the generated capability surface. |

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
