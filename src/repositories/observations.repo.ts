// ============================================================================
// Engram MCP Server — Observations Repository
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";
import type { ObservationRow } from "../types.js";

export class ObservationsRepo {
  constructor(private db: DatabaseType) { }

  create(
    sessionId: number | null,
    timestamp: string,
    content: string,
    category: string = "other",
    filePath?: string | null,
    tags?: string[] | null,
    agentName?: string | null,
  ): number {
    const result = this.db.prepare(
      "INSERT INTO observations (session_id, timestamp, content, category, file_path, tags, agent_name) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(sessionId, timestamp, content, category, filePath || null, tags ? JSON.stringify(tags) : null, agentName || null);
    return result.lastInsertRowid as number;
  }

  /**
   * Repair an existing observation.
   *
   * THE ONLY REPAIR PATH FOR A CORRUPTED ROW. Task #91: decisions have
   * update_decision, observations had nothing, so observations #100, #101,
   * #102 and #104 — and 15 of the 51 records FR-D9 measured as
   * transport-corrupted — were permanently unfixable. They could only be
   * superseded by another row, which leaves the wrong text in the store and
   * retrievable forever.
   *
   * Only supplied fields change; omitted ones are left alone. `null` for tags
   * clears them, whereas `undefined` leaves them — the two are deliberately
   * distinguishable, unlike FileNotesRepo.upsert, whose two different null
   * coercions in one method are task #65.
   */
  update(
    id: number,
    fields: { content?: string; category?: string; filePath?: string | null; tags?: string[] | null },
  ): boolean {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (fields.content !== undefined) { sets.push("content = ?"); values.push(fields.content); }
    if (fields.category !== undefined) { sets.push("category = ?"); values.push(fields.category); }
    if (fields.filePath !== undefined) { sets.push("file_path = ?"); values.push(fields.filePath); }
    if (fields.tags !== undefined) { sets.push("tags = ?"); values.push(fields.tags ? JSON.stringify(fields.tags) : null); }
    if (sets.length === 0) return false;

    values.push(id);
    const result = this.db.prepare(
      `UPDATE observations SET ${sets.join(", ")} WHERE id = ?`
    ).run(...values as never[]);
    return result.changes > 0;
  }

  getById(id: number): ObservationRow | undefined {
    return this.db.prepare("SELECT * FROM observations WHERE id = ?").get(id) as ObservationRow | undefined;
  }

  getBySession(sessionId: number, limit = 50): ObservationRow[] {
    return this.db.prepare(
      "SELECT * FROM observations WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?"
    ).all(sessionId, limit) as ObservationRow[];
  }

  getByCategory(category: string, limit = 50): ObservationRow[] {
    return this.db.prepare(
      "SELECT * FROM observations WHERE category = ? ORDER BY timestamp DESC LIMIT ?"
    ).all(category, limit) as ObservationRow[];
  }

  getByFile(filePath: string, limit = 20): ObservationRow[] {
    return this.db.prepare(
      "SELECT * FROM observations WHERE file_path = ? ORDER BY timestamp DESC LIMIT ?"
    ).all(filePath, limit) as ObservationRow[];
  }

  getRecent(limit = 20): ObservationRow[] {
    return this.db.prepare(
      "SELECT * FROM observations ORDER BY timestamp DESC LIMIT ?"
    ).all(limit) as ObservationRow[];
  }

  search(query: string, limit = 20): ObservationRow[] {
    return this.db.prepare(
      "SELECT o.* FROM fts_observations f JOIN observations o ON o.id = f.rowid WHERE f.fts_observations MATCH ? ORDER BY rank LIMIT ?"
    ).all(query, limit) as ObservationRow[];
  }

  countBySession(sessionId: number): number {
    return (this.db.prepare(
      "SELECT COUNT(*) as c FROM observations WHERE session_id = ?"
    ).get(sessionId) as { c: number }).c;
  }

  countAll(): number {
    return (this.db.prepare("SELECT COUNT(*) as c FROM observations").get() as { c: number }).c;
  }
}
