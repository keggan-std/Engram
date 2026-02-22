// ============================================================================
// Engram MCP Server — File Notes Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { now, getCurrentSessionId, getRepos } from "../database.js";
import { TOOL_PREFIX } from "../constants.js";
import { normalizePath } from "../utils.js";
import { success } from "../response.js";

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
            const repos = getRepos();
            const timestamp = now();
            const sessionId = getCurrentSessionId();
            const fp = normalizePath(file_path);

            repos.fileNotes.upsert(fp, timestamp, sessionId, {
                purpose, dependencies, dependents, layer, complexity, notes,
            });

            return success({ message: `File notes saved for ${fp}.` });
        }
    );

    // ─── BATCH SET FILE NOTES ────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_set_file_notes_batch`,
        {
            title: "Set File Notes (Batch)",
            description: `Store persistent notes for multiple files in a single call. Atomic — either all succeed or none. Ideal after analyzing multiple files.

Args:
  - files (array, 1-100): Array of file note objects, each with:
    - file_path (string): Relative path to the file
    - purpose (string, optional): What this file does
    - dependencies (array, optional): Files this depends on
    - dependents (array, optional): Files that depend on this
    - layer (string, optional): Architectural layer
    - complexity (string, optional): Complexity level
    - notes (string, optional): Important context

Returns:
  Confirmation with count.`,
            inputSchema: {
                files: z.array(z.object({
                    file_path: z.string().describe("Relative path to the file"),
                    purpose: z.string().optional(),
                    dependencies: z.array(z.string()).optional(),
                    dependents: z.array(z.string()).optional(),
                    layer: z.enum(["ui", "viewmodel", "domain", "data", "network", "database", "di", "util", "test", "config", "build", "other"]).optional(),
                    complexity: z.enum(["trivial", "simple", "moderate", "complex", "critical"]).optional(),
                    notes: z.string().optional(),
                })).min(1).max(100).describe("Array of file note entries"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ files }) => {
            const repos = getRepos();
            const timestamp = now();
            const sessionId = getCurrentSessionId();

            const count = repos.fileNotes.upsertBatch(files, timestamp, sessionId);

            return success({
                message: `Batch saved ${count} file note(s).`,
                count,
            });
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
            const repos = getRepos();

            if (file_path) {
                const note = repos.fileNotes.getByPath(file_path);
                return success(note ? (note as unknown as Record<string, unknown>) : { message: "No notes found for this file." });
            }

            const notes = repos.fileNotes.getFiltered({ layer, complexity });
            return success({ count: notes.length, files: notes });
        }
    );
}
