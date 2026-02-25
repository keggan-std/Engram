// ============================================================================
// Engram MCP Server — Installer Orchestrator
// ============================================================================

import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import { IDE_CONFIGS, type IdeDefinition } from "./ide-configs.js";
import { addToConfig, removeFromConfig, makeEngramEntry, readJson, getInstallerVersion } from "./config-writer.js";
import { detectCurrentIde, detectInstalledIdes } from "./ide-detector.js";

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
    // Detect if npx resolved to the local source directory instead of the npm package.
    // When the CWD's package.json name matches "engram-mcp-server" and the running
    // binary is inside that same directory, the version shown reflects the local build.
    try {
        const __dir = path.dirname(fileURLToPath(import.meta.url));
        const runningRoot = path.resolve(__dir, "../..");
        if (path.resolve(process.cwd()) === runningRoot) {
            const cwdPkg = readJson(path.join(process.cwd(), "package.json"));
            if (cwdPkg?.name === "engram-mcp-server") {
                console.warn("\n⚠️  Running from the engram source directory.");
                console.warn("   Version shown reflects the local build — not the published npm package.");
                console.warn("   For an accurate check: npm install -g engram-mcp-server@latest && engram --check\n");
            }
        }
    } catch { /* ignore — detection is best-effort */ }

    const nonInteractive = args.includes("--yes") || args.includes("-y") || !isTTY();
    const universalMode = args.includes("--universal");

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
  --ide <name>      Install for a specific IDE
  --universal       Install in universal mode (~80 token single-tool schema)
  --yes, -y         Non-interactive mode (requires --ide if no IDE is detected)
  --remove          Remove Engram from an IDE config (requires --ide)
  --list            Show all supported IDEs and their detection/install status
  --check           Show installed version per IDE and latest available on npm
  --install-hooks   Install git post-commit hook to auto-record changes (run in your git repo)
  --remove-hooks    Remove the Engram git hook from the current repo
  --version         Show version number
  --help, -h        Show this help

Supported IDEs:
  ${ideNames}

Examples:
  engram install                               Auto-detect IDE, install interactively
  engram install --ide vscode                  Install for VS Code
  engram install --ide vscode --universal    Install universal mode for VS Code
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
        console.log(`  ${JSON.stringify(makeEngramEntry(IDE_CONFIGS.cursor, universalMode), null, 2).replace(/\n/g, "\n  ")}`);
        if (universalMode) {
            console.log("\n  ℹ️  Universal mode: single 'engram' tool (~80 token schema).");
        }
        process.exit(0);
    }

    // ─── --check ─────────────────────────────────────────────────────
    if (args.includes("--check")) {
        const currentVersion = getInstallerVersion();

        const semverCmp = (a: string, b: string): number => {
            const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
            for (let i = 0; i < 3; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d !== 0) return d; }
            return 0;
        };

        // Fetch npm latest FIRST — it is the authoritative reference for all comparisons.
        process.stdout.write(`\nEngram Version Check\n\n  npm latest      : checking...`);
        let npmLatest: string | null = null;
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
                npmLatest = data["version"] as string;
                const cmp = semverCmp(currentVersion, npmLatest);
                const runningLabel = cmp === 0
                    ? "✅ up to date"
                    : cmp > 0
                        ? `⚡ running pre-release (v${currentVersion} > npm v${npmLatest})`
                        : `⬆  update available`;
                process.stdout.write(`\r  npm latest      : v${npmLatest}\n`);
                console.log(`  Running version : v${currentVersion}  ${runningLabel}`);
            } else {
                process.stdout.write(`\r  npm latest      : (registry unreachable)\n`);
                console.log(`  Running version : v${currentVersion}`);
            }
        } catch {
            process.stdout.write(`\r  npm latest      : (network error — check manually)\n`);
            console.log(`  Running version : v${currentVersion}`);
        }

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
                // Compare the IDE config version against npm latest (the authoritative reference).
                // Fall back to the running version only when the registry was unreachable.
                const reference = npmLatest ?? currentVersion;
                const cmp = installedVersion === "unknown (pre-tracking)" ? -1 : semverCmp(installedVersion, reference);
                const statusIcon = cmp >= 0 ? "✅" : "⬆";
                const statusLabel = cmp >= 0
                    ? "up to date"
                    : npmLatest
                        ? `update available — run: npx -y engram-mcp-server install`
                        : `behind running version (v${currentVersion})`;
                console.log(`  ${id.padEnd(14)} ${foundPath}`);
                console.log(`  ${"".padEnd(14)} Installed: v${installedVersion}  ${statusIcon} ${statusLabel}`);
            }
            console.log();
        }

        console.log(`  To update: npx -y engram-mcp-server install`);
        console.log(`  Releases : https://github.com/keggan-std/Engram/releases\n`);
        process.exit(0);
    }

    // ─── --install-hooks / --remove-hooks ────────────────────────────
    if (args.includes("--install-hooks")) {
        const hookDir = path.join(process.cwd(), ".git", "hooks");
        if (!fs.existsSync(hookDir)) {
            console.error("❌ No .git/hooks directory found. Is this a git repository?");
            console.error("   Run this command from the root of your git repository.");
            process.exit(1);
        }
        const hookPath = path.join(hookDir, "post-commit");
        const hookScript = [
            "#!/bin/bash",
            "# Engram auto-recording hook — installed by engram install --install-hooks",
            "# Automatically records changed files to Engram memory after each commit.",
            "npx -y engram-mcp-server record-commit 2>/dev/null || true",
            "",
        ].join("\n");
        fs.writeFileSync(hookPath, hookScript, { encoding: "utf-8", mode: 0o755 });
        console.log(`✅ Engram git hook installed at ${hookPath}`);
        console.log("   After each commit, Engram will automatically record the changed files.");
        console.log("   To remove it later: engram install --remove-hooks");
        process.exit(0);
    }

    if (args.includes("--remove-hooks")) {
        const hookPath = path.join(process.cwd(), ".git", "hooks", "post-commit");
        if (!fs.existsSync(hookPath)) {
            console.log("ℹ️  No post-commit hook found at .git/hooks/post-commit");
            process.exit(0);
        }
        const content = fs.readFileSync(hookPath, "utf-8");
        if (!content.includes("engram-mcp-server")) {
            console.log("ℹ️  The post-commit hook was not installed by Engram. Not removing it.");
            process.exit(0);
        }
        fs.unlinkSync(hookPath);
        console.log("✅ Engram git hook removed from .git/hooks/post-commit");
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
        await performInstallationForIde(targetIde, IDE_CONFIGS[targetIde], nonInteractive, universalMode);
        return;
    }

    // ─── Auto-detect + interactive menu ──────────────────────────────
    console.log("\n🧠 Engram MCP Installer\n");

    const currentIde = detectCurrentIde();
    // Filesystem scan — finds all IDEs installed on this machine regardless of
    // which one launched the terminal.  Most devs run VS Code, Cursor, Claude Code
    // and others side-by-side; we should install to all of them in one pass.
    const allDetected = detectInstalledIdes();
    const otherDetected = allDetected.filter(id => id !== currentIde);

    if (currentIde && IDE_CONFIGS[currentIde]) {
        console.log(`🔍 Detected environment: ${IDE_CONFIGS[currentIde].name}`);

        if (otherDetected.length > 0) {
            console.log(`   Also found  : ${otherDetected.map(id => IDE_CONFIGS[id].name).join(", ")}`);
        }

        if (nonInteractive) {
            // Install to current IDE first, then all other detected IDEs automatically.
            await performInstallationForIde(currentIde, IDE_CONFIGS[currentIde], true, universalMode);
            for (const id of otherDetected) {
                await performInstallationForIde(id, IDE_CONFIGS[id], true, universalMode);
            }
            return;
        }

        const targetIds = [currentIde, ...otherDetected];
        const targetNames = targetIds.map(id => IDE_CONFIGS[id].name).join(", ");
        const prompt = otherDetected.length > 0
            ? `   Install Engram for all ${targetIds.length} IDEs (${targetNames})? [Y/n]: `
            : `   Install Engram for this IDE? [Y/n]: `;

        const ans = await askQuestion(prompt);
        if (ans.trim().toLowerCase() !== 'n') {
            for (const id of targetIds) {
                await performInstallationForIde(id, IDE_CONFIGS[id], false, universalMode);
            }
            return;
        }
        console.log("");
    } else if (nonInteractive) {
        // No terminal env var match — fall back to filesystem scan.
        if (allDetected.length > 0) {
            console.log(`🔍 Found ${allDetected.length} installed IDE(s): ${allDetected.map(id => IDE_CONFIGS[id].name).join(", ")}`);
            for (const id of allDetected) {
                await performInstallationForIde(id, IDE_CONFIGS[id], true, universalMode);
            }
            return;
        }
        console.error("❌ No IDEs detected on this machine.");
        console.error("\n   Specify your IDE manually with --ide <name>. Examples:");
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

    // Show which IDEs were actually found on this machine so the user knows
    // what "ALL detected" will cover before they pick that option.
    const allOptLabel = allDetected.length > 0
        ? `Install to ALL detected IDEs (${allDetected.map(id => IDE_CONFIGS[id].name).join(", ")})`
        : `Install to ALL IDEs (none detected — will attempt all)`;
    console.log(`  ${allOpt}. ${allOptLabel}`);
    console.log(`  ${customOpt}. Custom config path...`);
    console.log(`  0. Cancel`);

    const answer = await askQuestion(`\nSelect an option [0-${customOpt}]: `);
    const choice = parseInt(answer.trim(), 10);

    if (isNaN(choice) || choice === 0) {
        console.log("Installation cancelled.");
        process.exit(0);
    }

    if (choice === allOpt) {
        // Prefer detected IDEs; fall back to all if none found.
        const targets = allDetected.length > 0 ? allDetected : Object.keys(IDE_CONFIGS);
        for (const id of targets) {
            await performInstallationForIde(id, IDE_CONFIGS[id], true, universalMode);
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
        await installToPath(customPath.trim(), customIde, universalMode);
    } else if (choice >= 1 && choice <= ideKeys.length) {
        const selectedKey = ideKeys[choice - 1];
        await performInstallationForIde(selectedKey, IDE_CONFIGS[selectedKey], false, universalMode);
    } else {
        console.log("\nInvalid selection. Exiting.");
        process.exit(1);
    }
}

// ─── Per-IDE Installation ────────────────────────────────────────────

async function performInstallationForIde(id: string, ide: IdeDefinition, nonInteractive: boolean, universal = false) {
    const supportsLocal = ide.scopes?.localDirs && ide.scopes.localDirs.length > 0;
    const supportsGlobal = ide.scopes?.global && ide.scopes.global.length > 0;

    // JetBrains: the global config path is community-sourced and not confirmed by official docs.
    // Official JetBrains MCP config is managed via Settings | Tools | AI Assistant | Model Context Protocol.
    // We attempt the file path as a best-effort fallback; a warning ensures users know to verify.
    if (id === "jetbrains") {
        console.log(`\n⚠️  ${ide.name} — Note: The global config path used here is community-sourced and`);
        console.log(`   not confirmed in official JetBrains documentation.`);
        console.log(`   Recommended: configure MCP via Settings › Tools › AI Assistant › Model Context Protocol.`);
        console.log(`   The file-based install below is attempted as a best-effort fallback.\n`);
    }

    // Show CLI hint for IDEs that support native CLI install
    if (ide.scopes.cli) {
        const entryJson = JSON.stringify(makeEngramEntry(ide, universal));
        const quotedEntry = process.platform === "win32"
            ? `"${entryJson.replace(/"/g, '\\"')}"`
            : `'${entryJson}'`;
        console.log(`\n💡 ${ide.name} also supports native CLI install:`);
        console.log(`   ${ide.scopes.cli} engram ${quotedEntry} --scope user`);
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
        await installToPath(configPath, ide, universal);
    } else if (targetScope === "local") {
        if (nonInteractive) {
            // Use cwd as the project root
            const localDirPrefix = ide.scopes.localDirs![0];
            let configFileName = "mcp.json";
            if (localDirPrefix === "") configFileName = ".mcp.json";
            const configPath = path.join(process.cwd(), localDirPrefix, configFileName);
            await installToPath(configPath, ide, universal);
        } else {
            const cwd = process.cwd();
            const solutionDir = await askQuestion(`Enter the absolute path to your ${ide.name} project directory:\n  [${cwd}]: `);
            const resolvedDir = solutionDir.trim() || cwd;
            const localDirPrefix = ide.scopes.localDirs![0];
            let configFileName = "mcp.json";
            if (localDirPrefix === "") configFileName = ".mcp.json";
            const configPath = path.join(resolvedDir, localDirPrefix, configFileName);
            await installToPath(configPath, ide, universal);
        }
    } else if (!supportsGlobal && !supportsLocal) {
        console.log(`\n⚠️  ${ide.name} — No auto-install paths configured.`);
    }
}

async function installToPath(configPath: string, ide: IdeDefinition, universal = false) {
    try {
        const result = addToConfig(configPath, ide, universal);
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
