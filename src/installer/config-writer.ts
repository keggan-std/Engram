// ============================================================================
// Engram MCP Server — Config File Manipulation
// ============================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { IdeDefinition } from "./ide-configs.js";

/** Read the installed package version (used to stamp _engram_version in IDE configs). */
export function getInstallerVersion(): string {
    try {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const pkgPath = path.resolve(__dirname, "../../package.json");
        return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version as string;
    } catch {
        return "unknown";
    }
}

/**
 * Generate the Engram server entry tailored to a specific IDE's requirements.
 * Includes _engram_version so the installer can detect upgrades and legacy installs.
 */
export function makeEngramEntry(ide: IdeDefinition): Record<string, any> {
    const entry: Record<string, any> = {};

    // Some IDEs require explicit "type": "stdio"
    if (ide.requiresType) {
        entry.type = "stdio";
    }

    // Windows cmd /c wrapper for npx (npx is a .cmd on Windows)
    if (ide.requiresCmdWrapper) {
        entry.command = "cmd";
        entry.args = ["/c", "npx", "-y", "engram-mcp-server"];
    } else {
        entry.command = "npx";
        entry.args = ["-y", "engram-mcp-server"];
    }

    // Version stamp — used by the installer to detect upgrades and legacy installs
    entry._engram_version = getInstallerVersion();

    return entry;
}

/**
 * Read and parse a JSON config file. Returns null if file doesn't exist or is invalid.
 */
export function readJson(filePath: string): Record<string, any> | null {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
        return null;
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
 * Uses the IDE's configKey ("mcpServers" or "servers") to write the correct JSON structure.
 *
 * Returns:
 *   "added"          — fresh install, no prior entry
 *   "exists"         — already installed at the same version, no changes made
 *   "upgraded"       — updated from an older tracked version to the current one
 *   "legacy-upgraded" — entry existed but had no _engram_version (pre-tracking era), now stamped
 */
export function addToConfig(configPath: string, ide: IdeDefinition): InstallResult {
    let config: Record<string, any> = readJson(configPath) || {};
    const key = ide.configKey;

    if (!config[key]) config[key] = {};

    const newEntry = makeEngramEntry(ide);
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
