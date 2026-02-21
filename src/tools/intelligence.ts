// ============================================================================
// Engram MCP Server — Project Intelligence Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, now, getProjectRoot } from "../database.js";
import { TOOL_PREFIX, SNAPSHOT_TTL_MINUTES, MAX_SEARCH_RESULTS } from "../constants.js";
import { scanFileTree, detectLayer, isGitRepo, getGitBranch, getGitHead, getGitLogSince, getGitFilesChanged, minutesSince, safeJsonParse } from "../utils.js";
import type { FileNoteRow, DecisionRow, ConventionRow, ChangeRow, ProjectSnapshot } from "../types.js";

// ─── FTS5 Helpers ────────────────────────────────────────────────────

/**
 * Check if FTS5 tables exist (migration v2 applied).
 */
function hasFts(db: ReturnType<typeof getDb>): boolean {
  try {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='fts_sessions'"
    ).get() as { name: string } | undefined;
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Escape a user query for FTS5 MATCH syntax.
 * Wraps each word in quotes to avoid syntax errors from special chars.
 */
function ftsEscape(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map(word => `"${word.replace(/"/g, '""')}"`)
    .join(" ");
}

export function registerIntelligenceTools(server: McpServer): void {
  // ─── SCAN PROJECT ───────────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_scan_project`,
    {
      title: "Scan Project",
      description: `Scan the project filesystem and build a cached snapshot of the structure. Includes file tree, auto-detected architectural layers, existing file notes, active decisions, and conventions. The snapshot is cached and reused — no need to rescan unless files changed significantly.

Args:
  - force_refresh (boolean, optional): Force rescan even if cache is fresh (default: false)
  - max_depth (number, optional): Max directory depth to scan (default: 5)

Returns:
  ProjectSnapshot with file tree, layer distribution, and all stored intelligence.`,
      inputSchema: {
        force_refresh: z.boolean().default(false).describe("Force rescan even if cache is fresh"),
        max_depth: z.number().int().min(1).max(10).default(5).describe("Max directory depth"),
      },
      annotations: {
        readOnlyHint: false, // It writes to cache
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ force_refresh, max_depth }) => {
      const db = getDb();
      const projectRoot = getProjectRoot();

      // Check cache freshness
      if (!force_refresh) {
        const cached = db.prepare("SELECT * FROM snapshot_cache WHERE key = 'project_structure'").get() as { value: string; updated_at: string } | undefined;
        if (cached) {
          const age = minutesSince(cached.updated_at);
          if (age < SNAPSHOT_TTL_MINUTES) {
            const snapshot = safeJsonParse<ProjectSnapshot>(cached.value, null as unknown as ProjectSnapshot);
            if (snapshot) {
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    ...snapshot,
                    _cache_status: `fresh (${age}min old, TTL: ${SNAPSHOT_TTL_MINUTES}min)`,
                  }, null, 2),
                }],
              };
            }
          }
        }
      }

      // Perform full scan
      const fileTree = scanFileTree(projectRoot, max_depth);

      // Auto-detect layers for each file
      const layerDist: Record<string, number> = {};
      for (const f of fileTree) {
        if (f.endsWith("/")) continue; // Skip directories
        const layer = detectLayer(f);
        layerDist[layer] = (layerDist[layer] || 0) + 1;
      }

      // Fetch stored intelligence
      const fileNotes = db.prepare("SELECT * FROM file_notes ORDER BY file_path").all() as unknown[] as FileNoteRow[];
      const activeDecisions = db.prepare("SELECT * FROM decisions WHERE status = 'active' ORDER BY timestamp DESC LIMIT 20").all() as unknown[] as DecisionRow[];
      const activeConventions = db.prepare("SELECT * FROM conventions WHERE enforced = 1 ORDER BY category").all() as unknown[] as ConventionRow[];

      // Git info
      let gitInfo: { branch: string; head: string; is_clean: boolean } | null = null;
      if (isGitRepo(projectRoot)) {
        const branch = getGitBranch(projectRoot);
        const head = getGitHead(projectRoot);
        gitInfo = { branch, head, is_clean: true }; // Simplified
      }

      const snapshot: ProjectSnapshot & { git?: typeof gitInfo } = {
        project_root: projectRoot,
        file_tree: fileTree,
        total_files: fileTree.filter(f => !f.endsWith("/")).length,
        file_notes: fileNotes,
        recent_decisions: activeDecisions,
        active_conventions: activeConventions,
        layer_distribution: layerDist,
        generated_at: now(),
        git: gitInfo,
      };

      // Cache the snapshot
      db.prepare(
        "INSERT OR REPLACE INTO snapshot_cache (key, value, updated_at, ttl_minutes) VALUES ('project_structure', ?, ?, ?)"
      ).run(JSON.stringify(snapshot), now(), SNAPSHOT_TTL_MINUTES);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ...snapshot,
            _cache_status: "freshly scanned",
          }, null, 2),
        }],
      };
    }
  );

  // ─── SEARCH MEMORY (FTS5-powered) ──────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_search`,
    {
      title: "Search Memory",
      description: `Full-text search across ALL memory: sessions, changes, decisions, file notes, conventions, and tasks. Uses FTS5 for high-performance ranked results when available, falls back to LIKE for compatibility.

Args:
  - query (string): Search term(s)
  - scope (string, optional): Limit search to a specific table — "sessions", "changes", "decisions", "file_notes", "conventions", "tasks", or "all" (default: "all")
  - limit (number, optional): Max total results (default: 20)

Returns:
  Grouped search results with relevance context.`,
      inputSchema: {
        query: z.string().min(1).describe("Search term(s)"),
        scope: z.enum(["all", "sessions", "changes", "decisions", "file_notes", "conventions", "tasks"]).default("all"),
        limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).default(20),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, scope, limit }) => {
      const db = getDb();
      const useFts = hasFts(db);
      const results: Record<string, unknown[]> = {};
      let totalFound = 0;
      const perTable = Math.ceil(limit / 6);

      if (useFts) {
        // ─── FTS5 Path (fast, ranked) ────────────────────────────
        const ftsQuery = ftsEscape(query);

        if (scope === "all" || scope === "sessions") {
          try {
            const rows = db.prepare(
              `SELECT s.*, rank FROM fts_sessions f
               JOIN sessions s ON s.id = f.rowid
               WHERE fts_sessions MATCH ?
               ORDER BY rank LIMIT ?`
            ).all(ftsQuery, perTable);
            if (rows.length) { results.sessions = rows; totalFound += rows.length; }
          } catch { /* FTS match failed, skip */ }
        }

        if (scope === "all" || scope === "changes") {
          try {
            const rows = db.prepare(
              `SELECT c.*, rank FROM fts_changes f
               JOIN changes c ON c.id = f.rowid
               WHERE fts_changes MATCH ?
               ORDER BY rank LIMIT ?`
            ).all(ftsQuery, perTable);
            if (rows.length) { results.changes = rows; totalFound += rows.length; }
          } catch { /* FTS match failed, skip */ }
        }

        if (scope === "all" || scope === "decisions") {
          try {
            const rows = db.prepare(
              `SELECT d.*, rank FROM fts_decisions f
               JOIN decisions d ON d.id = f.rowid
               WHERE fts_decisions MATCH ?
               ORDER BY rank LIMIT ?`
            ).all(ftsQuery, perTable);
            if (rows.length) { results.decisions = rows; totalFound += rows.length; }
          } catch { /* FTS match failed, skip */ }
        }

        if (scope === "all" || scope === "file_notes") {
          try {
            const rows = db.prepare(
              `SELECT * FROM file_notes WHERE file_path IN (
                 SELECT file_path FROM fts_file_notes WHERE fts_file_notes MATCH ?
               ) LIMIT ?`
            ).all(ftsQuery, perTable);
            if (rows.length) { results.file_notes = rows; totalFound += rows.length; }
          } catch { /* FTS match failed, skip */ }
        }

        if (scope === "all" || scope === "conventions") {
          try {
            const rows = db.prepare(
              `SELECT c.*, rank FROM fts_conventions f
               JOIN conventions c ON c.id = f.rowid
               WHERE fts_conventions MATCH ?
               ORDER BY rank LIMIT ?`
            ).all(ftsQuery, perTable);
            if (rows.length) { results.conventions = rows; totalFound += rows.length; }
          } catch { /* FTS match failed, skip */ }
        }

        if (scope === "all" || scope === "tasks") {
          try {
            const rows = db.prepare(
              `SELECT t.*, rank FROM fts_tasks f
               JOIN tasks t ON t.id = f.rowid
               WHERE fts_tasks MATCH ?
               ORDER BY rank LIMIT ?`
            ).all(ftsQuery, perTable);
            if (rows.length) { results.tasks = rows; totalFound += rows.length; }
          } catch { /* FTS match failed, skip */ }
        }
      } else {
        // ─── LIKE Fallback (slow but compatible) ─────────────────
        const term = `%${query}%`;

        if (scope === "all" || scope === "sessions") {
          const rows = db.prepare(
            "SELECT * FROM sessions WHERE summary LIKE ? OR tags LIKE ? ORDER BY id DESC LIMIT ?"
          ).all(term, term, perTable);
          if (rows.length) { results.sessions = rows; totalFound += rows.length; }
        }

        if (scope === "all" || scope === "changes") {
          const rows = db.prepare(
            "SELECT * FROM changes WHERE description LIKE ? OR file_path LIKE ? OR diff_summary LIKE ? ORDER BY timestamp DESC LIMIT ?"
          ).all(term, term, term, perTable);
          if (rows.length) { results.changes = rows; totalFound += rows.length; }
        }

        if (scope === "all" || scope === "decisions") {
          const rows = db.prepare(
            "SELECT * FROM decisions WHERE decision LIKE ? OR rationale LIKE ? OR tags LIKE ? ORDER BY timestamp DESC LIMIT ?"
          ).all(term, term, term, perTable);
          if (rows.length) { results.decisions = rows; totalFound += rows.length; }
        }

        if (scope === "all" || scope === "file_notes") {
          const rows = db.prepare(
            "SELECT * FROM file_notes WHERE file_path LIKE ? OR purpose LIKE ? OR notes LIKE ? LIMIT ?"
          ).all(term, term, term, perTable);
          if (rows.length) { results.file_notes = rows; totalFound += rows.length; }
        }

        if (scope === "all" || scope === "conventions") {
          const rows = db.prepare(
            "SELECT * FROM conventions WHERE rule LIKE ? OR examples LIKE ? LIMIT ?"
          ).all(term, term, perTable);
          if (rows.length) { results.conventions = rows; totalFound += rows.length; }
        }

        if (scope === "all" || scope === "tasks") {
          const rows = db.prepare(
            "SELECT * FROM tasks WHERE title LIKE ? OR description LIKE ? OR tags LIKE ? ORDER BY updated_at DESC LIMIT ?"
          ).all(term, term, term, perTable);
          if (rows.length) { results.tasks = rows; totalFound += rows.length; }
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            query,
            scope,
            search_engine: useFts ? "fts5" : "like",
            total_results: totalFound,
            results,
          }, null, 2),
        }],
      };
    }
  );

  // ─── WHAT CHANGED ───────────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_what_changed`,
    {
      title: "What Changed",
      description: `Comprehensive diff report: what changed since a given time. Combines agent-recorded changes with git history. Use to quickly catch up after being away.

Args:
  - since (string, optional): ISO timestamp or relative like "1h", "24h", "7d" (default: last session end)
  - include_git (boolean, optional): Include git log (default: true)

Returns:
  Combined change report from both agent memory and git.`,
      inputSchema: {
        since: z.string().optional().describe('ISO timestamp or relative: "1h", "24h", "7d"'),
        include_git: z.boolean().default(true),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ since, include_git }) => {
      const db = getDb();
      const projectRoot = getProjectRoot();

      // Resolve "since" to an ISO timestamp
      let sinceTimestamp: string;
      if (!since) {
        // Default to last session end
        const last = db.prepare("SELECT ended_at FROM sessions WHERE ended_at IS NOT NULL ORDER BY id DESC LIMIT 1").get() as { ended_at: string } | undefined;
        sinceTimestamp = last?.ended_at || new Date(Date.now() - 86400000).toISOString();
      } else if (/^\d+[hdm]$/.test(since)) {
        // Relative time
        const match = since.match(/^(\d+)([hdm])$/);
        if (match) {
          const amount = parseInt(match[1]);
          const unit = match[2];
          const ms = unit === "h" ? amount * 3600000 : unit === "d" ? amount * 86400000 : amount * 60000;
          sinceTimestamp = new Date(Date.now() - ms).toISOString();
        } else {
          sinceTimestamp = since;
        }
      } else {
        sinceTimestamp = since;
      }

      // Agent-recorded changes
      const agentChanges = db.prepare(
        "SELECT * FROM changes WHERE timestamp > ? ORDER BY timestamp DESC"
      ).all(sinceTimestamp) as unknown[] as ChangeRow[];

      // Decisions made since
      const newDecisions = db.prepare(
        "SELECT * FROM decisions WHERE timestamp > ? ORDER BY timestamp DESC"
      ).all(sinceTimestamp) as unknown[] as DecisionRow[];

      // Git changes
      let gitLog = "";
      let gitFilesChanged: string[] = [];
      if (include_git && isGitRepo(projectRoot)) {
        gitLog = getGitLogSince(projectRoot, sinceTimestamp);
        gitFilesChanged = getGitFilesChanged(projectRoot, sinceTimestamp);
      }

      // Files only in git (not recorded by agent)
      const recordedFiles = new Set(agentChanges.map(c => c.file_path));
      const unrecordedGitChanges = gitFilesChanged.filter(f => !recordedFiles.has(f));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            since: sinceTimestamp,
            agent_recorded: {
              count: agentChanges.length,
              changes: agentChanges,
            },
            new_decisions: newDecisions,
            git: include_git ? {
              log: gitLog,
              files_changed: gitFilesChanged.length,
              unrecorded_changes: unrecordedGitChanges,
            } : null,
            summary: `${agentChanges.length} recorded changes, ${newDecisions.length} new decisions, ${gitFilesChanged.length} git file changes (${unrecordedGitChanges.length} unrecorded) since ${sinceTimestamp}.`,
          }, null, 2),
        }],
      };
    }
  );

  // ─── GET DEPENDENCY MAP ─────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_get_dependency_map`,
    {
      title: "Get Dependency Map",
      description: `Get the dependency graph for a file: what it depends on and what depends on it. Built from stored file notes.

Args:
  - file_path (string): File to query
  - depth (number, optional): How many levels deep to traverse (default: 1)

Returns:
  Dependency tree with upstream and downstream files.`,
      inputSchema: {
        file_path: z.string().describe("File to query"),
        depth: z.number().int().min(1).max(5).default(1).describe("Traversal depth"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ file_path, depth }) => {
      const db = getDb();

      function getDeps(fp: string, dir: "up" | "down", currentDepth: number): Record<string, unknown> {
        if (currentDepth > depth) return {};

        const note = db.prepare("SELECT * FROM file_notes WHERE file_path = ?").get(fp) as unknown as FileNoteRow | undefined;
        if (!note) return {};

        const field = dir === "up" ? "dependencies" : "dependents";
        const deps = safeJsonParse<string[]>(note[field], []);

        const result: Record<string, unknown> = {};
        for (const dep of deps) {
          result[dep] = getDeps(dep, dir, currentDepth + 1);
        }
        return result;
      }

      const upstream = getDeps(file_path, "up", 1);
      const downstream = getDeps(file_path, "down", 1);

      const note = db.prepare("SELECT * FROM file_notes WHERE file_path = ?").get(file_path) as unknown as FileNoteRow | undefined;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            file_path,
            purpose: note?.purpose || "(no notes recorded)",
            layer: note?.layer || detectLayer(file_path),
            complexity: note?.complexity || "unknown",
            depends_on: upstream,
            depended_by: downstream,
          }, null, 2),
        }],
      };
    }
  );
}
