// ============================================================================
// Engram — Universal Mode (--mode=universal | ENGRAM_MODE=universal)
//
// Registers a SINGLE "engram" tool (~80 token schema) instead of 4 dispatcher
// tools. BM25-style routing resolves any action to the correct dispatcher.
//
// Zero subprocess, zero route-table staleness — built into the main server.
// Tool catalog in start response uses engram({action:"X"}) syntax.
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerSessionDispatcher } from "../tools/sessions.js";
import { registerMemoryDispatcher } from "../tools/dispatcher-memory.js";
import { registerAdminDispatcher } from "../tools/dispatcher-admin.js";
import { registerFindTool } from "../tools/find.js";
import { MEMORY_CATALOG, ADMIN_CATALOG } from "../tools/find.js";

// ─── Handler Capturer ─────────────────────────────────────────────────────────
// Duck-typed minimal stub that captures tool handlers without exposing them.

class HandlerCapturer {
  readonly handlers = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerTool(name: string, _schema: any, handler: (params: any) => Promise<any>): void {
    this.handlers.set(name, handler);
  }
}

// ─── Action Routing Sets ──────────────────────────────────────────────────────

const SESSION_ACTIONS = new Set(["start", "end", "get_history", "handoff", "acknowledge_handoff"]);
const MEMORY_ACTIONS  = new Set(Object.keys(MEMORY_CATALOG));
const ADMIN_ACTIONS   = new Set(Object.keys(ADMIN_CATALOG));
const FIND_ACTIONS    = new Set(["search", "lint", "discover"]);

function resolveDispatcher(action: string): "session" | "memory" | "admin" | "find" | null {
  if (SESSION_ACTIONS.has(action)) return "session";
  if (MEMORY_ACTIONS.has(action))  return "memory";
  if (ADMIN_ACTIONS.has(action))   return "admin";
  if (FIND_ACTIONS.has(action))    return "find";
  return null;
}

/**
 * BM25-style fuzzy resolver for near-miss / partial action names.
 * Returns the best matching action name, or null if confidence is too low.
 */
function fuzzyResolveAction(query: string): { action: string; dispatcher: "session" | "memory" | "admin" | "find" } | null {
  const q = query.toLowerCase().replace(/[^a-z_]/g, "");
  const allActions: Array<{ action: string; dispatcher: "session" | "memory" | "admin" | "find" }> = [
    ...Array.from(SESSION_ACTIONS).map(a => ({ action: a, dispatcher: "session" as const })),
    ...Array.from(MEMORY_ACTIONS).map(a => ({ action: a, dispatcher: "memory" as const })),
    ...Array.from(ADMIN_ACTIONS).map(a => ({ action: a, dispatcher: "admin" as const })),
    ...Array.from(FIND_ACTIONS).map(a => ({ action: a, dispatcher: "find" as const })),
  ];
  let best: typeof allActions[0] | null = null;
  let bestScore = 0;
  for (const entry of allActions) {
    const a = entry.action.replace(/_/g, "");
    // Substring match
    if (a.includes(q) || q.includes(a)) {
      const score = Math.min(a.length, q.length) / Math.max(a.length, q.length);
      if (score > bestScore) { bestScore = score; best = entry; }
    }
  }
  return bestScore >= 0.5 ? best : null;
}

// ─── Response Rewriter ────────────────────────────────────────────────────────
// Rewrites tool_catalog entries so the agent sees `engram({action:"X"})` syntax
// instead of `engram_memory(action:"X")` (which doesn't exist in universal mode).

function universalizeResponse(text: string): string {
  return text
    .replace(/engram_memory\(action[=:"']+([^"')]+)["']\)/g, 'engram({action:"$1"})')
    .replace(/engram_session\(action[=:"']+([^"')]+)["']\)/g, 'engram({action:"$1"})')
    .replace(/engram_admin\(action[=:"']+([^"')]+)["']\)/g, 'engram({action:"$1"})')
    .replace(/engram_find\(action[=:"']+([^"')]+)["']\)/g, 'engram({action:"$1"})')
    .replace(/engram_find\(\{query/g, 'engram({action:"discover",query');
}

// ─── Universal Tool Registration ─────────────────────────────────────────────

export function registerUniversalMode(server: McpServer): void {
  // ── Capture dispatcher handlers without exposing them as tools ──────────
  const capturer = new HandlerCapturer();
  registerSessionDispatcher(capturer as unknown as McpServer);
  registerMemoryDispatcher(capturer as unknown as McpServer);
  registerAdminDispatcher(capturer as unknown as McpServer);
  registerFindTool(capturer as unknown as McpServer);

  const sessionHandler = capturer.handlers.get("engram_session")!;
  const memoryHandler  = capturer.handlers.get("engram_memory")!;
  const adminHandler   = capturer.handlers.get("engram_admin")!;
  const findHandler    = capturer.handlers.get("engram_find")!;

  // ── Register the single universal tool ─────────────────────────────────
  server.registerTool(
    "engram",
    {
      title: "Engram",
      description: `Persistent memory for AI agents. Pass any action + relevant params. Examples: engram({action:"start", agent_name:"claude", verbosity:"summary"}) — engram({action:"record_change", changes:[{...}]}) — engram({action:"search", query:"auth"}).`,
      inputSchema: {
        action: z.string().describe("Operation name. Examples: start, end, record_change, get_file_notes, set_file_notes, search, record_decision, create_task, backup. Use action:'discover' + query to look up any action."),
        query: z.string().optional().describe("For action:'discover' — search the action catalog."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (rawParams: Record<string, unknown>) => {
      const { action, ...rest } = rawParams;
      const actionStr = String(action ?? "");

      // ── discover action: BM25 catalog search ───────────────────────────
      if (actionStr === "discover" || actionStr === "find" || !actionStr) {
        const query = (rest.query ?? rest.content ?? "") as string;
        const allActions: Array<{ call: string; desc?: string; params?: string; dispatcher: string }> = [
          ...Array.from(SESSION_ACTIONS).map(a => ({ call: `engram({action:"${a}"})`, dispatcher: "engram_session" })),
          ...Array.from(MEMORY_ACTIONS).map(a => {
            const entry = MEMORY_CATALOG[a];
            return { call: `engram({action:"${a}"})`, desc: entry?.desc, params: entry?.params, dispatcher: "engram_memory" };
          }),
          ...Array.from(ADMIN_ACTIONS).map(a => {
            const entry = ADMIN_CATALOG[a];
            return { call: `engram({action:"${a}"})`, desc: entry?.desc, params: entry?.params, dispatcher: "engram_admin" };
          }),
        ];
        if (!query) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              note: "Universal mode — all actions via engram({action:'...',...params}).",
              session_actions: Array.from(SESSION_ACTIONS),
              memory_actions: Array.from(MEMORY_ACTIONS),
              admin_actions: Array.from(ADMIN_ACTIONS),
              tip: "Pass action:'discover' + query to search for specific actions and their param schemas.",
            }) }],
          };
        }
        const q = query.toLowerCase();
        const matches = allActions.filter(a =>
          a.call.toLowerCase().includes(q) ||
          (a.desc ?? "").toLowerCase().includes(q) ||
          (a.params ?? "").toLowerCase().includes(q)
        ).slice(0, 8);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ query, matches, message: `Found ${matches.length} actions matching "${query}".` }) }],
        };
      }

      // ── Exact action routing ────────────────────────────────────────────
      let dispatcher = resolveDispatcher(actionStr);
      let resolvedAction = actionStr;

      // ── Fuzzy routing for near-miss actions ───────────────────────────
      if (!dispatcher) {
        const fuzzy = fuzzyResolveAction(actionStr);
        if (fuzzy) {
          dispatcher = fuzzy.dispatcher;
          resolvedAction = fuzzy.action;
        }
      }

      if (!dispatcher) {
        const suggestions = [
          ...Array.from(SESSION_ACTIONS),
          ...Array.from(MEMORY_ACTIONS),
          ...Array.from(ADMIN_ACTIONS),
        ].filter(a => a.includes(actionStr.substring(0, 4)));
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({
            error: `Unknown action: "${actionStr}". Use action:"discover" with a query to find the right action.`,
            suggestions: suggestions.slice(0, 5),
          }) }],
        };
      }

      // ── Dispatch to the captured handler ──────────────────────────────
      const params = { action: resolvedAction, ...rest };
      let result: unknown;
      switch (dispatcher) {
        case "session": result = await sessionHandler(params); break;
        case "memory":  result = await memoryHandler(params);  break;
        case "admin":   result = await adminHandler(params);   break;
        case "find":    result = await findHandler(params);    break;
      }

      // ── Rewrite response for universal syntax ─────────────────────────
      const mcpResult = result as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
      if (mcpResult?.content) {
        mcpResult.content = mcpResult.content.map(c => {
          if (c.type === "text" && c.text) {
            return { ...c, text: universalizeResponse(c.text) };
          }
          return c;
        });
      }
      return mcpResult as ReturnType<Parameters<McpServer["registerTool"]>[2]>;
    }
  );
}
