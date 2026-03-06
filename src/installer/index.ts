// ============================================================================
// Engram MCP Server — Installer Orchestrator
// ============================================================================

import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import { IDE_CONFIGS, type IdeDefinition } from "./ide-configs.js";
import { addToConfig, removeFromConfig, makeEngramEntry, readJson, getInstallerVersion, ConfigParseError } from "./config-writer.js";
import { detectCurrentIde, detectInstalledIdes, resolveIdeGlobalPaths } from "./ide-detector.js";

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

// ─── ANSI color helpers (reusable) ───────────────────────────────────

function makeColors() {
    const usesColor = process.stdout.isTTY ?? false;
    const clr = (code: string, t: string) => usesColor ? `\x1b[${code}m${t}\x1b[0m` : t;
    return {
        bold:   (t: string) => clr("1",   t),
        dim:    (t: string) => clr("2",   t),
        green:  (t: string) => clr("32",  t),
        yellow: (t: string) => clr("33",  t),
        cyan:   (t: string) => clr("36",  t),
        gray:   (t: string) => clr("90",  t),
    };
}

function semverCmp(a: string, b: string): number {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d !== 0) return d; }
    return 0;
}

// ─── Project root detection (for display purposes) ──────────────────

/**
 * Walk up from startDir looking for project root markers.
 * Returns the detected root and what signal was found.
 */
function detectProjectRootForDisplay(startDir: string): { root: string; evidence: string; confidence: "high" | "medium" | "low" } {
    let dir = startDir;
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, ".git")))
            return { root: dir, evidence: "git repository", confidence: "high" };
        if (fs.existsSync(path.join(dir, "package.json")))
            return { root: dir, evidence: "package.json", confidence: "high" };
        if (fs.existsSync(path.join(dir, "Cargo.toml")))
            return { root: dir, evidence: "Cargo.toml", confidence: "high" };
        if (fs.existsSync(path.join(dir, "go.mod")))
            return { root: dir, evidence: "go.mod", confidence: "high" };
        if (fs.existsSync(path.join(dir, "pyproject.toml")))
            return { root: dir, evidence: "pyproject.toml", confidence: "high" };
        if (fs.existsSync(path.join(dir, "build.gradle")) || fs.existsSync(path.join(dir, "build.gradle.kts")))
            return { root: dir, evidence: "Gradle project", confidence: "high" };
        if (fs.existsSync(path.join(dir, "pom.xml")))
            return { root: dir, evidence: "Maven project", confidence: "high" };
        if (fs.existsSync(path.join(dir, ".engram")))
            return { root: dir, evidence: "existing .engram directory", confidence: "high" };
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return { root: startDir, evidence: "current directory (no project markers found)", confidence: "low" };
}

// ─── Fetch npm latest version ────────────────────────────────────────

async function fetchNpmLatest(): Promise<string | null> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5_000);
        const res = await fetch("https://registry.npmjs.org/engram-mcp-server/latest", {
            signal: controller.signal,
            headers: { "User-Agent": "engram-mcp-server" },
        });
        clearTimeout(timer);
        if (res.ok) {
            return ((await res.json() as Record<string, unknown>)["version"] as string);
        }
    } catch { /* network error — best effort */ }
    return null;
}

// ─── Resolve install status for a single IDE ─────────────────────────

interface IdeInstallStatus {
    state: "not-found" | "not-installed" | "installed" | "invalid-json";
    configPath: string;
    installedVersion?: string;
}

function resolveIdeInstallStatus(ide: IdeDefinition): IdeInstallStatus {
    const globalPaths = resolveIdeGlobalPaths(ide);
    for (const configPath of globalPaths) {
        if (!fs.existsSync(configPath)) continue;
        let config: Record<string, unknown>;
        try { config = readJson(configPath) as Record<string, unknown>; }
        catch (e) {
            if (e instanceof ConfigParseError) return { state: "invalid-json", configPath };
            throw e;
        }
        const serverMap = (config?.[ide.configKey] ?? {}) as Record<string, Record<string, unknown>>;
        const instanceKey = Object.keys(serverMap).find(k => {
            const en = serverMap[k];
            return k === "engram"
                || String(en?.command ?? "").includes("engram")
                || (Array.isArray(en?.args) && (en.args as string[]).some((a: string) => String(a).includes("engram")));
        });
        if (instanceKey) {
            const entry = serverMap[instanceKey];
            return { state: "installed", configPath, installedVersion: String(entry?._engram_version ?? "?") };
        }
        return { state: "not-installed", configPath };
    }
    // Check local dirs
    const cwd = process.cwd();
    if (ide.scopes.localDirs?.length) {
        for (const dir of ide.scopes.localDirs) {
            const localFile = ide.scopes.localFile ?? (dir === "" ? ".mcp.json" : "mcp.json");
            const lp = path.join(cwd, dir, localFile);
            if (!fs.existsSync(lp)) continue;
            let config: Record<string, unknown>;
            try { config = readJson(lp) as Record<string, unknown>; }
            catch (e) {
                if (e instanceof ConfigParseError) return { state: "invalid-json", configPath: lp };
                throw e;
            }
            const serverMap = (config?.[ide.configKey] ?? {}) as Record<string, Record<string, unknown>>;
            const instanceKey = Object.keys(serverMap).find(k => {
                const en = serverMap[k];
                return k === "engram"
                    || String(en?.command ?? "").includes("engram")
                    || (Array.isArray(en?.args) && (en.args as string[]).some((a: string) => String(a).includes("engram")));
            });
            if (instanceKey) {
                const entry = serverMap[instanceKey];
                return { state: "installed", configPath: lp, installedVersion: String(entry?._engram_version ?? "?") };
            }
            return { state: "not-installed", configPath: lp };
        }
    }
    return { state: "not-found", configPath: globalPaths[0] ?? "(no config path)" };
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
            const globalPaths = resolveIdeGlobalPaths(ide);

            if (globalPaths.length) {
                for (const gp of globalPaths) {
                    if (!fs.existsSync(gp)) {
                        // Config file doesn't exist — check if its parent dir does (IDE present but unconfigured)
                        if (!detected && fs.existsSync(path.dirname(gp))) detected = true;
                        continue;
                    }
                    detected = true;
                    if (installed) break; // Already found an install, no need to keep scanning
                    try {
                        const config = readJson(gp) as Record<string, unknown>;
                        const serverMap = (config?.[ide.configKey] ?? {}) as Record<string, Record<string, unknown>>;
                        const hasEngram = Object.keys(serverMap).some(k => {
                            const en = serverMap[k];
                            return k === "engram"
                                || String(en?.command ?? "").includes("engram")
                                || (Array.isArray(en?.args) && (en.args as string[]).some((a: string) => String(a).includes("engram")));
                        });
                        if (hasEngram) installed = true;
                    } catch (e) {
                        if (e instanceof ConfigParseError) {
                            console.warn(`  ⚠️  ${gp} — invalid JSON (run 'engram install' to repair)`);
                        }
                    }
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
        const { bold, dim, green, yellow, cyan, gray } = makeColors();
        const hr = "─".repeat(66);

        // ── Fetch npm latest ───────────────────────────────────────────────────
        process.stdout.write(`\n  ${bold("Engram Installation Check")}\n\n  Checking npm registry...`);
        const npmLatest = await fetchNpmLatest();

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

            // Global: for IDEs with resolveGlobalPaths (e.g. Android Studio with
            // multiple version-specific configs), show ALL found paths. For regular
            // IDEs with a single global path, this naturally resolves to one entry.
            if (ide.scopes.global?.length || ide.resolveGlobalPaths) {
                const globalPaths = resolveIdeGlobalPaths(ide);
                let anyFound = false;
                for (const gp of globalPaths) {
                    const e = resolveEntry(gp, "global", ide);
                    if (e.state !== "not-found") { entries.push(e); anyFound = true; }
                }
                if (!anyFound && globalPaths.length) {
                    entries.push({ state: "not-found", scope: "global", filePath: globalPaths[0] });
                }
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

        const globalPaths = resolveIdeGlobalPaths(ide);
        for (const configPath of globalPaths) {
            if (fs.existsSync(configPath)) {
                if (removeFromConfig(configPath, ide)) {
                    console.log(`✅ Removed Engram from ${configPath}`);
                    removed = true;
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
    const { bold, dim, green, yellow, cyan, gray } = makeColors();
    const currentVersion = getInstallerVersion();
    const hr = "─".repeat(60);

    const currentIde = detectCurrentIde();
    const allDetected = detectInstalledIdes();
    const otherDetected = allDetected.filter(id => id !== currentIde);

    if (currentIde && IDE_CONFIGS[currentIde]) {
        const ide = IDE_CONFIGS[currentIde];
        const status = resolveIdeInstallStatus(ide);
        const cwd = process.cwd();
        const projectInfo = detectProjectRootForDisplay(cwd);

        // ── Fetch npm latest for version comparison ──────────────────────
        process.stdout.write(`\n  ${gray("Checking npm registry...")}`);
        const npmLatest = await fetchNpmLatest();
        process.stdout.write(`\r${" ".repeat(40)}\r`); // Clear the checking line

        // ── Status panel ─────────────────────────────────────────────────
        console.log(`\n  ${gray(hr)}`);
        console.log(`  ${bold("🧠 Engram MCP Installer")}  ${gray("v" + currentVersion)}`);
        console.log(`  ${gray(hr)}`);
        console.log(`  Detected IDE  : ${bold(ide.name)}`);
        console.log(`  Config file   : ${gray(status.configPath)}`);
        console.log(`  Database root : ${gray(projectInfo.root)}  ${dim("(" + projectInfo.evidence + ")")}`);

        // Version status
        if (status.state === "installed" && status.installedVersion) {
            const ver = status.installedVersion === "?" ? gray("v? (pre-tracking)") : cyan("v" + status.installedVersion);
            const ref = npmLatest ?? currentVersion;
            const isOld = status.installedVersion === "?" || semverCmp(status.installedVersion, ref) < 0;
            const versionStatus = isOld
                ? npmLatest ? yellow(`⬆  v${npmLatest} available`) : yellow(`⬆  v${currentVersion} available`)
                : green("✅ up to date");
            console.log(`  Installed     : ${ver}  ${versionStatus}`);
        } else if (status.state === "not-installed") {
            console.log(`  Installed     : ${dim("not installed")}`);
        } else if (status.state === "invalid-json") {
            console.log(`  Installed     : ${yellow("⚠ config has invalid JSON")}`);
        } else {
            console.log(`  Installed     : ${dim("no config file found")}`);
        }

        if (npmLatest && semverCmp(currentVersion, npmLatest) < 0) {
            console.log(`  npm latest    : ${cyan("v" + npmLatest)}`);
        }

        console.log(`  ${gray(hr)}\n`);

        if (nonInteractive) {
            // Install/update current IDE, then all other detected IDEs
            await performInstallationForIde(currentIde, ide, true, universalMode, forceGlobal);
            for (const id of otherDetected) {
                await performInstallationForIde(id, IDE_CONFIGS[id], true, universalMode, forceGlobal);
            }
            return;
        }

        // ── Build menu options ───────────────────────────────────────────
        const menuOptions: Array<{ label: string; action: () => Promise<void> }> = [];

        if (status.state === "installed") {
            const ref = npmLatest ?? currentVersion;
            const isOld = status.installedVersion === "?" || semverCmp(status.installedVersion!, ref) < 0;
            if (isOld) {
                menuOptions.push({
                    label: `Update Engram to v${currentVersion} in ${ide.name}`,
                    action: () => performInstallationForIde(currentIde!, ide, false, universalMode, forceGlobal),
                });
            } else {
                menuOptions.push({
                    label: `Reinstall / repair Engram in ${ide.name}`,
                    action: () => performInstallationForIde(currentIde!, ide, false, universalMode, forceGlobal),
                });
            }
        } else {
            menuOptions.push({
                label: `Install Engram in ${ide.name}`,
                action: () => performInstallationForIde(currentIde!, ide, false, universalMode, forceGlobal),
            });
        }

        menuOptions.push({
            label: "Enter a custom config directory...",
            action: async () => {
                const customPath = await askQuestion("  Enter the path to the directory containing (or to create) the MCP config file:\n  > ");
                if (!customPath.trim()) {
                    console.log("  No path provided. Cancelled.");
                    return;
                }
                const resolvedPath = path.resolve(customPath.trim());
                // Check if the path already has an mcp config file
                const hasConfig = fs.existsSync(path.join(resolvedPath, "mcp.json"))
                    || fs.existsSync(path.join(resolvedPath, ".mcp.json"));
                const configFileName = hasConfig
                    ? (fs.existsSync(path.join(resolvedPath, "mcp.json")) ? "mcp.json" : ".mcp.json")
                    : "mcp.json";
                const configFilePath = path.join(resolvedPath, configFileName);
                if (!hasConfig) {
                    console.log(`\n  ℹ️  No existing MCP config found at ${resolvedPath}`);
                    console.log(`     A new ${configFileName} will be created there.`);
                }
                const customIde: IdeDefinition = {
                    name: "Custom Path",
                    configKey: "mcpServers",
                    requiresType: false,
                    requiresCmdWrapper: false,
                    scopes: {},
                };
                await installToPath(configFilePath, customIde, universalMode);
            },
        });

        if (otherDetected.length > 0) {
            menuOptions.push({
                label: `Install to other IDEs on this system (${otherDetected.length} found)...`,
                action: async () => {
                    console.log("\n  Other detected IDEs:\n");
                    otherDetected.forEach((id, i) => {
                        const oStatus = resolveIdeInstallStatus(IDE_CONFIGS[id]);
                        const stLabel = oStatus.state === "installed"
                            ? green("installed")
                            : dim("not installed");
                        console.log(`    ${i + 1}. ${IDE_CONFIGS[id].name}  ${stLabel}`);
                    });
                    const allIdx = otherDetected.length + 1;
                    console.log(`    ${allIdx}. Install to ALL of the above`);
                    console.log(`    0. Cancel`);
                    const ans = await askQuestion(`\n  Select [0-${allIdx}]: `);
                    const ch = parseInt(ans.trim(), 10);
                    if (isNaN(ch) || ch === 0) return;
                    if (ch === allIdx) {
                        for (const id of otherDetected) {
                            await performInstallationForIde(id, IDE_CONFIGS[id], false, universalMode, forceGlobal);
                        }
                    } else if (ch >= 1 && ch <= otherDetected.length) {
                        const selId = otherDetected[ch - 1];
                        await performInstallationForIde(selId, IDE_CONFIGS[selId], false, universalMode, forceGlobal);
                    } else {
                        console.log("  Invalid selection.");
                    }
                },
            });
        }

        menuOptions.push({
            label: "Cancel",
            action: async () => { console.log("  Installation cancelled."); },
        });

        // ── Print menu ───────────────────────────────────────────────────
        console.log("  What would you like to do?\n");
        menuOptions.forEach((opt, i) => {
            console.log(`    ${i + 1}. ${opt.label}`);
        });

        const ans = await askQuestion(`\n  Select [1-${menuOptions.length}]: `);
        const choice = parseInt(ans.trim(), 10);
        if (isNaN(choice) || choice < 1 || choice > menuOptions.length) {
            // Default to first option (install/update) if user just presses Enter
            if (ans.trim() === "") {
                await menuOptions[0].action();
            } else {
                console.log("  Invalid selection. Exiting.");
                process.exit(1);
            }
        } else {
            await menuOptions[choice - 1].action();
        }
        return;
    }

    // ── No IDE detected from environment ─────────────────────────────
    if (nonInteractive) {
        if (allDetected.length > 0) {
            console.log(`\n🧠 Engram MCP Installer v${currentVersion}\n`);
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

    // ── Interactive fall-through: no IDE detected, show full list ─────
    console.log(`\n  ${gray(hr)}`);
    console.log(`  ${bold("🧠 Engram MCP Installer")}  ${gray("v" + currentVersion)}`);
    console.log(`  ${gray(hr)}`);
    console.log(`  ${dim("No IDE detected from terminal environment.")}`);
    console.log(`  ${dim("Select an IDE to install Engram for:")}\n`);

    const ideKeys = Object.keys(IDE_CONFIGS);
    ideKeys.forEach((key, index) => {
        const oStatus = resolveIdeInstallStatus(IDE_CONFIGS[key]);
        const stLabel = oStatus.state === "installed"
            ? green("installed")
            : oStatus.state === "not-installed"
                ? dim("detected")
                : "";
        console.log(`    ${(index + 1).toString().padStart(2)}. ${IDE_CONFIGS[key].name}  ${stLabel}`);
    });

    const customOpt = ideKeys.length + 1;
    console.log(`    ${customOpt.toString().padStart(2)}. Custom config directory...`);
    console.log(`     0. Cancel`);

    const answer = await askQuestion(`\n  Select [0-${customOpt}]: `);
    const choice = parseInt(answer.trim(), 10);

    if (isNaN(choice) || choice === 0) {
        console.log("  Installation cancelled.");
        process.exit(0);
    }

    if (choice === customOpt) {
        const customPath = await askQuestion("  Enter the path to the directory containing (or to create) the MCP config file:\n  > ");
        if (!customPath.trim()) {
            console.log("  No path provided. Exiting.");
            process.exit(1);
        }
        const resolvedPath = path.resolve(customPath.trim());
        const configFilePath = path.join(resolvedPath, "mcp.json");
        const customIde: IdeDefinition = {
            name: "Custom Path",
            configKey: "mcpServers",
            requiresType: false,
            requiresCmdWrapper: false,
            scopes: {},
        };
        await installToPath(configFilePath, customIde, universalMode);
    } else if (choice >= 1 && choice <= ideKeys.length) {
        const selectedKey = ideKeys[choice - 1];
        await performInstallationForIde(selectedKey, IDE_CONFIGS[selectedKey], false, universalMode, forceGlobal);
    } else {
        console.log("\n  Invalid selection. Exiting.");
        process.exit(1);
    }
}

// ─── Per-IDE Installation ────────────────────────────────────────────

async function performInstallationForIde(id: string, ide: IdeDefinition, nonInteractive: boolean, universal = false, forceGlobal = false) {
    const supportsLocal = ide.scopes?.localDirs && ide.scopes.localDirs.length > 0;
    const supportsGlobal = (ide.scopes?.global && ide.scopes.global.length > 0) || !!ide.resolveGlobalPaths;

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
        console.log(`\n  ${ide.name} supports two MCP config locations:\n`);
        console.log(`    1. Global  — user-level IDE config (all projects share this MCP server)`);
        console.log(`    2. Local   — project-specific config file (recommended)`);
        console.log(`\n  Note: This controls WHERE the MCP entry is registered, not where Engram`);
        console.log(`  stores its database. The database is always per-project automatically.\n`);
        const scopeAns = await askQuestion("  Select scope [1-2] (default 2 — local): ");
        if (scopeAns.trim() === "1") {
            targetScope = "global";
        } else {
            targetScope = "local";
        }
    }

    if (targetScope === "global" && supportsGlobal) {
        // Global installs on IDEs without workspaceVar get --ide=<id> so the server
        // opens a per-IDE DB shard (memory-{id}.db) instead of competing on memory.db.
        const globalIdeKey = ide.workspaceVar ? undefined : id;

        // For IDEs with versioned config dirs (e.g. Android Studio), install to ALL
        // found versions; for regular IDEs pick the first existing path or the default.
        if (ide.resolveGlobalPaths) {
            const allPaths = ide.resolveGlobalPaths();
            if (allPaths.length === 0) {
                console.log(`\n⚠️  ${ide.name} — no config directories found on this machine.`);
            } else {
                for (const configPath of allPaths) {
                    await installToPath(configPath, ide, universal, globalIdeKey);
                }
            }
        } else {
            const configPath = ide.scopes.global!.find((p: string) => fs.existsSync(p)) || ide.scopes.global![0];
            await installToPath(configPath, ide, universal, globalIdeKey);
        }
    } else if (targetScope === "local") {
        if (nonInteractive) {
            // Use cwd as the project root
            const localDirPrefix = ide.scopes.localDirs![0];
            const configFileName = ide.scopes.localFile ?? (localDirPrefix === "" ? ".mcp.json" : "mcp.json");
            const configPath = path.join(process.cwd(), localDirPrefix, configFileName);
            await installToPath(configPath, ide, universal);
        } else {
            const cwd = process.cwd();
            const projectInfo = detectProjectRootForDisplay(cwd);
            const localDirPrefix = ide.scopes.localDirs![0];
            const configFileName = ide.scopes.localFile ?? (localDirPrefix === "" ? ".mcp.json" : "mcp.json");
            const configPath = path.join(projectInfo.root, localDirPrefix, configFileName);

            if (projectInfo.confidence === "high") {
                console.log(`\n  Detected project root: ${projectInfo.root}  (${projectInfo.evidence})`);
                console.log(`  Config will be written to: ${configPath}\n`);
                const confirmAns = await askQuestion("  Is this correct? [Y/n / enter different path]: ");
                const trimmed = confirmAns.trim();
                if (trimmed.toLowerCase() === "n") {
                    console.log("  Installation cancelled.");
                    return;
                } else if (trimmed && trimmed.toLowerCase() !== "y" && trimmed.toLowerCase() !== "yes") {
                    // User typed a custom path
                    const resolvedDir = path.resolve(trimmed);
                    const customConfigPath = path.join(resolvedDir, localDirPrefix, configFileName);
                    await installToPath(customConfigPath, ide, universal);
                    return;
                }
                await installToPath(configPath, ide, universal);
            } else {
                // Low confidence — ask the user explicitly
                console.log(`\n  ⚠️  Could not detect a project root from the current directory.`);
                console.log(`     (no .git, package.json, or other project markers found)\n`);
                const solutionDir = await askQuestion(`  Enter the path to your ${ide.name} project directory:\n  [${cwd}]: `);
                const resolvedDir = solutionDir.trim() || cwd;
                const customConfigPath = path.join(resolvedDir, localDirPrefix, configFileName);
                await installToPath(customConfigPath, ide, universal);
            }
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
