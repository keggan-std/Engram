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
