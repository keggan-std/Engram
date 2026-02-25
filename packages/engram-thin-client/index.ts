#!/usr/bin/env node
// ============================================================================
// Engram Thin Client Proxy — Universal defer_loading for Any Agent
// ============================================================================
// Connects to the Engram MCP server via stdio, then re-exposes every tool
// with `defer_loading: true` so the Anthropic API loads schemas on-demand
// instead of injecting all of them into the context upfront.
//
// Token cost before: ~50 tools × ~650 tokens = ~32,500 tokens on every call
// Token cost  after:  0 tools loaded upfront (schemas fetched only when used)
//
// Usage (library):
//   const client = new EngramThinClient({ model: "claude-opus-4-5" });
//   await client.connect();
//   const response = await client.run("Record a change to src/auth.ts");
//   await client.disconnect();
//
// Usage (CLI):
//   ANTHROPIC_API_KEY=sk-... npx engram-thin-client "Record a change to auth.ts"
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ThinClientOptions {
  /** Anthropic model to use. Default: "claude-opus-4-5" */
  model?: string;
  /** Max tokens per API call. Default: 8192 */
  maxTokens?: number;
  /** Command to start Engram MCP server. Default: "engram-mcp-server" */
  engramCommand?: string;
  /** Additional args for engram command. Default: [] */
  engramArgs?: string[];
  /** Whether to log tool calls to stderr. Default: false */
  verbose?: boolean;
  /** Project root to pass as --project-root. Default: process.cwd() */
  projectRoot?: string;
}

export interface RunOptions {
  /** System prompt. Default: built-in Engram guidelines */
  systemPrompt?: string;
  /** Maximum agentic turns (tool call → result cycles). Default: 20 */
  maxTurns?: number;
}

export interface RunResult {
  /** Final text response from the model */
  text: string;
  /** Number of agentic turns taken */
  turns: number;
  /** All tool calls made during the run */
  toolCalls: Array<{ name: string; input: unknown; result: unknown }>;
}

// ─── Anthropic SDK types (subset) ─────────────────────────────────────────────

type MessageParam = Anthropic.MessageParam;
type ContentBlock = Anthropic.ContentBlock;
type ToolUseBlock = Anthropic.ToolUseBlock;
type ToolResultBlockParam = Anthropic.ToolResultBlockParam;

// ─── EngramThinClient ─────────────────────────────────────────────────────────

export class EngramThinClient {
  private readonly anthropic: Anthropic;
  private readonly options: Required<ThinClientOptions>;
  private mcp: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connected = false;

  constructor(options: ThinClientOptions = {}) {
    this.anthropic = new Anthropic();
    this.options = {
      model: options.model ?? "claude-opus-4-5",
      maxTokens: options.maxTokens ?? 8192,
      engramCommand: options.engramCommand ?? "engram-mcp-server",
      engramArgs: options.engramArgs ?? [],
      verbose: options.verbose ?? false,
      projectRoot: options.projectRoot ?? process.cwd(),
    };
  }

  // ─── Connection ─────────────────────────────────────────────────────────────

  /** Start the Engram MCP server and connect to it. Must be called before run(). */
  async connect(): Promise<void> {
    if (this.connected) return;

    const args = [
      ...this.options.engramArgs,
      "--project-root", this.options.projectRoot,
    ];

    this.transport = new StdioClientTransport({
      command: this.options.engramCommand,
      args,
    });

    this.mcp = new Client(
      { name: "engram-thin-client", version: "1.6.0" },
      { capabilities: {} }
    );

    await this.mcp.connect(this.transport);
    this.connected = true;

    if (this.options.verbose) {
      process.stderr.write(`[engram-thin-client] Connected to Engram MCP server.\n`);
    }
  }

  /** Disconnect from the Engram MCP server. */
  async disconnect(): Promise<void> {
    if (!this.connected || !this.mcp) return;
    await this.mcp.close();
    this.connected = false;
    if (this.options.verbose) {
      process.stderr.write(`[engram-thin-client] Disconnected.\n`);
    }
  }

  // ─── Deferred tool list ──────────────────────────────────────────────────

  /**
   * Fetch all tools from Engram and return them as Anthropic-format tool
   * definitions with `defer_loading: true`. This means the Anthropic API
   * knows the tools exist but does NOT inject their schemas into the context
   * until Claude actually tries to use one.
   */
  async getDeferredTools(): Promise<Anthropic.Messages.Tool[]> {
    if (!this.mcp) throw new Error("Not connected. Call connect() first.");
    const { tools } = await this.mcp.listTools();

    // Cast through unknown because `defer_loading` is a beta field not yet in
    // the published SDK types — but it IS sent to the API and respected.
    return tools.map(t => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: (t.inputSchema ?? { type: "object", properties: {} }) as Anthropic.Messages.Tool["input_schema"],
      // @ts-expect-error — defer_loading is a beta field not yet in SDK types
      defer_loading: true,
    }));
  }

  // ─── Agentic loop ────────────────────────────────────────────────────────

  /**
   * Run an agentic loop: send a user message, execute tool calls against
   * Engram, continue until the model stops calling tools or maxTurns is hit.
   */
  async run(userMessage: string, options: RunOptions = {}): Promise<RunResult> {
    if (!this.mcp) throw new Error("Not connected. Call connect() first.");

    const maxTurns = options.maxTurns ?? 20;
    const systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

    const deferredTools = await this.getDeferredTools();

    // The BM25 tool_search_tool lets Claude discover deferred tools on demand.
    // If the beta isn't active for this API key, we fall back to plain tools.
    const searchTool: Anthropic.Messages.Tool = {
      // @ts-expect-error — type field is a beta extension
      type: "tool_search_tool_bm25_20251119",
      name: "tool_search_tool_bm25",
      description: "Search available tools by keyword",
      input_schema: { type: "object" as const, properties: {} },
    };

    const messages: MessageParam[] = [
      { role: "user", content: userMessage },
    ];

    const toolCallLog: RunResult["toolCalls"] = [];
    let turns = 0;

    while (turns < maxTurns) {
      const response = await this.anthropic.messages.create({
        model: this.options.model,
        max_tokens: this.options.maxTokens,
        system: systemPrompt,
        tools: [searchTool, ...deferredTools],
        messages,
        // Enable the defer_loading beta
        betas: ["defer-tool-execution-2025-04-04"],
      } as Parameters<typeof this.anthropic.messages.create>[0]);

      messages.push({ role: "assistant", content: response.content });

      // Check stop condition
      if (response.stop_reason === "end_turn") break;
      if (response.stop_reason !== "tool_use") break;

      // Execute all tool calls in this turn
      const toolUseBlocks = response.content.filter(
        (b): b is ToolUseBlock => b.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) break;

      const toolResults: ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        if (this.options.verbose) {
          process.stderr.write(
            `[engram-thin-client] Tool call: ${toolUse.name}(${JSON.stringify(toolUse.input).slice(0, 120)})\n`
          );
        }

        let result: unknown;
        try {
          const mcpResult = await this.mcp!.callTool({
            name: toolUse.name,
            arguments: toolUse.input as Record<string, unknown>,
          });
          result = mcpResult;
        } catch (err) {
          result = { error: String(err) };
        }

        toolCallLog.push({ name: toolUse.name, input: toolUse.input, result });

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: "user", content: toolResults });
      turns++;
    }

    // Extract final text
    const finalText = (messages[messages.length - 2]?.content as ContentBlock[] | undefined)
      ?.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map(b => b.text)
      .join("") ?? "";

    return { text: finalText, turns, toolCalls: toolCallLog };
  }
}

// ─── Default system prompt ────────────────────────────────────────────────────

const DEFAULT_SYSTEM_PROMPT = `You are an AI coding agent with access to Engram — a persistent memory system for tracking code changes, architectural decisions, conventions, tasks, and file notes across sessions.

When starting work:
1. Start with engram_session(action:"start") to load context
2. Use engram_find(query:"...") to discover what memory operations are available
3. Record every file change with engram_memory(action:"record_change")
4. Record architectural decisions with engram_memory(action:"record_decision")
5. End with engram_session(action:"end", summary:"...") when done

Be concise. Use Engram proactively to maintain context.`;

// ─── CLI entry point ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const userMessage = process.argv.slice(2).join(" ");

  if (!userMessage) {
    console.error("Usage: engram-thin-client <message>");
    console.error("  Example: engram-thin-client \"Start a session and list open tasks\"");
    process.exit(1);
  }

  if (!process.env["ANTHROPIC_API_KEY"]) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
    process.exit(1);
  }

  const client = new EngramThinClient({
    verbose: process.env["VERBOSE"] === "1",
    projectRoot: process.env["ENGRAM_PROJECT_ROOT"] ?? process.cwd(),
    model: process.env["ANTHROPIC_MODEL"] ?? "claude-opus-4-5",
  });

  try {
    await client.connect();
    const result = await client.run(userMessage);

    console.log("\n=== Response ===");
    console.log(result.text);
    console.log(`\n[${result.turns} turn(s), ${result.toolCalls.length} tool call(s)]`);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await client.disconnect();
  }
}

// Run if executed directly
const isMain = process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts");
if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
