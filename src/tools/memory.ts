// ============================================================================
// Engram MCP Server — Core Memory Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, now, getCurrentSessionId } from "../database.js";
import { TOOL_PREFIX } from "../constants.js";
import type { ChangeRow, DecisionRow, FileNoteRow, ConventionRow } from "../types.js";

export function registerMemoryTools(server: McpServer): void {
  // ═══════════════════════════════════════════════════════════════════════
  // CHANGE TRACKING
  // ═══════════════════════════════════════════════════════════════════════

  server.registerTool(
    `${TOOL_PREFIX}_record_change`,
    {
      title: "Record Change",
      description: `Record a file change so future sessions know what happened and why. Call this after making significant modifications. Bulk recording is supported — pass multiple changes at once.

Args:
  - changes (array): Array of change objects, each with:
    - file_path (string): Relative path to the changed file
    - change_type: "created" | "modified" | "deleted" | "refactored" | "renamed" | "moved" | "config_changed"
    - description (string): What was changed and why
    - diff_summary (string, optional): Brief summary of the diff
    - impact_scope: "local" | "module" | "cross_module" | "global" (default: "local")

Returns:
  Confirmation with number of changes recorded.`,
      inputSchema: {
        changes: z.array(z.object({
          file_path: z.string().describe("Relative path to the changed file"),
          change_type: z.enum(["created", "modified", "deleted", "refactored", "renamed", "moved", "config_changed"]),
          description: z.string().describe("What was changed and why"),
          diff_summary: z.string().optional().describe("Brief diff summary"),
          impact_scope: z.enum(["local", "module", "cross_module", "global"]).default("local"),
        })).min(1).describe("Array of changes to record"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ changes }) => {
      const db = getDb();
      const timestamp = now();
      const sessionId = getCurrentSessionId();

      const insert = db.prepare(
        "INSERT INTO changes (session_id, timestamp, file_path, change_type, description, diff_summary, impact_scope) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );

      const transaction = db.transaction(() => {
        for (const c of changes) {
          insert.run(sessionId, timestamp, c.file_path, c.change_type, c.description, c.diff_summary || null, c.impact_scope);

          // Auto-update file_notes last_modified_session
          if (sessionId) {
            db.prepare(
              "UPDATE file_notes SET last_modified_session = ? WHERE file_path = ?"
            ).run(sessionId, c.file_path);
          }
        }
      });

      transaction();

      return {
        content: [{
          type: "text",
          text: `Recorded ${changes.length} change(s) in session #${sessionId ?? "none"}.`,
        }],
      };
    }
  );

  server.registerTool(
    `${TOOL_PREFIX}_get_file_history`,
    {
      title: "Get File History",
      description: `Get the complete change history for a specific file — all recorded modifications, related decisions, and file notes.

Args:
  - file_path (string): Path to the file
  - limit (number, optional): Max changes to return (default 20)

Returns:
  File notes, change history, and related decisions.`,
      inputSchema: {
        file_path: z.string().describe("Relative path to the file"),
        limit: z.number().int().min(1).max(100).default(20).describe("Max changes to return"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ file_path, limit }) => {
      const db = getDb();

      const notes = db.prepare("SELECT * FROM file_notes WHERE file_path = ?").get(file_path) as unknown as FileNoteRow | undefined;
      const changes = db.prepare(
        "SELECT * FROM changes WHERE file_path = ? ORDER BY timestamp DESC LIMIT ?"
      ).all(file_path, limit) as unknown[] as ChangeRow[];
      const decisions = db.prepare(
        "SELECT * FROM decisions WHERE affected_files LIKE ? AND status = 'active' ORDER BY timestamp DESC"
      ).all(`%${file_path}%`) as unknown[] as DecisionRow[];

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            file_path,
            notes: notes || null,
            change_count: changes.length,
            changes,
            related_decisions: decisions,
          }, null, 2),
        }],
      };
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // ARCHITECTURAL DECISIONS
  // ═══════════════════════════════════════════════════════════════════════

  server.registerTool(
    `${TOOL_PREFIX}_record_decision`,
    {
      title: "Record Decision",
      description: `Record an architectural or design decision with its rationale. These persist across all future sessions and are surfaced during start_session. Use this for any choice that future agents or sessions need to respect.

Args:
  - decision (string): The decision that was made
  - rationale (string, optional): Why this decision was made — context, tradeoffs, alternatives considered
  - affected_files (array of strings, optional): Files impacted by this decision
  - tags (array of strings, optional): Categorization tags (e.g., "architecture", "database", "ui", "api")
  - status: "active" | "experimental" (default: "active")
  - supersedes (number, optional): ID of a previous decision this replaces

Returns:
  Decision ID and confirmation.`,
      inputSchema: {
        decision: z.string().min(5).describe("The decision that was made"),
        rationale: z.string().optional().describe("Why — context, tradeoffs, alternatives considered"),
        affected_files: z.array(z.string()).optional().describe("Files impacted by this decision"),
        tags: z.array(z.string()).optional().describe("Tags for categorization"),
        status: z.enum(["active", "experimental"]).default("active"),
        supersedes: z.number().int().optional().describe("ID of a previous decision this replaces"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ decision, rationale, affected_files, tags, status, supersedes }) => {
      const db = getDb();
      const timestamp = now();
      const sessionId = getCurrentSessionId();

      // If superseding, mark old decision
      if (supersedes) {
        db.prepare("UPDATE decisions SET status = 'superseded', superseded_by = NULL WHERE id = ?")
          .run(supersedes);
      }

      const result = db.prepare(
        "INSERT INTO decisions (session_id, timestamp, decision, rationale, affected_files, tags, status, superseded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        sessionId, timestamp, decision,
        rationale || null,
        affected_files ? JSON.stringify(affected_files) : null,
        tags ? JSON.stringify(tags) : null,
        status,
        supersedes || null
      );

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            decision_id: result.lastInsertRowid,
            message: `Decision #${result.lastInsertRowid} recorded${supersedes ? ` (supersedes #${supersedes})` : ""}.`,
            decision,
          }, null, 2),
        }],
      };
    }
  );

  server.registerTool(
    `${TOOL_PREFIX}_get_decisions`,
    {
      title: "Get Decisions",
      description: `Retrieve recorded architectural decisions. Filter by status, tags, or affected files.

Args:
  - status (string, optional): Filter by status — "active", "superseded", "deprecated", "experimental"
  - tag (string, optional): Filter by tag
  - file_path (string, optional): Find decisions affecting a specific file
  - limit (number, optional): Max results (default 20)

Returns:
  Array of decisions with rationale and metadata.`,
      inputSchema: {
        status: z.enum(["active", "superseded", "deprecated", "experimental"]).optional(),
        tag: z.string().optional().describe("Filter by tag"),
        file_path: z.string().optional().describe("Find decisions affecting this file"),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ status, tag, file_path, limit }) => {
      const db = getDb();
      let query = "SELECT * FROM decisions WHERE 1=1";
      const params: unknown[] = [];

      if (status) { query += " AND status = ?"; params.push(status); }
      if (tag) { query += " AND tags LIKE ?"; params.push(`%${tag}%`); }
      if (file_path) { query += " AND affected_files LIKE ?"; params.push(`%${file_path}%`); }

      query += " ORDER BY timestamp DESC LIMIT ?";
      params.push(limit);

      const decisions = db.prepare(query).all(...params) as unknown[] as DecisionRow[];

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ count: decisions.length, decisions }, null, 2),
        }],
      };
    }
  );

  server.registerTool(
    `${TOOL_PREFIX}_update_decision`,
    {
      title: "Update Decision Status",
      description: `Update the status of an existing decision. Use to deprecate, supersede, or reactivate decisions.

Args:
  - id (number): Decision ID to update
  - status: "active" | "superseded" | "deprecated" | "experimental"

Returns:
  Confirmation.`,
      inputSchema: {
        id: z.number().int().describe("Decision ID"),
        status: z.enum(["active", "superseded", "deprecated", "experimental"]),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, status }) => {
      const db = getDb();
      const result = db.prepare("UPDATE decisions SET status = ? WHERE id = ?").run(status, id);
      if (result.changes === 0) {
        return { isError: true, content: [{ type: "text", text: `Decision #${id} not found.` }] };
      }
      return { content: [{ type: "text", text: `Decision #${id} status updated to "${status}".` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // FILE NOTES
  // ═══════════════════════════════════════════════════════════════════════

  server.registerTool(
    `${TOOL_PREFIX}_set_file_notes`,
    {
      title: "Set File Notes",
      description: `Store persistent notes about a file: its purpose, dependencies, architectural layer, complexity, and any important details. This creates a knowledge base that eliminates the need to re-read and re-analyze files across sessions.

Args:
  - file_path (string): Relative path to the file
  - purpose (string, optional): What this file does — its responsibility
  - dependencies (array, optional): Files this file depends on
  - dependents (array, optional): Files that depend on this file
  - layer: "ui" | "viewmodel" | "domain" | "data" | "network" | "database" | "di" | "util" | "test" | "config" | "build" | "other"
  - complexity: "trivial" | "simple" | "moderate" | "complex" | "critical"
  - notes (string, optional): Any important context, gotchas, or warnings

Returns:
  Confirmation.`,
      inputSchema: {
        file_path: z.string().describe("Relative path to the file"),
        purpose: z.string().optional().describe("What this file does"),
        dependencies: z.array(z.string()).optional().describe("Files this depends on"),
        dependents: z.array(z.string()).optional().describe("Files that depend on this"),
        layer: z.enum(["ui", "viewmodel", "domain", "data", "network", "database", "di", "util", "test", "config", "build", "other"]).optional(),
        complexity: z.enum(["trivial", "simple", "moderate", "complex", "critical"]).optional(),
        notes: z.string().optional().describe("Important context, gotchas, warnings"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ file_path, purpose, dependencies, dependents, layer, complexity, notes }) => {
      const db = getDb();
      const timestamp = now();
      const sessionId = getCurrentSessionId();

      db.prepare(`
        INSERT INTO file_notes (file_path, purpose, dependencies, dependents, layer, last_reviewed, last_modified_session, notes, complexity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
          purpose = COALESCE(?, purpose),
          dependencies = COALESCE(?, dependencies),
          dependents = COALESCE(?, dependents),
          layer = COALESCE(?, layer),
          last_reviewed = ?,
          last_modified_session = COALESCE(?, last_modified_session),
          notes = COALESCE(?, notes),
          complexity = COALESCE(?, complexity)
      `).run(
        file_path,
        purpose || null,
        dependencies ? JSON.stringify(dependencies) : null,
        dependents ? JSON.stringify(dependents) : null,
        layer || null,
        timestamp,
        sessionId,
        notes || null,
        complexity || null,
        // Update values
        purpose || null,
        dependencies ? JSON.stringify(dependencies) : null,
        dependents ? JSON.stringify(dependents) : null,
        layer || null,
        timestamp,
        sessionId,
        notes || null,
        complexity || null,
      );

      return {
        content: [{ type: "text", text: `File notes saved for ${file_path}.` }],
      };
    }
  );

  server.registerTool(
    `${TOOL_PREFIX}_get_file_notes`,
    {
      title: "Get File Notes",
      description: `Retrieve stored notes for one or more files. Use to quickly understand a file's purpose and context without reading it.

Args:
  - file_path (string, optional): Specific file to query
  - layer (string, optional): Filter by architectural layer
  - complexity (string, optional): Filter by complexity level

Returns:
  File notes with purpose, dependencies, layer, and complexity.`,
      inputSchema: {
        file_path: z.string().optional().describe("Specific file to query"),
        layer: z.enum(["ui", "viewmodel", "domain", "data", "network", "database", "di", "util", "test", "config", "build", "other"]).optional(),
        complexity: z.enum(["trivial", "simple", "moderate", "complex", "critical"]).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ file_path, layer, complexity }) => {
      const db = getDb();

      if (file_path) {
        const note = db.prepare("SELECT * FROM file_notes WHERE file_path = ?").get(file_path);
        return { content: [{ type: "text", text: JSON.stringify(note || { message: "No notes found for this file." }, null, 2) }] };
      }

      let query = "SELECT * FROM file_notes WHERE 1=1";
      const params: unknown[] = [];
      if (layer) { query += " AND layer = ?"; params.push(layer); }
      if (complexity) { query += " AND complexity = ?"; params.push(complexity); }
      query += " ORDER BY file_path";

      const notes = db.prepare(query).all(...params) as unknown[] as FileNoteRow[];
      return { content: [{ type: "text", text: JSON.stringify({ count: notes.length, files: notes }, null, 2) }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // CONVENTIONS
  // ═══════════════════════════════════════════════════════════════════════

  server.registerTool(
    `${TOOL_PREFIX}_add_convention`,
    {
      title: "Add Convention",
      description: `Record a project convention that the agent should always follow. Conventions are surfaced during start_session and serve as persistent rules.

Args:
  - category: "naming" | "architecture" | "styling" | "testing" | "git" | "documentation" | "error_handling" | "performance" | "security" | "other"
  - rule (string): The convention rule in clear, actionable language
  - examples (array of strings, optional): Code or usage examples

Returns:
  Convention ID and confirmation.`,
      inputSchema: {
        category: z.enum(["naming", "architecture", "styling", "testing", "git", "documentation", "error_handling", "performance", "security", "other"]),
        rule: z.string().min(5).describe("The convention rule"),
        examples: z.array(z.string()).optional().describe("Examples of the convention in use"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ category, rule, examples }) => {
      const db = getDb();
      const timestamp = now();
      const sessionId = getCurrentSessionId();

      const result = db.prepare(
        "INSERT INTO conventions (session_id, timestamp, category, rule, examples) VALUES (?, ?, ?, ?, ?)"
      ).run(sessionId, timestamp, category, rule, examples ? JSON.stringify(examples) : null);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            convention_id: result.lastInsertRowid,
            message: `Convention #${result.lastInsertRowid} added to [${category}].`,
            rule,
          }, null, 2),
        }],
      };
    }
  );

  server.registerTool(
    `${TOOL_PREFIX}_get_conventions`,
    {
      title: "Get Conventions",
      description: `Retrieve all active project conventions. Optionally filter by category.

Args:
  - category (string, optional): Filter by convention category
  - include_disabled (boolean, optional): Include unenforced conventions (default: false)

Returns:
  Array of conventions grouped by category.`,
      inputSchema: {
        category: z.enum(["naming", "architecture", "styling", "testing", "git", "documentation", "error_handling", "performance", "security", "other"]).optional(),
        include_disabled: z.boolean().default(false),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ category, include_disabled }) => {
      const db = getDb();
      let query = "SELECT * FROM conventions WHERE 1=1";
      const params: unknown[] = [];

      if (!include_disabled) { query += " AND enforced = 1"; }
      if (category) { query += " AND category = ?"; params.push(category); }
      query += " ORDER BY category, id";

      const conventions = db.prepare(query).all(...params) as unknown[] as ConventionRow[];

      // Group by category
      const grouped: Record<string, ConventionRow[]> = {};
      for (const c of conventions) {
        if (!grouped[c.category]) grouped[c.category] = [];
        grouped[c.category].push(c);
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ total: conventions.length, by_category: grouped }, null, 2),
        }],
      };
    }
  );

  server.registerTool(
    `${TOOL_PREFIX}_toggle_convention`,
    {
      title: "Toggle Convention",
      description: `Enable or disable a convention. Disabled conventions are not surfaced during start_session.

Args:
  - id (number): Convention ID
  - enforced (boolean): Whether the convention should be enforced

Returns:
  Confirmation.`,
      inputSchema: {
        id: z.number().int().describe("Convention ID"),
        enforced: z.boolean().describe("Enable or disable"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, enforced }) => {
      const db = getDb();
      const result = db.prepare("UPDATE conventions SET enforced = ? WHERE id = ?").run(enforced ? 1 : 0, id);
      if (result.changes === 0) {
        return { isError: true, content: [{ type: "text", text: `Convention #${id} not found.` }] };
      }
      return { content: [{ type: "text", text: `Convention #${id} ${enforced ? "enabled" : "disabled"}.` }] };
    }
  );
}
