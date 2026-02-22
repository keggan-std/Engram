// ============================================================================
// Engram MCP Server — Installer Orchestrator
// ============================================================================

import fs from "fs";
import path from "path";
import readline from "readline";
import { IDE_CONFIGS, type IdeDefinition } from "./ide-configs.js";
import { addToConfig } from "./config-writer.js";
import { detectCurrentIde } from "./ide-detector.js";

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
            let found = false;
            if (ide.scopes.global) {
                found = !!ide.scopes.global.find(p => fs.existsSync(p) || fs.existsSync(path.dirname(p)));
            }
            console.log(`  ${id.padEnd(15)} ${ide.name}${ide.scopes.localDirs ? " (Global / Local)" : " (Global)"} ${found ? "✅ global path detected" : "❌ global not found"}`);
        }
        process.exit(0);
    }

    const ideFlagIdx = args.indexOf("--ide");
    if (ideFlagIdx >= 0 && args[ideFlagIdx + 1]) {
        const targetIde = args[ideFlagIdx + 1];
        if (!IDE_CONFIGS[targetIde]) {
            console.error(`Unknown IDE: "${targetIde}". Options: ${Object.keys(IDE_CONFIGS).join(", ")}`);
            process.exit(1);
        }
        await performInstallationInteractive({ [targetIde]: IDE_CONFIGS[targetIde] });
        return;
    }

    console.log("\n🧠 Engram MCP Installer\n");

    const currentIde = detectCurrentIde();

    if (currentIde && IDE_CONFIGS[currentIde]) {
        console.log(`🔍 Detected environment: ${IDE_CONFIGS[currentIde].name}`);
        const ans = await askQuestion("   Install Engram for this IDE? [Y/n]: ");

        if (ans.trim().toLowerCase() !== 'n') {
            await performInstallationInteractive({ [currentIde]: IDE_CONFIGS[currentIde] });
            return;
        }
        console.log("");
    }

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
        idesToProcess = IDE_CONFIGS;
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
                format: "mcpServers"
            }
        };
    } else if (choice >= 1 && choice <= ideKeys.length) {
        const selectedKey = ideKeys[choice - 1];
        idesToProcess = { [selectedKey]: IDE_CONFIGS[selectedKey] };
    } else {
        console.log("\nInvalid selection. Exiting.");
        process.exit(1);
    }

    await performInstallationInteractive(idesToProcess);
}

async function performInstallationInteractive(idesToProcess: Record<string, IdeDefinition | any>) {
    let resolvedConfigs: { name: string; path: string; format: string }[] = [];

    for (const [id, ide] of Object.entries(idesToProcess)) {
        if (id === "custom") {
            resolvedConfigs.push({ name: ide.name, path: ide.paths[0], format: ide.format });
            continue;
        }

        const supportsLocal = ide.scopes?.localDirs && ide.scopes.localDirs.length > 0;
        const supportsGlobal = ide.scopes?.global && ide.scopes.global.length > 0;

        let targetScope = "global";

        if (supportsLocal && supportsGlobal) {
            console.log(`\n${ide.name} supports multiple installation scopes.`);
            console.log(`  1. Global (Applies to all projects)`);
            console.log(`  2. Local  (Applies to a specific Solution/Workspace)`);
            const scopeAns = await askQuestion("Select scope [1-2] (default 1): ");
            if (scopeAns.trim() === "2") {
                targetScope = "local";
            }
        } else if (supportsLocal && !supportsGlobal) {
            targetScope = "local";
        }

        if (targetScope === "global") {
            const configPath = ide.scopes.global!.find((p: string) => fs.existsSync(p)) || ide.scopes.global![0];
            resolvedConfigs.push({ name: `${ide.name} (Global)`, path: configPath, format: ide.format });
        } else if (targetScope === "local") {
            const solutionDir = await askQuestion(`Enter the absolute path to your ${ide.name} Solution/Workspace directory:\n> `);
            if (!solutionDir.trim()) {
                console.log(`Skipping ${ide.name} local installation (no path provided).`);
                continue;
            }

            const localDirPrefix = ide.scopes.localDirs![0];

            let configFileName = "mcp.json";
            if (localDirPrefix === "") {
                configFileName = ".mcp.json";
            }

            const configPath = path.join(solutionDir.trim(), localDirPrefix, configFileName);
            resolvedConfigs.push({ name: `${ide.name} (Local: ${path.basename(solutionDir)})`, path: configPath, format: ide.format });
        }
    }

    await performInstallation(resolvedConfigs);
}

async function performInstallation(configs: { name: string; path: string; format: string }[]) {
    let installed = 0;

    for (const config of configs) {
        try {
            const result = addToConfig(config.path, config.format);
            console.log(`\n   ✅ ${config.name}`);
            console.log(`      Config: ${config.path}`);

            let statusText = "";
            if (result === "added") statusText = "Engram added";
            else if (result === "updated") statusText = "Engram config updated to use npx";
            else if (result === "exists") statusText = "Engram is already installed and up to date";

            console.log(`      Status: ${statusText}`);

            if (result !== "exists") {
                installed++;
            }
        } catch (e: any) {
            console.log(`\n   ⚠️  ${config.name}`);
            console.log(`      Could not write to: ${config.path}`);
            console.log(`      Reason: ${e.message}`);
            console.log(`\n      For manual instructions, visit: https://github.com/keggan-std/Engram`);
        }
    }

    if (configs.length === 0) {
        console.log("\n   No target configurations resolved.");
    } else if (installed === 0) {
        console.log("\n✅ Done! No new changes were needed.");
    } else {
        console.log(`\n✅ Done! Engram configured in ${installed} IDE scope(s).`);
        console.log("   Restart your IDE(s) to load Engram.\n");
    }
}
