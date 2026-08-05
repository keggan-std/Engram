# Project State — read this first

**Generated:** 2026-08-05 · **Source:** Engram `memory.db` · **Branch:** `v2-foundations` @ `5cd4a20`

> **Generated artifact — never hand-edit.** Produced by
> [`scripts/generate-state.mjs`](../scripts/generate-state.mjs) from Engram's own memory.
> If you find yourself editing this file, the answer is to fix the record it came from.
> A register kept by discipline is audit finding F5 repeating (observation #30).

> ⚠️ **This file IS Engram recall.** It is generated *from* the store, so reading it
> delivers decisions, sessions, tasks and observations into your context — even if you
> never call a recall action. **If you are running a suppressed arm of the charter §10
> experiment, you have just been contaminated; record it.** Both pre-registered arms
> leaked through this file before anyone noticed. See
> [`foundations/00-CHARTER.md`](foundations/00-CHARTER.md) §10.4a.

---

## Where we are

| | |
|---|---|
| **Working branch** | `v2-foundations` @ `5cd4a20` — merge(Phase 2): item 0 landed, Release A assembled and verified |
| **Published line** | `main` @ `1afe18f` — docs: v1.12.0 release notes, README Android Studio section, version bump |
| **Pushed?** | **No. This branch has no upstream — nothing has been published from it.** |
| **Uncommitted** | clean |
| **Store** | schema V25 · 39 sessions · 33 decisions · 119 observations · 96 file notes |

**Latest active decision — #33:** RELEASE A IS 1.13.0, NOT 1.12.1 — assembled, verified, not published.

**In progress:** #49 FR-D5 T7 — rollback needs a channel that is not a version bump; merge main into the review line first

---

## Last 3 sessions

| # | Agent | Did what |
|---|---|---|
| **39** | `FR-Phase2-Item0` | ITEM 0 LANDED AND RELEASE A IS ASSEMBLED AND VERIFIED, unpushed and unpublished. |
| **38** | `FR-Phase2-MasterPlan` | Phase 2 complete — docs/ENGRAM-MASTER-PLAN.md written, decision #30, merged to v2-foundations at e35cedb. |
| **37** | `FR-D10-PublicSurface` | FR-D10 Public Surface complete and merged into v2-foundations — ALL 10 DOMAINS DONE, Phase 1 finished. |

Summaries above are the **first sentence** of a much longer record — sessions have no
`headline` field yet (schema gap 1). Full text: `engram_session(action:"get_history")`.

---

## Open and blocked

**70 open tasks.** The ones that gate everything else:

| # | Task | State |
|---|---|---|
| **49** | FR-D5 T7 — rollback needs a channel that is not a version bump; merge main into the review line first | **in progress** |
| **11** | MASTER PLAN: Engram direction, workspace reorganisation, and change ledger | critical · backlog |
| **33** | FR-D1 T6 — import must stop previewing what it will not do (honest dry run first, then implement) | critical · backlog |
| **34** | FR-D1 T7 — bump better-sqlite3 past the SQLite WAL-reset fix (3.51.3+) | critical · backlog |
| **35** | FR-D3 — fts_file_notes has no triggers: 94 file notes are unsearchable and nothing reports it | critical · backlog |
| **38** | FR-D2 T1 — server-resolved provenance on every memory row (author, route, trust tier) | critical · backlog |

### Handoff

**Read #14** — from `FR-Phase2-Item0`, 2026-08-05 — **not yet acknowledged**.
Item 0 landed and Release A is assembled and verified on release/1.13.0.

---

## What previous agents flagged as worth improving

Newest first. Suggestions left *for the next agent* — these are not tracked tasks.

| Obs | Kind | Flag |
|---|---|---|
| **#116** | friction | THIRD RECURRENCE OF THE CLOSING-DISCIPLINE GAP, and this one was load-bearing. |
| **#108** | concern | SUPPRESSION ARM 2 LEAKED THROUGH THREE CHANNELS, not one. |
| **#107** | concern | WHY SO MUCH RECALL WAS REPLACEABLE — the judges' own reason, and it is a limit on the whole experiment. |
| **#101** | friction | TENTH OCCURRENCE of the convention #7 tool-call syntax corruption — committed by me, FR-D10, on my second Engram write, in the session whose domain doc is about records that lie to readers. |
| **#100** | idea | FR-D10 PRE-REGISTERED PREDICTIONS — five, with a fixed scoring rule, written before any public-surface file was opened and before either delegate was launched. |
| **#99** | concern | FR-D8 SUPPRESSION ARM — the control leaked, in two ways neither charter §10.4 nor decision #25 anticipated. |
| **#97** | idea | FR-D8 PRE-REGISTERED PREDICTIONS — written before any dead-code run, any delegation, and before opening src/tools/dispatcher-memory.ts. |
| **#89** | concern | FR-D7 T7, handed to FR-D9 which owns the anti-drift machinery. |

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
