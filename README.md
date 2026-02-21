# Engram

### Persistent Memory Cortex for AI Coding Agents

---

**Engram** is an MCP (Model Context Protocol) server that gives AI coding agents persistent memory across sessions. Instead of re-reading files, re-discovering architecture, and re-learning conventions every time a session starts, the agent calls `engram_start_session` and instantly receives everything it needs: what happened last time, what changed since, what decisions are active, what conventions to follow, and what tasks are pending.

Named after the [engram](https://en.wikipedia.org/wiki/Engram_(neuropsychology)) — the hypothetical means by which memory traces are stored in the brain — this server acts as the agent's long-term memory cortex.

---

## Why Engram Exists

Every AI coding agent — GitHub Copilot, Claude Code, Cursor, Windsurf, Cline — is **stateless by default**. Each new session starts from scratch:

- The agent re-reads file structures and re-discovers architecture
- Architectural decisions made in previous sessions are forgotten
- The agent doesn't know what changed since it last worked
- Conventions agreed upon are lost
- Work-in-progress tasks have no continuity
- **Time, tokens, and patience are wasted on repeated discovery**

### The Vision

Engram was born out of a real frustration: watching AI agents in Visual Studio and other IDEs **review the same files over and over**, burning tokens and time on rediscovery instead of actual work. The idea is simple but powerful:

> **An AI agent should only need to deeply review a file once.** After that, it should *remember* — what the file does, how it's structured, what decisions shaped it, and exactly where things are. When the user asks to change something, the agent shouldn't re-read the entire codebase. It should already know where to go, review the specific area in detail, make the change, and remember how it left things for next time.

This is what Engram provides: a **persistent brain** that makes every session after the first one dramatically faster and more efficient.

```
Session 1                          Session 2
┌──────────────────┐              ┌──────────────────────────────┐
│ Agent scans files │              │ engram_start_session()       │
│ Agent reads code  │              │ → "Last session: refactored  │
│ Agent asks you    │   Engram     │    auth flow. 3 files        │
│ about conventions │ ──────────→  │    changed since. Decision:  │
│ Agent works...    │   remembers  │    use Compose Navigation.   │
│ engram_end_session│              │    2 tasks pending."         │
│ "Refactored auth" │              │                              │
└──────────────────┘              │ Agent already knows context. │
                                  │ Starts working immediately.  │
                                  └──────────────────────────────┘
```

---

## What's New in v1.2.0

### ⏰ Scheduled Events
Defer work to specific triggers — agents can now schedule events for the next session, a specific time, or after a task completes:
- **5 new tools**: `schedule_event`, `get_scheduled_events`, `update_scheduled_event`, `acknowledge_event`, `check_events`
- **4 trigger types**: `next_session`, `datetime`, `task_complete`, `manual`
- **Recurrence**: `every_session`, `daily`, `weekly` — fire repeatedly
- **Approval flow**: Events surface at session start → user reviews → agent executes
- See [`docs/scheduled-events.md`](docs/scheduled-events.md) for full documentation

### 🏷️ Precise Tag Filtering
Replaced imprecise `LIKE '%tag%'` matching with `json_each()` — searching for `auth` no longer matches `authentication` or `oauth`.

### 📦 Full Import/Export
`engram_import` now includes **sessions and changes** (previously skipped) with session ID mapping for FK consistency.

### 🚫 `.engramignore` Support
Create `.engramignore` in your project root to exclude custom directories from scanning (same format as `.gitignore`).

### 🔄 Auto-Scan on Session Start
`start_session` now automatically includes a cached project snapshot — agents no longer need to call `scan_project` manually.

### 📋 Git Hook Log Ingestion
Changes from `.engram/git-changes.log` (written by the post-commit hook) are now automatically parsed and surfaced at session start.

---

<details>
<summary><strong>v1.1.0 Changelog</strong></summary>

### 🚀 Native SQLite Engine (better-sqlite3)
Replaced the in-memory sql.js (WASM) engine with **better-sqlite3** — a native, file-backed SQLite driver with Write-Ahead Logging (WAL). This means:
- **No more loading the entire database into RAM** — reads and writes go directly to disk
- **WAL mode** enables concurrent reads while writing, dramatically improving responsiveness
- **No more full-database re-serialization** on every save — writes are incremental
- **3-5x faster** for typical operations

### 🔄 Schema Migration System
Version-aware, incremental database migrations that run automatically on startup:
- Safely evolves the schema without data loss
- Each migration runs in a transaction — if it fails, nothing changes
- Enables future features to add new tables/indexes without breaking existing databases

### 🔍 FTS5 Full-Text Search
Replaced slow `LIKE '%term%'` pattern matching with **FTS5** (SQLite's Full-Text Search 5):
- **10-100x faster** searches across sessions, changes, decisions, notes, conventions, and tasks
- Ranked results by relevance
- Auto-sync triggers keep FTS indexes current — zero maintenance
- Falls back to LIKE for backward compatibility

### 🛡️ Auto-Backup Before Destructive Operations
Before compaction or clearing memory, Engram automatically creates a backup copy of the database using SQLite's native backup API. No more accidental data loss.

### 💾 Backup & Restore System
New tools for cross-machine portability:
- **`engram_backup`** — Create timestamped backups to any path (including cloud-synced folders)
- **`engram_restore`** — Restore from a backup with automatic safety backup
- **`engram_list_backups`** — Browse available backups
- Auto-pruning keeps backup count under control

### 📊 Enhanced Statistics
`engram_stats` now reports schema version, database engine, and more detailed metrics.

### ⚙️ Configuration Table
Per-project settings for auto-compact threshold, data retention days, and max backup count.

### 📈 Better Indexing
Additional composite indexes for common query patterns — faster queries as data grows.

</details>

---

## Features

### 🧠 Session Continuity
Start and end sessions with summaries. Each new session automatically receives the previous session's summary, all changes since, and full project context.

### 📝 Change Tracking
Record every file modification with context. Combines agent-recorded changes with git history for a complete picture of what happened between sessions.

### 🏗️ Architectural Decision Records
Log design decisions with rationale, affected files, and tags. Decisions persist forever and are surfaced at session start. Supersede old decisions when architecture evolves.

### 📁 File Intelligence
Store per-file notes: purpose, dependencies, dependents, architectural layer, complexity rating, and gotchas. Eliminates the need to re-read and re-analyze files.

### 📐 Convention Tracking
Record project conventions (naming, architecture, styling, testing, etc.) that the agent should always follow. Enforced conventions are automatically surfaced at session start.

### ✅ Task Management
Create, update, and track work items across sessions. Tasks persist until completed — nothing falls through the cracks between sessions. Supports priorities, blocking relationships, and file assignments.

### 🔍 Full-Text Search (FTS5)
High-performance ranked search across everything: sessions, changes, decisions, file notes, conventions, and tasks. Find anything the agent has ever recorded — instantly.

### 🗺️ Project Scanning
Cached filesystem scanning with automatic architectural layer detection. The agent gets a structural overview without re-walking the directory tree.

### ⏰ Scheduled Events
Defer work to specific triggers — next session, a datetime, task completion, or manual check. Events fire automatically and require user approval before execution. Supports recurrence (daily, weekly, every session).

### 📊 Dependency Mapping
Track file dependencies and dependents. Understand the impact radius of changes before making them.

### 🏆 Milestones
Record major project achievements — feature completions, releases, major refactors. Build a project timeline.

### 💾 Backup & Restore
Create and restore database backups to any location. Save to cloud-synced folders for cross-machine portability.

### 📦 Export & Import
Export the entire memory as portable JSON. Import into another project or share knowledge with teammates. Sessions, changes, decisions, conventions, file notes, tasks, and milestones — all included.

### 🗜️ Memory Compaction
Automatically summarize old session data to keep the database lean while preserving important context. Now with auto-backup and age-based retention.

### 📈 Statistics Dashboard
See total sessions, changes, decisions, most-changed files, layer distribution, task status, schema version, and database size at a glance.

---

## Tool Reference

| Tool | Purpose | Read-Only |
|------|---------|-----------|
| `engram_start_session` | Begin a session, get full context from previous session | No |
| `engram_end_session` | End session with summary for next time | No |
| `engram_get_session_history` | Browse past sessions | Yes |
| `engram_record_change` | Record file changes (supports bulk) | No |
| `engram_get_file_history` | Get a file's complete change history | Yes |
| `engram_record_decision` | Log an architectural decision | No |
| `engram_get_decisions` | Retrieve decisions by status/tag/file | Yes |
| `engram_update_decision` | Change decision status | No |
| `engram_set_file_notes` | Store per-file intelligence | No |
| `engram_get_file_notes` | Query file notes by path/layer/complexity | Yes |
| `engram_add_convention` | Record a project convention | No |
| `engram_get_conventions` | Get all active conventions | Yes |
| `engram_toggle_convention` | Enable/disable a convention | No |
| `engram_create_task` | Create a persistent work item | No |
| `engram_update_task` | Update task status/priority | No |
| `engram_get_tasks` | Query tasks with filters | Yes |
| `engram_scan_project` | Scan and cache project structure | No |
| `engram_search` | FTS5-powered search across all memory | Yes |
| `engram_what_changed` | Comprehensive diff report since a timestamp | Yes |
| `engram_get_dependency_map` | File dependency graph | Yes |
| `engram_record_milestone` | Record a project milestone | No |
| `engram_get_milestones` | Browse milestone timeline | Yes |
| `engram_stats` | Memory statistics dashboard | Yes |
| `engram_compact` | Compress old session data (auto-backup) | No |
| `engram_backup` | Create a database backup | No |
| `engram_restore` | Restore from a backup file | No |
| `engram_list_backups` | List available backups | Yes |
| `engram_export` | Export memory as JSON | Yes |
| `engram_import` | Import memory from JSON (full: sessions, changes, decisions, notes, etc.) | No |
| `engram_clear` | Clear memory (auto-backup, safety confirm) | No |
| `engram_schedule_event` | Schedule deferred work with a trigger | No |
| `engram_get_scheduled_events` | List/filter scheduled events | Yes |
| `engram_update_scheduled_event` | Cancel, snooze, or reschedule events | No |
| `engram_acknowledge_event` | Approve or decline a triggered event | No |
| `engram_check_events` | Mid-session check for triggered events | Yes |

---

## Quickstart

Engram is published to the npm registry. **You do not need to download or compile any code.**

As long as you have Node.js installed, your IDE will download and run the latest version of Engram automatically using `npx`.

### Option 1: The Magic Installer (Zero Config)

Run this single command in your terminal. It will automatically detect your IDEs (Cursor, VS Code, Visual Studio, Cline, Windsurf, Antigravity) and inject the correct configuration for you:

```bash
npx -y engram-mcp-server --install
```

*(You can also run `npx -y engram-mcp-server --list` to see what IDEs it detects before installing)*

Restart your IDE, and Engram is ready!

---

### Option 2: Manual Configuration

If you prefer to configure manually, find your IDE below and paste the config snippet.

#### Cline / Roo Code
In the extension settings → MCP Servers:
```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "engram-mcp-server"]
    }
  }
}
```

#### Cursor
1. Go to **Cursor Settings** → **Features** → **MCP**
2. Click **+ Add new MCP server**
3. Select **command** type
4. Name: `engram`
5. Command: `npx -y engram-mcp-server`

#### Claude Desktop
Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "engram-mcp-server"]
    }
  }
}
```

#### VS Code (with GitHub Copilot)
Create `.vscode/mcp.json` in your project root:
```json
{
  "servers": {
    "engram": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "engram-mcp-server"]
    }
  }
}
```
Or add to your user `settings.json` to make it available across all workspaces.

#### Visual Studio 2022/2026
Create `.vs/mcp.json` in your solution root:
```json
{
  "servers": {
    "engram": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "engram-mcp-server"]
    }
  }
}
```
Or create a global config at `%USERPROFILE%\.mcp.json`. Note: Server names in Visual Studio must not contain spaces.

#### Windsurf
In Settings → MCP:
```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "engram-mcp-server"]
    }
  }
}
```

---

### 2. Auto-Updates
Because the configuration uses `npx -y engram-mcp-server`, your agent will **automatically fetch the latest version** of Engram from the npm registry every time it starts. You never have to manually update or run `git pull` again!

---

### 3. Optional: Build from Source
If you prefer to run Engram locally instead of fetching it via `npx` (e.g. for contributing to the repository):

```bash
git clone https://github.com/keggan-std/Engram.git
cd Engram
npm install
npm run build
```
Then, point your MCP configuration to the local `dist/index.js` file instead of using `npx`:
```json
{
  "engram": {
    "command": "node",
    "args": ["/absolute/path/to/Engram/dist/index.js"]
  }
}
```

---

## How It Works

### First Session

```
You: "Set up the project memory"
Agent: [calls engram_start_session]
       → "First session — no prior memory."
Agent: [calls engram_scan_project]
       → Builds file tree, detects layers
Agent: [calls engram_add_convention] × N
       → Records your project conventions
Agent: [calls engram_set_file_notes] × N
       → Documents key files
Agent: [works on your task...]
Agent: [calls engram_record_change] × N
       → Records what it changed
Agent: [calls engram_record_decision]
       → Logs architectural choices
Agent: [calls engram_end_session]
       → "Implemented auth flow with biometric support.
          Pending: unit tests for BiometricViewModel."
```

### Every Session After

```
You: "Continue working on the auth feature"
Agent: [calls engram_start_session]
       → Receives:
         - Previous summary: "Implemented auth flow..."
         - Changes since: 2 files modified via git
         - Decisions: "Use Compose Navigation", "MVVM pattern"
         - Conventions: "All strings in strings.xml", etc.
         - Open tasks: "Write unit tests for BiometricViewModel"
       
       Agent already knows everything. No file scanning needed.
       Starts working immediately on the pending tests.
```

### Moving to a New Machine

```
Old machine:
  Agent: [calls engram_backup output_path="/path/to/cloud-sync/engram-backup.db"]
         → Backup saved to your cloud-synced folder

New machine:
  Agent: [calls engram_restore input_path="/path/to/cloud-sync/engram-backup.db" confirm="yes-restore"]
         → Database restored. All memory intact.
```

---

## Migration from v1.0.0 (sql.js)

If you're upgrading from the original `sql.js` version (v1.0.0) to native SQLite:

1. Follow the **Quickstart** above to update your agent's MCP config to use `npx -y engram-mcp-server`
2. Restart your IDE

**That's it.** Your existing `.engram/memory.db` files are fully compatible. The migration system will automatically upgrade your schema on first startup — adding FTS5 indexes, the config table, composite indexes, and the new scheduled events tables. Your existing data is preserved and instantly searchable.

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `ENGRAM_PROJECT_ROOT` | Explicit project root path | Auto-detected |
| `PROJECT_ROOT` | Fallback project root path | Auto-detected |
| `ENGRAM_TRANSPORT` | Transport type (`stdio`) | `stdio` |

### Project Root Auto-Detection

If no environment variable is set, Engram walks up the directory tree from `cwd` looking for these markers: `.git`, `package.json`, `build.gradle`, `Cargo.toml`, `go.mod`, `pom.xml`, `.sln`, `pyproject.toml`, and others.

---

## Data Storage

All data is stored in `.engram/memory.db` (SQLite with WAL mode) inside your project root. This directory is automatically added to `.gitignore`.

### Database Engine

**v1.1.0+** uses `better-sqlite3` — a native, synchronous SQLite driver with:
- **WAL (Write-Ahead Logging)** — reads don't block writes
- **Direct file I/O** — no in-memory database or manual persistence
- **Native backup API** — consistent, safe backup copies
- **Full FTS5 support** — high-performance full-text search

### Schema

- **sessions** — Session lifecycle (start, end, summary, agent name)
- **changes** — File modifications with type, description, and impact scope
- **decisions** — Architectural decisions with rationale, tags, and status
- **file_notes** — Per-file intelligence (purpose, deps, layer, complexity)
- **conventions** — Project rules and coding standards
- **tasks** — Work items with priority, status, and assignments
- **milestones** — Project achievements and version markers
- **scheduled_events** — Deferred work items with trigger conditions
- **config** — Per-project settings
- **snapshot_cache** — Cached computed data with TTL
- **fts_*** — FTS5 virtual tables for full-text search (auto-maintained)

### Backup

**Native backup**: Use `engram_backup` to create timestamped copies using SQLite's backup API. Save to cloud-synced folders (Dropbox, OneDrive, Google Drive) for cross-machine portability.

**JSON export**: Use `engram_export` for a portable, human-readable JSON dump.

---

## System Prompt for AI Agents

To get the most out of Engram, **add this to your agent's system prompt** (or custom instructions). This tells the agent to use Engram automatically — without this, the agent won't know Engram exists.

```
You have access to Engram, a persistent memory MCP server. Follow these rules:

1. ALWAYS call engram_start_session at the very beginning of each conversation.
   This loads your context: previous session summary, changes, decisions, conventions, and tasks.

2. After deeply reading a file for the first time, call engram_set_file_notes with:
   purpose, dependencies, layer, and complexity. This means you won't need to re-read it next time.

3. After modifying files, call engram_record_change with file path, change type, and description.
   Use bulk recording when changing multiple files.

4. When making architectural decisions, call engram_record_decision with the decision,
   rationale, and affected files. This preserves the "why" for future sessions.

5. Before ending a conversation, call engram_end_session with a detailed summary
   of what was accomplished and what's pending. This summary is the first thing
   the next session will see.

6. If work is interrupted or partially complete, call engram_create_task to ensure
   continuity. The next session will see open tasks automatically.

7. Use engram_search to find anything previously recorded — it uses fast full-text search.
```

You can paste this into your IDE's custom instructions:
- **Cursor**: Settings → Rules → User Rules
- **Claude Code**: `CLAUDE.md` or `~/.claude/CLAUDE.md`
- **Cline**: Custom instructions field in extension settings
- **VS Code Copilot**: `.github/copilot-instructions.md` or `.copilot-instructions.md`
- **Visual Studio**: `.github/copilot-instructions.md` or your GitHub Copilot custom instructions settings

---

## Backup & Restore Guide

### Quick Backup (default location)

The agent calls `engram_backup` — creates a timestamped copy at `.engram/backups/memory-{timestamp}.db`. Old backups are auto-pruned to keep the 10 most recent.

### Backup to Cloud-Synced Folder

For cross-machine portability, back up to a folder that auto-syncs:

```
engram_backup output_path="C:/Users/you/Dropbox/engram-backups/myproject.db"
engram_backup output_path="C:/Users/you/OneDrive/engram-backups/myproject.db"
engram_backup output_path="/Users/you/Google Drive/engram-backups/myproject.db"
```

### Restore on Another Machine

```
engram_restore input_path="C:/Users/you/Dropbox/engram-backups/myproject.db" confirm="yes-restore"
```

A safety backup of the current database is created automatically before overwriting. Restart the MCP server after restoring.

### List Available Backups

```
engram_list_backups
```

Shows all backup files with sizes and timestamps.

### JSON Export (Human-Readable)

```
engram_export output_path="./project-memory.json"
```

Produces a portable JSON dump you can inspect, share, or import into another project with `engram_import`.

---

## Tips for Best Results

### What the agent does automatically

These happen without you doing anything, as long as the system prompt above is configured:

- **Session management** — starts and ends sessions with context and summaries
- **Change tracking** — records file modifications as it works
- **Decision logging** — captures "why" behind architectural choices
- **File intelligence** — stores notes about files it reads deeply
- **Convention tracking** — remembers project rules you agree on
- **Auto-compaction** — when completed sessions exceed the threshold (default: 50), Engram automatically compacts old data at session start, with a backup first

### What you should do

- **Add the system prompt** — without it, the agent won't use Engram at all. This is the single most important step.
- **Install git hooks** — run `npm run install-hooks` once. This tracks git commits even when the agent forgets to record changes.
- **Tell the agent to create tasks** — if you're stopping mid-work, say "create a task for what's pending" so the next session picks it up.
- **Set your backup destination** — tell the agent where to back up: "back up engram to my Dropbox folder." This enables cross-machine portability.

---

## License

MIT

---

*Engram: Because your AI agent shouldn't have amnesia.*

