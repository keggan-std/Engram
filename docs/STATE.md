# Project State — read this first

**Generated:** 2026-08-13 · **Source:** Engram `memory.db` · **Branch:** `v2-foundations` @ `8a623e6`

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
| **Working branch** | `v2-foundations` @ `8a623e6` — fix(FR-D9 #75): the surface gate could not read the half of the contract that lies |
| **Published line** | `main` @ `f47df04` — docs(README): two claims that would have rendered false on the npm page |
| **Pushed?** | pushed — upstream `origin/v2-foundations` |
| **Uncommitted** | clean |
| **Store** | schema V26 · 50 sessions · 51 decisions · 146 observations · 96 file notes |

**Latest active decision — #51:** Task #58 fixed by adding a fourth resolution rung: the session THIS SERVER PROCESS started.

**In progress:** #42 FR-D2 T5/T7 — correct the 19 drifted security claims, write down the refusals, gate the claim text

---

## Last 3 sessions

| # | Agent | Did what |
|---|---|---|
| **50** | `claude-opus-5-session-50` | _(in progress)_ |
| **49** | `claude-opus-5-session-49` | Board 70 to 54 open: 16 rows closed, 10 already-shipped. |
| **48** | `claude-opus-5-session-48` | Closed #59 and #99, fixed two cold-start races, an IDE misdetection reported live, and a write-integrity blind spot. |

Summaries above are the **first sentence** of a much longer record — sessions have no
`headline` field yet (schema gap 1). Full text: `engram_session(action:"get_history")`.

---

## Open and blocked

**48 open tasks.** The ones that gate everything else:

| # | Task | State |
|---|---|---|
| **42** | FR-D2 T5/T7 — correct the 19 drifted security claims, write down the refusals, gate the claim text | **in progress** |
| **38** | FR-D2 T1 — server-resolved provenance on every memory row (author, route, trust tier) | critical · backlog |
| **40** | FR-D2 T2 — trust tier gates the session-start replay (blocked on T1) | critical · backlog |
| **69** | FR-D7 T2 — every CRITICAL agent rule gets a mechanism or is deleted; AR-01 measures 21.1 percent | critical · backlog |
| **71** | FR-D7 T1 — one flattened schema advertises 79 optional parameters for actions that accept one | critical · backlog |
| **98** | MASTER PLAN item 3 — the 2026-09-16 advisory decision: publish, or record the extension as a decision | critical · backlog |

### Handoff

**Read #23** — from `claude-opus-5-session-49`, 2026-08-12 (already acknowledged).
Session 49: board 70 to 54 open, 16 rows closed, four durability/retrieval defects fixed.

---

## What previous agents flagged as worth improving

Newest first. Suggestions left *for the next agent* — these are not tracked tasks.

| Obs | Kind | Flag |
|---|---|---|
| **#144** | concern | MEASURED session 48: convention #7's ordering rule is NOT sufficient. |
| **#142** | friction | FOUND 2026-08-12, session 47, while adding e2e coverage for task #108. |
| **#140** | idea | ROO CODE MAY BE A DISCONTINUED PRODUCT THAT THE REGISTRY STILL FULLY SUPPORTS. |
| **#139** | concern | THE TEST TYPECHECK HAS BEEN RED FOR SOME TIME AND NOTHING NOTICES. |
| **#136** | concern | A FULL-SUITE RUN FAILED 2 TESTS ON 2026-08-10 AND I DESTROYED THE EVIDENCE IN THE SAME COMMAND THAT PRODUCED IT. |
| **#135** | concern | TWO INERT-SURFACE INSTANCES IN THE TEST LAYER ITSELF, plus one operational hazard the session created and did not fully clean up. |
| **#132** | concern | THE STATE.md FRESHNESS GATE CANNOT REACH EXIT 0 ONCE STATE.md IS COMMITTED, SO ITS ALARM IS PERMANENTLY ON. |
| **#122** | concern | tests/durability/backup-restore.test.ts failed once under full-suite parallel load and passes reliably in isolation. |

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
