# Project State — read this first

**Generated:** 2026-08-04 · **Source:** Engram `memory.db` · **Branch:** `v2-foundations` @ `4b8f883`

> **Generated artifact — never hand-edit.** Produced by
> [`scripts/generate-state.mjs`](../scripts/generate-state.mjs) from Engram's own memory.
> If you find yourself editing this file, the answer is to fix the record it came from.
> A register kept by discipline is audit finding F5 repeating (observation #30).

---

## Where we are

| | |
|---|---|
| **Working branch** | `v2-foundations` @ `4b8f883` — merge(FR-D4): concurrency & multi-agent — 5 of 10 domains complete |
| **Published line** | `main` @ `1afe18f` — docs: v1.12.0 release notes, README Android Studio section, version bump |
| **Pushed?** | **No. This branch has no upstream — nothing has been published from it.** |
| **Uncommitted** | **1 file(s)** — `docs/DEFERRED-CHANGES.md` |
| **Store** | schema V25 · 31 sessions · 23 decisions · 80 observations · 96 file notes |

**Latest active decision — #23:** FR-D4 ADOPTED — Engram has exactly one correct coordination primitive, and it is the only one the product does not depend on.

**Nothing is marked in progress.**

---

## Last 3 sessions

| # | Agent | Did what |
|---|---|---|
| **31** | `claude-opus-5-orchestrator` | _(in progress)_ |
| **30** | `claude-opus-5-orchestrator` | (auto-closed: new session started) |
| **29** | `d6-priorart-agent` | FR-D6 external prior-art research (charter §3b). |

Summaries above are the **first sentence** of a much longer record — sessions have no
`headline` field yet (schema gap 1). Full text: `engram_session(action:"get_history")`.

---

## Open and blocked

**44 open tasks.** The ones that gate everything else:

| # | Task | State |
|---|---|---|
| **11** | MASTER PLAN: Engram direction, workspace reorganisation, and change ledger | critical · backlog |
| **33** | FR-D1 T6 — import must stop previewing what it will not do (honest dry run first, then implement) | critical · backlog |
| **34** | FR-D1 T7 — bump better-sqlite3 past the SQLite WAL-reset fix (3.51.3+) | critical · backlog |
| **35** | FR-D3 — fts_file_notes has no triggers: 94 file notes are unsearchable and nothing reports it | critical · backlog |
| **38** | FR-D2 T1 — server-resolved provenance on every memory row (author, route, trust tier) | critical · backlog |

### Handoff

**Read #6** — from `fr-lead`, 2026-08-04 — **not yet acknowledged**.
FR-D6 complete and merged. Next session starts FR-D4 Concurrency & Multi-Agent.

⚠️ **2 older handoffs still show as pending and should be ignored:** #2 (`opus5-pm-infra`, 2026-08-01), #1 (`opus5-deep-audit`, 2026-08-01).

They were never acknowledged, so they surface at every session start alongside the live
one, as though equally current. Handoffs do not supersede each other — Engram schema
gap 3, observation #54.

---

## What previous agents flagged as worth improving

Newest first. Suggestions left *for the next agent* — these are not tracked tasks.

| Obs | Kind | Flag |
|---|---|---|
| **#80** | friction | SIXTH occurrence of the convention #7 tool-call syntax error, this time by a different agent and model than the five in observation #59. |
| **#59** | friction | FIVE OCCURRENCES OF THE SAME AGENT-SIDE TOOL-CALL SYNTAX ERROR IN ONE SESSION, and the fifth corrupted the session record itself. |
| **#47** | idea | HEADLINE RECOMMENDATION - the generated capability surface. |
| **#41** | concern | COUNTER-EVIDENCE 1: A stale/frozen register is argued to be actively worse than no register because it looks authoritative while misleading readers — "Your Risk Register Is Already Dead" (2… |
| **#35** | idea | carto-src's mode-detection decision table (STEP 0: first-match-wins ordered conditions producing one of Map/Remap/Dry-run/Document-only/Skip) plus its explicit write-failure handling table… |
| **#30** | concern | CRITICAL COUNTER-ARGUMENT to "build a ledger where work signs in and off": Engram ALREADY HAD a ledger, and the ledger became the disinformation source. |
| **#29** | idea | ghostwriter's doc-scaffold.js SCAFFOLDS registry (per doc-type: ordered sections, required/optional flags, writeLast flags, dependency notes, fastMode drop list) is HIGH reusability for Eng… |
| **#28** | concern | CONCERN / capability-surface overlap: the skill "tracer" (root-cause debugging playbook, no data structures) shares its core word "trace" with completely unrelated Engram-ecosystem MCP tool… |

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
