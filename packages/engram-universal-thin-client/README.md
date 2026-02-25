# `engram-universal-client`

**Universal thin client proxy for Engram — single tool, ~80 token schema, works with every MCP-compatible agent.**

> Works with: **Cursor**, **VS Code Copilot**, **Windsurf**, **Gemini CLI**, **GPT-based IDEs**, **Claude API**, and any other MCP-compatible agent.

---

## The Problem

Every MCP client calls `tools/list` at connection time and **injects every returned tool schema into the AI model's context on every API call**. With Engram's original 50+ tools, that's ~32,500 tokens per call — wasted on overhead.

Engram v1.6 reduced this to ~1,600 tokens (4 dispatcher tools). This package reduces it further to **~80 tokens** — universally, without any provider-specific API features.

## How It Works

This proxy re-exposes the entire Engram memory system as a **single MCP tool** called `engram`. The tool schema is deliberately minimal (~80 tokens). The full action catalog is delivered once in the `start` response as `tool_catalog` — in conversation context, not injected on every API call.

```
Agent → tools/list → [ engram (1 tool, ~80 tokens) ]
Agent → engram({ action: "start" }) → { session_id, tool_catalog, agent_rules, ... }
Agent → engram({ action: "checkpoint", ... }) → { ... }
```

Internally the proxy connects to the real Engram MCP server and routes every call through a **BM25 action resolver** that handles exact matches and natural-language / near-miss action names.

## Token Savings (20-turn session)

| Approach                           | Tokens injected/call | Total (20 calls) |
| ---------------------------------- | -------------------- | ---------------- |
| Engram v1.5 (50+ tools)            | ~32,500              | **~650,000**     |
| Engram v1.6 dispatcher (4 tools)   | ~1,600               | ~32,600          |
| **Universal thin client (1 tool)** | **~80**              | **~2,200** ✅    |
| Anthropic `defer_loading`          | ~0 (deferred)        | ~600 ⚠️ API-only |

---

## Installation

```bash
npm install -g engram-universal-client
# or use directly with npx — no install needed:
npx engram-universal-client --project-root /path/to/project
```

**Requires `engram-mcp-server` to be installed** (the real Engram server this proxies):

```bash
npm install -g engram-mcp-server
```

---

## IDE Configuration

### Cursor (`~/.cursor/mcp.json`)

```json
{
    "mcpServers": {
        "engram": {
            "command": "npx",
            "args": [
                "-y",
                "engram-universal-client",
                "--project-root",
                "/absolute/path/to/project"
            ]
        }
    }
}
```

### VS Code Copilot (`.vscode/mcp.json`)

```json
{
    "servers": {
        "engram": {
            "type": "stdio",
            "command": "npx",
            "args": [
                "-y",
                "engram-universal-client",
                "--project-root",
                "${workspaceFolder}"
            ]
        }
    }
}
```

### Windsurf / Gemini CLI / any MCP agent

```json
{
    "mcpServers": {
        "engram": {
            "command": "npx",
            "args": [
                "-y",
                "engram-universal-client",
                "--project-root",
                "/path/to/project"
            ]
        }
    }
}
```

---

## Usage by Agents

### 1. Start a session (always first)

```json
engram({ "action": "start", "agent_name": "cursor", "verbosity": "summary" })
```

The response contains `tool_catalog` — the full list of available actions with parameter schemas. Read it once; it stays in conversation context.

### 2. Use any action

```json
engram({ "action": "checkpoint", "params": { "current_understanding": "...", "progress": "70%" } })
```

Or flat (params without nesting also works):

```json
engram({ "action": "record_change", "changes": [{ "file_path": "src/auth.ts", "change_type": "modified", "description": "Added JWT refresh" }] })
```

### 3. Discover actions (if unsure)

```json
engram({ "action": "discover", "query": "save progress" })
```

Returns matching catalog entries. BM25 fuzzy routing handles natural-language queries too:

```json
engram({ "action": "save a checkpoint" })  // → routes to "checkpoint" automatically
```

### 4. End the session

```json
engram({ "action": "end", "summary": "Implemented JWT refresh. Remaining: refresh token rotation." })
```

---

## CLI Options

```
engram-universal-client [options]

--project-root <path>   Project root passed to Engram. Default: cwd.
--command <cmd>         Engram server command. Default: "engram-mcp-server".
--args <json>           Extra args as JSON array, e.g. '["--flag"]'.
--verbose               Log routing decisions to stderr.
--help, -h              Show usage.
```

---

## Architecture

```
Agent  ──tools/list──▶  Universal Proxy  ──tools/list──▶  Engram MCP Server
       ◀── [{ "engram" }] ──              ◀── [4 tools] ──

Agent  ──engram({action:"start"})──▶  Proxy  ──engram_session({action:"start"})──▶  Server
       ◀── { tool_catalog, ... } ──          ◀── { session_id, tool_catalog, ... } ──

Agent  ──engram({action:"checkpoint"})──▶  BM25 Router  ─▶  engram_memory({action:"checkpoint"})
```

**BM25 routing** resolves action strings:

- `"checkpoint"` → exact match → `engram_memory(action:"checkpoint")`
- `"save progress"` → BM25 → `engram_memory(action:"checkpoint")` (score: 0.91)
- `"save a checkpoint"` → BM25 → `engram_memory(action:"checkpoint")` (score: 0.87)
- Unknown → `engram_find(action:"search", query: ...)` → returns catalog matches

---

## vs. Anthropic `defer_loading`

| Dimension             | Anthropic `defer_loading` | Universal thin client |
| --------------------- | ------------------------- | --------------------- |
| Works with Cursor     | ❌                        | ✅                    |
| Works with Copilot    | ❌                        | ✅                    |
| Works with Windsurf   | ❌                        | ✅                    |
| Works with Gemini CLI | ❌                        | ✅                    |
| Works with Claude API | ✅                        | ✅                    |
| Requires API key      | Anthropic key             | None                  |
| Schema tokens/call    | 0 (deferred)              | ~80                   |
| 20-turn session total | ~600 tokens               | ~2,200 tokens         |
| BM25 fuzzy routing    | No                        | Yes                   |

---

## License

MIT — same as Engram.
