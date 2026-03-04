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
