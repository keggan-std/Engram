// ============================================================================
// Tests — SensitiveDataService
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "../helpers/test-db.js";
import { SensitiveDataService } from "../../src/services/sensitive-data.service.js";
import type Database from "better-sqlite3";
import type { Repositories } from "../../src/repositories/index.js";

describe("SensitiveDataService", () => {
  let db: Database.Database;
  let repos: Repositories;
  let cleanup: () => void;
  let service: SensitiveDataService;

  beforeEach(() => {
    ({ db, repos, cleanup } = createTestDb());
    service = new SensitiveDataService(repos.config, db);
  });

  afterEach(() => cleanup());

  // ─── Lock Management ────────────────────────────────────────────

  describe("lockRecords / unlockRecords", () => {
    it("should lock records and return count", () => {
      const result = service.lockRecords("decisions", [1, 2, 3]);
      expect(result.locked).toBe(3);
    });

    it("should not double-count already-locked records", () => {
      service.lockRecords("decisions", [1, 2]);
      const result = service.lockRecords("decisions", [2, 3]);
      expect(result.locked).toBe(1); // only id=3 is new
    });

    it("should unlock records and return count", () => {
      service.lockRecords("decisions", [1, 2, 3]);
      const result = service.unlockRecords("decisions", [1, 2]);
      expect(result.unlocked).toBe(2);
    });

    it("should return 0 when unlocking non-existent locks", () => {
      const result = service.unlockRecords("decisions", [99]);
      expect(result.unlocked).toBe(0);
    });

    it("should handle multiple types independently", () => {
      service.lockRecords("decisions", [1, 2]);
      service.lockRecords("conventions", [1, 3]);
      expect(service.isLocked("decisions", 1)).toBe(true);
      expect(service.isLocked("conventions", 1)).toBe(true);
      expect(service.isLocked("decisions", 3)).toBe(false);
      expect(service.isLocked("conventions", 3)).toBe(true);
    });
  });

  // ─── Query Helpers ──────────────────────────────────────────────

  describe("isLocked", () => {
    it("should return true for locked records", () => {
      service.lockRecords("file_notes", [5]);
      expect(service.isLocked("file_notes", 5)).toBe(true);
    });

    it("should return false for unlocked records", () => {
      expect(service.isLocked("file_notes", 5)).toBe(false);
    });
  });

  describe("getLockedIds", () => {
    it("should return all locked IDs for a type", () => {
      service.lockRecords("decisions", [10, 20, 30]);
      const ids = service.getLockedIds("decisions");
      expect(ids).toEqual(expect.arrayContaining([10, 20, 30]));
      expect(ids.length).toBe(3);
    });

    it("should return empty array for unknown type", () => {
      expect(service.getLockedIds("nonexistent")).toEqual([]);
    });
  });

  describe("filterSensitive", () => {
    it("should remove locked records from a result set", () => {
      service.lockRecords("decisions", [2, 4]);
      const records = [
        { id: 1, text: "a" },
        { id: 2, text: "b" },
        { id: 3, text: "c" },
        { id: 4, text: "d" },
      ];
      const filtered = service.filterSensitive("decisions", records);
      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.id)).toEqual([1, 3]);
    });

    it("should return all records when nothing is locked", () => {
      const records = [{ id: 1 }, { id: 2 }];
      const filtered = service.filterSensitive("decisions", records);
      expect(filtered).toHaveLength(2);
    });

    it("should keep records without an id field", () => {
      service.lockRecords("decisions", [1]);
      const records = [{ name: "no-id" }, { id: 1, name: "locked" }];
      const filtered = service.filterSensitive("decisions", records);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("no-id");
    });
  });

  describe("getSummary", () => {
    it("should return summary of all locked types", () => {
      service.lockRecords("decisions", [1, 2]);
      service.lockRecords("conventions", [5]);
      const summary = service.getSummary();
      expect(summary).toHaveLength(2);
      const decEntry = summary.find(e => e.type === "decisions");
      expect(decEntry?.count).toBe(2);
      const convEntry = summary.find(e => e.type === "conventions");
      expect(convEntry?.count).toBe(1);
    });

    it("should return empty array when nothing locked", () => {
      expect(service.getSummary()).toEqual([]);
    });
  });

  // ─── Access Request Management ──────────────────────────────────

  describe("createAccessRequest", () => {
    it("should create a pending access request", () => {
      const req = service.createAccessRequest(
        "instance-abc",
        "My Project",
        "decisions",
        [1, 2, 3],
        "Need to review architecture decisions",
      );
      expect(req.id).toBeGreaterThan(0);
      expect(req.status).toBe("pending");
      expect(req.requester_instance_id).toBe("instance-abc");
      expect(req.requester_label).toBe("My Project");
      expect(req.target_type).toBe("decisions");
      expect(JSON.parse(req.target_ids)).toEqual([1, 2, 3]);
      expect(req.reason).toBe("Need to review architecture decisions");
      expect(req.resolved_at).toBeNull();
    });

    it("should create request with null optional fields", () => {
      const req = service.createAccessRequest("inst-1", null, "conventions", [7], null);
      expect(req.requester_label).toBeNull();
      expect(req.reason).toBeNull();
    });
  });

  describe("approveRequest", () => {
    it("should approve a pending request", () => {
      const req = service.createAccessRequest("inst-1", "Label", "decisions", [1], null);
      const approved = service.approveRequest(req.id, "admin-user");
      expect(approved).not.toBeNull();
      expect(approved!.status).toBe("approved");
      expect(approved!.resolved_by).toBe("admin-user");
      expect(approved!.resolved_at).not.toBeNull();
    });

    it("should return null for non-existent request", () => {
      expect(service.approveRequest(999)).toBeNull();
    });

    it("should return existing state if already resolved", () => {
      const req = service.createAccessRequest("inst-1", null, "decisions", [1], null);
      service.approveRequest(req.id);
      const again = service.approveRequest(req.id);
      expect(again!.status).toBe("approved"); // No double-resolve
    });
  });

  describe("denyRequest", () => {
    it("should deny a pending request", () => {
      const req = service.createAccessRequest("inst-1", null, "decisions", [1], null);
      const denied = service.denyRequest(req.id, "owner");
      expect(denied).not.toBeNull();
      expect(denied!.status).toBe("denied");
      expect(denied!.resolved_by).toBe("owner");
    });

    it("should return null for non-existent request", () => {
      expect(service.denyRequest(888)).toBeNull();
    });
  });

  describe("listRequests", () => {
    it("should list all requests", () => {
      service.createAccessRequest("inst-1", null, "decisions", [1], null);
      service.createAccessRequest("inst-2", null, "conventions", [2], null);
      const all = service.listRequests();
      expect(all).toHaveLength(2);
    });

    it("should filter by status", () => {
      const req1 = service.createAccessRequest("inst-1", null, "decisions", [1], null);
      service.createAccessRequest("inst-2", null, "conventions", [2], null);
      service.approveRequest(req1.id);
      
      const pending = service.listRequests("pending");
      expect(pending).toHaveLength(1);
      
      const approved = service.listRequests("approved");
      expect(approved).toHaveLength(1);
      expect(approved[0].requester_instance_id).toBe("inst-1");
    });
  });

  describe("isAccessApproved", () => {
    it("should return true when all requested IDs are approved", () => {
      const req = service.createAccessRequest("inst-1", null, "decisions", [1, 2, 3], null);
      service.approveRequest(req.id);
      expect(service.isAccessApproved("inst-1", "decisions", [1, 2, 3])).toBe(true);
    });

    it("should return false when some IDs are not covered", () => {
      const req = service.createAccessRequest("inst-1", null, "decisions", [1, 2], null);
      service.approveRequest(req.id);
      expect(service.isAccessApproved("inst-1", "decisions", [1, 2, 3])).toBe(false);
    });

    it("should return false for denied requests", () => {
      const req = service.createAccessRequest("inst-1", null, "decisions", [1], null);
      service.denyRequest(req.id);
      expect(service.isAccessApproved("inst-1", "decisions", [1])).toBe(false);
    });

    it("should aggregate across multiple approved requests", () => {
      const req1 = service.createAccessRequest("inst-1", null, "decisions", [1, 2], null);
      const req2 = service.createAccessRequest("inst-1", null, "decisions", [3, 4], null);
      service.approveRequest(req1.id);
      service.approveRequest(req2.id);
      expect(service.isAccessApproved("inst-1", "decisions", [1, 2, 3, 4])).toBe(true);
    });

    it("should isolate by requester instance", () => {
      const req = service.createAccessRequest("inst-1", null, "decisions", [1], null);
      service.approveRequest(req.id);
      // inst-2 never requested
      expect(service.isAccessApproved("inst-2", "decisions", [1])).toBe(false);
    });
  });

  describe("getRequest", () => {
    it("should return specific request by ID", () => {
      const req = service.createAccessRequest("inst-1", "My Proj", "decisions", [1], "need it");
      const fetched = service.getRequest(req.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.requester_label).toBe("My Proj");
    });

    it("should return null for unknown ID", () => {
      expect(service.getRequest(777)).toBeNull();
    });
  });
});
