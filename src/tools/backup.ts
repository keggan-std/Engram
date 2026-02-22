// ============================================================================
// Engram MCP Server — Backup & Restore Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { getDb, now, getProjectRoot, getDbPath, backupDatabase } from "../database.js";
import { TOOL_PREFIX, DB_DIR_NAME, BACKUP_DIR_NAME, MAX_BACKUP_COUNT } from "../constants.js";
import { log } from "../logger.js";
import { success, error } from "../response.js";
import type { BackupInfo } from "../types.js";

export function registerBackupTools(server: McpServer): void {
    // ─── BACKUP DATABASE ───────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_backup`,
        {
            title: "Backup Database",
            description: `Create a backup of the Engram memory database. Uses SQLite's native backup API for safe, consistent copies. Save to any path — including cloud-synced folders (Dropbox, OneDrive, Google Drive) for cross-machine portability.

Args:
  - output_path (string, optional): Where to save the backup (default: .engram/backups/memory-{timestamp}.db)
  - prune_old (boolean, optional): Remove old backups beyond the max count (default: true)

Returns:
  BackupInfo with path, size, and timestamp.`,
            inputSchema: {
                output_path: z.string().optional().describe("Custom backup destination path"),
                prune_old: z.boolean().default(true).describe("Prune old backups beyond the max count"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true,
            },
        },
        async ({ output_path, prune_old }) => {
            const backupPath = backupDatabase(output_path);

            const stats = fs.statSync(backupPath);
            const sizeKb = Math.round(stats.size / 1024);

            let dbVersion = 0;
            try {
                const db = getDb();
                const vRow = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string } | undefined;
                dbVersion = vRow ? parseInt(vRow.value, 10) : 0;
            } catch { /* skip */ }

            const info: BackupInfo & { pruned?: number } = {
                path: backupPath,
                size_kb: sizeKb,
                created_at: now(),
                database_version: dbVersion,
            };

            if (prune_old && !output_path) {
                const backupDir = path.join(getProjectRoot(), DB_DIR_NAME, BACKUP_DIR_NAME);
                try {
                    const files = fs.readdirSync(backupDir)
                        .filter(f => f.startsWith("memory-") && f.endsWith(".db"))
                        .map(f => ({
                            name: f,
                            path: path.join(backupDir, f),
                            mtime: fs.statSync(path.join(backupDir, f)).mtimeMs,
                        }))
                        .sort((a, b) => b.mtime - a.mtime);

                    if (files.length > MAX_BACKUP_COUNT) {
                        const toDelete = files.slice(MAX_BACKUP_COUNT);
                        for (const f of toDelete) {
                            fs.unlinkSync(f.path);
                        }
                        info.pruned = toDelete.length;
                    }
                } catch { /* skip pruning */ }
            }

            return success({
                ...info,
                message: `Backup created successfully at ${backupPath} (${sizeKb} KB).`,
            });
        }
    );

    // ─── RESTORE DATABASE ──────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_restore`,
        {
            title: "Restore Database",
            description: `Restore the Engram memory database from a backup file. Creates a safety backup of the current database before overwriting. The MCP server will need to be restarted after restore.

Args:
  - input_path (string): Path to the backup .db file
  - confirm (string): Must be "yes-restore" to execute

Returns:
  Confirmation and instructions to restart.`,
            inputSchema: {
                input_path: z.string().describe("Path to the backup .db file"),
                confirm: z.string().describe('Type "yes-restore" to confirm'),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: true,
            },
        },
        async ({ input_path, confirm }) => {
            if (confirm !== "yes-restore") {
                return error('Safety check: set confirm to "yes-restore" to proceed.');
            }

            const projectRoot = getProjectRoot();
            const inputPath = path.isAbsolute(input_path) ? input_path : path.join(projectRoot, input_path);

            if (!fs.existsSync(inputPath)) {
                return error(`Backup file not found: ${inputPath}`);
            }

            let safetyBackupPath = "";
            try {
                safetyBackupPath = backupDatabase();
                log.info(`Safety backup created before restore: ${safetyBackupPath}`);
            } catch (e) {
                return error(`Failed to create safety backup before restore: ${e}. Aborting.`);
            }

            const dbPath = getDbPath();
            try {
                fs.copyFileSync(inputPath, dbPath);
            } catch (e) {
                return error(`Failed to restore: ${e}. Your previous database is backed up at ${safetyBackupPath}.`);
            }

            return success({
                restored_from: inputPath,
                safety_backup: safetyBackupPath,
                message: "Database restored successfully. Please RESTART the MCP server to load the restored database. A safety backup of the previous database was created.",
            });
        }
    );

    // ─── LIST BACKUPS ──────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_list_backups`,
        {
            title: "List Backups",
            description: `List all available backup files in the default backup directory.

Returns:
  Array of backup files with sizes and timestamps.`,
            inputSchema: {},
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async () => {
            const backupDir = path.join(getProjectRoot(), DB_DIR_NAME, BACKUP_DIR_NAME);

            if (!fs.existsSync(backupDir)) {
                return success({ backups: [], message: "No backups found." });
            }

            const files = fs.readdirSync(backupDir)
                .filter(f => f.endsWith(".db"))
                .map(f => {
                    const fullPath = path.join(backupDir, f);
                    const stats = fs.statSync(fullPath);
                    return {
                        filename: f,
                        path: fullPath,
                        size_kb: Math.round(stats.size / 1024),
                        created_at: stats.mtime.toISOString(),
                    };
                })
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

            return success({
                backup_directory: backupDir,
                count: files.length,
                backups: files,
            });
        }
    );
}
