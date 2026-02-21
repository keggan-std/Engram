#!/usr/bin/env node
// ============================================================================
// Engram — IDE Auto-Installer
// Adds Engram to your IDE's MCP config with the correct path automatically.
//
// Usage:
//   node scripts/install-mcp.js               (auto-detects IDEs)
//   node scripts/install-mcp.js --ide cursor  (specific IDE)
//   node scripts/install-mcp.js --list        (show detected IDEs)
// ============================================================================

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGRAM_DIST = path.resolve(__dirname, "..", "dist", "index.js");
const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, ".config");

// ─── IDE Config Locations ────────────────────────────────────────────

const IDE_CONFIGS = {
    antigravity: {
        name: "Antigravity IDE",
        paths: [
            path.join(HOME, ".gemini", "antigravity", "mcp_config.json"),
        ],
        format: "mcpServers",
    },
    cursor: {
        name: "Cursor",
        paths: [
            path.join(HOME, ".cursor", "mcp.json"),
            path.join(APPDATA, "Cursor", "mcp.json"),
        ],
        format: "mcpServers",
    },
    vscode: {
        name: "VS Code (Copilot)",
        paths: [
            path.join(APPDATA, "Code", "User", "mcp.json"),
            path.join(HOME, ".vscode", "mcp.json"),
        ],
        format: "servers",
    },
    cline: {
        name: "Cline / Roo Code",
        paths: [
            path.join(APPDATA, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
            path.join(HOME, ".cline", "mcp_settings.json"),
        ],
        format: "mcpServers",
    },
    windsurf: {
        name: "Windsurf",
        paths: [
            path.join(HOME, ".codeium", "windsurf", "mcp_config.json"),
            path.join(APPDATA, "Windsurf", "mcp.json"),
        ],
        format: "mcpServers",
    },
};

// ─── Engram Entry ────────────────────────────────────────────────────

function makeEngramEntry(format) {
    const entry = {
        command: "node",
        args: [ENGRAM_DIST.replace(/\\/g, "/")],
        env: {},
    };

    if (format === "servers") {
        // VS Code uses a slightly different shape
        return { type: "stdio", ...entry };
    }

    return entry;
}

// ─── Config Manipulation ─────────────────────────────────────────────

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
        return null;
    }
}

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function addToConfig(configPath, format) {
    let config = readJson(configPath) || {};
    const key = format; // "mcpServers" or "servers"

    if (!config[key]) config[key] = {};

    if (config[key].engram) {
        // Already exists — update the path
        config[key].engram.args = [ENGRAM_DIST.replace(/\\/g, "/")];
        writeJson(configPath, config);
        return "updated";
    }

    config[key].engram = makeEngramEntry(format);
    writeJson(configPath, config);
    return "added";
}

// ─── Main ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes("--list")) {
    console.log("\nEngram can be installed into these IDEs:\n");
    for (const [id, ide] of Object.entries(IDE_CONFIGS)) {
        const found = ide.paths.find(p => fs.existsSync(p) || fs.existsSync(path.dirname(p)));
        console.log(`  ${id.padEnd(15)} ${ide.name} ${found ? "✅ detected" : "❌ not found"}`);
    }
    console.log(`\nEngram path: ${ENGRAM_DIST}`);
    process.exit(0);
}

// Specific IDE requested?
const ideFlagIdx = args.indexOf("--ide");
const targetIde = ideFlagIdx >= 0 ? args[ideFlagIdx + 1] : null;

const idesToProcess = targetIde
    ? (IDE_CONFIGS[targetIde] ? { [targetIde]: IDE_CONFIGS[targetIde] } : null)
    : IDE_CONFIGS;

if (!idesToProcess) {
    console.error(`Unknown IDE: "${targetIde}". Options: ${Object.keys(IDE_CONFIGS).join(", ")}`);
    process.exit(1);
}

console.log("\n🧠 Engram MCP Installer\n");
console.log(`   Engram path: ${ENGRAM_DIST}`);
if (!fs.existsSync(ENGRAM_DIST)) {
    console.error(`\n❌ Engram dist not found at: ${ENGRAM_DIST}`);
    console.error("   Run 'npm run build' first.\n");
    process.exit(1);
}

let installed = 0;

for (const [id, ide] of Object.entries(idesToProcess)) {
    const configPath = ide.paths.find(p => fs.existsSync(p)) || ide.paths[0];

    try {
        const result = addToConfig(configPath, ide.format);
        console.log(`\n   ✅ ${ide.name}`);
        console.log(`      Config: ${configPath}`);
        console.log(`      Status: ${result === "added" ? "Engram added" : "Engram path updated"}`);
        installed++;
    } catch (e) {
        console.log(`\n   ⚠️  ${ide.name}`);
        console.log(`      Could not write to: ${configPath}`);
        console.log(`      Reason: ${e.message}`);
    }
}

if (installed === 0) {
    console.log("\n   No supported IDEs were found on this machine.");
    console.log("   Run 'node scripts/install-mcp.js --list' to see what was detected.\n");
} else {
    console.log(`\n✅ Done! Engram installed into ${installed} IDE(s).`);
    console.log("   Restart your IDE(s) to load Engram.\n");
}
