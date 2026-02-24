// ============================================================================
// Engram MCP Server — File Notes Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { now, getCurrentSessionId, getRepos, getProjectRoot, getDb } from "../database.js";
import { TOOL_PREFIX, FILE_MTIME_STALE_HOURS, FILE_LOCK_DEFAULT_TIMEOUT_MINUTES } from "../constants.js";
import { normalizePath, getFileMtime, coerceStringArray } from "../utils.js";
import { success } from "../response.js";
import type { FileNoteRow, FileNoteConfidence, FileNoteWithStaleness } from "../types.js";

// ─── File Lock Helpers ────────────────────────────────────────────────────────

interface FileLockRow {
  file_path: string;
  agent_id: string;
  reason: string | null;
  locked_at: number;
  expires_at: number;
}

/** Returns the active (non-expired) lock for a file, or null. */
function getActiveLock(file_path: string): FileLockRow | null {
  const db = getDb();
  const now_ms = Date.now();
  /* best-effort — table may not exist in older DBs */
  try {
    const row = db.prepare(
      "SELECT * FROM file_locks WHERE file_path = ? AND expires_at > ?"
    ).get(file_path, now_ms) as FileLockRow | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

/** Purges all expired locks (best-effort cleanup on every write). */
function purgeExpiredLocks(): void {
  try {
    getDb().prepare("DELETE FROM file_locks WHERE expires_at <= ?").run(Date.now());
  } catch { /* best effort */ }
}

/** Acquires or refreshes a soft lock for the given file. */
function acquireSoftLock(file_path: string, agent_id: string, timeout_minutes: number): void {
  try {
    const now_ms = Date.now();
    const expires_at = now_ms + timeout_minutes * 60_000;
    getDb().prepare(
      `INSERT INTO file_locks (file_path, agent_id, reason, locked_at, expires_at)
       VALUES (?, ?, 'soft-lock: set_file_notes', ?, ?)
       ON CONFLICT(file_path) DO UPDATE SET
         agent_id = excluded.agent_id,
         reason = excluded.reason,
         locked_at = excluded.locked_at,
         expires_at = excluded.expires_at`
    ).run(file_path, agent_id, now_ms, expires_at);
  } catch { /* best effort */ }
}

// ─── Staleness Helpers ────────────────────────────────────────────────────────

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

            purgeExpiredLocks();

            // Capture the file's actual mtime so future retrievals can detect staleness
            const file_mtime = getFileMtime(fp, getProjectRoot());

            repos.fileNotes.upsert(fp, timestamp, sessionId, {
                purpose, dependencies, dependents, layer, complexity, notes, file_mtime,
            });

            // Acquire a soft lock so concurrent agents see this file is being worked on
            const agentId = `session-${sessionId ?? "unknown"}`;
            acquireSoftLock(fp, agentId, FILE_LOCK_DEFAULT_TIMEOUT_MINUTES);

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
                const fp = normalizePath(file_path);
                const note = repos.fileNotes.getByPath(fp);
                if (!note) {
                    const lock = getActiveLock(fp);
                    return success({
                        message: "No notes found for this file.",
                        lock_status: lock ? {
                            locked: true,
                            agent_id: lock.agent_id,
                            reason: lock.reason,
                            locked_ago_minutes: Math.round((Date.now() - lock.locked_at) / 60_000),
                            expires_in_minutes: Math.round((lock.expires_at - Date.now()) / 60_000),
                        } : { locked: false },
                    });
                }
                const enriched = withStaleness(note, projectRoot);
                const lock = getActiveLock(fp);
                return success({
                    ...enriched as unknown as Record<string, unknown>,
                    lock_status: lock ? {
                        locked: true,
                        agent_id: lock.agent_id,
                        reason: lock.reason,
                        locked_ago_minutes: Math.round((Date.now() - lock.locked_at) / 60_000),
                        expires_in_minutes: Math.round((lock.expires_at - Date.now()) / 60_000),
                    } : { locked: false },
                });
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

    // ─── LOCK FILE ───────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_lock_file`,
        {
            title: "Lock File",
            description: `Declare intent to modify a file, preventing concurrent agents from writing to it simultaneously. Call this BEFORE editing a file you will modify. Other agents calling engram_get_file_notes on a locked file will see a lock_status warning. The lock auto-expires to prevent deadlocks.

Args:
  - file_path (string): Relative path to the file to lock
  - agent_id (string): Your agent identifier (e.g. "claude-code", "background-agent-1")
  - reason (string, optional): What you are about to do (e.g. "refactoring auth flow")
  - timeout_minutes (number, optional): Lock duration in minutes (default: 30, max: 120)

Returns:
  Confirmation with lock details, or a conflict if already locked by another agent.`,
            inputSchema: {
                file_path: z.string().describe("Relative path to the file to lock"),
                agent_id: z.string().describe("Your agent identifier"),
                reason: z.string().optional().describe("What you are about to do with this file"),
                timeout_minutes: z.number().int().min(1).max(120).default(FILE_LOCK_DEFAULT_TIMEOUT_MINUTES),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
        async ({ file_path, agent_id, reason, timeout_minutes }) => {
            purgeExpiredLocks();
            const fp = normalizePath(file_path);

            // Check for an existing lock by a different agent
            const existing = getActiveLock(fp);
            if (existing && existing.agent_id !== agent_id) {
                return success({
                    locked: false,
                    conflict: true,
                    message: `CONFLICT: ${fp} is already locked by "${existing.agent_id}". Reason: ${existing.reason ?? "none"}. Locked ${Math.round((Date.now() - existing.locked_at) / 60_000)} min ago, expires in ${Math.round((existing.expires_at - Date.now()) / 60_000)} min. Wait or coordinate before editing.`,
                    current_owner: existing.agent_id,
                    expires_in_minutes: Math.round((existing.expires_at - Date.now()) / 60_000),
                });
            }

            const now_ms = Date.now();
            const expires_at = now_ms + timeout_minutes * 60_000;
            try {
                getDb().prepare(
                    `INSERT INTO file_locks (file_path, agent_id, reason, locked_at, expires_at)
                     VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT(file_path) DO UPDATE SET
                       agent_id = excluded.agent_id,
                       reason = excluded.reason,
                       locked_at = excluded.locked_at,
                       expires_at = excluded.expires_at`
                ).run(fp, agent_id, reason ?? null, now_ms, expires_at);
            } catch (e) {
                return success({ locked: false, message: `Failed to acquire lock: ${e}` });
            }

            return success({
                locked: true,
                file_path: fp,
                agent_id,
                reason: reason ?? null,
                expires_in_minutes: timeout_minutes,
                message: `Lock acquired on ${fp} by "${agent_id}" for ${timeout_minutes} min. Call engram_unlock_file when done.`,
            });
        }
    );

    // ─── UNLOCK FILE ─────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_unlock_file`,
        {
            title: "Unlock File",
            description: `Release a file lock acquired via engram_lock_file. Call this after finishing edits to a file. Locks auto-expire so this is a courtesy — but explicit unlocks let other agents proceed immediately.

Args:
  - file_path (string): Relative path to the file to unlock
  - agent_id (string): Your agent identifier (must match the lock owner)

Returns:
  Confirmation that the lock was released.`,
            inputSchema: {
                file_path: z.string().describe("Relative path to the file to unlock"),
                agent_id: z.string().describe("Your agent identifier (must match the lock owner)"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ file_path, agent_id }) => {
            const fp = normalizePath(file_path);
            const existing = getActiveLock(fp);

            if (!existing) {
                return success({ unlocked: true, message: `No active lock on ${fp} — nothing to release.` });
            }

            if (existing.agent_id !== agent_id) {
                return success({
                    unlocked: false,
                    message: `Cannot unlock: ${fp} is locked by "${existing.agent_id}", not "${agent_id}".`,
                });
            }

            try {
                getDb().prepare("DELETE FROM file_locks WHERE file_path = ?").run(fp);
            } catch (e) {
                return success({ unlocked: false, message: `Failed to release lock: ${e}` });
            }

            return success({
                unlocked: true,
                file_path: fp,
                message: `Lock on ${fp} released by "${agent_id}".`,
            });
        }
    );
}
