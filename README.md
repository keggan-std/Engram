<div align="center">

# 🧠 Engram

> **Persistent Memory Cortex for AI coding agents. Gives agents session continuity, change tracking, and decision logging across sessions.**

![npm](https://img.shields.io/npm/v/engram-mcp-server?style=flat-square&logo=npm)
![Build](https://img.shields.io/github/actions/workflow/status/keggan-std/Engram/ci.yml?style=flat-square)
![Claude Compatible](https://img.shields.io/badge/Claude-Compatible-D97706?style=flat-square&logo=anthropic)
![VS Code Support](https://img.shields.io/badge/VS%20Code-Supported-007ACC?style=flat-square&logo=visualstudiocode)
![Visual Studio Support](https://img.shields.io/badge/Visual%20Studio-Supported-5C2D91?style=flat-square&logo=visualstudio)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

</div>

---

## 📋 Table of Contents
- [Overview](#overview)
- [Why Engram?](#why-engram)
- [Installation (Auto & Manual)](#installation)
- [✨ What's New in v1.3.0](#-whats-new-in-v130)
- [Features](#features)
- [Architecture](#architecture)
- [Tools Reference](#tools-reference)
- [Using with AI Agents](#using-with-ai-agents)
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

## ✨ What's New in v1.3.0

- **Session Verbosity Control:** `engram_start_session` now accepts a `verbosity` parameter (`"full"` | `"summary"` | `"minimal"`). Use `"minimal"` for ~90% fewer tokens or `"summary"` (default) for ~60–80% fewer — critical for large projects where context bloat slows agents down.
- **New `engram_config` Tool:** Read and update Engram's runtime configuration directly from your agent — control `auto_compact`, `compact_threshold`, `retention_days`, and `max_backups` without touching any files.
- **New `engram_health` Tool:** On-demand database health check covering integrity, schema version, FTS5 availability, WAL mode status, and per-table row counts.
- **Batch Operations:** `engram_record_decision` and `engram_set_file_notes` now support batch input — document multiple decisions or file notes in a single atomic transaction.
- **Path Normalization:** File paths are now normalized on write (backslashes → forward slashes, `./` prefix stripped, duplicate slashes collapsed). Cross-platform lookups finally work consistently on Windows.
- **Similar Decision Detection:** When recording a decision, Engram automatically checks for semantically similar existing decisions and surfaces them as a warning — reducing duplicate entries.
- **Unified Response Helpers:** All tools now use shared `success()` / `error()` response builders, giving consistent, predictable MCP output shapes across the entire API.
- **Services Layer:** Internal service classes (`CompactionService`, `EventTriggerService`, `GitService`, `ProjectScanService`) are now fully wired and injected — tools delegate to services rather than executing raw SQL inline.
- **Expanded Test Suite:** Added batch-operation tests (`tests/repositories/batch.test.ts`) and unit tests for `normalizePath` and the repository layer (`tests/unit/`). Test count now exceeds 50.

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

- 🧠 **Session Continuity:** Each session automatically receives the previous session's summary, changes, decision, and full project context.
- ⏰ **Scheduled Events:** You can tell Engram to postpone tasks or remind you of things. Triggers include `next_session`, `datetime`, or `task_complete`.
- 📝 **Change Tracking:** Records every file modification with context. Combines agent-recorded changes with `git` history. You can also set up Git hooks to auto-commit logs directly into Engram.
- 🏗️ **Architectural Decision Records:** Logs design decisions with rationale, affected files, and tags forever.
- 📁 **File Intelligence:** Stores per-file notes (purpose, deps, layer, complexity) preventing endless re-reads.
- 📐 **Convention Tracking:** Records and enforces project conventions (naming, testing, styling).
- ✅ **Task Management:** Work items persist across sessions. Ask the agent to create a task for what's pending when you end a session.
- 🔍 **Precise Full-Text Search (FTS5):** High-performance ranked search across all memory, with precise tag filtering using `json_each()`.
- 💾 **Backup & Restore:** `engram_backup` creates timestamped SQLite copies to any path (like Dropbox/OneDrive) for seamless cross-machine portability.

---

## Architecture

```mermaid
graph TB
    AI([AI Agent / IDE])
    MCP([MCP Protocol Server])
    
    subgraph Core Services
        TS[Task Service]
        CS[Compaction Service]
        GS[Git Tracking Service]
        ES[Event Trigger Service]
    end
    
    subgraph Data Layer
        DB[(SQLite WAL)]
        FTS[FTS5 Search Index]
    end
    
    AI <-->|JSON-RPC| MCP
    MCP --> TS & CS & GS & ES
    TS & CS & GS & ES --> DB
    DB --> FTS
```

---

## Tools Reference

Engram exposes 30+ tools. Here are the core highlights of what an agent can do for you:

### Core Memory Tools
| Tool | Purpose |
|------|---------|
| `engram_start_session` | Begin a session, getting full context from previous work. |
| `engram_end_session` | End session, providing a summary for the next time. |
| `engram_record_change` | Record file changes with descriptions. |
| `engram_set_file_notes` | Store intelligence about a file's purpose and complexity. |
| `engram_record_decision` | Log an architectural decision and its rationale. |

### Tasks & Scheduling
| Tool | Purpose |
|------|---------|
| `engram_create_task` | Create a persistent work item between sessions. |
| `engram_schedule_event` | Schedule deferred work with a trigger (`next_session`, `datetime`, etc). |
| `engram_check_events` | Mid-session check for triggered events that require attention. |

### Utilities
| Tool | Purpose |
|------|---------|
| `engram_search` | FTS5-powered full-text search across all memories. |
| `engram_scan_project` | Scan and cache project structure automatically. |
| `engram_backup` | Create a database backup to any synced folder. |
| `engram_config` | Read or update runtime configuration values. |
| `engram_health` | Run database health checks and report diagnostics. |

*(Run the agent and ask to list available tools for the complete reference).*

---

## Using with AI Agents

To get the most out of Engram, **add this to your agent's system prompt or custom instructions** (e.g., Cursor Rules, `.github/copilot-instructions.md`, or `CLAUDE.md`). This guarantees the AI knows how to use it:

```text
You have access to Engram, a persistent memory MCP server. Follow these rules:

1. ALWAYS call engram_start_session at the very beginning of each conversation.
   This loads your context: previous session summary, changes, decisions, conventions, and tasks.

2. After deeply reading a file for the first time, call engram_set_file_notes with:
   purpose, dependencies, layer, and complexity.

3. After modifying files, call engram_record_change with file path, change type, and description.

4. When making architectural decisions, call engram_record_decision with the decision,
   rationale, and affected files.

5. Before ending a conversation, call engram_end_session with a detailed summary.

6. If work is interrupted or partially complete, call engram_create_task to ensure continuity.

7. Use engram_search to find anything previously recorded.
```

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
  <strong>Copyright &copy; 2026 Keggan Standard - Tanzania</strong>
</div>
