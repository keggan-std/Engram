# Project State — read this first

**Generated:** 2026-08-04 · **Source:** Engram `memory.db` · **Branch:** `fr/d5-distribution` @ `0b83d34`

> **Generated artifact — never hand-edit.** Produced by
> [`scripts/generate-state.mjs`](../scripts/generate-state.mjs) from Engram's own memory.
> If you find yourself editing this file, the answer is to fix the record it came from.
> A register kept by discipline is audit finding F5 repeating (observation #30).

---

## Where we are

| | |
|---|---|
| **Working branch** | `fr/d5-distribution` @ `0b83d34` — merge(FR-D2): trust & safety domain — 19 of 32 security claims wrong, provenance actively wrong |
| **Published line** | `main` @ `1afe18f` — docs: v1.12.0 release notes, README Android Studio section, version bump |
| **Pushed?** | **No. This branch has no upstream — nothing has been published from it.** |
| **Uncommitted** | **3 file(s)** — `src/installer/config-writer.ts`, `docs/foundations/05-distribution.md`, `tests/installer/config-write-safety.test.ts` |
| **Store** | schema V25 · 23 sessions · 20 decisions · 75 observations · 96 file notes |

**Latest active decision — #20:** FR-D1 T1 ADOPTED AND SHIPPED: restore validates, closes, deletes main+wal+shm together, copies, reopens.

**Nothing is marked in progress.**

---

## Last 3 sessions

| # | Agent | Did what |
|---|---|---|
| **23** | `d5-priorart-agent` | FR-D5 external prior-art research (no repo reading). |
| **22** | `d5-publish-agent` | FR-D5 publish-surface map complete. Full findings in observation #73 (finding). Tarball verified via npm pack --dry-run --ignore-scripts: 367 files / 1.60 MB unpacked, files:["dist/"] whitelist is cl… |
| **21** | `d5-install-agent` | FR-D5 task #45: mapped the install surface across all 14 IDEs. |

Summaries above are the **first sentence** of a much longer record — sessions have no
`headline` field yet (schema gap 1). Full text: `engram_session(action:"get_history")`.

---

## Open and blocked

**39 open tasks.** The ones that gate everything else:

| # | Task | State |
|---|---|---|
| **11** | MASTER PLAN: Engram direction, workspace reorganisation, and change ledger | critical · backlog |
| **16** | FR-D1: Durability & Recovery review | critical · backlog |
| **17** | FR-D2: Trust & Safety review | critical · backlog |
| **33** | FR-D1 T6 — import must stop previewing what it will not do (honest dry run first, then implement) | critical · backlog |
| **34** | FR-D1 T7 — bump better-sqlite3 past the SQLite WAL-reset fix (3.51.3+) | critical · backlog |

### Handoff

**Read #5** — from `cherry-pick-verifier`, 2026-08-03 (already acknowledged).
FR-0f and FR-0g setup work complete; IDE restarting to load the new PreToolUse hook.

⚠️ **2 older handoffs still show as pending and should be ignored:** #2 (`opus5-pm-infra`, 2026-08-01), #1 (`opus5-deep-audit`, 2026-08-01).

They were never acknowledged, so they surface at every session start alongside the live
one, as though equally current. Handoffs do not supersede each other — Engram schema
gap 3, observation #54.

---

## What previous agents flagged as worth improving

Newest first. Suggestions left *for the next agent* — these are not tracked tasks.

| Obs | Kind | Flag |
|---|---|---|
| **#59** | friction | FIVE OCCURRENCES OF THE SAME AGENT-SIDE TOOL-CALL SYNTAX ERROR IN ONE SESSION, and the fifth corrupted the session record itself. |
| **#47** | idea | HEADLINE RECOMMENDATION - the generated capability surface. |
| **#41** | concern | COUNTER-EVIDENCE 1: A stale/frozen register is argued to be actively worse than no register because it looks authoritative while misleading readers — "Your Risk Register Is Already Dead" (2… |
| **#35** | idea | carto-src's mode-detection decision table (STEP 0: first-match-wins ordered conditions producing one of Map/Remap/Dry-run/Document-only/Skip) plus its explicit write-failure handling table… |
| **#30** | concern | CRITICAL COUNTER-ARGUMENT to "build a ledger where work signs in and off": Engram ALREADY HAD a ledger, and the ledger became the disinformation source. |
| **#29** | idea | ghostwriter's doc-scaffold.js SCAFFOLDS registry (per doc-type: ordered sections, required/optional flags, writeLast flags, dependency notes, fastMode drop list) is HIGH reusability for Eng… |
| **#28** | concern | CONCERN / capability-surface overlap: the skill "tracer" (root-cause debugging playbook, no data structures) shares its core word "trace" with completely unrelated Engram-ecosystem MCP tool… |
| **#26** | idea | carto-src's "Last Remap Diff" block (single mutable entry, replaced on every remap, prefix language + / ~ / - / ✓ for added/updated/removed/unchanged) is a MEDIUM-reusability pattern: Engra… |

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
