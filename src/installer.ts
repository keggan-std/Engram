import fs from "fs";
import path from "path";
import os from "os";

const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, ".config");

// ─── IDE Config Locations ────────────────────────────────────────────

const IDE_CONFIGS: Record<string, any> = {
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
    visualstudio: {
        name: "Visual Studio 2022",
        paths: [
            path.join(HOME, ".mcp.json"), // Global config for Visual Studio
        ],
        format: "servers",
    },
};

// ─── Engram Entry ────────────────────────────────────────────────────

function makeEngramEntry(format: string) {
    const entry = {
        command: "npx",
        args: ["-y", "engram-mcp-server"],
    };

    if (format === "servers") {
        // VS Code uses a slightly different shape
        return { type: "stdio", ...entry };
    }

    return entry;
}

// ─── Config Manipulation ─────────────────────────────────────────────

function readJson(filePath: string) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
        return null;
    }
}

function writeJson(filePath: string, data: any) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function addToConfig(configPath: string, format: string) {
    let config = readJson(configPath) || {};
    const key = format; // "mcpServers" or "servers"

    if (!config[key]) config[key] = {};

    if (config[key].engram) {
        // Already exists — update to use npx
        config[key].engram = makeEngramEntry(format);
        writeJson(configPath, config);
        return "updated";
    }

    config[key].engram = makeEngramEntry(format);
    writeJson(configPath, config);
    return "added";
}

// ─── Main ────────────────────────────────────────────────────────────

export function runInstaller(args: string[]) {
    if (args.includes("--list")) {
        console.log("\nEngram can be auto-installed into these IDEs:\n");
        for (const [id, ide] of Object.entries(IDE_CONFIGS)) {
            const found = ide.paths.find((p: string) => fs.existsSync(p) || fs.existsSync(path.dirname(p)));
            console.log(`  ${id.padEnd(15)} ${ide.name} ${found ? "✅ detected" : "❌ not found"}`);
        }
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

    let installed = 0;

    for (const [id, ide] of Object.entries(idesToProcess)) {
        const configPath = ide.paths.find((p: string) => fs.existsSync(p)) || ide.paths[0];

        try {
            const result = addToConfig(configPath, ide.format);
            console.log(`\n   ✅ ${ide.name}`);
            console.log(`      Config: ${configPath}`);
            console.log(`      Status: ${result === "added" ? "Engram added" : "Engram config updated to use npx"}`);
            installed++;
        } catch (e: any) {
            console.log(`\n   ⚠️  ${ide.name}`);
            console.log(`      Could not write to: ${configPath}`);
            console.log(`      Reason: ${e.message}`);
        }
    }

    if (installed === 0) {
        console.log("\n   No supported IDEs were found on this machine.");
        console.log("   Run 'npx -y engram-mcp-server --list' to see what was detected.\n");
    } else {
        console.log(`\n✅ Done! Engram configured in ${installed} IDE(s).`);
        console.log("   Restart your IDE(s) to load Engram.\n");
    }
}
