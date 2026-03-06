# PM Framework v1.10.0 — Full Feature Reference

**Shipped in:** Engram v1.10.0 (March 4, 2026)  
**Implementation plan:** [pm-framework-integration-plan-v2.md](./pm-framework-integration-plan-v2.md)  
**Status:** ✅ Complete (Steps 0–9)

---

## Architecture Overview

The PM framework is a two-level system built entirely on top of existing Engram infrastructure. Every PM code path runs through the `pmSafe()` isolation boundary — PM failures **never** affect core Engram operations.

```
┌─────────────────────────────────────────────────────────────────┐
│  Session Layer (MCP request/response)                           │
│  ├── WorkflowAdvisorService  (session-scoped nudge engine)     │
│  └── EventTriggerService     (phase gate auto-scheduling)      │
├─────────────────────────────────────────────────────────────────┤
│  Tool Layer                                                      │
│  ├── dispatcher-memory.ts → get_knowledge                       │
│  └── dispatcher-admin.ts  → 7 PM admin actions                 │
├─────────────────────────────────────────────────────────────────┤
│  Knowledge Base (src/knowledge/)                                │
│  ├── principles.ts    5 core PM principles                      │
│  ├── phases.ts        6 phase definitions (1-6)                 │
│  ├── checklists.ts    Phase gate checklists                     │
│  ├── instructions.ts  Per-phase instruction entries             │
│  ├── estimation.ts    PERT estimation guide                     │
│  └── conventions.ts   PM convention entries                     │
├─────────────────────────────────────────────────────────────────┤
│  Infrastructure                                                  │
│  ├── pm-diagnostics.ts   PMDiagnosticsTracker + pmSafe()        │
│  ├── constants.ts         PM_KEYWORDS, PHASE_MAP, etc.          │
│  └── migrations.ts V23   conventions.summary + tags fields      │
└─────────────────────────────────────────────────────────────────┘
```

---

## PM-Lite: Workflow Nudges

### Activation
PM-Lite is **on by default**. It requires no configuration. Disable with:
```js
engram_admin({ action: "disable_pm_lite" })
```

### How it works
`WorkflowAdvisorService` is instantiated per session. Every MCP tool call passes through `advisor.recordAction(actionName, params)`. After each call, the dispatcher checks `advisor.checkNudge()` and includes any returned nudge in the response as `pm_nudge`.

### Checks (evaluated in order)

| ID | Trigger | Message |
|----|---------|---------|
| `unrecorded_edits` | ≥3 `begin_work` without `record_change` | Reminds agent to call `record_change` |
| `missing_decision_lookup` | `create_task` without `get_decisions` this session | Warns about potentially missing prior decisions |
| `missing_file_notes` | ≥3 `begin_work` without `get_file_notes` | Suggests checking file notes before editing |
| `unrecorded_decisions` | ≥5 `get_file_notes` without `record_decision` | Prompts to record architectural observations |
| `pm_full_offer` | ≥3 tasks created OR phase tag detected OR PM keyword in task title | One-time offer to enable PM-Full |

### Nudge Lifecycle Rules
- Each nudge ID is delivered **at most once per session** (deduplicated by `Set<string>`)
- Total cap: **5 nudges per session** (`PM_MAX_NUDGES`)
- Once cap is reached, `checkNudge()` returns `null` for the rest of the session
- `pm_full_offer` only fires if `pm_full_offered !== 'true'` AND `pm_full_declined !== 'true'`

---

## PM-Full: Structured Phase Management

### Activation
```js
engram_admin({ action: "enable_pm" })
```
This sets `pm_full_enabled = "true"` and clears `pm_full_declined`. Re-query `pm_status` to verify.

### Phase Tagging System

Tag tasks with `phase:<name>` to activate phase tracking:

| Tag | Phase # | Name |
|-----|---------|------|
| `phase:initiation` or `phase:1` | 1 | Initiation |
| `phase:planning` or `phase:2` | 2 | Planning |
| `phase:execution` or `phase:3` | 3 | Execution |
| `phase:monitoring` or `phase:4` | Monitoring |
| `phase:closure` or `phase:5` | 5 | Closure |
| `phase:retrospective` or `phase:6` | 6 | Retrospective |

`detectCurrentPhase(repos)` scans all open (non-done) tasks, finds those with `phase:` tags, maps them to phase numbers, and returns the **lowest** (most urgent) active phase number.

### Phase Gate Auto-Scheduling

When `triggerTaskCompleteEvents(taskId)` runs (called after every `update_task` with `status: 'done'`):
1. Gets the completed task and parses its tags
2. Finds the `phase:` tag (if any)
3. Checks if any other tasks with that same tag are still open
4. If none remain → creates a `Phase Gate N→N+1 — Review Required` event
   - `trigger_type: "next_session"` (fires at next session start)
   - `priority: "high"`
   - Tags: `["pm-framework", "phase-gate-N"]`
5. Idempotency: checks for existing events with `phase-gate-N` tag before creating

### PM-Full Nudges (additional, active when PM-Full enabled)

| ID | Trigger |
|----|---------|
| `phase_gate_skip` | `update_task` with `status: done` and phase tag, but `get_knowledge` was not called this session |
| `phase_awareness` | Phase tag detected in task but `get_knowledge` phase_info not retrieved |
| `risk_register` | ≥7 open tasks without a scheduled risk-review event |
| `pm_full_offer` | (disabled when PM-Full already active) |

---

## Knowledge Base Reference

### `get_knowledge` Action

```js
engram_memory({
    action: "get_knowledge",
    knowledge_type: "principles" | "phase_info" | "checklist" | "instructions" | "estimation" | "conventions" | "all",
    phase: 1-6,           // required for phase_info, checklist, instructions
    compact: true | false  // default: true (returns summaries, not full prose)
})
```

**Requires PM-Full enabled.** Returns error if `pm_full_enabled !== 'true'`.

### Knowledge Types

| Type | Returns | Phase required? |
|------|---------|-----------------|
| `principles` | 5 core PM principles | No |
| `phase_info` | Phase definition: name, label, entry/exit criteria, instruction summaries | Yes |
| `checklist` | Phase gate checklist items for transitioning FROM the given phase | Yes |
| `instructions` | Per-phase operational instructions | Yes |
| `estimation` | PERT estimation guide (method, formula, compact tips) | No |
| `conventions` | PM convention entries (best practices) | No |
| `all` | Combined: principles + estimation + conventions, plus phase_info + checklist + instructions if phase given | No (phase optional) |

### Phase Definitions

| # | Name | Compact |
|---|------|---------|
| 1 | Initiation | Define scope, stakeholders, success criteria |
| 2 | Planning | Break down work, estimate, sequence tasks |
| 3 | Execution | Implement, track progress, manage changes |
| 4 | Monitoring | Measure progress, quality gates, risk reviews |
| 5 | Closure | Verify deliverables, document lessons, formal close |
| 6 | Retrospective | Analyse what worked, improve next project |

---

## Admin Actions Reference

### `pm_status`
```js
engram_admin({ action: "pm_status" })
```
Returns:
```json
{
  "pm_lite_enabled": true,
  "pm_full_enabled": false,
  "pm_full_offered": false,
  "pm_full_declined": false,
  "current_phase": null,
  "advisor_stats": { "delivered": 2, "available": ["unrecorded_edits", "missing_file_notes"] },
  "diagnostics": {
    "pm_lite_healthy": true,
    "pm_full_healthy": true,
    "failure_count": 0,
    "recent_failures": [],
    "uptime_ms": 12400
  },
  "knowledge_base_version": "1.0"
}
```

### Flag Transitions

```
Default state:
  pm_lite_enabled = (unset → treated as true)
  pm_full_enabled = (unset → treated as false)
  pm_full_offered = (unset → false)
  pm_full_declined = (unset → false)

enable_pm:
  pm_full_enabled = "true"
  pm_full_declined = "false"

disable_pm:
  pm_full_enabled = "false"

disable_pm_lite:
  pm_lite_enabled = "false"

enable_pm_lite:
  pm_lite_enabled = "true"

decline_pm:
  pm_full_declined = "true"
  pm_full_offered = "true"  ← suppresses re-offer

reset_pm_offer:
  pm_full_offered = "false"
  pm_full_declined = "false"  ← allows re-offer on next trigger
```

---

## Error Isolation: `pmSafe()`

```typescript
pmSafe(
    operation: () => T,
    fallback: T,
    context: string,
    tracker?: PMDiagnosticsTracker | null,
): T
```

Every PM operation (advisor checks, knowledge queries, phase gate scheduling, diagnostics) runs through `pmSafe()`. On error:
1. Logs `[Engram/PM] <context> failed: <message>` to `console.error`
2. Records failure in `PMDiagnosticsTracker` (if provided)
3. Returns `fallback` — caller is never aware of the failure

`PMDiagnosticsTracker` aggregates failures by context and exposes:
- `getStatus()` → `PMStatusReport` with `pm_lite_healthy`, `pm_full_healthy`, `failure_count`, `recent_failures`
- `healthy` logic: `pm_lite_healthy = no context failed ≥3 times`, `pm_full_healthy = zero failures

---

## Schema V23: Convention Upgrades

Migration V23 adds two columns to the `conventions` table:

```sql
ALTER TABLE conventions ADD COLUMN summary TEXT;
ALTER TABLE conventions ADD COLUMN tags TEXT;  -- JSON array
```

`summary` is a compact one-liner for fast context delivery. `tags` enables tag-based filtering and FTS focus matching. Existing rows have `NULL` values for both — no data loss.

The `ConventionsRepo` now exposes `getWithSummaries()` which joins summary + tags for session start delivery.

---

## Session Start: PM-Enhanced Output

When PM-Lite is active, `session_start` now includes:
- `pm_nudge` (if applicable): relevant nudge text
- `pm_lite_active: true`

When PM-Full is active:
- `pm_full_active: true`
- `current_phase`: phase number if tasks with `phase:` tags exist, else null
- `phase_overview`: compact phase definition + instruction summaries (if `current_phase` detected)
- `pm_conventions`: compact PM convention entries (injected alongside regular conventions)
- On triggered phase gate events: full gate checklist pre-loaded

The `intent` parameter (new in v1.10.0) can be passed to `session_start`:
```js
engram_session({ action: "start", agent_name: "claude", intent: "implement auth system", verbosity: "summary" })
```
The intent string is used by FTS5 focus filtering to return more relevant decisions, tasks, and file notes.

---

## Test Coverage

| File | Tests | Coverage |
|------|-------|---------|
| `tests/services/advisor.test.ts` | 31 | Full nudge lifecycle |
| `tests/services/event-trigger-phase.test.ts` | 15 | Phase detection + gate scheduling |
| `tests/tools/pm-actions.test.ts` | 22 | Admin actions + get_knowledge guard |
| `tests/tools/pm-flow.test.ts` | 35 | End-to-end flows (Steps 9.1–9.5) |
| `tests/repositories/coverage-boost.test.ts` | 46 | Repo method coverage → 87% |
| **Total new** | **149** | |
| **Suite total** | **551** | 87% repository layer |

---

## Implementation Steps (Git History)

| Step | Branch | Commit | Description |
|------|--------|--------|-------------|
| 0 | feature/pm-step0 | `fd3a564` | Pre-implementation verification pass |
| 1 | feature/pm-step0 | `fd3a564` | PM error infra: PMDiagnosticsTracker + pmSafe + PMFrameworkError |
| 2 | feature/pm-convention-v23 | `76b8de6` | Convention schema V23 + FTS focus filtering |
| 3 | feature/pm-knowledge-base | `fa3d55f` | Knowledge base module (6 files) |
| 4 | feature/pm-session | `6f82076` | Session start: intent param + PM mode + convention summaries |
| 5 | feature/pm-workflow-advisor | `be018aa` | WorkflowAdvisorService + 31 tests |
| 6 | feature/pm-phase-system | `c7a898d` | detectCurrentPhase + phase gate auto-scheduling + 15 tests |
| 7 | feature/pm-actions | `c97ab61` | get_knowledge + 7 admin actions + catalog + 22 tests |
| 8 | feature/pm-readme-docs | `2eb0c13` | README PM section + copilot-instructions PM section |
| 9 | feature/pm-tests | `e81a565` | 35 integration tests + 46 coverage-boost tests |
