// ============================================================================
// Tests — Cross-Instance Query Service
// ============================================================================

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "../helpers/test-db.js";
import { InstanceRegistryService } from "../../src/services/instance-registry.service.js";
import { CrossInstanceService } from "../../src/services/cross-instance.service.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import Database from "better-sqlite3";
import type { Repositories } from "../../src/repositories/index.js";
import type { InstanceRegistry } from "../../src/types.js";
import { runMigrations } from "../../src/migrations.js";
import { createRepositories } from "../../src/repositories/index.js";
import { randomUUID } from "crypto";

// ─── Test helpers ────────────────────────────────────────────────────

/** Create a temp directory */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "engram-xquery-test-"));
}

/** Create a real SQLite DB file to serve as a foreign instance */
function createForeignDb(dir: string, label: string): {
  dbPath: string;
  instanceId: string;
  repos: Repositories;
  db: Database.Database;
} {
  const dbPath = path.join(dir, `${label}.db`);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const repos = createRepositories(db);
  const instanceId = randomUUID();
  const ts = new Date().toISOString();
  repos.config.set("instance_id", instanceId, ts);
  repos.config.set("instance_label", label, ts);
  repos.config.set("instance_created_at", ts, ts);
  repos.config.set("machine_id", "test-machine", ts);
  repos.config.set("sharing_mode", "read", ts);
  repos.config.set("sharing_types", JSON.stringify(["decisions", "conventions"]), ts);

  return { dbPath, instanceId, repos, db };
}

/** Patch a registry service to use an isolated temp directory */
function patchRegistry(
  service: InstanceRegistryService,
  registryPath: string,
  repos: Repositories
): void {
  service.readRegistry = (): InstanceRegistry => {
    try {
      if (fs.existsSync(registryPath)) {
        const raw = fs.readFileSync(registryPath, "utf-8");
        const parsed = JSON.parse(raw) as InstanceRegistry;
        if (parsed && typeof parsed === "object" && parsed.instances) {
          return parsed;
        }
      }
    } catch { /* ignore */ }
    return {
      schema_version: 1,
      machine_id: repos.config.get("machine_id") ?? "unknown",
      last_updated: new Date().toISOString(),
      instances: {},
    };
  };

  (service as any).writeRegistry = (registry: InstanceRegistry): void => {
    registry.last_updated = new Date().toISOString();
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    const tmpPath = registryPath + `.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2), "utf-8");
    fs.renameSync(tmpPath, registryPath);
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("CrossInstanceService", () => {
  let localDb: Database.Database;
  let localRepos: Repositories;
  let localCleanup: () => void;
  let tempDir: string;
  let registryPath: string;
  let registryService: InstanceRegistryService;
  let crossService: CrossInstanceService;

  beforeEach(() => {
    const result = createTestDb();
    localDb = result.db;
    localRepos = result.repos;
    localCleanup = result.cleanup;

    tempDir = createTempDir();
    registryPath = path.join(tempDir, "instances.json");

    registryService = new InstanceRegistryService(localRepos.config, "/test/local", localDb);
    patchRegistry(registryService, registryPath, localRepos);
    registryService.register();

    crossService = new CrossInstanceService(registryService);
  });

  afterEach(() => {
    crossService.closeAll();
    registryService.shutdown();
    localCleanup();
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ─── Discovery ────────────────────────────────────────────────────

  describe("discoverInstances", () => {
    test("returns registered instances", () => {
      const instances = crossService.discoverInstances();
      expect(instances.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Permission Checks ────────────────────────────────────────────

  describe("permission checks", () => {
    test("throws for non-existent instance", () => {
      expect(() => {
        crossService.queryDecisions("non-existent-id");
      }).toThrow("not found in registry");
    });

    test("throws for instance with sharing_mode=none", () => {
      // Create a foreign instance with sharing disabled
      const foreign = createForeignDb(tempDir, "no-share");
      foreign.repos.config.set("sharing_mode", "none", new Date().toISOString());

      // Register it in the registry
      const registry = registryService.readRegistry();
      registry.instances[foreign.instanceId] = {
        instance_id: foreign.instanceId,
        label: "no-share",
        project_root: tempDir,
        db_path: foreign.dbPath,
        schema_version: 17,
        server_version: "1.7.3",
        sharing_mode: "none",
        sharing_types: [],
        stats: { sessions: 0, decisions: 0, file_notes: 0, tasks: 0, conventions: 0, changes: 0, db_size_kb: 0 },
        last_heartbeat: new Date().toISOString(),
        status: "active",
        pid: process.pid,
        machine_id: "test",
      };
      (registryService as any).writeRegistry(registry);

      expect(() => {
        crossService.queryDecisions(foreign.instanceId);
      }).toThrow("sharing disabled");

      foreign.db.close();
    });

    test("throws for type not in sharing_types", () => {
      const foreign = createForeignDb(tempDir, "limited-share");

      const registry = registryService.readRegistry();
      registry.instances[foreign.instanceId] = {
        instance_id: foreign.instanceId,
        label: "limited-share",
        project_root: tempDir,
        db_path: foreign.dbPath,
        schema_version: 17,
        server_version: "1.7.3",
        sharing_mode: "read",
        sharing_types: ["decisions"], // only decisions, not tasks
        stats: { sessions: 0, decisions: 0, file_notes: 0, tasks: 0, conventions: 0, changes: 0, db_size_kb: 0 },
        last_heartbeat: new Date().toISOString(),
        status: "active",
        pid: process.pid,
        machine_id: "test",
      };
      (registryService as any).writeRegistry(registry);

      expect(() => {
        crossService.queryTasks(foreign.instanceId);
      }).toThrow("does not share 'tasks'");

      foreign.db.close();
    });
  });

  // ─── Query Decisions ──────────────────────────────────────────────

  describe("queryDecisions", () => {
    test("returns decisions from a sharing instance", () => {
      const foreign = createForeignDb(tempDir, "foreign-project");

      // Insert some decisions
      const ts = new Date().toISOString();
      foreign.db.prepare(
        "INSERT INTO decisions (session_id, timestamp, decision, rationale, status) VALUES (?, ?, ?, ?, ?)"
      ).run(null, ts, "Use TypeScript", "Type safety", "active");
      foreign.db.prepare(
        "INSERT INTO decisions (session_id, timestamp, decision, rationale, status) VALUES (?, ?, ?, ?, ?)"
      ).run(null, ts, "Use ESM modules", "Modern standard", "active");

      // Register in registry
      const registry = registryService.readRegistry();
      registry.instances[foreign.instanceId] = {
        instance_id: foreign.instanceId,
        label: "foreign-project",
        project_root: tempDir,
        db_path: foreign.dbPath,
        schema_version: 17,
        server_version: "1.7.3",
        sharing_mode: "read",
        sharing_types: ["decisions", "conventions"],
        stats: { sessions: 0, decisions: 2, file_notes: 0, tasks: 0, conventions: 0, changes: 0, db_size_kb: 0 },
        last_heartbeat: new Date().toISOString(),
        status: "active",
        pid: process.pid,
        machine_id: "test",
      };
      (registryService as any).writeRegistry(registry);

      const result = crossService.queryDecisions(foreign.instanceId);
      expect(result.source.label).toBe("foreign-project");
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toHaveProperty("decision");

      foreign.db.close();
    });

    test("supports query filter", () => {
      const foreign = createForeignDb(tempDir, "query-test");
      const ts = new Date().toISOString();
      foreign.db.prepare(
        "INSERT INTO decisions (session_id, timestamp, decision, rationale, status) VALUES (?, ?, ?, ?, ?)"
      ).run(null, ts, "Use TypeScript for type safety", "Best practice", "active");
      foreign.db.prepare(
        "INSERT INTO decisions (session_id, timestamp, decision, rationale, status) VALUES (?, ?, ?, ?, ?)"
      ).run(null, ts, "Use Python for scripts", "Quick prototyping", "active");

      const registry = registryService.readRegistry();
      registry.instances[foreign.instanceId] = {
        instance_id: foreign.instanceId,
        label: "query-test",
        project_root: tempDir,
        db_path: foreign.dbPath,
        schema_version: 17,
        server_version: "1.7.3",
        sharing_mode: "read",
        sharing_types: ["decisions", "conventions"],
        stats: { sessions: 0, decisions: 2, file_notes: 0, tasks: 0, conventions: 0, changes: 0, db_size_kb: 0 },
        last_heartbeat: new Date().toISOString(),
        status: "active",
        pid: process.pid,
        machine_id: "test",
      };
      (registryService as any).writeRegistry(registry);

      // LIKE-based search for "TypeScript"
      const result = crossService.queryDecisions(foreign.instanceId, { query: "TypeScript" });
      expect(result.results.length).toBeGreaterThanOrEqual(1);
      expect((result.results[0] as any).decision).toContain("TypeScript");

      foreign.db.close();
    });
  });

  // ─── Query Conventions ────────────────────────────────────────────

  describe("queryConventions", () => {
    test("returns conventions from a sharing instance", () => {
      const foreign = createForeignDb(tempDir, "conv-test");
      foreign.db.prepare(
        "INSERT INTO conventions (session_id, category, rule, enforced, timestamp) VALUES (?, ?, ?, ?, ?)"
      ).run(null, "patterns", "Always use async/await", 1, new Date().toISOString());

      const registry = registryService.readRegistry();
      registry.instances[foreign.instanceId] = {
        instance_id: foreign.instanceId,
        label: "conv-test",
        project_root: tempDir,
        db_path: foreign.dbPath,
        schema_version: 17,
        server_version: "1.7.3",
        sharing_mode: "read",
        sharing_types: ["decisions", "conventions"],
        stats: { sessions: 0, decisions: 0, file_notes: 0, tasks: 0, conventions: 1, changes: 0, db_size_kb: 0 },
        last_heartbeat: new Date().toISOString(),
        status: "active",
        pid: process.pid,
        machine_id: "test",
      };
      (registryService as any).writeRegistry(registry);

      const result = crossService.queryConventions(foreign.instanceId);
      expect(result.results).toHaveLength(1);
      expect((result.results[0] as any).rule).toContain("async/await");

      foreign.db.close();
    });
  });

  // ─── Search All ───────────────────────────────────────────────────

  describe("searchAll", () => {
    test("searches across multiple sharing instances", () => {
      // Create two foreign instances with shared decisions
      const foreign1 = createForeignDb(tempDir, "project-alpha");
      const foreign2 = createForeignDb(tempDir, "project-beta");
      const ts = new Date().toISOString();

      foreign1.db.prepare(
        "INSERT INTO decisions (session_id, timestamp, decision, rationale, status) VALUES (?, ?, ?, ?, ?)"
      ).run(null, ts, "Authentication uses JWT tokens", "Industry standard", "active");

      foreign2.db.prepare(
        "INSERT INTO decisions (session_id, timestamp, decision, rationale, status) VALUES (?, ?, ?, ?, ?)"
      ).run(null, ts, "Authentication via OAuth2", "Federated auth", "active");

      // Register both
      const registry = registryService.readRegistry();
      for (const foreign of [foreign1, foreign2]) {
        registry.instances[foreign.instanceId] = {
          instance_id: foreign.instanceId,
          label: foreign.instanceId === foreign1.instanceId ? "project-alpha" : "project-beta",
          project_root: tempDir,
          db_path: foreign.dbPath,
          schema_version: 17,
          server_version: "1.7.3",
          sharing_mode: "read",
          sharing_types: ["decisions", "conventions"],
          stats: { sessions: 0, decisions: 1, file_notes: 0, tasks: 0, conventions: 0, changes: 0, db_size_kb: 0 },
          last_heartbeat: new Date().toISOString(),
          status: "active",
          pid: process.pid,
          machine_id: "test",
        };
      }
      (registryService as any).writeRegistry(registry);

      const results = crossService.searchAll("Authentication", { scope: "decisions" });
      // Should find results from both instances
      expect(results.length).toBeGreaterThanOrEqual(2);

      const labels = results.map(r => r.source_label);
      expect(labels).toContain("project-alpha");
      expect(labels).toContain("project-beta");

      foreign1.db.close();
      foreign2.db.close();
    });

    test("skips instances with sharing_mode=none", () => {
      const foreign = createForeignDb(tempDir, "private-project");
      const ts = new Date().toISOString();
      foreign.db.prepare(
        "INSERT INTO decisions (session_id, timestamp, decision, rationale, status) VALUES (?, ?, ?, ?, ?)"
      ).run(null, ts, "Secret decision", "Private", "active");

      const registry = registryService.readRegistry();
      registry.instances[foreign.instanceId] = {
        instance_id: foreign.instanceId,
        label: "private-project",
        project_root: tempDir,
        db_path: foreign.dbPath,
        schema_version: 17,
        server_version: "1.7.3",
        sharing_mode: "none",
        sharing_types: [],
        stats: { sessions: 0, decisions: 1, file_notes: 0, tasks: 0, conventions: 0, changes: 0, db_size_kb: 0 },
        last_heartbeat: new Date().toISOString(),
        status: "active",
        pid: process.pid,
        machine_id: "test",
      };
      (registryService as any).writeRegistry(registry);

      const results = crossService.searchAll("Secret", { scope: "decisions" });
      const labels = results.map(r => r.source_label);
      expect(labels).not.toContain("private-project");

      foreign.db.close();
    });
  });

  // ─── Extract For Import ───────────────────────────────────────────

  describe("extractForImport", () => {
    test("extracts records from instance with full sharing", () => {
      const foreign = createForeignDb(tempDir, "full-share");
      foreign.repos.config.set("sharing_mode", "full", new Date().toISOString());
      const ts = new Date().toISOString();
      foreign.db.prepare(
        "INSERT INTO decisions (session_id, timestamp, decision, rationale, status) VALUES (?, ?, ?, ?, ?)"
      ).run(null, ts, "Importable decision", "For sharing", "active");

      const registry = registryService.readRegistry();
      registry.instances[foreign.instanceId] = {
        instance_id: foreign.instanceId,
        label: "full-share",
        project_root: tempDir,
        db_path: foreign.dbPath,
        schema_version: 17,
        server_version: "1.7.3",
        sharing_mode: "full",
        sharing_types: ["decisions", "conventions"],
        stats: { sessions: 0, decisions: 1, file_notes: 0, tasks: 0, conventions: 0, changes: 0, db_size_kb: 0 },
        last_heartbeat: new Date().toISOString(),
        status: "active",
        pid: process.pid,
        machine_id: "test",
      };
      (registryService as any).writeRegistry(registry);

      const result = crossService.extractForImport(foreign.instanceId, "decisions");
      expect(result.records).toHaveLength(1);
      expect((result.records[0] as any).decision).toBe("Importable decision");

      foreign.db.close();
    });

    test("rejects import from read-only instance", () => {
      const foreign = createForeignDb(tempDir, "read-only-share");
      const registry = registryService.readRegistry();
      registry.instances[foreign.instanceId] = {
        instance_id: foreign.instanceId,
        label: "read-only-share",
        project_root: tempDir,
        db_path: foreign.dbPath,
        schema_version: 17,
        server_version: "1.7.3",
        sharing_mode: "read",
        sharing_types: ["decisions"],
        stats: { sessions: 0, decisions: 0, file_notes: 0, tasks: 0, conventions: 0, changes: 0, db_size_kb: 0 },
        last_heartbeat: new Date().toISOString(),
        status: "active",
        pid: process.pid,
        machine_id: "test",
      };
      (registryService as any).writeRegistry(registry);

      expect(() => {
        crossService.extractForImport(foreign.instanceId, "decisions");
      }).toThrow("sharing_mode='read'");

      foreign.db.close();
    });
  });

  // ─── DB Cache ─────────────────────────────────────────────────────

  describe("DB cache", () => {
    test("closeAll closes all cached handles", () => {
      const foreign = createForeignDb(tempDir, "cache-test");
      const registry = registryService.readRegistry();
      registry.instances[foreign.instanceId] = {
        instance_id: foreign.instanceId,
        label: "cache-test",
        project_root: tempDir,
        db_path: foreign.dbPath,
        schema_version: 17,
        server_version: "1.7.3",
        sharing_mode: "read",
        sharing_types: ["decisions"],
        stats: { sessions: 0, decisions: 0, file_notes: 0, tasks: 0, conventions: 0, changes: 0, db_size_kb: 0 },
        last_heartbeat: new Date().toISOString(),
        status: "active",
        pid: process.pid,
        machine_id: "test",
      };
      (registryService as any).writeRegistry(registry);

      // Query to create a cached handle
      crossService.queryDecisions(foreign.instanceId);
      // Close all — should not throw
      crossService.closeAll();

      foreign.db.close();
    });
  });

  // ─── getInstanceStats ─────────────────────────────────────────────

  describe("getInstanceStats", () => {
    test("returns stats from registry", () => {
      const selfId = registryService.getInstanceId();
      const stats = crossService.getInstanceStats(selfId);
      expect(stats).not.toBeNull();
      expect(stats!.instance_id).toBe(selfId);
    });

    test("returns null for unknown instance", () => {
      const stats = crossService.getInstanceStats("nonexistent");
      expect(stats).toBeNull();
    });
  });
});
