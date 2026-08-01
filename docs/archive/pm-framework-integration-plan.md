# Engram Built-In Project Management Framework — Integration Plan

**Date:** 2026-03-03  
**Branch:** `develop`  
**Status:** Design document — pre-implementation  
**Decision Reference:** Decision #24 (PM Framework), Decision #3 (Tier Catalog)

---

## 1. Goal

Bake the 6-phase Project Execution Framework (currently 22 standalone Markdown documents) into Engram's core so that **every Engram installation ships it automatically**. Any agent, on any project, gets structured project management guidance without the user needing to configure anything.

### Design Constraints

1. **Zero token burn at rest.** If the agent doesn't need PM guidance, the agent pays nothing.
2. **Smart delivery, not dump delivery.** Information appears only when contextually relevant — by phase, by action pattern, by gap detection.
3. **No session-start bloat.** The session start response must not grow. Current summary verbosity is ~730 tokens. Target: ≤750 tokens after integration.
4. **Progressive disclosure.** Principles surface first (compact). Checklists surface on demand. Full instruction guides surface only when the agent enters a phase.
5. **Proactive but not nagging.** Engram detects when the agent is skipping critical workflow steps and nudges — once. Not every call.

---

## 2. Architecture Overview

The integration introduces **three new concepts** to Engram and **modifies four existing systems**:

### New Concepts

| Concept | Implementation | Purpose |
|---|---|---|
| **Workflow Advisor** | New service: `src/services/workflow-advisor.service.ts` | Tracks agent behavior patterns within a session and produces contextual nudges when the agent skips critical steps |
| **Built-in Knowledge Base** | New module: `src/knowledge/` | Ships compiled PM framework as structured TypeScript data, not raw Markdown. Indexed, queryable, phase-addressable |
| **Convention Summary Field** | Schema migration (V23) + repo update | Each convention gets a compact `summary` field (≤80 chars) for session delivery; full `rule` text for on-demand |

### Modified Systems

| System | Change | Impact |
|---|---|---|
| **Session Start** (`sessions.ts`) | Add focus-based convention filtering, deliver convention summaries, inject workflow advisor nudge if applicable | Neutral token impact (summaries replace truncated rules) |
| **Conventions Repo** | Add `summary` column, add `tags` column, update `getActive()` to return summaries at session start | Migration V23 |
| **Event Trigger Service** | Add `trigger_type: 'phase_gate'` support tied to task phase completion | Phase gate automation |
| **Agent Rules** | Add PM-framework-aware rules that activate only when a project has opted into PM mode | Conditional agent guidance |

---

## 3. The Knowledge Base — `src/knowledge/`

### 3.1 Why Not Store It in SQLite?

Storing the framework in the conventions/decisions tables means:
- It inflates the user's actual project data with framework boilerplate
- It cannot be versioned/upgraded without migration complexity
- It mixes institutional knowledge with project-specific knowledge
- Agents cannot distinguish "this is a framework rule" from "this is a user's rule"

**Decision: Ship the framework as compiled TypeScript data, versioned with the npm package.**

### 3.2 Structure

```
src/knowledge/
  index.ts              ← Public API: getPhase(), getPrinciples(), getChecklist(), getInstruction()
  principles.ts         ← 5 core principles (compact form + full form)
  phases.ts             ← 6 phase definitions with entry/exit criteria
  checklists.ts         ← Phase gate checklists (structured arrays, not Markdown)
  instructions.ts       ← Per-phase instruction summaries (compact) + full text
  estimation.ts         ← PERT formula, estimation guidelines
  conventions.ts        ← Default convention set (shipped, not auto-installed)
```

### 3.3 Data Format

Each knowledge entry has a **two-tier format**:

```typescript
interface KnowledgeEntry {
  id: string;                    // e.g. "principle-intentionality", "gate-2-check-3"
  category: 'principle' | 'phase' | 'checklist' | 'instruction' | 'estimation' | 'convention';
  phase?: number;                // 1-6, undefined if cross-cutting
  compact: string;               // ≤80 chars — designed for session delivery
  full: string;                  // Full text — delivered on demand
  tags: string[];                // For FTS/focus matching
}
```

**Example:**
```typescript
{
  id: "principle-traceability",
  category: "principle",
  compact: "Every output traces to a requirement; every requirement traces to a test.",
  full: "Traceability means maintaining a clear chain from requirements → design → implementation → tests → delivery. If an output cannot be traced back to a stated requirement, it is either undocumented scope or unnecessary work. If a requirement cannot be traced forward to a test, it is unverified.",
  tags: ["traceability", "quality", "requirements"]
}
```

### 3.4 Token Budget for Knowledge

| Query | Data Returned | Tokens (approx) |
|---|---|---|
| `getPrinciples()` compact | 5 principles, ≤80 chars each | ~60 t |
| `getPhaseInfo(3)` compact | Phase 3 entry/exit + 9 instruction summaries | ~150 t |
| `getChecklist(2)` | Phase Gate 2 checklist (17 items) | ~350 t |
| `getPhaseInstructions(3)` full | Full Phase 3 execution instructions | ~800 t |
| Total if agent loads everything for current phase | principles + phase info + checklist | ~560 t |

Compare: current session start is ~730t. The PM framework adds **zero** to session start by default, and ~560t on-demand when an agent enters a specific phase.

---

## 4. Workflow Advisor — Smart Nudging

### 4.1 Concept

The Workflow Advisor is a session-scoped service that observes what actions the agent has called and what it has NOT called, then produces **contextual nudges** at strategic moments.

It does NOT output on every tool call. It outputs only when:
1. The agent has performed ≥3 file edits without recording any changes → nudge: `record_change`
2. The agent has created tasks without checking existing decisions → nudge: `get_decisions`
3. The agent is about to advance a phase (task with phase tag marked done) without running the gate checklist → nudge: phase gate
4. The agent opened a session without focus → suggest focus based on open tasks
5. The agent has made ≥2 architectural decisions in one session without recording them → nudge: `record_decision`

### 4.2 Implementation

```typescript
// src/services/workflow-advisor.service.ts

interface ActionLog {
  action: string;
  timestamp: number;
  params?: Record<string, unknown>;
}

export class WorkflowAdvisorService {
  private sessionActions: ActionLog[] = [];
  private nudgesDelivered: Set<string> = new Set();
  private pmEnabled: boolean = false;

  constructor(private repos: Repositories) {
    // Check if this project has PM mode enabled
    this.pmEnabled = this.repos.config.get('pm_framework_enabled') === 'true';
  }

  /** Called by dispatcher after every tool call */
  recordAction(action: string, params?: Record<string, unknown>): void {
    this.sessionActions.push({ action, timestamp: Date.now(), params });
  }

  /** Returns nudge text if one is warranted, null otherwise */
  checkNudge(): string | null {
    // Each nudge fires at most once per session
    for (const check of this.checks) {
      const result = check();
      if (result && !this.nudgesDelivered.has(result.id)) {
        this.nudgesDelivered.add(result.id);
        return result.message;
      }
    }
    return null;
  }

  private get checks(): Array<() => { id: string; message: string } | null> {
    return [
      () => this.checkUnrecordedEdits(),
      () => this.checkMissingDecisionLookup(),
      () => this.checkPhaseGateSkip(),
      () => this.checkMissingFileNotes(),
      // PM-specific checks only when enabled:
      ...(this.pmEnabled ? [
        () => this.checkPhaseAwareness(),
        () => this.checkRiskRegister(),
      ] : []),
    ];
  }
}
```

### 4.3 Nudge Injection Point

Nudges piggyback on tool responses. After every `engram_memory` or `engram_admin` call, the dispatcher checks `advisor.checkNudge()`. If non-null, it appends a `_advisor` field to the response:

```typescript
// In dispatcher-memory.ts, at the end of the switch:
const result = await handleAction(params);
const nudge = services.advisor.checkNudge();
if (nudge) {
  result.content[0].text = JSON.stringify({
    ...JSON.parse(result.content[0].text),
    _advisor: nudge,
  });
}
return result;
```

**Token cost:** ~15-30 tokens per nudge, delivered at most 3-5 times per session. Total overhead: ≤150 tokens across an entire session. Zero when no nudge fires.

### 4.4 Nudge Examples

| Trigger | Nudge Message |
|---|---|
| 3+ edits without `record_change` | `"⚡ You've edited 3 files without recording changes. Call record_change to avoid losing history."` |
| Task with phase=3 marked done, no gate checklist | `"📋 Phase 3 complete — run the Phase Gate 3→4 checklist before starting Quality work. Use engram_memory(action:'get_knowledge', phase:3, type:'checklist')."` |
| New session, no focus, 3+ open tasks | `"💡 Suggested focus: '{highest_priority_task_title}'. Pass focus at session start for filtered context."` |
| 2+ decisions made, none recorded | `"📝 You've made architectural choices this session. Record them with record_decision so future sessions see them."` |

---

## 5. Session Start Improvements

### 5.1 Problem: Current Bloat

The current session start at `verbosity: "summary"` returns:
- Previous session info
- Git state
- Up to 5 recent changes (each truncated to 120 chars)
- Up to 500 chars of git log
- Up to 5 decisions (each truncated to 120 chars)
- Up to 10 conventions (each truncated to 100 chars)
- Up to 5 tasks
- Agent rules (8 rules)
- Tool catalog (Tier 0: ~80t, Tier 2: ~1200t)
- Triggered events
- Various metadata

**Problem:** When an agent calls `start` just to "record something quick," it receives ALL of this. The changes, git log, and truncated decisions are wasted tokens.

### 5.2 Solution: Intent-Aware Session Start

Add an optional `intent` parameter to session start:

```typescript
intent: z.enum(["full_context", "quick_op", "phase_work"]).optional().default("full_context")
```

| Intent | What it returns | Token budget |
|---|---|---|
| `full_context` | Current behavior (default) | ~730 t |
| `quick_op` | Session ID, agent rules, tool catalog only. No changes, no decisions, no git log. For when the agent just needs to record something. | ~200 t |
| `phase_work` | Full context + relevant phase knowledge for the current phase (auto-detected from highest-priority open task) | ~900 t |

**Backward compatible:** Default is `full_context`, so existing agents see no change.

### 5.3 Convention Delivery Upgrade

**Current:** `rule: truncate(c.rule, 100)` — produces fragmented mid-sentence text.

**After V23 migration:** Each convention gains a `summary` field. Session start delivers `summary` instead of truncated `rule`:

```typescript
// Before:
capConventions(10).map(c => ({ id: c.id, category: c.category, rule: truncate(c.rule, 100), enforced: c.enforced }))

// After:
capConventions(10).map(c => ({ id: c.id, category: c.category, summary: c.summary || truncate(c.rule, 80), enforced: c.enforced }))
```

### 5.4 Focus-Aware Convention Filtering

**Current:** Conventions are hard-capped at 10, no focus filtering (only decisions get FTS-ranked by focus).

**After:** When `focus` is provided:
1. Conventions get the same FTS5 ranking treatment as decisions
2. Conventions with matching tags/keywords surface first
3. Non-matching conventions are deprioritized but not removed

```typescript
// New method on ConventionsRepo:
getActiveFocused(ftsQuery: string, limit: number = 10): ConventionRow[] {
  try {
    return this.db.prepare(`
      WITH ranked AS (
        SELECT rowid, rank FROM fts_conventions WHERE fts_conventions MATCH ?
      )
      SELECT c.* FROM conventions c
      LEFT JOIN ranked ON ranked.rowid = c.id
      WHERE c.enforced = 1
      ORDER BY 
        CASE WHEN ranked.rank IS NOT NULL THEN 0 ELSE 1 END,
        ranked.rank,
        c.id DESC
      LIMIT ?
    `).all(ftsQuery, limit) as ConventionRow[];
  } catch {
    return this.getActive(limit);
  }
}
```

---

## 6. PM Mode Activation

### 6.1 Opt-In, Not Force

The PM framework ships with Engram but does NOT activate automatically. Activation happens when:

1. **Explicit:** Agent or user calls `engram_admin(action: 'enable_pm')` → sets config flag
2. **Auto-detect:** When an agent creates a task with a `phase` tag (e.g., `tags: ["phase:initiation"]`), Engram offers to enable PM mode
3. **Import:** When conventions are imported from the S&IB instance

### 6.2 What PM Mode Does

When `pm_framework_enabled = true` in config:

| Behavior | Without PM | With PM |
|---|---|---|
| Session start conventions | User-defined only | User-defined + 5 built-in PM principles (compact summaries) |
| Phase gate events | Not created | Auto-scheduled when tasks with phase tags complete |
| Workflow nudges | Basic (record_change, file_notes) | Extended (phase gates, risk register, scope verification) |
| `get_knowledge` action | Returns error: PM not enabled | Returns phase-specific instructions, checklists, principles |
| Agent rules | 8 standard rules | 8 standard + 3 PM-specific rules (phase awareness, gate discipline, decision logging) |

### 6.3 Built-In Conventions (PM Mode)

When PM mode is enabled, these 5 conventions are INJECTED into the session start response (not stored in SQLite — they come from the knowledge base):

| # | Summary (≤80 chars) | Category |
|---|---|---|
| 1 | `Never advance a phase without documented exit criteria.` | pm-workflow |
| 2 | `Every decision requires a rationale. No undocumented choices.` | pm-discipline |
| 3 | `Ship working increments. Prove progress with deliverables, not words.` | pm-quality |
| 4 | `Identify risks before committing to estimates or approaches.` | pm-risk |
| 5 | `Track scope changes formally. No silent additions.` | pm-scope |

**Token cost:** ~75 tokens. These replace nothing — they are additive but compact.

---

## 7. New Action: `get_knowledge`

A new action on `engram_memory` that queries the built-in knowledge base:

```typescript
// engram_memory({ action: "get_knowledge", ... })
{
  phase: z.number().int().min(1).max(6).optional(),
  type: z.enum(["principles", "phase_info", "checklist", "instructions", "estimation", "conventions", "all"]).optional().default("phase_info"),
  compact: z.boolean().optional().default(true),
}
```

### Usage Examples

```js
// Get compact phase info for current phase
engram_memory({ action: "get_knowledge", phase: 3, type: "phase_info" })
// → { phase: 3, name: "Execution & Building", entry_criteria: [...], exit_criteria: [...], instructions_summary: [...] }

// Get full phase gate checklist before advancing
engram_memory({ action: "get_knowledge", phase: 3, type: "checklist" })
// → { phase_gate: "3→4", items: [{ id: 1, check: "All planned deliverables complete", mandatory: true }, ...] }

// Get all 5 core principles (compact)
engram_memory({ action: "get_knowledge", type: "principles" })
// → { principles: [{ id: "intentionality", compact: "...", full: "..." }, ...] }

// Get estimation guidance
engram_memory({ action: "get_knowledge", type: "estimation" })
// → { method: "PERT", formula: "E=(O+4M+P)/6", commit_formula: "M+σ where σ=(P-O)/6", ... }
```

### Token Budget

| Call | Tokens |
|---|---|
| `get_knowledge(phase:3, type:"phase_info", compact:true)` | ~150 t |
| `get_knowledge(phase:3, type:"checklist")` | ~350 t |
| `get_knowledge(phase:3, type:"instructions", compact:false)` | ~800 t |
| `get_knowledge(type:"principles")` | ~60 t |

Agent pays ONLY for what it asks. Zero ambient cost.

---

## 8. Phase-Aware Task System

### 8.1 Phase Tags Convention

Tasks created while PM mode is active support a phase tag convention:

```js
// Agent creates a phase-tagged task:
engram_memory({ action: "create_task", title: "Complete WBS", tags: ["phase:planning"], priority: "high" })
```

The `phase:` prefix is recognized by:
- Session start: auto-detects current phase from highest-priority open phase-tagged task
- Workflow advisor: knows what phase the project is in
- Event trigger: auto-creates phase gate check when all tasks for a phase are done

### 8.2 Current Phase Detection

```typescript
function detectCurrentPhase(repos: Repositories): number | null {
  const tasks = repos.tasks.getOpen(50);
  const phaseTasks = tasks
    .filter(t => {
      const tags: string[] = t.tags ? JSON.parse(t.tags) : [];
      return tags.some(tag => tag.startsWith('phase:'));
    })
    .map(t => {
      const tags: string[] = JSON.parse(t.tags!);
      const phaseTag = tags.find(tag => tag.startsWith('phase:'))!;
      const phaseNum = PHASE_MAP[phaseTag.split(':')[1]] ?? null;
      return { ...t, phase: phaseNum };
    })
    .filter(t => t.phase !== null);

  if (phaseTasks.length === 0) return null;
  // Current phase = lowest numbered phase with incomplete tasks
  return Math.min(...phaseTasks.map(t => t.phase!));
}

const PHASE_MAP: Record<string, number> = {
  initiation: 1, planning: 2, execution: 3,
  quality: 4, finalization: 5, handover: 6, documentation: 6,
};
```

### 8.3 Auto Phase Gate Events

When ALL tasks tagged `phase:N` are marked done, Engram auto-schedules a phase gate event:

```typescript
// In event-trigger.service.ts or workflow-advisor.service.ts:
function onTaskComplete(taskId: number): void {
  const task = repos.tasks.getById(taskId);
  const tags: string[] = task?.tags ? JSON.parse(task.tags) : [];
  const phaseTag = tags.find(t => t.startsWith('phase:'));
  if (!phaseTag) return;

  const phaseNum = PHASE_MAP[phaseTag.split(':')[1]];
  if (!phaseNum) return;

  // Check if any tasks for this phase are still open
  const remaining = repos.tasks.getFiltered({ tag: phaseTag, includeDone: false, limit: 1 });
  if (remaining.length > 0) return; // Still work to do

  // All tasks for this phase are done — schedule gate review
  repos.events.create(getCurrentSessionId(), now(), {
    title: `Phase Gate ${phaseNum}→${phaseNum + 1} — Review Required`,
    description: `All ${phaseTag} tasks are complete. Review the Phase Gate ${phaseNum} checklist before proceeding.`,
    trigger_type: 'next_session',
    priority: 'high',
    tags: ['pm-framework', `phase-gate-${phaseNum}`],
  });
}
```

---

## 9. Schema Migration V23

```sql
-- Add summary and tags columns to conventions table
ALTER TABLE conventions ADD COLUMN summary TEXT;
ALTER TABLE conventions ADD COLUMN tags TEXT;

-- Backfill: set summary = first 80 chars of rule for existing conventions
UPDATE conventions SET summary = SUBSTR(rule, 1, 80) WHERE summary IS NULL;

-- Add tags column to conventions FTS index rebuild
DROP TRIGGER IF EXISTS trg_conventions_ai;
DROP TRIGGER IF EXISTS trg_conventions_au;
DROP TRIGGER IF EXISTS trg_conventions_ad;

-- Rebuild FTS with tags included
INSERT INTO fts_conventions(fts_conventions) VALUES('rebuild');

CREATE TRIGGER IF NOT EXISTS trg_conventions_ai AFTER INSERT ON conventions BEGIN
  INSERT INTO fts_conventions(rowid, rule, examples) VALUES (new.id, new.rule, COALESCE(new.examples, '') || ' ' || COALESCE(new.tags, ''));
END;
CREATE TRIGGER IF NOT EXISTS trg_conventions_au AFTER UPDATE ON conventions BEGIN
  INSERT INTO fts_conventions(fts_conventions, rowid, rule, examples) VALUES('delete', old.id, old.rule, COALESCE(old.examples, '') || ' ' || COALESCE(old.tags, ''));
  INSERT INTO fts_conventions(rowid, rule, examples) VALUES (new.id, new.rule, COALESCE(new.examples, '') || ' ' || COALESCE(new.tags, ''));
END;
CREATE TRIGGER IF NOT EXISTS trg_conventions_ad AFTER DELETE ON conventions BEGIN
  INSERT INTO fts_conventions(fts_conventions, rowid, rule, examples) VALUES('delete', old.id, old.rule, COALESCE(old.examples, '') || ' ' || COALESCE(old.tags, ''));
END;

-- Add pm_framework config entries
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('pm_framework_enabled', 'false', datetime('now'));
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('pm_framework_version', '1.0', datetime('now'));
```

---

## 10. Implementation Phases

### Phase A — Foundation (Low Risk)

| # | Task | Files | Est. |
|---|---|---|---|
| A1 | Create `src/knowledge/` module with compiled PM data | New: 7 files | 2h |
| A2 | Schema migration V23: `summary` + `tags` on conventions | `migrations.ts`, `types.ts`, `conventions.repo.ts` | 1h |
| A3 | Update `ConventionsRepo` with `getActiveFocused()` | `conventions.repo.ts` | 30m |
| A4 | Convention summary delivery in session start | `sessions.ts` | 30m |
| A5 | Focus-aware convention filtering in session start | `sessions.ts` | 30m |
| **Milestone:** Convention delivery is cleaner, no PM features yet | | |

### Phase B — Knowledge Access (Medium Risk)

| # | Task | Files | Est. |
|---|---|---|---|
| B1 | Add `get_knowledge` action to dispatcher-memory | `dispatcher-memory.ts`, `find.ts` (catalog) | 1h |
| B2 | Add `enable_pm` / `disable_pm` admin actions | `dispatcher-admin.ts`, `find.ts` | 30m |
| B3 | Add PM-mode conditional agent rules | `agent-rules.service.ts`, `find.ts` | 30m |
| B4 | Add `intent` param to session start | `sessions.ts` | 1h |
| **Milestone:** PM knowledge is queryable, PM mode is toggleable | | |

### Phase C — Intelligence (Higher Risk)

| # | Task | Files | Est. |
|---|---|---|---|
| C1 | Create `WorkflowAdvisorService` | New: `workflow-advisor.service.ts` | 2h |
| C2 | Wire advisor into dispatcher-memory response pipeline | `dispatcher-memory.ts` | 1h |
| C3 | Phase detection from task tags | `workflow-advisor.service.ts` | 30m |
| C4 | Auto phase gate event scheduling | `event-trigger.service.ts` | 1h |
| C5 | PM-specific nudge checks (phase gates, risk, scope) | `workflow-advisor.service.ts` | 1h |
| **Milestone:** Engram proactively guides agents through PM lifecycle | | |

### Phase D — Testing & Polish

| # | Task | Files | Est. |
|---|---|---|---|
| D1 | Unit tests for knowledge base module | New: `tests/knowledge/` | 1h |
| D2 | Unit tests for workflow advisor | New: `tests/services/advisor.test.ts` | 1h |
| D3 | Integration tests for PM session flow | New: `tests/tools/pm-flow.test.ts` | 1h |
| D4 | Update README with PM framework section | `README.md` | 30m |
| D5 | Update agent rules in README | `README.md` | 30m |
| **Milestone:** Feature complete with test coverage | | |

**Total estimated effort:** ~16 hours across 4 phases.

---

## 11. Token Efficiency Summary

### Baseline (No PM)

| Scenario | Cost |
|---|---|
| Session start (summary) | ~730 t |
| Session start (quick_op, NEW) | ~200 t |
| Per-tool-call overhead | 0 t (no advisor in non-PM mode) |

### With PM Enabled

| Scenario | Cost |
|---|---|
| Session start (summary) + 5 PM principles | ~805 t (+75 t) |
| Session start (quick_op) | ~200 t (no PM content) |
| Session start (phase_work) | ~900 t (phase info included) |
| `get_knowledge` calls (agent-initiated) | 60–800 t per call (on-demand) |
| Advisor nudges (per session average) | ~50 t (1-2 nudges avg) |
| Phase gate event (triggered at phase completion) | ~30 t (in triggered_events) |

### Comparison to Naive Approach

| Approach | Session Cost | Per-Call Cost | Total for 10-call session |
|---|---|---|---|
| **Naive:** 15 conventions + 22 file notes in session start | ~4,000 t | 0 t | ~4,000 t |
| **Current:** No PM framework | ~730 t | 0 t | ~730 t |
| **This design:** PM enabled, agent uses phase_work | ~900 t | ~30 t (advisor avg) | ~1,200 t |
| **This design:** PM enabled, agent uses quick_op | ~200 t | ~30 t | ~500 t |

The design adds ~150-470 tokens per session vs. no PM, compared to ~3,270 tokens for the naive bulk-load approach. That is a **68–95% reduction** in overhead.

---

## 12. File Change Summary

### New Files
- `src/knowledge/index.ts` — Public API
- `src/knowledge/principles.ts` — 5 core principles
- `src/knowledge/phases.ts` — 6 phase definitions
- `src/knowledge/checklists.ts` — Phase gate checklists
- `src/knowledge/instructions.ts` — Per-phase instruction summaries
- `src/knowledge/estimation.ts` — PERT and estimation guidance
- `src/knowledge/conventions.ts` — Default PM convention set
- `src/services/workflow-advisor.service.ts` — Behavior tracking and nudging
- `tests/knowledge/knowledge.test.ts` — Knowledge base tests
- `tests/services/advisor.test.ts` — Advisor tests

### Modified Files
- `src/migrations.ts` — V23 migration
- `src/types.ts` — ConventionRow + summary/tags fields
- `src/repositories/conventions.repo.ts` — getActiveFocused(), summary field
- `src/tools/sessions.ts` — intent param, convention summary delivery, focus-aware conventions, PM principles injection
- `src/tools/dispatcher-memory.ts` — get_knowledge action, advisor wire-up
- `src/tools/dispatcher-admin.ts` — enable_pm/disable_pm actions
- `src/tools/find.ts` — catalog entries for new actions, PM agent rules
- `src/services/event-trigger.service.ts` — phase gate auto-scheduling
- `src/services/index.ts` — advisor service creation
- `src/database.ts` — advisor service initialization
- `src/constants.ts` — PM-related constants
- `README.md` — PM framework documentation

---

## 13. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Advisor nudges annoy agents → agents start ignoring Engram responses | High | Once-per-session per nudge type. Max 5 unique nudges per session. Clear `_advisor` key that agents can programmatically filter. |
| Knowledge base grows stale as PM methodology evolves | Medium | Knowledge is TypeScript data, versioned with npm. Updated via `npm update`. No user data migration needed. |
| PM mode changes session start behavior unexpectedly | Medium | PM mode is opt-in with explicit `enable_pm` call. Default is disabled. `intent: "quick_op"` skips all PM content. |
| Convention summary backfill produces low-quality summaries | Low | `SUBSTR(rule, 1, 80)` is a temporary default. Agents are prompted to improve via `get_conventions` > edit flow. |
| Phase detection from tags is fragile | Low | Uses a well-defined `phase:` prefix convention. Fails gracefully to `null` (no phase detected, no PM features fire). |

---

## 14. Decision Record

This plan constitutes an architectural decision. When implementation begins, record:

```js
engram_memory({
  action: "record_decision",
  decision: "PM framework baked into Engram core as src/knowledge/ TypeScript module with WorkflowAdvisor service. Opt-in via enable_pm config. Knowledge delivered on-demand via get_knowledge action, not bulk-loaded. Convention summary field added in V23 migration. Advisor nudges max 5/session.",
  rationale: "Ship PM framework to all Engram users without token overhead. Two-tier knowledge (compact/full) ensures session delivery stays ≤750t. Advisor provides proactive guidance without nagging. Knowledge base is code, not data — versioned with npm, no migration complexity.",
  tags: ["pm-framework", "architecture", "knowledge-base", "workflow-advisor", "token-efficiency"],
  affected_files: "src/knowledge/*, src/services/workflow-advisor.service.ts, src/tools/sessions.ts, src/migrations.ts"
})
```

---

## 15. Open Questions

1. **Should the knowledge base be localizable?** Currently English-only. Could use a locale key for future i18n.
2. **Should PM mode auto-enable when the user runs `engram_session` for the first time on a new project?** Or should it remain strictly opt-in? Recommendation: offer on first session, default to off.
3. **Should the advisor service persist state across sessions** (e.g., "this agent consistently forgets to record decisions")? Or stay session-scoped? Recommendation: session-scoped initially, cross-session patterns in v2.
4. **Should phase gate checklists be editable by the user**, or always use the built-in defaults? Recommendation: built-in defaults + user can add custom checks via conventions/events.
