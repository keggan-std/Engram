# Engram

### Persistent Memory Cortex for AI Coding Agents

---

**Engram** is an MCP (Model Context Protocol) server that gives AI coding agents persistent memory across sessions. Instead of re-reading files, re-discovering architecture, and re-learning conventions every time a session starts, the agent calls `engram_start_session` and instantly receives everything it needs: what happened last time, what changed since, what decisions are active, what conventions to follow, and what tasks are pending.

Named after the [engram](https://en.wikipedia.org/wiki/Engram_(neuropsychology)) — the hypothetical means by which memory traces are stored in the brain — this server acts as the agent's long-term memory cortex.

---

## The Problem

Every AI coding agent (GitHub Copilot, Claude Code, Cursor, Windsurf, Cline, etc.) is **stateless by default**. Each new session starts from scratch:

- The agent re-reads file structures and re-discovers architecture
- Architectural decisions made in previous sessions are forgotten
- The agent doesn't know what changed since it last worked
- Conventions agreed upon are lost
- Work-in-progress tasks have no continuity
- Time, tokens, and patience are wasted on repeated discovery

## The Solution

Engram is a local MCP server that maintains a SQLite database in your project (`.engram/memory.db`). The agent reads from it, writes to it, and picks up exactly where it left off.

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

### 🔍 Full-Text Search
Search across everything: sessions, changes, decisions, file notes, conventions, and tasks. Find anything the agent has ever recorded.

### 🗺️ Project Scanning
Cached filesystem scanning with automatic architectural layer detection. The agent gets a structural overview without re-walking the directory tree.

### 📊 Dependency Mapping
Track file dependencies and dependents. Understand the impact radius of changes before making them.

### 🏆 Milestones
Record major project achievements — feature completions, releases, major refactors. Build a project timeline.

### 📦 Export & Import
Export the entire memory as portable JSON. Import into another project or share knowledge with teammates.

### 🗜️ Memory Compaction
Automatically summarize old session data to keep the database lean while preserving important context.

### 📈 Statistics Dashboard
See total sessions, changes, decisions, most-changed files, layer distribution, task status, and database size at a glance.

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
| `engram_search` | Full-text search across all memory | Yes |
| `engram_what_changed` | Comprehensive diff report since a timestamp | Yes |
| `engram_get_dependency_map` | File dependency graph | Yes |
| `engram_record_milestone` | Record a project milestone | No |
| `engram_get_milestones` | Browse milestone timeline | Yes |
| `engram_stats` | Memory statistics dashboard | Yes |
| `engram_compact` | Compress old session data | No |
| `engram_export` | Export memory as JSON | Yes |
| `engram_import` | Import memory from JSON | No |
| `engram_clear` | Clear memory (with safety confirmation) | No |

---

## Installation

### Prerequisites
- Node.js 18+ installed
- npm or yarn

### Setup

```bash
# Clone or copy the server into your tools directory
cd /path/to/your/tools
git clone <repo-url> engram-mcp-server
cd engram-mcp-server

# Install dependencies
npm install

# Build
npm run build

# (Optional) Install git hooks for automatic change tracking
npm run install-hooks
```

### Verify it works

```bash
# Test with MCP Inspector
npm run inspect
```

---

## Configuration

### Claude Code

Add to `~/.claude.json` or your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "engram": {
      "command": "node",
      "args": ["/absolute/path/to/engram-mcp-server/dist/index.js"],
      "env": {
        "ENGRAM_PROJECT_ROOT": "/path/to/your/project"
      }
    }
  }
}
```

Or for auto-detection (recommended — Engram walks up from cwd to find the project root):

```json
{
  "mcpServers": {
    "engram": {
      "command": "node",
      "args": ["/absolute/path/to/engram-mcp-server/dist/index.js"]
    }
  }
}
```

### Cursor

In Cursor Settings → Features → MCP Servers, add:

```json
{
  "engram": {
    "command": "node",
    "args": ["/absolute/path/to/engram-mcp-server/dist/index.js"]
  }
}
```

### VS Code (with Copilot MCP support)

Create `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "engram": {
      "command": "node",
      "args": ["/absolute/path/to/engram-mcp-server/dist/index.js"]
    }
  }
}
```

### Visual Studio 2022/2026 Enterprise

Visual Studio's MCP support is configured through the IDE:

1. **Tools → Options → GitHub Copilot → MCP Servers** (or Language Server Protocol settings)
2. Add a new MCP server entry:
   - **Name**: `engram`
   - **Command**: `node`
   - **Arguments**: `/absolute/path/to/engram-mcp-server/dist/index.js`
   - **Working Directory**: Your project root

Alternatively, create a `.vs/mcp.json` in your solution root:

```json
{
  "servers": {
    "engram": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/engram-mcp-server/dist/index.js"],
      "env": {
        "ENGRAM_PROJECT_ROOT": "${solutionDir}"
      }
    }
  }
}
```

### Cline / Roo Code

In the Cline extension settings → MCP Servers:

```json
{
  "engram": {
    "command": "node",
    "args": ["/absolute/path/to/engram-mcp-server/dist/index.js"],
    "disabled": false
  }
}
```

### Windsurf

In Settings → MCP:

```json
{
  "mcpServers": {
    "engram": {
      "command": "node",
      "args": ["/absolute/path/to/engram-mcp-server/dist/index.js"]
    }
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

All data is stored in `.engram/memory.db` (SQLite) inside your project root. This directory is automatically added to `.gitignore`.

### Schema

- **sessions** — Session lifecycle (start, end, summary, agent name)
- **changes** — File modifications with type, description, and impact scope
- **decisions** — Architectural decisions with rationale, tags, and status
- **file_notes** — Per-file intelligence (purpose, deps, layer, complexity)
- **conventions** — Project rules and coding standards
- **tasks** — Work items with priority, status, and assignments
- **milestones** — Project achievements and version markers
- **snapshot_cache** — Cached computed data with TTL

### Backup

The database is a single file. Back it up by copying `.engram/memory.db`, or use `engram_export` for a portable JSON export.

---

## Tips for Best Results

1. **Always call `engram_start_session` first** — this is the agent's "wake up" call that loads all context.

2. **Record changes as you go** — don't wait until the end. Bulk recording is supported.

3. **Log decisions immediately** — "We chose X over Y because Z" is invaluable in future sessions.

4. **Use file notes liberally** — especially for complex files. A 2-line purpose note saves 5 minutes of re-reading.

5. **End sessions with good summaries** — the summary is literally the first thing the next session sees.

6. **Install git hooks** — `npm run install-hooks` gives you automatic change tracking even when the agent doesn't explicitly record changes.

7. **Use tasks for continuity** — if work is interrupted, create a task so the next session knows to pick it up.

8. **Compact periodically** — after 50+ sessions, run `engram_compact` to keep the database lean.

---

## License

MIT

---

*Engram: Because your AI agent shouldn't have amnesia.*
