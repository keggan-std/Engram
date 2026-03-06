# Engram Built-In Project Management Framework — Integration Plan v2

**Date:** 2026-03-04  
**Branch:** `develop`  
**Status:** Design document — pre-implementation (v2 revision)  
**Supersedes:** `docs/pm-framework-integration-plan.md` (v1)  
**Decision Reference:** Decision #24 (PM Framework), Decision #32 (Architecture), Decision #33 (v2 Revisions)

---

## Revision Summary (v1 → v2)

| # | Change | Rationale |
|---|---|---|
| R1 | Two-level PM system: PM-Lite (auto-ON) + PM-Full (toggle) | User requirement: ON by default with ability to turn off |
| R2 | Error handling infrastructure for PM subsystem | Sensitivity of the feature demands graceful degradation |
| R3 | Auto-detection of PM-Full eligibility with spam prevention | User wants PM-Full offered when agents create structured plans |
| R4 | README agent instructions for PM mode | Agents must know PM exists without relying on user prompts |
| R5 | Detailed A-to-Z implementation roadmap with feature branches | Careful, systematic, verifiable implementation |
| R6 | Open questions resolved with user decisions | Q1-Q4 all answered |
| R7 | i18n-ready knowledge base format | Future localization support via locale keys |

---

## 1. Goal

Bake the 6-phase Project Execution Framework (currently 22 standalone Markdown documents) into Engram's core so that **every Engram installation ships it automatically**. Any agent, on any project, gets structured project management guidance without the user needing to configure anything.

### Design Constraints

1. **Zero token burn at rest.** If the agent doesn't need PM guidance, the agent pays nothing.
2. **Smart delivery, not dump delivery.** Information appears only when contextually relevant — by phase, by action pattern, by gap detection.
3. **No session-start bloat.** The session start response must not grow beyond current levels. Target: ≤750 tokens at `verbosity: "summary"` in PM-Lite mode. PM-Full adds ≤75t.
4. **Progressive disclosure.** Principles surface first (compact). Checklists surface on demand. Full instruction guides surface only when the agent enters a phase.
5. **Proactive but not nagging.** Engram detects when the agent is skipping critical workflow steps and nudges — once. Not every call.
6. **ON by default, off by choice.** PM-Lite ships active. Users can disable it. PM-Full requires activation but is auto-offered when appropriate.
7. **Graceful degradation.** PM subsystem failures must NEVER block core Engram operations. Every PM code path wraps in isolation boundaries.

---

## 2. Two-Level PM Architecture (NEW in v2)

### 2.1 The Problem with One-Switch Opt-In

v1 proposed a single `enable_pm` toggle, defaulting to off. This conflicts with two user requirements:

- **"The system should be auto-loaded and ON automatically"** — users want immediate value
- **"Let the capability of the user be able to turn this off when he wants to"** — users want control

A single toggle forces a choice: either everything is on (too heavy for quick sessions) or everything is off (users miss the value). Neither is acceptable.

### 2.2 Solution: PM-Lite and PM-Full

| Aspect | PM-Lite | PM-Full |
|---|---|---|
| **Default state** | ON (auto-active for all projects) | OFF (requires activation) |
| **User control** | Disable via `disable_pm_lite` | Enable via `enable_pm` / disable via `disable_pm` |
| **Session start cost** | +0t (nudges are reactive, not injected) | +75t (5 PM principles as conventions) |
| **Workflow Advisor** | 3 basic checks: unrecorded edits, missing decisions, missing file notes | 3 basic + 4 PM checks: phase gates, risk register, scope verification, estimation |
| **Knowledge Base** | Not accessible | Full access via `get_knowledge` action |
| **Phase awareness** | None | Phase detection from task tags, gate automation |
| **Agent Rules** | Standard 8 rules | Standard 8 + 3 PM-specific rules |
| **Convention injection** | None | 5 PM principle conventions injected |

### 2.3 State Machine

```
 ┌─────────────────────────────────────────────────────┐
 │                    PM-Lite (default ON)              │
 │  • Basic workflow nudges (record_change, etc.)       │
 │  • Zero ambient token cost                           │
 │  • Agent receives standard session start             │
 │                                                      │
 │         ┌──── disable_pm_lite ────┐                  │
 │         ▼                         │                   │
 │    [PM Disabled]                  │                   │
 │    No nudges, no PM features      │                   │
 │         │                         │                   │
 │         └──── enable_pm_lite ─────┘                  │
 │                                                      │
 │         ┌──── enable_pm ──────────┐                  │
 │         ▼                         │                   │
 │    [PM-Full Active]               │                   │
 │    PM-Lite + phase gates +        │                   │
 │    knowledge base + PM rules +    │                   │
 │    PM conventions + auto-gates    │                   │
 │         │                         │                   │
 │         └──── disable_pm ─────────┘                  │
 │              (reverts to PM-Lite)                     │
 └─────────────────────────────────────────────────────┘
```

### 2.4 Config Keys

```typescript
// Stored in `config` table
'pm_lite_enabled'       // default: 'true' — basic workflow nudges
'pm_full_enabled'       // default: 'false' — full PM framework
'pm_full_offered'       // default: 'false' — has PM-Full been offered to this project?
'pm_full_declined'      // default: 'false' — user explicitly declined PM-Full
'pm_framework_version'  // default: '1.0' — tracks knowledge base version
```

---

## 3. Error Handling Infrastructure (NEW in v2)

### 3.1 Design Principle: PM Never Breaks Engram

The PM subsystem is an enhancement layer. If it fails — due to corrupt data, schema issues, unexpected input, or bugs — core Engram must continue operating normally. This means:

1. **Every PM code path wraps in an isolation boundary** — a try/catch that degrades gracefully
2. **PM errors are logged but never thrown to the dispatcher** — the dispatcher returns the core response without PM enhancements
3. **A dedicated error class hierarchy** allows targeted handling and diagnostics
4. **A diagnostic action** (`pm_status`) lets agents and users inspect PM health

### 3.2 PM Error Classes

```typescript
// Added to src/errors.ts

/**
 * Base class for all PM framework errors.
 * PM errors are non-fatal — they degrade PM features without blocking core operations.
 */
export class PMFrameworkError extends EngramError {
    constructor(message: string, code: string = "PM_ERROR", context?: Record<string, unknown>) {
        super(message, code, context);
        this.name = "PMFrameworkError";
    }
}

/**
 * Knowledge base query failed (data corruption, missing entry, etc.)
 */
export class PMKnowledgeError extends PMFrameworkError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, "PM_KNOWLEDGE_ERROR", context);
        this.name = "PMKnowledgeError";
    }
}

/**
 * Workflow advisor check failed (state inconsistency, etc.)
 */
export class PMAdvisorError extends PMFrameworkError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, "PM_ADVISOR_ERROR", context);
        this.name = "PMAdvisorError";
    }
}

/**
 * Phase detection or gate automation failed.
 */
export class PMPhaseError extends PMFrameworkError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, "PM_PHASE_ERROR", context);
        this.name = "PMPhaseError";
    }
}
```

### 3.3 Isolation Boundary Pattern

Every PM enhancement point uses this pattern:

```typescript
/**
 * Wraps a PM operation in an isolation boundary.
 * Returns the result on success, or the fallback on failure.
 * Logs all failures to console.error for diagnostics.
 */
function pmSafe<T>(operation: () => T, fallback: T, context: string): T {
    try {
        return operation();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Engram/PM] ${context} failed: ${message}`);
        // Track failure for pm_status diagnostic
        pmDiagnostics.recordFailure(context, message);
        return fallback;
    }
}

// Usage in session start:
const pmConventions = pmSafe(
    () => getPMConventions(repos),
    [],  // fallback: no PM conventions
    'inject PM conventions into session start'
);

// Usage in advisor:
const nudge = pmSafe(
    () => services.advisor.checkNudge(),
    null,  // fallback: no nudge
    'check workflow advisor nudge'
);
```

### 3.4 PM Diagnostics Tracker

```typescript
// src/services/pm-diagnostics.ts

interface PMFailureRecord {
    context: string;
    message: string;
    timestamp: number;
    count: number;  // how many times this context has failed this session
}

export class PMDiagnosticsTracker {
    private failures: Map<string, PMFailureRecord> = new Map();
    private startTime: number = Date.now();

    recordFailure(context: string, message: string): void {
        const existing = this.failures.get(context);
        if (existing) {
            existing.count++;
            existing.message = message;  // keep latest
            existing.timestamp = Date.now();
        } else {
            this.failures.set(context, { context, message, timestamp: Date.now(), count: 1 });
        }
    }

    getStatus(): PMStatusReport {
        return {
            pm_lite_healthy: this.failures.size === 0 || 
                [...this.failures.values()].every(f => f.count < 3),
            pm_full_healthy: this.failures.size === 0,
            failure_count: [...this.failures.values()].reduce((sum, f) => sum + f.count, 0),
            recent_failures: [...this.failures.values()]
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 5),
            uptime_ms: Date.now() - this.startTime,
        };
    }

    reset(): void {
        this.failures.clear();
        this.startTime = Date.now();
    }
}

interface PMStatusReport {
    pm_lite_healthy: boolean;
    pm_full_healthy: boolean;
    failure_count: number;
    recent_failures: PMFailureRecord[];
    uptime_ms: number;
}
```

### 3.5 Diagnostic Action: `pm_status`

```typescript
// New admin action: engram_admin({ action: "pm_status" })
// Returns:
{
    pm_lite: { enabled: true, healthy: true },
    pm_full: { enabled: false, offered: false, declined: false },
    current_phase: null,           // or 1-6 if PM-Full active
    advisor: {
        nudges_delivered: 2,
        nudges_available: ["unrecorded_edits", "missing_decisions"],
    },
    diagnostics: {
        failure_count: 0,
        recent_failures: [],
        uptime_ms: 45000,
    },
    knowledge_base_version: "1.0",
}
```

### 3.6 Dispatcher Error Handling Upgrade

The existing dispatcher pattern of `catch { /* best effort */ }` swallows errors silently. For PM operations, we adopt structured degradation:

```typescript
// Current pattern (NOT changing for existing code — scope containment):
try { cleanExpiredLocks(); } catch { /* best effort */ }

// NEW pattern for all PM code paths:
const pmResult = pmSafe(
    () => doSomePMThing(),
    defaultValue,
    'descriptive context for diagnostics'
);
```

**Important scope limitation:** We do NOT refactor existing error handling in this PR. The PM error infrastructure is additive. Existing `catch { /* best effort */ }` patterns remain as-is. A future PR can adopt `pmSafe`-style patterns for non-PM code if desired.

---

## 4. Auto-Detection & PM-Full Activation (NEW in v2)

### 4.1 The Detection Problem

Users want PM-Full to activate when agents begin structured project work. But naive detection (e.g., "any task creation triggers PM-Full") would spam users on every small to-do.

### 4.2 Detection Criteria

PM-Full activation is **offered** (not auto-enabled) when ALL of the following are true:

1. `pm_full_offered === 'false'` — hasn't been offered before
2. `pm_full_declined === 'false'` — user hasn't declined
3. One of these trigger conditions is met:
   - Agent creates ≥3 tasks in a single session
   - Agent creates a task with explicit phase tag (`phase:initiation`, `phase:planning`, etc.)
   - Agent calls `create_task` with title containing PM keywords: "milestone", "phase gate", "deliverable", "WBS", "risk register", "sprint", "iteration"

### 4.3 Offer Mechanism

When detection criteria are met, the PM-Full offer is injected as an `_advisor` field on the next tool response:

```typescript
{
    _advisor: {
        type: "pm_full_offer",
        message: "This looks like structured project work. Enable PM-Full mode for phase gates, checklists, and workflow guidance? Call engram_admin(action:'enable_pm') to activate, or engram_admin(action:'decline_pm') to dismiss permanently.",
    }
}
```

### 4.4 Spam Prevention Guarantees

| Guard | Mechanism |
|---|---|
| **Once per project** | `pm_full_offered` config set to `'true'` after first offer |
| **Respect decline** | `pm_full_declined` config set to `'true'` on `decline_pm` |
| **No re-offer** | Once offered OR declined, never offer again |
| **Agent can re-enable** | `enable_pm` always works regardless of offer/decline state |
| **User override** | `reset_pm_offer` admin action clears offer/decline flags |

### 4.5 Detection Implementation

```typescript
// In WorkflowAdvisorService:
private checkPMFullEligibility(): { id: string; message: string } | null {
    // Only check in PM-Lite mode (PM-Full not already active)
    if (this.pmFullEnabled) return null;
    
    const offered = this.repos.config.get('pm_full_offered');
    const declined = this.repos.config.get('pm_full_declined');
    if (offered === 'true' || declined === 'true') return null;

    // Check triggers
    const taskCreations = this.sessionActions.filter(a => a.action === 'create_task');
    if (taskCreations.length < 3) {
        // Check for explicit phase tags or PM keywords
        const hasPhaseTags = taskCreations.some(a => {
            const tags: string[] = a.params?.tags as string[] ?? [];
            return tags.some(t => t.startsWith('phase:'));
        });
        const hasPMKeywords = taskCreations.some(a => {
            const title = (a.params?.title as string ?? '').toLowerCase();
            return PM_KEYWORDS.some(kw => title.includes(kw));
        });
        if (!hasPhaseTags && !hasPMKeywords) return null;
    }

    // All criteria met — offer PM-Full
    this.repos.config.set('pm_full_offered', 'true');
    return {
        id: 'pm_full_offer',
        message: 'This looks like structured project work. Enable PM-Full for phase gates, checklists, and workflow guidance? Call engram_admin(action:\'enable_pm\') to activate, or engram_admin(action:\'decline_pm\') to dismiss.',
    };
}

const PM_KEYWORDS = ['milestone', 'phase gate', 'deliverable', 'wbs', 'risk register', 'sprint', 'iteration', 'kickoff', 'handover'];
```

---

## 5. The Knowledge Base — `src/knowledge/`

### 5.1 Why Not Store It in SQLite?

Storing the framework in the conventions/decisions tables means:
- It inflates the user's actual project data with framework boilerplate
- It cannot be versioned/upgraded without migration complexity
- It mixes institutional knowledge with project-specific knowledge
- Agents cannot distinguish "this is a framework rule" from "this is a user's rule"

**Decision: Ship the framework as compiled TypeScript data, versioned with the npm package.**

### 5.2 Structure

```
src/knowledge/
  index.ts              ← Public API: getPhase(), getPrinciples(), getChecklist(), getInstruction()
  principles.ts         ← 5 core principles (compact form + full form)
  phases.ts             ← 6 phase definitions with entry/exit criteria
  checklists.ts         ← Phase gate checklists (structured arrays, not Markdown)
  instructions.ts       ← Per-phase instruction summaries (compact) + full text
  estimation.ts         ← PERT formula, estimation guidelines
  conventions.ts        ← Default convention set (shipped, not auto-installed)
  types.ts              ← KnowledgeEntry interface, phase types
```

### 5.3 Data Format

Each knowledge entry has a **two-tier format** with i18n-ready locale key:

```typescript
// src/knowledge/types.ts

interface KnowledgeEntry {
  id: string;                    // e.g. "principle-intentionality", "gate-2-check-3"
  category: 'principle' | 'phase' | 'checklist' | 'instruction' | 'estimation' | 'convention';
  phase?: number;                // 1-6, undefined if cross-cutting
  compact: string;               // ≤80 chars — designed for session delivery
  full: string;                  // Full text — delivered on demand
  tags: string[];                // For FTS/focus matching
  locale?: string;               // Default: 'en'. Future: i18n locale key
}
```

**i18n note (Q1 resolved):** The `locale` field is included now but only `'en'` is shipped. This avoids a future schema/interface break when localization is added. Knowledge queries accept an optional `locale` parameter that defaults to `'en'`. Non-English locales return a graceful fallback to English if the translation is unavailable.

### 5.4 Token Budget for Knowledge

| Query | Data Returned | Tokens (approx) |
|---|---|---|
| `getPrinciples()` compact | 5 principles, ≤80 chars each | ~60 t |
| `getPhaseInfo(3)` compact | Phase 3 entry/exit + 9 instruction summaries | ~150 t |
| `getChecklist(2)` | Phase Gate 2 checklist (17 items) | ~350 t |
| `getPhaseInstructions(3)` full | Full Phase 3 execution instructions | ~800 t |
| Total if agent loads everything for current phase | principles + phase info + checklist | ~560 t |

Compare: current session start is ~730t. The PM framework adds **zero** to session start in PM-Lite mode, +75t in PM-Full mode, and ~560t on-demand when an agent enters a specific phase.

---

## 6. Workflow Advisor — Smart Nudging

### 6.1 Concept

The Workflow Advisor is a session-scoped service that observes what actions the agent has called and what it has NOT called, then produces **contextual nudges** at strategic moments.

### 6.2 Two-Tier Nudge System

**PM-Lite nudges** (always active unless disabled):
1. Agent has performed ≥3 file edits without recording any changes → nudge: `record_change`
2. Agent has created tasks without checking existing decisions → nudge: `get_decisions`
3. Agent opened a session without focus → suggest focus based on open tasks
4. Agent opened 3+ files without checking file notes → nudge: `get_file_notes`
5. Agent has made ≥2 architectural decisions without recording them → nudge: `record_decision`

**PM-Full nudges** (only when PM-Full is active):
6. Agent is about to advance a phase (task with phase tag marked done) → nudge: phase gate checklist
7. Agent has created scope additions without risk assessment → nudge: risk identification
8. Agent has worked for 5+ actions without referencing requirements → nudge: scope verification
9. Agent is estimating without using PERT → nudge: estimation guidance

### 6.3 Implementation

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
  private pmLiteEnabled: boolean;
  private pmFullEnabled: boolean;
  private diagnostics: PMDiagnosticsTracker;

  constructor(private repos: Repositories, diagnostics: PMDiagnosticsTracker) {
    this.diagnostics = diagnostics;
    this.pmLiteEnabled = this.repos.config.get('pm_lite_enabled') !== 'false';
    this.pmFullEnabled = this.repos.config.get('pm_full_enabled') === 'true';
  }

  /** Called by dispatcher after every tool call */
  recordAction(action: string, params?: Record<string, unknown>): void {
    this.sessionActions.push({ action, timestamp: Date.now(), params });
  }

  /** Returns nudge if one is warranted, null otherwise */
  checkNudge(): string | null {
    if (!this.pmLiteEnabled && !this.pmFullEnabled) return null;

    for (const check of this.checks) {
      try {
        const result = check();
        if (result && !this.nudgesDelivered.has(result.id)) {
          this.nudgesDelivered.add(result.id);
          return result.message;
        }
      } catch (err) {
        // Individual check failure doesn't block other checks
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Engram/PM] Advisor check failed: ${message}`);
        this.diagnostics.recordFailure('advisor_check', message);
      }
    }
    return null;
  }

  private get checks(): Array<() => { id: string; message: string } | null> {
    const lite = [
      () => this.checkUnrecordedEdits(),
      () => this.checkMissingDecisionLookup(),
      () => this.checkMissingFileNotes(),
      () => this.checkMissingFocus(),
      () => this.checkUnrecordedDecisions(),
    ];
    const full = this.pmFullEnabled ? [
      () => this.checkPhaseGateSkip(),
      () => this.checkPhaseAwareness(),
      () => this.checkRiskRegister(),
      () => this.checkPMFullEligibility(),
    ] : [
      () => this.checkPMFullEligibility(),
    ];
    return [...lite, ...full];
  }
  
  /** Max nudges per session to avoid annoyance */
  get maxNudgesReached(): boolean {
    return this.nudgesDelivered.size >= 5;
  }

  get stats(): { delivered: number; available: string[] } {
    return {
      delivered: this.nudgesDelivered.size,
      available: [...this.nudgesDelivered],
    };
  }
}
```

### 6.4 Nudge Injection Point

Nudges piggyback on tool responses. After every `engram_memory` or `engram_admin` call, the dispatcher checks `advisor.checkNudge()`. If non-null and max not reached, it appends a `_advisor` field to the response:

```typescript
// In dispatcher-memory.ts, at the end of the switch:
const result = await handleAction(params);

// Isolation boundary — advisor failure never blocks the response
const nudge = pmSafe(
    () => services.advisor.checkNudge(),
    null,
    'advisor nudge check'
);

if (nudge) {
  result.content[0].text = JSON.stringify({
    ...JSON.parse(result.content[0].text),
    _advisor: nudge,
  });
}
return result;
```

**Token cost:** ~15-30 tokens per nudge, delivered at most 5 times per session. Total overhead: ≤150 tokens across an entire session. Zero when no nudge fires.

### 6.5 Nudge Examples

| Trigger | Level | Nudge Message |
|---|---|---|
| 3+ edits without `record_change` | Lite | `"You've edited 3 files without recording changes. Call record_change to preserve history."` |
| 3+ files opened without `get_file_notes` | Lite | `"Check file notes before opening files — they may save you a full re-read."` |
| Task with phase=3 marked done, no gate checklist | Full | `"Phase 3 complete — run the Phase Gate 3→4 checklist before starting Quality work. Use get_knowledge(phase:3, type:'checklist')."` |
| New session, no focus, 3+ open tasks | Lite | `"Suggested focus: '{highest_priority_task_title}'. Pass focus at session start for filtered context."` |
| 2+ decisions made, none recorded | Lite | `"You've made architectural choices this session. Record them with record_decision so future sessions see them."` |
| PM-Full eligible (≥3 tasks or phase tags) | Lite | `"This looks like structured project work. Enable PM-Full for phase gates and checklists? Call enable_pm to activate."` |

---

## 7. Session Start Improvements

### 7.1 Intent-Aware Session Start

Add an optional `intent` parameter to session start:

```typescript
intent: z.enum(["full_context", "quick_op", "phase_work"]).optional().default("full_context")
```

| Intent | What it returns | Token budget |
|---|---|---|
| `full_context` | Current behavior (default) | ~730 t |
| `quick_op` | Session ID, agent rules, tool catalog only. No changes, no decisions, no git log. | ~200 t |
| `phase_work` | Full context + relevant phase knowledge for the current phase (PM-Full only) | ~900 t |

**Backward compatible:** Default is `full_context`, so existing agents see no change.

### 7.2 Convention Delivery Upgrade

**Current:** `rule: truncate(c.rule, 100)` — produces fragmented mid-sentence text.

**After V23 migration:** Each convention gains a `summary` field. Session start delivers `summary` instead of truncated `rule`:

```typescript
// Before:
capConventions(10).map(c => ({ id: c.id, category: c.category, rule: truncate(c.rule, 100), enforced: c.enforced }))

// After:
capConventions(10).map(c => ({ id: c.id, category: c.category, summary: c.summary || truncate(c.rule, 80), enforced: c.enforced }))
```

### 7.3 Focus-Aware Convention Filtering

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

### 7.4 PM-Full Convention Injection

When PM-Full is active, 5 PM principle conventions are injected into session start AFTER user conventions:

| # | Summary (≤80 chars) | Category |
|---|---|---|
| 1 | `Never advance a phase without documented exit criteria.` | pm-workflow |
| 2 | `Every decision requires a rationale. No undocumented choices.` | pm-discipline |
| 3 | `Ship working increments. Prove progress with deliverables, not words.` | pm-quality |
| 4 | `Identify risks before committing to estimates or approaches.` | pm-risk |
| 5 | `Track scope changes formally. No silent additions.` | pm-scope |

**Token cost:** ~75 tokens. Only delivered when PM-Full is active. PM-Lite adds zero conventions.

---

## 8. PM Mode Activation Actions

### 8.1 Admin Actions

```typescript
// Enable/disable PM features
engram_admin({ action: "enable_pm" })        // Activates PM-Full
engram_admin({ action: "disable_pm" })       // Deactivates PM-Full (reverts to PM-Lite)
engram_admin({ action: "disable_pm_lite" })  // Disables all PM features including nudges
engram_admin({ action: "enable_pm_lite" })   // Re-enables PM-Lite (the default state)
engram_admin({ action: "decline_pm" })       // Declines PM-Full offer permanently
engram_admin({ action: "reset_pm_offer" })   // Clears offer/decline flags (for re-offer)
engram_admin({ action: "pm_status" })        // Returns full PM diagnostic report
```

### 8.2 Agent Rules for PM (Conditional)

When PM-Full is active, 3 additional agent rules are injected:

```json
[
    {
        "priority": "HIGH",
        "rule": "When working on phase-tagged tasks, check phase gate checklist before marking the phase complete. Use get_knowledge(phase:N, type:'checklist').",
        "condition": "pm_full"
    },
    {
        "priority": "MEDIUM", 
        "rule": "Tag new tasks with phase:N (e.g., phase:planning, phase:execution) for phase tracking and automatic gate detection.",
        "condition": "pm_full"
    },
    {
        "priority": "MEDIUM",
        "rule": "Use get_knowledge(type:'estimation') before providing time estimates. Apply PERT formula: E=(O+4M+P)/6.",
        "condition": "pm_full"
    }
]
```

---

## 9. New Action: `get_knowledge`

A new action on `engram_memory` that queries the built-in knowledge base. **Only available when PM-Full is active.**

```typescript
// engram_memory({ action: "get_knowledge", ... })
{
  phase: z.number().int().min(1).max(6).optional(),
  type: z.enum(["principles", "phase_info", "checklist", "instructions", "estimation", "conventions", "all"]).optional().default("phase_info"),
  compact: z.boolean().optional().default(true),
  locale: z.string().optional().default("en"),  // i18n-ready (Q1)
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

### Guard: PM-Full Required

```typescript
case 'get_knowledge': {
    const pmFull = repos.config.get('pm_full_enabled');
    if (pmFull !== 'true') {
        return error('get_knowledge requires PM-Full mode. Call engram_admin(action:"enable_pm") to activate.');
    }
    // ... handle knowledge query
}
```

---

## 10. Phase-Aware Task System

### 10.1 Phase Tags Convention

Tasks created while PM-Full is active support a phase tag convention:

```js
engram_memory({ action: "create_task", title: "Complete WBS", tags: ["phase:planning"], priority: "high" })
```

The `phase:` prefix is recognized by:
- Session start: auto-detects current phase from highest-priority open phase-tagged task
- Workflow advisor: knows what phase the project is in
- Event trigger: auto-creates phase gate check when all tasks for a phase are done

### 10.2 Current Phase Detection

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
  return Math.min(...phaseTasks.map(t => t.phase!));
}

const PHASE_MAP: Record<string, number> = {
  initiation: 1, planning: 2, execution: 3,
  quality: 4, finalization: 5, handover: 6, documentation: 6,
};
```

### 10.3 Auto Phase Gate Events

When ALL tasks tagged `phase:N` are marked done, Engram auto-schedules a phase gate event:

```typescript
function onTaskComplete(taskId: number): void {
  const task = repos.tasks.getById(taskId);
  const tags: string[] = task?.tags ? JSON.parse(task.tags) : [];
  const phaseTag = tags.find(t => t.startsWith('phase:'));
  if (!phaseTag) return;

  const phaseNum = PHASE_MAP[phaseTag.split(':')[1]];
  if (!phaseNum) return;

  const remaining = repos.tasks.getFiltered({ tag: phaseTag, includeDone: false, limit: 1 });
  if (remaining.length > 0) return;

  repos.events.create(getCurrentSessionId(), now(), {
    title: `Phase Gate ${phaseNum}→${phaseNum + 1} — Review Required`,
    description: `All ${phaseTag} tasks are complete. Review the Phase Gate ${phaseNum} checklist before proceeding.`,
    trigger_type: 'next_session',
    priority: 'high',
    tags: ['pm-framework', `phase-gate-${phaseNum}`],
  });
}
```

### 10.4 User-Editable Checklists (Q4 Resolved)

Phase gate checklists ship with built-in defaults from the knowledge base. Users can extend them:

- **Built-in checks** are immutable — they come from `src/knowledge/checklists.ts` and update with npm
- **Custom checks** are stored as conventions with category `pm-gate-{N}` (e.g., `pm-gate-3`)
- When an agent queries `get_knowledge(phase:3, type:'checklist')`, the response merges built-in + custom checks
- Custom checks are marked with `source: 'user'` so agents can distinguish them

```typescript
function getChecklist(phase: number, repos: Repositories): ChecklistItem[] {
  const builtIn = knowledge.getChecklist(phase).map(item => ({ ...item, source: 'built-in' as const }));
  
  // Merge user-defined gate checks from conventions
  const userChecks = repos.conventions
    .getFiltered({ category: `pm-gate-${phase}`, includeDisabled: false })
    .map(c => ({ id: `user-${c.id}`, check: c.rule, mandatory: false, source: 'user' as const }));
  
  return [...builtIn, ...userChecks];
}
```

---

## 11. Schema Migration V23

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

-- Add PM config entries (V23)
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('pm_lite_enabled', 'true', datetime('now'));
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('pm_full_enabled', 'false', datetime('now'));
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('pm_full_offered', 'false', datetime('now'));
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('pm_full_declined', 'false', datetime('now'));
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('pm_framework_version', '1.0', datetime('now'));
```

---

## 12. README Agent Instructions (NEW in v2)

### 12.1 New Section: "Project Management Mode"

The following section will be added to the README after the "Scheduled Events" section:

```markdown
### Project Management Mode

Engram includes a built-in Project Execution Framework with two levels:

**PM-Lite (ON by default):** Provides smart workflow nudges — reminders to record changes,
check file notes, and log decisions. No extra configuration needed. Disable with
`engram_admin(action:"disable_pm_lite")`.

**PM-Full (opt-in):** Activates the full 6-phase project management framework with:
- Phase-aware task tagging (`tags: ["phase:planning"]`)
- Phase gate checklists (auto-triggered when phase tasks complete)
- Built-in knowledge base: principles, instructions, estimation guidance
- Extended workflow nudges for phase discipline, scope control, and risk management

Enable with `engram_admin(action:"enable_pm")`. Engram will also offer PM-Full
automatically when it detects structured project work (3+ tasks, phase tags, or PM keywords).

**Knowledge Base queries** (PM-Full only):
| Query | Returns |
|-------|---------|
| `engram_memory(action:"get_knowledge", type:"principles")` | 5 core PM principles |
| `engram_memory(action:"get_knowledge", phase:3, type:"phase_info")` | Phase 3 entry/exit criteria + instruction summaries |
| `engram_memory(action:"get_knowledge", phase:3, type:"checklist")` | Phase Gate 3→4 checklist |
| `engram_memory(action:"get_knowledge", type:"estimation")` | PERT formula and estimation guidance |

**Diagnostics:** `engram_admin(action:"pm_status")` returns PM health, detected phase,
advisor state, and recent failures.
```

### 12.2 Agent Rules Update

The `AGENT_RULES_START`/`AGENT_RULES_END` block in the README gains a conditional PM-Full rule:

```json
{
    "priority": "MEDIUM",
    "rule": "When PM-Full mode is active: tag tasks with phase:N, check phase gate checklists before advancing phases, use get_knowledge for PM guidance.",
    "condition": "pm_full_enabled"
}
```

This rule is only included in the agent rules response when `pm_full_enabled === 'true'`.

### 12.3 copilot-instructions.md Update

Add a brief PM section to `.github/copilot-instructions.md`:

```markdown
## Project Management Mode

Engram ships a built-in PM framework. PM-Lite is ON by default (workflow nudges).
PM-Full is opt-in (`engram_admin(action:"enable_pm")`) — provides phase gates,
checklists, and knowledge base. Use `get_knowledge` to query PM content.
Check `pm_status` if PM features seem broken — PM failures never block core Engram.
```

---

## 13. File Change Summary

### New Files
| File | Purpose |
|---|---|
| `src/knowledge/index.ts` | Public API for knowledge base |
| `src/knowledge/types.ts` | KnowledgeEntry interface + phase types |
| `src/knowledge/principles.ts` | 5 core principles (compact + full) |
| `src/knowledge/phases.ts` | 6 phase definitions with entry/exit criteria |
| `src/knowledge/checklists.ts` | Phase gate checklists (structured arrays) |
| `src/knowledge/instructions.ts` | Per-phase instruction summaries |
| `src/knowledge/estimation.ts` | PERT formula + estimation guidance |
| `src/knowledge/conventions.ts` | Default PM convention set |
| `src/services/workflow-advisor.service.ts` | Behavior tracking + smart nudging |
| `src/services/pm-diagnostics.ts` | PM failure tracking + diagnostics |
| `tests/knowledge/knowledge.test.ts` | Knowledge base tests |
| `tests/services/advisor.test.ts` | Advisor tests |
| `tests/services/pm-diagnostics.test.ts` | Diagnostics tests |

### Modified Files
| File | Changes |
|---|---|
| `src/errors.ts` | +4 PM error classes (PMFrameworkError, PMKnowledgeError, PMAdvisorError, PMPhaseError) |
| `src/migrations.ts` | V23 migration (summary + tags on conventions, PM config entries) |
| `src/types.ts` | ConventionRow + summary/tags fields |
| `src/constants.ts` | PM-related constants (PM_KEYWORDS, PHASE_MAP, PM_MAX_NUDGES) |
| `src/database.ts` | Advisor + diagnostics service initialization |
| `src/repositories/conventions.repo.ts` | getActiveFocused() method, summary field |
| `src/tools/sessions.ts` | intent param, convention summary delivery, focus-aware conventions, PM-Full convention injection |
| `src/tools/dispatcher-memory.ts` | get_knowledge action, advisor wire-up, pmSafe wrapper |
| `src/tools/dispatcher-admin.ts` | enable_pm/disable_pm/enable_pm_lite/disable_pm_lite/decline_pm/reset_pm_offer/pm_status actions |
| `src/tools/find.ts` | Catalog entries for new actions, PM-conditional agent rules |
| `src/services/event-trigger.service.ts` | Phase gate auto-scheduling |
| `src/services/index.ts` | Export advisor + diagnostics services |
| `README.md` | PM framework section + updated agent rules |
| `.github/copilot-instructions.md` | PM section |

---

## 14. Token Efficiency Summary

### Baseline (No PM / PM-Lite)

| Scenario | Cost |
|---|---|
| Session start (summary) — PM-Lite | ~730 t (identical to current — nudges are reactive) |
| Session start (quick_op) | ~200 t |
| Per-tool-call overhead (PM-Lite) | 0-30 t (nudge appears at most 5 times total per session) |

### With PM-Full Enabled

| Scenario | Cost |
|---|---|
| Session start (summary) + 5 PM principles | ~805 t (+75 t) |
| Session start (quick_op) | ~200 t (no PM content) |
| Session start (phase_work) | ~900 t (phase info included) |
| `get_knowledge` calls (agent-initiated) | 60–800 t per call (on-demand) |
| PM-Full advisor nudges (per session average) | ~75 t (2-3 nudges avg) |
| Phase gate event (triggered at phase completion) | ~30 t (in triggered_events) |

### Comparison to Naive Approach

| Approach | Session Cost | Per-Call Cost | Total for 10-call session |
|---|---|---|---|
| **Naive:** 15 conventions + 22 file notes in session start | ~4,000 t | 0 t | ~4,000 t |
| **Current:** No PM framework | ~730 t | 0 t | ~730 t |
| **PM-Lite:** Basic nudges only | ~730 t | ~15 t (avg) | ~880 t |
| **PM-Full:** phase_work intent | ~900 t | ~30 t (avg) | ~1,200 t |
| **PM-Full:** quick_op intent | ~200 t | ~30 t | ~500 t |

PM-Lite costs essentially nothing vs. current behavior. PM-Full adds ~150-470 tokens per session vs. current, compared to ~3,270 tokens for the naive bulk-load approach. That is a **68–95% reduction** in overhead.

---

## 15. Risk Assessment

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Advisor nudges annoy agents → agents start ignoring Engram responses | High | Once-per-session per nudge type. Max 5 unique nudges per session. Clear `_advisor` key for programmatic filtering. |
| R2 | Knowledge base grows stale as PM methodology evolves | Medium | Knowledge is TypeScript data, versioned with npm. Updated via `npm update`. No user data migration needed. |
| R3 | PM mode changes session start behavior unexpectedly | Medium | PM-Lite adds zero to session start. PM-Full is opt-in with explicit `enable_pm`. `intent: "quick_op"` skips all PM content. |
| R4 | Convention summary backfill with SUBSTR produces low-quality summaries | Low | SUBSTR(rule, 1, 80) is a temporary default. Agents are prompted to improve via `get_conventions` > edit. |
| R5 | Phase detection from tags is fragile | Low | Uses a well-defined `phase:` prefix convention. Fails gracefully to `null` (no phase detected, no PM features fire). |
| R6 | PM error cascading breaks core operations | High | All PM paths use `pmSafe()` isolation boundary. PM errors logged but never thrown. `pm_status` for diagnostics. |
| R7 | Auto-detection false positives spam the PM-Full offer | Medium | Requires ≥3 tasks OR explicit phase tags OR PM keywords AND never offered twice (config flag). |
| R8 | PM-Lite nudges conflict with user's custom agent rules | Low | PM-Lite nudge messages align with existing agent rules (record_change, file_notes). `disable_pm_lite` available if conflict exists. |
| R9 | FTS5 convention filtering fails on non-standard SQLite builds | Low | `getActiveFocused()` wraps in try/catch, falls back to `getActive()`. Tests validate FTS path. |
| R10 | Two-level system confuses users about what's active | Medium | `pm_status` diagnostic action reports exact state. Session start includes `pm_mode` field when any PM is active. |

---

## 16. Open Questions — RESOLVED

| # | Question | Resolution | Rationale |
|---|---|---|---|
| Q1 | Should the knowledge base be localizable? | **Yes, planned for future.** `locale` field added to KnowledgeEntry now (default: `'en'`). Interface won't break when i18n is added later. | User strongly agrees with i18n direction. Preparing the interface now avoids future breaking changes. |
| Q2 | Should PM auto-enable on first session? | **Two-level system.** PM-Lite auto-ON by default. PM-Full offered when structured work detected, not auto-enabled. | Reconciles user's "auto-ON" preference with "ability to turn off" requirement. Lite = zero-cost ambient value. Full = explicit opt-in. |
| Q3 | Should advisor persist across sessions? | **Session-scoped initially.** Cross-session patterns deferred to v2. | Avoids complexity. Session scope is sufficient for nudge-once-per-session semantics. |
| Q4 | Should phase gate checklists be editable? | **Built-in defaults + user custom.** User checks stored as conventions with `pm-gate-{N}` category, merged at query time. | Balances standardization with project-specific flexibility. User checks are non-mandatory by default. |

---

## 17. Implementation Roadmap — A to Z (NEW in v2)

### 17.1 Branch Strategy

```
main ─────────────────────────────────────────────────────────────────────────►
  │
  └─ develop ─────────────────────────────────────────────────────────────────►
       │
       ├─ feature/pm-error-infra ──────► merge to develop
       │
       ├─ feature/pm-convention-upgrade ──────► merge to develop
       │
       ├─ feature/pm-knowledge-base ──────────► merge to develop
       │
       ├─ feature/pm-session-intent ──────────► merge to develop
       │
       ├─ feature/pm-workflow-advisor ────────► merge to develop
       │
       ├─ feature/pm-phase-system ────────────► merge to develop
       │
       ├─ feature/pm-admin-actions ───────────► merge to develop
       │
       ├─ feature/pm-readme-docs ─────────────► merge to develop
       │
       └─ feature/pm-tests ──────────────────► merge to develop
                                                │
                                          develop → main (release)
```

**Each feature branch:**
- Created from latest `develop`
- Has its own PR / code review checkpoint
- Must pass `npm test` and `npm run build` before merge
- Merged to `develop` via fast-forward or squash

### 17.2 Detailed Step-by-Step

---

#### Step 0: Pre-Implementation Verification
**Branch:** `develop` (no new branch)  
**Goal:** Ensure clean starting state

| # | Action | Verification |
|---|---|---|
| 0.1 | Run `npm test` — all tests pass | Green CI |
| 0.2 | Run `npm run build` — compiles clean | No errors |
| 0.3 | Verify `develop` is up-to-date with `main` | `git log --oneline main..develop` |
| 0.4 | Record Decision #33 (PM plan v2) in Engram | Decision recorded |

---

#### Step 1: PM Error Infrastructure
**Branch:** `feature/pm-error-infra`  
**Risk:** Low  
**Files touched:** `src/errors.ts`, `src/services/pm-diagnostics.ts`, `src/services/index.ts`, `tests/services/pm-diagnostics.test.ts`

| # | Action | Details |
|---|---|---|
| 1.1 | Add `PMFrameworkError`, `PMKnowledgeError`, `PMAdvisorError`, `PMPhaseError` to `src/errors.ts` | Subclasses of EngramError |
| 1.2 | Create `src/services/pm-diagnostics.ts` with `PMDiagnosticsTracker` class | In-memory failure tracker, `getStatus()`, `recordFailure()`, `reset()` |
| 1.3 | Create `pmSafe<T>()` utility function | Either in `src/utils.ts` or `src/services/pm-diagnostics.ts` |
| 1.4 | Export from `src/services/index.ts` | Add barrel export |
| 1.5 | Write tests: `tests/services/pm-diagnostics.test.ts` | Test recordFailure, getStatus, max count, reset |
| 1.6 | Run `npm test` + `npm run build` | Must pass |
| 1.7 | Merge to `develop` | Fast-forward |

**Milestone:** PM error infrastructure in place. No behavioral changes. No risk.

---

#### Step 2: Convention Schema Upgrade (V23)
**Branch:** `feature/pm-convention-upgrade`  
**Risk:** Medium (schema migration)  
**Files touched:** `src/migrations.ts`, `src/types.ts`, `src/repositories/conventions.repo.ts`, `src/constants.ts`

| # | Action | Details |
|---|---|---|
| 2.1 | Add V23 migration to `src/migrations.ts` | `ALTER TABLE conventions ADD COLUMN summary TEXT`, `ALTER TABLE conventions ADD COLUMN tags TEXT`, backfill, FTS trigger rebuild, PM config entries |
| 2.2 | Update `ConventionRow` in `src/types.ts` | Add `summary?: string`, `tags?: string` |
| 2.3 | Update `ConventionsRepo.create()` to accept `summary` and `tags` | New params |
| 2.4 | Add `ConventionsRepo.getActiveFocused(ftsQuery, limit)` method | FTS5-ranked convention retrieval with fallback |
| 2.5 | Update `DB_VERSION` in `src/constants.ts` to 23 | Bump version |
| 2.6 | Add PM constants: `PHASE_MAP`, `PM_KEYWORDS`, `PM_MAX_NUDGES` | In `src/constants.ts` |
| 2.7 | Write/update tests for convention repo | Test getActiveFocused, summary field, tags field |
| 2.8 | Run `npm test` + `npm run build` | Must pass |
| 2.9 | Test migration on a real DB (manual) | Run locally against `.engram/memory.db` |
| 2.10 | Merge to `develop` | Squash merge |

**Milestone:** Convention table upgraded. Summary delivery ready. No PM behavior yet.

---

#### Step 3: Knowledge Base Module
**Branch:** `feature/pm-knowledge-base`  
**Risk:** Low (new code, no existing changes)  
**Files touched:** All new files in `src/knowledge/`

| # | Action | Details |
|---|---|---|
| 3.1 | Create `src/knowledge/types.ts` | KnowledgeEntry interface with locale field |
| 3.2 | Create `src/knowledge/principles.ts` | 5 core principles, compact + full |
| 3.3 | Create `src/knowledge/phases.ts` | 6 phase definitions with entry/exit criteria |
| 3.4 | Create `src/knowledge/checklists.ts` | Phase gate checklists as structured arrays |
| 3.5 | Create `src/knowledge/instructions.ts` | Per-phase instruction summaries |
| 3.6 | Create `src/knowledge/estimation.ts` | PERT formula + estimation guidelines |
| 3.7 | Create `src/knowledge/conventions.ts` | Default PM convention set (5 principles as conventions) |
| 3.8 | Create `src/knowledge/index.ts` | Public API: getPhase(), getPrinciples(), getChecklist(), getInstruction(), getEstimation() |
| 3.9 | Write tests: `tests/knowledge/knowledge.test.ts` | Test all public API functions, compact/full formats, edge cases |
| 3.10 | Run `npm test` + `npm run build` | Must pass |
| 3.11 | Merge to `develop` | Fast-forward |

**Milestone:** Knowledge base is queryable but not wired to any dispatcher. Can be tested in isolation.

---

#### Step 4: Session Start Improvements
**Branch:** `feature/pm-session-intent`  
**Risk:** Medium (modifies critical session start path)  
**Files touched:** `src/tools/sessions.ts`

| # | Action | Details |
|---|---|---|
| 4.1 | Add `intent` parameter to session start schema | `z.enum(["full_context", "quick_op", "phase_work"]).optional().default("full_context")` |
| 4.2 | Implement `quick_op` intent path | Return only session_id, agent_rules, tool_catalog. Skip changes, decisions, git log. |
| 4.3 | Replace truncated convention delivery with `summary` field | Use `c.summary \|\| truncate(c.rule, 80)` |
| 4.4 | Add focus-aware convention filtering | Call `getActiveFocused()` when focus param present |
| 4.5 | Add PM-Full convention injection | When `pm_full_enabled`, inject 5 PM conventions after user conventions |
| 4.6 | Add `pm_mode` field to session start response | `pm_mode: 'lite' | 'full' | 'disabled'` |
| 4.7 | Implement `phase_work` intent path | Full context + current phase knowledge (PM-Full only) |
| 4.8 | Write/update tests for session start | Test each intent, convention delivery, PM injection |
| 4.9 | Run `npm test` + `npm run build` | Must pass |
| 4.10 | Manual smoke test: start session with each intent | Verify token counts match plan |
| 4.11 | Merge to `develop` | Squash merge |

**Milestone:** Session start is smarter. Convention delivery uses summaries. Focus filtering works. PM conventions inject when enabled.

---

#### Step 5: Workflow Advisor Service
**Branch:** `feature/pm-workflow-advisor`  
**Risk:** Medium (new service, wired into dispatcher response pipeline)  
**Files touched:** `src/services/workflow-advisor.service.ts`, `src/services/index.ts`, `src/database.ts`, `src/tools/dispatcher-memory.ts`

| # | Action | Details |
|---|---|---|
| 5.1 | Create `src/services/workflow-advisor.service.ts` | Full implementation: recordAction, checkNudge, lite/full checks |
| 5.2 | Wire advisor into `Services` interface in `src/database.ts` | Add `advisor: WorkflowAdvisorService` to Services |
| 5.3 | Initialize advisor in `createServices()` | Pass repos + diagnostics to constructor |
| 5.4 | Export from `src/services/index.ts` | Add barrel export |
| 5.5 | Wire `recordAction()` into dispatcher-memory | Call after every action dispatch |
| 5.6 | Wire `checkNudge()` into dispatcher-memory response | Use `pmSafe()` wrapper. Inject `_advisor` field. |
| 5.7 | Implement PM-Full eligibility check (auto-detection) | Track task creations, check triggers, offer PM-Full |
| 5.8 | Write tests: `tests/services/advisor.test.ts` | Test each nudge check, max nudges, PM-Full detection |
| 5.9 | Run `npm test` + `npm run build` | Must pass |
| 5.10 | Manual smoke test: create 3+ tasks, verify PM-Full offer | Advisor fires correctly |
| 5.11 | Merge to `develop` | Squash merge |

**Milestone:** Workflow advisor is live. PM-Lite nudges fire. PM-Full auto-detection works.

---

#### Step 6: Phase System & Gate Automation
**Branch:** `feature/pm-phase-system`  
**Risk:** Medium (modifies event-trigger service)  
**Files touched:** `src/services/event-trigger.service.ts`, `src/services/workflow-advisor.service.ts`

| # | Action | Details |
|---|---|---|
| 6.1 | Add `detectCurrentPhase()` function | Phase detection from task tags using PHASE_MAP |
| 6.2 | Add auto phase gate event scheduling | When all tasks for a phase complete → schedule gate event |
| 6.3 | Wire phase gate detection into `triggerTaskCompleteEvents()` | Check phase tags on task completion |
| 6.4 | Add phase gate skip check to advisor | Nudge when agent marks phase done without gate checklist |
| 6.5 | Add user-editable checklist merging | Merge built-in + convention-stored checks |
| 6.6 | Write tests for phase detection and gate automation | Test PHASE_MAP, completion detection, event creation |
| 6.7 | Run `npm test` + `npm run build` | Must pass |
| 6.8 | Merge to `develop` | Squash merge |

**Milestone:** Phase system is operational. Gates auto-fire. Advisor checks gate compliance.

---

#### Step 7: Admin Actions & Knowledge Dispatcher
**Branch:** `feature/pm-admin-actions`  
**Risk:** Medium (new dispatcher routes)  
**Files touched:** `src/tools/dispatcher-admin.ts`, `src/tools/dispatcher-memory.ts`, `src/tools/find.ts`

| # | Action | Details |
|---|---|---|
| 7.1 | Add `get_knowledge` case to dispatcher-memory | Route to knowledge base API. Guard: PM-Full required. |
| 7.2 | Add `enable_pm` / `disable_pm` cases to dispatcher-admin | Set config flags, return status |
| 7.3 | Add `enable_pm_lite` / `disable_pm_lite` cases | Set config flags |
| 7.4 | Add `decline_pm` case | Set pm_full_declined flag |
| 7.5 | Add `reset_pm_offer` case | Clear offer/decline flags |
| 7.6 | Add `pm_status` case | Return full diagnostic report |
| 7.7 | Update `MEMORY_CATALOG` in find.ts | Add `get_knowledge` entry |
| 7.8 | Update `ADMIN_CATALOG` in find.ts | Add enable_pm, disable_pm, pm_status, etc. |
| 7.9 | Add PM-conditional agent rules | In agent rules service or find.ts |
| 7.10 | Write tests for all new admin actions | Test each action, config flag behavior |
| 7.11 | Run `npm test` + `npm run build` | Must pass |
| 7.12 | Merge to `develop` | Squash merge |

**Milestone:** All PM actions are dispatchable. Knowledge base is queryable. PM is controllable.

---

#### Step 8: Documentation & README
**Branch:** `feature/pm-readme-docs`  
**Risk:** Low (documentation only)  
**Files touched:** `README.md`, `.github/copilot-instructions.md`

| # | Action | Details |
|---|---|---|
| 8.1 | Add "Project Management Mode" section to README | After "Scheduled Events" section |
| 8.2 | Add PM action reference tables to README | get_knowledge, enable_pm, pm_status, etc. |
| 8.3 | Update agent rules JSON block in README | Add PM-Full conditional rule |
| 8.4 | Update `.github/copilot-instructions.md` | Add brief PM section |
| 8.5 | Proofread and verify all links | Manual check |
| 8.6 | Merge to `develop` | Fast-forward |

**Milestone:** Documentation complete. Agents can discover PM features from README.

---

#### Step 9: Integration Tests & Polish
**Branch:** `feature/pm-tests`  
**Risk:** Low (tests only — no behavioral changes)  
**Files touched:** `tests/tools/pm-flow.test.ts`, existing test files

| # | Action | Details |
|---|---|---|
| 9.1 | Write integration test: full PM-Lite flow | Session start → edits → nudge fires → record_change |
| 9.2 | Write integration test: PM-Full activation flow | Create 3 tasks → offer fires → enable_pm → get_knowledge works |
| 9.3 | Write integration test: phase gate flow | Create phase tasks → complete → gate event fires → checklist query |
| 9.4 | Write integration test: PM error isolation | Simulate knowledge base failure → core operations unaffected |
| 9.5 | Write integration test: PM disable/enable cycle | Enable > disable > re-enable, verify state |
| 9.6 | Run full test suite with coverage | `npm run test:coverage` |
| 9.7 | Fix any coverage gaps | Target ≥75% on new code |
| 9.8 | Final `npm run build` check | Clean compilation |
| 9.9 | Merge to `develop` | Fast-forward |

**Milestone:** Full test coverage. All PM features verified in integration.

---

#### Step 10: Release
**Branch:** `develop → main`  
**Risk:** Medium (release)

| # | Action | Details |
|---|---|---|
| 10.1 | Final test run on develop | `npm test && npm run build` |
| 10.2 | Update RELEASE_NOTES.md | Document PM-Lite, PM-Full, all new actions |
| 10.3 | Bump version in package.json | Semantic version (minor: 1.10.0 or 2.0.0) |
| 10.4 | Merge develop → main | FF merge |
| 10.5 | Publish to npm | `npm publish` |
| 10.6 | Tag release | `git tag v1.10.0` |
| 10.7 | Test fresh install | `npx engram-mcp-server --install` |

**Milestone:** PM framework shipped to all Engram users.

---

### 17.3 Implementation Order Constraints

```
Step 1 (error infra)
  └──► Step 2 (convention upgrade) ──► Step 4 (session improvements)
  └──► Step 3 (knowledge base) ────► Step 7 (admin/knowledge dispatcher)
                                       ▲
  Step 5 (advisor) ────────────────────┘
    └──► Step 6 (phase system) ────► Step 7
                                       │
                              Step 8 (docs) ──► Step 9 (tests) ──► Step 10 (release)
```

**Parallelizable pairs** (can be developed concurrently if multiple agents work):
- Steps 2 + 3 (convention upgrade + knowledge base) — no file overlap
- Steps 4 + 5 (session improvements + advisor) — minimal overlap, can be sequenced within a session

**Strictly sequential:**
- Step 1 must precede all others (error infra used everywhere)
- Step 7 requires Steps 3, 5, and 6
- Steps 8, 9, 10 are strictly sequential and come last

### 17.4 Estimated Effort

| Step | Estimated Time | Complexity |
|---|---|---|
| 0. Pre-verification | 15 min | Trivial |
| 1. Error infrastructure | 1-2 hours | Low |
| 2. Convention upgrade | 2-3 hours | Medium |
| 3. Knowledge base | 3-4 hours | Medium |
| 4. Session improvements | 2-3 hours | Medium |
| 5. Workflow advisor | 3-4 hours | Medium-High |
| 6. Phase system | 2-3 hours | Medium |
| 7. Admin actions/dispatcher | 2-3 hours | Medium |
| 8. Documentation | 1-2 hours | Low |
| 9. Integration tests | 2-3 hours | Medium |
| 10. Release | 30 min | Low |
| **Total** | **~18-27 hours** | |

---

## 18. Decision Record

This plan constitutes an architectural decision. When implementation begins, record:

```js
engram_memory({
  action: "record_decision",
  decision: "PM framework v2: Two-level system (PM-Lite auto-ON, PM-Full opt-in). Error isolation via pmSafe() pattern. Auto-detection offers PM-Full on structured work. Knowledge base with i18n-ready locale field. 10-step implementation roadmap with feature branches.",
  rationale: "Reconciles 'auto-ON by default' with 'user toggle-off' via two levels. PM-Lite costs zero tokens. PM-Full adds 75t. Error infrastructure ensures PM never breaks core Engram. Feature branches allow incremental, verifiable progress.",
  supersedes: 32,
  tags: ["pm-framework", "architecture", "two-level", "error-handling", "implementation-roadmap"],
  affected_files: "src/knowledge/*, src/services/workflow-advisor.service.ts, src/services/pm-diagnostics.ts, src/errors.ts, src/tools/sessions.ts, src/migrations.ts, README.md"
})
```
