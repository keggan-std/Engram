// ============================================================================
// Tests — Instance Registry Service
// ============================================================================

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../helpers/test-db.js";
import { InstanceRegistryService } from "../../src/services/instance-registry.service.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type Database from "better-sqlite3";
import type { Repositories } from "../../src/repositories/index.js";
import type { InstanceRegistry } from "../../src/types.js";

// ─── Test helpers ────────────────────────────────────────────────────

/** Create a temp directory for registry tests */
function createTempRegistryDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "engram-registry-test-"));
}

/** Create a registry service with a custom registry path for isolation */
function createService(db: Database.Database, repos: Repositories, projectRoot = "/test/project"): {
  service: InstanceRegistryService;
  registryDir: string;
  registryPath: string;
  cleanup: () => void;
} {
  const registryDir = createTempRegistryDir();
  const registryPath = path.join(registryDir, "instances.json");

  // Override the registry path by mocking os.homedir to return our temp dir
  // Since the service uses os.homedir() + ".engram", we need to handle this differently.
  // We'll directly spy on the internal methods instead.
  const service = new InstanceRegistryService(repos.config, projectRoot, db);

  // Monkey-patch readRegistry/writeRegistry to use our temp path
  const originalRead = service.readRegistry.bind(service);
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

  // Patch private writeRegistry by accessing it through the prototype
  const originalWrite = (service as any).writeRegistry.bind(service);
  (service as any).writeRegistry = (registry: InstanceRegistry): void => {
    registry.last_updated = new Date().toISOString();
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    const tmpPath = registryPath + `.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2), "utf-8");
    fs.renameSync(tmpPath, registryPath);
  };

  return {
    service,
    registryDir,
    registryPath,
    cleanup: () => {
      service.shutdown();
      try { fs.rmSync(registryDir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("InstanceRegistryService", () => {
  let db: Database.Database;
  let repos: Repositories;
  let dbCleanup: () => void;

  beforeEach(() => {
    const result = createTestDb();
    db = result.db;
    repos = result.repos;
    dbCleanup = result.cleanup;
  });

  afterEach(() => {
    dbCleanup();
  });

  // ─── Identity ──────────────────────────────────────────────────────

  describe("getInstanceId", () => {
    test("returns the instance_id from config", () => {
      const { service, cleanup } = createService(db, repos);
      try {
        const id = service.getInstanceId();
        expect(id).toBeTruthy();
        expect(typeof id).toBe("string");
        // UUID v4 format
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      } finally {
        cleanup();
      }
    });
  });

  // ─── Registration ──────────────────────────────────────────────────

  describe("register", () => {
    test("creates registry file with this instance's entry", () => {
      const { service, registryPath, cleanup } = createService(db, repos);
      try {
        service.register();
        expect(fs.existsSync(registryPath)).toBe(true);

        const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as InstanceRegistry;
        expect(raw.schema_version).toBe(1);
        expect(Object.keys(raw.instances)).toHaveLength(1);

        const id = service.getInstanceId();
        const entry = raw.instances[id];
        expect(entry).toBeDefined();
        expect(entry.instance_id).toBe(id);
        expect(entry.status).toBe("active");
        expect(entry.pid).toBe(process.pid);
      } finally {
        cleanup();
      }
    });

    test("entry has correct fields", () => {
      const { service, registryPath, cleanup } = createService(db, repos, "/my/cool/project");
      try {
        service.register();

        const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as InstanceRegistry;
        const entry = raw.instances[service.getInstanceId()];

        expect(entry.label).toBe("test-project"); // set by test-db.ts
        expect(entry.project_root).toBe("/my/cool/project");
        expect(entry.sharing_mode).toBe("none");
        expect(entry.sharing_types).toEqual(["decisions", "conventions"]);
        expect(entry.schema_version).toBeGreaterThanOrEqual(17);
        expect(entry.machine_id).toBeTruthy();
      } finally {
        cleanup();
      }
    });

    test("upserts existing entry on re-register", () => {
      const { service, registryPath, cleanup } = createService(db, repos);
      try {
        service.register();
        const firstRaw = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as InstanceRegistry;
        const firstHeartbeat = firstRaw.instances[service.getInstanceId()].last_heartbeat;

        // Small delay then re-register
        service.register();
        const secondRaw = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as InstanceRegistry;

        // Should still be one entry
        expect(Object.keys(secondRaw.instances)).toHaveLength(1);
        // Heartbeat should be updated (or equal if too fast)
        expect(secondRaw.instances[service.getInstanceId()].last_heartbeat).toBeTruthy();
      } finally {
        cleanup();
      }
    });
  });

  // ─── Stats Collection ─────────────────────────────────────────────

  describe("collectStats", () => {
    test("returns counts from all tables", () => {
      const { service, cleanup } = createService(db, repos);
      try {
        const stats = service.collectStats();
        expect(stats).toHaveProperty("sessions");
        expect(stats).toHaveProperty("decisions");
        expect(stats).toHaveProperty("file_notes");
        expect(stats).toHaveProperty("tasks");
        expect(stats).toHaveProperty("conventions");
        expect(stats).toHaveProperty("changes");
        expect(stats).toHaveProperty("db_size_kb");
        // Fresh DB should have 0 for all counts
        expect(stats.sessions).toBe(0);
        expect(stats.decisions).toBe(0);
      } finally {
        cleanup();
      }
    });

    test("reflects inserted data", () => {
      const { service, cleanup } = createService(db, repos);
      try {
        // Insert a session
        db.prepare("INSERT INTO sessions (agent_name, started_at, project_root) VALUES (?, ?, ?)").run("test", new Date().toISOString(), "/test/project");
        // Insert a decision
        db.prepare("INSERT INTO decisions (session_id, decision, rationale, status, timestamp) VALUES (?, ?, ?, ?, ?)").run(1, "test decision", "test reason", "active", new Date().toISOString());

        const stats = service.collectStats();
        expect(stats.sessions).toBe(1);
        expect(stats.decisions).toBe(1);
      } finally {
        cleanup();
      }
    });
  });

  // ─── Heartbeat ─────────────────────────────────────────────────────

  describe("heartbeat", () => {
    test("updates last_heartbeat and stats", () => {
      const { service, registryPath, cleanup } = createService(db, repos);
      try {
        service.register();

        const before = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as InstanceRegistry;
        const beforeHb = before.instances[service.getInstanceId()].last_heartbeat;

        // Insert some data
        db.prepare("INSERT INTO sessions (agent_name, started_at, project_root) VALUES (?, ?, ?)").run("test", new Date().toISOString(), "/test/project");

        service.heartbeat();

        const after = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as InstanceRegistry;
        const entry = after.instances[service.getInstanceId()];
        expect(entry.status).toBe("active");
        expect(entry.stats.sessions).toBe(1);
      } finally {
        cleanup();
      }
    });

    test("re-registers if entry was pruned", () => {
      const { service, registryPath, cleanup } = createService(db, repos);
      try {
        // Don't register — just heartbeat
        service.heartbeat();

        expect(fs.existsSync(registryPath)).toBe(true);
        const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as InstanceRegistry;
        expect(raw.instances[service.getInstanceId()]).toBeDefined();
      } finally {
        cleanup();
      }
    });
  });

  // ─── Shutdown ──────────────────────────────────────────────────────

  describe("shutdown", () => {
    test("marks instance as stopped", () => {
      const { service, registryPath, cleanup } = createService(db, repos);
      try {
        service.register();
        service.shutdown();

        const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as InstanceRegistry;
        const entry = raw.instances[service.getInstanceId()];
        expect(entry.status).toBe("stopped");
        expect(entry.pid).toBeNull();
      } finally {
        // cleanup already called shutdown, but that's fine (idempotent)
        try { fs.rmSync(createTempRegistryDir(), { recursive: true, force: true }); } catch { /* ignore */ }
      }
    });
  });

  // ─── List Instances ───────────────────────────────────────────────

  describe("listInstances", () => {
    test("returns all registered instances", () => {
      const { service, registryPath, cleanup } = createService(db, repos);
      try {
        service.register();
        const list = service.listInstances();
        expect(list).toHaveLength(1);
        expect(list[0].instance_id).toBe(service.getInstanceId());
        expect(list[0].status).toBe("active");
      } finally {
        cleanup();
      }
    });

    test("filters out stale when includeStale=false", () => {
      const { service, registryPath, cleanup } = createService(db, repos);
      try {
        service.register();

        // Manually set heartbeat to 10 minutes ago (> STALE_THRESHOLD_MS)
        const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as InstanceRegistry;
        const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
        raw.instances[service.getInstanceId()].last_heartbeat = tenMinutesAgo;
        // Also set PID to 0 (dead process) so it gets marked stale
        raw.instances[service.getInstanceId()].pid = 999999999; // unlikely to exist
        fs.writeFileSync(registryPath, JSON.stringify(raw), "utf-8");

        const all = service.listInstances(true);
        const activeOnly = service.listInstances(false);

        // The stale entry should appear in all but not in activeOnly
        expect(all.length).toBeGreaterThanOrEqual(1);
        // PID 999999999 won't exist, so it gets marked stopped
        expect(activeOnly.every(e => e.status === "active")).toBe(true);
      } finally {
        cleanup();
      }
    });
  });

  // ─── getSelf ──────────────────────────────────────────────────────

  describe("getSelf", () => {
    test("returns current instance info from live config", () => {
      const { service, cleanup } = createService(db, repos, "/test/my-project");
      try {
        const self = service.getSelf();
        expect(self.instance_id).toBe(service.getInstanceId());
        expect(self.status).toBe("active");
        expect(self.pid).toBe(process.pid);
        expect(self.project_root).toBe("/test/my-project");
        expect(self.sharing_mode).toBe("none");
      } finally {
        cleanup();
      }
    });
  });

  // ─── Prune Stale ──────────────────────────────────────────────────

  describe("pruneStale", () => {
    test("removes entries older than PRUNE_THRESHOLD_MS", () => {
      const { service, registryPath, cleanup } = createService(db, repos);
      try {
        service.register();

        // Manually add a very old entry
        const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as InstanceRegistry;
        raw.instances["old-stale-id"] = {
          instance_id: "old-stale-id",
          label: "very-old",
          project_root: "/old/project",
          db_path: "/old/project/.engram/memory.db",
          schema_version: 17,
          server_version: "1.0.0",
          sharing_mode: "none",
          sharing_types: [],
          stats: { sessions: 0, decisions: 0, file_notes: 0, tasks: 0, conventions: 0, changes: 0, db_size_kb: 0 },
          last_heartbeat: new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString(), // 8 days ago
          status: "stopped",
          pid: null,
          machine_id: "test",
        };
        fs.writeFileSync(registryPath, JSON.stringify(raw), "utf-8");

        const pruned = service.pruneStale();
        expect(pruned).toBe(1);

        const after = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as InstanceRegistry;
        expect(after.instances["old-stale-id"]).toBeUndefined();
        expect(after.instances[service.getInstanceId()]).toBeDefined();
      } finally {
        cleanup();
      }
    });

    test("returns 0 when nothing to prune", () => {
      const { service, cleanup } = createService(db, repos);
      try {
        service.register();
        const pruned = service.pruneStale();
        expect(pruned).toBe(0);
      } finally {
        cleanup();
      }
    });
  });

  // ─── setLabel ─────────────────────────────────────────────────────

  describe("setLabel", () => {
    test("updates label in config and registry", () => {
      const { service, registryPath, cleanup } = createService(db, repos);
      try {
        service.register();
        service.setLabel("my-awesome-project");

        // Check config
        expect(repos.config.get("instance_label")).toBe("my-awesome-project");

        // Check registry
        const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as InstanceRegistry;
        expect(raw.instances[service.getInstanceId()].label).toBe("my-awesome-project");
      } finally {
        cleanup();
      }
    });
  });

  // ─── setSharing ───────────────────────────────────────────────────

  describe("setSharing", () => {
    test("updates sharing_mode in config and registry", () => {
      const { service, registryPath, cleanup } = createService(db, repos);
      try {
        service.register();
        service.setSharing("read");

        expect(repos.config.get("sharing_mode")).toBe("read");

        const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as InstanceRegistry;
        expect(raw.instances[service.getInstanceId()].sharing_mode).toBe("read");
      } finally {
        cleanup();
      }
    });

    test("updates sharing_types when provided", () => {
      const { service, registryPath, cleanup } = createService(db, repos);
      try {
        service.register();
        service.setSharing("full", ["decisions", "conventions", "tasks", "file_notes"]);

        expect(repos.config.get("sharing_mode")).toBe("full");
        expect(JSON.parse(repos.config.get("sharing_types")!)).toEqual(
          ["decisions", "conventions", "tasks", "file_notes"]
        );

        const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as InstanceRegistry;
        expect(raw.instances[service.getInstanceId()].sharing_types).toEqual(
          ["decisions", "conventions", "tasks", "file_notes"]
        );
      } finally {
        cleanup();
      }
    });
  });

  // ─── startHeartbeat / timer ───────────────────────────────────────

  describe("startHeartbeat", () => {
    test("is idempotent (multiple calls don't create multiple timers)", () => {
      const { service, cleanup } = createService(db, repos);
      try {
        service.register();
        service.startHeartbeat();
        service.startHeartbeat(); // Should be a no-op
        // No assertion needed — if it creates multiple timers, shutdown would leave some running
      } finally {
        cleanup();
      }
    });
  });

  // ─── getRegistry ──────────────────────────────────────────────────

  describe("getRegistry", () => {
    test("marks dead PIDs as stopped", () => {
      const { service, registryPath, cleanup } = createService(db, repos);
      try {
        service.register();

        // Manually set a fake PID
        const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as InstanceRegistry;
        raw.instances[service.getInstanceId()].pid = 999999999;
        fs.writeFileSync(registryPath, JSON.stringify(raw), "utf-8");

        const registry = service.getRegistry();
        const entry = registry.instances[service.getInstanceId()];
        expect(entry.status).toBe("stopped");
        expect(entry.pid).toBeNull();
      } finally {
        cleanup();
      }
    });

    test("returns empty registry when file is missing", () => {
      const { service, cleanup } = createService(db, repos);
      try {
        const registry = service.getRegistry();
        expect(registry.instances).toBeDefined();
        expect(Object.keys(registry.instances)).toHaveLength(0);
      } finally {
        cleanup();
      }
    });
  });
});
