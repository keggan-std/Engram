# Project State — read this first

**Generated:** 2026-08-11 · **Source:** Engram `memory.db` · **Branch:** `v2-foundations` @ `1a2291e`

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
| **Working branch** | `v2-foundations` @ `1a2291e` — docs: what a global install actually means, and the Antigravity path both docs also had wrong |
| **Published line** | `main` @ `f47df04` — docs(README): two claims that would have rendered false on the npm page |
| **Pushed?** | pushed — upstream `origin/v2-foundations` |
| **Uncommitted** | **1 file(s)** — `docs/STATE.md` |
| **Store** | schema V26 · 46 sessions · 44 decisions · 140 observations · 96 file notes |

**Latest active decision — #44:** Installer discovery is LOCAL-FIRST with a bounded climb (default 4 parents, stopping at the project root), every install is recorded in a machine-wide ledger at ~/.engram/installs.json unless --isolated, and no interactive local install wr…

**In progress:** #42 FR-D2 T5/T7 — correct the 19 drifted security claims, write down the refusals, gate the claim text

---

## Last 3 sessions

| # | Agent | Did what |
|---|---|---|
| **46** | `claude-opus-5-session-46` | Rebuilt installer discovery around the question a user actually asks, answered the global-memory architecture question from source, and found a shipped IDE integration that had never worked. |
| **45** | `claude-opus-5-session-45` | Cleared the 2026-08-07 handoff's outstanding list and found a shipped command that had been crashing every time it ran. |
| **44** | `claude-opus-5-session-44` | Published v1.13.0 to npm and cleared three open defects off v2-foundations so the branch could push clean. |

Summaries above are the **first sentence** of a much longer record — sessions have no
`headline` field yet (schema gap 1). Full text: `engram_session(action:"get_history")`.

---

## Open and blocked

**75 open tasks.** The ones that gate everything else:

| # | Task | State |
|---|---|---|
| **42** | FR-D2 T5/T7 — correct the 19 drifted security claims, write down the refusals, gate the claim text | **in progress** |
| **11** | MASTER PLAN: Engram direction, workspace reorganisation, and change ledger | critical · backlog |
| **33** | FR-D1 T6 — import must stop previewing what it will not do (honest dry run first, then implement) | critical · backlog |
| **38** | FR-D2 T1 — server-resolved provenance on every memory row (author, route, trust tier) | critical · backlog |
| **40** | FR-D2 T2 — trust tier gates the session-start replay (blocked on T1) | critical · backlog |
| **50** | FR-D6 CRITICAL — HTTP /export claims "all data", ships 5 of 24 tables, filtered, capped, stamped 1.9.0 | critical · backlog |

### Handoff

**Read #20** — from `claude-opus-5-session-46`, 2026-08-11 — **not yet acknowledged**.
Session 46: installer discovery, install plan and ledger shipped; the global-memory question answered as decision #43 and docs/memory-topology.md; Antigravity proven broken and fixed.

---

## What previous agents flagged as worth improving

Newest first. Suggestions left *for the next agent* — these are not tracked tasks.

| Obs | Kind | Flag |
|---|---|---|
| **#140** | idea | ROO CODE MAY BE A DISCONTINUED PRODUCT THAT THE REGISTRY STILL FULLY SUPPORTS. |
| **#139** | concern | THE TEST TYPECHECK HAS BEEN RED FOR SOME TIME AND NOTHING NOTICES. |
| **#136** | concern | A FULL-SUITE RUN FAILED 2 TESTS ON 2026-08-10 AND I DESTROYED THE EVIDENCE IN THE SAME COMMAND THAT PRODUCED IT. |
| **#135** | concern | TWO INERT-SURFACE INSTANCES IN THE TEST LAYER ITSELF, plus one operational hazard the session created and did not fully clean up. |
| **#132** | concern | THE STATE.md FRESHNESS GATE CANNOT REACH EXIT 0 ONCE STATE.md IS COMMITTED, SO ITS ALARM IS PERMANENTLY ON. |
| **#122** | concern | tests/durability/backup-restore.test.ts failed once under full-suite parallel load and passes reliably in isolation. |
| **#121** | friction | MEASURED — two of Engram's most-called read surfaces overflow a tool result, and one of them does it in its documented "compact" mode. |
| **#116** | friction | THIRD RECURRENCE OF THE CLOSING-DISCIPLINE GAP, and this one was load-bearing. |

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
