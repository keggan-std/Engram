// ============================================================================
// Engram MCP Server — Config File Manipulation
// ============================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { IdeDefinition } from "./ide-configs.js";

/**
 * FLAW-15 FIX: Read version from package.json relative to the dist output,
 * but fall back to the SERVER_VERSION constant as the single source of truth.
 * This is resilient to build output structure changes.
 */
export function getInstallerVersion(): string {
    try {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        // Try dist/installer/ → ../../package.json (standard build layout)
        for (const rel of ["../../package.json", "../../../package.json", "../../../../package.json"]) {
            const pkgPath = path.resolve(__dirname, rel);
            if (fs.existsSync(pkgPath)) {
                const ver = JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version as string | undefined;
                if (ver) return ver;
            }
        }
        return "unknown";
    } catch {
        return "unknown";
    }
}

/**
 * Generate the Engram server entry tailored to a specific IDE's requirements.
 * Includes _engram_version so the installer can detect upgrades and legacy installs.
 *
 * FLAW-4 FIX: When the IDE definition has a workspaceVar, it is injected as
 * `--project-root=<var>`. At runtime the IDE expands the variable to the actual
 * workspace path before spawning the server, so findProjectRoot() receives the
 * correct root with no heuristics needed.
 *
 * ideKey: when provided (global-only IDEs without workspaceVar), `--ide=<key>` is
 * injected so the server opens a per-IDE DB shard (memory-{key}.db), eliminating
 * write-lock contention between different IDEs concurrently open on the same project.
 *
 * @param ide        IDE definition (controls type, cmd wrapper, workspaceVar, etc.)
 * @param universal  When true, adds --mode=universal to args.
 * @param ideKey     When provided, adds --ide=<ideKey> to args.
 */
export function makeEngramEntry(ide: IdeDefinition, universal = false, ideKey?: string): Record<string, any> {
    const entry: Record<string, any> = {};

    // Some IDEs require explicit "type": "stdio"
    if (ide.requiresType) {
        entry.type = "stdio";
    }

    // Build args
    const baseArgs = ["-y", "engram-mcp-server"];
    if (universal) {
        baseArgs.push("--mode=universal");
    }
    // FLAW-4 FIX: inject workspace root variable when the IDE supports it.
    // The IDE expands this variable at spawn time (e.g. ${workspaceFolder} →
    // /path/to/project) so the server always receives the correct project path.
    if (ide.workspaceVar) {
        baseArgs.push(`--project-root=${ide.workspaceVar}`);
    }

  // Per-IDE DB shard: global installs on IDEs without workspaceVar inject --ide=<key>
  // so each IDE type opens memory-{key}.db, preventing write-lock contention between
  // different IDEs open on the same project simultaneously.
  if (ideKey) {
    baseArgs.push(`--ide=${ideKey}`);
  }

    // Windows cmd /c wrapper for npx (npx is a .cmd on Windows)
    if (ide.requiresCmdWrapper) {
        entry.command = "cmd";
        entry.args = ["/c", "npx", ...baseArgs];
    } else {
        entry.command = "npx";
        entry.args = [...baseArgs];
    }

    // Version stamp — used by the installer to detect upgrades and legacy installs
    entry._engram_version = getInstallerVersion();
    if (universal) {
        entry._engram_mode = "universal";
    }

    return entry;
}

/**
 * Read and parse a JSON config file.
 * FLAW-8 FIX: distinguish between "file not found" and "file has invalid JSON".
 * Returns:
 *   null    — file does not exist (safe to create fresh)
 *   object  — parsed successfully
 * Throws ParseError (with .isParseError = true) when the file exists but
 *   contains invalid JSON — callers should warn and bail rather than
 *   silently overwriting the user's config.
 */
export class ConfigParseError extends Error {
    constructor(public readonly filePath: string, public readonly cause: unknown) {
        super(`Failed to parse JSON config at ${filePath}: ${cause}`);
        this.name = "ConfigParseError";
    }
}

export function readJson(filePath: string): Record<string, any> | null {
    if (!fs.existsSync(filePath)) return null; // file not found — safe to create
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (e) {
        // File exists but is invalid JSON — signal this distinctly
        throw new ConfigParseError(filePath, e);
    }
}

/**
 * Write a JSON config file, creating parent directories if needed.
 */
export function writeJson(filePath: string, data: any): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export type InstallResult = "added" | "upgraded" | "exists" | "legacy-upgraded";

/**
 * Add or update the Engram entry in a config file.
 * FLAW-8 FIX: if the config file exists but has invalid JSON, back it up
 * before overwriting so the user doesn't lose their other tool configs.
 *
 * Returns:
 *   "added"           — fresh install, no prior entry
 *   "exists"          — already installed at the same version, no changes made
 *   "upgraded"        — updated from an older tracked version to the current one
 *   "legacy-upgraded" — entry existed but had no _engram_version (pre-tracking era)
 */
export function addToConfig(configPath: string, ide: IdeDefinition, universal = false, ideKey?: string): InstallResult {
    let config: Record<string, any>;
    try {
        config = readJson(configPath) ?? {};
    } catch (e) {
        if (e instanceof ConfigParseError) {
            // Backup the broken file then start fresh
            const ts = new Date().toISOString().replace(/[:.]/g, "-");
            const bakPath = configPath + `.invalid.${ts}.bak`;
            try { fs.copyFileSync(configPath, bakPath); } catch { /* best-effort */ }
            console.warn(`[Engram] Config at ${configPath} contains invalid JSON.`);
            console.warn(`         Backed up to: ${bakPath}`);
            console.warn(`         Writing a fresh config with only the Engram entry.`);
            config = {};
        } else {
            throw e;
        }
    }

    const key = ide.configKey;
    if (!config[key]) config[key] = {};

    const newEntry = makeEngramEntry(ide, universal, ideKey);
    const currentVersion = newEntry._engram_version as string;

    if (config[key].engram) {
        const existingVersion = config[key].engram._engram_version as string | undefined;

        // Same version already installed — nothing to do
        if (existingVersion === currentVersion) {
            return "exists";
        }

        // Upgrade (known older version) or legacy adoption (no _engram_version)
        config[key].engram = newEntry;
        writeJson(configPath, config);
        return existingVersion ? "upgraded" : "legacy-upgraded";
    }

    // No prior entry at all — fresh install
    config[key].engram = newEntry;
    writeJson(configPath, config);
    return "added";
}

/**
 * Remove the Engram entry from a config file.
 * Returns true if the entry was found and removed, false if not present.
 */
export function removeFromConfig(configPath: string, ide: IdeDefinition): boolean {
    const config = readJson(configPath);
    if (!config) return false;

    const key = ide.configKey;
    if (!config[key]?.engram) return false;

    delete config[key].engram;

    // Clean up empty wrapper key
    if (Object.keys(config[key]).length === 0) {
        delete config[key];
    }

    writeJson(configPath, config);
    return true;
}
