// ============================================================================
// Engram MCP Server — Tool Telemetry
// ============================================================================
//
// Records every MCP tool invocation in tool_call_log, by intercepting
// registration rather than by editing handlers.
//
// WHY INTERCEPT REGISTRATION
// --------------------------
// dispatcher-memory has a 38-branch switch and dispatcher-admin has 37. Adding
// a logToolCall to each case would be 83 edits that rot the first time somebody
// adds an action and forgets one — precisely the failure class this project
// keeps finding. Wrapping the handler inside each dispatcher was the next idea
// and is worse: passing `async (params) => …` as an argument to a wrapper
// breaks the contextual typing the MCP SDK derives from `inputSchema`, so every
// parameter silently degrades to `{}`.
//
// Intercepting `registerTool` keeps the dispatchers completely untouched — they
// still call `server.registerTool(name, config, handler)` against the real
// signature, so Zod inference is preserved — while guaranteeing that anything
// registered is logged. A new tool or action is covered because it came through
// the same door as every other.
//
// Until 2026-08-02 logToolCall was called from five sites, all in sessions.ts,
// so 72 of the 83 actions had no telemetry at all and the "which actions are
// never called" report could not be computed. See
// docs/foundations/measurements/README.md §2.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logToolCall } from "./database.js";

/**
 * Parameters safe to record alongside the action name.
 *
 * STRICT ALLOWLIST, and it must stay one. Every key here is an enum or a short
 * bounded scalar in the schemas. Free-text parameters — `content`, `decision`,
 * `rule`, `summary`, `notes`, `query`, `value` — are deliberately absent: they
 * carry user and project data, and `value` in particular can hold the dashboard
 * bearer token. Telemetry must never become a second copy of the memory it is
 * measuring, nor a place secrets leak to.
 */
const SAFE_DETAIL_KEYS = [
  "verbosity", "intent", "agent_role", "scope", "observation_category",
  "knowledge_type", "mode", "change_type", "impact_scope", "priority",
  "status", "trigger_type", "layer", "complexity", "category",
] as const;

/** Compact `k=v` detail string built from allowlisted enum-ish params only. */
function safeDetail(params: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  for (const key of SAFE_DETAIL_KEYS) {
    const v = params[key];
    if (typeof v === "string" && v.length > 0 && v.length <= 40) parts.push(`${key}=${v}`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/** MCP tool responses carry isError on failure; success responses omit it. */
interface ToolResponse { isError?: boolean;[key: string]: unknown }

/**
 * Return a view of `server` whose `registerTool` logs every invocation as
 * `<tool>.<action>`.
 *
 * Logging never changes behaviour: responses pass through untouched and thrown
 * errors are rethrown unchanged. logToolCall swallows its own failures, so a
 * telemetry problem can never fail the operation it is measuring.
 */
export function withToolTelemetry(server: McpServer): McpServer {
  const original = server.registerTool.bind(server);

  const patched = (name: string, config: unknown, handler: (...args: unknown[]) => unknown) => {
    const wrapped = async (...args: unknown[]) => {
      const params = (args[0] ?? {}) as Record<string, unknown>;
      const rawAction = params.action;
      const action = typeof rawAction === "string" && rawAction.length > 0 && rawAction.length <= 64
        ? rawAction
        : "(none)";
      const agentName = typeof params.agent_name === "string" ? params.agent_name : undefined;

      let outcome: "success" | "error" = "success";
      try {
        const res = await handler(...args);
        if ((res as ToolResponse)?.isError === true) outcome = "error";
        return res;
      } catch (e) {
        outcome = "error";
        throw e;
      } finally {
        logToolCall(`${name}.${action}`, outcome, safeDetail(params), agentName);
      }
    };
    // The SDK's registerTool is heavily overloaded on the shape of inputSchema.
    // The dispatchers still call it with their real, inferred signatures; only
    // this forwarding hop is untyped.
    return (original as unknown as (n: string, c: unknown, h: unknown) => unknown)(name, config, wrapped);
  };

  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "registerTool") return patched;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
