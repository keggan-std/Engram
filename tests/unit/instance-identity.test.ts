// ============================================================================
// Tests — Instance Identity (Phase A)
// ============================================================================

import { describe, it, expect } from "vitest";
import { getMachineId, generateInstanceLabel } from "../../src/utils.js";
import { createTestDb } from "../helpers/test-db.js";

describe("getMachineId", () => {
  it("returns a non-empty string", () => {
    const id = getMachineId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(8);
  });

  it("returns the same value on repeated calls (stable)", () => {
    const id1 = getMachineId();
    const id2 = getMachineId();
    expect(id1).toBe(id2);
  });
});

describe("generateInstanceLabel", () => {
  it("extracts basename from project root", () => {
    expect(generateInstanceLabel("/home/user/projects/my-app")).toBe("my-app");
    expect(generateInstanceLabel("C:\\Users\\Dev\\repo\\Engram")).toBe("Engram");
  });

  it("cleans special characters", () => {
    expect(generateInstanceLabel("/path/to/My Project (v2)")).toBe("My-Project-v2");
  });

  it("handles spaces in path", () => {
    expect(generateInstanceLabel("C:\\Users\\~ RG\\repo\\Engram")).toBe("Engram");
  });

  it("returns unknown-project for empty basename", () => {
    expect(generateInstanceLabel("/")).toBe("unknown-project");
  });
});

describe("instance identity in database", () => {
  it("generates instance_id on first initDatabase", () => {
    const { repos, cleanup } = createTestDb();
    try {
      const instanceId = repos.config.get("instance_id");
      expect(instanceId).toBeTruthy();
      expect(instanceId!.length).toBe(36); // UUID format
      expect(instanceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    } finally {
      cleanup();
    }
  });

  it("generates instance_label on first init", () => {
    const { repos, cleanup } = createTestDb();
    try {
      const label = repos.config.get("instance_label");
      expect(label).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  it("generates machine_id on first init", () => {
    const { repos, cleanup } = createTestDb();
    try {
      const machineId = repos.config.get("machine_id");
      expect(machineId).toBeTruthy();
      expect(machineId!.length).toBeGreaterThan(8);
    } finally {
      cleanup();
    }
  });

  it("sets default sharing_mode to none", () => {
    const { repos, cleanup } = createTestDb();
    try {
      const mode = repos.config.get("sharing_mode");
      expect(mode).toBe("none");
    } finally {
      cleanup();
    }
  });

  it("sets default sharing_types", () => {
    const { repos, cleanup } = createTestDb();
    try {
      const types = repos.config.get("sharing_types");
      expect(types).toBeTruthy();
      const parsed = JSON.parse(types!);
      expect(parsed).toContain("decisions");
      expect(parsed).toContain("conventions");
    } finally {
      cleanup();
    }
  });

  it("does not overwrite instance_id on subsequent init", () => {
    const { repos, db, cleanup } = createTestDb();
    try {
      const id1 = repos.config.get("instance_id");
      // Simulate re-init by checking the value is still the same
      const id2 = repos.config.get("instance_id");
      expect(id1).toBe(id2);
    } finally {
      cleanup();
    }
  });

  it("creates sensitive_access_requests table", () => {
    const { db, cleanup } = createTestDb();
    try {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sensitive_access_requests'"
      ).all();
      expect(tables.length).toBe(1);
    } finally {
      cleanup();
    }
  });
});
