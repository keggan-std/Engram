// ============================================================================
// Engram MCP Server — File Notes Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { now, getCurrentSessionId, getRepos, getProjectRoot } from "../database.js";
import { TOOL_PREFIX, FILE_MTIME_STALE_HOURS } from "../constants.js";
import { normalizePath, getFileMtime, coerceStringArray } from "../utils.js";
import { success } from "../response.js";
import type { FileNoteRow, FileNoteConfidence, FileNoteWithStaleness } from "../types.js";

/**
 * Enrich a raw FileNoteRow with confidence and staleness information.
 *
 * Confidence levels:
 *  - "high"    — stored mtime matches current file mtime (notes are fresh)
 *  - "medium"  — file changed within FILE_MTIME_STALE_HOURS after notes were saved
 *  - "stale"   — file changed more than FILE_MTIME_STALE_HOURS ago
 *  - "unknown" — no stored mtime, or file not found on disk
 */
function withStaleness(note: FileNoteRow, projectRoot: string): FileNoteWithStaleness {
    if (note.file_mtime == null) {
        return { ...note, confidence: "unknown", stale: false };
    }

    const currentMtime = getFileMtime(note.file_path, projectRoot);
    if (currentMtime == null) {
        return { ...note, confidence: "unknown", stale: false };
    }

    const driftMs = currentMtime - note.file_mtime;
    if (driftMs <= 0) {
        return { ...note, confidence: "high", stale: false };
    }

    const driftHours = driftMs / 3_600_000;
    const confidence: FileNoteConfidence = driftHours > FILE_MTIME_STALE_HOURS ? "stale" : "medium";
    return {
        ...note,
        confidence,
        stale: true,
        staleness_hours: Math.round(driftHours),
    };
}

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
                dependencies: coerceStringArray().optional().describe("Files this depends on"),
                dependents: coerceStringArray().optional().describe("Files that depend on this"),
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

            // Capture the file's actual mtime so future retrievals can detect staleness
            const file_mtime = getFileMtime(fp, getProjectRoot());

            repos.fileNotes.upsert(fp, timestamp, sessionId, {
                purpose, dependencies, dependents, layer, complexity, notes, file_mtime,
            });

            return success({
                message: `File notes saved for ${fp}.`,
                file_mtime_captured: file_mtime !== null,
            });
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
                    dependencies: coerceStringArray().optional(),
                    dependents: coerceStringArray().optional(),
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
            const projectRoot = getProjectRoot();

            // Enrich each entry with the file's actual mtime before saving
            const enrichedFiles = files.map(f => ({
                ...f,
                file_mtime: getFileMtime(normalizePath(f.file_path), projectRoot),
            }));

            const count = repos.fileNotes.upsertBatch(enrichedFiles, timestamp, sessionId);

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
            const projectRoot = getProjectRoot();

            if (file_path) {
                const note = repos.fileNotes.getByPath(file_path);
                if (!note) return success({ message: "No notes found for this file." });
                const enriched = withStaleness(note, projectRoot);
                return success(enriched as unknown as Record<string, unknown>);
            }

            const notes = repos.fileNotes.getFiltered({ layer, complexity });
            const enriched = notes.map(n => withStaleness(n, projectRoot));
            const staleCount = enriched.filter(n => n.stale).length;
            return success({
                count: enriched.length,
                stale_count: staleCount,
                files: enriched,
            });
        }
    );
}
