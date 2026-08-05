# Project State — read this first

**Generated:** 2026-08-05 · **Source:** Engram `memory.db` · **Branch:** `v2-foundations` @ `730b4a2`

> **Generated artifact — never hand-edit.** Produced by
> [`scripts/generate-state.mjs`](../scripts/generate-state.mjs) from Engram's own memory.
> If you find yourself editing this file, the answer is to fix the record it came from.
> A register kept by discipline is audit finding F5 repeating (observation #30).

---

## Where we are

| | |
|---|---|
| **Working branch** | `v2-foundations` @ `730b4a2` — merge(FR-D10): public surface — all 10 domains complete |
| **Published line** | `main` @ `1afe18f` — docs: v1.12.0 release notes, README Android Studio section, version bump |
| **Pushed?** | **No. This branch has no upstream — nothing has been published from it.** |
| **Uncommitted** | clean |
| **Store** | schema V25 · 37 sessions · 29 decisions · 108 observations · 96 file notes |

**Latest active decision — #29:** FR-D10 ADOPTED — bind the public surface with referential-integrity tests, and split the false denial in SECURITY.md from the disclosure decision it was accidentally bundled with.

**Nothing is marked in progress.**

---

## Last 3 sessions

| # | Agent | Did what |
|---|---|---|
| **37** | `FR-D10-PublicSurface` | _(in progress)_ |
| **36** | `FR-D8-CodebaseMaintainability` | FR-D8 Codebase and Maintainability complete and merged into v2-foundations — 9 of 10 domains done. |
| **35** | `FR-D9-ProcessTraceability` | FR-D9 Process and Traceability complete and merged — 8 of 10 domains. |

Summaries above are the **first sentence** of a much longer record — sessions have no
`headline` field yet (schema gap 1). Full text: `engram_session(action:"get_history")`.

---

## Open and blocked

**73 open tasks.** The ones that gate everything else:

| # | Task | State |
|---|---|---|
| **11** | MASTER PLAN: Engram direction, workspace reorganisation, and change ledger | critical · backlog |
| **33** | FR-D1 T6 — import must stop previewing what it will not do (honest dry run first, then implement) | critical · backlog |
| **34** | FR-D1 T7 — bump better-sqlite3 past the SQLite WAL-reset fix (3.51.3+) | critical · backlog |
| **35** | FR-D3 — fts_file_notes has no triggers: 94 file notes are unsearchable and nothing reports it | critical · backlog |
| **38** | FR-D2 T1 — server-resolved provenance on every memory row (author, route, trust tier) | critical · backlog |

### Handoff

**Read #12** — from `FR-D10-PublicSurface`, 2026-08-05 — **not yet acknowledged**.
FR-D10 complete and merged. All 10 domains done — Phase 1 is finished. Next is Phase 2, the master plan (task #11).

⚠️ **1 older handoff still shows as pending and should be ignored:** #11 (`FR-D8-CodebaseMaintainability`, 2026-08-05).

They were never acknowledged, so they surface at every session start alongside the live
one, as though equally current. Handoffs do not supersede each other — Engram schema
gap 3, observation #54.

---

## What previous agents flagged as worth improving

Newest first. Suggestions left *for the next agent* — these are not tracked tasks.

| Obs | Kind | Flag |
|---|---|---|
| **#108** | concern | SUPPRESSION ARM 2 LEAKED THROUGH THREE CHANNELS, not one. |
| **#107** | concern | WHY SO MUCH RECALL WAS REPLACEABLE — the judges' own reason, and it is a limit on the whole experiment. |
| **#101** | friction | TENTH OCCURRENCE of the convention #7 tool-call syntax corruption — committed by me, FR-D10, on my second Engram write, in the session whose domain doc is about records that lie to readers. |
| **#100** | idea | FR-D10 PRE-REGISTERED PREDICTIONS — five, with a fixed scoring rule, written before any public-surface file was opened and before either delegate was launched. |
| **#99** | concern | FR-D8 SUPPRESSION ARM — the control leaked, in two ways neither charter §10.4 nor decision #25 anticipated. |
| **#97** | idea | FR-D8 PRE-REGISTERED PREDICTIONS — written before any dead-code run, any delegation, and before opening src/tools/dispatcher-memory.ts. |
| **#89** | concern | FR-D7 T7, handed to FR-D9 which owns the anti-drift machinery. |
| **#88** | friction | NINTH occurrence of the convention #7 corruption, on FR-D7's FIRST Engram write of the session, by an agent who had read handoff #8's warning about it minutes earlier and had explicitly res… |

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
