#!/usr/bin/env node
// ============================================================================
// Engram Universal Thin Client — Entry Point
//
// CLI:
//   engram-universal-client [options]
//
// Options:
//   --project-root <path>   Project root to pass to Engram. Default: cwd.
//   --command <cmd>         Engram server command. Default: "engram-mcp-server".
//   --args <json>           Extra args as JSON array, e.g. '["--flag"]'.
//   --verbose               Log routing decisions to stderr.
//   --help                  Show usage.
//
// Examples:
//   # Use with npx (recommended — zero install)
//   npx engram-universal-client --project-root /path/to/project
//
//   # Use with local Engram source
//   engram-universal-client --command node --args '["dist/index.js"]' --project-root /path/to/project
// ============================================================================

import { startUniversalServer } from "./src/server.js";

// ─── Re-exports (library usage) ───────────────────────────────────────────
export { startUniversalServer } from "./src/server.js";
export { resolveAction, suggestActions } from "./src/bm25.js";
export { exactRoute, ROUTE_TABLE } from "./src/router.js";
export type { RouteTarget, UpstreamTool } from "./src/router.js";

// ─── CLI parse ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
    projectRoot: string;
    command: string;
    extraArgs: string[];
    verbose: boolean;
    help: boolean;
} {
    let projectRoot = process.cwd();
    let command = "engram-mcp-server";
    let extraArgs: string[] = [];
    let verbose = false;
    let help = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            help = true;
        } else if (arg === "--verbose" || arg === "-v") {
            verbose = true;
        } else if (arg === "--project-root" && argv[i + 1]) {
            projectRoot = argv[++i];
        } else if (arg === "--command" && argv[i + 1]) {
            command = argv[++i];
        } else if (arg === "--args" && argv[i + 1]) {
            try {
                const parsed = JSON.parse(argv[++i]);
                if (Array.isArray(parsed)) extraArgs = parsed.map(String);
            } catch {
                process.stderr.write(`[engram-universal] Invalid --args JSON: ${argv[i]}\n`);
                process.exit(1);
            }
        }
    }

    return { projectRoot, command, extraArgs, verbose, help };
}

function printHelp(): void {
    process.stdout.write(`
engram-universal-client — Universal thin client proxy for Engram

Exposes Engram's entire memory system as a SINGLE MCP tool (~80 schema tokens).
Works with every MCP-compatible agent: Cursor, VS Code Copilot, Windsurf,
Gemini CLI, GPT-based IDEs, Claude API, and more.

USAGE
  npx engram-universal-client [options]

OPTIONS
  --project-root <path>   Project root passed to Engram MCP server.
                          Default: current working directory.

  --command <cmd>         Command used to start the Engram server.
                          Default: "engram-mcp-server".

  --args <json>           Extra arguments as a JSON array.
                          Example: '["--some-flag"]'

  --verbose               Log action routing decisions to stderr.

  --help, -h              Show this help message.

EXAMPLES
  # Standard usage (Engram installed globally)
  npx engram-universal-client --project-root /my/project

  # Using local Engram build
  engram-universal-client --command node --args '["dist/index.js"]'

IDE CONFIGURATION

  Cursor (~/.cursor/mcp.json):
  {
    "mcpServers": {
      "engram": {
        "command": "npx",
        "args": ["-y", "engram-universal-client", "--project-root", "/path/to/project"]
      }
    }
  }

  VS Code Copilot (.vscode/mcp.json):
  {
    "servers": {
      "engram": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "engram-universal-client", "--project-root", "\${workspaceFolder}"]
      }
    }
  }

  Windsurf / Gemini CLI / any MCP agent:
  Use the same pattern — replace the project-root with your project path.

TOKEN SAVINGS (20-turn session)
  v1.5 (50+ tools)           : ~650,000 tokens
  v1.6 dispatcher (4 tools)  : ~32,600 tokens
  Universal thin client (1)  : ~2,200 tokens   ✅  Works with ALL agents
  Anthropic defer_loading    : ~600 tokens      ⚠️  Anthropic API only

For more: https://github.com/keggan-std/Engram
`);
}

// ─── CLI entry ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const { projectRoot, command, extraArgs, verbose, help } = parseArgs(
        process.argv.slice(2),
    );

    if (help) {
        printHelp();
        process.exit(0);
    }

    const args = [...extraArgs, "--project-root", projectRoot];

    try {
        await startUniversalServer({ command, args, verbose });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[engram-universal] Fatal: ${message}\n`);
        process.exit(1);
    }
}

main();
