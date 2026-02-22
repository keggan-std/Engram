// ============================================================================
// Engram MCP Server — Config File Manipulation
// ============================================================================

import fs from "fs";
import path from "path";
import type { IdeDefinition } from "./ide-configs.js";

/**
 * Generate the Engram server entry tailored to a specific IDE's requirements.
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

/**
 * Add or update the Engram entry in a config file.
 * Uses the IDE's configKey ("mcpServers" or "servers") to write the correct JSON structure.
 * Returns: "added", "updated", or "exists".
 */
export function addToConfig(configPath: string, ide: IdeDefinition): "added" | "updated" | "exists" {
    let config: Record<string, any> = readJson(configPath) || {};
    const key = ide.configKey;

    if (!config[key]) config[key] = {};

    const newEntry = makeEngramEntry(ide);

    if (config[key].engram) {
        if (JSON.stringify(config[key].engram) === JSON.stringify(newEntry)) {
            return "exists";
        }
        config[key].engram = newEntry;
        writeJson(configPath, config);
        return "updated";
    }

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
