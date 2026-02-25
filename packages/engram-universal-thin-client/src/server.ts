// ============================================================================
// Engram Universal Thin Client — MCP Proxy Server
//
// Exposes ONE ultra-minimal tool ("engram") to any MCP-compatible agent.
// Internally proxies all calls to the real Engram MCP server (4-tool
// dispatcher) via stdio. BM25 routing maps free-text / near-miss action
// strings to the correct upstream tool + action.
//
// Schema token cost: ~80 (just the single "engram" tool).
// Upstream docs are delivered in the "start" response as tool_catalog.
//
// Works with: Cursor, VS Code Copilot, Windsurf, Gemini CLI, GPT-based IDEs,
//             Claude API, and any other MCP-compatible agent.
// ============================================================================

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { resolveAction, suggestActions } from "./bm25.js";

// ─── The single ultra-minimal tool definition ─────────────────────────────

const UNIVERSAL_TOOL = {
    name: "engram",
    title: "Engram Persistent Memory",
    description:
        'Persistent memory for AI agents across sessions. ' +
        'Start with {"action":"start"} to receive the full action catalog (tool_catalog) ' +
        'and agent rules. All Engram operations are accessed through this single tool.',
    inputSchema: {
        type: "object" as const,
        properties: {
            action: {
                type: "string",
                description:
                    'Action to perform (e.g. "start", "end", "checkpoint", "record_change", "get_decisions"). ' +
                    'Call engram({"action":"discover","query":"..."}) to search the catalog.',
            },
            params: {
                type: "object",
                description:
                    "Parameters for the action. See tool_catalog in the start response. " +
                    "Can also be passed flat (alongside action) without nesting in params.",
                additionalProperties: true,
            },
        },
        required: ["action"],
    },
} as const;

// ─── Upstream connection ──────────────────────────────────────────────────

interface ServerOptions {
    /** Command to start the Engram MCP server (e.g. "engram" or "node"). */
    command: string;
    /** Additional arguments for the Engram server command. */
    args: string[];
    /** Whether to log routing decisions to stderr. Default: false. */
    verbose?: boolean;
}

function log(msg: string): void {
    process.stderr.write(`[engram-universal] ${msg}\n`);
}

// ─── Main export ──────────────────────────────────────────────────────────

export async function startUniversalServer(options: ServerOptions): Promise<void> {
    const { command, args, verbose = false } = options;

    if (verbose) log(`Starting upstream: ${command} ${args.join(" ")}`);

    // ── Connect to the real Engram MCP server ─────────────────────────────
    const clientTransport = new StdioClientTransport({ command, args });
    const upstream = new Client(
        { name: "engram-universal-proxy", version: "1.6.0" },
        { capabilities: {} },
    );
    await upstream.connect(clientTransport);

    if (verbose) log("Connected to Engram upstream.");

    // ── Create our ultra-minimal facade server ───────────────────────────
    const server = new Server(
        { name: "engram-universal", version: "1.6.0" },
        { capabilities: { tools: {} } },
    );

    // ── tools/list — return only our single "engram" tool ────────────────
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [UNIVERSAL_TOOL],
    }));

    // ── tools/call — route to the correct upstream dispatcher ────────────
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        if (req.params.name !== "engram") {
            return {
                content: [{ type: "text", text: `Unknown tool: ${req.params.name}. Use "engram".` }],
                isError: true,
            };
        }

        const rawArgs = (req.params.arguments ?? {}) as Record<string, unknown>;
        const rawAction = typeof rawArgs["action"] === "string" ? rawArgs["action"].trim() : "";

        if (!rawAction) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        error: "Missing required field: action",
                        hint: 'Call engram({"action":"start"}) to begin a session and receive the full catalog.',
                    }),
                }],
                isError: true,
            };
        }

        // ── Build upstream params ─────────────────────────────────────────
        // Support two calling conventions:
        //   1. Nested:  { action: "checkpoint", params: { current_understanding: "..." } }
        //   2. Flat:    { action: "checkpoint", current_understanding: "...", progress: "..." }
        const nested = (rawArgs["params"] != null && typeof rawArgs["params"] === "object")
            ? (rawArgs["params"] as Record<string, unknown>)
            : {};
        const flat = { ...rawArgs };
        delete flat["action"];
        delete flat["params"];
        const upstreamParams: Record<string, unknown> = { ...flat, ...nested };

        // ── Route resolution ──────────────────────────────────────────────
        const resolved = resolveAction(rawAction);

        if (!resolved) {
            // Unknown action — help the model find the right one
            const suggestions = suggestActions(rawAction, 5);
            if (verbose) log(`Unknown action: "${rawAction}" — no BM25 match.`);

            // Fall back to engram_find search to give useful context
            try {
                const catalogResult = await upstream.callTool({
                    name: "engram_find",
                    arguments: { action: "search", query: rawAction },
                });
                return catalogResult as { content: Array<{ type: string; text: string }>; isError?: boolean };
            } catch {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            error: `Unknown action: "${rawAction}"`,
                            did_you_mean: suggestions,
                            hint: 'Call engram({"action":"discover","query":"<keyword>"}) to search the catalog.',
                        }),
                    }],
                    isError: true,
                };
            }
        }

        if (verbose) {
            log(
                `Route [${resolved.method}${resolved.score < 1.0 ? ` score=${resolved.score.toFixed(2)}` : ""}]: ` +
                `"${rawAction}" → ${resolved.route.tool}(action:"${resolved.route.action}")`,
            );
        }

        // ── Forward to upstream dispatcher ────────────────────────────────
        const upstreamArgs: Record<string, unknown> = {
            action: resolved.route.action,
            ...upstreamParams,
        };

        try {
            const result = await upstream.callTool({
                name: resolved.route.tool,
                arguments: upstreamArgs,
            });
            return result as { content: Array<{ type: string; text: string }>; isError?: boolean };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (verbose) log(`Upstream error for "${rawAction}": ${message}`);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        error: `Upstream error: ${message}`,
                        action: resolved.route.action,
                        tool: resolved.route.tool,
                    }),
                }],
                isError: true,
            };
        }
    });

    // ── Start accepting MCP connections on stdio ──────────────────────────
    const serverTransport = new StdioServerTransport();
    await server.connect(serverTransport);
    if (verbose) log("Universal thin client ready — exposing 1 tool (~80 tokens).");
}
