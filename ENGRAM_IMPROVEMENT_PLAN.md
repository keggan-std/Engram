# Engram v1.6+ Improvement Plan
## Challenges Encountered + Enhancement Proposals

*Compiled from direct experience across the v1.5.0 multi-session development run.*
*Each item includes a suggested Engram record type so you can feed them straight into the tool.*

---

## Part 1 — Real Challenges Faced

These are things that actually went wrong or caused friction during the v1.5.0 development work. They are the honest, unfiltered account requested.

---

### C1 · File Corruption by Concurrent Agents

**What happened:**
The F4 background agent was tasked with adding a `context_chars` enrichment block inside `intelligence.ts`. Instead of editing the file in-place with precise line targeting, it appended the entire enrichment block — and then a full duplicate of the file — *after* the closing `}` of `registerIntelligenceTools`. The file ballooned from ~440 lines to 923 lines with the second half being dead code. TypeScript still compiled because the export was at the top.

**Why Engram couldn't prevent it:**
- There was no file-level lock. Nothing stopped two agents from opening the same file simultaneously.
- The background agent never called `engram_set_file_notes` after its edit, so the next session found stale notes and had to discover the corruption by reading the file directly.
- There was no "pending change" record declaring intent before the edit started. No other agent could have known a write was in progress.

**Impact:** ~45 minutes of debugging and reconstruction using a Node.js script.

---

**→ Engram Record to Create:**
```
Tool: engram_record_decision
decision: "All agents must call engram_set_file_notes immediately after every file edit, not just after first read"
rationale: "The F4 background agent corrupted intelligence.ts by appending code after the closing brace. Had file notes been updated post-edit, the next session would have detected the mtime change and flagged staleness immediately rather than discovering 923 lines."
tags: ["architecture", "multi-agent", "file-safety"]
status: "active"
```

---

### C2 · Background Agents Don't Record Their Changes

**What happened:**
The background agents for F4 (quality-of-life features) completed their work — adding `sessions.ts` suggest_commit tool, `stats.ts` duration fields, `report.ts`, and the corrupted `intelligence.ts` — but none of them called `engram_record_change`. When the next session started, `engram_start_session` returned *zero* changes since last session. The agent had to discover what changed by reading every modified file from scratch.

**Why this matters:**
The entire value of Engram's change tracking depends on agents actually reporting changes. If background agents (sub-agents, parallel workers) are exempt because they don't have direct `engram_record_change` instructions, the history becomes a lie of omission.

**Impact:** The session couldn't reconstruct "what was attempted" from Engram — it had to diff files manually.

---

**→ Engram Record to Create:**
```
Tool: engram_add_convention
category: "architecture"
rule: "Every agent — including background/parallel sub-agents — must call engram_record_change after editing files. The parent agent is responsible for recording changes that sub-agents made if the sub-agent did not do so itself."
```

---

### C3 · Context Window Exhaustion Mid-Task

**What happened:**
The session ran out of context window while updating README.md — the last item in a multi-task batch that also included RELEASE_NOTES.md, a challenges discussion, and compaction. The conversation summary was auto-generated and the next continuation session had to reconstruct exactly where work stopped.

**Why Engram helped but not enough:**
- `engram_end_session` was called proactively when context was still available, which preserved the session summary.
- But there was no mid-session warning that context pressure was building. The agent had no signal to start wrapping up until it was already too late.
- If `engram_check_events` had returned a "context pressure" signal based on session duration or tool-call count, a graceful handoff could have been initiated 5–10 minutes earlier.

**Impact:** README.md was not updated in the first context window — required a full continuation session just for docs.

---

**→ Engram Record to Create:**
```
Tool: engram_record_decision
decision: "When working on large multi-step tasks, call engram_end_session and create tasks for incomplete work proactively — do not wait until context is exhausted"
rationale: "Context window exhaustion during README update left work incomplete and required a continuation session. A deliberate mid-session save point would have preserved more precision."
tags: ["workflow", "session-management"]
```

---

### C4 · Git Branch Switching Wiped Uncommitted Changes

**What happened:**
F2, F3, and F4 feature branches existed simultaneously with overlapping changes to `src/index.ts` and `src/types.ts`. Switching between branches with `git checkout` would have overwritten uncommitted work. The workaround was to commit each branch's changes before switching — but the correct order wasn't obvious until files were already at risk.

**Why Engram couldn't help:**
- Engram has no knowledge of the current git branch, so `engram_start_session` context doesn't include "you are on branch X, which has Y uncommitted changes."
- File notes store no branch metadata. Notes written on `feature/quality-of-life` are served identically when the agent is on `feature/smart-dump-coordination`.

**Impact:** Had to carefully sequence commits to avoid data loss. The sequence wasn't obvious and required reasoning from first principles about git state.

---

**→ Engram Record to Create:**
```
Tool: engram_record_decision
decision: "Before switching git branches, always commit or stash all modified files. Never rely on git to preserve uncommitted working tree changes during checkout."
rationale: "Multi-branch v1.5.0 development required careful commit sequencing to avoid overwriting uncommitted work when switching between feature branches."
tags: ["git", "workflow"]
```

---

### C5 · Merge Conflicts Had No Engram Guidance

**What happened:**
All three feature branches (F2, F3, F4) independently added imports and `registerXxxTools(server)` calls to `src/index.ts`. Every merge produced a conflict at the same spot. The conflict resolution was correct — keep both sides — but Engram played no role in knowing this. The agent had to reason it out from reading the code.

**What would have helped:**
If each feature branch had recorded a decision like "This branch adds `registerCoordinationTools` to the bottom of the tool registrations block in `src/index.ts`", those decisions would have surfaced during conflict resolution and made the answer obvious without reading the code.

---

**→ Engram Record to Create:**
```
Tool: engram_add_convention
category: "architecture"
rule: "When a feature branch modifies a shared file (like src/index.ts), record an engram_record_decision with affected_files pointing to that file, describing exactly what was added. This guides merge conflict resolution."
```

---

### C6 · No Rollback Path for Corrupted Files

**What happened:**
When `intelligence.ts` was found to be 923 lines (doubled), there was no Engram record of what the file *should* look like. The backup DB preserved session summaries but not file content snapshots. Reconstruction required reading the original file structure from context, reasoning about where the corruption started, and writing a Node.js recovery script.

**What would have helped:**
A content hash stored in file notes would have at minimum confirmed "this file has changed unexpectedly." A stored snapshot of the last-known-good content (or a diff from that baseline) would have enabled surgical recovery.

---

**→ Engram Record to Create (as a task/feature request):**
```
Tool: engram_create_task
title: "Add optional file content hash to engram_set_file_notes"
description: "Store a SHA-256 of file content at note-write time. On engram_get_file_notes, compare against current file hash. If hashes differ, confidence drops to 'stale' regardless of mtime. This enables corruption detection (mtime can be the same if content was overwritten in place)."
priority: "medium"
tags: ["feature", "file-safety", "v1.6"]
```

---

### C7 · Sub-Agent Instructions Were Ambiguous About Engram Usage

**What happened:**
Background agents were launched with task descriptions that described *what* to build but not *how to integrate with Engram*. They built features correctly but skipped: calling `engram_record_change`, calling `engram_set_file_notes` after editing, and checking existing decisions before making design choices.

**Root cause:**
The agents operated from their general system instructions, which didn't include explicit Engram workflow steps for sub-agent contexts (no session start/end since they're headless, but they still should record changes).

---

**→ Engram Record to Create:**
```
Tool: engram_add_convention
category: "architecture"
rule: "Sub-agent task descriptions must explicitly include: (1) which files to edit, (2) a reminder to call engram_record_change after edits, (3) a reminder to call engram_set_file_notes after reading any file for the first time."
```

---

## Part 2 — Proposed New Features

These are ideas for making Engram a more capable co-worker for AI agents. They are ranked roughly by impact-to-effort ratio.

---

### F1 · File Write Locks (High Impact / Medium Effort)

**Problem it solves:** C1, C6 — prevents concurrent agents from corrupting each other's work.

**Proposed tool:** `engram_lock_file(file_path, agent_id, reason, timeout_minutes)`

An agent declares intent to modify a file before touching it. Other agents calling `engram_get_file_notes` on a locked file receive a warning: `"LOCKED by agent-backend (reason: refactoring auth flow). Locked 3 min ago. Expires in 12 min."` The lock auto-expires to prevent deadlocks. The locking agent calls `engram_unlock_file` when done.

**DB change needed:** Add `file_locks` table: `file_path, agent_id, reason, locked_at, expires_at`.

**Integration point:** `engram_set_file_notes` automatically acquires/refreshes a soft lock. `engram_get_file_notes` returns lock status in the response.

---

**→ Engram Record to Create:**
```
Tool: engram_create_task
title: "Implement engram_lock_file / engram_unlock_file tools"
description: "Add file-level locking to prevent concurrent agent corruption. Schema: file_locks table (file_path TEXT PK, agent_id TEXT, reason TEXT, locked_at INTEGER, expires_at INTEGER). engram_get_file_notes returns lock_status field. engram_set_file_notes acquires a soft lock. engram_lock_file/engram_unlock_file for explicit control. Locks auto-expire after timeout_minutes. releaseStale() clears expired locks."
priority: "high"
tags: ["feature", "multi-agent", "file-safety", "v1.6"]
```

---

### F2 · Intent Recording Before Work Begins (High Impact / Low Effort)

**Problem it solves:** C1, C2 — creates a trail of what was *attempted*, not just what was *completed*.

**Proposed tool:** `engram_begin_work(description, files, agent_id)`

Before touching files, an agent records its intent. This creates a `pending_work` record. When `engram_record_change` is called for those files, the pending record is automatically closed. If a session ends without the change being recorded, the pending work shows up as `abandoned` — a red flag for the next session to investigate.

**Benefit for recovery:** When `intelligence.ts` was corrupted, an intent record ("about to add context_chars enrichment block inside the search handler for loop") would have told the recovery agent exactly what was being attempted and where.

---

**→ Engram Record to Create:**
```
Tool: engram_create_task
title: "Add engram_begin_work / pending_work tracking"
description: "Add pending_work table: (id, agent_id, description, files JSON, started_at, status: pending|completed|abandoned). engram_begin_work() creates a record. engram_record_change() auto-closes matching pending records. engram_start_session() surfaces abandoned pending_work as warnings. Helps diagnose partial work and corruption."
priority: "high"
tags: ["feature", "multi-agent", "session-continuity", "v1.6"]
```

---

### F3 · Context Pressure Detection (High Impact / Low Effort)

**Problem it solves:** C3 — gives agents a signal to wrap up before running out of context.

**Proposed tool:** Enhancement to `engram_check_events`

Engram tracks: session start time, number of `engram_record_change` calls this session, number of decisions/tasks created, and total characters in the session summary so far. When these exceed configurable thresholds, `engram_check_events` returns a new event type: `context_pressure`.

```json
{
  "type": "context_pressure",
  "severity": "warning",
  "message": "Session has been running 47 minutes with 23 tool calls. Consider calling engram_end_session soon and creating tasks for remaining work.",
  "suggestions": ["engram_end_session", "engram_create_task"]
}
```

Agents that call `engram_check_events` periodically (already recommended in the prompt guide) would receive this and can initiate a graceful handoff.

---

**→ Engram Record to Create:**
```
Tool: engram_create_task
title: "Add context_pressure event type to engram_check_events"
description: "Track session duration (minutes since started_at), tool_call_count (increment on each tool invocation), and decisions/changes recorded. When thresholds are exceeded (e.g., >30 min, >20 tool calls, or >5000 chars of accumulated changes), return a context_pressure event from engram_check_events. Thresholds configurable via engram_config. This gives agents a proactive signal to wrap up before context exhaustion."
priority: "high"
tags: ["feature", "session-management", "quality-of-life", "v1.6"]
```

---

### F4 · Branch-Aware File Notes (Medium Impact / Low Effort)

**Problem it solves:** C4 — file notes from one branch don't silently mislead agents on another.

**Proposed change:** Store the git branch name in `file_notes` at write time (`git_branch TEXT`). On `engram_get_file_notes`, if the current branch differs from the stored branch, add a `branch_warning` to the response: `"Note was written on branch feature/quality-of-life. Current branch is main. File may differ."`

**DB change:** `ALTER TABLE file_notes ADD COLUMN git_branch TEXT;`

The branch is captured via `git rev-parse --abbrev-ref HEAD` at write time. If git is unavailable, the field is null and no warning is shown.

---

**→ Engram Record to Create:**
```
Tool: engram_create_task
title: "Add git_branch column to file_notes for branch-aware staleness detection"
description: "On engram_set_file_notes, store git rev-parse --abbrev-ref HEAD result in new git_branch column. On engram_get_file_notes, if stored branch != current branch, add branch_warning to response. DB migration V7. This prevents notes written on feature branches from silently misleading agents on main or other branches."
priority: "medium"
tags: ["feature", "file-safety", "git", "v1.6"]
```

---

### F5 · Convention Enforcement Linting (Medium Impact / Medium Effort)

**Problem it solves:** Conventions are stored but never actively checked — they're only as good as the agent's memory to apply them.

**Proposed tool:** `engram_lint(file_path, content_snippet)`

The agent passes a file path and a snippet of code (or the full file content). Engram retrieves conventions relevant to that file's category/layer (from file notes) and uses simple pattern matching to flag potential violations. Returns structured violations:

```json
{
  "violations": [
    {
      "convention_id": 3,
      "rule": "Always use bcrypt cost factor 12 for password hashing",
      "hint": "Found 'bcrypt.hash(password, 10)' — cost factor should be 12",
      "line_hint": "Search for bcrypt.hash"
    }
  ]
}
```

This doesn't require an LLM for basic pattern rules. Convention rules that include `pattern: "regex"` in their examples can be checked automatically.

---

**→ Engram Record to Create:**
```
Tool: engram_create_task
title: "Add engram_lint tool for convention enforcement"
description: "New tool: engram_lint({ file_path, content }). Retrieves active conventions filtered by file layer/category. Each convention with a 'pattern' example gets regex-matched against content. Returns array of violations with convention_id, rule, and hint. Agents call this before engram_record_change to self-check. No LLM required for pattern-based conventions. Start simple: string matching on convention examples."
priority: "medium"
tags: ["feature", "conventions", "quality-of-life", "v1.6"]
```

---

### F6 · Structured Agent Handoff (Medium Impact / Low Effort)

**Problem it solves:** C3 — makes context-exhaustion handoffs surgical instead of reconstructive.

**Proposed tool:** `engram_handoff(reason, next_agent_instructions, resume_at)`

Called when an agent knows it is about to lose context. Creates a special session record of type `handoff` with:
- A structured "resume packet": open tasks, last file touched, last decision made, current git branch, in-progress work items
- `next_agent_instructions`: plain-language briefing for the receiving agent
- `resume_at`: task title or description of exactly where to pick up

`engram_start_session` checks for a pending handoff and surfaces it prominently at the top of the context — above the regular session summary — as a `handoff_pending` field. This is different from a normal session summary because it explicitly tells the next agent "start here, not from scratch."

---

**→ Engram Record to Create:**
```
Tool: engram_create_task
title: "Add engram_handoff tool for graceful context-exhaustion transfers"
description: "New tool: engram_handoff({ reason, next_agent_instructions, resume_at }). Creates a handoff record in a new 'handoffs' table (or sessions with type='handoff'). engram_start_session returns handoff_pending field if an unacknowledged handoff exists for this project. The receiving agent acknowledges with engram_acknowledge_handoff(id). This makes context-exhaustion transfers precise instead of relying on summary reconstruction."
priority: "medium"
tags: ["feature", "session-management", "multi-agent", "v1.6"]
```

---

### F7 · Git Hook Auto-Recording (Medium Impact / Low Effort for users)

**Problem it solves:** C2 — ensures changes are always recorded, even from agents that forget.

**Proposed addition to installer:**

Add a `--install-hooks` option to the installer. It writes a `post-commit` git hook to `.git/hooks/post-commit` that calls:

```bash
#!/bin/bash
npx -y engram-mcp-server record-commit --session-id $ENGRAM_SESSION_ID
```

This reads the last commit's diff, extracts changed files, and calls `engram_record_change` for each file automatically. The `ENGRAM_SESSION_ID` env var is set by the MCP server on startup.

**Benefit:** Even if an agent (or a human developer) commits without calling `engram_record_change`, the hook captures it. Engram's history becomes automatically complete without agent cooperation.

---

**→ Engram Record to Create:**
```
Tool: engram_create_task
title: "Add --install-hooks option to installer for automatic git change recording"
description: "Add npx engram-mcp-server --install-hooks command. Writes .git/hooks/post-commit that calls engram CLI to record the committed diff into the current session. The engram CLI (non-MCP) reads the session ID from .engram/current_session and calls record_change for each modified file. This makes change recording automatic and agent-agnostic."
priority: "medium"
tags: ["feature", "git", "automation", "v1.6"]
```

---

### F8 · Decision Dependency Chains (Medium Impact / Low Effort)

**Problem it solves:** When a foundational decision is superseded, all dependent decisions may need review — but there's no way to know which ones depend on which.

**Proposed change:** Add `depends_on` array to `engram_record_decision`. When a decision is superseded or deprecated, Engram queries all decisions that `depends_on` the affected ID and returns them as `review_required` in the response.

**Example:**
- Decision #5: "Use JWT for auth with 15-min expiry"
- Decision #8: "Refresh token endpoint uses same JWT secret" (depends_on: [5])
- Decision #12: "API rate limiting is per JWT subject" (depends_on: [5])

When #5 is superseded, `engram_update_decision` warns: "3 decisions depend on #5 and may need review: #8, #12, #17."

---

**→ Engram Record to Create:**
```
Tool: engram_create_task
title: "Add depends_on field to decisions for dependency chain tracking"
description: "Add depends_on JSON column to decisions table (V7 migration). engram_record_decision accepts depends_on: number[]. engram_update_decision(status: superseded|deprecated) queries all decisions WHERE depends_on JSON contains the affected ID and returns them as review_required[]. This prevents downstream decisions becoming invalid silently when their foundations change."
priority: "medium"
tags: ["feature", "decisions", "architecture", "v1.6"]
```

---

### F9 · Agent Capability Routing (Low-Medium Impact / Medium Effort)

**Problem it solves:** In multi-agent setups, any agent can claim any task — even ones outside its area of expertise. This leads to inefficient work and more errors.

**Proposed change:** Add `specializations` array to `engram_agent_sync`. When an agent registers with `specializations: ["typescript", "database", "testing"]`, these are stored in the agents table.

`engram_claim_task` gains an optional `prefer_specialization` field. Engram checks if the claiming agent's specializations overlap with the task's tags before allowing the claim — or at minimum, warns when there's no overlap.

**Coordinator mode:** A special `coordinator` agent_id gets an `engram_route_task(task_id)` tool that returns the best-matched available agent based on tag overlap, last-seen time, and current workload.

---

**→ Engram Record to Create:**
```
Tool: engram_create_task
title: "Add specializations to engram_agent_sync and routing to engram_claim_task"
description: "Store specializations TEXT (JSON array) in agents table. engram_agent_sync accepts specializations param. engram_claim_task checks agent specializations vs task tags and adds a match_score to the response (no hard blocking, just advisory). Add engram_route_task(task_id) that returns best-matched agent_id. This makes multi-agent task distribution smarter."
priority: "low"
tags: ["feature", "multi-agent", "v1.6"]
```

---

### F10 · Session Replay / Diagnostic Mode (Low Impact / High Value for Debugging)

**Problem it solves:** When something goes wrong (like the intelligence.ts corruption), it's hard to reconstruct the sequence of events that led there.

**Proposed tool:** `engram_replay(session_id)`

Returns a chronological timeline of everything that happened in a session: tool calls made (inferred from changes/decisions/tasks recorded with timestamps), files touched in order, decisions made, tasks created/closed. Essentially a structured audit trail.

**This requires:** Storing a `tool_call_log` table where every MCP tool invocation is recorded with timestamp, tool_name, agent_id, and a compact summary of inputs/outputs. This is low overhead (a few hundred bytes per call) but creates a complete diagnostic trail.

---

**→ Engram Record to Create:**
```
Tool: engram_create_task
title: "Add tool_call_log table for session replay and diagnostics"
description: "New table: tool_call_log (id, session_id, agent_id, tool_name, called_at INTEGER, input_summary TEXT, outcome: success|error). Every tool registration wraps its handler to log invocations. engram_replay(session_id) returns chronological timeline. Useful for debugging corruption, reconstructing what sub-agents did, and auditing multi-agent sessions. Add engram_replay tool."
priority: "low"
tags: ["feature", "diagnostics", "multi-agent", "v1.7"]
```

---

## Part 3 — Quick-Win Ideas (Small Changes, Immediate Value)

These require minimal code changes but would make the agent workflow meaningfully smoother.

---

### Q1 · `engram_search` Should Return File Note Confidence

**Currently:** `engram_search` returns matching items from multiple tables but doesn't indicate whether the `file_notes` results are stale.

**Fix:** When `scope` includes `file_notes`, attach the `confidence` field to each result.

---

**→ Engram Record to Create:**
```
Tool: engram_create_task
title: "Include confidence field in engram_search results for file_notes scope"
description: "When engram_search returns file_notes results, compute the same confidence logic used in engram_get_file_notes (compare file_mtime to actual filesystem mtime) and include confidence: high|medium|stale|unknown per result. This prevents agents from trusting stale notes returned by search."
priority: "low"
tags: ["feature", "search", "file-safety", "v1.6"]
```

---

### Q2 · `engram_start_session` Should Surface Abandoned Pending Work

**Currently:** The session context doesn't distinguish between "tasks not started" and "work that was in-flight when the previous session died."

**Fix:** If `engram_begin_work` (from F2 above) is implemented, abandoned pending work items should appear as a dedicated `abandoned_work` field in `engram_start_session` response — separate from and above regular open tasks — with a higher urgency signal.

---

### Q3 · `engram_stats` Should Include Per-Agent Contribution Metrics

**Currently:** Stats are project-wide. In multi-agent setups, there's no visibility into which agent recorded the most changes, made the most decisions, or has the longest sessions.

**Fix:** Add an `agents` section to `engram_stats` response: list of agent names with their change count, decision count, task completion count, and last active time. Low effort — just group-by queries on existing tables.

---

**→ Engram Record to Create:**
```
Tool: engram_create_task
title: "Add per-agent metrics to engram_stats response"
description: "Add agents[] array to engram_stats: [{agent_id, name, changes_recorded, decisions_made, tasks_completed, last_active}]. Requires GROUP BY agent_id on changes, decisions, tasks, sessions tables. Useful for multi-agent visibility and understanding contribution distribution."
priority: "low"
tags: ["feature", "stats", "multi-agent", "v1.6"]
```

---

### Q4 · `engram_end_session` Should Warn on Unclosed Claimed Tasks

**Currently:** An agent can call `engram_end_session` while holding claimed tasks, leaving them permanently claimed with no other agent able to grab them.

**Fix:** `engram_end_session` checks for tasks with `claimed_by = current_agent_id` that are not completed. If any exist, return a `warning` with the task IDs and a suggestion to either complete or release them before ending.

---

**→ Engram Record to Create:**
```
Tool: engram_create_task
title: "Warn on unclosed claimed tasks in engram_end_session"
description: "Before finalizing end_session, query tasks WHERE claimed_by = agent_id AND status != 'done'. If any exist, add claimed_tasks_warning to response with task IDs and suggestion to call engram_release_task or update_task. Also auto-release claims older than 24h via a background cleanup in scheduleCheck()."
priority: "low"
tags: ["feature", "multi-agent", "session-management", "v1.6"]
```

---

### Q5 · Session Focus Auto-Suggestion

**Currently:** `engram_start_session` accepts a `focus` param but agents must know to pass it and know what to pass.

**Fix:** If `focus` is omitted, analyze: (1) most recently touched files, (2) highest-priority open tasks, (3) most recent decisions. Derive a suggested focus keyword and include it in the response as `suggested_focus: "authentication refactor"`. The agent can note this in its thinking or use it in a follow-up `engram_search`.

---

**→ Engram Record to Create:**
```
Tool: engram_create_task
title: "Auto-suggest session focus in engram_start_session when focus param is omitted"
description: "If focus is not provided, derive suggested_focus from: (1) most recently modified files (get tags from file_notes), (2) highest priority open task tags, (3) most recent decision tags. Return as suggested_focus string in session context. Helps agents orient without requiring the user to specify a topic every time."
priority: "low"
tags: ["feature", "session-management", "quality-of-life", "v1.6"]
```

---

## Summary Table

| ID | Feature | Priority | Target | Type |
|----|---------|----------|--------|------|
| F1 | File Write Locks | **High** | v1.6 | New tools |
| F2 | Intent Recording (`engram_begin_work`) | **High** | v1.6 | New tool + table |
| F3 | Context Pressure Detection | **High** | v1.6 | Event type |
| F4 | Branch-Aware File Notes | Medium | v1.6 | Schema + logic |
| F5 | Convention Enforcement Linting | Medium | v1.6 | New tool |
| F6 | Structured Agent Handoff | Medium | v1.6 | New tool + table |
| F7 | Git Hook Auto-Recording | Medium | v1.6 | Installer option |
| F8 | Decision Dependency Chains | Medium | v1.6 | Schema + logic |
| F9 | Agent Capability Routing | Low–Med | v1.6 | Schema + logic |
| F10 | Session Replay / Diagnostic Mode | Low | v1.7 | New table + tool |
| Q1 | Confidence in Search Results | Low | v1.6 | Query change |
| Q2 | Abandoned Work in Start Session | Low | v1.6 | Depends on F2 |
| Q3 | Per-Agent Stats | Low | v1.6 | Query change |
| Q4 | Warn on Unclosed Claims at End | Low | v1.6 | Validation |
| Q5 | Auto-Suggest Session Focus | Low | v1.6 | Inference logic |

---

## How to Feed This into Engram

Each item marked **"→ Engram Record to Create"** above contains a ready-to-use tool call. You can paste them into any Engram-connected agent session and they'll be recorded as tasks or decisions. Suggested order:

1. **Decisions first** (C1–C5 decisions) — these are lessons learned, recorded as `engram_record_decision`
2. **Conventions** (C2, C5, C7) — recorded as `engram_add_convention`
3. **Feature tasks** (F1–F10, Q1–Q5) — recorded as `engram_create_task` with appropriate priority and tags

The three highest-priority items (F1, F2, F3) together address the core trust gap: agents can corrupt each other's work, forget to record their work, and not know when to stop. These three alone would make Engram significantly more reliable as a co-worker in multi-agent scenarios.

---

*Compiled by Claude Code · Session #13 · 2026-02-24*
