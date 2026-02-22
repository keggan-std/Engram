# Engram MCP — Installation Guide

This guide covers every supported way to install the Engram MCP server into your IDE.

---

## Quick Start (Recommended)

The fastest way. Run this in any terminal and the installer will detect your IDE automatically:

```bash
npx -y engram-mcp-server --install
```

The interactive installer will:
1. Detect your current IDE from the environment
2. Ask whether to install globally or per-project (where supported)
3. Write the correct JSON config for you

**Non-interactive / CI mode:**
```bash
npx -y engram-mcp-server install --ide <ide-name> --yes
```

**See which IDEs are detected on your machine:**
```bash
npx -y engram-mcp-server install --list
```

**Remove Engram from an IDE:**
```bash
npx -y engram-mcp-server install --remove --ide <ide-name>
```

Available IDE names: `claudecode`, `claudedesktop`, `vscode`, `cursor`, `windsurf`, `antigravity`, `visualstudio`, `cline`, `trae`, `jetbrains`

---

## Manual Installation

If you prefer to configure manually, find your IDE below. All entries use `npx` so your IDE always runs the latest published version — no local build needed.

> **Windows note:** Some IDEs require a `cmd /c` wrapper because `npx` is a `.cmd` file on Windows. Each section calls this out where it applies.

---

### Claude Code (CLI)

**Config file:** `~/.claude.json` (global) or `.mcp.json` in your project root (local)

**Easiest — use the built-in CLI:**
```bash
# Windows
claude mcp add-json --scope=user engram '{"type":"stdio","command":"cmd","args":["/c","npx","-y","engram-mcp-server"]}'

# Mac / Linux
claude mcp add-json --scope=user engram '{"type":"stdio","command":"npx","args":["-y","engram-mcp-server"]}'
```

**Or edit `~/.claude.json` directly:**

```json
{
  "mcpServers": {
    "engram": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "engram-mcp-server"]
    }
  }
}
```

> On Mac/Linux replace `"command": "cmd"` / `"args": ["/c", "npx", ...]` with `"command": "npx"` / `"args": ["-y", "engram-mcp-server"]`.

**Project-local install** — create `.mcp.json` in your workspace root with the same JSON.

---

### Claude Desktop

**Config file:**
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "engram": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "engram-mcp-server"]
    }
  }
}
```

> On Mac/Linux use `"command": "npx"` and `"args": ["-y", "engram-mcp-server"]`.

Restart Claude Desktop after saving.

---

### VS Code (GitHub Copilot)

VS Code uses a `servers` key (not `mcpServers`) and requires `"type": "stdio"`.

**Global config:** `%APPDATA%\Code\User\mcp.json` (Windows) or `~/.vscode/mcp.json`

**Project-local config:** Create `.vscode/mcp.json` in your project root.

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

> VS Code handles `npx` correctly on all platforms — no `cmd /c` wrapper needed.

---

### Cursor

**Config file:** `~/.cursor/mcp.json` (preferred) or `%APPDATA%\Cursor\mcp.json`

**Project-local config:** `.cursor/mcp.json` in your project root.

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

Restart Cursor after saving.

---

### Windsurf

**Config file:** `~/.codeium/windsurf/mcp_config.json` (preferred) or `%APPDATA%\Windsurf\mcp.json`

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

Restart Windsurf after saving.

---

### Visual Studio 2022 / 2026

**Global config:** `~/.mcp.json` (applies to all solutions)

**Solution-local config:** `.vs/mcp.json` or `.mcp.json` in your solution root.

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

### Trae IDE

Trae only supports project-local configuration. Create `.trae/mcp.json` in your project root.

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

---

### JetBrains (Copilot Plugin)

**Config file:** `~/.config/github-copilot/intellij/mcp.json`

Alternatively, configure via **Settings → Tools → GitHub Copilot → MCP Servers**.

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

### Cline / Roo Code (VS Code Extension)

**Config file:** `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`
or `~/.cline/mcp_settings.json`

You can also configure via the Cline extension panel → **MCP Servers** → **Edit Config**.

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

### Antigravity IDE

**Config file:** `~/.gemini/antigravity/mcp_config.json`

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

## Config Reference

| IDE | Config Key | Requires `type: stdio` | Windows `cmd` wrapper | Scope |
|-----|-----------|:---:|:---:|-------|
| Claude Code | `mcpServers` | ✅ | ✅ | Global / Local |
| Claude Desktop | `mcpServers` | — | ✅ | Global |
| VS Code | `servers` | ✅ | — | Global / Local |
| Cursor | `mcpServers` | — | — | Global / Local |
| Windsurf | `mcpServers` | — | — | Global |
| Visual Studio | `mcpServers` | — | — | Global / Local |
| Trae IDE | `mcpServers` | ✅ | — | Local |
| JetBrains | `mcpServers` | — | — | Global |
| Cline / Roo Code | `mcpServers` | — | — | Global |
| Antigravity | `mcpServers` | — | — | Global |

---

## Verifying the Installation

After installing, ask your AI agent:

```
Call engram_start_session and tell me if Engram is connected.
```

If Engram is running correctly, the agent will respond with your session context (or a fresh start message on first use).

---

## Troubleshooting

**`npx` not found** — Make sure Node.js (v18+) is installed and on your PATH. Download from [nodejs.org](https://nodejs.org).

**Windows: `'engram' is not recognized` or install fails** — Engram uses `better-sqlite3`, a native SQLite library that requires C++ build tools. If no prebuilt binary matches your Node.js version, npm will try to compile it from source. Fix:
```bash
npm install -g windows-build-tools
```
Or install **"Desktop development with C++"** via the [Visual Studio Installer](https://visualstudio.microsoft.com/downloads/), then retry.

**Mac: native build fails** — Install Xcode Command Line Tools:
```bash
xcode-select --install
```

**Linux: native build fails** — Install build essentials:
```bash
sudo apt install build-essential python3
```

**Windows: server fails to start after install** — Ensure the config uses the `cmd /c` wrapper for IDEs that need it (Claude Code, Claude Desktop). See the Windows notes in each IDE section above.

**Config file not found** — The installer creates missing files and parent directories automatically. For manual installs, create the directory structure first.

**Changes not picked up** — Restart your IDE fully after editing any MCP config file.
