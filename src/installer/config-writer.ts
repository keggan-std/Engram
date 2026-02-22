// ============================================================================
// Engram MCP Server — Config File Manipulation
// ============================================================================

import fs from "fs";
import path from "path";

/**
 * Generate the Engram server entry for a given config format.
 */
export function makeEngramEntry(format: string) {
    const entry = {
        command: "npx",
        args: ["-y", "engram-mcp-server"],
    };

    if (format === "servers") {
        return { type: "stdio", ...entry };
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
 * Returns: "added", "updated", or "exists".
 */
export function addToConfig(configPath: string, format: string): "added" | "updated" | "exists" {
    let config: Record<string, any> = readJson(configPath) || {};
    const key = format;

    if (!config[key]) config[key] = {};

    const newEntry = makeEngramEntry(format);

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
