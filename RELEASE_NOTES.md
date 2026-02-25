# v1.6.1 — Universal Thin Client & Test Infrastructure Fix

**Released:** patch bump on top of v1.6.0.

## What's New

### `engram-universal-client` Package (`packages/engram-universal-thin-client/`)

A new optional companion package that acts as an **MCP proxy facade** for token-constrained environments. Instead of exposing 4 dispatcher tools (~1,600 token schema), it exposes a **single `engram` tool** (~80 tokens) and routes requests to the upstream dispatcher via BM25 semantic action matching.

**Architecture:**
- `src/router.ts` — ROUTE_TABLE mapping 60+ action names to the correct upstream dispatcher tool
- `src/bm25.ts` — MiniSearch BM25 index; `resolveAction()` exact-matches or fuzzy-resolves any action, `suggestActions()` returns ranked alternatives
- `src/server.ts` — MCP facade server; proxies to the real Engram MCP subprocess, handles both nested (`{action, params}`) and flat (`{action, ...}`) parameter shapes
- `index.ts` — CLI entry point: `npx engram-universal-client --project-root <path>`

**Install (Claude Desktop / Cursor / Windsurf):**
```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "engram-universal-client", "--project-root", "/your/project"]
    }
  }
}
```

> **Note:** This package is a proof-of-concept. Known limitations and planned improvements are tracked in `docs/engram-token-efficiency-master-plan.md`.

---

### Test Infrastructure — Schema Sync Fix

`tests/helpers/test-db.ts` previously hand-rolled a v4-era schema inline. Any migration past v4 that added columns (`file_mtime` at v5, `content_hash` at v13, `executive_summary` at v14) caused 13 test failures across `batch.test.ts` and `repos.test.ts`.

**Fix:** `createTestDb()` now calls `runMigrations(db)` directly — the test database is always at the current schema version with zero manual maintenance.

---

# v1.6.0 — Lean Surface, Dispatcher Architecture & 8 New Feature Tracks

**Engram v1.6.0** is the largest release to date — fourteen combined feature tracks. This entry covers the **eight new tracks** delivered on top of the existing agent safety and session handoff infrastructure already documented below.

---

## Summary of New Tracks

| # | Track | Branch |
|---|-------|--------|
| 1 | Lean 4-Tool Dispatcher (50+ → 4 tools, ~95% token reduction) | `feat/v1.6-lean-surface` |
| 2 | Persistent Checkpoints (offload working memory mid-session) | `feat/v1.6-checkpoint` |
| 3 | Hash-Based Staleness Detection (SHA-256 `content_hash`) | `feat/v1.6-staleness-enhanced` |
| 4 | Tiered Verbosity + `nano` mode + `executive_summary` | `feat/v1.6-tiered-verbosity` |
| 5 | Live Agent Rules from GitHub README (7-day cache) | `feat/v1.6-readme-rules` |
| 6 | Quality: `lint` action, `install_hooks`/`remove_hooks`, cascade warning | `feat/v1.6-quality` |
| 7 | Agent Specialization Routing + `route_task` + `match_score` | `feat/v1.6-multi-agent` |
| 8 | Thin-Client Proxy for Anthropic `defer_loading` beta | `feat/v1.6-thin-client` |

---

## Track 1 — Lean 4-Tool Dispatcher (`feat/v1.6-lean-surface`)

### Problem
Engram exposed 50+ individual MCP tools. Every tool's full JSON Schema was injected into the model's context at session start, consuming ~32,500 tokens per call — roughly 8-17% of a typical context window, before any code was read.

### Solution
All tools collapsed into **4 dispatcher tools**, each routed via an `action` parameter:

- **`engram_session`** — Session lifecycle (`start`, `end`, `handoff`, `acknowledge_handoff`, `get_history`)
- **`engram_memory`** — All memory operations (34+ actions, see Tools Reference)
- **`engram_admin`** — Maintenance, git hooks, backup, export, config
- **`engram_find`** — Tool catalog search + convention linting

### Impact
- Schema token overhead: **~32,500 → ~1,600** (~95% reduction)
- All previous tools still available — routed via `action` parameter
- `engram_find` lets agents discover action names without memorising the full surface
- Every existing tool behaviour is preserved

---

## Track 2 — Persistent Checkpoints (`feat/v1.6-checkpoint`)

### New actions on `engram_memory`

- **`checkpoint`** — Saves `current_understanding`, `progress_percentage`, `key_findings`, `next_steps`, and relevant `file_paths` to a new `checkpoints` DB table (V12 migration).
- **`get_checkpoint`** — Retrieves the most recent checkpoint for the current session (or a specific `session_id`).

### When to use
Call `checkpoint` when approaching context limits without wanting to end the session. Future context can pick up from where the previous one left off.

### Schema (V12)
```sql
CREATE TABLE checkpoints (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  current_understanding TEXT,
  progress_percentage INTEGER,
  key_findings TEXT,         -- JSON array
  next_steps TEXT,           -- JSON array
  relevant_files TEXT,       -- JSON array
  created_at TEXT DEFAULT (datetime('now'))
)
```

---

## Track 3 — Hash-Based Staleness Detection (`feat/v1.6-staleness-enhanced`)

### Problem
`mtime`-based staleness missed edits where the file content changed but the timestamp did not (formatters, git ops, some editors).

### Solution
`set_file_notes` now accepts and stores a `content_hash` (SHA-256). `get_file_notes` computes a fresh hash and compares:

| State | `confidence` |
|-------|-------------|
| hash matches mtime matches | `high` |
| mtime matches but hash differs | `stale` (content silently changed) |
| mtime changed | `medium` |
| >7 days old | `low` |

### Schema (V13)
Added `content_hash TEXT` column to `file_notes`.

---

## Track 4 — Tiered Verbosity + `nano` + `executive_summary` (`feat/v1.6-tiered-verbosity`)

### New verbosity level: `nano`
Returns only session ID, record counts, `agent_rules`, and `tool_catalog`. Under 100 tokens. Use when context is critically constrained.

### New `executive_summary` field
`set_file_notes` now accepts `executive_summary`: a 2–3 sentence micro-summary of the file purpose. Surfaced in `get_file_notes` (`minimal`+ verbosity).

### Schema (V14)
Added `executive_summary TEXT` column to `file_notes`.

### Verbosity matrix
| Level | Returns |
|-------|---------|
| `nano` | session_id, counts, agent_rules, tool_catalog |
| `minimal` | `nano` + summary, recently changed files, high-priority tasks |
| `summary` | `minimal` + decisions, conventions, open tasks, suggested_focus |
| `full` | everything including detailed file notes and all task tags |

---

## Track 5 — Live Agent Rules from GitHub README (`feat/v1.6-readme-rules`)

### What changed
`start_session` now returns an `agent_rules` array parsed dynamically from the Engram README hosted on GitHub.

### Behaviour
- On first call, fetches `https://raw.githubusercontent.com/…/README.md` and parses the JSON block between `<!-- AGENT_RULES_START -->` and `<!-- AGENT_RULES_END -->`.
- Caches the result to `.engram/agent_rules_cache.json` for **7 days**.
- Falls back to hardcoded AGENT_RULES in `src/tools/find.ts` if fetch fails or cache is expired but network is unavailable.
- Rules update automatically when the README changes — no agent reinstall required.

---

## Track 6 — Quality Improvements (`feat/v1.6-quality`)

### Convention Linting
`engram_find(action:"lint", content:"...")` checks any code/text against all active project conventions and returns a `violations[]` array with rule references.

### Git Hook Management via `engram_admin`
- `engram_admin(action:"install_hooks")` — Writes the Engram `post-commit` hook to `.git/hooks/post-commit`
- `engram_admin(action:"remove_hooks")` — Removes the Engram hook entry from `.git/hooks/post-commit`

### Decision Cascade Warning
`engram_memory(action:"update_decision")` now returns a `cascade_warning` field listing all decisions that have `depends_on` pointing at the changed decision, so agents know to review dependents.

---

## Track 7 — Agent Specialization Routing (`feat/v1.6-multi-agent`)

### Changes to `agent_sync`
Now accepts `specializations: string[]` — skill/domain tags for the agent (e.g. `["typescript","database","migration"]`). Stored in `agents` table (V15 migration: added `specializations TEXT` column).

### New action: `route_task`
`engram_memory({ action: "route_task", task_id })` finds the best-matched registered agent for a task by comparing task `tags` against registered agent `specializations` using intersection scoring.

Returns: `{ best_match: { agent_id, agent_name, match_score }, all_candidates: [...] }`

### Updated action: `claim_task`
Now returns advisory `match_score` and optional `match_warning` comparing the claiming agent's specializations against the task's tags. Does not block claiming — advisory only.

### Schema (V15)
Added `specializations TEXT` column to `agents`.

---

## Track 8 — Thin-Client Proxy for Anthropic `defer_loading` (`feat/v1.6-thin-client`)

### What it is
A new separate package at `packages/engram-thin-client/` that proxies all Engram tool calls via the **Anthropic SDK** with `defer_loading: true` beta.

### How it works
Tools are registered using Anthropic's `defer_loading` beta flag, meaning **zero tool schema tokens** are consumed upfront. The model discovers tools on-demand. A BM25 search index lets the Claude model identify which Engram action to call based on natural language.

### Who it's for
**Anthropic API users only** (any agent using Claude models via the Anthropic TypeScript SDK directly). Cursor, Copilot, Gemini, and GPT agents continue to use the MCP server directly — they still benefit from the lean 4-tool surface but do not get zero-upfront-cost.

### Installation
```bash
npm install engram-thin-client
```

---

## Breaking Changes

None. All eight new tracks are additive. Existing tool calls, IDE configs, and databases continue to work. The schema auto-migrates from any previous version through V12–V15 on first startup.

---

## Migration Summary (V12–V15)

| Version | Change |
|---------|--------|
| V12 | `checkpoints` table (checkpoint, get_checkpoint) |
| V13 | `file_notes.content_hash` column (hash-based staleness) |
| V14 | `file_notes.executive_summary` column (tiered verbosity) |
| V15 | `agents.specializations` column (route_task, match_score) |

---

# v1.6.0 — Agent Safety, Session Handoffs, Knowledge Graph & Diagnostics

**Engram v1.6.0** delivers six feature tracks developed in parallel, focused on making multi-agent workflows safer, making cross-session context transfers seamless, and giving agents deeper visibility into what they and their peers are doing.

Seven feature branches were developed and merged into `develop`:

---

## Breaking Changes

None. v1.6.0 is fully backwards-compatible. All existing tool calls, IDE configs, and databases continue to work unchanged. The schema auto-migrates from V6 through V7–V11 on first startup.

---

## F1/F2 — Agent Safety (`feature/v1.6-agent-safety`)

### File Locking

Two new tools prevent concurrent write conflicts between parallel agents:

- **`engram_lock_file`** — Acquires an exclusive write lock on a file with a reason and optional expiry. Fails immediately if another agent holds the lock, returning who holds it.
- **`engram_unlock_file`** — Releases the lock. Locks auto-expire after 30 minutes (configurable via `FILE_LOCK_DEFAULT_TIMEOUT_MINUTES`).
- **`engram_get_file_notes`** (updated) — Now surfaces `lock_status` for every file: `locked`, `expired`, or `none`. The locking agent's ID is included so other agents know whom to coordinate with.

### Pending Work Intent

- **`engram_begin_work`** — Record your intent before touching a file (agent ID, description, file list). Stored in a new `pending_work` table.
- **`engram_end_work`** — Mark the intent complete or cancelled.
- **`engram_start_session`** (updated) — Now surfaces `abandoned_work`: any `pending_work` records left open when a session ended unexpectedly. Automatically marks old items as `abandoned` so new sessions know what was interrupted.

Schema change: V7 adds `file_locks` and `pending_work` tables.

---

## F3 — Context Pressure Detection (`feature/v1.6-context-pressure`)

`engram_check_events` now includes a `context_pressure` event type with three severity levels:

| Level | Threshold | Message |
|-------|-----------|---------|
| `notice` | ≥ 50% | Context filling — save progress soon |
| `warning` | ≥ 70% | Context > 70% — consider ending session |
| `urgent` | ≥ 85% | Context critical — end session now |

Thresholds are stored in `config` and adjustable via `engram_config`. Byte estimates are tracked per-session in a new `session_bytes` table (V8).

---

## F4/F8 — Knowledge Graph Enhancements (`feature/v1.6-knowledge-graph`)

### Branch-Aware File Notes (F4)

`engram_set_file_notes` now captures the current `git_branch` at write time. On read, `engram_get_file_notes` detects if the stored branch differs from the current branch and returns a `branch_warning` field:

```json
{
  "branch_warning": "Notes written on 'main' — you are on 'feature/auth'. File may differ."
}
```

Schema change: V9 adds `git_branch TEXT` column to `file_notes`.

### Decision Dependency Chains (F8)

`engram_record_decision` accepts a new optional `depends_on` field — an array of decision IDs that must be in place for this decision to be valid. `engram_get_decisions` returns the dependency chain so agents can reason about which decisions block others.

Schema change: V9 adds `depends_on TEXT` column to `decisions`.

---

## F6 — Session Handoffs (`feature/v1.6-session-handoff`)

Two new tools enable graceful agent-to-agent context transfers when approaching context limits:

- **`engram_handoff`** — The outgoing agent records a structured handoff packet: reason, instructions for the next agent, which tasks are open, the last file touched, and the current git branch. All context is auto-captured.
- **`engram_acknowledge_handoff`** — The incoming agent marks the handoff read, clearing it from future `start_session` responses.

`engram_start_session` (updated) — Returns `handoff_pending` in all verbosity modes if an unacknowledged handoff exists. The message includes the originating agent and a direct call to acknowledge.

Schema change: V10 adds `handoffs` table.

---

## Q1/Q3/Q4/Q5 — Quick Wins (`feature/v1.6-quick-wins`)

Four targeted improvements:

**Q1 — Search Confidence Enrichment:** `engram_search` results that include `file_notes` now carry per-result `confidence` levels (`high`, `medium`, `stale`, `unknown`) matching the per-file staleness detection already in `engram_get_file_notes`.

**Q3 — Per-Agent Metrics in Stats:** `engram_stats` now returns an `agents` array with per-agent session counts, changes recorded, decisions made, and last-active timestamp — useful for auditing which agent has been most productive.

**Q4 — Unclosed Task Warning in End Session:** `engram_end_session` now warns if the ending agent has claimed tasks that are still open, listing each by ID and title. The session closes normally — the warning is surfaced in the response for the agent to act on.

**Q5 — Suggested Focus:** `engram_start_session` now returns `suggested_focus` when no explicit `focus` parameter was provided. The suggestion is derived from: the most recently-touched file's parent directory, the highest-priority task title, and the most recent decision — whichever is most informative. Agents can pass this back as `focus` on the next call.

---

## F7 — Git Hook Auto-Recording (`feature/v1.6-automation`)

The installer now supports automatic commit recording via git hooks:

```bash
npx -y engram-mcp-server install --install-hooks
npx -y engram-mcp-server install --remove-hooks
```

`--install-hooks` writes a `post-commit` hook to `.git/hooks/` that runs `engram record-commit` after every commit. The new `record-commit` CLI command reads the last commit's changed files from `git show --name-only` and records them to the `changes` table automatically — no agent action required.

```bash
# Also available as a standalone command:
npx -y engram-mcp-server record-commit
```

---

## F10 — Session Replay & Diagnostics (`feature/v1.6-diagnostics`)

### Tool Call Log

Every MCP tool invocation is now logged to a new `tool_call_log` table (V11). The log captures session ID, agent ID, tool name, timestamp, outcome (`success`/`error`), and optional notes.

### `engram_replay`

A new tool reconstructs the complete timeline of a session in chronological order, interleaving:
- Tool calls from `tool_call_log`
- Changes from `changes`
- Decisions from `decisions`
- Tasks created/updated
- Milestones

Useful for post-session audits, debugging unexpected agent behaviour, and handoff documentation.

```js
engram_replay({ session_id: 14, limit: 50 })
```

Schema change: V11 adds `tool_call_log` table.

---

> Previous release: **v1.5.0** — Multi-Agent Coordination, Trustworthy Context & Knowledge Intelligence. [Full notes below →](#v150--multi-agent-coordination-trustworthy-context--knowledge-intelligence)

---

# v1.5.0 — Multi-Agent Coordination, Trustworthy Context & Knowledge Intelligence

**Engram v1.5.0** is the biggest feature release since v1.0. It transforms Engram from a single-agent memory store into a full **multi-agent coordination platform** — while simultaneously making every individual agent more trustworthy, context-efficient, and self-sufficient.

Four major feature tracks were developed in parallel on separate branches and merged into `develop`:

---

## Breaking Changes

None. v1.5.0 is fully backwards-compatible. All existing tool calls, IDE configs, and databases continue to work unchanged. The schema auto-migrates to V6 on first startup.

---

## F1 — Trustworthy Context

*Branch: `feature/trustworthy-context`*

The core problem: **can the agent trust what Engram tells it?** File notes written weeks ago may no longer reflect the file. Search results may reference stale architecture. This track makes every piece of returned memory carry a confidence signal.

### File Note Staleness Detection

`engram_set_file_notes` now captures the actual filesystem `mtime` (milliseconds since epoch) of the file at the moment notes are saved. On every subsequent `engram_get_file_notes`, Engram compares the stored mtime against the current filesystem mtime and returns:

```json
{
  "confidence": "stale",
  "stale": true,
  "staleness_hours": 18
}
```

| `confidence` | Meaning |
|---|---|
| `high` | File mtime unchanged since notes were written — fully trustworthy |
| `medium` | File changed recently (< 24h) — notes likely still valid, re-read if editing |
| `stale` | File changed significantly (> 24h) — treat notes as a hint, re-read before acting |
| `unknown` | No mtime stored (legacy notes or file not found) |

The agent is never blocked — notes are always returned. The confidence field lets the agent decide whether to trust or re-read.

### `engram_start_session` — Focus Parameter

A new optional `focus` parameter on `engram_start_session` allows agents to declare their working topic upfront:

```js
engram_start_session({ focus: "auth refactor" })
```

When provided, Engram runs **FTS5-ranked queries** against decisions, tasks, and changes — returning only the top-15 most relevant items per category instead of everything. Conventions are always returned in full.

The response includes a `focus` metadata block:

```json
{
  "focus": {
    "query": "auth refactor",
    "decisions_returned": 4,
    "tasks_returned": 3,
    "changes_returned": 7,
    "note": "Context filtered to focus. Full memory available via engram_search."
  }
}
```

This can reduce session boot token cost by 60–80% when working on a specific sub-system.

---

## F2 — Smart Dump & Multi-Agent Coordination

*Branch: `feature/smart-dump-coordination`*

Engram now supports **multiple parallel agents** working on the same project simultaneously without stepping on each other. Schema V6 adds `agents` and `broadcasts` tables, plus task claiming columns.

### `engram_dump` — Raw Brain Dump

Agents can now paste raw research notes, findings, or thoughts into Engram without deciding where they belong:

```js
engram_dump({
  content: "Found that the auth token is stored in localStorage — may be a security issue. Should use httpOnly cookies instead.",
  hint: "auto"  // or "decision" | "task" | "convention" | "finding"
})
```

Engram scores the content against keyword heuristics and classifies it as a `decision`, `task`, `convention`, or `finding` (stored as a change record). It **always** returns `extracted_items[]` showing exactly what was stored and where — the agent must verify, never trust blindly.

### Atomic Task Claiming

Two agents working in parallel will never pick up the same task:

```js
// Agent A
engram_claim_task({ task_id: 42, agent_id: "claude-code-main" })
// → success: Task #42 claimed

// Agent B (same millisecond)
engram_claim_task({ task_id: 42, agent_id: "subagent-auth" })
// → error: Task #42 is already claimed by agent "claude-code-main"
```

The claim uses a single atomic `UPDATE WHERE claimed_by IS NULL` — no race condition possible with SQLite's WAL mode.

### Agent Registry & Heartbeat

```js
engram_agent_sync({ agent_id: "subagent-auth", status: "working", current_task_id: 42 })
```

Agents register themselves and send periodic heartbeats. If an agent goes silent for >30 minutes, its task claims are automatically released and its status is set to `stale`. This prevents deadlocks in long-running multi-agent workflows.

### Inter-Agent Broadcasting

```js
engram_broadcast({ from_agent: "main", message: "Auth module done — you can start the API integration now." })
```

All agents see unread broadcasts on their next `engram_agent_sync`. Messages expire after a configurable duration (default: 60 minutes).

### New Coordination Tools Summary

| Tool | Purpose |
|---|---|
| `engram_dump` | Auto-classify and store raw research content |
| `engram_claim_task` | Atomically claim a task — safe for parallel agents |
| `engram_release_task` | Release a claim back to the pool |
| `engram_agent_sync` | Heartbeat + stale cleanup + unread broadcasts |
| `engram_get_agents` | List all active agents and what they're working on |
| `engram_broadcast` | Send a message all agents will see |

---

## F3 — Knowledge Intelligence

*Branch: `feature/knowledge-intelligence`*

### FTS5-Powered Conflict Detection

`engram_record_decision` now uses FTS5 ranked queries (instead of LIKE) to find similar active decisions. If potential conflicts are found, they're returned as warnings alongside the newly recorded decision — without blocking the save:

```json
{
  "decision_id": 31,
  "warning": "Found 2 similar active decision(s). Review for potential conflicts.",
  "similar_decisions": [
    { "id": 12, "decision": "Use JWT for auth tokens...", "status": "active" }
  ]
}
```

### Cross-Project Global Knowledge Base

Agents can now share battle-tested decisions and conventions across all projects on the machine via a **global knowledge base** at `~/.engram/global.db`.

**Exporting knowledge:**
```js
engram_record_decision({
  decision: "Always use httpOnly cookies for auth tokens — never localStorage.",
  export_global: true   // mirrors to ~/.engram/global.db
})

engram_add_convention({
  category: "security",
  rule: "Auth tokens must use httpOnly cookies only.",
  export_global: true
})
```

**Reading global knowledge (on any project):**
```js
engram_get_global_knowledge({ query: "auth tokens" })
// Returns decisions + conventions from ALL projects, with project_root provenance
```

The global DB has its own FTS5 index and is kept completely separate from per-project memory — it never pollutes or overwrites project-specific data.

---

## F4 — Quality of Life

*Branch: `feature/quality-of-life`*

### `engram_search` — Context Snippets

The search tool now accepts a `context_chars` parameter (0–500). When set, each result gains a `context` field with a relevant text snippet from the record's content:

```js
engram_search({ query: "auth", context_chars: 150 })
// Each result: { ...record, context: "...use httpOnly cookies for auth — never localStorage. Reason: XSS..." }
```

### `engram_generate_report`

Generates a Markdown project report with configurable sections:

```js
engram_generate_report({
  title: "Sprint 3 Handoff",
  include_sections: ["tasks", "decisions", "changes", "conventions", "milestones"]
})
```

Returns a formatted Markdown document ready to paste into a GitHub issue, PR description, or team wiki.

### `engram_suggest_commit`

Analyzes changes recorded in the current session and generates a conventional commit message:

```js
engram_suggest_commit()
// Returns:
// suggested_message: "feat(auth): implement httpOnly cookie token storage\n\n- src/auth/tokens.ts: replaced localStorage with httpOnly cookies\n..."
// breakdown: { type: "feat", scope: "auth", files_changed: 3, change_types: { created: 1, modified: 2 } }
```

### Session Duration Statistics

`engram_stats` now returns:
- `avg_session_duration_minutes` — rolling average across all completed sessions
- `longest_session_minutes` — the longest recorded session
- `sessions_last_7_days` — activity pulse

---

## Internal Changes

- **Schema V6:** `agents` table (id, name, last_seen, current_task_id, status), `broadcasts` table (id, from_agent, message, created_at, expires_at, read_by), `tasks.claimed_by`, `tasks.claimed_at`
- **New repos:** `AgentsRepo`, `BroadcastsRepo` (follow existing repo conventions)
- **New modules:** `src/global-db.ts` (lazy-initialized global KB), `src/tools/coordination.ts`, `src/tools/knowledge.ts`, `src/tools/report.ts`
- **`findSimilar()` upgraded** from LIKE to FTS5 CTE with LIKE fallback
- **All features merged** into `develop` via `--no-ff` merges. `main` is untouched pending further maturation on `develop`.

---

**Full Changelog**: https://github.com/keggan-std/Engram/compare/v1.4.1...develop

---

# v1.4.1 — Installer Infrastructure Audit: Path Fixes, Multi-IDE & Detection Improvements

**Engram v1.4.1 is a targeted hotfix release.** A thorough audit of the entire installer infrastructure — verified against official documentation for every supported IDE — uncovered a series of critical and high-severity bugs that caused silent wrong-directory installs on macOS, invisible installs in Visual Studio, and unreliable IDE detection. All are fixed in this release, along with multi-IDE awareness and several UX improvements.

---

## Breaking Changes

None. v1.4.1 is fully backwards-compatible. Existing IDE config entries are unaffected.

---

## Fixes

### Critical — macOS Install Path Wrong for All APPDATA-Based IDEs

**Root cause:** `process.env.APPDATA` is Windows-only. The fallback `|| path.join(HOME, '.config')` accidentally produced the right path on Linux but the **wrong path on macOS** — `~/.config` instead of `~/Library/Application Support`.

**Impact:** On every Mac, installs for VS Code, Cline/Roo Code, and Claude Desktop were written to `~/.config/...` instead of `~/Library/Application Support/...`. The IDE never read from that path. Re-running the installer returned "Already installed — nothing to do" on every subsequent run because the wrong file now existed.

**Fix:** The `APPDATA` constant is now OS-aware:
- **Windows:** `%APPDATA%` (e.g. `C:\Users\User\AppData\Roaming`)
- **macOS:** `~/Library/Application Support`
- **Linux:** `~/.config` (XDG Base Directory spec)

This resolves the correct global config path for VS Code, Cline/Roo Code, Claude Desktop, and JetBrains on all three platforms in a single change.

### Critical — Visual Studio Received Wrong Config Key

**Root cause:** Visual Studio uses the `"servers"` JSON key — not `"mcpServers"`. The installer was writing `{ "mcpServers": { "engram": {...} } }` to `~/.mcp.json`.

**Impact:** Every Visual Studio install silently wrote to a key VS never reads. Engram was permanently invisible in Visual Studio on all platforms.

**Fix:** `configKey` for Visual Studio is now `"servers"`, confirmed against [official Microsoft docs](https://learn.microsoft.com/en-us/visualstudio/ide/mcp-servers).

### High — VS Code, Cursor, and Windsurf Had Wrong Secondary Global Paths

Three IDEs had incorrect fallback paths that would never exist on any real machine:

| IDE | Wrong path (removed) | Correct path (kept) |
|-----|----------------------|---------------------|
| **VS Code** | `~/.vscode/mcp.json` (extensions dir) | `APPDATA/Code/User/mcp.json` |
| **Cursor** | `APPDATA/Cursor/mcp.json` | `~/.cursor/mcp.json` |
| **Windsurf** | `APPDATA/Windsurf/mcp.json` (wrong dir + wrong filename) | `~/.codeium/windsurf/mcp_config.json` |

All three wrong paths have been removed. Sources: [VS Code docs](https://code.visualstudio.com/docs/copilot/customization/mcp-servers), [Cursor docs](https://cursor.com/docs/context/mcp), [Windsurf docs](https://docs.windsurf.com/windsurf/cascade/mcp).

### High — `--check` Compared Against Wrong Reference Version

**Root cause:** `--check` compared IDE config versions against the running binary version, not npm latest. If the installer ran from local source (e.g. `v1.2.5`), an IDE config stamped `v1.4.0` would show "update available (v1.2.5)" — completely backwards.

**Fix:** `--check` now fetches npm latest **first**, before entering the IDE loop. All comparisons use `npmLatest ?? currentVersion` as the reference. Pre-release scenarios (running ahead of npm) are correctly labelled `⚡ running pre-release`.

---

## Improvements

### Multi-IDE Awareness

The installer now understands that most developers have multiple IDEs installed simultaneously. Behavior change summary:

- **`--yes` without `--ide`:** Scans all installed IDEs via filesystem and installs to **all of them** in one pass (previously errored if no IDE was detected in the terminal env).
- **Auto-detect:** When a terminal IDE is detected, a filesystem scan runs in parallel. Additional IDEs are displayed ("Also found: Cursor, Claude Code (CLI)") and included in the default install.
- **Interactive menu:** The "Install to ALL" option now shows exactly which IDEs were found on the machine before the user confirms.
- **New `detectInstalledIdes()`:** Filesystem-based scan independent of terminal env vars — finds all IDEs whose config file or parent directory exists.

### Improved IDE Detection Reliability

- **Cursor:** Now checks `CURSOR_TRACE_ID` env var and `process.execPath` for the word `"cursor"` before falling back to fragile `PATH`/`VSCODE_CWD` string matching. Handles custom install directories on Windows.
- **Visual Studio:** Added detection via `VSINSTALLDIR` and `VisualStudioVersion` env vars (set by the VS Developer Command Prompt / PowerShell).

### CWD Source Conflict Warning

When `npx` resolves to the **local Engram source directory** (because the `CWD`'s `package.json` name matches `engram-mcp-server`), the installer now prints a clear warning before doing anything:

```
⚠️  Running from the engram source directory.
   Version shown reflects the local build — not the published npm package.
   For an accurate check: npm install -g engram-mcp-server@latest && engram --check
```

### JetBrains Install Warning

The official JetBrains documentation does not publish a file-based global config path for MCP. Configuration is managed through **Settings › Tools › AI Assistant › Model Context Protocol** in the IDE. When installing for JetBrains, the installer now prints a warning and directs users to the Settings UI. The file-based path is retained as a best-effort fallback for configurations where it may work.

### Claude Code CLI Hint — Argument Order Fixed

The native CLI install hint for Claude Code displayed the wrong argument order. Positional arguments (`name`, `json`) must come before optional flags (`--scope`):

```bash
# Before (broken — flag before positional args)
claude mcp add-json --scope=user engram '{...}'

# After (correct)
claude mcp add-json engram '{...}' --scope user
```

---

## Fixes & Internal

- Added `Roo Code` (`rooveterinaryinc.roo-cline`) as a second Cline config path alongside `saoudrizwan.claude-dev`
- Inline source URL comments added to every IDE config path for future maintainability
- Fixed test asserting `InstallResult` value `"updated"` (invalid) — corrected to `"legacy-upgraded"`; added new test for `"upgraded"` scenario
- Fixed `IDE_CONFIGS.visualstudio` test asserting `configKey === "mcpServers"` — corrected to `"servers"`

---

**Full Changelog**: https://github.com/keggan-std/Engram/compare/v1.4.0...v1.4.1

---

# v1.4.0 — Versioned Installs, Auto-Update & Update CLI

**Engram v1.4.0 is live.** This release brings full version awareness to the installer, a background update check service, and user-controlled update management — so agents can keep users informed about new releases without ever interrupting their work.

---

## Breaking Changes

None. v1.4.0 is fully backwards-compatible. Existing IDE config entries (without `_engram_version`) are automatically adopted on the next `engram install` run.

---

## What's New

### Version-Tracked Installer Entries

Every IDE config entry written by the installer is now stamped with `_engram_version`. On re-install, the installer detects one of four states and reports it clearly:

| State | Meaning |
|-------|---------|
| `added` | Fresh install — no prior entry existed |
| `exists` | Already installed at this version — nothing written |
| `upgraded` | Updated from a known older version to the current one |
| `legacy-upgraded` | Entry existed without a version stamp (pre-v1.4.0) — adopted and stamped |

The old `"updated"` status has been replaced by the more precise `"upgraded"` and `"legacy-upgraded"` outcomes.

### Background Auto-Update Check

Engram now checks for new versions silently after the MCP server connects. The check is:
- **Fire-and-forget:** runs via `setImmediate`, never blocks startup or any tool call
- **Throttled:** runs at most once per 24 hours
- **Opt-out:** disabled via `engram_config set auto_update_check false`
- **Snooze-aware:** respects `auto_update_remind_after` (e.g., `7d`, `2w`, `1m`)
- **Skip-aware:** respects `auto_update_skip_version` to permanently silence a specific version
- **Level-aware:** `auto_update_notify_level` (`"major"` | `"minor"` | `"patch"`) controls which bump sizes trigger a notification

### Update Notifications via `engram_start_session`

When a newer version is available, `engram_start_session` includes an `update_available` field in its response across all three verbosity levels (`minimal`, `summary`, `full`):

```json
"update_available": {
  "installed_version": "1.3.0",
  "available_version": "1.4.0",
  "changelog": "### v1.4.0 — ...",
  "releases_url": "https://github.com/keggan-std/Engram/releases"
}
```

The agent presents this to the user, who can respond with any of:
- **Update** → agent tells user to run `npx -y engram-mcp-server install`
- **Skip this version** → `engram_config set auto_update_skip_version 1.4.0`
- **Postpone** → `engram_config set auto_update_remind_after 7d`
- **Disable checks** → `engram_config set auto_update_check false`

### Two-Source Changelog Delivery

Update notifications include the release changelog fetched from:
1. **npm registry** (`https://registry.npmjs.org/engram-mcp-server/latest`) — includes the `releaseNotes` field injected at publish time by the new pre-publish script
2. **GitHub Releases API** — fallback when the registry is unreachable or `releaseNotes` is absent

Both sources use a 5-second timeout. Network failures are silent — startup is never affected.

### New `--check` CLI Flag

```bash
npx -y engram-mcp-server install --check
```

Shows the installed version for every detected IDE, fetches the npm latest, and correctly handles three scenarios:

| Scenario | Label |
|----------|-------|
| Running == npm latest | `✅ up to date` |
| Running > npm latest | `⚡ running pre-release (vX.Y.Z > npm vA.B.C)` |
| Running < npm latest | `⬆  npm has vX.Y.Z — run: npx -y engram-mcp-server install` |

### `engram_stats` — Version & Update Status

`engram_stats` now returns:

```json
{
  "server_version": "1.4.0",
  "update_status": { "available": true, "version": "1.5.0", "releases_url": "..." },
  "auto_update_check": "enabled",
  "last_update_check": "2026-02-23T00:00:00.000Z"
}
```

### `engram_config` — New Update Keys

Four new keys are now accepted by `engram_config`:

| Key | Type | Description |
|-----|------|-------------|
| `auto_update_check` | `true`/`false` | Enable/disable background update checks |
| `auto_update_skip_version` | string | Version to permanently silence (e.g., `1.4.1`) |
| `auto_update_remind_after` | duration or ISO date | Snooze updates (`7d`, `2w`, `1m`, or ISO string) |
| `auto_update_notify_level` | `major`/`minor`/`patch` | Minimum bump size to trigger a notification |

### Pre-publish Release Notes Injection

A new `scripts/inject-release-notes.js` script runs automatically before every `npm publish` (as part of the `prepack` lifecycle). It reads `RELEASE_NOTES.md`, extracts the current version's section, and writes it into `package.json` as `releaseNotes`. This allows the update service to deliver changelogs in a single HTTP call to the npm registry — no CDN dependency, no GitHub rate limits.

---

## Fixes & Internal

- Removed duplicate `getVersion()` function from `src/installer/index.ts` — now uses `getInstallerVersion()` from `config-writer.ts` as single source of truth
- `UpdateService` uses only built-in Node.js 18+ `fetch` — no new runtime dependencies added
- `addToConfig()` now uses version-first comparison instead of full JSON deep-equal, making the comparison logic explicit and testable

---

**Full Changelog**: https://github.com/keggan-std/Engram/compare/v1.3.0...v1.4.0

---

# v1.3.0 — Token Efficiency, Batch Ops, Health Tooling & Path Normalization

**Engram v1.3.0 is live.** This release focuses on making agents smarter with their context budget, more reliable across platforms, and better equipped to inspect their own memory layer.

---

## Breaking Changes

None. v1.3.0 is fully backwards-compatible. All existing tool calls and configurations work unchanged.

---

## What's New

### Session Verbosity Control
`engram_start_session` now accepts a `verbosity` parameter:

| Value | Description | Token Savings |
|-------|-------------|---------------|
| `"minimal"` | Counts only — no raw rows | ~90% fewer |
| `"summary"` | Truncated recent items (default) | ~60–80% fewer |
| `"full"` | Full context including file tree | Unchanged |

Agents working on large projects no longer need to burn their context window just to start a session.

### New Tool: `engram_config`
Read or update Engram's runtime configuration directly from agent tools — no file edits required:
- `auto_compact` (true/false)
- `compact_threshold` (number of sessions)
- `retention_days`
- `max_backups`

### New Tool: `engram_health`
On-demand database diagnostics:
- SQLite integrity check
- Schema version
- FTS5 availability
- WAL mode status
- Per-table row counts
- Active config dump

### Batch Operations
Both `engram_record_decision` and `engram_set_file_notes` now accept arrays. Multiple entries are written in a single atomic SQLite transaction — faster and safer when documenting a batch of changes at once.

### Path Normalization
File paths are now normalized on write and lookup:
- Backslashes → forward slashes
- `./` prefix stripped
- Consecutive slashes collapsed
- Trailing slashes stripped

This fixes silent mismatches on Windows where agents use `\` and lookups fail against stored `/` paths.

### Similar Decision Detection
When calling `engram_record_decision`, Engram now checks for semantically similar active decisions using keyword matching. A `similar_decisions` warning is returned if matches are found — helping agents avoid creating duplicate entries.

### Unified Response Helpers
All 30+ tools now return responses through shared `success()` / `error()` helpers. The output shape is now consistent and predictable across every tool, making response parsing reliable for agent integrations.

### Services Layer
Internal refactoring: `CompactionService`, `EventTriggerService`, `GitService`, and `ProjectScanService` are now initialized as proper singletons via `getServices()` and injected into tools — separating business logic from raw SQL.

### Expanded Test Suite
- `tests/repositories/batch.test.ts` — covers `upsertBatch` and `createBatch`
- `tests/unit/normalize-path.test.ts` — covers all `normalizePath()` edge cases
- `tests/unit/repos.test.ts` — covers repository layer methods

Total automated tests now exceed **50**.

---

## Fixes in v1.2.7 – v1.2.9

These patch releases shipped between v1.2.6 and v1.3.0:

| Version | Fix |
|---------|-----|
| v1.2.7 | Include `dist/` in the published npm package; document Windows build requirements for native SQLite binaries |
| v1.2.8 | Correct IDE detection logic and fix local install path default |
| v1.2.9 | Installer UX improvements; remove package bloat; sync version across files; pin `prebuild-install` to 7.1.3 |

---

**Full Changelog**: https://github.com/keggan-std/Engram/compare/v1.2.9...v1.3.0
