# Project State — read this first

**Generated:** 2026-08-03 · **Source:** Engram `memory.db` · **Branch:** `fr/0g-state-register` @ `c0bc0e8`

> **Generated artifact — never hand-edit.** Produced by
> [`scripts/generate-state.mjs`](../scripts/generate-state.mjs) from Engram's own memory.
> If you find yourself editing this file, the answer is to fix the record it came from.
> A register kept by discipline is audit finding F5 repeating (observation #30).

---

## Where we are

| | |
|---|---|
| **Working branch** | `fr/0g-state-register` @ `c0bc0e8` — chore(FR-0g): close out session 16 — handoff #5, final state |
| **Published line** | `main` @ `1afe18f` — docs: v1.12.0 release notes, README Android Studio section, version bump |
| **Pushed?** | **No. This branch has no upstream — nothing has been published from it.** |
| **Uncommitted** | **4 file(s)** — `.github/workflows/ci.yml`, `package.json`, `docs/HTTP-SURFACE.md`, `scripts/generate-http-surface.mjs` |
| **Store** | schema V25 · 17 sessions · 19 decisions · 60 observations · 94 file notes |

**Latest active decision — #19:** NO RELEASE until the master plan is drafted and solidified.

**In progress:** #26 FR-0f: Working-rules setup — golden fixture, branch split, cherry-pick check

---

## Last 3 sessions

| # | Agent | Did what |
|---|---|---|
| **17** | `interface-surface-agent` | _(in progress)_ |
| **16** | `cherry-pick-verifier` | Verified the tripwire's emergency path, then built the agent-orientation register the operator asked for and fixed the rot it exposed. |
| **15** | `agent_name` ⚠️ | Completed Phase 0 of the Foundations Review and set the direction for everything after it. |

⚠️ A session is recorded under the literal placeholder `"agent_name"`. Attribution in the
table this register is built on is already polluted — Engram schema gap 4, observation #54.

Summaries above are the **first sentence** of a much longer record — sessions have no
`headline` field yet (schema gap 1). Full text: `engram_session(action:"get_history")`.

---

## Open and blocked

**19 open tasks.** The ones that gate everything else:

| # | Task | State |
|---|---|---|
| **26** | FR-0f: Working-rules setup — golden fixture, branch split, cherry-pick check | **in progress** |
| **11** | MASTER PLAN: Engram direction, workspace reorganisation, and change ledger | critical · backlog |
| **16** | FR-D1: Durability & Recovery review | critical · backlog |
| **17** | FR-D2: Trust & Safety review | critical · backlog |
| **6** | P1-1: Port dropped validation from the 15 dead tool files, then delete them | high · backlog |
| **7** | P1-2: Add a migration upgrade-path test (data survives v1 -> v24) | high · backlog |

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
   94 files are already noted — do not re-read the codebase.

<!-- PROJECT_STATE:GENERATED -->
