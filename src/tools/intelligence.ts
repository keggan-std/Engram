// ============================================================================
// Engram MCP Server — Project Intelligence Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, now, getProjectRoot } from "../database.js";
import { TOOL_PREFIX, SNAPSHOT_TTL_MINUTES, MAX_SEARCH_RESULTS } from "../constants.js";
import { scanFileTree, detectLayer, isGitRepo, getGitBranch, getGitHead, getGitLogSince, getGitFilesChanged, minutesSince, safeJsonParse, normalizePath, truncate } from "../utils.js";
import { success } from "../response.js";
import type { FileNoteRow, DecisionRow, ConventionRow, ChangeRow, ProjectSnapshot } from "../types.js";

// ─── FTS5 Helpers ────────────────────────────────────────────────────

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
        readOnlyHint: false,
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
              return success({
                ...snapshot,
                _cache_status: `fresh (${age}min old, TTL: ${SNAPSHOT_TTL_MINUTES}min)`,
              } as unknown as Record<string, unknown>);
            }
          }
        }
      }

      // Perform full scan
      const fileTree = scanFileTree(projectRoot, max_depth);
      const layerDist: Record<string, number> = {};
      for (const f of fileTree) {
        if (f.endsWith("/")) continue;
        const layer = detectLayer(f);
        layerDist[layer] = (layerDist[layer] || 0) + 1;
      }

      const fileNotes = db.prepare("SELECT * FROM file_notes ORDER BY file_path").all() as unknown[] as FileNoteRow[];
      const activeDecisions = db.prepare("SELECT * FROM decisions WHERE status = 'active' ORDER BY timestamp DESC LIMIT 20").all() as unknown[] as DecisionRow[];
      const activeConventions = db.prepare("SELECT * FROM conventions WHERE enforced = 1 ORDER BY category").all() as unknown[] as ConventionRow[];

      let gitInfo: { branch: string; head: string; is_clean: boolean } | null = null;
      if (isGitRepo(projectRoot)) {
        const branch = getGitBranch(projectRoot);
        const head = getGitHead(projectRoot);
        gitInfo = { branch, head, is_clean: true };
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

      db.prepare(
        "INSERT OR REPLACE INTO snapshot_cache (key, value, updated_at, ttl_minutes) VALUES ('project_structure', ?, ?, ?)"
      ).run(JSON.stringify(snapshot), now(), SNAPSHOT_TTL_MINUTES);

      return success({
        ...snapshot,
        _cache_status: "freshly scanned",
      } as unknown as Record<string, unknown>);
    }
  );

  // ─── SEARCH MEMORY (FTS5-powered, unified ranking) ────────────────
  server.registerTool(
    `${TOOL_PREFIX}_search`,
    {
      title: "Search Memory",
      description: `Full-text search across ALL memory: sessions, changes, decisions, file notes, conventions, and tasks. Uses FTS5 for high-performance ranked results when available, falls back to LIKE for compatibility. Results are ranked by relevance across all tables (not split evenly).

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
        context_chars: z.number().int().min(0).max(500).default(0).describe("When > 0, each result includes a context field with a snippet of relevant text (truncated to this many chars)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, scope, limit, context_chars }) => {
      const db = getDb();
      const useFts = hasFts(db);
      const oversample = Math.min(limit * 2, MAX_SEARCH_RESULTS);

      // Collect all results with rank into a single pool
      const pool: Array<{ table: string; rank: number; data: unknown }> = [];

      if (useFts) {
        const ftsQuery = ftsEscape(query);

        if (scope === "all" || scope === "sessions") {
          try {
            const rows = db.prepare(
              `SELECT s.*, rank FROM fts_sessions f
               JOIN sessions s ON s.id = f.rowid
               WHERE fts_sessions MATCH ?
               ORDER BY rank LIMIT ?`
            ).all(ftsQuery, oversample) as Array<Record<string, unknown>>;
            for (const r of rows) pool.push({ table: "sessions", rank: r.rank as number, data: r });
          } catch { /* skip */ }
        }

        if (scope === "all" || scope === "changes") {
          try {
            const rows = db.prepare(
              `SELECT c.*, rank FROM fts_changes f
               JOIN changes c ON c.id = f.rowid
               WHERE fts_changes MATCH ?
               ORDER BY rank LIMIT ?`
            ).all(ftsQuery, oversample) as Array<Record<string, unknown>>;
            for (const r of rows) pool.push({ table: "changes", rank: r.rank as number, data: r });
          } catch { /* skip */ }
        }

        if (scope === "all" || scope === "decisions") {
          try {
            const rows = db.prepare(
              `SELECT d.*, rank FROM fts_decisions f
               JOIN decisions d ON d.id = f.rowid
               WHERE fts_decisions MATCH ?
               ORDER BY rank LIMIT ?`
            ).all(ftsQuery, oversample) as Array<Record<string, unknown>>;
            for (const r of rows) pool.push({ table: "decisions", rank: r.rank as number, data: r });
          } catch { /* skip */ }
        }

        if (scope === "all" || scope === "file_notes") {
          try {
            const rows = db.prepare(
              `SELECT fn.*, f.rank FROM fts_file_notes f
               JOIN file_notes fn ON fn.file_path = f.file_path
               WHERE fts_file_notes MATCH ?
               ORDER BY f.rank LIMIT ?`
            ).all(ftsQuery, oversample) as Array<Record<string, unknown>>;
            for (const r of rows) pool.push({ table: "file_notes", rank: r.rank as number, data: r });
          } catch { /* skip */ }
        }

        if (scope === "all" || scope === "conventions") {
          try {
            const rows = db.prepare(
              `SELECT c.*, rank FROM fts_conventions f
               JOIN conventions c ON c.id = f.rowid
               WHERE fts_conventions MATCH ?
               ORDER BY rank LIMIT ?`
            ).all(ftsQuery, oversample) as Array<Record<string, unknown>>;
            for (const r of rows) pool.push({ table: "conventions", rank: r.rank as number, data: r });
          } catch { /* skip */ }
        }

        if (scope === "all" || scope === "tasks") {
          try {
            const rows = db.prepare(
              `SELECT t.*, rank FROM fts_tasks f
               JOIN tasks t ON t.id = f.rowid
               WHERE fts_tasks MATCH ?
               ORDER BY rank LIMIT ?`
            ).all(ftsQuery, oversample) as Array<Record<string, unknown>>;
            for (const r of rows) pool.push({ table: "tasks", rank: r.rank as number, data: r });
          } catch { /* skip */ }
        }
      } else {
        // ─── LIKE Fallback (rank = 0 for all) ──────────────────
        const term = `%${query}%`;

        if (scope === "all" || scope === "sessions") {
          const rows = db.prepare(
            "SELECT * FROM sessions WHERE summary LIKE ? OR tags LIKE ? ORDER BY id DESC LIMIT ?"
          ).all(term, term, oversample);
          for (const r of rows) pool.push({ table: "sessions", rank: 0, data: r });
        }

        if (scope === "all" || scope === "changes") {
          const rows = db.prepare(
            "SELECT * FROM changes WHERE description LIKE ? OR file_path LIKE ? OR diff_summary LIKE ? ORDER BY timestamp DESC LIMIT ?"
          ).all(term, term, term, oversample);
          for (const r of rows) pool.push({ table: "changes", rank: 0, data: r });
        }

        if (scope === "all" || scope === "decisions") {
          const rows = db.prepare(
            "SELECT * FROM decisions WHERE decision LIKE ? OR rationale LIKE ? OR tags LIKE ? ORDER BY timestamp DESC LIMIT ?"
          ).all(term, term, term, oversample);
          for (const r of rows) pool.push({ table: "decisions", rank: 0, data: r });
        }

        if (scope === "all" || scope === "file_notes") {
          const rows = db.prepare(
            "SELECT * FROM file_notes WHERE file_path LIKE ? OR purpose LIKE ? OR notes LIKE ? LIMIT ?"
          ).all(term, term, term, oversample);
          for (const r of rows) pool.push({ table: "file_notes", rank: 0, data: r });
        }

        if (scope === "all" || scope === "conventions") {
          const rows = db.prepare(
            "SELECT * FROM conventions WHERE rule LIKE ? OR examples LIKE ? LIMIT ?"
          ).all(term, term, oversample);
          for (const r of rows) pool.push({ table: "conventions", rank: 0, data: r });
        }

        if (scope === "all" || scope === "tasks") {
          const rows = db.prepare(
            "SELECT * FROM tasks WHERE title LIKE ? OR description LIKE ? OR tags LIKE ? ORDER BY updated_at DESC LIMIT ?"
          ).all(term, term, term, oversample);
          for (const r of rows) pool.push({ table: "tasks", rank: 0, data: r });
        }
      }

      // Sort by rank (FTS5 rank is negative — more negative = better match)
      pool.sort((a, b) => a.rank - b.rank);

      // Take top `limit` and group by table
      const top = pool.slice(0, limit);
      const results: Record<string, unknown[]> = {};
      for (const item of top) {
        if (!results[item.table]) results[item.table] = [];
        results[item.table].push(item.data);
      }

      // Enrich results with context snippet if context_chars > 0
      if (context_chars > 0) {
        for (const [table, items] of Object.entries(results)) {
          results[table] = items.map((item) => {
            const d = item as Record<string, unknown>;
            let ctx = "";
            if (table === "decisions") {
              ctx = truncate(
                String(d["decision"] ?? "") + " " + String(d["rationale"] ?? ""),
                context_chars * 2
              ).slice(0, context_chars);
            } else if (table === "sessions") {
              ctx = truncate(String(d["summary"] ?? ""), context_chars);
            } else if (table === "tasks") {
              ctx = truncate(
                String(d["title"] ?? "") + " " + String(d["description"] ?? ""),
                context_chars * 2
              ).slice(0, context_chars);
            } else if (table === "file_notes") {
              ctx = truncate(
                String(d["purpose"] ?? "") + " " + String(d["notes"] ?? ""),
                context_chars * 2
              ).slice(0, context_chars);
            } else if (table === "changes") {
              ctx = truncate(
                String(d["description"] ?? "") + " " + String(d["diff_summary"] ?? ""),
                context_chars * 2
              ).slice(0, context_chars);
            }
            return ctx ? { ...d, context: ctx } : d;
          });
        }
      }

      return success({
        query,
        scope,
        search_engine: useFts ? "fts5" : "like",
        total_results: top.length,
        results,
      });
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

      let sinceTimestamp: string;
      if (!since) {
        const last = db.prepare("SELECT ended_at FROM sessions WHERE ended_at IS NOT NULL ORDER BY id DESC LIMIT 1").get() as { ended_at: string } | undefined;
        sinceTimestamp = last?.ended_at || new Date(Date.now() - 86400000).toISOString();
      } else if (/^\d+[hdm]$/.test(since)) {
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

      const agentChanges = db.prepare(
        "SELECT * FROM changes WHERE timestamp > ? ORDER BY timestamp DESC"
      ).all(sinceTimestamp) as unknown[] as ChangeRow[];

      const newDecisions = db.prepare(
        "SELECT * FROM decisions WHERE timestamp > ? ORDER BY timestamp DESC"
      ).all(sinceTimestamp) as unknown[] as DecisionRow[];

      let gitLog = "";
      let gitFilesChanged: string[] = [];
      if (include_git && isGitRepo(projectRoot)) {
        gitLog = getGitLogSince(projectRoot, sinceTimestamp);
        gitFilesChanged = getGitFilesChanged(projectRoot, sinceTimestamp);
      }

      const recordedFiles = new Set(agentChanges.map(c => c.file_path));
      const unrecordedGitChanges = gitFilesChanged.filter(f => !recordedFiles.has(f));

      return success({
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
      });
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
      const fp = normalizePath(file_path);

      function getDeps(filePath: string, dir: "up" | "down", currentDepth: number): Record<string, unknown> {
        if (currentDepth > depth) return {};

        const note = db.prepare("SELECT * FROM file_notes WHERE file_path = ?").get(normalizePath(filePath)) as unknown as FileNoteRow | undefined;
        if (!note) return {};

        const field = dir === "up" ? "dependencies" : "dependents";
        const deps = safeJsonParse<string[]>(note[field], []);

        const result: Record<string, unknown> = {};
        for (const dep of deps) {
          result[dep] = getDeps(dep, dir, currentDepth + 1);
        }
        return result;
      }

      const upstream = getDeps(fp, "up", 1);
      const downstream = getDeps(fp, "down", 1);

      const note = db.prepare("SELECT * FROM file_notes WHERE file_path = ?").get(fp) as unknown as FileNoteRow | undefined;

      return success({
        file_path: fp,
        purpose: note?.purpose || "(no notes recorded)",
        layer: note?.layer || detectLayer(fp),
        complexity: note?.complexity || "unknown",
        depends_on: upstream,
        depended_by: downstream,
      });
    }
  );
}