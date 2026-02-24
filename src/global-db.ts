// ============================================================================
// Engram MCP Server — Global Knowledge Base
// ============================================================================
//
// A lightweight cross-project knowledge store at ~/.engram/global.db
// Stores decisions and conventions that agents choose to share globally.
// Completely separate from the per-project .engram/memory.db.
//
// ============================================================================

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import os from "os";
import { log } from "./logger.js";

const GLOBAL_DB_DIR = path.join(os.homedir(), ".engram");
const GLOBAL_DB_PATH = path.join(GLOBAL_DB_DIR, "global.db");

let _globalDb: InstanceType<typeof Database> | null = null;

export function getGlobalDb(): InstanceType<typeof Database> | null {
    if (_globalDb) return _globalDb;
    try {
        if (!fs.existsSync(GLOBAL_DB_DIR)) {
            fs.mkdirSync(GLOBAL_DB_DIR, { recursive: true });
        }
        const db = new Database(GLOBAL_DB_PATH);
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");
        initGlobalSchema(db);
        _globalDb = db;
        return _globalDb;
    } catch (e) {
        log.warn(`Global KB unavailable: ${e}`);
        return null;
    }
}

function initGlobalSchema(db: InstanceType<typeof Database>): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS global_decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_root TEXT NOT NULL,
            decision TEXT NOT NULL,
            rationale TEXT,
            tags TEXT,
            timestamp TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_gdec_project ON global_decisions(project_root);
        CREATE INDEX IF NOT EXISTS idx_gdec_time ON global_decisions(timestamp DESC);

        CREATE TABLE IF NOT EXISTS global_conventions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_root TEXT NOT NULL,
            category TEXT NOT NULL,
            rule TEXT NOT NULL,
            timestamp TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_gconv_project ON global_conventions(project_root);

        -- FTS5 for global decisions
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_global_decisions USING fts5(
            decision, rationale, tags,
            content='global_decisions', content_rowid='id'
        );
        CREATE TRIGGER IF NOT EXISTS trg_gdec_ai AFTER INSERT ON global_decisions BEGIN
            INSERT INTO fts_global_decisions(rowid, decision, rationale, tags)
            VALUES (new.id, new.decision, new.rationale, new.tags);
        END;
    `);
}

export interface GlobalDecisionInput {
    projectRoot: string;
    decision: string;
    rationale?: string | null;
    tags?: string[] | null;
    timestamp: string;
}

export function writeGlobalDecision(input: GlobalDecisionInput): number | null {
    const db = getGlobalDb();
    if (!db) return null;
    try {
        const result = db.prepare(
            "INSERT INTO global_decisions (project_root, decision, rationale, tags, timestamp) VALUES (?, ?, ?, ?, ?)"
        ).run(
            input.projectRoot, input.decision,
            input.rationale ?? null,
            input.tags ? JSON.stringify(input.tags) : null,
            input.timestamp
        );
        return result.lastInsertRowid as number;
    } catch (e) {
        log.warn(`Failed to write global decision: ${e}`);
        return null;
    }
}

export function writeGlobalConvention(projectRoot: string, category: string, rule: string, timestamp: string): number | null {
    const db = getGlobalDb();
    if (!db) return null;
    try {
        const result = db.prepare(
            "INSERT INTO global_conventions (project_root, category, rule, timestamp) VALUES (?, ?, ?, ?)"
        ).run(projectRoot, category, rule, timestamp);
        return result.lastInsertRowid as number;
    } catch (e) {
        log.warn(`Failed to write global convention: ${e}`);
        return null;
    }
}

export interface GlobalDecisionRow {
    id: number;
    project_root: string;
    decision: string;
    rationale: string | null;
    tags: string | null;
    timestamp: string;
}

export interface GlobalConventionRow {
    id: number;
    project_root: string;
    category: string;
    rule: string;
    timestamp: string;
}

export function queryGlobalDecisions(query?: string, limit: number = 20): GlobalDecisionRow[] {
    const db = getGlobalDb();
    if (!db) return [];
    try {
        if (query && query.trim().length > 0) {
            const words = query.trim().split(/\s+/).filter(w => w.length > 2).slice(0, 6);
            const ftsQ = words.map(w => `"${w.replace(/"/g, "")}"`).join(" OR ");
            try {
                return db.prepare(`
                    WITH ranked AS (SELECT rowid, rank FROM fts_global_decisions WHERE fts_global_decisions MATCH ?)
                    SELECT d.* FROM global_decisions d JOIN ranked ON ranked.rowid = d.id
                    ORDER BY ranked.rank LIMIT ?
                `).all(ftsQ, limit) as GlobalDecisionRow[];
            } catch { /* FTS unavailable */ }
        }
        return db.prepare(
            "SELECT * FROM global_decisions ORDER BY timestamp DESC LIMIT ?"
        ).all(limit) as GlobalDecisionRow[];
    } catch {
        return [];
    }
}

export function queryGlobalConventions(limit: number = 50): GlobalConventionRow[] {
    const db = getGlobalDb();
    if (!db) return [];
    try {
        return db.prepare(
            "SELECT * FROM global_conventions ORDER BY timestamp DESC LIMIT ?"
        ).all(limit) as GlobalConventionRow[];
    } catch {
        return [];
    }
}
