// ============================================================================
// Engram MCP Server — Installer Orchestrator
// ============================================================================

import fs from "fs";
import path from "path";
import readline from "readline";
import { IDE_CONFIGS, type IdeDefinition } from "./ide-configs.js";
import { addToConfig, removeFromConfig, makeEngramEntry } from "./config-writer.js";
import { detectCurrentIde } from "./ide-detector.js";

// ─── Helpers ─────────────────────────────────────────────────────────

function isTTY(): boolean {
    return !!(process.stdin.isTTY && process.stdout.isTTY);
}

async function askQuestion(query: string): Promise<string> {
    if (!isTTY()) {
        // Non-interactive: return empty to use defaults
        return "";
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

// ─── Main Entry Point ────────────────────────────────────────────────

export async function runInstaller(args: string[]) {
    const nonInteractive = args.includes("--yes") || args.includes("-y") || !isTTY();

    // ─── --list ──────────────────────────────────────────────────────
    if (args.includes("--list")) {
        console.log("\nEngram can be auto-installed into these IDEs:\n");
        for (const [id, ide] of Object.entries(IDE_CONFIGS)) {
            let found = false;
            if (ide.scopes.global) {
                found = !!ide.scopes.global.find(p => fs.existsSync(p) || fs.existsSync(path.dirname(p)));
            }
            const scopeLabel = ide.scopes.localDirs ? " (Global / Local)" : " (Global)";
            const statusLabel = found ? "✅ detected" : "❌ not found";
            console.log(`  ${id.padEnd(15)} ${ide.name}${scopeLabel} ${statusLabel}`);
        }

        // Also show the correct JSON for manual install
        console.log("\n  For manual setup, the Engram entry looks like:");
        console.log(`  ${JSON.stringify(makeEngramEntry(IDE_CONFIGS.cursor), null, 2).replace(/\n/g, "\n  ")}`);
        process.exit(0);
    }

    // ─── --remove ────────────────────────────────────────────────────
    if (args.includes("--remove") || args.includes("--uninstall")) {
        const ideFlagIdx = args.indexOf("--ide");
        const targetIde = ideFlagIdx >= 0 ? args[ideFlagIdx + 1] : null;

        if (!targetIde || !IDE_CONFIGS[targetIde]) {
            console.error(`Usage: engram-mcp-server install --remove --ide <ide-name>`);
            console.error(`Available: ${Object.keys(IDE_CONFIGS).join(", ")}`);
            process.exit(1);
        }

        const ide = IDE_CONFIGS[targetIde];
        let removed = false;

        if (ide.scopes.global) {
            for (const configPath of ide.scopes.global) {
                if (fs.existsSync(configPath)) {
                    if (removeFromConfig(configPath, ide)) {
                        console.log(`✅ Removed Engram from ${configPath}`);
                        removed = true;
                    }
                }
            }
        }

        if (!removed) {
            console.log(`ℹ️  Engram was not found in ${ide.name} configs.`);
        }
        process.exit(0);
    }

    // ─── --ide <name> (direct install) ───────────────────────────────
    const ideFlagIdx = args.indexOf("--ide");
    if (ideFlagIdx >= 0 && args[ideFlagIdx + 1]) {
        const targetIde = args[ideFlagIdx + 1];
        if (!IDE_CONFIGS[targetIde]) {
            console.error(`Unknown IDE: "${targetIde}". Options: ${Object.keys(IDE_CONFIGS).join(", ")}`);
            process.exit(1);
        }
        await performInstallationForIde(targetIde, IDE_CONFIGS[targetIde], nonInteractive);
        return;
    }

    // ─── Auto-detect + interactive menu ──────────────────────────────
    console.log("\n🧠 Engram MCP Installer\n");

    const currentIde = detectCurrentIde();

    if (currentIde && IDE_CONFIGS[currentIde]) {
        console.log(`🔍 Detected environment: ${IDE_CONFIGS[currentIde].name}`);

        if (nonInteractive) {
            // Auto-install for detected IDE
            await performInstallationForIde(currentIde, IDE_CONFIGS[currentIde], true);
            return;
        }

        const ans = await askQuestion("   Install Engram for this IDE? [Y/n]: ");
        if (ans.trim().toLowerCase() !== 'n') {
            await performInstallationForIde(currentIde, IDE_CONFIGS[currentIde], false);
            return;
        }
        console.log("");
    } else if (nonInteractive) {
        console.error("Could not auto-detect IDE. Use --ide <name> for non-interactive install.");
        console.error(`Available: ${Object.keys(IDE_CONFIGS).join(", ")}`);
        process.exit(1);
    }

    // Interactive menu
    console.log("Where would you like to configure the Engram MCP server?\n");

    const ideKeys = Object.keys(IDE_CONFIGS);
    ideKeys.forEach((key, index) => {
        console.log(`  ${index + 1}. ${IDE_CONFIGS[key].name}`);
    });

    const allOpt = ideKeys.length + 1;
    const customOpt = ideKeys.length + 2;

    console.log(`  ${allOpt}. Install to ALL detected IDEs`);
    console.log(`  ${customOpt}. Custom config path...`);
    console.log(`  0. Cancel`);

    const answer = await askQuestion(`\nSelect an option [0-${customOpt}]: `);
    const choice = parseInt(answer.trim(), 10);

    if (isNaN(choice) || choice === 0) {
        console.log("Installation cancelled.");
        process.exit(0);
    }

    if (choice === allOpt) {
        for (const [id, ide] of Object.entries(IDE_CONFIGS)) {
            await performInstallationForIde(id, ide, true);
        }
    } else if (choice === customOpt) {
        const customPath = await askQuestion("Enter the absolute path to your MCP config JSON file: ");
        if (!customPath.trim()) {
            console.log("No path provided. Exiting.");
            process.exit(1);
        }
        // Custom: use mcpServers format as safe default
        const customIde: IdeDefinition = {
            name: "Custom Path",
            configKey: "mcpServers",
            requiresType: false,
            requiresCmdWrapper: false,
            scopes: {},
        };
        await installToPath(customPath.trim(), customIde);
    } else if (choice >= 1 && choice <= ideKeys.length) {
        const selectedKey = ideKeys[choice - 1];
        await performInstallationForIde(selectedKey, IDE_CONFIGS[selectedKey], false);
    } else {
        console.log("\nInvalid selection. Exiting.");
        process.exit(1);
    }
}

// ─── Per-IDE Installation ────────────────────────────────────────────

async function performInstallationForIde(id: string, ide: IdeDefinition, nonInteractive: boolean) {
    const supportsLocal = ide.scopes?.localDirs && ide.scopes.localDirs.length > 0;
    const supportsGlobal = ide.scopes?.global && ide.scopes.global.length > 0;

    // Show CLI hint for IDEs that support native CLI install
    if (ide.scopes.cli) {
        const entryJson = JSON.stringify(makeEngramEntry(ide));
        console.log(`\n💡 ${ide.name} also supports native CLI install:`);
        console.log(`   ${ide.scopes.cli} --scope=user engram '${entryJson}'`);
    }

    let targetScope = "global";

    if (supportsLocal && supportsGlobal && !nonInteractive) {
        console.log(`\n${ide.name} supports multiple installation scopes.`);
        console.log(`  1. Global (Applies to all projects)`);
        console.log(`  2. Local  (Applies to a specific project/workspace)`);
        const scopeAns = await askQuestion("Select scope [1-2] (default 1): ");
        if (scopeAns.trim() === "2") {
            targetScope = "local";
        }
    } else if (supportsLocal && !supportsGlobal) {
        targetScope = "local";
    }

    if (targetScope === "global" && supportsGlobal) {
        const configPath = ide.scopes.global!.find((p: string) => fs.existsSync(p)) || ide.scopes.global![0];
        await installToPath(configPath, ide);
    } else if (targetScope === "local") {
        if (nonInteractive) {
            // Use cwd as the project root
            const localDirPrefix = ide.scopes.localDirs![0];
            let configFileName = "mcp.json";
            if (localDirPrefix === "") configFileName = ".mcp.json";
            const configPath = path.join(process.cwd(), localDirPrefix, configFileName);
            await installToPath(configPath, ide);
        } else {
            const solutionDir = await askQuestion(`Enter the absolute path to your ${ide.name} project directory:\n> `);
            if (!solutionDir.trim()) {
                console.log(`Skipping ${ide.name} local installation (no path provided).`);
                return;
            }
            const localDirPrefix = ide.scopes.localDirs![0];
            let configFileName = "mcp.json";
            if (localDirPrefix === "") configFileName = ".mcp.json";
            const configPath = path.join(solutionDir.trim(), localDirPrefix, configFileName);
            await installToPath(configPath, ide);
        }
    } else if (!supportsGlobal && !supportsLocal) {
        console.log(`\n⚠️  ${ide.name} — No auto-install paths configured.`);
    }
}

async function installToPath(configPath: string, ide: IdeDefinition) {
    try {
        const result = addToConfig(configPath, ide);
        console.log(`\n   ✅ ${ide.name}`);
        console.log(`      Config: ${configPath}`);

        let statusText = "";
        if (result === "added") statusText = "Engram added successfully";
        else if (result === "updated") statusText = "Engram config updated (was outdated)";
        else if (result === "exists") statusText = "Engram already installed and up to date";

        console.log(`      Status: ${statusText}`);
    } catch (e: any) {
        console.log(`\n   ⚠️  ${ide.name}`);
        console.log(`      Could not write to: ${configPath}`);
        console.log(`      Reason: ${e.message}`);
        console.log(`\n      Manual setup: add the engram entry to your IDE's MCP config.`);
        console.log(`      Entry: ${JSON.stringify(makeEngramEntry(ide), null, 2)}`);
    }
}
