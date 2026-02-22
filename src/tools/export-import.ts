// ============================================================================
// Engram MCP Server — Export & Import Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { getDb, now, getProjectRoot } from "../database.js";
import { TOOL_PREFIX, DB_DIR_NAME, SERVER_VERSION } from "../constants.js";

export function registerExportImportTools(server: McpServer): void {
    // ─── EXPORT MEMORY ──────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_export`,
        {
            title: "Export Memory",
            description: `Export the entire memory database as a portable JSON file. Useful for backup, migration, or sharing project knowledge with teammates.

Args:
  - output_path (string, optional): Where to save the export (default: .engram/export.json)

Returns:
  Export file path and summary.`,
            inputSchema: {
                output_path: z.string().optional().describe("Export file path"),
            },
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
        },
        async ({ output_path }) => {
            const db = getDb();
            const projectRoot = getProjectRoot();

            const exportData = {
                engram_version: SERVER_VERSION,
                exported_at: now(),
                project_root: projectRoot,
                sessions: db.prepare("SELECT * FROM sessions ORDER BY id").all(),
                changes: db.prepare("SELECT * FROM changes ORDER BY id").all(),
                decisions: db.prepare("SELECT * FROM decisions ORDER BY id").all(),
                file_notes: db.prepare("SELECT * FROM file_notes ORDER BY file_path").all(),
                conventions: db.prepare("SELECT * FROM conventions ORDER BY id").all(),
                tasks: db.prepare("SELECT * FROM tasks ORDER BY id").all(),
                milestones: db.prepare("SELECT * FROM milestones ORDER BY id").all(),
            };

            const filePath = output_path || path.join(projectRoot, DB_DIR_NAME, "export.json");
            fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2));

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        exported_to: filePath,
                        counts: {
                            sessions: (exportData.sessions as unknown[]).length,
                            changes: (exportData.changes as unknown[]).length,
                            decisions: (exportData.decisions as unknown[]).length,
                            file_notes: (exportData.file_notes as unknown[]).length,
                            conventions: (exportData.conventions as unknown[]).length,
                            tasks: (exportData.tasks as unknown[]).length,
                            milestones: (exportData.milestones as unknown[]).length,
                        },
                    }, null, 2),
                }],
            };
        }
    );

    // ─── IMPORT MEMORY ──────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_import`,
        {
            title: "Import Memory",
            description: `Import memory from a previously exported JSON file. Merges data into the existing database without duplicating existing records.

Args:
  - input_path (string): Path to the export JSON file
  - dry_run (boolean, optional): Preview import without writing (default: true)

Returns:
  Import summary with counts.`,
            inputSchema: {
                input_path: z.string().describe("Path to export JSON file"),
                dry_run: z.boolean().default(true).describe("Preview mode"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
        },
        async ({ input_path, dry_run }) => {
            const projectRoot = getProjectRoot();
            const filePath = path.isAbsolute(input_path) ? input_path : path.join(projectRoot, input_path);

            if (!fs.existsSync(filePath)) {
                return { isError: true, content: [{ type: "text", text: `File not found: ${filePath}` }] };
            }

            let importData: Record<string, unknown[]>;
            try {
                importData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            } catch (e) {
                return { isError: true, content: [{ type: "text", text: `Invalid JSON: ${e}` }] };
            }

            const counts: Record<string, number> = {};
            for (const key of ["sessions", "changes", "decisions", "file_notes", "conventions", "tasks", "milestones"]) {
                counts[key] = Array.isArray(importData[key]) ? importData[key].length : 0;
            }

            if (dry_run) {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            dry_run: true,
                            would_import: counts,
                            message: "Run with dry_run=false to execute the import.",
                        }, null, 2),
                    }],
                };
            }

            const db = getDb();

            const importTransaction = db.transaction(() => {
                const sessionIdMap = new Map<number, number>();
                if (Array.isArray(importData.sessions)) {
                    for (const s of importData.sessions as Array<Record<string, unknown>>) {
                        const exists = db.prepare(
                            "SELECT id FROM sessions WHERE started_at = ? AND agent_name = ?"
                        ).get(s.started_at, s.agent_name || "unknown") as { id: number } | undefined;
                        if (!exists) {
                            const result = db.prepare(
                                "INSERT INTO sessions (started_at, ended_at, summary, agent_name, project_root, tags) VALUES (?, ?, ?, ?, ?, ?)"
                            ).run(s.started_at, s.ended_at || null, s.summary || null, s.agent_name || "unknown", s.project_root || "", s.tags || null);
                            sessionIdMap.set(s.id as number, result.lastInsertRowid as number);
                        } else {
                            sessionIdMap.set(s.id as number, exists.id);
                        }
                    }
                }

                if (Array.isArray(importData.changes)) {
                    for (const c of importData.changes as Array<Record<string, unknown>>) {
                        const exists = db.prepare(
                            "SELECT id FROM changes WHERE file_path = ? AND timestamp = ? AND description = ?"
                        ).get(c.file_path, c.timestamp, c.description);
                        if (!exists) {
                            const mappedSessionId = c.session_id ? (sessionIdMap.get(c.session_id as number) ?? c.session_id) : null;
                            db.prepare(
                                "INSERT INTO changes (session_id, timestamp, file_path, change_type, description, diff_summary, impact_scope) VALUES (?, ?, ?, ?, ?, ?, ?)"
                            ).run(mappedSessionId, c.timestamp, c.file_path, c.change_type, c.description, c.diff_summary || null, c.impact_scope || "local");
                        }
                    }
                }

                if (Array.isArray(importData.conventions)) {
                    for (const c of importData.conventions as Array<Record<string, unknown>>) {
                        const exists = db.prepare("SELECT id FROM conventions WHERE rule = ?").get(c.rule);
                        if (!exists) {
                            db.prepare(
                                "INSERT INTO conventions (timestamp, category, rule, examples, enforced) VALUES (?, ?, ?, ?, ?)"
                            ).run(c.timestamp || now(), c.category, c.rule, c.examples || null, c.enforced ?? 1);
                        }
                    }
                }

                if (Array.isArray(importData.decisions)) {
                    for (const d of importData.decisions as Array<Record<string, unknown>>) {
                        const exists = db.prepare("SELECT id FROM decisions WHERE decision = ?").get(d.decision);
                        if (!exists) {
                            db.prepare(
                                "INSERT INTO decisions (timestamp, decision, rationale, affected_files, tags, status) VALUES (?, ?, ?, ?, ?, ?)"
                            ).run(d.timestamp || now(), d.decision, d.rationale || null, d.affected_files || null, d.tags || null, d.status || "active");
                        }
                    }
                }

                if (Array.isArray(importData.file_notes)) {
                    for (const f of importData.file_notes as Array<Record<string, unknown>>) {
                        db.prepare(`
              INSERT OR REPLACE INTO file_notes (file_path, purpose, dependencies, dependents, layer, last_reviewed, notes, complexity)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(f.file_path, f.purpose || null, f.dependencies || null, f.dependents || null, f.layer || null, f.last_reviewed || now(), f.notes || null, f.complexity || null);
                    }
                }

                if (Array.isArray(importData.milestones)) {
                    for (const m of importData.milestones as Array<Record<string, unknown>>) {
                        const exists = db.prepare("SELECT id FROM milestones WHERE title = ? AND timestamp = ?").get(m.title, m.timestamp);
                        if (!exists) {
                            db.prepare(
                                "INSERT INTO milestones (timestamp, title, description, version, tags) VALUES (?, ?, ?, ?, ?)"
                            ).run(m.timestamp || now(), m.title, m.description || null, m.version || null, m.tags || null);
                        }
                    }
                }
            });

            importTransaction();

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({ imported: counts, message: "Import complete. Duplicates were skipped." }, null, 2),
                }],
            };
        }
    );
}
