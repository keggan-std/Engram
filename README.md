<div align="center">

# 🧠 Engram

> **Persistent Memory Cortex for AI coding agents. Gives agents session continuity, change tracking, decision logging, and multi-agent coordination across sessions.**

![npm](https://img.shields.io/npm/v/engram-mcp-server?style=flat-square&logo=npm)
![Build](https://img.shields.io/github/actions/workflow/status/keggan-std/Engram/ci.yml?style=flat-square)
![Claude Compatible](https://img.shields.io/badge/Claude-Compatible-D97706?style=flat-square&logo=anthropic)
![Multi-Agent](https://img.shields.io/badge/Multi--Agent-Ready-22C55E?style=flat-square)
![VS Code Support](https://img.shields.io/badge/VS%20Code-Supported-007ACC?style=flat-square&logo=visualstudiocode)
![Visual Studio Support](https://img.shields.io/badge/Visual%20Studio-Supported-5C2D91?style=flat-square&logo=visualstudio)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

</div>

---

## 📋 Table of Contents
- [Overview](#overview)
- [Why Engram?](#why-engram)
- [Installation (Auto & Manual)](#installation)
- [✨ What's New in v1.6.0](#-whats-new-in-v160)
- [Features](#features)
- [Architecture](#architecture)
- [Tools Reference](#tools-reference)
- [Using with AI Agents](#using-with-ai-agents)
- [Multi-Agent Workflows](#multi-agent-workflows)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

**Engram** is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that gives AI coding agents persistent memory across sessions. Instead of re-reading files, re-discovering architecture, and re-learning conventions every time a session starts, the agent calls `engram_start_session` and instantly receives everything it needs.

It operates seamlessly as a background brain for popular AI tools like **Claude Code**, **Claude Desktop**, **Cursor**, **Windsurf**, **Cline**, **Trae IDE**, and **GitHub Copilot** (VS Code & Visual Studio).

---

## Why Engram?

Every AI coding agent is **stateless by default**. Each new session starts from scratch:
- The agent re-reads file structures and re-discovers architecture.
- Architectural decisions made in previous sessions are forgotten.
- Conventions agreed upon are lost.
- Work-in-progress tasks have no continuity.
- **Time, tokens, and patience are wasted on repeated discovery.**

Engram solves this by providing a **persistent brain** using a native SQLite (WAL mode) database. An AI agent should only need to deeply review a file once. When you ask it to change something, it should already know where to go.

---

## ✨ What's New in v1.6.0

**v1.6.0** is a major feature release delivering seven capability tracks focused on agent safety, seamless handoffs, deeper memory intelligence, and session diagnostics.

### 🔒 Agent Safety — File Locking & Pending Work
Two new tools prevent concurrent write conflicts between parallel agents: `engram_lock_file` and `engram_unlock_file`. Locks auto-expire after 30 minutes and are surfaced in `engram_get_file_notes` via a `lock_status` field. A companion pair — `engram_begin_work` / `engram_end_work` — lets agents declare intent before touching a file. Abandoned work from crashed sessions surfaces in `engram_start_session` as `abandoned_work`.

### 🌡️ Context Pressure Detection
`engram_check_events` now fires a `context_pressure` event at three thresholds (50%/70%/85%) so agents know when to wrap up and hand off before hitting the context wall.

### 🌿 Branch-Aware File Notes & Decision Chains
File notes now record the git branch they were written on. On a different branch, `engram_get_file_notes` warns that notes may not reflect the current file. Decisions now support a `depends_on` field linking them to prerequisite decisions.

### 🤝 Session Handoffs
`engram_handoff` lets an agent leaving due to context exhaustion package up everything the next agent needs: open tasks, last file touched, git branch, and instructions. `engram_acknowledge_handoff` clears it. All `start_session` verbosity modes surface `handoff_pending` when a handoff is waiting.

### 💡 Smart Start Session (suggested_focus & more)
`engram_start_session` now suggests a `suggested_focus` automatically when none is provided — derived from the most recent file change, highest-priority task, and latest decision. It also warns on abandoned_work and handoff_pending in a unified message per verbosity mode.

### 🔗 Git Hook Auto-Recording
`engram install --install-hooks` writes a `post-commit` git hook that automatically calls `engram record-commit` after every commit — recording changed files to Engram without any agent action.

### 🎬 Session Replay & Diagnostics
Every MCP tool call is logged to a new `tool_call_log` table. The new `engram_replay` tool reconstructs the complete chronological timeline of any session: tool calls, changes, decisions, and tasks interleaved by timestamp.

> Previous release: **v1.5.0** — Multi-Agent Coordination, Trustworthy Context & Knowledge Intelligence. [Full release notes →](RELEASE_NOTES.md)

---

## Installation

Engram is published to the npm registry. **You do not need to download or compile any code.** Your IDE will download and run the latest version automatically using `npx`.

### Prerequisites

Engram uses **SQLite** for persistent storage via the `better-sqlite3` library, which includes a native C++ addon. On most systems this is handled automatically via prebuilt binaries. However, if no prebuilt binary matches your platform, npm will attempt to compile from source — which requires:

- **Windows:** [Node.js](https://nodejs.org) (v18+) and [Windows Build Tools](https://github.com/nodejs/node-gyp#on-windows) (Visual C++ Build Tools + Python). Install them with:
  ```bash
  npm install -g windows-build-tools
  ```
  Or install **"Desktop development with C++"** via the [Visual Studio Installer](https://visualstudio.microsoft.com/downloads/).
- **Mac:** Xcode Command Line Tools (`xcode-select --install`)
- **Linux:** `build-essential` and `python3` (`sudo apt install build-essential python3`)

### Option 1: The Magic Installer (Interactive)
Run this single command in your terminal. It will automatically detect your IDE and safely inject the configuration:

```bash
npx -y engram-mcp-server --install
```

**Non-interactive mode (CI/CD / Scripting):**
```bash
npx -y engram-mcp-server install --ide vscode --yes
```

**Clean removal:**
```bash
npx -y engram-mcp-server install --remove --ide claudecode
```

**Check installed version vs npm latest:**
```bash
npx -y engram-mcp-server --check
```

### Option 2: Global Install (Windows Fallback)

If `npx -y engram-mcp-server --install` fails on Windows, install globally first then run the installer:

```bash
npm install -g engram-mcp-server
engram install --ide <your-ide>
```

> **Note:** During install you may see `npm warn deprecated prebuild-install@7.1.3`. This is a cosmetic warning from a transitive dependency used to download SQLite prebuilt binaries. It does not affect functionality and is safe to ignore.

### Option 3: Manual Configuration

If you prefer to configure manually, find your IDE below:

<details>
<summary><strong>Claude Code (CLI)</strong></summary>

Run this in your terminal:
```bash
claude mcp add-json --scope=user engram '{"type":"stdio","command":"cmd","args":["/c","npx","-y","engram-mcp-server"]}'
```
*(Omit `"command":"cmd"` and `"args":["/c", ...]` on Mac/Linux, use just `"command":"npx"`).*
</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to your `claude_desktop_config.json`:
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`

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
</details>

<details>
<summary><strong>VS Code (GitHub Copilot)</strong></summary>

Create `.vscode/mcp.json` in your project root, or add to your global user `settings.json`:
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
</details>

<details>
<summary><strong>Cursor & Windsurf</strong></summary>

For Cursor, edit `~/.cursor/mcp.json`. For Windsurf, edit `~/.codeium/windsurf/mcp_config.json`:
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
</details>

<details>
<summary><strong>Visual Studio 2022/2026</strong></summary>

Create `.vs/mcp.json` in your solution root:
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
</details>

<details>
<summary><strong>Trae IDE</strong></summary>

For Trae IDE, edit `.trae/mcp.json` in your project root:
```json
{
  "mcpServers": {
    "engram": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "engram-mcp-server"]
    }
  }
}
```
</details>

<details>
<summary><strong>JetBrains (Copilot Plugin)</strong></summary>

Edit `~/.config/github-copilot/intellij/mcp.json` or use the built-in Settings → MCP Server:
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
</details>

<details>
<summary><strong>Cline / Roo Code</strong></summary>

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
</details>

---

## Features

- 🧠 **Session Continuity:** Each session automatically receives the previous session's summary, changes, decisions, and full project context. Use the `focus` parameter to FTS5-rank all context around the topic you're about to work on. `suggested_focus` is returned automatically when no focus is provided.
- 🔐 **Trustworthy Context:** File notes track `file_mtime` and `git_branch` at write time. Returns `confidence` (`high`, `medium`, `stale`, `unknown`) and a `branch_warning` when the current branch differs from when notes were stored.
- 🔒 **Agent Safety:** `engram_lock_file` / `engram_unlock_file` prevent concurrent write conflicts. `engram_begin_work` / `engram_end_work` record intent before touching files. Abandoned work from prior sessions surfaces in `start_session`.
- 🤖 **Multi-Agent Coordination:** Multiple agents can collaborate simultaneously. Atomic task claiming prevents duplicate work. Agent heartbeat registry tracks who is alive and idle.
- 🤝 **Session Handoffs:** `engram_handoff` packages all necessary context (tasks, files, git branch, instructions) for graceful agent-to-agent transfers at context limits. `engram_acknowledge_handoff` clears the pending handoff.
- 🌡️ **Context Pressure Detection:** `engram_check_events` fires at 50%/70%/85% context fill — giving agents advance warning before hitting the context wall.
- 🌐 **Global Knowledge Base:** Export decisions and conventions to a shared cross-project store at `~/.engram/global.db`. Query it from any project with `engram_get_global_knowledge`.
- ⏰ **Scheduled Events:** Postpone tasks or set reminders. Triggers include `next_session`, `datetime`, or `task_complete`.
- 📝 **Change Tracking:** Records every file modification with context. Combines agent-recorded changes with `git` history. Git hook integration (`--install-hooks`) auto-records commits.
- 🏗️ **Architectural Decision Records:** Logs design decisions with rationale, affected files, and tags forever. `depends_on` field models prerequisite decision chains. FTS5 deduplication warns on similar existing decisions.
- 📁 **File Intelligence:** Stores per-file notes (purpose, deps, layer, complexity) with branch-aware staleness detection preventing endless re-reads.
- 📐 **Convention Tracking:** Records and enforces project conventions (naming, testing, styling).
- ✅ **Task Management:** Work items persist across sessions with priority, status, and multi-agent claiming. End-session warns on unclosed claimed tasks.
- 🔍 **Precise Full-Text Search (FTS5):** High-performance ranked search across all memory, with `context_chars` enrichment and per-result `confidence` levels for file note results.
- 🎬 **Session Replay:** `engram_replay` reconstructs the complete tool-call + change + decision timeline for any session via the new `tool_call_log` table.
- 💾 **Backup & Restore:** `engram_backup` creates timestamped SQLite copies to any path (like Dropbox/OneDrive) for cross-machine portability.
- 📊 **Reports, Stats & Commit Suggestions:** Generate Markdown project reports, per-agent activity metrics, and conventional commit messages from session data.

---

## Architecture

```mermaid
graph TB
    A1([Agent 1])
    A2([Agent 2])
    A3([Agent N])
    MCP([MCP Protocol Server])
    NPM([npm Registry / GitHub])

    subgraph Core Services
        TS[Task Service]
        CS[Compaction Service]
        GS[Git Tracking Service]
        ES[Event Trigger Service]
        US[Update Service]
        CO[Coordination Service]
    end

    subgraph Data Layer
        DB[(SQLite WAL\nProject DB)]
        FTS[FTS5 Search Index]
        GDB[(Global KB\n~/.engram/global.db)]
    end

    A1 & A2 & A3 <-->|JSON-RPC| MCP
    MCP --> TS & CS & GS & ES & US & CO
    TS & CS & GS & ES & CO --> DB
    US -->|async, fire-and-forget| NPM
    US --> DB
    DB --> FTS
    MCP -->|export_global| GDB
    MCP -->|get_global_knowledge| GDB
```

---

## Tools Reference

Engram exposes 50+ tools. Here are the highlights:

### Core Memory Tools
| Tool | Purpose |
|------|---------|
| `engram_start_session` | Begin a session. Pass `focus` to FTS5-rank context. Returns `suggested_focus`, `abandoned_work`, `handoff_pending`. |
| `engram_end_session` | End session, storing a summary. Warns on unclosed claimed tasks. |
| `engram_record_change` | Record file changes with descriptions, impact scope, and diff summaries. |
| `engram_set_file_notes` | Store intelligence about a file (purpose, deps, layer, complexity). Captures `file_mtime` and `git_branch`. |
| `engram_get_file_notes` | Retrieve notes with staleness detection (`confidence`) and `branch_warning` if branch differs. Also returns `lock_status`. |
| `engram_record_decision` | Log an architectural decision with optional `depends_on` dependency chain. |
| `engram_record_decisions_batch` | Record multiple decisions in a single atomic call. |
| `engram_add_convention` | Record a project convention. Use `export_global` to share cross-project. |

### Agent Safety
| Tool | Purpose |
|------|---------|
| `engram_lock_file` | Acquire an exclusive write lock on a file. Returns lock status and holder if already locked. |
| `engram_unlock_file` | Release a previously acquired lock. |
| `engram_begin_work` | Record intent to work on a set of files before touching them. |
| `engram_end_work` | Mark work intent complete or cancelled. |

### Session Handoffs
| Tool | Purpose |
|------|---------|
| `engram_handoff` | Package context (tasks, last file, git branch, instructions) for the next agent when approaching context limits. |
| `engram_acknowledge_handoff` | Mark a pending handoff as read, clearing it from future `start_session` responses. |

### Tasks & Scheduling
| Tool | Purpose |
|------|---------|
| `engram_create_task` | Create a persistent work item with priority and tags. |
| `engram_update_task` | Update task status, description, or mark complete. |
| `engram_get_tasks` | Retrieve tasks filtered by status, priority, or tags. |
| `engram_schedule_event` | Schedule deferred work with a trigger (`next_session`, `datetime`, etc). |
| `engram_check_events` | Mid-session check for triggered events. Includes `context_pressure` at 50%/70%/85%. |

### Multi-Agent Coordination
| Tool | Purpose |
|------|---------|
| `engram_dump` | Submit unstructured text — auto-classified into decisions, tasks, conventions, findings. |
| `engram_agent_sync` | Register agent heartbeat and receive pending broadcasts. |
| `engram_claim_task` | Atomically claim a task to prevent duplicate work across agents. |
| `engram_release_task` | Release a claimed task back to the pool. |
| `engram_get_agents` | List all registered agents with status and last-seen time. |
| `engram_broadcast` | Send a message to all agents working on this project. |

### Intelligence & Search
| Tool | Purpose |
|------|---------|
| `engram_search` | FTS5-ranked full-text search. File note results include `confidence` levels. |
| `engram_scan_project` | Scan and cache project structure automatically. |
| `engram_get_decisions` | Retrieve decisions filtered by status, tag, affected file, or dependency chain. |
| `engram_get_conventions` | Retrieve active conventions, optionally filtered by category. |
| `engram_get_global_knowledge` | Query the cross-project global KB at `~/.engram/global.db`. |
| `engram_get_dependency_map` | Get the file dependency graph for a module. |
| `engram_what_changed` | Summarise all changes since a given timestamp or session. |
| `engram_replay` | Reconstruct the complete tool-call + change + decision timeline for any session. |

### Utilities & Reports
| Tool | Purpose |
|------|---------|
| `engram_generate_report` | Generate a Markdown project report (handoffs, PR descriptions). |
| `engram_suggest_commit` | Generate a conventional commit message from session changes. |
| `engram_stats` | Project stats including per-agent metrics (sessions, changes, decisions per agent). |
| `engram_backup` | Create a database backup to any synced folder. |
| `engram_restore` | Restore from a previous backup. |
| `engram_compact` | Compress old session data to reduce database size. |
| `engram_config` | Read or update runtime configuration values. |
| `engram_health` | Run database health checks and report diagnostics. |

*(Run the agent and ask to list available tools for the complete reference).*

---

## Using with AI Agents

Add the following to your agent's system prompt or custom instructions — Cursor Rules, `.github/copilot-instructions.md`, `CLAUDE.md`, or whichever file your IDE reads. The goal is to make the agent consult Engram **before** doing work, not just after. That's where most of the token and time savings come from.

> You have access to **Engram**, a persistent memory MCP server. It stores everything learned about this project across all sessions: file notes, architectural decisions, conventions, tasks, and change history. Use it to avoid re-reading files already analysed, re-debating settled decisions, and re-discovering known context.

---

### 🟢 Session Start

**Always call `engram_start_session` first** — before reading any file or taking any action. Pass `focus` when you know what you're about to work on — it FTS5-ranks returned context around that topic.

```js
engram_start_session({ focus: "authentication refactor" })
```

Act on everything it returns:

| Field | What to do |
|-------|-----------|
| `previous_session.summary` | Read immediately. Do not re-explore what is already known. |
| `active_decisions` | Binding. Follow them; do not re-debate. Supersede with `engram_record_decision` if they must change. |
| `active_conventions` | Enforce in every file you touch this session. |
| `open_tasks` | Pending work items. Ask the user which to focus on if unclear. |
| `abandoned_work` | Work items left open by a previous session that ended unexpectedly. Review and resume or close. |
| `handoff_pending` | A structured handoff from the previous agent. Read instructions, then call `engram_acknowledge_handoff`. |
| `suggested_focus` | Auto-derived topic hint. Pass as `focus` on the next `start_session` call for filtered context. |
| `triggered_events` | Scheduled reminders or deferred work now triggered. Act on them. |
| `update_available` | Tell the user: *"Engram v{available_version} is available (you have {installed_version}). Changes: {changelog}. Update, skip, or postpone?"* |

If `update_available` is set, respond to the user's choice:
- **Update** → `npx -y engram-mcp-server install`
- **Skip** → `engram_config action=set key=auto_update_skip_version value={version}`
- **Postpone** → `engram_config action=set key=auto_update_remind_after value=7d`
- **Disable** → `engram_config action=set key=auto_update_check value=false`

---

### 📂 Before Reading Any File

Always check Engram before opening a file:

```js
engram_get_file_notes({ file_paths: ["path/to/file.ts"] })
```

- **`confidence: "high"`** → Use stored notes. Only open the file if you need to edit it.
- **`confidence: "medium"`** → Notes exist but the file may have minor changes. Use as a guide; open if precision matters.
- **`confidence: "stale"`** → The file has changed significantly since notes were stored. Re-read and update notes.
- **No notes** → Read the file, then immediately call `engram_set_file_notes` with `file_path`, `purpose`, `dependencies`, `dependents`, `layer`, `complexity`, `notes`. Batch multiple files in one call.

> **Rule:** Never read a file already analysed in a previous session without checking Engram first.

---

### 🏛️ Before Making Any Design Decision

Before choosing an implementation approach, search for an existing decision:

```js
engram_search({ query: "relevant keywords", scope: "decisions" })
// or
engram_get_global_knowledge({ query: "relevant keywords" })  // cross-project wisdom
```

- **Decision exists** → Follow it.
- **Should change** → Explain why, then supersede:
  ```js
  engram_record_decision({ decision: "...", supersedes: <id> })
  ```
- **No decision exists** → Make the call and record it:
  ```js
  engram_record_decision({ decision, rationale, affected_files, tags, export_global: true })
  ```

---

### ✏️ When Modifying Files

After every meaningful change, record it. Batch where possible:

```js
engram_record_change({ changes: [{
  file_path,
  change_type,   // created | modified | refactored | deleted | renamed | moved | config_changed
  description,   // What changed AND why — not just the action. Future sessions read this.
  impact_scope   // local | module | cross_module | global
}]})
```

---

### 🔍 When You Don't Know Something

Search Engram before asking the user — they may have already explained it to a previous session:

```js
engram_search({ query: "keywords", context_chars: 200 })  // inline snippets
engram_scan_project()                                       // project structure questions
engram_get_decisions()                                      // architecture / approach questions
engram_get_conventions()                                    // style / pattern questions
engram_get_file_notes({ file_paths: [...] })                // what is known about specific files
engram_get_global_knowledge({ query: "..." })               // cross-project decisions/conventions
```

---

### 🔴 Session End

Before ending every session:

1. Record all file changes not yet recorded (`engram_record_change`).
2. Create tasks for anything incomplete or blocked:
   ```js
   engram_create_task({ title, description, priority })
   ```
3. Call `engram_end_session` with a summary that includes:
   - Exactly what was done — file names, function names, specific changes
   - What is pending or blocked, and why
   - Any new patterns, gotchas, or constraints discovered
   - Which tasks were completed or partially done

A precise summary is what allows the next session to start immediately without re-reading files or re-asking the user for context.

---

## Multi-Agent Workflows

When running multiple agents simultaneously on the same project, use the coordination tools to keep them in sync:

### Agent Registration & Heartbeat

Each agent should call `engram_agent_sync` periodically to stay visible and receive broadcasts:

```js
// On startup and every ~2 minutes
engram_agent_sync({
  agent_id: "agent-frontend",
  name: "Frontend Specialist",
  status: "working",
  current_task_id: 42
})
// Returns: { broadcasts: [...] }  — messages from other agents
```

### Atomic Task Claiming

Use `engram_claim_task` to safely grab a task without duplicating work:

```js
// Claim task 42 — atomic, fails if another agent already claimed it
const result = await engram_claim_task({ task_id: 42, agent_id: "agent-frontend" })
if (result.claimed) {
  // Proceed with the task
} else {
  // result.claimed_by tells you who has it
}
```

### Broadcasting Between Agents

```js
// Notify all agents of a breaking change
engram_broadcast({
  from_agent: "agent-backend",
  message: "⚠️ auth.ts API changed — agents touching auth endpoints need to update",
  expires_in_minutes: 60
})
```

### The `engram_dump` Power Tool

When context is too large or unstructured for individual tool calls, dump it all at once:

```js
engram_dump({
  raw_text: `
    We decided to use JWT for auth with 15-minute expiry.
    TODO: add refresh token endpoint
    TODO: write integration tests for login flow
    Always use bcrypt cost factor 12 for password hashing.
    Found: the existing session table uses unix timestamps not ISO strings.
  `,
  agent_id: "agent-research"
})
// Engram auto-classifies into decisions, tasks, conventions, and findings
```

### Coordination Quick Reference

| Situation | Tool |
|-----------|------|
| Register / heartbeat | `engram_agent_sync` |
| Claim a task atomically | `engram_claim_task` |
| Release a task | `engram_release_task` |
| List active agents | `engram_get_agents` |
| Send a team message | `engram_broadcast` |
| Dump unstructured findings | `engram_dump` |

---

## Contributing

We welcome contributions!
1. Fork the repo and create your branch (`git checkout -b feature/amazing-idea`).
2. Install dependencies: `npm install`.
3. Build the project: `npm run build`.
4. Run tests: `npm test` (Uses Vitest).
5. Commit your changes and open a Pull Request.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">
  <em>Because your AI agent shouldn't have amnesia.</em><br/>
  <strong>Copyright &copy; 2026 Keggan Student - Tanzania</strong>
</div>
