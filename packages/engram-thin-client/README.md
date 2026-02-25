# engram-thin-client

Thin client proxy for the [Engram MCP Server](https://github.com/keggan-std/Engram). Enables Anthropic's `defer_loading` beta for any agent using the Anthropic API directly.

## What It Does

The Engram MCP server exposes ~50 tools. Even with the lean 4-tool dispatcher surface, every tool schema is injected into the model context on each API call. This package acts as a proxy that:

1. Connects to the Engram MCP server via stdio
2. Lists all available tools
3. Re-exposes them with `defer_loading: true` so the Anthropic API loads schemas **on demand**, not upfront
4. Runs an agentic loop, forwarding tool calls back to the real Engram server

| | Token cost |
|---|---|
| Without thin client | ~4 tools × ~400 tokens = **~1,600 tokens** on every call |
| With thin client | **0 tokens upfront** — schemas loaded only when Claude calls a tool |

## Installation

```bash
npm install engram-thin-client
```

## Library Usage

```typescript
import { EngramThinClient } from "engram-thin-client";

const client = new EngramThinClient({
  model: "claude-opus-4-5",
  projectRoot: process.cwd(),
  verbose: true,
});

await client.connect();

const result = await client.run("Start a new session and show me what changed recently.");
console.log(result.text);
console.log(`Completed in ${result.turns} turns, ${result.toolCalls.length} tool calls.`);

await client.disconnect();
```

## CLI Usage

```bash
ANTHROPIC_API_KEY=sk-... npx engram-thin-client "Start a new session and list all open tasks"
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **Required.** Anthropic API key |
| `ANTHROPIC_MODEL` | `claude-opus-4-5` | Model to use |
| `ENGRAM_PROJECT_ROOT` | `process.cwd()` | Project root for Engram |
| `VERBOSE` | `0` | Set to `1` to log tool calls to stderr |

## Options

```typescript
new EngramThinClient({
  model: "claude-opus-4-5",        // Anthropic model
  maxTokens: 8192,                 // Max tokens per API call
  engramCommand: "engram-mcp-server", // Command to start Engram
  engramArgs: [],                  // Additional Engram args
  verbose: false,                  // Log tool calls to stderr
  projectRoot: process.cwd(),      // Project root
})
```

## Requirements

- Node.js 18+
- Engram MCP Server installed: `npm install -g engram-mcp-server`
- Anthropic API key with `defer_loading` beta access (falls back gracefully without it)
