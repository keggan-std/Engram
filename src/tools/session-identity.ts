// ============================================================================
// Engram MCP Server — Which session is writing this row
//
// TASK #58 / #12, and it was PROVEN before it was fixed.
//
// getCurrentSessionId() (database.ts) is
//   SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1
// and it was called bare at 16 sites in dispatcher-memory.ts. A parent session
// is always created BEFORE the sub-agents it spawns, so its id is always lower,
// so `ORDER BY id DESC` always prefers a live child. That is not a race that
// sometimes bites — the orchestrator loses 100% of the time.
//
// MEASURED on this project's own store: session #24 (fr-lead) wrote the whole
// of docs/foundations/06-observability.md and owns ZERO rows across decisions,
// observations, tasks, changes, conventions and milestones. Decision #21 was
// written by #24 and stamped to #27. Observation #79.
//
// ── THE RUNG THAT WAS MISSING ───────────────────────────────────────────────
//
// The resolution ladder in sessions.ts had three rungs — explicit session_id,
// agent_name, then newest-open — and the dispatcher could reach none of them,
// because engram_memory callers do not repeat their identity on every write.
// That is not laziness; nothing ever asked them to.
//
// But identity was available the whole time and nobody read it: EACH AGENT IS
// ITS OWN SERVER PROCESS. An MCP server is spawned per client, so the process
// that handles A's `record_decision` is the same process that handled A's
// `session start` — and a different process from B's. The session a process
// opened is therefore a fact about the caller, not a guess about the store.
//
// So rung 3 is now "the session THIS PROCESS started", and the store-wide
// newest-open scan drops to rung 4 where it belongs: a legacy fallback for a
// process that never called start, flagged ambiguous when it had to choose.
//
// REJECTED, with reasons:
//   - Scoping the existing query by agent_name. The dispatcher never receives
//     agent_name on most actions, so it would scope by a value it does not
//     have and fall through to the same broken query.
//   - Inferring from parent_session_id. A lead with three live children has
//     three candidates and would silently pick wrong — the defect again, one
//     level up.
//   - Trusting a self-reported agent_name as proof of identity. It is accepted
//     here as a HINT that selects among the caller's own open sessions, never
//     as authentication; task #38 covers server-resolved provenance and is a
//     different problem. MemGhost is explicit that an agent's self-report is
//     part of the attack surface.
//   - Accepting and documenting it. That is the status quo that produced the
//     finding.
//
// LIMIT, stated rather than discovered later: if one process multiplexes
// several agents over one server — which the stdio transport does not do, but
// the HTTP mode could — the process rung becomes wrong in the same way the
// global rung is wrong today. Callers that do that must pass session_id, and
// rung 1 is exactly for them.
// ============================================================================

import type { getRepos } from "../database.js";

export type SessionResolution =
  | { id: number; scope: "explicit" | "agent" | "process" | "global"; ambiguous: boolean }
  | { id: null; scope: "none"; ambiguous: false };

/**
 * The session this server process opened, if it opened one.
 *
 * Module state, deliberately. It is scoped to exactly the lifetime and the
 * blast radius of the process that owns the session, which is the property
 * that makes it a better answer than any query over the shared store.
 */
let processSessionId: number | null = null;
let processAgentName: string | null = null;

/** Called by `engram_session(action:"start")` the moment a session row exists. */
export function setProcessSession(id: number, agentName: string): void {
  processSessionId = id;
  processAgentName = agentName;
}

/**
 * Called by `engram_session(action:"end")`.
 *
 * Guarded on the id: ending SOMEONE ELSE'S session by passing their
 * session_id must not blank this process's own identity, or the next write
 * from this process silently falls back to the global rung — reintroducing
 * the defect from the one code path most likely to be exercised while several
 * sessions are open.
 */
export function clearProcessSession(id?: number): void {
  if (id !== undefined && id !== processSessionId) return;
  processSessionId = null;
  processAgentName = null;
}

/** The session this process started. Exported for tests and for diagnostics. */
export function getProcessSession(): { id: number; agentName: string } | null {
  return processSessionId === null ? null : { id: processSessionId, agentName: processAgentName ?? "unknown" };
}

/**
 * Decide which session an action operates on. Strict to loose.
 *
 *   1. `session_id`  — the handle returned by start. Exact, always preferred.
 *   2. `agent_name`  — that agent's own newest open session.
 *   3. this process's own session — see the header. Deterministic.
 *   4. newest open session of any agent — legacy, flagged `ambiguous` when
 *      more than one is open, so the caller learns it was a guess.
 *
 * Rung 3 verifies the row is still open before trusting it. A process holding
 * an id for a session someone else closed would otherwise attribute writes to
 * a finished session, which is a quieter wrong answer than the one being fixed.
 */
export function resolveSession(
  params: { session_id?: number; agent_name?: string },
  repos: ReturnType<typeof getRepos>
): SessionResolution {
  if (params.session_id !== undefined) {
    return { id: params.session_id, scope: "explicit", ambiguous: false };
  }

  const agentName = params.agent_name?.trim();
  if (agentName) {
    const own = repos.sessions.getOpenSessionId(agentName);
    if (own !== null) return { id: own, scope: "agent", ambiguous: false };
  }

  if (processSessionId !== null) {
    const still = repos.sessions.getById(processSessionId);
    if (still && !still.ended_at) return { id: processSessionId, scope: "process", ambiguous: false };
    // Closed underneath us, or vanished with the database. Forget it rather
    // than keep asserting it.
    clearProcessSession();
  }

  const open = repos.sessions.getOpenSessions();
  if (open.length === 0) return { id: null, scope: "none", ambiguous: false };
  return { id: open[0].id, scope: "global", ambiguous: open.length > 1 };
}

/** Advisory note attached to responses that had to guess which session was meant. */
export function ambiguityNote(resolution: SessionResolution, action: string): string | undefined {
  if (resolution.scope !== "global" || !resolution.ambiguous) return undefined;
  return `More than one session is open and no session_id or agent_name was supplied, so the newest was used. Pass session_id (returned by engram_session(action:'start')) or agent_name to make '${action}' unambiguous.`;
}
