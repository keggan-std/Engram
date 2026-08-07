// ============================================================================
// Tests — FR-D2 F4: the cross-instance read whitelist has one definition and
// every reader obeys it
// ============================================================================
//
// searchAll() used to re-implement checkPermission()'s tests inline and omit
// the QUERYABLE_TABLES check, so `scope` reached `SELECT * FROM ${scope}`
// unconstrained. PROVEN before the fix, against the built service: a foreign
// instance advertising sharing_types ["observations"] had its observations row
// returned by searchAll while checkPermission refused the same name.
//
// The binding below is deliberately NOT a list of blocked table names — that
// form re-states the policy a third time and rots the moment the policy moves.
// It asserts AGREEMENT: for every scope, checkPermission allows it if and only
// if searchAll allows it. A future reader that drifts fails this without anyone
// remembering to add a case for it.

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { createTestDb } from "../helpers/test-db.js";
import { runMigrations } from "../../src/migrations.js";
import { createRepositories, type Repositories } from "../../src/repositories/index.js";
import { InstanceRegistryService } from "../../src/services/instance-registry.service.js";
import { CrossInstanceService } from "../../src/services/cross-instance.service.js";
import { QUERYABLE_TABLES } from "../../src/constants.js";
import type { InstanceRegistry, InstanceEntry } from "../../src/types.js";

/** Real table names that exist in the schema but must never be readable cross-instance. */
const NOT_SHAREABLE = ["observations", "handoffs", "agents", "audit_log", "config"];

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "engram-f4-"));
}

function createForeignDb(dir: string, label: string): {
  dbPath: string; instanceId: string; repos: Repositories; db: Database.Database; projectRoot: string;
} {
  // Lives under <projectRoot>/.engram/memory.db so resolveDbPath() can find it
  // when a registry entry omits db_path — the second guard searchAll skipped.
  const projectRoot = path.join(dir, label);
  const engramDir = path.join(projectRoot, ".engram");
  fs.mkdirSync(engramDir, { recursive: true });
  const dbPath = path.join(engramDir, "memory.db");

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  runMigrations(db);
  const repos = createRepositories(db);
  const instanceId = randomUUID();
  const ts = new Date().toISOString();
  repos.config.set("instance_id", instanceId, ts);
  repos.config.set("instance_label", label, ts);
  repos.config.set("machine_id", "test-machine", ts);
  repos.config.set("sharing_mode", "read", ts);

  return { dbPath, instanceId, repos, db, projectRoot };
}

function patchRegistry(service: InstanceRegistryService, registryPath: string, repos: Repositories): void {
  service.readRegistry = (): InstanceRegistry => {
    try {
      if (fs.existsSync(registryPath)) {
        const parsed = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as InstanceRegistry;
        if (parsed?.instances) return parsed;
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
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf-8");
  };
}

describe("FR-D2 F4 — cross-instance scope whitelist", () => {
  let localDb: Database.Database;
  let localRepos: Repositories;
  let localCleanup: () => void;
  let dir: string;
  let registryService: InstanceRegistryService;
  let crossService: CrossInstanceService;
  let foreign: ReturnType<typeof createForeignDb>;

  /** Register the foreign instance advertising `types`, bypassing setSharing —
   *  this is the state a pre-fix store or a hand-edited instances.json leaves. */
  function registerForeign(types: string[], opts?: { omitDbPath?: boolean }): void {
    const registry = registryService.readRegistry();
    const entry: InstanceEntry = {
      instance_id: foreign.instanceId,
      label: "peer",
      project_root: foreign.projectRoot,
      db_path: opts?.omitDbPath ? (undefined as unknown as string) : foreign.dbPath,
      schema_version: 25,
      server_version: "1.12.0",
      sharing_mode: "read",
      sharing_types: types,
      stats: { sessions: 0, decisions: 0, file_notes: 0, tasks: 0, conventions: 0, changes: 0, db_size_kb: 0 },
      last_heartbeat: new Date().toISOString(),
      status: "active",
      pid: process.pid,
      machine_id: "test-machine",
    } as InstanceEntry;
    registry.instances[foreign.instanceId] = entry;
    (registryService as any).writeRegistry(registry);
  }

  const allows = (fn: () => unknown): boolean => {
    try { fn(); return true; } catch { return false; }
  };

  beforeEach(() => {
    const r = createTestDb();
    localDb = r.db; localRepos = r.repos; localCleanup = r.cleanup;
    dir = tempDir();
    registryService = new InstanceRegistryService(localRepos.config, "/test/local", localDb);
    patchRegistry(registryService, path.join(dir, "instances.json"), localRepos);
    registryService.register();
    crossService = new CrossInstanceService(registryService);
    foreign = createForeignDb(dir, "peer");
  });

  afterEach(() => {
    crossService.closeAll();
    registryService.shutdown();
    try { foreign.db.close(); } catch { /* ignore */ }
    localCleanup();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ─── The binding: two readers, one answer ──────────────────────────

  test("checkPermission and searchAll agree on every scope", () => {
    // The peer advertises EVERYTHING, whitelisted or not. Only the whitelist
    // may decide the outcome — that is the whole point of the test.
    const every = [...QUERYABLE_TABLES, ...NOT_SHAREABLE];
    registerForeign(every);

    const disagreements: string[] = [];
    for (const scope of every) {
      const viaCheck = allows(() => (crossService as any).checkPermission(foreign.instanceId, scope));
      const viaSearch = allows(() => crossService.searchAll("x", { scope, limit: 1 }));
      if (viaCheck !== viaSearch) {
        disagreements.push(`${scope}: checkPermission=${viaCheck} searchAll=${viaSearch}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  test("the agreement test is not vacuous — it exercises both outcomes", () => {
    registerForeign([...QUERYABLE_TABLES, ...NOT_SHAREABLE]);
    const results = [...QUERYABLE_TABLES, ...NOT_SHAREABLE].map(s =>
      allows(() => crossService.searchAll("x", { scope: s, limit: 1 }))
    );
    expect(results).toContain(true);   // something is readable
    expect(results).toContain(false);  // something is refused
  });

  // ─── The regression itself ─────────────────────────────────────────

  test("searchAll refuses a scope outside the whitelist even when advertised", () => {
    registerForeign(["observations"]);
    foreign.repos.observations.create(null, new Date().toISOString(), "finding", "PRIVATE leak canary");

    expect(() => crossService.searchAll("PRIVATE", { scope: "observations" }))
      .toThrow(/not a queryable type/);
  });

  test("a scope typo raises instead of reporting an empty search", () => {
    registerForeign([...QUERYABLE_TABLES]);
    // Pre-fix this returned [], indistinguishable from "searched, found nothing".
    expect(() => crossService.searchAll("x", { scope: "decisons" })).toThrow(/not a queryable type/);
  });

  // ─── Kill switch: the legitimate path must still work ──────────────

  test("KILL SWITCH — a shared, whitelisted scope still returns rows", () => {
    registerForeign(["decisions"]);
    foreign.repos.decisions.create(
      null, new Date().toISOString(), "Adopt the shared whitelist", "One policy, two doors"
    );

    const results = crossService.searchAll("whitelist", { scope: "decisions", limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0].source_instance_id).toBe(foreign.instanceId);
    expect(results[0].results.length).toBeGreaterThan(0);
  });

  test("a peer that does not share the scope is skipped, not fatal", () => {
    // Fan-out semantics: one peer declining must not fail the whole search.
    registerForeign(["conventions"]);
    expect(() => crossService.searchAll("x", { scope: "decisions" })).not.toThrow();
    expect(crossService.searchAll("x", { scope: "decisions" })).toEqual([]);
  });

  test("a peer with sharing_mode=none is skipped, not fatal", () => {
    registerForeign(["decisions"]);
    const reg = registryService.readRegistry();
    reg.instances[foreign.instanceId].sharing_mode = "none";
    (registryService as any).writeRegistry(reg);
    expect(crossService.searchAll("x", { scope: "decisions" })).toEqual([]);
  });

  test("searchAll resolves a missing db_path, as every other reader does", () => {
    // checkPermission's fourth guard, which searchAll also skipped: entries
    // written by pre-1.9.2 versions have no db_path and must be resolved from
    // project_root rather than passed to openReadOnly as undefined.
    registerForeign(["decisions"], { omitDbPath: true });
    foreign.repos.decisions.create(
      null, new Date().toISOString(), "Resolvable without db_path", "legacy registry entry"
    );

    const results = crossService.searchAll("Resolvable", { scope: "decisions", limit: 10 });
    expect(results.length).toBe(1);
  });

  // ─── The writer half ───────────────────────────────────────────────

  describe("setSharing", () => {
    test("refuses a type no reader will serve", () => {
      expect(() => registryService.setSharing("read", ["decisions", "observations"]))
        .toThrow(/not a shareable type/);
    });

    test("names the offending type and the valid set", () => {
      try {
        registryService.setSharing("read", ["audit_log"]);
        throw new Error("should have thrown");
      } catch (e) {
        expect((e as Error).message).toContain("'audit_log'");
        expect((e as Error).message).toContain("decisions");
      }
    });

    test("KILL SWITCH — still accepts every whitelisted type", () => {
      expect(() => registryService.setSharing("read", [...QUERYABLE_TABLES])).not.toThrow();
    });

    test("rejects the whole call rather than silently dropping the bad type", () => {
      const before = localRepos.config.get("sharing_types");
      try { registryService.setSharing("full", ["decisions", "observations"]); } catch { /* expected */ }
      expect(localRepos.config.get("sharing_types")).toBe(before);
    });
  });

  // ─── Legacy stores ─────────────────────────────────────────────────

  test("a type stored by an older version is dropped from the advertised entry", () => {
    const ts = new Date().toISOString();
    localRepos.config.set("sharing_types", JSON.stringify(["decisions", "observations"]), ts);
    const self = registryService.getSelf();
    expect(self.sharing_types).toEqual(["decisions"]);
  });

  test("an unparseable stored value falls back to the defaults", () => {
    localRepos.config.set("sharing_types", "{not json", new Date().toISOString());
    expect(registryService.getSelf().sharing_types).toEqual(["decisions", "conventions"]);
  });

  // ─── Derived, not restated (charter §2) ────────────────────────────

  test("the whitelist has exactly one definition in src/", () => {
    const files = ["src/constants.ts", "src/services/cross-instance.service.ts", "src/services/instance-registry.service.ts"];
    const definitions = files.filter(f =>
      /(?:const|let|var)\s+QUERYABLE_TABLES\s*(?::[^=]+)?=/.test(fs.readFileSync(f, "utf-8"))
    );
    expect(definitions).toEqual(["src/constants.ts"]);
  });

  test("both enforcement points import the shared list", () => {
    for (const f of ["src/services/cross-instance.service.ts", "src/services/instance-registry.service.ts"]) {
      const src = fs.readFileSync(f, "utf-8");
      expect(src, `${f} must use the shared whitelist`).toMatch(/QUERYABLE_TABLES/);
      expect(src, `${f} must import it from constants`).toMatch(/from\s+"\.\.\/constants\.js"/);
    }
  });
});
