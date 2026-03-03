// ============================================================================
// Engram MCP Server — Installer Orchestrator
// ============================================================================

import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import { IDE_CONFIGS, type IdeDefinition } from "./ide-configs.js";
import { addToConfig, removeFromConfig, makeEngramEntry, readJson, getInstallerVersion, ConfigParseError } from "./config-writer.js";
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
    const forceGlobal = args.includes("--global");

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
  --global          Force global (user-level) installation instead of project-level
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
                    try {
                        const config = readJson(foundPath);
                        if (config?.[ide.configKey]?.engram) installed = true;
                    } catch (e) {
                        if (e instanceof ConfigParseError) {
                            console.warn(`  ⚠️  ${foundPath} — invalid JSON (run 'engram install' to repair)`);
                        }
                    }
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

    // ─── --check ─────────────────────────────────────────────────────────────
    if (args.includes("--check")) {
        const currentVersion = getInstallerVersion();
        const cwd = process.cwd();

        // ── ANSI color helpers (TTY only) ──────────────────────────────────────
        const usesColor = process.stdout.isTTY ?? false;
        const clr = (code: string, t: string) => usesColor ? `\x1b[${code}m${t}\x1b[0m` : t;
        const bold   = (t: string) => clr("1",   t);
        const dim    = (t: string) => clr("2",   t);
        const green  = (t: string) => clr("32",  t);
        const yellow = (t: string) => clr("33",  t);
        const cyan   = (t: string) => clr("36",  t);
        const gray   = (t: string) => clr("90",  t);
        const hr = "─".repeat(66);

        const semverCmp = (a: string, b: string): number => {
            const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
            for (let i = 0; i < 3; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d !== 0) return d; }
            return 0;
        };

        // ── Fetch npm latest ───────────────────────────────────────────────────
        process.stdout.write(`\n  ${bold("Engram Installation Check")}\n\n  Checking npm registry...`);
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
                npmLatest = ((await res.json() as Record<string, unknown>)["version"] as string);
            }
        } catch { /* network error — best effort */ }

        const selfCmp    = npmLatest ? semverCmp(currentVersion, npmLatest) : 0;
        const selfStatus = !npmLatest    ? gray("(npm unreachable)")
                         : selfCmp >  0  ? yellow("⚡ pre-release")
                         : selfCmp === 0 ? green("✅ up to date")
                         :                 yellow(`⬆  v${npmLatest} is available`);

        process.stdout.write(`\r  This build : ${cyan("v" + currentVersion)}  ${selfStatus}\n`);
        if (npmLatest) process.stdout.write(`  npm latest : ${cyan("v" + npmLatest)}\n`);
        process.stdout.write(`  CWD        : ${gray(cwd)}\n`);

        // ── Entry resolver ─────────────────────────────────────────────────────
        type EntryResult =
            | { state: "not-found";     scope: "global" | "local"; filePath: string }
            | { state: "not-installed"; scope: "global" | "local"; filePath: string }
            | { state: "invalid-json";  scope: "global" | "local"; filePath: string }
            | { state: "installed";     scope: "global" | "local"; filePath: string;
                instance: string; version: string; icon: string; statusLine: string };

        const resolveEntry = (filePath: string, scope: "global" | "local", ide: IdeDefinition): EntryResult => {
            if (!fs.existsSync(filePath)) return { state: "not-found", scope, filePath };
            let config: Record<string, unknown>;
            try { config = readJson(filePath) as Record<string, unknown>; }
            catch (e) {
                if (e instanceof ConfigParseError) return { state: "invalid-json", scope, filePath };
                throw e;
            }
            const serverMap = (config?.[ide.configKey] ?? {}) as Record<string, Record<string, unknown>>;
            const instanceKey = Object.keys(serverMap).find(k => {
                const en = serverMap[k];
                return k === "engram"
                    || String(en?.command ?? "").includes("engram")
                    || (Array.isArray(en?.args) && (en.args as string[]).some((a: string) => String(a).includes("engram")));
            });
            if (!instanceKey) return { state: "not-installed", scope, filePath };
            const entry = serverMap[instanceKey];
            const installedVersion = String(entry?._engram_version ?? "?");
            const ref     = npmLatest ?? currentVersion;
            const isUnknown = installedVersion === "?";
            const icmp    = isUnknown ? -1 : semverCmp(installedVersion, ref);
            const icon       = icmp >= 0 ? green("✅") : yellow("⬆ ");
            const statusLine = icmp >= 0 ? green("up to date")
                             : npmLatest  ? yellow("update available")
                             :              yellow(`behind v${currentVersion}`);
            return { state: "installed", scope, filePath, instance: instanceKey,
                     version: installedVersion, icon, statusLine };
        };

        // ── Collect results for every IDE ──────────────────────────────────────
        type IdeResult = { name: string; entries: EntryResult[] };
        const results: IdeResult[] = [];

        for (const [, ide] of Object.entries(IDE_CONFIGS)) {
            const entries: EntryResult[] = [];

            // Global: use first found path. If none found, keep a not-found placeholder so
            // "detected config but no engram entry" stays distinct from "IDE not present at all".
            if (ide.scopes.global?.length) {
                let found = false;
                for (const gp of ide.scopes.global) {
                    const e = resolveEntry(gp, "global", ide);
                    if (e.state !== "not-found") { entries.push(e); found = true; break; }
                }
                if (!found) entries.push({ state: "not-found", scope: "global", filePath: ide.scopes.global[0] });
            }

            // Local: scan each dir relative to CWD; add only files that actually exist.
            if (ide.scopes.localDirs?.length) {
                for (const dir of ide.scopes.localDirs) {
                    const localFile = ide.scopes.localFile ?? (dir === "" ? ".mcp.json" : "mcp.json");
                    const lp = path.join(cwd, dir, localFile);
                    const e = resolveEntry(lp, "local", ide);
                    if (e.state !== "not-found") entries.push(e);
                }
            }

            results.push({ name: ide.name, entries });
        }

        // ── Print ──────────────────────────────────────────────────────────────
        let countInstalled = 0, countNeedUpdate = 0, countNotInstalled = 0, countNotDetected = 0;

        console.log(`\n  ${gray(hr)}\n`);

        for (const { name, entries } of results) {
            const anyFound     = entries.some(e => e.state !== "not-found");
            const anyInstalled = entries.some(e => e.state === "installed");

            if (!anyFound) {
                console.log(`  ${dim(name.padEnd(26))}  ${gray("not detected")}`);
                countNotDetected++;
                continue;
            }

            console.log(`  ${bold(name)}`);

            let ideNotInstalled = false;
            for (const e of entries) {
                const tag     = e.scope === "global" ? "global" : "local ";
                const relPath = e.scope === "local"
                    ? (path.relative(cwd, e.filePath) || e.filePath)
                    : e.filePath;

                if (e.state === "not-found") continue;

                if (e.state === "not-installed") {
                    console.log(`    ${dim(tag)}  ${gray("not installed")}`);
                    console.log(`           ${gray("↳ " + relPath)}`);
                    ideNotInstalled = true;
                    continue;
                }
                if (e.state === "invalid-json") {
                    console.log(`    ${dim(tag)}  ${yellow("⚠ invalid JSON")}  ${gray("→ engram install")}`);
                    console.log(`           ${gray("↳ " + relPath)}`);
                    continue;
                }
                // installed
                const ver = e.version === "?" ? gray("v?") : cyan(`v${e.version}`);
                console.log(`    ${tag}  ${gray('"' + e.instance + '"')}  ${ver}  ${e.icon} ${e.statusLine}`);
                console.log(`           ${gray("↳ " + relPath)}`);
            }
            console.log();

            if (anyInstalled) {
                countInstalled++;
                const needsUpdate = (entries as EntryResult[]).some(
                    e => e.state === "installed" && (e.statusLine.includes("update") || e.statusLine.includes("behind"))
                );
                if (needsUpdate) countNeedUpdate++;
            } else if (ideNotInstalled) {
                countNotInstalled++;
            }
        }

        // ── Summary ────────────────────────────────────────────────────────────
        const summaryParts: string[] = [];
        if (countInstalled)    summaryParts.push(green(`✅ ${countInstalled} installed`));
        if (countNeedUpdate)   summaryParts.push(yellow(`⬆  ${countNeedUpdate} need update`));
        if (countNotInstalled) summaryParts.push(`⬜ ${countNotInstalled} not installed`);
        if (countNotDetected)  summaryParts.push(dim(`${countNotDetected} not detected`));

        console.log(`  ${gray(hr)}`);
        console.log(`  ${summaryParts.join(gray("  ·  "))}\n`);
        if (countNeedUpdate > 0 || countNotInstalled > 0) {
            console.log(`  Run:      npx -y engram-mcp-server install`);
        }
        console.log(`  Releases: https://github.com/keggan-std/Engram/releases\n`);
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
        await performInstallationForIde(targetIde, IDE_CONFIGS[targetIde], nonInteractive, universalMode, forceGlobal);
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
            await performInstallationForIde(currentIde, IDE_CONFIGS[currentIde], true, universalMode, forceGlobal);
            for (const id of otherDetected) {
                await performInstallationForIde(id, IDE_CONFIGS[id], true, universalMode, forceGlobal);
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
                await performInstallationForIde(id, IDE_CONFIGS[id], false, universalMode, forceGlobal);
            }
            return;
        }
        console.log("");
    } else if (nonInteractive) {
        // No terminal env var match — fall back to filesystem scan.
        if (allDetected.length > 0) {
            console.log(`🔍 Found ${allDetected.length} installed IDE(s): ${allDetected.map(id => IDE_CONFIGS[id].name).join(", ")}`);
            for (const id of allDetected) {
                await performInstallationForIde(id, IDE_CONFIGS[id], true, universalMode, forceGlobal);
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
            await performInstallationForIde(id, IDE_CONFIGS[id], true, universalMode, forceGlobal);
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
        await performInstallationForIde(selectedKey, IDE_CONFIGS[selectedKey], false, universalMode, forceGlobal);
    } else {
        console.log("\nInvalid selection. Exiting.");
        process.exit(1);
    }
}

// ─── Per-IDE Installation ────────────────────────────────────────────

async function performInstallationForIde(id: string, ide: IdeDefinition, nonInteractive: boolean, universal = false, forceGlobal = false) {
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

    // Default to global. Local is only used when the IDE has no global support,
    // or when the user explicitly picks it from the scope prompt below.
    let targetScope = supportsGlobal ? "global" : "local";

    if (forceGlobal && supportsGlobal) {
        // User explicitly requested global via --global flag
        targetScope = "global";
    } else if (supportsLocal && supportsGlobal && !nonInteractive) {
        console.log(`\n${ide.name} supports two MCP config file locations:`);
        console.log(`  1. Global  — writes to your user-level IDE config (all projects use this MCP)`);
        console.log(`  2. Local   — writes to a config file inside a specific project folder`);
        console.log(`\n  Note: This only controls WHERE the MCP is registered, not where Engram stores`);
        console.log(`  its database. The database is always placed at your project root automatically.`);
        const scopeAns = await askQuestion("Select scope [1-2] (default 1): ");
        if (scopeAns.trim() === "2") {
            targetScope = "local";
        } else {
            targetScope = "global";
        }
    }

    if (targetScope === "global" && supportsGlobal) {
        // Global installs on IDEs without workspaceVar get --ide=<id> so the server
        // opens a per-IDE DB shard (memory-{id}.db) instead of competing on memory.db.
        const globalIdeKey = ide.workspaceVar ? undefined : id;
        const configPath = ide.scopes.global!.find((p: string) => fs.existsSync(p)) || ide.scopes.global![0];
        await installToPath(configPath, ide, universal, globalIdeKey);
    } else if (targetScope === "local") {
        if (nonInteractive) {
            // Use cwd as the project root
            const localDirPrefix = ide.scopes.localDirs![0];
            const configFileName = ide.scopes.localFile ?? (localDirPrefix === "" ? ".mcp.json" : "mcp.json");
            const configPath = path.join(process.cwd(), localDirPrefix, configFileName);
            await installToPath(configPath, ide, universal);
        } else {
            const cwd = process.cwd();
            const solutionDir = await askQuestion(`Enter the absolute path to your ${ide.name} project directory:\n  [${cwd}]: `);
            const resolvedDir = solutionDir.trim() || cwd;
            const localDirPrefix = ide.scopes.localDirs![0];
            const configFileName = ide.scopes.localFile ?? (localDirPrefix === "" ? ".mcp.json" : "mcp.json");
            const configPath = path.join(resolvedDir, localDirPrefix, configFileName);
            await installToPath(configPath, ide, universal);
        }
    } else if (!supportsGlobal && !supportsLocal) {
        console.log(`\n⚠️  ${ide.name} — No auto-install paths configured.`);
    }
}

async function installToPath(configPath: string, ide: IdeDefinition, universal = false, ideKey?: string) {
    try {
        const result = addToConfig(configPath, ide, universal, ideKey);
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
