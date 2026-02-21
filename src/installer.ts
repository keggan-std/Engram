import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";

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
    let config: Record<string, any> = readJson(configPath) || {};
    const key = format; // "mcpServers" or "servers"

    if (!config[key]) config[key] = {};

    const newEntry = makeEngramEntry(format);

    if (config[key].engram) {
        // Already exists — check if it's identical
        if (JSON.stringify(config[key].engram) === JSON.stringify(newEntry)) {
            return "exists";
        }

        // Exists but different (e.g. old local path) — update to use npx
        config[key].engram = newEntry;
        writeJson(configPath, config);
        return "updated";
    }

    config[key].engram = newEntry;
    writeJson(configPath, config);
    return "added";
}

// ─── Environment Detection ──────────────────────────────────────────

function detectCurrentIde(): string | null {
    const env = process.env;

    // Explicit hints usually present in extension hosts or integrated terminals
    if (env.ANTIGRAVITY_EDITOR_APP_ROOT) return "antigravity";
    if (env.WINDSURF_PROFILE) return "windsurf";

    // VS Code forks share TERM_PROGRAM="vscode", but we can distinguish them by checking VSCODE_CWD or path
    if (env.TERM_PROGRAM === "vscode" || env.VSCODE_IPC_HOOK || env.VSCODE_CWD) {
        const cwdLower = (env.VSCODE_CWD || "").toLowerCase();
        if (cwdLower.includes("antigravity")) return "antigravity";
        if (cwdLower.includes("cursor")) return "cursor";
        if (cwdLower.includes("windsurf")) return "windsurf";

        // Final fallback: check PATH but ONLY for the specific IDE execution paths, not generically
        const pathLower = (env.PATH || "").toLowerCase();
        if (pathLower.includes("antigravity")) return "antigravity";
        if (pathLower.includes("cursor\\cli")) return "cursor"; // more specific to avoid false positives
        if (pathLower.includes("windsurf")) return "windsurf";

        return "vscode";
    }

    return null;
}

// ─── Main ────────────────────────────────────────────────────────────

async function askQuestion(query: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

export async function runInstaller(args: string[]) {
    if (args.includes("--list")) {
        console.log("\nEngram can be auto-installed into these IDEs:\n");
        for (const [id, ide] of Object.entries(IDE_CONFIGS)) {
            const found = ide.paths.find((p: string) => fs.existsSync(p) || fs.existsSync(path.dirname(p)));
            console.log(`  ${id.padEnd(15)} ${ide.name} ${found ? "✅ detected" : "❌ not found"}`);
        }
        process.exit(0);
    }

    // Specific IDE requested via CLI flag?
    const ideFlagIdx = args.indexOf("--ide");
    if (ideFlagIdx >= 0 && args[ideFlagIdx + 1]) {
        const targetIde = args[ideFlagIdx + 1];
        if (!IDE_CONFIGS[targetIde]) {
            console.error(`Unknown IDE: "${targetIde}". Options: ${Object.keys(IDE_CONFIGS).join(", ")}`);
            process.exit(1);
        }
        await performInstallation({ [targetIde]: IDE_CONFIGS[targetIde] });
        return;
    }

    console.log("\n🧠 Engram MCP Installer\n");

    // Auto-detect environment if it's run without specific args
    const currentIde = detectCurrentIde();

    if (currentIde && IDE_CONFIGS[currentIde]) {
        console.log(`🔍 Detected environment: ${IDE_CONFIGS[currentIde].name}`);
        const ans = await askQuestion("   Install Engram for this IDE? [Y/n]: ");

        if (ans.trim().toLowerCase() !== 'n') {
            await performInstallation({ [currentIde]: IDE_CONFIGS[currentIde] });
            return;
        }
        console.log(""); // Skip to menu
    }

    // Interactive Menu
    console.log("Where would you like to configure the Engram MCP server?\n");

    const ideKeys = Object.keys(IDE_CONFIGS);
    ideKeys.forEach((key, index) => {
        console.log(`  ${index + 1}. ${IDE_CONFIGS[key].name}`);
    });

    const allOpt = ideKeys.length + 1;
    const customOpt = ideKeys.length + 2;

    console.log(`  ${allOpt}. Install to ALL detected IDEs`);
    console.log(`  ${customOpt}. Custom IDE config path...`);
    console.log(`  0. Cancel`);

    const answer = await askQuestion(`\nSelect an option [0-${customOpt}]: `);
    const choice = parseInt(answer.trim(), 10);

    if (isNaN(choice) || choice === 0) {
        console.log("Installation cancelled.");
        process.exit(0);
    }

    let idesToProcess: Record<string, any> = {};

    if (choice === allOpt) {
        idesToProcess = IDE_CONFIGS; // All
    } else if (choice === customOpt) {
        const customPath = await askQuestion("Enter the absolute path to your MCP config JSON file: ");
        if (!customPath.trim()) {
            console.log("No path provided. Exiting.");
            process.exit(1);
        }
        idesToProcess = {
            custom: {
                name: "Custom Path",
                paths: [customPath.trim()],
                format: "mcpServers" // Safe default for unknown IDEs
            }
        };
    } else if (choice >= 1 && choice <= ideKeys.length) {
        const selectedKey = ideKeys[choice - 1];
        idesToProcess = { [selectedKey]: IDE_CONFIGS[selectedKey] };
    } else {
        console.log("\nInvalid selection. Exiting.");
        process.exit(1);
    }

    await performInstallation(idesToProcess);
}

async function performInstallation(idesToProcess: Record<string, any>) {
    let installed = 0;

    for (const [id, ide] of Object.entries(idesToProcess)) {
        const configPath = ide.paths.find((p: string) => fs.existsSync(p)) || ide.paths[0];

        try {
            const result = addToConfig(configPath, ide.format);
            console.log(`\n   ✅ ${ide.name}`);
            console.log(`      Config: ${configPath}`);

            let statusText = "";
            if (result === "added") statusText = "Engram added";
            else if (result === "updated") statusText = "Engram config updated to use npx";
            else if (result === "exists") statusText = "Engram is already installed and up to date";

            console.log(`      Status: ${statusText}`);

            if (result !== "exists") {
                installed++;
            }
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
