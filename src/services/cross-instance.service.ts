// ============================================================================
// Engram MCP Server — Cross-Instance Query Service
// ============================================================================
// Opens read-only connections to other instances' databases for cross-instance
// memory queries. Respects sharing permissions and caches DB handles with TTL.
// ============================================================================

import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import * as fs from "fs";
import type { InstanceRegistryService } from "./instance-registry.service.js";
import type { InstanceEntry, CrossInstanceSearchResult, SharingMode } from "../types.js";
import { log } from "../logger.js";

// ─── Constants ───────────────────────────────────────────────────────

/** How long to keep a read-only DB handle before closing it (5 minutes) */
const DB_CACHE_TTL_MS = 5 * 60_000;

/** Maximum number of cached DB handles at once */
const MAX_CACHED_DBS = 10;

/** Tables that can be queried cross-instance */
const QUERYABLE_TABLES = new Set([
  "decisions",
  "conventions",
  "file_notes",
  "tasks",
  "sessions",
  "changes",
  "milestones",
]);

// ============================================================================
// Service
// ============================================================================

export class CrossInstanceService {
  private dbCache: Map<string, { db: DatabaseType; expires: number }> = new Map();

  constructor(private registry: InstanceRegistryService) {}

  // ─── Instance Discovery ────────────────────────────────────────────

  /**
   * List all instances with their stats and sharing config.
   * Enriches with live status from registry.
   */
  discoverInstances(includeStale = true): InstanceEntry[] {
    return this.registry.listInstances(includeStale);
  }

  // ─── Permission Checks ────────────────────────────────────────────

  /**
   * Verify that a target instance allows the requested query type.
   * Returns the instance entry if allowed, throws descriptive error if not.
   */
  private checkPermission(instanceId: string, queryType: string): InstanceEntry {
    const instances = this.registry.listInstances(true);
    const target = instances.find(i => i.instance_id === instanceId);

    if (!target) {
      throw new Error(`Instance '${instanceId}' not found in registry.`);
    }

    if (target.sharing_mode === "none") {
      throw new Error(
        `Instance '${target.label}' (${instanceId}) has sharing disabled. ` +
        `The owner must set sharing_mode to 'read' or 'full'.`
      );
    }

    if (!QUERYABLE_TABLES.has(queryType)) {
      throw new Error(
        `'${queryType}' is not a queryable type. Valid types: ${[...QUERYABLE_TABLES].join(", ")}`
      );
    }

    if (!target.sharing_types.includes(queryType)) {
      throw new Error(
        `Instance '${target.label}' does not share '${queryType}'. ` +
        `Shared types: ${target.sharing_types.join(", ")}`
      );
    }

    return target;
  }

  /**
   * Check whether a target instance allows importing (requires 'full' mode).
   */
  private checkImportPermission(instanceId: string, queryType: string): InstanceEntry {
    const target = this.checkPermission(instanceId, queryType);

    if (target.sharing_mode !== "full") {
      throw new Error(
        `Instance '${target.label}' has sharing_mode='${target.sharing_mode}'. ` +
        `Importing requires sharing_mode='full'.`
      );
    }

    return target;
  }

  // ─── Read-Only DB Access ──────────────────────────────────────────

  /**
   * Open a read-only connection to another instance's database.
   * Uses a cache with TTL to avoid excessive open/close cycles.
   */
  private openReadOnly(dbPath: string): DatabaseType | null {
    // Check cache
    const cached = this.dbCache.get(dbPath);
    if (cached && cached.expires > Date.now()) {
      return cached.db;
    }

    // Close expired handle if any
    if (cached) {
      try { cached.db.close(); } catch { /* ignore */ }
      this.dbCache.delete(dbPath);
    }

    // Evict oldest if at capacity
    if (this.dbCache.size >= MAX_CACHED_DBS) {
      this.closeOldest();
    }

    // Open new read-only handle
    if (!fs.existsSync(dbPath)) {
      log.warn(`Database not found: ${dbPath}`);
      return null;
    }

    try {
      const db = new Database(dbPath, { readonly: true });
      db.pragma("busy_timeout = 3000");
      this.dbCache.set(dbPath, {
        db,
        expires: Date.now() + DB_CACHE_TTL_MS,
      });
      return db;
    } catch (err) {
      log.warn(`Failed to open read-only DB ${dbPath}: ${err}`);
      return null;
    }
  }

  /** Close the oldest cached DB handle */
  private closeOldest(): void {
    let oldestKey: string | null = null;
    let oldestExpires = Infinity;
    for (const [key, { expires }] of this.dbCache) {
      if (expires < oldestExpires) {
        oldestExpires = expires;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      const cached = this.dbCache.get(oldestKey);
      if (cached) {
        try { cached.db.close(); } catch { /* ignore */ }
      }
      this.dbCache.delete(oldestKey);
    }
  }

  /** Close all expired DB handles (maintenance) */
  closeExpired(): void {
    const now = Date.now();
    for (const [key, { db, expires }] of this.dbCache) {
      if (expires < now) {
        try { db.close(); } catch { /* ignore */ }
        this.dbCache.delete(key);
      }
    }
  }

  /** Close all cached DB handles (called on service shutdown) */
  closeAll(): void {
    for (const [, { db }] of this.dbCache) {
      try { db.close(); } catch { /* ignore */ }
    }
    this.dbCache.clear();
  }

  // ─── Query Methods ────────────────────────────────────────────────

  /**
   * Query decisions from another instance.
   */
  queryDecisions(
    instanceId: string,
    options?: { query?: string; limit?: number; status?: string }
  ): { source: InstanceEntry; results: Record<string, unknown>[] } {
    const target = this.checkPermission(instanceId, "decisions");
    const db = this.openReadOnly(target.db_path);
    if (!db) throw new Error(`Cannot open database for instance '${target.label}'.`);

    const limit = options?.limit ?? 50;
    let results: Record<string, unknown>[];

    if (options?.query) {
      // FTS5 search
      try {
        results = db.prepare(
          `SELECT d.* FROM decisions d
           JOIN fts_decisions f ON d.id = f.rowid
           WHERE fts_decisions MATCH ?
           ${options.status ? "AND d.status = ?" : ""}
           ORDER BY rank
           LIMIT ?`
        ).all(
          ...(options.status
            ? [options.query, options.status, limit]
            : [options.query, limit])
        ) as Record<string, unknown>[];
      } catch {
        // FTS5 may not exist — fallback to LIKE
        results = db.prepare(
          `SELECT * FROM decisions
           WHERE (decision LIKE ? OR rationale LIKE ?)
           ${options.status ? "AND status = ?" : ""}
           ORDER BY id DESC LIMIT ?`
        ).all(
          ...(options.status
            ? [`%${options.query}%`, `%${options.query}%`, options.status, limit]
            : [`%${options.query}%`, `%${options.query}%`, limit])
        ) as Record<string, unknown>[];
      }
    } else {
      results = db.prepare(
        `SELECT * FROM decisions
         ${options?.status ? "WHERE status = ?" : ""}
         ORDER BY id DESC LIMIT ?`
      ).all(
        ...(options?.status ? [options.status, limit] : [limit])
      ) as Record<string, unknown>[];
    }

    return { source: target, results };
  }

  /**
   * Query conventions from another instance.
   */
  queryConventions(
    instanceId: string,
    options?: { category?: string; enforced?: boolean }
  ): { source: InstanceEntry; results: Record<string, unknown>[] } {
    const target = this.checkPermission(instanceId, "conventions");
    const db = this.openReadOnly(target.db_path);
    if (!db) throw new Error(`Cannot open database for instance '${target.label}'.`);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.category) {
      conditions.push("category = ?");
      params.push(options.category);
    }
    if (options?.enforced !== undefined) {
      conditions.push("enforced = ?");
      params.push(options.enforced ? 1 : 0);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const results = db.prepare(
      `SELECT * FROM conventions ${where} ORDER BY id DESC`
    ).all(...params) as Record<string, unknown>[];

    return { source: target, results };
  }

  /**
   * Query file notes from another instance.
   */
  queryFileNotes(
    instanceId: string,
    options?: { filePath?: string; limit?: number }
  ): { source: InstanceEntry; results: Record<string, unknown>[] } {
    const target = this.checkPermission(instanceId, "file_notes");
    const db = this.openReadOnly(target.db_path);
    if (!db) throw new Error(`Cannot open database for instance '${target.label}'.`);

    const limit = options?.limit ?? 50;
    let results: Record<string, unknown>[];

    if (options?.filePath) {
      results = db.prepare(
        "SELECT * FROM file_notes WHERE file_path = ? LIMIT ?"
      ).all(options.filePath, limit) as Record<string, unknown>[];
    } else {
      results = db.prepare(
        "SELECT * FROM file_notes ORDER BY file_path LIMIT ?"
      ).all(limit) as Record<string, unknown>[];
    }

    return { source: target, results };
  }

  /**
   * Query tasks from another instance.
   */
  queryTasks(
    instanceId: string,
    options?: { status?: string; limit?: number }
  ): { source: InstanceEntry; results: Record<string, unknown>[] } {
    const target = this.checkPermission(instanceId, "tasks");
    const db = this.openReadOnly(target.db_path);
    if (!db) throw new Error(`Cannot open database for instance '${target.label}'.`);

    const limit = options?.limit ?? 50;
    const results = db.prepare(
      `SELECT * FROM tasks
       ${options?.status ? "WHERE status = ?" : ""}
       ORDER BY id DESC LIMIT ?`
    ).all(
      ...(options?.status ? [options.status, limit] : [limit])
    ) as Record<string, unknown>[];

    return { source: target, results };
  }

  /**
   * Query sessions from another instance.
   */
  querySessions(
    instanceId: string,
    options?: { limit?: number }
  ): { source: InstanceEntry; results: Record<string, unknown>[] } {
    const target = this.checkPermission(instanceId, "sessions");
    const db = this.openReadOnly(target.db_path);
    if (!db) throw new Error(`Cannot open database for instance '${target.label}'.`);

    const limit = options?.limit ?? 20;
    const results = db.prepare(
      "SELECT * FROM sessions ORDER BY id DESC LIMIT ?"
    ).all(limit) as Record<string, unknown>[];

    return { source: target, results };
  }

  /**
   * Query changes from another instance.
   */
  queryChanges(
    instanceId: string,
    options?: { limit?: number; filePath?: string }
  ): { source: InstanceEntry; results: Record<string, unknown>[] } {
    const target = this.checkPermission(instanceId, "changes");
    const db = this.openReadOnly(target.db_path);
    if (!db) throw new Error(`Cannot open database for instance '${target.label}'.`);

    const limit = options?.limit ?? 50;
    let results: Record<string, unknown>[];

    if (options?.filePath) {
      results = db.prepare(
        "SELECT * FROM changes WHERE file_path = ? ORDER BY id DESC LIMIT ?"
      ).all(options.filePath, limit) as Record<string, unknown>[];
    } else {
      results = db.prepare(
        "SELECT * FROM changes ORDER BY id DESC LIMIT ?"
      ).all(limit) as Record<string, unknown>[];
    }

    return { source: target, results };
  }

  // ─── Cross-Instance Search ────────────────────────────────────────

  /**
   * Search across ALL sharing instances at once.
   * Queries each instance that has sharing_mode != 'none' and includes
   * the requested scope in sharing_types.
   */
  searchAll(
    query: string,
    options?: { scope?: string; limit?: number }
  ): CrossInstanceSearchResult[] {
    const results: CrossInstanceSearchResult[] = [];
    const instances = this.registry.listInstances(false); // active only
    const selfId = this.registry.getInstanceId();
    const limit = options?.limit ?? 10;
    const scope = options?.scope ?? "decisions"; // default search scope

    for (const instance of instances) {
      // Skip self and non-sharing instances
      if (instance.instance_id === selfId) continue;
      if (instance.sharing_mode === "none") continue;
      if (!instance.sharing_types.includes(scope)) continue;

      try {
        const db = this.openReadOnly(instance.db_path);
        if (!db) continue;

        let rows: Record<string, unknown>[] = [];

        // Try FTS5 first, fall back to LIKE
        if (scope === "decisions") {
          try {
            rows = db.prepare(
              `SELECT d.* FROM decisions d
               JOIN fts_decisions f ON d.id = f.rowid
               WHERE fts_decisions MATCH ?
               ORDER BY rank LIMIT ?`
            ).all(query, limit) as Record<string, unknown>[];
          } catch {
            rows = db.prepare(
              `SELECT * FROM decisions
               WHERE decision LIKE ? OR rationale LIKE ?
               ORDER BY id DESC LIMIT ?`
            ).all(`%${query}%`, `%${query}%`, limit) as Record<string, unknown>[];
          }
        } else if (scope === "conventions") {
          rows = db.prepare(
            `SELECT * FROM conventions
             WHERE rule LIKE ? OR category LIKE ?
             ORDER BY id DESC LIMIT ?`
          ).all(`%${query}%`, `%${query}%`, limit) as Record<string, unknown>[];
        } else if (scope === "file_notes") {
          rows = db.prepare(
            `SELECT * FROM file_notes
             WHERE file_path LIKE ? OR notes LIKE ?
             LIMIT ?`
          ).all(`%${query}%`, `%${query}%`, limit) as Record<string, unknown>[];
        } else if (scope === "tasks") {
          rows = db.prepare(
            `SELECT * FROM tasks
             WHERE title LIKE ? OR description LIKE ?
             ORDER BY id DESC LIMIT ?`
          ).all(`%${query}%`, `%${query}%`, limit) as Record<string, unknown>[];
        } else {
          // Generic table search — try direct LIKE on common text columns
          try {
            rows = db.prepare(
              `SELECT * FROM ${scope} ORDER BY id DESC LIMIT ?`
            ).all(limit) as Record<string, unknown>[];
          } catch { /* table may not exist */ }
        }

        if (rows.length > 0) {
          results.push({
            source_instance_id: instance.instance_id,
            source_label: instance.label,
            source_project: instance.project_root,
            type: scope,
            results: rows,
            total: rows.length,
          });
        }
      } catch (err) {
        log.warn(`searchAll failed for instance '${instance.label}': ${err}`);
      }
    }

    return results;
  }

  // ─── Import ───────────────────────────────────────────────────────

  /**
   * Import specific records from another instance into the local database.
   * Requires the source instance to have sharing_mode='full'.
   * Records are tagged with provenance (source_instance_id, imported_at).
   *
   * NOTE: Actual write to local DB must be done by the caller (dispatcher).
   * This method only extracts and returns the records for import.
   */
  extractForImport(
    instanceId: string,
    type: string,
    ids?: number[]
  ): { source: InstanceEntry; records: Record<string, unknown>[] } {
    const target = this.checkImportPermission(instanceId, type);
    const db = this.openReadOnly(target.db_path);
    if (!db) throw new Error(`Cannot open database for instance '${target.label}'.`);

    let records: Record<string, unknown>[];

    if (ids && ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      records = db.prepare(
        `SELECT * FROM ${type} WHERE id IN (${placeholders})`
      ).all(...ids) as Record<string, unknown>[];
    } else {
      // Get all (with reasonable limit)
      records = db.prepare(
        `SELECT * FROM ${type} ORDER BY id DESC LIMIT 100`
      ).all() as Record<string, unknown>[];
    }

    return { source: target, records };
  }

  /**
   * Get stats from another instance directly (without opening its DB).
   * Uses the registry's cached stats instead.
   */
  getInstanceStats(instanceId: string): InstanceEntry | null {
    const instances = this.registry.listInstances(true);
    return instances.find(i => i.instance_id === instanceId) ?? null;
  }
}
