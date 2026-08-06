# Project State — read this first

**Generated:** 2026-08-06 · **Source:** Engram `memory.db` · **Branch:** `v2-foundations` @ `1128a1c`

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
| **Working branch** | `v2-foundations` @ `1128a1c` — fix(Phase 3): the router's own binding was blind to the sentence it was written for |
| **Published line** | `main` @ `1afe18f` — docs: v1.12.0 release notes, README Android Studio section, version bump |
| **Pushed?** | **No. This branch has no upstream — nothing has been published from it.** |
| **Uncommitted** | clean |
| **Store** | schema V25 · 42 sessions · 35 decisions · 125 observations · 96 file notes |

**Latest active decision — #35:** docs/README.md is now bound by tests/process/docs-router.test.ts.

**In progress:** #49 FR-D5 T7 — rollback needs a channel that is not a version bump; merge main into the review line first

---

## Last 3 sessions

| # | Agent | Did what |
|---|---|---|
| **42** | `claude-opus-5-session-42` | THE DOCUMENTATION ROUTER IS BOUND — AND FIVE OF TEN COMPLETED DOMAIN DOCS WERE UNREACHABLE FROM IT. |
| **41** | `claude-opus-5-session-40` | CHARTER PHASE 3 OPENED — CLAUDE.md exists at the repo root, is bound by a test, and is registered as recall channel 4. |
| **40** | `claude-opus-5-session-40` | (auto-closed: new session started) |

Summaries above are the **first sentence** of a much longer record — sessions have no
`headline` field yet (schema gap 1). Full text: `engram_session(action:"get_history")`.

---

## Open and blocked

**71 open tasks.** The ones that gate everything else:

| # | Task | State |
|---|---|---|
| **49** | FR-D5 T7 — rollback needs a channel that is not a version bump; merge main into the review line first | **in progress** |
| **11** | MASTER PLAN: Engram direction, workspace reorganisation, and change ledger | critical · backlog |
| **33** | FR-D1 T6 — import must stop previewing what it will not do (honest dry run first, then implement) | critical · backlog |
| **34** | FR-D1 T7 — bump better-sqlite3 past the SQLite WAL-reset fix (3.51.3+) | critical · backlog |
| **35** | FR-D3 — fts_file_notes has no triggers: 94 file notes are unsearchable and nothing reports it | critical · backlog |
| **38** | FR-D2 T1 — server-resolved provenance on every memory row (author, route, trust tier) | critical · backlog |

### Handoff

**Read #16** — from `claude-opus-5-session-42`, 2026-08-06 — **not yet acknowledged**.
Phase 3 second artifact: docs/README.md is bound.

---

## What previous agents flagged as worth improving

Newest first. Suggestions left *for the next agent* — these are not tracked tasks.

| Obs | Kind | Flag |
|---|---|---|
| **#122** | concern | tests/durability/backup-restore.test.ts failed once under full-suite parallel load and passes reliably in isolation. |
| **#121** | friction | MEASURED — two of Engram's most-called read surfaces overflow a tool result, and one of them does it in its documented "compact" mode. |
| **#116** | friction | THIRD RECURRENCE OF THE CLOSING-DISCIPLINE GAP, and this one was load-bearing. |
| **#108** | concern | SUPPRESSION ARM 2 LEAKED THROUGH THREE CHANNELS, not one. |
| **#107** | concern | WHY SO MUCH RECALL WAS REPLACEABLE — the judges' own reason, and it is a limit on the whole experiment. |
| **#101** | friction | TENTH OCCURRENCE of the convention #7 tool-call syntax corruption — committed by me, FR-D10, on my second Engram write, in the session whose domain doc is about records that lie to readers. |
| **#100** | idea | FR-D10 PRE-REGISTERED PREDICTIONS — five, with a fixed scoring rule, written before any public-surface file was opened and before either delegate was launched. |
| **#99** | concern | FR-D8 SUPPRESSION ARM — the control leaked, in two ways neither charter §10.4 nor decision #25 anticipated. |

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
