// ============================================================================
// Engram MCP Server — Installer Orchestrator
// ============================================================================

import fs from "fs";
import path from "path";
import readline from "readline";
import { IDE_CONFIGS, type IdeDefinition } from "./ide-configs.js";
import { addToConfig, removeFromConfig, makeEngramEntry, readJson, getInstallerVersion } from "./config-writer.js";
import { detectCurrentIde } from "./ide-detector.js";

// ─── Helpers ─────────────────────────────────────────────────────────

function isTTY(): boolean {
    return !!(process.stdin.isTTY && process.stdout.isTTY);
}

// Version reading is handled by getInstallerVersion() from config-writer.ts

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

    // ─── --version ───────────────────────────────────────────────────
    if (args.includes("--version") || args.includes("-v")) {
        console.log(`engram-mcp-server v${getInstallerVersion()}`);
        process.exit(0);
    }

    // ─── --help ──────────────────────────────────────────────────────
    if (args.includes("--help") || args.includes("-h")) {
        const ideNames = Object.keys(IDE_CONFIGS).join(", ");
        console.log(`
Engram MCP Installer v${getInstallerVersion()}

Usage:
  engram install [options]
  npx -y engram-mcp-server install [options]

Options:
  --ide <name>    Install for a specific IDE
  --yes, -y       Non-interactive mode (requires --ide if no IDE is detected)
  --remove        Remove Engram from an IDE config (requires --ide)
  --list          Show all supported IDEs and their detection/install status
  --check         Show installed version per IDE and latest available on npm
  --version       Show version number
  --help, -h      Show this help

Supported IDEs:
  ${ideNames}

Examples:
  engram install                               Auto-detect IDE, install interactively
  engram install --ide vscode                  Install for VS Code
  engram install --ide claudecode --yes        Non-interactive install for Claude Code
  engram install --remove --ide cursor         Remove Engram from Cursor
  engram install --list                        Show IDE detection and install status
`);
        process.exit(0);
    }

    // ─── --list ──────────────────────────────────────────────────────
    if (args.includes("--list")) {
        console.log("\nEngram can be auto-installed into these IDEs:\n");
        for (const [id, ide] of Object.entries(IDE_CONFIGS)) {
            let detected = false;
            let installed = false;

            if (ide.scopes.global) {
                const foundPath = ide.scopes.global.find(p => fs.existsSync(p));
                if (foundPath) {
                    detected = true;
                    const config = readJson(foundPath);
                    if (config?.[ide.configKey]?.engram) installed = true;
                } else if (ide.scopes.global.find(p => fs.existsSync(path.dirname(p)))) {
                    detected = true;
                }
            }

            const scopeLabel = ide.scopes.localDirs ? " (Global / Local)" : " (Global)";
            const statusLabel = installed
                ? "✅ installed"
                : detected
                    ? "⬜ detected, not installed"
                    : "❌ not found";

            console.log(`  ${id.padEnd(15)} ${ide.name}${scopeLabel}  ${statusLabel}`);
        }

        console.log("\n  For manual setup, the Engram entry looks like:");
        console.log(`  ${JSON.stringify(makeEngramEntry(IDE_CONFIGS.cursor), null, 2).replace(/\n/g, "\n  ")}`);
        process.exit(0);
    }

    // ─── --check ─────────────────────────────────────────────────────
    if (args.includes("--check")) {
        const currentVersion = getInstallerVersion();
        console.log(`\nEngram Version Check\n`);
        console.log(`  Running version : v${currentVersion}`);
        console.log(`\n  IDE Configurations:\n`);

        for (const [id, ide] of Object.entries(IDE_CONFIGS)) {
            if (!ide.scopes.global) continue;
            const foundPath = ide.scopes.global.find(p => fs.existsSync(p));
            if (!foundPath) {
                console.log(`  ${id.padEnd(14)} (not detected)`);
                continue;
            }
            const config = readJson(foundPath);
            const entry = config?.[ide.configKey]?.engram;
            if (!entry) {
                console.log(`  ${id.padEnd(14)} ${foundPath}`);
                console.log(`  ${"".padEnd(14)} Not installed`);
            } else {
                const installedVersion: string = entry._engram_version || "unknown (pre-tracking)";
                const isMatch = installedVersion === currentVersion;
                const statusIcon = isMatch ? "✅" : "⬆";
                const statusLabel = isMatch ? "up to date" : `update available (v${currentVersion})`;
                console.log(`  ${id.padEnd(14)} ${foundPath}`);
                console.log(`  ${"".padEnd(14)} Installed: v${installedVersion}  ${statusIcon} ${statusLabel}`);
            }
            console.log();
        }

        // Fetch npm latest for comparison
        process.stdout.write("  npm latest      : checking...");
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5_000);
            const res = await fetch("https://registry.npmjs.org/engram-mcp-server/latest", {
                signal: controller.signal,
                headers: { "User-Agent": "engram-mcp-server" },
            });
            clearTimeout(timer);
            if (res.ok) {
                const data = await res.json() as Record<string, unknown>;
                const npmLatest = data["version"] as string;
                const semverCmp = (a: string, b: string) => {
                    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
                    for (let i = 0; i < 3; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d !== 0) return d; }
                    return 0;
                };
                const cmp = semverCmp(currentVersion, npmLatest);
                const label = cmp === 0
                    ? "✅ up to date"
                    : cmp > 0
                        ? `⚡ running pre-release (v${currentVersion} > npm v${npmLatest})`
                        : `⬆  npm has v${npmLatest} — run: npx -y engram-mcp-server install`;
                process.stdout.write(`\r  npm latest      : v${npmLatest}  ${label}\n`);
            } else {
                process.stdout.write(`\r  npm latest      : (registry unreachable)\n`);
            }
        } catch {
            process.stdout.write(`\r  npm latest      : (network error — check manually)\n`);
        }

        console.log(`\n  To update: npx -y engram-mcp-server install`);
        console.log(`  Releases : https://github.com/keggan-std/Engram/releases\n`);
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
        console.error("❌ Could not auto-detect your IDE in non-interactive mode.");
        console.error("\n   Specify your IDE with --ide <name>. Examples:");
        for (const key of Object.keys(IDE_CONFIGS)) {
            console.error(`     engram install --ide ${key}`);
        }
        console.error("\n   Run 'engram install --list' to see detection status.");
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
        const quotedEntry = process.platform === "win32"
            ? `"${entryJson.replace(/"/g, '\\"')}"`
            : `'${entryJson}'`;
        console.log(`\n💡 ${ide.name} also supports native CLI install:`);
        console.log(`   ${ide.scopes.cli} --scope=user engram ${quotedEntry}`);
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
            const cwd = process.cwd();
            const solutionDir = await askQuestion(`Enter the absolute path to your ${ide.name} project directory:\n  [${cwd}]: `);
            const resolvedDir = solutionDir.trim() || cwd;
            const localDirPrefix = ide.scopes.localDirs![0];
            let configFileName = "mcp.json";
            if (localDirPrefix === "") configFileName = ".mcp.json";
            const configPath = path.join(resolvedDir, localDirPrefix, configFileName);
            await installToPath(configPath, ide);
        }
    } else if (!supportsGlobal && !supportsLocal) {
        console.log(`\n⚠️  ${ide.name} — No auto-install paths configured.`);
    }
}

async function installToPath(configPath: string, ide: IdeDefinition) {
    try {
        const result = addToConfig(configPath, ide);
        const currentVersion = getInstallerVersion();
        console.log(`\n   ✅ ${ide.name}`);
        console.log(`      Config : ${configPath}`);

        let statusText = "";
        if (result === "added") {
            statusText = `Engram v${currentVersion} installed successfully`;
        } else if (result === "upgraded") {
            statusText = `Upgraded to v${currentVersion}`;
        } else if (result === "legacy-upgraded") {
            statusText = `Found existing install (version unknown — pre-tracking era). Stamped as v${currentVersion}`;
        } else if (result === "exists") {
            statusText = `Already installed at v${currentVersion} — nothing to do`;
        }

        console.log(`      Status : ${statusText}`);
    } catch (e: any) {
        console.log(`\n   ⚠️  ${ide.name}`);
        console.log(`      Could not write to: ${configPath}`);
        console.log(`      Reason: ${e.message}`);
        console.log(`\n      Manual setup: add the engram entry to your IDE's MCP config.`);
        console.log(`      Entry: ${JSON.stringify(makeEngramEntry(ide), null, 2)}`);
    }
}
