// ============================================================================
// Engram MCP Server — Memory Dispatcher (engram_memory)
// Lean surface: single tool routing all memory operations via action enum.
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  now, getCurrentSessionId, getRepos, getProjectRoot, getDb
} from "../database.js";
import {
  normalizePath, coerceStringArray, ftsEscape, getFileMtime, getFileHash, gitCommand, truncate,
  safeJsonParse, detectLayer, isGitRepo, getGitLogSince, getGitFilesChanged, minutesSince,
} from "../utils.js";
import { success, error } from "../response.js";
import { writeGlobalDecision, writeGlobalConvention } from "../global-db.js";
import {
  FILE_MTIME_STALE_HOURS, FILE_LOCK_DEFAULT_TIMEOUT_MINUTES,
  MAX_SEARCH_RESULTS, DEFAULT_SEARCH_LIMIT, SNAPSHOT_TTL_MINUTES,
} from "../constants.js";
import type { FileNoteRow, FileNoteConfidence, FileNoteWithStaleness, ScheduledEventRow } from "../types.js";

// ─── File Lock Helpers ─────────────────────────────────────────────────────

interface FileLockRow {
  file_path: string;
  agent_id: string;
  reason: string | null;
  locked_at: number;
  expires_at: number;
}

function getActiveLock(file_path: string): FileLockRow | null {
  try {
    const row = getDb().prepare(
      "SELECT * FROM file_locks WHERE file_path = ? AND expires_at > ?"
    ).get(file_path, Date.now()) as FileLockRow | undefined;
    return row ?? null;
  } catch { return null; }
}

function purgeExpiredLocks(): void {
  try { getDb().prepare("DELETE FROM file_locks WHERE expires_at <= ?").run(Date.now()); } catch { /* best effort */ }
}

function acquireSoftLock(file_path: string, agent_id: string, timeout_minutes: number): void {
  try {
    const now_ms = Date.now();
    getDb().prepare(
      `INSERT INTO file_locks (file_path, agent_id, reason, locked_at, expires_at)
       VALUES (?, ?, 'soft-lock: set_file_notes', ?, ?)
       ON CONFLICT(file_path) DO UPDATE SET
         agent_id = excluded.agent_id, reason = excluded.reason,
         locked_at = excluded.locked_at, expires_at = excluded.expires_at`
    ).run(file_path, agent_id, now_ms, now_ms + timeout_minutes * 60_000);
  } catch { /* best effort */ }
}

// ─── Staleness Helper ──────────────────────────────────────────────────────

function withStaleness(note: FileNoteRow, projectRoot: string): FileNoteWithStaleness {
  if (note.file_mtime == null) return { ...note, confidence: "unknown", stale: false };
  const currentMtime = getFileMtime(note.file_path, projectRoot);
  if (currentMtime == null) return { ...note, confidence: "unknown", stale: false };
  const driftMs = currentMtime - note.file_mtime;
  if (driftMs <= 0) {
    // mtime matches — verify hash if available
    if (note.content_hash) {
      const currentHash = getFileHash(note.file_path, projectRoot);
      if (currentHash && currentHash !== note.content_hash) {
        return { ...note, confidence: "stale", stale: true, staleness_hours: 0 };
      }
    }
    return { ...note, confidence: "high", stale: false };
  }
  const driftHours = driftMs / 3_600_000;
  const confidence: FileNoteConfidence = driftHours > FILE_MTIME_STALE_HOURS ? "stale" : "medium";
  return { ...note, confidence, stale: true, staleness_hours: Math.round(driftHours) };
}

// ─── Dump Classification ───────────────────────────────────────────────────

type DumpType = "decision" | "task" | "convention" | "finding";

function scoreDump(content: string): Record<DumpType, number> {
  const scores: Record<DumpType, number> = { decision: 0, task: 0, convention: 0, finding: 0 };
  if (/\b(decided?|decision|chose|choosing|going with|will use|use .+ instead|approach|ADR|design choice|architecture)\b/i.test(content)) scores.decision += 3;
  if (/\b(instead of|rather than|over|versus|vs\.?)\b/i.test(content)) scores.decision += 2;
  if (/\b(because|rationale|reason|tradeoff|trade-off|pros?|cons?)\b/i.test(content)) scores.decision += 1;
  if (/\b(TODO|todo|FIXME|fixme|need to|needs to|should|must fix|implement|create|add|remove|refactor|migrate)\b/.test(content)) scores.task += 3;
  if (/\b(next step|blocked by|blocking|pending|backlog|ticket|issue)\b/i.test(content)) scores.task += 2;
  if (/\b(will|plan to|going to|scheduled)\b/i.test(content)) scores.task += 1;
  if (/\b(always|never|every|all files?|in every|convention|rule|standard|style|naming)\b/i.test(content)) scores.convention += 3;
  if (/\b(must be|should be|is required|is mandatory|enforce)\b/i.test(content)) scores.convention += 2;
  if (/\b(pattern|template|boilerplate|consistent)\b/i.test(content)) scores.convention += 1;
  if (/\b\w+\.(ts|js|tsx|jsx|py|go|rs|java|kt|vue|svelte|json|yaml|yml)\b/.test(content)) scores.finding += 3;
  if (/\b(found|discovered|noticed|observed|turns out|note:|finding:)\b/i.test(content)) scores.finding += 2;
  if (/\b(line \d+|file |function |class |method )\b/i.test(content)) scores.finding += 1;
  return scores;
}

function pickDumpType(scores: Record<DumpType, number>, hint?: string): DumpType {
  if (hint && ["decision", "task", "convention", "finding"].includes(hint)) return hint as DumpType;
  const entries = Object.entries(scores) as Array<[DumpType, number]>;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][1] > 0 ? entries[0][0] : "finding";
}

// ─── FTS5 Helper ───────────────────────────────────────────────────────────

function hasFts(): boolean {
  try {
    const row = getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='fts_sessions'"
    ).get() as { name: string } | undefined;
    return !!row;
  } catch { return false; }
}

// ─── Context Pressure Helper ───────────────────────────────────────────────

interface ContextPressureResult {
  severity: "notice" | "warning" | "urgent";
  estimated_pct_used: number;
  source: "agent_reported";
  message: string;
  suggestions: string[];
}

function detectContextPressure(agentTokensUsed?: number, agentWindowTotal?: number): ContextPressureResult | null {
  if (agentTokensUsed === undefined) return null;
  try {
    const repos = getRepos();
    const noticePct  = repos.config.getInt("context_pressure_notice_pct",  50);
    const warningPct = repos.config.getInt("context_pressure_warning_pct", 70);
    const urgentPct  = repos.config.getInt("context_pressure_urgent_pct",  85);
    const windowSize = repos.config.getInt("context_window_size", 200_000);
    const total = agentWindowTotal ?? windowSize;
    const pct = Math.round((agentTokensUsed / total) * 100);
    if (pct < noticePct) return null;
    const severity: ContextPressureResult["severity"] = pct >= urgentPct ? "urgent" : pct >= warningPct ? "warning" : "notice";
    const messages = {
      notice:  `~${pct}% of context window used. Finish current sub-task before starting new ones.`,
      warning: `~${pct}% of context window used. Create tasks for incomplete work now.`,
      urgent:  `~${pct}% of context window used. Call engram_session(action:'end') immediately.`,
    };
    const suggestions = severity === "urgent" ? ["engram_session(action:'end')", "engram_memory(action:'create_task')"] :
      severity === "warning" ? ["engram_memory(action:'create_task')", "engram_session(action:'end')"] :
      ["finish current sub-task before starting new ones"];
    return { severity, estimated_pct_used: pct, source: "agent_reported", message: messages[severity], suggestions };
  } catch { return null; }
}

function calculateNextTrigger(recurrence: string, currentValue: string | null): string {
  const base = currentValue ? new Date(currentValue) : new Date();
  if (recurrence === "daily") base.setDate(base.getDate() + 1);
  else if (recurrence === "weekly") base.setDate(base.getDate() + 7);
  else if (recurrence === "every_session") return currentValue || new Date().toISOString();
  return base.toISOString();
}

// ─── Actions ───────────────────────────────────────────────────────────────

const MEMORY_ACTIONS = [
  "get_file_notes", "set_file_notes", "set_file_notes_batch",
  "record_change", "get_file_history", "begin_work",
  "record_decision", "record_decisions_batch", "get_decisions", "update_decision",
  "add_convention", "get_conventions", "toggle_convention",
  "create_task", "update_task", "get_tasks",
  "checkpoint", "get_checkpoint",
  "search", "what_changed", "get_dependency_map",
  "record_milestone", "get_milestones",
  "schedule_event", "get_scheduled_events", "update_scheduled_event", "acknowledge_event", "check_events",
  "dump", "claim_task", "release_task", "agent_sync", "get_agents", "broadcast", "route_task",
] as const;

// ─── Dispatcher ────────────────────────────────────────────────────────────

export function registerMemoryDispatcher(server: McpServer): void {
  server.registerTool(
    "engram_memory",
    {
      title: "Memory Operations",
      description: `All Engram memory operations. Pass action + relevant params.

Actions: get_file_notes, set_file_notes, set_file_notes_batch, record_change, get_file_history,
begin_work, record_decision, record_decisions_batch, get_decisions, update_decision,
add_convention, get_conventions, toggle_convention, create_task, update_task, get_tasks,
checkpoint, get_checkpoint, search, what_changed, get_dependency_map, record_milestone,
get_milestones, schedule_event, get_scheduled_events, update_scheduled_event, acknowledge_event,
check_events, dump, claim_task, release_task, agent_sync, get_agents, broadcast, route_task.

Use engram_find(query: "...") to look up exact param schemas.`,
      inputSchema: {
        action: z.enum(MEMORY_ACTIONS).describe("Memory operation to perform."),
        // File notes
        file_path: z.string().optional(),
        layer: z.string().optional(),
        complexity: z.string().optional(),
        purpose: z.string().optional(),
        dependencies: coerceStringArray().optional(),
        dependents: coerceStringArray().optional(),
        notes: z.string().optional(),
        executive_summary: z.string().optional().describe("2-3 sentence micro summary for fast Tier-1 reads (set_file_notes)."),
        files: z.array(z.object({
          file_path: z.string(),
          purpose: z.string().optional(),
          layer: z.string().optional(),
          complexity: z.string().optional(),
          notes: z.string().optional(),
          executive_summary: z.string().optional(),
          dependencies: coerceStringArray().optional(),
          dependents: coerceStringArray().optional(),
        }).passthrough()).optional(),
        task_focus: z.string().optional(),
        // Changes
        changes: z.array(z.object({
          file_path: z.string(),
          change_type: z.enum(["created","modified","deleted","refactored","renamed","moved","config_changed"]),
          description: z.string(),
          diff_summary: z.string().optional(),
          impact_scope: z.enum(["local","module","cross_module","global"]).optional(),
        }).passthrough()).optional(),
        description: z.string().optional(),
        agent_id: z.string().optional(),
        // Decisions
        decision: z.string().optional(),
        rationale: z.string().optional(),
        affected_files: coerceStringArray().optional(),
        tags: coerceStringArray().optional(),
        status: z.string().optional(),
        supersedes: z.number().int().optional(),
        depends_on: z.array(z.number().int()).optional(),
        export_global: z.boolean().optional(),
        decisions: z.array(z.object({
          decision: z.string(),
          rationale: z.string().optional(),
          tags: z.array(z.string()).optional(),
          affected_files: z.array(z.string()).optional(),
        }).passthrough()).optional(),
        // Filters
        tag: z.string().optional(),
        file_path_filter: z.string().optional(),
        limit: z.number().int().optional(),
        id: z.number().int().optional(),
        // Conventions
        category: z.string().optional(),
        rule: z.string().optional(),
        examples: coerceStringArray().optional(),
        include_disabled: z.boolean().optional(),
        enforced: z.boolean().optional(),
        // Tasks
        title: z.string().optional(),
        priority: z.enum(["critical","high","medium","low"]).optional(),
        assigned_files: coerceStringArray().optional(),
        blocked_by: z.array(z.number().int()).optional(),
        include_done: z.boolean().optional(),
        add_blocks: z.array(z.number().int()).optional(),
        add_blocked_by: z.array(z.number().int()).optional(),
        owner: z.string().optional(),
        // Checkpoint
        current_understanding: z.string().optional(),
        progress: z.string().optional(),
        relevant_files: z.array(z.string()).optional(),
        // Intelligence
        query: z.string().optional(),
        scope: z.string().optional(),
        context_chars: z.number().int().optional(),
        since: z.string().optional(),
        include_git: z.boolean().optional(),
        depth: z.number().int().optional(),
        // Milestones
        version: z.string().optional(),
        // Scheduler
        trigger_type: z.string().optional(),
        trigger_value: z.string().optional(),
        action_summary: z.string().optional(),
        action_data: z.string().optional(),
        requires_approval: z.boolean().optional(),
        recurrence: z.string().optional(),
        approved: z.boolean().optional(),
        note: z.string().optional(),
        context_tokens_used: z.number().int().optional(),
        context_window_total: z.number().int().optional(),
        // Coordination
        content: z.string().optional(),
        hint: z.string().optional(),
        task_id: z.number().int().optional(),
        force: z.boolean().optional(),
        agent_name: z.string().optional(),
        current_task_id: z.number().int().optional(),
        from_agent: z.string().optional(),
        message: z.string().optional(),
        target_agent: z.string().optional(),
        expires_in_minutes: z.number().int().optional(),
        timeout_minutes: z.number().int().optional(),
        specializations: z.array(z.string()).optional(),
        session_id: z.number().int().optional(),
        include_tool_log: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      const { action } = params;
      const repos = getRepos();
      const db = getDb();
      const projectRoot = getProjectRoot();

      switch (action) {

        // ── FILE NOTES ────────────────────────────────────────────────────────

        case "get_file_notes": {
          const currentBranch = gitCommand(projectRoot, "rev-parse --abbrev-ref HEAD").trim() || null;
          if (params.file_path) {
            const fp = normalizePath(params.file_path);
            const note = repos.fileNotes.getByPath(fp);
            if (!note) {
              const lock = getActiveLock(fp);
              return success({
                message: "No notes found for this file.",
                lock_status: lock ? { locked: true, agent_id: lock.agent_id, reason: lock.reason, locked_ago_minutes: Math.round((Date.now() - lock.locked_at) / 60_000), expires_in_minutes: Math.round((lock.expires_at - Date.now()) / 60_000) } : { locked: false },
              });
            }
            const enriched = withStaleness(note, projectRoot);
            const lock = getActiveLock(fp);
            const noteRaw = note as unknown as Record<string, unknown>;
            const branch_warning = noteRaw["git_branch"] && currentBranch && noteRaw["git_branch"] !== currentBranch
              ? `Note was written on branch "${noteRaw["git_branch"]}". Current branch is "${currentBranch}". File content may differ.`
              : undefined;
            return success({
              ...(enriched as unknown as Record<string, unknown>),
              branch_warning,
              lock_status: lock ? { locked: true, agent_id: lock.agent_id, reason: lock.reason, locked_ago_minutes: Math.round((Date.now() - lock.locked_at) / 60_000), expires_in_minutes: Math.round((lock.expires_at - Date.now()) / 60_000) } : { locked: false },
            });
          }
          const notesList = repos.fileNotes.getFiltered({
            layer: params.layer as Parameters<typeof repos.fileNotes.getFiltered>[0]["layer"],
            complexity: params.complexity as Parameters<typeof repos.fileNotes.getFiltered>[0]["complexity"],
          });
          const enrichedList = notesList.map(n => withStaleness(n, projectRoot));
          return success({ count: enrichedList.length, stale_count: enrichedList.filter(n => n.stale).length, files: enrichedList });
        }

        case "set_file_notes": {
          if (!params.file_path) return error("file_path required for set_file_notes.");
          const timestamp = now();
          const sessionId = getCurrentSessionId();
          const fp = normalizePath(params.file_path);
          purgeExpiredLocks();
          const file_mtime = getFileMtime(fp, projectRoot);
          const content_hash = getFileHash(fp, projectRoot);
          const git_branch = gitCommand(projectRoot, "rev-parse --abbrev-ref HEAD").trim() || null;
          repos.fileNotes.upsert(fp, timestamp, sessionId, {
            purpose: params.purpose,
            dependencies: params.dependencies,
            dependents: params.dependents,
            layer: params.layer as Parameters<typeof repos.fileNotes.upsert>[3]["layer"],
            complexity: params.complexity as Parameters<typeof repos.fileNotes.upsert>[3]["complexity"],
            notes: params.notes,
            file_mtime,
            git_branch,
            content_hash,
            executive_summary: params.executive_summary as string | null | undefined,
          });
          acquireSoftLock(fp, `session-${sessionId ?? "unknown"}`, FILE_LOCK_DEFAULT_TIMEOUT_MINUTES);
          const missingExecSummary = !params.executive_summary;
          return success({
            message: `File notes saved for ${fp}.`,
            file_mtime_captured: file_mtime !== null,
            git_branch_captured: git_branch,
            content_hash_captured: content_hash !== null,
            ...(missingExecSummary ? { hint: "Tip: Include executive_summary (2-3 sentences) for instant context in future sessions without re-reading the file." } : {}),
          });
        }

        case "set_file_notes_batch": {
          if (!params.files || !Array.isArray(params.files)) return error("files array required for set_file_notes_batch.");
          const timestamp = now();
          const sessionId = getCurrentSessionId();
          const git_branch = gitCommand(projectRoot, "rev-parse --abbrev-ref HEAD").trim() || null;
          const enrichedFiles = (params.files as Array<Record<string, unknown>>).map(f => ({
            ...f,
            file_mtime: getFileMtime(normalizePath(String(f["file_path"] ?? "")), projectRoot),
            content_hash: getFileHash(normalizePath(String(f["file_path"] ?? "")), projectRoot),
            executive_summary: f["executive_summary"] as string | null | undefined,
            git_branch,
          }));
          const count = repos.fileNotes.upsertBatch(
            enrichedFiles as Parameters<typeof repos.fileNotes.upsertBatch>[0],
            timestamp, sessionId
          );
          return success({ message: `Batch saved ${count} file note(s).`, count });
        }

        // ── CHANGES ───────────────────────────────────────────────────────────

        case "record_change": {
          if (!params.changes || !Array.isArray(params.changes)) return error("changes array required.");
          const timestamp = now();
          const sessionId = getCurrentSessionId();
          const normalized = (params.changes as Array<Record<string, unknown>>).map(c => ({
            ...c,
            file_path: normalizePath(String(c["file_path"] ?? "")),
          }));
          repos.changes.recordBulk(normalized as Parameters<typeof repos.changes.recordBulk>[0], sessionId, timestamp);
          // Auto-close pending_work
          const changedPaths = normalized.map(c => c["file_path"]);
          try {
            const pending = db.prepare("SELECT id, files FROM pending_work WHERE status = 'pending'").all() as { id: number; files: string }[];
            for (const pw of pending) {
              const pwFiles: string[] = JSON.parse(pw.files);
              if (pwFiles.some(f => changedPaths.includes(normalizePath(f)))) {
                db.prepare("UPDATE pending_work SET status = 'completed' WHERE id = ?").run(pw.id);
              }
            }
          } catch { /* best effort */ }
          return success({ message: `Recorded ${params.changes.length} change(s) in session #${sessionId ?? "none"}.`, count: params.changes.length });
        }

        case "get_file_history": {
          if (!params.file_path) return error("file_path required for get_file_history.");
          const fp = normalizePath(params.file_path);
          const notes = repos.fileNotes.getByPath(fp);
          const changes = repos.changes.getByFile(fp, params.limit ?? 20);
          const decisions = repos.decisions.getByFile(fp);
          return success({ file_path: fp, notes: notes || null, change_count: changes.length, changes, related_decisions: decisions });
        }

        case "begin_work": {
          if (!params.description) return error("description required for begin_work.");
          if (!params.files || !Array.isArray(params.files)) return error("files array required for begin_work.");
          const sessionId = getCurrentSessionId();
          const normalizedFiles = (params.files as unknown as string[]).map(f => normalizePath(String(f)));
          try {
            const result = db.prepare(
              `INSERT INTO pending_work (agent_id, session_id, description, files, started_at, status) VALUES (?, ?, ?, ?, ?, 'pending')`
            ).run(params.agent_id ?? "unknown", sessionId ?? null, params.description, JSON.stringify(normalizedFiles), Date.now());
            return success({ work_id: result.lastInsertRowid, message: `Pending work #${result.lastInsertRowid} recorded.`, files: normalizedFiles });
          } catch (e) { return success({ message: `Failed to record pending work: ${e}` }); }
        }

        // ── DECISIONS ─────────────────────────────────────────────────────────

        case "record_decision": {
          if (!params.decision) return error("decision string required.");
          const timestamp = now();
          const sessionId = getCurrentSessionId();
          const newId = repos.decisions.create(
            sessionId, timestamp,
            params.decision, params.rationale,
            params.affected_files, params.tags,
            (params.status as "active" | "experimental") ?? "active",
            params.supersedes, params.depends_on,
          );
          let reviewRequired: Array<{ id: number; decision: string }> = [];
          if (params.supersedes) {
            repos.decisions.supersede(params.supersedes, newId);
            reviewRequired = repos.decisions.getDependents(params.supersedes).map(d => ({ id: d.id, decision: d.decision }));
          }
          let globalId: number | null = null;
          if (params.export_global) {
            globalId = writeGlobalDecision({ projectRoot: getProjectRoot(), decision: params.decision, rationale: params.rationale, tags: params.tags, timestamp });
          }
          const resp: Record<string, unknown> = {
            decision_id: newId,
            message: `Decision #${newId} recorded${params.supersedes ? ` (supersedes #${params.supersedes})` : ""}${globalId != null ? " and exported to global KB." : "."}${reviewRequired.length > 0 ? ` ⚠️ ${reviewRequired.length} dependent decision(s) may need review.` : ""}`,
            decision: params.decision, exported_globally: globalId != null,
            review_required: reviewRequired.length > 0 ? reviewRequired : undefined,
          };
          const similar = repos.decisions.findSimilar(params.decision, 5).filter(d => d.id !== newId);
          if (similar.length > 0) {
            resp.warning = `Found ${similar.length} similar active decision(s). Review for potential conflicts.`;
            resp.similar_decisions = similar.map(d => ({ id: d.id, decision: d.decision, status: d.status, timestamp: d.timestamp }));
          }
          return success(resp);
        }

        case "record_decisions_batch": {
          if (!params.decisions || !Array.isArray(params.decisions)) return error("decisions array required.");
          const timestamp = now();
          const sessionId = getCurrentSessionId();
          const ids = repos.decisions.createBatch(
            params.decisions as Parameters<typeof repos.decisions.createBatch>[0],
            sessionId, timestamp
          );
          return success({ message: `Recorded ${ids.length} decision(s).`, decision_ids: ids });
        }

        case "get_decisions": {
          const decisions = repos.decisions.getFiltered({
            status: params.status as Parameters<typeof repos.decisions.getFiltered>[0]["status"],
            tag: params.tag,
            file_path: params.file_path_filter ?? params.file_path,
            limit: params.limit ?? 20,
          });
          return success({ count: decisions.length, decisions });
        }

        case "update_decision": {
          if (!params.id) return error("id required for update_decision.");
          const changes = repos.decisions.updateStatus(
            params.id,
            params.status as Parameters<typeof repos.decisions.updateStatus>[1]
          );
          if (changes === 0) return error(`Decision #${params.id} not found.`);
          // Cascade warning: if deprecating/superseding, check dependents
          let cascadeWarning: Array<{ id: number; decision: string }> | undefined;
          if (params.status === "deprecated" || params.status === "superseded") {
            const dependents = repos.decisions.getDependents(params.id).map(d => ({ id: d.id, decision: d.decision }));
            if (dependents.length > 0) cascadeWarning = dependents;
          }
          return success({
            message: `Decision #${params.id} status updated to "${params.status}".${cascadeWarning ? ` ⚠️ ${cascadeWarning.length} dependent decision(s) may be affected.` : ""}`,
            cascade_warning: cascadeWarning,
          });
        }

        // ── CONVENTIONS ───────────────────────────────────────────────────────

        case "add_convention": {
          if (!params.category || !params.rule) return error("category and rule required for add_convention.");
          const timestamp = now();
          const sessionId = getCurrentSessionId();
          const result = db.prepare(
            "INSERT INTO conventions (session_id, timestamp, category, rule, examples) VALUES (?, ?, ?, ?, ?)"
          ).run(sessionId, timestamp, params.category, params.rule, params.examples ? JSON.stringify(params.examples) : null);
          const conventionId = Number(result.lastInsertRowid);
          let globalId: number | null = null;
          if (params.export_global) {
            globalId = writeGlobalConvention(getProjectRoot(), params.category, params.rule, timestamp);
          }
          return success({ convention_id: conventionId, message: `Convention #${conventionId} added${globalId != null ? " and exported to global KB." : "."}`, rule: params.rule, exported_globally: globalId != null });
        }

        case "get_conventions": {
          let convQuery = "SELECT * FROM conventions WHERE 1=1";
          const convParams: unknown[] = [];
          if (!params.include_disabled) { convQuery += " AND enforced = 1"; }
          if (params.category) { convQuery += " AND category = ?"; convParams.push(params.category); }
          convQuery += " ORDER BY category, id";
          const conventions = db.prepare(convQuery).all(...convParams) as Array<Record<string, unknown>>;
          const grouped: Record<string, unknown[]> = {};
          for (const c of conventions) {
            const cat = String(c["category"]);
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(c);
          }
          return success({ total: conventions.length, by_category: grouped });
        }

        case "toggle_convention": {
          if (params.id === undefined) return error("id required for toggle_convention.");
          if (params.enforced === undefined) return error("enforced boolean required for toggle_convention.");
          const result = db.prepare("UPDATE conventions SET enforced = ? WHERE id = ?").run(params.enforced ? 1 : 0, params.id);
          if (result.changes === 0) return error(`Convention #${params.id} not found.`);
          return success({ message: `Convention #${params.id} ${params.enforced ? "enabled" : "disabled"}.` });
        }

        // ── TASKS ─────────────────────────────────────────────────────────────

        case "create_task": {
          if (!params.title) return error("title required for create_task.");
          const timestamp = now();
          const sessionId = getCurrentSessionId();
          const result = db.prepare(
            `INSERT INTO tasks (session_id, created_at, updated_at, title, description, status, priority, assigned_files, tags, blocked_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            sessionId, timestamp, timestamp, params.title,
            params.description || null,
            params.status ?? "backlog",
            params.priority ?? "medium",
            params.assigned_files ? JSON.stringify(params.assigned_files) : null,
            params.tags ? JSON.stringify(params.tags) : null,
            params.blocked_by ? JSON.stringify(params.blocked_by) : null,
          );
          return success({ task_id: Number(result.lastInsertRowid), message: `Task #${result.lastInsertRowid} created: "${params.title}" [${params.priority ?? "medium"}/${params.status ?? "backlog"}]` });
        }

        case "update_task": {
          if (!params.id) return error("id required for update_task.");
          const timestamp = now();
          const updates: string[] = ["updated_at = ?"];
          const taskParams: unknown[] = [timestamp];
          if (params.status !== undefined) {
            updates.push("status = ?"); taskParams.push(params.status);
            if (params.status === "done" || params.status === "cancelled") {
              updates.push("completed_at = ?"); taskParams.push(timestamp);
            }
          }
          if (params.priority !== undefined) { updates.push("priority = ?"); taskParams.push(params.priority); }
          if (params.description !== undefined) { updates.push("description = ?"); taskParams.push(params.description); }
          if (params.owner !== undefined) { updates.push("claimed_by = ?"); taskParams.push(params.owner); }
          if (params.blocked_by !== undefined) { updates.push("blocked_by = ?"); taskParams.push(JSON.stringify(params.blocked_by)); }
          if (params.assigned_files !== undefined) { updates.push("assigned_files = ?"); taskParams.push(JSON.stringify(params.assigned_files)); }
          if (params.tags !== undefined) { updates.push("tags = ?"); taskParams.push(JSON.stringify(params.tags)); }
          if (params.add_blocked_by && params.add_blocked_by.length > 0) {
            const existing = db.prepare("SELECT blocked_by FROM tasks WHERE id = ?").get(params.id) as { blocked_by: string | null } | undefined;
            if (existing) {
              const arr: number[] = safeJsonParse<number[]>(existing.blocked_by, []);
              for (const dep of params.add_blocked_by) { if (!arr.includes(dep)) arr.push(dep); }
              updates.push("blocked_by = ?"); taskParams.push(JSON.stringify(arr));
            }
          }
          taskParams.push(params.id);
          const result = db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(...taskParams);
          if (result.changes === 0) return error(`Task #${params.id} not found.`);
          if (params.add_blocks && params.add_blocks.length > 0) {
            for (const blockId of params.add_blocks) {
              try {
                const existing = db.prepare("SELECT blocked_by FROM tasks WHERE id = ?").get(blockId) as { blocked_by: string | null } | undefined;
                if (existing) {
                  const arr: number[] = safeJsonParse<number[]>(existing.blocked_by, []);
                  if (!arr.includes(params.id!)) arr.push(params.id!);
                  db.prepare("UPDATE tasks SET blocked_by = ? WHERE id = ?").run(JSON.stringify(arr), blockId);
                }
              } catch { /* best effort */ }
            }
          }
          let triggeredEventCount = 0;
          if (params.status === "done") {
            try {
              const triggerResult = db.prepare(
                `UPDATE scheduled_events SET status = 'triggered', triggered_at = ? WHERE status = 'pending' AND trigger_type = 'task_complete' AND trigger_value = ?`
              ).run(timestamp, String(params.id));
              triggeredEventCount = triggerResult.changes;
            } catch { /* best effort */ }
          }
          const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(params.id) as Record<string, unknown>;
          if (triggeredEventCount > 0) updated["_triggered_events"] = `${triggeredEventCount} scheduled event(s) triggered by this task completion.`;
          return success(updated);
        }

        case "get_tasks": {
          let taskQuery = "SELECT * FROM tasks WHERE 1=1";
          const taskParams: unknown[] = [];
          const statusAll = params.status === "all";
          if (!statusAll && !params.include_done) { taskQuery += " AND status NOT IN ('done', 'cancelled')"; }
          if (params.status && !statusAll) { taskQuery += " AND status = ?"; taskParams.push(params.status); }
          if (params.priority) { taskQuery += " AND priority = ?"; taskParams.push(params.priority); }
          if (params.tag) { taskQuery += " AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)"; taskParams.push(params.tag); }
          taskQuery += ` ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, created_at ASC LIMIT ?`;
          taskParams.push(params.limit ?? 20);
          const tasks = db.prepare(taskQuery).all(...taskParams);
          const openCount = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status NOT IN ('done','cancelled')").get() as { c: number }).c;
          return success({ total_open: openCount, returned: tasks.length, tasks });
        }

        // ── CHECKPOINT ────────────────────────────────────────────────────────

        case "checkpoint": {
          if (!params.current_understanding || !params.progress) return error("current_understanding and progress required for checkpoint.");
          const sessionId = getCurrentSessionId();
          db.prepare(
            `INSERT INTO checkpoints (session_id, agent_name, created_at, current_understanding, progress, relevant_files) VALUES (?, ?, ?, ?, ?, ?)`
          ).run(
            sessionId,
            params.agent_name ?? null,
            Date.now(),
            params.current_understanding,
            params.progress,
            params.relevant_files ? JSON.stringify(params.relevant_files) : null
          );
          return success({ message: `Checkpoint saved for session #${sessionId}.`, session_id: sessionId });
        }

        case "get_checkpoint": {
          const sessionId = getCurrentSessionId();
          const cp = db.prepare("SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC LIMIT 1").get(sessionId) as Record<string, unknown> | undefined;
          if (!cp) return success({ message: "No checkpoint found for current session.", session_id: sessionId });
          const files = cp.relevant_files ? (JSON.parse(cp.relevant_files as string) as unknown) : null;
          return success({ ...cp, relevant_files: files, message: `Checkpoint restored for session #${sessionId}.` });
        }

        // ── INTELLIGENCE ──────────────────────────────────────────────────────

        case "search": {
          if (!params.query) return error("query required for search.");
          const scope = params.scope ?? "all";
          const limit = params.limit ?? DEFAULT_SEARCH_LIMIT;
          const context_chars = params.context_chars ?? 0;
          const useFts = hasFts();
          const oversample = Math.min(limit * 2, MAX_SEARCH_RESULTS);
          const pool: Array<{ table: string; rank: number; data: unknown }> = [];

          if (useFts) {
            const ftsQuery = ftsEscape(params.query);
            const ftsScopes: Array<[string, string, string, string]> = [
              ["sessions",     "fts_sessions",     "s", "JOIN sessions s ON s.id = f.rowid"],
              ["changes",      "fts_changes",      "c", "JOIN changes c ON c.id = f.rowid"],
              ["decisions",    "fts_decisions",    "d", "JOIN decisions d ON d.id = f.rowid"],
              ["conventions",  "fts_conventions",  "c", "JOIN conventions c ON c.id = f.rowid"],
              ["tasks",        "fts_tasks",        "t", "JOIN tasks t ON t.id = f.rowid"],
            ];
            for (const [name, fts, alias, join] of ftsScopes) {
              if (scope !== "all" && scope !== name) continue;
              try {
                const rows = db.prepare(`SELECT ${alias}.*, rank FROM ${fts} f ${join} WHERE ${fts} MATCH ? ORDER BY rank LIMIT ?`).all(ftsQuery, oversample) as Array<Record<string, unknown>>;
                for (const r of rows) pool.push({ table: name, rank: r["rank"] as number, data: r });
              } catch { /* skip */ }
            }
            if (scope === "all" || scope === "file_notes") {
              try {
                const rows = db.prepare(`SELECT fn.*, f.rank FROM fts_file_notes f JOIN file_notes fn ON fn.file_path = f.file_path WHERE fts_file_notes MATCH ? ORDER BY f.rank LIMIT ?`).all(ftsQuery, oversample) as Array<Record<string, unknown>>;
                for (const r of rows) pool.push({ table: "file_notes", rank: r["rank"] as number, data: r });
              } catch { /* skip */ }
            }
          } else {
            const term = `%${params.query}%`;
            if (scope === "all" || scope === "sessions") {
              db.prepare("SELECT * FROM sessions WHERE summary LIKE ? OR tags LIKE ? ORDER BY id DESC LIMIT ?").all(term, term, oversample).forEach(r => pool.push({ table: "sessions", rank: 0, data: r }));
            }
            if (scope === "all" || scope === "changes") {
              db.prepare("SELECT * FROM changes WHERE description LIKE ? OR file_path LIKE ? OR diff_summary LIKE ? ORDER BY timestamp DESC LIMIT ?").all(term, term, term, oversample).forEach(r => pool.push({ table: "changes", rank: 0, data: r }));
            }
            if (scope === "all" || scope === "decisions") {
              db.prepare("SELECT * FROM decisions WHERE decision LIKE ? OR rationale LIKE ? OR tags LIKE ? ORDER BY timestamp DESC LIMIT ?").all(term, term, term, oversample).forEach(r => pool.push({ table: "decisions", rank: 0, data: r }));
            }
            if (scope === "all" || scope === "file_notes") {
              db.prepare("SELECT * FROM file_notes WHERE file_path LIKE ? OR purpose LIKE ? OR notes LIKE ? LIMIT ?").all(term, term, term, oversample).forEach(r => pool.push({ table: "file_notes", rank: 0, data: r }));
            }
            if (scope === "all" || scope === "conventions") {
              db.prepare("SELECT * FROM conventions WHERE rule LIKE ? OR examples LIKE ? LIMIT ?").all(term, term, oversample).forEach(r => pool.push({ table: "conventions", rank: 0, data: r }));
            }
            if (scope === "all" || scope === "tasks") {
              db.prepare("SELECT * FROM tasks WHERE title LIKE ? OR description LIKE ? OR tags LIKE ? ORDER BY updated_at DESC LIMIT ?").all(term, term, term, oversample).forEach(r => pool.push({ table: "tasks", rank: 0, data: r }));
            }
          }

          pool.sort((a, b) => a.rank - b.rank);
          const top = pool.slice(0, limit);
          const results: Record<string, unknown[]> = {};
          for (const item of top) {
            if (!results[item.table]) results[item.table] = [];
            results[item.table].push(item.data);
          }

          // Staleness enrichment for file_notes
          if (results["file_notes"]) {
            results["file_notes"] = results["file_notes"].map(item => {
              const d = item as Record<string, unknown>;
              const storedMtime = d["file_mtime"] as number | null | undefined;
              if (storedMtime == null) return { ...d, confidence: "unknown" };
              const currentMtime = getFileMtime(String(d["file_path"] ?? ""), projectRoot);
              if (currentMtime == null) return { ...d, confidence: "unknown" };
              const driftMs = currentMtime - storedMtime;
              if (driftMs <= 0) return { ...d, confidence: "high" };
              const driftHours = driftMs / 3_600_000;
              return { ...d, confidence: driftHours > FILE_MTIME_STALE_HOURS ? "stale" : "medium", staleness_hours: Math.round(driftHours) };
            });
          }

          // Context snippet enrichment
          if (context_chars > 0) {
            for (const [table, items] of Object.entries(results)) {
              results[table] = items.map(item => {
                const d = item as Record<string, unknown>;
                let ctx = "";
                if (table === "decisions") ctx = truncate(String(d["decision"] ?? "") + " " + String(d["rationale"] ?? ""), context_chars * 2).slice(0, context_chars);
                else if (table === "sessions") ctx = truncate(String(d["summary"] ?? ""), context_chars);
                else if (table === "tasks") ctx = truncate(String(d["title"] ?? "") + " " + String(d["description"] ?? ""), context_chars * 2).slice(0, context_chars);
                else if (table === "file_notes") ctx = truncate(String(d["purpose"] ?? "") + " " + String(d["notes"] ?? ""), context_chars * 2).slice(0, context_chars);
                else if (table === "changes") ctx = truncate(String(d["description"] ?? "") + " " + String(d["diff_summary"] ?? ""), context_chars * 2).slice(0, context_chars);
                return ctx ? { ...d, context: ctx } : d;
              });
            }
          }

          return success({ query: params.query, scope, search_engine: useFts ? "fts5" : "like", total_results: top.length, results });
        }

        case "what_changed": {
          let sinceTimestamp: string;
          if (!params.since) {
            const last = db.prepare("SELECT ended_at FROM sessions WHERE ended_at IS NOT NULL ORDER BY id DESC LIMIT 1").get() as { ended_at: string } | undefined;
            sinceTimestamp = last?.ended_at || new Date(Date.now() - 86400000).toISOString();
          } else if (params.since === "session_start") {
            // Resolve to the current session's started_at — prevents alphabetic-comparison bug
            const sessionId = getCurrentSessionId();
            const session = sessionId ? db.prepare("SELECT started_at FROM sessions WHERE id = ? LIMIT 1").get(sessionId) as { started_at: string } | undefined : undefined;
            sinceTimestamp = session?.started_at || new Date(Date.now() - 3600000).toISOString();
          } else if (/^\d+[hdm]$/.test(params.since)) {
            const m = params.since.match(/^(\d+)([hdm])$/)!;
            const ms = m[2] === "h" ? +m[1] * 3600000 : m[2] === "d" ? +m[1] * 86400000 : +m[1] * 60000;
            sinceTimestamp = new Date(Date.now() - ms).toISOString();
          } else {
            sinceTimestamp = params.since;
          }
          const agentChanges = db.prepare("SELECT * FROM changes WHERE timestamp > ? ORDER BY timestamp DESC").all(sinceTimestamp);
          const newDecisions = db.prepare("SELECT * FROM decisions WHERE timestamp > ? ORDER BY timestamp DESC").all(sinceTimestamp);
          const includeGit = params.include_git !== false;
          let gitLog = "";
          let gitFilesChanged: string[] = [];
          if (includeGit && isGitRepo(projectRoot)) {
            gitLog = getGitLogSince(projectRoot, sinceTimestamp);
            gitFilesChanged = getGitFilesChanged(projectRoot, sinceTimestamp);
          }
          const recordedFiles = new Set((agentChanges as Array<Record<string, unknown>>).map(c => c["file_path"]));
          const unrecordedGitChanges = gitFilesChanged.filter(f => !recordedFiles.has(f));
          return success({
            since: sinceTimestamp,
            agent_recorded: { count: agentChanges.length, changes: agentChanges },
            new_decisions: newDecisions,
            git: includeGit ? { log: gitLog, files_changed: gitFilesChanged.length, unrecorded_changes: unrecordedGitChanges } : null,
            summary: `${agentChanges.length} recorded changes, ${newDecisions.length} new decisions, ${gitFilesChanged.length} git file changes (${unrecordedGitChanges.length} unrecorded) since ${sinceTimestamp}.`,
          });
        }

        case "get_dependency_map": {
          if (!params.file_path) return error("file_path required for get_dependency_map.");
          const fp = normalizePath(params.file_path);
          const depthLimit = params.depth ?? 1;
          function getDeps(filePath: string, dir: "up" | "down", currentDepth: number): Record<string, unknown> {
            if (currentDepth > depthLimit) return {};
            const note = db.prepare("SELECT * FROM file_notes WHERE file_path = ?").get(normalizePath(filePath)) as unknown as FileNoteRow | undefined;
            if (!note) return {};
            const field = dir === "up" ? "dependencies" : "dependents";
            const deps = safeJsonParse<string[]>(note[field], []);
            const result: Record<string, unknown> = {};
            for (const dep of deps) { result[dep] = getDeps(dep, dir, currentDepth + 1); }
            return result;
          }
          const rootNote = db.prepare("SELECT * FROM file_notes WHERE file_path = ?").get(fp) as unknown as FileNoteRow | undefined;
          return success({
            file_path: fp,
            purpose: rootNote?.purpose || "(no notes recorded)",
            layer: rootNote?.layer || detectLayer(fp),
            complexity: rootNote?.complexity || "unknown",
            depends_on: getDeps(fp, "up", 1),
            depended_by: getDeps(fp, "down", 1),
          });
        }

        // ── MILESTONES ────────────────────────────────────────────────────────

        case "record_milestone": {
          if (!params.title) return error("title required for record_milestone.");
          const timestamp = now();
          const sessionId = getCurrentSessionId();
          const result = db.prepare(
            "INSERT INTO milestones (session_id, timestamp, title, description, version, tags) VALUES (?, ?, ?, ?, ?, ?)"
          ).run(sessionId, timestamp, params.title, params.description || null, params.version || null, params.tags ? JSON.stringify(params.tags) : null);
          return success({ milestone_id: Number(result.lastInsertRowid), message: `Milestone #${result.lastInsertRowid} recorded: "${params.title}"${params.version ? ` (${params.version.startsWith("v") ? params.version : `v${params.version}`})` : ""}` });
        }

        case "get_milestones": {
          const milestones = db.prepare("SELECT * FROM milestones ORDER BY timestamp DESC LIMIT ?").all(params.limit ?? 20);
          return success({ milestones });
        }

        // ── SCHEDULER ─────────────────────────────────────────────────────────

        case "schedule_event": {
          if (!params.title) return error("title required for schedule_event.");
          if (!params.trigger_type) return error("trigger_type required for schedule_event.");
          if (params.trigger_type === "datetime" && !params.trigger_value) return error("trigger_value (ISO datetime) required when trigger_type is 'datetime'.");
          if (params.trigger_type === "task_complete" && !params.trigger_value) return error("trigger_value (task ID) required when trigger_type is 'task_complete'.");
          const timestamp = now();
          const sessionId = getCurrentSessionId();
          const result = db.prepare(
            `INSERT INTO scheduled_events (session_id, created_at, title, description, trigger_type, trigger_value, status, requires_approval, action_summary, action_data, priority, tags, recurrence) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
          ).run(sessionId, timestamp, params.title, params.description || null, params.trigger_type, params.trigger_value || null, (params.requires_approval ?? true) ? 1 : 0, params.action_summary || null, params.action_data || null, params.priority ?? "medium", params.tags ? JSON.stringify(params.tags) : null, params.recurrence || null);
          const triggerDesc = params.trigger_type === "next_session" ? "next session start" : params.trigger_type === "datetime" ? `at/after ${params.trigger_value}` : params.trigger_type === "task_complete" ? `when task #${params.trigger_value} completes` : "when manually checked";
          return success({ event_id: Number(result.lastInsertRowid), title: params.title, trigger: triggerDesc, message: `Event #${result.lastInsertRowid} scheduled — will trigger on ${triggerDesc}.` });
        }

        case "get_scheduled_events": {
          let evQuery = "SELECT * FROM scheduled_events WHERE 1=1";
          const evParams: unknown[] = [];
          if (!params.include_done) { evQuery += " AND status NOT IN ('executed', 'cancelled')"; }
          if (params.status) { evQuery += " AND status = ?"; evParams.push(params.status); }
          if (params.trigger_type) { evQuery += " AND trigger_type = ?"; evParams.push(params.trigger_type); }
          evQuery += ` ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, created_at ASC LIMIT ?`;
          evParams.push(params.limit ?? 20);
          const events = db.prepare(evQuery).all(...evParams);
          const pendingCount = (db.prepare("SELECT COUNT(*) as c FROM scheduled_events WHERE status IN ('pending', 'triggered')").get() as { c: number }).c;
          return success({ total_active: pendingCount, returned: events.length, events });
        }

        case "update_scheduled_event": {
          if (!params.id) return error("id required for update_scheduled_event.");
          if (!db.prepare("SELECT id FROM scheduled_events WHERE id = ?").get(params.id)) return error(`Event #${params.id} not found.`);
          const updates: string[] = [];
          const upParams: unknown[] = [];
          if (params.status !== undefined) {
            updates.push("status = ?"); upParams.push(params.status);
            if (params.status === "acknowledged") { updates.push("acknowledged_at = ?"); upParams.push(now()); }
            if (params.status === "executed") { updates.push("acknowledged_at = COALESCE(acknowledged_at, ?)"); upParams.push(now()); }
            if (params.status === "pending") { updates.push("triggered_at = NULL"); updates.push("acknowledged_at = NULL"); }
          }
          if (params.trigger_type !== undefined) { updates.push("trigger_type = ?"); upParams.push(params.trigger_type); }
          if (params.trigger_value !== undefined) { updates.push("trigger_value = ?"); upParams.push(params.trigger_value); }
          if (params.title !== undefined) { updates.push("title = ?"); upParams.push(params.title); }
          if (params.description !== undefined) { updates.push("description = ?"); upParams.push(params.description); }
          if (params.priority !== undefined) { updates.push("priority = ?"); upParams.push(params.priority); }
          if (updates.length === 0) return success({ message: `No changes specified for event #${params.id}.` });
          upParams.push(params.id);
          db.prepare(`UPDATE scheduled_events SET ${updates.join(", ")} WHERE id = ?`).run(...upParams);
          const updated = db.prepare("SELECT * FROM scheduled_events WHERE id = ?").get(params.id);
          return success({ message: `Event #${params.id} updated.`, event: updated });
        }

        case "acknowledge_event": {
          if (!params.id) return error("id required for acknowledge_event.");
          if (params.approved === undefined) return error("approved boolean required for acknowledge_event.");
          const event = db.prepare("SELECT * FROM scheduled_events WHERE id = ?").get(params.id) as unknown as ScheduledEventRow | undefined;
          if (!event) return error(`Event #${params.id} not found.`);
          if (params.approved) {
            db.prepare("UPDATE scheduled_events SET status = 'acknowledged', acknowledged_at = ? WHERE id = ?").run(now(), params.id);
            if (event.recurrence && event.recurrence !== "once") {
              const nextVal = event.trigger_type === "datetime" ? calculateNextTrigger(event.recurrence, event.trigger_value ?? null) : event.trigger_value;
              db.prepare(`INSERT INTO scheduled_events (session_id, created_at, title, description, trigger_type, trigger_value, status, requires_approval, action_summary, action_data, priority, tags, recurrence) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`).run(getCurrentSessionId(), now(), event.title, event.description, event.trigger_type, nextVal, event.requires_approval, event.action_summary, event.action_data, event.priority, event.tags, event.recurrence);
            }
            return success({ event_id: params.id, status: "acknowledged", message: `Event #${params.id} approved.${params.note ? ` Note: ${params.note}` : ""}` });
          } else {
            // Snooze: reset to pending so this occurrence is skipped but the event remains active.
            // The event will re-trigger at the next session start (for every_session events).
            // To permanently cancel, use update_scheduled_event({ id, status: "cancelled" }).
            db.prepare("UPDATE scheduled_events SET status = 'pending' WHERE id = ?").run(params.id);
            return success({ event_id: params.id, status: "snoozed", message: `Event #${params.id} snoozed — will trigger again next session.${params.note ? ` Reason: ${params.note}` : ""} To permanently cancel use update_scheduled_event({ id: ${params.id}, status: "cancelled" }).` });
          }
        }

        case "check_events": {
          const timestamp = now();
          db.prepare(`UPDATE scheduled_events SET status = 'triggered', triggered_at = ? WHERE status = 'pending' AND trigger_type = 'datetime' AND trigger_value <= ?`).run(timestamp, timestamp);
          const events = db.prepare(`SELECT * FROM scheduled_events WHERE status IN ('triggered', 'pending') ORDER BY CASE status WHEN 'triggered' THEN 0 WHEN 'pending' THEN 1 END, CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END LIMIT 20`).all() as unknown[] as ScheduledEventRow[];
          const triggered = events.filter(e => e.status === "triggered");
          const pending = events.filter(e => e.status === "pending");
          const contextPressure = detectContextPressure(params.context_tokens_used, params.context_window_total);
          return success({
            triggered_count: triggered.length, pending_count: pending.length,
            triggered_events: triggered, pending_events: pending,
            context_pressure: contextPressure,
            message: [triggered.length > 0 ? `${triggered.length} event(s) triggered.` : "No events triggered.", contextPressure ? `⚠️ Context pressure [${contextPressure.severity.toUpperCase()}]: ${contextPressure.message}` : null].filter(Boolean).join(" ") || "All clear.",
          });
        }

        // ── COORDINATION ──────────────────────────────────────────────────────

        case "dump": {
          if (!params.content) return error("content required for dump.");
          const scores = scoreDump(params.content);
          const classified = pickDumpType(scores, params.hint === "auto" ? undefined : params.hint);
          const timestamp = now();
          const sessionId = getCurrentSessionId();
          const extractedItems: Array<{ type: DumpType; id: number; summary: string }> = [];
          try {
            switch (classified) {
              case "decision": {
                const id = repos.decisions.create(sessionId, timestamp, truncate(params.content, 500), undefined, undefined, params.tags ?? null, "active");
                extractedItems.push({ type: "decision", id, summary: truncate(params.content, 120) });
                break;
              }
              case "task": {
                const id = repos.tasks.create(sessionId, timestamp, { title: truncate(params.content, 100), description: params.content.length > 100 ? params.content : undefined, priority: "medium", status: "backlog", tags: params.tags ?? null });
                extractedItems.push({ type: "task", id, summary: truncate(params.content, 120) });
                break;
              }
              case "convention": {
                const id = repos.conventions.create(sessionId, timestamp, "other", truncate(params.content, 300));
                extractedItems.push({ type: "convention", id, summary: truncate(params.content, 120) });
                break;
              }
              default: {
                // "finding" dumps are stored as knowledge notes — NOT as file-change records —
                // to prevent "dump" appearing as a fake file in change-stats (ISS-011).
                const findingId = Date.now() % 1_000_000;
                extractedItems.push({ type: "finding", id: findingId, summary: truncate(params.content, 120) });
              }
            }
          } catch (e) { return error(`Failed to store dump: ${e}`); }
          const confidence = Math.max(...Object.values(scores));
          return success({
            extracted_items: extractedItems,
            classification: { type: classified, confidence: confidence >= 4 ? "high" : confidence >= 2 ? "medium" : "low", scores, hint_used: !!params.hint && params.hint !== "auto" },
            message: `Classified as "${classified}" and stored. Review extracted_items[] to verify.`,
          });
        }

        case "claim_task": {
          if (!params.task_id) return error("task_id required for claim_task.");
          const agentId = params.agent_id ?? "unknown";
          const timestamp = now();
          const result = db.prepare(
            `UPDATE tasks SET claimed_by = ?, claimed_at = ?, updated_at = ? WHERE id = ? AND claimed_by IS NULL AND status NOT IN ('done', 'cancelled')`
          ).run(agentId, Date.now(), timestamp, params.task_id);
          if (result.changes === 0) {
            const task = db.prepare("SELECT id, status, claimed_by FROM tasks WHERE id = ?").get(params.task_id) as { id: number; status: string; claimed_by: string | null } | undefined;
            if (!task) return error(`Task #${params.task_id} not found.`);
            if (task.status === "done" || task.status === "cancelled") return error(`Task #${params.task_id} is already ${task.status}.`);
            if (task.claimed_by) return error(`Task #${params.task_id} is already claimed by "${task.claimed_by}".`);
            return error(`Task #${params.task_id} could not be claimed.`);
          }
          const claimedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(params.task_id) as { tags?: string | null } | null;
          // Advisory specialization match score
          let matchScore: number | undefined;
          let matchWarning: string | undefined;
          try {
            const agent = db.prepare("SELECT specializations FROM agents WHERE id = ?").get(agentId) as { specializations: string | null } | undefined;
            if (agent?.specializations) {
              const specs: string[] = JSON.parse(agent.specializations);
              const taskTags: string[] = claimedTask?.tags ? JSON.parse(claimedTask.tags) : [];
              if (specs.length > 0 && taskTags.length > 0) {
                const overlap = taskTags.filter(t => specs.some(s => s.toLowerCase() === t.toLowerCase()));
                matchScore = Math.round((overlap.length / taskTags.length) * 100);
                if (matchScore === 0) matchWarning = `No specialization overlap (agent: [${specs.join(", ")}], task tags: [${taskTags.join(", ")}]).`;
              }
            }
          } catch { /* advisory only, never hard-block */ }
          return success({ message: `Task #${params.task_id} claimed by "${agentId}".${matchWarning ? ` ⚠️ ${matchWarning}` : ""}`, task: claimedTask, match_score: matchScore, match_warning: matchWarning });
        }

        case "release_task": {
          if (!params.task_id) return error("task_id required for release_task.");
          const agentId = params.agent_id ?? "unknown";
          const timestamp = now();
          const whereClause = params.force ? "WHERE id = ?" : "WHERE id = ? AND claimed_by = ?";
          const relParams: unknown[] = params.force ? [timestamp, params.task_id] : [timestamp, params.task_id, agentId];
          const result = db.prepare(`UPDATE tasks SET claimed_by = NULL, claimed_at = NULL, updated_at = ? ${whereClause}`).run(...relParams);
          if (result.changes === 0) {
            const task = db.prepare("SELECT claimed_by FROM tasks WHERE id = ?").get(params.task_id) as { claimed_by: string | null } | undefined;
            if (!task) return error(`Task #${params.task_id} not found.`);
            return error(`Cannot release task #${params.task_id}: claimed by "${task.claimed_by ?? "nobody"}". Use force: true to override.`);
          }
          return success({ message: `Task #${params.task_id} released back to pool.` });
        }

        case "agent_sync": {
          if (!params.agent_id) return error("agent_id required for agent_sync.");
          const nowMs = Date.now();
          try {
            const specsJson = params.specializations ? JSON.stringify(params.specializations) : null;
            db.prepare(
              `INSERT INTO agents (id, name, last_seen, current_task_id, status, specializations) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = COALESCE(excluded.name, name), last_seen = excluded.last_seen, current_task_id = excluded.current_task_id, status = excluded.status, specializations = COALESCE(excluded.specializations, specializations)`
            ).run(params.agent_id, params.agent_name ?? params.agent_id, nowMs, params.current_task_id ?? null, params.status ?? "idle", specsJson);
          } catch { return error("Agent coordination tables not yet initialised."); }
          const STALE_MS = 30 * 60 * 1000;
          try {
            db.prepare(`UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE claimed_by IN (SELECT id FROM agents WHERE status = 'working' AND last_seen < ?)`).run(nowMs - STALE_MS);
            db.prepare("UPDATE agents SET status = 'stale' WHERE status = 'working' AND last_seen < ?").run(nowMs - STALE_MS);
          } catch { /* best effort */ }
          let broadcasts: unknown[] = [];
          try {
            const all = db.prepare(`SELECT * FROM broadcasts WHERE (expires_at IS NULL OR expires_at > ?) AND NOT EXISTS (SELECT 1 FROM json_each(read_by) WHERE value = ?) AND (target_agent IS NULL OR target_agent = ?) ORDER BY created_at DESC LIMIT 10`).all(nowMs, params.agent_id, params.agent_id) as Array<{ id: number }>;
            broadcasts = all;
            for (const b of all) {
              const row = db.prepare("SELECT read_by FROM broadcasts WHERE id = ?").get(b.id) as { read_by: string };
              const readers: string[] = JSON.parse(row.read_by || "[]");
              if (!readers.includes(params.agent_id!)) { readers.push(params.agent_id!); db.prepare("UPDATE broadcasts SET read_by = ? WHERE id = ?").run(JSON.stringify(readers), b.id); }
            }
          } catch { /* best effort */ }
          return success({ agent: db.prepare("SELECT * FROM agents WHERE id = ?").get(params.agent_id), unread_broadcasts: broadcasts, message: broadcasts.length > 0 ? `Agent "${params.agent_id}" synced. ${broadcasts.length} unread broadcast(s).` : `Agent "${params.agent_id}" synced.` });
        }

        case "route_task": {
          if (!params.task_id) return error("task_id required for route_task.");
          const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(params.task_id) as { tags?: string | null; title: string; status: string } | undefined;
          if (!taskRow) return error(`Task #${params.task_id} not found.`);
          const taskTags: string[] = taskRow.tags ? (() => { try { return JSON.parse(taskRow.tags!); } catch { return []; } })() : [];
          let agents: Array<{ id: string; name: string; status: string; last_seen: number; specializations: string | null }> = [];
          try { agents = db.prepare("SELECT id, name, status, last_seen, specializations FROM agents WHERE status != 'stale' ORDER BY last_seen DESC").all() as typeof agents; } catch { return error("Agent coordination tables not initialised. Run agent_sync first."); }
          const scored = agents.map(a => {
            const specs: string[] = a.specializations ? (() => { try { return JSON.parse(a.specializations!); } catch { return []; } })() : [];
            const overlap = taskTags.length > 0 ? taskTags.filter(t => specs.some(s => s.toLowerCase() === t.toLowerCase())).length : 0;
            const score = taskTags.length > 0 ? Math.round((overlap / taskTags.length) * 100) : (a.status === "idle" ? 50 : 10);
            return { agent_id: a.id, agent_name: a.name, status: a.status, specializations: specs, match_score: score };
          }).sort((a, b) => b.match_score - a.match_score || (a.status === "idle" ? -1 : 1));
          const best = scored[0] ?? null;
          return success({ task_id: params.task_id, task_title: taskRow.title, task_tags: taskTags, best_match: best, all_candidates: scored, message: best ? `Best agent for task #${params.task_id}: "${best.agent_name}" (score: ${best.match_score}%).` : "No active agents available." });
        }

        case "get_agents": {
          try {
            const agents = db.prepare("SELECT * FROM agents ORDER BY last_seen DESC").all() as Array<Record<string, unknown>>;
            const enriched = agents.map(a => {
              const taskId = a["current_task_id"] as number | null;
              if (!taskId) return { ...a, current_task: null };
              return { ...a, current_task: db.prepare("SELECT id, title, status FROM tasks WHERE id = ?").get(taskId) ?? null };
            });
            return success({ count: enriched.length, agents: enriched });
          } catch { return error("Agent coordination tables not initialised. Run agent_sync first."); }
        }

        case "broadcast": {
          if (!params.from_agent || !params.message) return error("from_agent and message required for broadcast.");
          const nowMs = Date.now();
          const expiresAt = nowMs + (params.expires_in_minutes ?? 60) * 60_000;
          const targetAgent = params.target_agent ?? null;
          try {
            const result = db.prepare("INSERT INTO broadcasts (from_agent, message, created_at, expires_at, read_by, target_agent) VALUES (?, ?, ?, ?, '[]', ?)").run(params.from_agent, params.message, nowMs, expiresAt, targetAgent);
            return success({ broadcast_id: Number(result.lastInsertRowid), message: `Broadcast #${result.lastInsertRowid} sent.`, expires_at: new Date(expiresAt).toISOString(), ...(targetAgent ? { target_agent: targetAgent } : {}) });
          } catch { return error("Broadcast table not initialised. Ensure migrations have run."); }
        }

        default:
          return error(`Unknown memory action: ${(params as Record<string, unknown>).action}`);
      }
    }
  );
}
