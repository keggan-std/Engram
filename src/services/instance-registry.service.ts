// ============================================================================
// Engram MCP Server — Instance Registry Service
// ============================================================================
// Manages the machine-wide instance registry at ~/.engram/instances.json.
// Each running Engram process registers itself and heartbeats periodically.
// The registry enables cross-instance discovery without any network server.
// ============================================================================

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Database as DatabaseType } from "better-sqlite3";
import type { ConfigRepo } from "../repositories/config.repo.js";
import type { InstanceEntry, InstanceRegistry, InstanceStats, SharingMode } from "../types.js";
import {
  CFG_INSTANCE_ID,
  CFG_INSTANCE_LABEL,
  CFG_MACHINE_ID,
  CFG_SHARING_MODE,
  CFG_SHARING_TYPES,
  INSTANCE_REGISTRY_DIR,
  INSTANCE_REGISTRY_FILE,
  HEARTBEAT_INTERVAL_MS,
  STALE_THRESHOLD_MS,
  PRUNE_THRESHOLD_MS,
  DEFAULT_SHARING_MODE,
  DEFAULT_SHARING_TYPES,
  DB_VERSION,
  SERVER_VERSION,
  DB_DIR_NAME,
  DB_FILE_NAME,
} from "../constants.js";
import { log } from "../logger.js";

// ─── Helpers ─────────────────────────────────────────────────────────

/** Resolve the registry directory: ~/.engram/ */
function getRegistryDir(): string {
  return path.join(os.homedir(), INSTANCE_REGISTRY_DIR);
}

/** Resolve the full path to instances.json */
function getRegistryPath(): string {
  return path.join(getRegistryDir(), INSTANCE_REGISTRY_FILE);
}

/** Check whether a process with the given PID is still running */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check, no signal sent
    return true;
  } catch {
    return false;
  }
}

/** Atomic file write: write to temp, then rename */
function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = filePath + `.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

// ============================================================================
// Service
// ============================================================================

export class InstanceRegistryService {
  private intervalId: NodeJS.Timeout | null = null;
  private instanceId: string | null = null;

  constructor(
    private config: ConfigRepo,
    private projectRoot: string,
    private db: DatabaseType,
  ) {}

  // ─── Core Identity ─────────────────────────────────────────────────

  /** Get this instance's ID from config (cached after first call) */
  getInstanceId(): string {
    if (!this.instanceId) {
      this.instanceId = this.config.get(CFG_INSTANCE_ID);
    }
    if (!this.instanceId) {
      throw new Error("[Engram] Instance ID not found in config. Was initDatabase() called?");
    }
    return this.instanceId;
  }

  // ─── Registry I/O ──────────────────────────────────────────────────

  /** Read the full registry from disk. Returns empty registry if file missing. */
  readRegistry(): InstanceRegistry {
    const registryPath = getRegistryPath();
    try {
      if (fs.existsSync(registryPath)) {
        const raw = fs.readFileSync(registryPath, "utf-8");
        const parsed = JSON.parse(raw) as InstanceRegistry;
        // Basic validation
        if (parsed && typeof parsed === "object" && parsed.instances) {
          return parsed;
        }
      }
    } catch (err) {
      log.warn(`Failed to read instance registry: ${err}`);
    }

    // Return empty registry
    return {
      schema_version: 1,
      machine_id: this.config.get(CFG_MACHINE_ID) ?? "unknown",
      last_updated: new Date().toISOString(),
      instances: {},
    };
  }

  /** Write the registry back to disk atomically */
  private writeRegistry(registry: InstanceRegistry): void {
    try {
      registry.last_updated = new Date().toISOString();
      atomicWriteJson(getRegistryPath(), registry);
    } catch (err) {
      log.warn(`Failed to write instance registry: ${err}`);
    }
  }

  // ─── Stats Collection ─────────────────────────────────────────────

  /** Collect lightweight stats from this instance's DB */
  collectStats(): InstanceStats {
    const count = (table: string): number => {
      try {
        const row = this.db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
        return row.c;
      } catch {
        return 0;
      }
    };

    let dbSizeKb = 0;
    try {
      const dbPath = path.join(this.projectRoot, DB_DIR_NAME, DB_FILE_NAME);
      const stat = fs.statSync(dbPath);
      dbSizeKb = Math.round(stat.size / 1024);
    } catch { /* file may not exist during tests */ }

    return {
      sessions: count("sessions"),
      decisions: count("decisions"),
      file_notes: count("file_notes"),
      tasks: count("tasks"),
      conventions: count("conventions"),
      changes: count("changes"),
      db_size_kb: dbSizeKb,
    };
  }

  // ─── Build Entry ──────────────────────────────────────────────────

  /** Build this instance's registry entry from config + live data */
  private buildEntry(): InstanceEntry {
    const sharingTypesRaw = this.config.get(CFG_SHARING_TYPES);
    let sharingTypes: string[];
    try {
      sharingTypes = sharingTypesRaw ? JSON.parse(sharingTypesRaw) : DEFAULT_SHARING_TYPES;
    } catch {
      sharingTypes = DEFAULT_SHARING_TYPES;
    }

    return {
      instance_id: this.getInstanceId(),
      label: this.config.get(CFG_INSTANCE_LABEL) ?? "unknown",
      project_root: this.projectRoot,
      db_path: path.join(this.projectRoot, DB_DIR_NAME, DB_FILE_NAME),
      schema_version: DB_VERSION,
      server_version: SERVER_VERSION,
      sharing_mode: (this.config.get(CFG_SHARING_MODE) ?? DEFAULT_SHARING_MODE) as SharingMode,
      sharing_types: sharingTypes,
      stats: this.collectStats(),
      last_heartbeat: new Date().toISOString(),
      status: "active",
      pid: process.pid,
      machine_id: this.config.get(CFG_MACHINE_ID) ?? "unknown",
    };
  }

  // ─── Public API ───────────────────────────────────────────────────

  /**
   * Register this instance in ~/.engram/instances.json.
   * Creates the registry if it doesn't exist. Upserts this instance's entry.
   */
  register(): void {
    try {
      const registry = this.readRegistry();
      registry.instances[this.getInstanceId()] = this.buildEntry();
      this.writeRegistry(registry);
      log.info(`Instance registered: ${this.getInstanceId()}`);
    } catch (err) {
      log.warn(`Failed to register instance: ${err}`);
    }
  }

  /**
   * Update heartbeat timestamp and stats for this instance.
   */
  heartbeat(): void {
    try {
      const registry = this.readRegistry();
      const id = this.getInstanceId();
      const existing = registry.instances[id];
      if (existing) {
        existing.last_heartbeat = new Date().toISOString();
        existing.status = "active";
        existing.pid = process.pid;
        existing.stats = this.collectStats();
        // Refresh sharing config in case it changed
        existing.sharing_mode = (this.config.get(CFG_SHARING_MODE) ?? DEFAULT_SHARING_MODE) as SharingMode;
        const sharingTypesRaw = this.config.get(CFG_SHARING_TYPES);
        try {
          existing.sharing_types = sharingTypesRaw ? JSON.parse(sharingTypesRaw) : DEFAULT_SHARING_TYPES;
        } catch {
          existing.sharing_types = DEFAULT_SHARING_TYPES;
        }
      } else {
        // Entry was pruned or registry was reset — re-register
        registry.instances[id] = this.buildEntry();
      }
      this.writeRegistry(registry);
    } catch (err) {
      log.warn(`Failed to heartbeat: ${err}`);
    }
  }

  /**
   * Start the periodic heartbeat (every HEARTBEAT_INTERVAL_MS).
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  startHeartbeat(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.heartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    // Don't prevent Node from exiting if only the heartbeat timer remains
    if (this.intervalId.unref) {
      this.intervalId.unref();
    }
  }

  /**
   * Stop heartbeat and mark this instance as stopped in the registry.
   * Called on process exit / graceful shutdown.
   */
  shutdown(): void {
    // Stop the timer
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Mark as stopped in registry
    try {
      const registry = this.readRegistry();
      const id = this.getInstanceId();
      const entry = registry.instances[id];
      if (entry) {
        entry.status = "stopped";
        entry.pid = null;
        entry.last_heartbeat = new Date().toISOString();
      }
      this.writeRegistry(registry);
      log.info(`Instance shutdown: ${id}`);
    } catch (err) {
      log.warn(`Failed to mark instance as stopped: ${err}`);
    }
  }

  /**
   * Get the full registry with live status enrichment.
   * Entries with stale heartbeats or dead PIDs are marked accordingly.
   */
  getRegistry(): InstanceRegistry {
    const registry = this.readRegistry();
    const now = Date.now();

    for (const entry of Object.values(registry.instances)) {
      if (entry.status === "stopped") continue;

      // Check PID liveness
      if (entry.pid && !isProcessAlive(entry.pid)) {
        entry.status = "stopped";
        entry.pid = null;
        continue;
      }

      // Check heartbeat staleness
      const heartbeatAge = now - new Date(entry.last_heartbeat).getTime();
      if (heartbeatAge > STALE_THRESHOLD_MS) {
        entry.status = "stale";
      }
    }

    return registry;
  }

  /**
   * Get just this instance's info (always from live config, not registry).
   */
  getSelf(): InstanceEntry {
    return this.buildEntry();
  }

  /**
   * List all known instances sorted by last heartbeat (newest first).
   * Enriches each entry with live status (active/stale/stopped).
   */
  listInstances(includeStale = true): InstanceEntry[] {
    const registry = this.getRegistry();
    let entries = Object.values(registry.instances);

    if (!includeStale) {
      entries = entries.filter(e => e.status === "active");
    }

    // Sort by last_heartbeat descending (most recent first)
    entries.sort((a, b) =>
      new Date(b.last_heartbeat).getTime() - new Date(a.last_heartbeat).getTime()
    );

    return entries;
  }

  /**
   * Remove entries with heartbeat older than PRUNE_THRESHOLD_MS (7 days).
   * Returns the number of entries pruned.
   */
  pruneStale(): number {
    const registry = this.readRegistry();
    const now = Date.now();
    let pruned = 0;

    for (const [id, entry] of Object.entries(registry.instances)) {
      const heartbeatAge = now - new Date(entry.last_heartbeat).getTime();
      if (heartbeatAge > PRUNE_THRESHOLD_MS) {
        delete registry.instances[id];
        pruned++;
      }
    }

    if (pruned > 0) {
      this.writeRegistry(registry);
      log.info(`Pruned ${pruned} stale instance(s) from registry`);
    }

    return pruned;
  }

  /**
   * Update this instance's human-readable label.
   * Writes to both config table and registry.
   */
  setLabel(label: string): void {
    this.config.set(CFG_INSTANCE_LABEL, label, new Date().toISOString());

    // Update registry too
    try {
      const registry = this.readRegistry();
      const entry = registry.instances[this.getInstanceId()];
      if (entry) {
        entry.label = label;
        this.writeRegistry(registry);
      }
    } catch (err) {
      log.warn(`Failed to update label in registry: ${err}`);
    }
  }

  /**
   * Update this instance's sharing configuration.
   * Writes to both config table and registry.
   */
  setSharing(mode: SharingMode, types?: string[]): void {
    const ts = new Date().toISOString();
    this.config.set(CFG_SHARING_MODE, mode, ts);
    if (types) {
      this.config.set(CFG_SHARING_TYPES, JSON.stringify(types), ts);
    }

    // Update registry too
    try {
      const registry = this.readRegistry();
      const entry = registry.instances[this.getInstanceId()];
      if (entry) {
        entry.sharing_mode = mode;
        if (types) {
          entry.sharing_types = types;
        }
        this.writeRegistry(registry);
      }
    } catch (err) {
      log.warn(`Failed to update sharing in registry: ${err}`);
    }
  }

  // ─── Static Helpers ───────────────────────────────────────────────

  /** Get the registry file path (useful for diagnostics) */
  static getRegistryPath(): string {
    return getRegistryPath();
  }
}
