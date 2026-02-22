// ============================================================================
// Engram MCP Server — File Notes Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, now, getCurrentSessionId } from "../database.js";
import { TOOL_PREFIX } from "../constants.js";
import type { FileNoteRow } from "../types.js";

export function registerFileNoteTools(server: McpServer): void {
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
}
