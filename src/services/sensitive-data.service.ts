// ============================================================================
// Engram MCP Server — Sensitive Data Protection Service
// ============================================================================
// Manages data sensitivity locks. Owners can mark specific decisions,
// conventions, or other records as "sensitive." Cross-instance queries
// automatically filter out sensitive items unless access is approved.
// Access requests require human approval.
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";
import type { ConfigRepo } from "../repositories/config.repo.js";
import type { SensitiveAccessRequest } from "../types.js";
import { CFG_SENSITIVE_KEYS } from "../constants.js";
import { log } from "../logger.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface SensitiveLock {
  type: string;   // "decisions", "conventions", "file_notes", etc.
  id: number;     // Record ID within that type
}

export interface SensitiveKeyEntry {
  type: string;
  ids: number[];
}

// ============================================================================
// Service
// ============================================================================

export class SensitiveDataService {
  constructor(
    private config: ConfigRepo,
    private db: DatabaseType,
  ) {}

  // ─── Lock Management ──────────────────────────────────────────────

  /**
   * Get all currently locked sensitive keys.
   * Returns a map of type → Set<id>.
   */
  getLockedKeys(): Map<string, Set<number>> {
    const raw = this.config.get(CFG_SENSITIVE_KEYS);
    const map = new Map<string, Set<number>>();
    if (!raw) return map;

    try {
      const entries = JSON.parse(raw) as SensitiveKeyEntry[];
      for (const entry of entries) {
        map.set(entry.type, new Set(entry.ids));
      }
    } catch {
      log.warn("Failed to parse sensitive_keys config");
    }

    return map;
  }

  /**
   * Save the locked keys map back to config.
   */
  private saveLockedKeys(map: Map<string, Set<number>>): void {
    const entries: SensitiveKeyEntry[] = [];
    for (const [type, ids] of map) {
      if (ids.size > 0) {
        entries.push({ type, ids: [...ids] });
      }
    }
    this.config.set(CFG_SENSITIVE_KEYS, JSON.stringify(entries), new Date().toISOString());
  }

  /**
   * Lock specific records as sensitive (requires human/owner action).
   * Locked items are not visible to cross-instance queries.
   */
  lockRecords(type: string, ids: number[]): { locked: number } {
    const map = this.getLockedKeys();
    if (!map.has(type)) map.set(type, new Set());
    const set = map.get(type)!;
    let locked = 0;
    for (const id of ids) {
      if (!set.has(id)) {
        set.add(id);
        locked++;
      }
    }
    this.saveLockedKeys(map);
    return { locked };
  }

  /**
   * Unlock specific records (remove sensitivity lock).
   */
  unlockRecords(type: string, ids: number[]): { unlocked: number } {
    const map = this.getLockedKeys();
    const set = map.get(type);
    if (!set) return { unlocked: 0 };

    let unlocked = 0;
    for (const id of ids) {
      if (set.delete(id)) unlocked++;
    }
    this.saveLockedKeys(map);
    return { unlocked };
  }

  /**
   * Check if a specific record is locked as sensitive.
   */
  isLocked(type: string, id: number): boolean {
    const map = this.getLockedKeys();
    return map.get(type)?.has(id) ?? false;
  }

  /**
   * Get all locked record IDs for a given type.
   */
  getLockedIds(type: string): number[] {
    const map = this.getLockedKeys();
    return [...(map.get(type) ?? [])];
  }

  /**
   * Filter out sensitive records from a result set.
   * Used by cross-instance queries to remove locked items before returning.
   */
  filterSensitive(type: string, records: Record<string, unknown>[]): Record<string, unknown>[] {
    const lockedIds = this.getLockedIds(type);
    if (lockedIds.length === 0) return records;

    const lockedSet = new Set(lockedIds);
    return records.filter(r => {
      const id = r.id as number | undefined;
      return id === undefined || !lockedSet.has(id);
    });
  }

  /**
   * Get a summary of all locked items across all types.
   */
  getSummary(): { type: string; count: number; ids: number[] }[] {
    const map = this.getLockedKeys();
    const summary: { type: string; count: number; ids: number[] }[] = [];
    for (const [type, ids] of map) {
      if (ids.size > 0) {
        summary.push({ type, count: ids.size, ids: [...ids] });
      }
    }
    return summary;
  }

  // ─── Access Request Management ────────────────────────────────────

  /**
   * Create an access request from a remote instance wanting to view
   * sensitive data. The request stays "pending" until approved/denied.
   */
  createAccessRequest(
    requesterInstanceId: string,
    requesterLabel: string | null,
    targetType: string,
    targetIds: number[],
    reason: string | null,
  ): SensitiveAccessRequest {
    const ts = new Date().toISOString();
    const result = this.db.prepare(
      `INSERT INTO sensitive_access_requests
       (requester_instance_id, requester_label, target_type, target_ids, reason, status, requested_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    ).run(
      requesterInstanceId,
      requesterLabel,
      targetType,
      JSON.stringify(targetIds),
      reason,
      ts,
    );

    return {
      id: Number(result.lastInsertRowid),
      requester_instance_id: requesterInstanceId,
      requester_label: requesterLabel,
      target_type: targetType,
      target_ids: JSON.stringify(targetIds),
      reason,
      status: "pending",
      requested_at: ts,
      resolved_at: null,
      resolved_by: null,
    };
  }

  /**
   * Approve an access request (human action).
   * This unlocks the requested records for the requester.
   */
  approveRequest(requestId: number, resolvedBy: string = "human"): SensitiveAccessRequest | null {
    const request = this.getRequest(requestId);
    if (!request) return null;
    if (request.status !== "pending") return request; // Already resolved

    const ts = new Date().toISOString();
    this.db.prepare(
      "UPDATE sensitive_access_requests SET status = 'approved', resolved_at = ?, resolved_by = ? WHERE id = ?"
    ).run(ts, resolvedBy, requestId);

    return { ...request, status: "approved", resolved_at: ts, resolved_by: resolvedBy };
  }

  /**
   * Deny an access request (human action).
   */
  denyRequest(requestId: number, resolvedBy: string = "human"): SensitiveAccessRequest | null {
    const request = this.getRequest(requestId);
    if (!request) return null;
    if (request.status !== "pending") return request;

    const ts = new Date().toISOString();
    this.db.prepare(
      "UPDATE sensitive_access_requests SET status = 'denied', resolved_at = ?, resolved_by = ? WHERE id = ?"
    ).run(ts, resolvedBy, requestId);

    return { ...request, status: "denied", resolved_at: ts, resolved_by: resolvedBy };
  }

  /**
   * Get a specific access request by ID.
   */
  getRequest(requestId: number): SensitiveAccessRequest | null {
    const row = this.db.prepare(
      "SELECT * FROM sensitive_access_requests WHERE id = ?"
    ).get(requestId) as SensitiveAccessRequest | undefined;
    return row ?? null;
  }

  /**
   * List access requests, optionally filtered by status.
   */
  listRequests(status?: "pending" | "approved" | "denied"): SensitiveAccessRequest[] {
    if (status) {
      return this.db.prepare(
        "SELECT * FROM sensitive_access_requests WHERE status = ? ORDER BY requested_at DESC"
      ).all(status) as SensitiveAccessRequest[];
    }
    return this.db.prepare(
      "SELECT * FROM sensitive_access_requests ORDER BY requested_at DESC"
    ).all() as SensitiveAccessRequest[];
  }

  /**
   * Check if a specific access request has been approved.
   * Used by cross-instance queries to check if locked data can be accessed.
   */
  isAccessApproved(requesterInstanceId: string, targetType: string, targetIds: number[]): boolean {
    const requests = this.db.prepare(
      "SELECT * FROM sensitive_access_requests WHERE requester_instance_id = ? AND target_type = ? AND status = 'approved'"
    ).all(requesterInstanceId, targetType) as SensitiveAccessRequest[];

    // Check if all requested IDs are covered by an approved request
    const approvedIds = new Set<number>();
    for (const req of requests) {
      try {
        const ids = JSON.parse(req.target_ids) as number[];
        for (const id of ids) approvedIds.add(id);
      } catch { /* ignore */ }
    }

    return targetIds.every(id => approvedIds.has(id));
  }
}
