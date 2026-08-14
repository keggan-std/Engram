# Engram PM-Full Feature — First Live Experience Log

**Session:** #83  
**Date:** 2026-03-04  
**Feature implemented:** Instance Visibility System (Decision #34)  

---

## What We Did

Enabled PM-Full (`engram_admin({ action: "enable_pm" })`) at the start of the session, then ran a complete feature implementation cycle while using every PM-adjacent capability: task creation, decision recording, live tracking, and session bookkeeping.

---

## PM Feature Behavior Observed

### PM-Lite (always-on baseline)
PM-Lite was already active before this session. Its ambient cost is **zero tokens** — it produced no noise and no overhead. Nothing to observe differently.

### PM-Full activation
`enable_pm` returned immediately:
```json
{ "pm_full": true, "message": "PM-Full activated. Phase gates, checklists, and workflow guidance are now available." }
```
`pm_status` confirmed healthy state with `nudges_available: []` — as expected since no nudges had accumulated yet. The `failure_count: 0` confirms the isolation boundary (`pmSafe()`) had not been triggered.

### Task creation
Two tasks were created with `create_task`:
- Task #44 — Phase 1: Types & Constants (`status: backlog → done`)
- Task #45 — Phase 2: Registry Service (`status: backlog → done`)

Tasks could carry `priority`, `tags`, and `description`. The tags served as phase markers (`phase-1`, `phase-2`) which is exactly the structured PM use PM-Full is designed to detect. **If PM-Full had been active at task creation with 3+ tagged tasks, it would have triggered the auto-offer.** In this case we activated it manually first.

### Decision recording
`record_decision` returned a `similar_decisions` warning with 4 overlapping entries. This is PM-Full intelligence doing its job — it cross-referenced active decisions and flagged potential conflicts. The agent correctly reviewed them and confirmed no conflict (orthogonal feature set — visibility vs. sharing).

### `pm_status` through the session
The diagnostics tracker showed:
```
nudges_delivered: 0
nudges_available: []
failure_count: 0
```
No nudges were triggered because the workflow was clean and task-driven from the start. PM-Lite's nudge system activates on drift (e.g., working without recorded tasks, large gaps) — which didn't occur.

---

## Honest Assessment of PM-Full Value

### What worked well
1. **Task visibility** — `create_task` + `update_task` kept the agent provably on-track. Every phase had a task ID. No work was done without a corresponding task. This is the main PM-Full value proposition.
2. **Decision conflict detection** — The `similar_decisions` check on `record_decision` is a genuinely useful safety net. Found 4 related decisions and prompted a review. Caught nothing wrong this time, but in a session where a contradicting decision was about to be recorded, this would have caught it.
3. **Session bookend** — `session end` with `stats: { changes_recorded: 6, decisions_made: 1, tasks_completed: 2 }` gives a clean audit summary. Useful for handoff.

### What was neutral / not yet tested
1. **Phase gates** — Not triggered. Would activate with `phase:` tagged tasks arranged in sequence. Worth testing on a larger feature (e.g., the dashboard UI phase).
2. **Checklists** — Not invoked. PM-Full includes `get_knowledge` for PM framework KB. Not needed for this scope.
3. **Auto-detection offer** — PM-Full was manually activated, so the auto-offer behavior wasn't exercised.

### What to watch for next time
- Try a session where PM-Full is NOT manually activated, but create 3+ tasks with `phase:` tags — this should trigger the auto-offer nudge.
- Test the `generate_report` action with PM-Full to see what the project summary looks like.

---

## Interaction with the Visibility Feature

The feature itself validated the Engram memory system end-to-end:
- 6 files changed, tracked via `record_change` with accurate `impact_scope` (`global`, `cross_module`, `local`)
- Decision #34 recorded before writing code — agent followed architecture before implementation
- `get_file_notes` consumed before reading source files (confirmed by `high` confidence notes for `src/index.ts`)
- Build verified before commit (557/557 tests green, up from 551)
- Session ended with complete summary and no open tasks

The PM-Full layer added structure without friction. Zero failures, zero PM isolation boundary triggers.

---

## Verdict

PM-Full at its current implementation is a **low-overhead, high-value addition** for structured feature work. The main friction points observed:
1. `create_task` is manual — there's no auto-detection of phases from conversation context yet.
2. Nudges remained silent throughout (clean workflow), so the reactive guidance side wasn't exercised. A messier session would show its value more clearly.

**Recommended usage pattern:** Enable PM-Full at the start of any session where you know 3+ distinct tasks will be done. Leave PM-Lite always on (zero cost).
