// ============================================================================
// Engram MCP Server — Installer Orchestrator
// ============================================================================

import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import { IDE_CONFIGS, type IdeDefinition } from "./ide-configs.js";
import { addToConfig, removeFromConfig, makeEngramEntry, readJson, getInstallerVersion, ConfigParseError, findEngramEntryKey } from "./config-writer.js";
import { detectCurrentIde, detectInstalledIdes, detectVscodeExtensionAmbiguity, detectVscodeForkAmbiguity, resolveIdeGlobalPaths, resolveIdeLocalPaths, resolveIdeLocalInstallPath } from "./ide-detector.js";
import { ENGRAM_HOOK_MARKER, isEngramHook, stripEngramHookBlock } from "../git-hook.js";
import {
    DEFAULT_WALK_UP, detectProjectRoot, resolveDbPath, globalFallbackDbPath,
    discoverLocal, discoverGlobal, discoverEverywhere, groupByIde,
    formatVersion, abbreviatePath,
    recordInstall, forgetInstall, ledgerPath, pruneLedger,
    type DiscoveredInstall,
} from "./discovery.js";
import { select, multiselect, ask, confirm } from "./prompt.js";

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

// Project-root detection used to be duplicated here, with its own marker list in
// its own order. It now comes from discovery.ts, which is also what the plan
// panel and the local search use — one rule, so the path shown to the user
// before the write is the path searched afterwards.
const detectProjectRootForDisplay = detectProjectRoot;

// ─── Install options carried through the call chain ─────────────────

/**
 * Everything the user chose, resolved once and passed down.
 *
 * These used to be five positional booleans threaded through two functions, and
 * adding the sixth is what made the shape untenable.
 */
interface InstallOptions {
    nonInteractive: boolean;
    universal: boolean;
    forceGlobal: boolean;
    forceLocal: boolean;
    /** Skip the machine-wide ledger, so this install is not discoverable later. */
    isolated: boolean;
    /** How many parent directories a local search climbs. */
    walkUp: number;
}

// ─── Fetch npm latest version ────────────────────────────────────────

async function fetchNpmLatest(): Promise<string | null> {
    // tests/installer/install-remove-e2e.test.ts has set this since it was
    // written, with a comment explaining that it keeps the suite off the
    // network. Nothing read it. The variable was fiction and the suite was not
    // hermetic — it simply never happened to reach this function. Honouring it
    // makes the declared control real before a --check test quietly restores
    // the network dependency it was meant to remove.
    if (process.env.ENGRAM_SKIP_UPDATE_CHECK) return null;
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

/**
 * Where this IDE's Engram entry is, searched THE WAY THE USER IS STANDING.
 *
 * The old order was global-first: every user-level config path was examined,
 * and the project was consulted only if no global config file existed at all.
 * Two consequences, both of which read as the installer not knowing what it had
 * just done:
 *
 *   - A user with a project-local install and any global config file present —
 *     which is nearly everyone, since the global file exists as soon as the IDE
 *     writes any setting — was told "not installed" and shown their home
 *     directory, while the entry sat in the repo they were standing in.
 *   - Local paths were only ever checked relative to the exact cwd, so a config
 *     at the repo root was invisible from `src/`, which is where people run
 *     commands.
 *
 * Local now wins, and the local search climbs. `walkUp` is bounded because the
 * parent of a shallow project is the home directory.
 */
function resolveIdeInstallStatus(ide: IdeDefinition, walkUp = DEFAULT_WALK_UP): IdeInstallStatus {
    const readAt = (configPath: string): IdeInstallStatus | null => {
        if (!fs.existsSync(configPath)) return null;
        let config: Record<string, unknown>;
        try { config = readJson(configPath) as Record<string, unknown>; }
        catch (e) {
            if (e instanceof ConfigParseError) return { state: "invalid-json", configPath };
            throw e;
        }
        const serverMap = (config?.[ide.configKey] ?? {}) as Record<string, Record<string, unknown>>;
        const instanceKey = findEngramEntryKey(serverMap);
        if (!instanceKey) return { state: "not-installed", configPath };
        const entry = serverMap[instanceKey];
        return { state: "installed", configPath, installedVersion: String(entry?._engram_version ?? "?") };
    };

    // ── Local first, climbing ──
    // A file that exists but holds no Engram entry is remembered rather than
    // returned: an INSTALL further up beats a NOT-INSTALLED here, and returning
    // on the first existing file is precisely the bug being fixed.
    let firstBare: IdeInstallStatus | null = null;
    let dir = process.cwd();
    const stopAt = detectProjectRoot(dir).root;
    for (let up = 0; up <= walkUp; up++) {
        for (const lp of resolveIdeLocalPaths(ide, dir)) {
            const hit = readAt(lp);
            if (hit?.state === "installed" || hit?.state === "invalid-json") return hit;
            if (hit && !firstBare) firstBare = hit;
        }
        if (path.resolve(dir) === path.resolve(stopAt)) break;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    // ── Then the machine ──
    const globalPaths = resolveIdeGlobalPaths(ide);
    for (const configPath of globalPaths) {
        const hit = readAt(configPath);
        if (hit?.state === "installed" || hit?.state === "invalid-json") return hit;
        if (hit && !firstBare) firstBare = hit;
    }

    if (firstBare) return firstBare;
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
    const forceLocal = args.includes("--local");
    const isolated = args.includes("--isolated");

    // --walk-up N. Rejecting a bad value rather than falling back silently: a
    // user who typed `--walk-up abc` asked for something specific and a silent
    // default would search a different tree than the one they named.
    let walkUp = DEFAULT_WALK_UP;
    const walkIdx = args.indexOf("--walk-up");
    if (walkIdx >= 0) {
        const raw = args[walkIdx + 1];
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 20) {
            console.error(`❌ --walk-up expects a whole number 0-20, got "${raw ?? "(nothing)"}".`);
            process.exit(1);
        }
        walkUp = n;
    }

    // --scope for the read-only commands. Install scope stays on --local/--global
    // because those are already published and scripts depend on them (decision #42).
    const scopeIdx = args.indexOf("--scope");
    const scopeRaw = scopeIdx >= 0 ? args[scopeIdx + 1] : undefined;
    if (scopeRaw !== undefined && !["local", "global", "all"].includes(scopeRaw)) {
        console.error(`❌ --scope expects local, global or all, got "${scopeRaw}".`);
        process.exit(1);
    }
    const scope = (scopeRaw ?? "all") as "local" | "global" | "all";

    const opts: InstallOptions = { nonInteractive, universal: universalMode, forceGlobal, forceLocal, isolated, walkUp };

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
  npx -y engram-mcp-server@latest install [options]

  The @latest is not decoration. npx caches by package name, so a bare
  "npx -y engram-mcp-server" re-runs whatever version it downloaded the
  first time — README.md documents this trap and every command there
  carries the tag. Printing one without it here taught the opposite.

Options:
  --ide <name>      Install for a specific IDE
  --universal       Install in universal mode (~80 token single-tool schema, recommended)
  --yes, -y         Non-interactive mode (requires --ide if no IDE is detected)
  --global          Force global (user-level) installation instead of project-level
  --local           Force project-level installation instead of global
  --isolated        Do not record this install in ~/.engram/installs.json, so it
                    will NOT be found by 'engram install --check --scope global'.
                    You are responsible for remembering where it went.
  --remove          Remove Engram from an IDE config (requires --ide)
  --list            Show all supported IDEs and their detection/install status
  --check            Show what is installed, where, and whether it is current
  --update          With --check: update every outdated install, no prompt.
                    Add --ide <name> to update only that one. Without this
                    flag --check never writes anything.
  --scope <s>       Narrow --check to local | global | all   (default: all)
  --walk-up <n>     How many parent directories a local search climbs (default: ${DEFAULT_WALK_UP})
  --install-hooks   Install git post-commit hook to auto-record changes (run in your git repo)
  --remove-hooks    Remove the Engram git hook from the current repo
  --version         Show version number
  --help, -h        Show this help

Supported IDEs:
  ${ideNames}

Exit codes:
  0  success (for --check: every config that exists is readable)
  1  an install was attempted and failed, or --check found an unreadable config

Scope, and what it does NOT control:
  Scope decides WHERE THE MCP ENTRY IS REGISTERED — a project config file, or
  your user-level IDE config. It does not decide where memory is stored. Memory
  is always per-project: the server opens <project>/.engram/memory.db, so one
  global entry still gives each project its own separate database.

  With --yes, installs default to GLOBAL scope; interactive installs default to
  local. That difference is deliberate and kept for compatibility — pass --local
  or --global to be explicit in scripts.

Examples:
  engram install --universal                   Auto-detect IDE, install interactively
  engram install --ide vscode --universal      Install universal mode for VS Code
  engram install --ide claudecode --yes        Non-interactive install for Claude Code
  engram install --check                       What is installed here and machine-wide
  engram install --check --update              Update every outdated install, no prompt
  engram install --check --update --ide vscode Update just that one
  engram install --check --scope local         Only this project and its parents
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
    //
    // REBUILT AROUND THE QUESTION A USER ACTUALLY ASKS. The old --check swept
    // the global config paths of all 14 IDEs and printed them in registry order,
    // which answered "what does this machine have" while the person running it
    // was standing in a project asking "is Engram set up HERE". Local entries
    // appeared only if a global config file happened not to exist, and a local
    // config one directory up — the repo root, when you run commands from src/ —
    // was never found at all.
    //
    // Now: the project first, climbing a bounded number of parents; the machine
    // second; the ledger third, because a custom-directory install lives nowhere
    // else. Every section names what it searched, so "not installed" is a search
    // result rather than an assertion.
    if (args.includes("--check")) {
        const currentVersion = getInstallerVersion();
        const cwd = process.cwd();
        // --update turns the report into an action, without a prompt. Narrowed
        // by --ide when the caller wants exactly one. Parsed here rather than
        // with the other flags so it stays next to the branch that honours it.
        const updateRequested = args.includes("--update");
        const checkIdeIdx = args.indexOf("--ide");
        const updateIdeFilter = checkIdeIdx >= 0 ? args[checkIdeIdx + 1] : undefined;
        if (updateRequested && updateIdeFilter && !IDE_CONFIGS[updateIdeFilter]) {
            console.error(`Unknown IDE: "${updateIdeFilter}". Options: ${Object.keys(IDE_CONFIGS).join(", ")}`);
            process.exitCode = 1;
            return;
        }
        const { bold, dim, green, yellow, cyan, gray } = makeColors();
        const hr = "─".repeat(66);

        process.stdout.write(`\n  ${bold("Engram Installation Check")}\n\n  Checking npm registry...`);
        const npmLatest = await fetchNpmLatest();

        const selfCmp = npmLatest ? semverCmp(currentVersion, npmLatest) : 0;
        // Skipped and unreachable are different facts and were reported as the
        // same one. A user who set the variable deliberately should not be told
        // their network is broken.
        const skipped = !!process.env.ENGRAM_SKIP_UPDATE_CHECK;
        const selfStatus = !npmLatest ? gray(skipped ? "(update check skipped)" : "(npm unreachable)")
            : selfCmp > 0 ? yellow("⚡ ahead of npm")
            : selfCmp === 0 ? green("✅ up to date")
            : yellow(`⬆  v${npmLatest} is available`);

        process.stdout.write(`\r  This build : ${cyan("v" + currentVersion)}  ${selfStatus}${" ".repeat(12)}\n`);
        if (npmLatest) process.stdout.write(`  npm latest : ${cyan("v" + npmLatest)}\n`);

        const reference = npmLatest ?? currentVersion;
        const isBehind = (v: string) => v === "?" || semverCmp(v, reference) < 0;

        // ── Gather ─────────────────────────────────────────────────────────
        const wantLocal = scope === "local" || scope === "all";
        const wantGlobal = scope === "global" || scope === "all";

        const local = wantLocal ? discoverLocal(cwd, walkUp) : { installs: [], problems: [], searched: [] };
        const global = wantGlobal ? discoverGlobal() : { installs: [], problems: [], searched: [] };

        const projectInfo = detectProjectRoot(cwd);
        process.stdout.write(`  Searching  : ${gray(cwd)}\n`);
        if (wantLocal) {
            process.stdout.write(`               ${dim(`project root ${projectInfo.root} (${projectInfo.evidence}); climbing at most ${walkUp} parent(s)`)}\n`);
        }

        // ── Render one install ─────────────────────────────────────────────
        const renderInstall = (e: DiscoveredInstall) => {
            const behind = isBehind(e.version);
            const icon = behind ? yellow("⬆ ") : green("✅");
            const ver = e.version === "?" ? gray(formatVersion(e.version)) : cyan(formatVersion(e.version));
            const state = behind ? (npmLatest ? yellow("update available") : yellow(`behind v${currentVersion}`)) : green("up to date");
            const mode = e.mode === "universal" ? dim("universal") : e.mode === "classic" ? dim("4-tool") : dim("mode unknown");
            console.log(`    ${icon} ${bold(e.ideName.padEnd(20))} ${ver}  ${mode}  ${state}`);
            const rel = e.scope === "local" ? (path.relative(cwd, e.configPath) || e.configPath) : e.configPath;
            const upNote = e.distanceUp > 0 ? dim(`  (${e.distanceUp} directory up)`) : "";
            console.log(`         ${gray("config  " + rel)}${upNote}`);
            if (e.dbPath) {
                console.log(`         ${gray("memory  " + e.dbPath)}`);
            } else {
                // A global entry with no workspace variable cannot be told where
                // the project is, so the database location is decided at runtime.
                // Saying so is the honest answer; printing a guess is not.
                console.log(`         ${gray("memory  resolved at runtime from the IDE's working directory")}`);
            }
        };

        // ── This project ───────────────────────────────────────────────────
        if (wantLocal) {
            console.log(`\n  ${gray(hr)}`);
            console.log(`  ${bold("THIS PROJECT")}  ${dim("— project-local config files")}`);
            console.log(`  ${gray(hr)}`);
            if (local.installs.length === 0) {
                console.log(`    ${dim("no project-local install found")}`);
                console.log(`    ${gray(`searched ${local.searched.length} candidate path(s) across ${walkUp + 1} directory level(s)`)}`);
                console.log(`    ${gray("→ engram install --universal --local")}`);
            } else {
                local.installs.sort((a, b) => a.distanceUp - b.distanceUp || a.ideName.localeCompare(b.ideName));
                local.installs.forEach(renderInstall);
            }
        }

        // ── Machine-wide ───────────────────────────────────────────────────
        if (wantGlobal) {
            console.log(`\n  ${gray(hr)}`);
            console.log(`  ${bold("MACHINE-WIDE")}  ${dim("— user-level IDE configs")}`);
            console.log(`  ${gray(hr)}`);
            if (global.installs.length === 0) {
                console.log(`    ${dim("no user-level install found")}`);
                console.log(`    ${gray(`searched ${global.searched.length} config path(s) across ${Object.keys(IDE_CONFIGS).length} IDEs`)}`);
            } else {
                global.installs.sort((a, b) => a.ideName.localeCompare(b.ideName));
                global.installs.forEach(renderInstall);
            }
        }

        // ── The ledger ─────────────────────────────────────────────────────
        // Only rows the scan could not have reached. Repeating an install that
        // already appeared above would pad the report and teach the reader that
        // the two sections mean the same thing, which they do not: the scan is
        // the fact and the ledger is the record of an intent.
        const scanned = new Set([...local.installs, ...global.installs].map(e => path.resolve(e.configPath)));
        const { kept, dropped } = pruneLedger();
        const ledgerOnly = kept.filter(e => !scanned.has(path.resolve(e.configPath)));
        if (ledgerOnly.length || dropped.length) {
            console.log(`\n  ${gray(hr)}`);
            console.log(`  ${bold("RECORDED ELSEWHERE")}  ${dim("— " + ledgerPath())}`);
            console.log(`  ${gray(hr)}`);
            for (const e of ledgerOnly) {
                const behind = isBehind(e.version);
                console.log(`    ${behind ? yellow("⬆ ") : green("✅")} ${bold(e.ideName.padEnd(20))} ${cyan("v" + e.version)}  ${dim(e.scope)}`);
                console.log(`         ${gray("config  " + e.configPath)}`);
                if (e.dbPath) console.log(`         ${gray("memory  " + e.dbPath)}`);
            }
            for (const e of dropped) {
                console.log(`    ${gray("·")} ${dim(e.ideName.padEnd(20))} ${gray("recorded, but the entry is no longer in that config")}`);
                console.log(`         ${gray("config  " + e.configPath)}`);
            }
            if (dropped.length) {
                console.log(`\n    ${dim("Entries marked · were installed and have since been removed or rewritten,")}`);
                console.log(`    ${dim("which the host application does on its own schedule. Re-install to restore.")}`);
            }
        }

        // ── Problems ───────────────────────────────────────────────────────
        const unreadable = [...local.problems, ...global.problems];
        if (unreadable.length) {
            console.log(`\n  ${gray(hr)}`);
            console.log(`  ${yellow("UNREADABLE")}  ${dim("— Engram will not write to a config it cannot parse")}`);
            console.log(`  ${gray(hr)}`);
            for (const p of unreadable) {
                console.log(`    ${yellow("⚠")}  ${p.ideName}: ${p.reason}`);
                console.log(`         ${gray(p.configPath)}`);
            }
        }

        // ── Summary ────────────────────────────────────────────────────────
        const found = [...local.installs, ...global.installs];
        const stale = found.filter(e => isBehind(e.version));
        const parts: string[] = [];
        if (found.length) parts.push(green(`${found.length} installed`));
        if (stale.length) parts.push(yellow(`${stale.length} need update`));
        if (unreadable.length) parts.push(yellow(`${unreadable.length} unreadable`));
        if (!parts.length) parts.push(dim("nothing found"));

        console.log(`\n  ${gray(hr)}`);
        console.log(`  ${parts.join(gray("  ·  "))}`);
        console.log(`  ${gray("Releases: https://github.com/keggan-std/Engram/releases")}\n`);

        // ── Offer to act ───────────────────────────────────────────────────
        //
        // --check used to print and stop, so a user who had just been told three
        // installs were stale had to retype a command per install and remember
        // which. It now offers to do the thing it just described. Read-only
        // unless the user picks an action, and skipped entirely when
        // non-interactive: a status command that writes on its own in a script
        // would be a far worse surprise than one that only prints.
        const updateOne = async (e: DiscoveredInstall): Promise<boolean> => {
            const ide = IDE_CONFIGS[e.ideKey];
            if (!ide) {
                console.log(`  ${yellow("⚠")}  ${e.ideName} is no longer a known IDE key — skipping ${e.configPath}`);
                return false;
            }
            // Reproduce the rule the original install followed rather than
            // inventing one: a global entry on an IDE with no workspace
            // variable gets its per-IDE shard key; a local entry gets the
            // absolute project root. Preserve the mode that is already
            // there — silently converting someone's 4-tool install to
            // universal because universal is now recommended would be a
            // change they did not ask for.
            const ideKey = e.scope === "global" && !ide.workspaceVar ? e.ideKey : undefined;
            const projectRoot = e.scope === "local" ? e.projectRoot : undefined;
            return installToPath(e.configPath, ide, e.mode === "universal", ideKey, projectRoot, {
                isolated, scope: e.scope, ideKey: e.ideKey, projectRoot,
            });
        };

        const printManualCommands = (targets: DiscoveredInstall[]) => {
            const grouped = new Map<string, DiscoveredInstall[]>();
            for (const e of targets) {
                const scopeFlag = e.scope === "local" ? "--local" : "--global";
                const modeFlag = e.mode === "universal" ? " --universal" : "";
                const cmd = `npx -y engram-mcp-server@latest install --ide ${e.ideKey} ${scopeFlag}${modeFlag}`;
                grouped.set(cmd, [...(grouped.get(cmd) ?? []), e]);
            }
            // Deduplicated. Four Android Studio channels produce four IDENTICAL
            // commands, and printing them four times says "run this four times"
            // — which is both wrong and impossible to act on, since nothing in
            // the repeated line distinguishes which config it would reach.
            // One line per distinct command, with the count and the paths it
            // covers, is the same information without the false implication.
            for (const [cmd, entries] of grouped) {
                console.log(`  ${cmd}`);
                if (entries.length > 1) {
                    console.log(`  ${dim(`  ↳ covers all ${entries.length}:`)}`);
                    for (const e of entries) {
                        console.log(`  ${gray(`      ${abbreviatePath(e.configPath, e.scope === "local" ? cwd : undefined)}`)}`);
                    }
                }
            }
            console.log();
        };

        let failed = 0;

        if (stale.length && updateRequested) {
            // ── --update: the scriptable half ──────────────────────────────
            //
            // The interactive offer below cannot be reached by a script, a CI
            // job, or an agent, and those are exactly the callers that would
            // keep a fleet current. Without this flag the ONLY way to update N
            // installs without a human at a keyboard is to retype one command
            // per install — which is the friction task #107 is about, one level
            // up: a fix that is published still does not arrive if arriving
            // requires someone to remember to do it by hand.
            //
            // Writing is opt-in and explicit. --check stays read-only unless
            // this flag is present, because a status command that writes on its
            // own in a script is a far worse surprise than one that only prints.
            const targets = updateIdeFilter
                ? stale.filter(e => e.ideKey === updateIdeFilter)
                : stale;

            if (!targets.length) {
                console.log(`  ${yellow(`--ide ${updateIdeFilter} matched none of the ${stale.length} outdated install(s).`)}`);
                console.log(`  ${dim("Outdated: " + stale.map(e => e.ideKey).join(", "))}\n`);
                process.exitCode = 1;
            } else {
                console.log(`  ${bold(`Updating ${targets.length} install(s) to v${currentVersion}...`)}\n`);
                for (const e of targets) if (!await updateOne(e)) failed++;
            }
        } else if (stale.length && !nonInteractive) {
            const choice = await select(`${stale.length} install(s) are behind v${reference}. What now?`, [
                { label: `Update all ${stale.length}`, value: "all" as const, recommended: true },
                { label: "Choose which ones to update", value: "pick" as const, hint: "multi-select" },
                { label: "Do nothing", value: "none" as const, hint: "print the commands instead" },
            ]);

            if (choice.value === "all" && !choice.cancelled) {
                for (const e of stale) if (!await updateOne(e)) failed++;
            } else if (choice.value === "pick" && !choice.cancelled) {
                // multiselect, not select. The report above may list ten rows;
                // single-pick meant ten runs of the command to act on the report
                // it had just printed once.
                const picked = await multiselect("Space to toggle, Enter to update the selected", stale.map(e => ({
                    label: `${e.ideName}  ${formatVersion(e.version)} → v${reference}`,
                    hint: `${e.scope}  ${abbreviatePath(e.configPath, e.scope === "local" ? cwd : undefined)}`,
                    value: e,
                })));
                if (picked.cancelled) {
                    console.log(`  ${dim("Cancelled — nothing was written.")}\n`);
                } else if (!picked.values.length) {
                    console.log(`  ${dim("Nothing selected — nothing was written.")}\n`);
                    printManualCommands(stale);
                } else {
                    console.log(`\n  ${bold(`Updating ${picked.values.length} install(s) to v${currentVersion}...`)}\n`);
                    for (const e of picked.values) if (!await updateOne(e)) failed++;
                }
            } else {
                printManualCommands(stale);
            }
        } else if (stale.length) {
            console.log(`  ${dim("Non-interactive. To update these without a prompt:")}`);
            console.log(`  ${gray("engram install --check --update")}              ${dim("all of them")}`);
            console.log(`  ${gray("engram install --check --update --ide <name>")}  ${dim("just one")}\n`);
            printManualCommands(stale);
        }

        if (failed) {
            console.log(`\n  ${yellow(`${failed} update(s) failed — see the reasons above.`)}\n`);
            process.exitCode = 1;
        }

        // --check exists to be READ BY SOMETHING. It printed "invalid JSON"
        // and exited 0, so a script could not act on the one state that is
        // unambiguously broken. PROVEN: a corrupt config printed the warning
        // and returned 0.
        //
        // Only invalid JSON is an error. "Update available" stays 0 on purpose:
        // a gate that goes red every time a release lands is one a developer
        // switches off inside a week, which is check-state-freshness.mjs's own
        // documented reasoning and it applies unchanged here.
        //
        // NOT process.exit(). This branch is the one that calls fetch(), and
        // process.exit() after a fetch trips a libuv assertion on Windows:
        //
        //   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
        //   file src\win\async.c, line 76
        //
        // PROVEN 5/5 on node v24.14.1 before decision #41 — `install --check`
        // printed its entire report correctly and then died with exit code 127.
        // Upstream is nodejs/node#58091 and #64322: undici keeps the connection
        // alive after the body resolves, and process.exit() races its teardown.
        // The fix has been stalled in review since January 2025, so there is no
        // Node version to wait for. Setting exitCode and returning lets Node
        // drain its own handles. runInstaller is awaited at src/index.ts:127 and
        // its caller returns immediately, so returning here ends the program.
        if (unreadable.length) process.exitCode = 1;
        return;
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
            "",
            `# ${ENGRAM_HOOK_MARKER}`,
            "# Automatically records changed files to Engram memory after each commit.",
            "# Remove with: engram install --remove-hooks",
            "npx -y engram-mcp-server record-commit 2>/dev/null || true",
            "",
        ].join("\n");

        // A post-commit hook is the user's file, and it is frequently NOT ours —
        // husky, lint-staged and deploy triggers all live here. Overwriting it
        // is the same defect class as the installer config clobber (H1): another
        // tool's state destroyed, with no backup and no undo.
        //
        // This mirrors engram_admin(install_hooks) in dispatcher-admin.ts, which
        // already did the right thing. The two paths had drifted; they now agree.
        if (fs.existsSync(hookPath)) {
            const existing = fs.readFileSync(hookPath, "utf-8");
            if (isEngramHook(existing)) {
                console.log(`ℹ️  Engram git hook already installed at ${hookPath} — nothing to do.`);
                process.exit(0);
            }
            fs.appendFileSync(hookPath, hookScript, { encoding: "utf-8" });
            fs.chmodSync(hookPath, 0o755);
            console.log(`✅ Engram appended its hook to your existing post-commit hook at ${hookPath}`);
            console.log("   Your existing hook was preserved and still runs first.");
        } else {
            fs.writeFileSync(hookPath, `#!/bin/bash${hookScript}`, { encoding: "utf-8", mode: 0o755 });
            console.log(`✅ Engram git hook installed at ${hookPath}`);
        }
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
        if (!isEngramHook(content)) {
            console.log("ℹ️  The post-commit hook was not installed by Engram. Not removing it.");
            process.exit(0);
        }
        // Strip only Engram's own block. Deleting the file would take a
        // co-resident hook with it — the mirror image of the install-side bug.
        const cleaned = stripEngramHookBlock(content);
        if (cleaned.replace(/^#!.*$/m, "").trim() === "") {
            fs.unlinkSync(hookPath);
            console.log("✅ Engram git hook removed from .git/hooks/post-commit");
        } else {
            fs.writeFileSync(hookPath, cleaned.endsWith("\n") ? cleaned : cleaned + "\n", { encoding: "utf-8" });
            fs.chmodSync(hookPath, 0o755);
            console.log("✅ Engram's block removed from .git/hooks/post-commit — your other hook logic was kept.");
        }
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

        // BOTH scopes. Removal used to search only the global paths, while the
        // interactive installer recommends and DEFAULTS TO local — so uninstall
        // silently failed for the recommended install location and then printed
        // "not found" about a place it had not looked. Task #99.
        const searched = [
            ...resolveIdeGlobalPaths(ide),
            ...resolveIdeLocalPaths(ide, process.cwd()),
        ];

        for (const configPath of searched) {
            if (!fs.existsSync(configPath)) continue;
            try {
                if (removeFromConfig(configPath, ide)) {
                    console.log(`✅ Removed Engram from ${configPath}`);
                    // The ledger recorded this install; leaving the row behind
                    // would make --check report an install that is gone, which
                    // is the stale-register failure this project has already
                    // paid for twice. pruneLedger() would eventually hide it,
                    // but retracting at the moment of removal is the difference
                    // between a record and a guess.
                    forgetInstall(configPath);
                    removed = true;
                }
            } catch (e) {
                // One unreadable config must not abort removal from the others —
                // the same per-path isolation the install side already has.
                const why = e instanceof ConfigParseError ? "not valid JSON" : (e as Error).message;
                console.error(`⚠️  Could not read ${configPath} (${why}) — left untouched.`);
            }
        }

        if (!removed) {
            // Name what was searched. "Not found" without the search path is the
            // claim that caused this bug to go unnoticed: it reads as absence
            // when it was only absence-of-looking.
            console.log(`ℹ️  Engram was not found in any ${ide.name} config. Searched:`);
            for (const p of searched) {
                console.log(`     ${fs.existsSync(p) ? "·" : "×"} ${p}`);
            }
            if (searched.length === 0) {
                console.log(`     (this IDE declares no config paths)`);
            }
            console.log(`   × = file does not exist. Local paths are relative to ${process.cwd()}`);
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
        const ok = await performInstallationForIde(targetIde, IDE_CONFIGS[targetIde], opts);
        if (!ok) process.exit(1);
        return;
    }

    // ─── Auto-detect + interactive menu ──────────────────────────────
    const { bold, dim, green, yellow, cyan, gray } = makeColors();
    const currentVersion = getInstallerVersion();
    const hr = "─".repeat(60);

    let currentIde = detectCurrentIde();

    // TASK #108: a terminal opened inside Cline's or Roo Code's panel is
    // indistinguishable from VS Code's own integrated terminal by any signal
    // this file has — both are the same host process. Auto-detect used to
    // assume "vscode" and write there silently. If either extension is even
    // installed on this machine, that assumption has a real chance of being
    // wrong, so ask instead of guessing.
    if (currentIde === "vscode") {
        // Two independent reasons "vscode" might be wrong, resolved by one
        // prompt. (1) Cline/Roo Code panels are the same host process, so no
        // signal distinguishes them — task #108. (2) A VS Code FORK whose
        // terminal sets VSCODE_IPC_HOOK but not VSCODE_CWD leaves only PATH,
        // which says what is installed rather than what is running — the
        // Antigravity false positive PROVEN in ide-detector.ts. Both are
        // "we genuinely cannot tell", and both get asked rather than guessed.
        const ambiguousWith = [...detectVscodeForkAmbiguity(), ...detectVscodeExtensionAmbiguity()];
        if (ambiguousWith.length > 0) {
            const names = ambiguousWith.map(id => IDE_CONFIGS[id].name);
            if (nonInteractive) {
                console.error(
                    `⚠️  Detected VS Code's terminal, but ${names.join(" and ")} ${names.length > 1 ? "are" : "is"} ` +
                    `also installed here and its terminal looks identical from this process. Defaulting to VS Code — ` +
                    `if this run is actually inside ${names[0]}, use --ide ${ambiguousWith[0]} instead.`
                );
            } else {
                const picked = await select("This looks like VS Code — but a fork or an extension panel looks the same from here. Which one is this?", [
                    { label: "VS Code (Copilot)", value: "vscode", recommended: true },
                    ...ambiguousWith.map(id => ({ label: IDE_CONFIGS[id].name, value: id })),
                ]);
                if (!picked.cancelled) currentIde = picked.value;
            }
        }
    }

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
            const ver = status.installedVersion === "?"
                ? gray(formatVersion(status.installedVersion))
                : cyan(formatVersion(status.installedVersion));
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
            let ok = await performInstallationForIde(currentIde, ide, { ...opts, nonInteractive: true });
            for (const id of otherDetected) {
                if (!await performInstallationForIde(id, IDE_CONFIGS[id], { ...opts, nonInteractive: true })) ok = false;
            }
            // exitCode, not exit(): everything from here to the end of this
            // block runs AFTER the fetchNpmLatest() above, and process.exit()
            // after a fetch is the libuv assertion documented in the --check
            // branch. Same hazard, same fix, and it is a hazard of the
            // NEIGHBOURHOOD rather than of this line.
            if (!ok) process.exitCode = 1;
            return;
        }

        // ── Build menu options ───────────────────────────────────────────
        // `boolean | void`: an action that installs reports whether it worked, so an
        // interactive run gets the same exit code an equivalent --yes run would.
        // Actions that only print (Cancel) return void and never fail the run.
        const menuOptions: Array<{ label: string; action: () => Promise<boolean | void> }> = [];

        if (status.state === "installed") {
            const ref = npmLatest ?? currentVersion;
            const isOld = status.installedVersion === "?" || semverCmp(status.installedVersion!, ref) < 0;
            if (isOld) {
                menuOptions.push({
                    label: `Update Engram to v${currentVersion} in ${ide.name}`,
                    action: () => performInstallationForIde(currentIde!, ide, { ...opts, nonInteractive: false }),
                });
            } else {
                menuOptions.push({
                    label: `Reinstall / repair Engram in ${ide.name}`,
                    action: () => performInstallationForIde(currentIde!, ide, { ...opts, nonInteractive: false }),
                });
            }
        } else {
            menuOptions.push({
                label: `Install Engram in ${ide.name}`,
                action: () => performInstallationForIde(currentIde!, ide, { ...opts, nonInteractive: false }),
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
                const root = detectProjectRoot(process.cwd()).root;
                return await installToPath(configFilePath, customIde, universalMode, undefined, root, { isolated, scope: "local", ideKey: "custom", projectRoot: root });
            },
        });

        // ── What else is on this machine ─────────────────────────────────
        //
        // From discovery.ts, not resolveIdeInstallStatus. The old menu asked for
        // ONE status per IDE and got the first path that matched, so a machine
        // with four Android Studio channels was told about one of them and the
        // other three were invisible from the installer that had written them.
        //
        // The candidate list is the UNION of "IDE detected on this machine" and
        // "IDE that has an Engram entry somewhere", because those differ in both
        // directions: a detected IDE may have no install, and an install may sit
        // in a config whose IDE no longer reports itself as present.
        const machine = discoverEverywhere(cwd, walkUp);
        const byIde = groupByIde(machine.installs);
        const reference = npmLatest ?? currentVersion;
        const outdated = (e: DiscoveredInstall) => e.version === "?" || semverCmp(e.version, reference) < 0;

        const otherKeys = [...new Set([...otherDetected, ...byIde.keys()])]
            .filter(id => id !== currentIde && IDE_CONFIGS[id])
            .sort((a, b) => IDE_CONFIGS[a].name.localeCompare(IDE_CONFIGS[b].name));

        /** One line per IDE: how many installs, how many stale, and where. */
        const summarise = (id: string): string => {
            const list = byIde.get(id) ?? [];
            if (!list.length) return "not installed";
            const stale = list.filter(outdated).length;
            const state = stale === 0 ? "up to date"
                : stale === list.length ? "update available"
                : `${stale} of ${list.length} outdated`;
            if (list.length === 1) {
                const e = list[0];
                return `${e.scope} · ${formatVersion(e.version)} · ${state} · ${abbreviatePath(e.configPath, e.scope === "local" ? cwd : undefined)}`;
            }
            const scopes = [...new Set(list.map(e => e.scope))].join("+");
            return `${list.length} installs (${scopes}) · ${state}`;
        };

        if (otherKeys.length > 0) {
            menuOptions.push({
                label: `Install or update other IDEs on this system (${otherKeys.length} found)...`,
                action: async () => {
                    const picked = await multiselect("Space to toggle, a for all, Enter to confirm", otherKeys.map(id => ({
                        label: IDE_CONFIGS[id].name,
                        hint: summarise(id),
                        value: id,
                    })));
                    if (picked.cancelled) { console.log("  Cancelled."); return; }
                    if (!picked.values.length) { console.log("  Nothing selected."); return; }
                    let allOk = true;
                    for (const id of picked.values) {
                        if (!await performInstallationForIde(id, IDE_CONFIGS[id], { ...opts, nonInteractive: false })) allOk = false;
                    }
                    return allOk;
                },
            });
        }

        // ── Details ──────────────────────────────────────────────────────
        //
        // The status panel above answers "what about the IDE I am sitting in".
        // Everything else the installer knows — every instance, its scope, its
        // version, its mode, its config file and the database it will open — was
        // discovered and then thrown away. Printing it costs one menu entry and
        // is the difference between a user who can reason about four Android
        // Studio channels and one who cannot tell them apart.
        if (machine.installs.length || machine.problems.length) {
            menuOptions.push({
                label: `Show full details of all ${machine.installs.length} install(s) on this machine`,
                action: async () => {
                    console.log(`\n  ${gray(hr)}`);
                    console.log(`  ${bold("ALL ENGRAM INSTALLS")}  ${dim(`reference v${reference}`)}`);
                    console.log(`  ${gray(hr)}`);
                    for (const [id, list] of [...byIde.entries()].sort((a, b) =>
                        IDE_CONFIGS[a[0]].name.localeCompare(IDE_CONFIGS[b[0]].name))) {
                        console.log(`\n  ${bold(IDE_CONFIGS[id].name)}  ${dim(`— ${list.length} install(s), --ide ${id}`)}`);
                        for (const e of list) {
                            const stale = outdated(e);
                            const icon = stale ? yellow("⬆ ") : green("✅");
                            const mode = e.mode === "universal" ? "universal" : e.mode === "classic" ? "4-tool" : "mode unknown";
                            console.log(`    ${icon} ${bold(e.scope.padEnd(6))} ${cyan(formatVersion(e.version).padEnd(22))} ${dim(mode)}`);
                            console.log(`         ${gray("config  " + e.configPath)}`);
                            if (e.projectRoot) console.log(`         ${gray("project " + e.projectRoot)}`);
                            console.log(`         ${gray("memory  " + (e.dbPath ?? "resolved at runtime from the IDE's working directory"))}`);
                        }
                    }
                    for (const p of machine.problems) {
                        console.log(`\n  ${yellow("⚠")}  ${bold(p.ideName)} — ${p.reason}`);
                        console.log(`         ${gray(p.configPath)}`);
                    }
                    console.log(`\n  ${dim("Update every outdated install without a prompt:")}`);
                    console.log(`  ${gray("npx -y engram-mcp-server@latest install --check --update")}\n`);
                },
            });
        }

        menuOptions.push({
            label: "Cancel",
            action: async () => { console.log("  Installation cancelled."); },
        });

        // ── Menu ─────────────────────────────────────────────────────────
        // The first option is the recommended one — install or update the IDE
        // the user is actually sitting in — so Enter does the obvious thing, as
        // it did when this was a numbered prompt.
        const chosen = await select("What would you like to do?", menuOptions.map((opt, i) => ({
            label: opt.label,
            value: i,
            recommended: i === 0,
        })));
        if (chosen.cancelled) {
            console.log("  Cancelled.");
            return;
        }
        if (await menuOptions[chosen.value].action() === false) process.exitCode = 1;
        return;
    }

    // ── No IDE detected from environment ─────────────────────────────
    if (nonInteractive) {
        if (allDetected.length > 0) {
            console.log(`\n🧠 Engram MCP Installer v${currentVersion}\n`);
            console.log(`🔍 Found ${allDetected.length} installed IDE(s): ${allDetected.map(id => IDE_CONFIGS[id].name).join(", ")}`);
            let ok = true;
            for (const id of allDetected) {
                if (!await performInstallationForIde(id, IDE_CONFIGS[id], { ...opts, nonInteractive: true })) ok = false;
            }
            if (!ok) process.exit(1);
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

    // Detected-but-not-installed IDEs are listed first. When the environment
    // gave no signal, "this IDE exists on your machine" is the only evidence
    // available, and burying it under alphabetical order wastes it.
    const ideKeys = Object.keys(IDE_CONFIGS);
    const statuses = new Map(ideKeys.map(k => [k, resolveIdeInstallStatus(IDE_CONFIGS[k], walkUp)]));
    // Instance counts come from discovery, which finds ALL of them; the
    // per-IDE state still comes from resolveIdeInstallStatus because this list
    // must also describe IDEs that have no install at all, which discovery by
    // definition does not return.
    const fallThroughByIde = groupByIde(discoverEverywhere(process.cwd(), walkUp).installs);
    const rank = (k: string) => {
        const s = statuses.get(k)!.state;
        return s === "installed" ? 0 : s === "not-installed" ? 1 : 2;
    };
    ideKeys.sort((a, b) => rank(a) - rank(b) || IDE_CONFIGS[a].name.localeCompare(IDE_CONFIGS[b].name));

    const picked = await select("Select an IDE to install Engram for", [
        ...ideKeys.map(key => {
            const st = statuses.get(key)!;
            const found = fallThroughByIde.get(key) ?? [];
            const where = found.length > 1
                ? `${found.length} installs (${[...new Set(found.map(e => e.scope))].join("+")})`
                : found.length === 1
                    ? `${found[0].scope} · ${abbreviatePath(found[0].configPath, process.cwd())}`
                    : abbreviatePath(st.configPath, process.cwd());
            return {
                label: IDE_CONFIGS[key].name,
                hint: st.state === "installed" ? `installed ${formatVersion(st.installedVersion)} · ${where}`
                    : st.state === "not-installed" ? `config found, Engram not in it · ${where}`
                    : st.state === "invalid-json" ? `config is not valid JSON · ${where}`
                    : undefined,
                value: key as string,
            };
        }),
        { label: "A custom config directory…", value: "__custom__" as string },
    ]);

    if (picked.cancelled) {
        console.log("  Installation cancelled.");
        process.exit(0);
    }

    if (picked.value === "__custom__") {
        const customPath = await ask("  Enter the path to the directory containing (or to create) the MCP config file:\n  > ");
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
        // A custom path is the one install a config scan can NEVER rediscover,
        // so the ledger matters more here than anywhere else. The project root
        // is resolved from the cwd rather than the config location: the two are
        // unrelated for a custom directory, and the database follows the project.
        const root = detectProjectRoot(process.cwd()).root;
        if (!await installToPath(configFilePath, customIde, universalMode, undefined, root, { isolated, scope: "local", ideKey: "custom", projectRoot: root })) process.exit(1);
    } else {
        if (!await performInstallationForIde(picked.value, IDE_CONFIGS[picked.value], { ...opts, nonInteractive: false })) process.exit(1);
    }
}

// ─── Per-IDE Installation ────────────────────────────────────────────

/**
 * Install for one IDE. Returns false if any write it attempted failed.
 *
 * "Any", not "all": the case that actually bites is the multi-IDE sweep where
 * one config is unwritable and the other four succeed. Reporting success there
 * is how an IDE goes quietly missing. Rejected the alternative of failing only
 * when EVERY write failed — it is friendlier and it hides exactly that.
 *
 * A user cancelling a prompt is not a failure and returns true.
 */
async function performInstallationForIde(id: string, ide: IdeDefinition, opts: InstallOptions): Promise<boolean> {
    const { nonInteractive, universal, forceGlobal, forceLocal, isolated } = opts;
    const { bold, dim, gray, yellow } = makeColors();
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

    if (forceLocal && supportsLocal) {
        // --local, the counterpart --global never had. Without it a scripted
        // caller could ask for global explicitly but could not ask for local at
        // all, even though local is what the interactive prompt recommends.
        targetScope = "local";
    } else if (forceGlobal && supportsGlobal) {
        // User explicitly requested global via --global flag
        targetScope = "global";
    } else if (supportsLocal && supportsGlobal && !nonInteractive) {
        console.log(`\n  ${dim("Scope decides where the MCP ENTRY is registered — not where memory is")}`);
        console.log(`  ${dim("stored. Memory is per-project either way: <project>/.engram/memory.db.")}`);
        const picked = await select(`Where should the ${ide.name} entry go?`, [
            {
                label: "This project only",
                hint: `writes ${resolveIdeLocalInstallPath(ide, detectProjectRoot(process.cwd()).root)}`,
                value: "local" as const,
                recommended: true,
            },
            {
                label: "All projects (user-level IDE config)",
                hint: `writes ${(ide.scopes.global ?? [])[0] ?? "the user-level config"}`,
                value: "global" as const,
            },
        ]);
        if (picked.cancelled) {
            console.log("  Cancelled — nothing was written.");
            return true;
        }
        targetScope = picked.value;
    }

    // The two entry paths disagree about the default and always have: the
    // interactive prompt labels local "(recommended)" and takes it on a blank
    // answer, while --yes skips the prompt entirely and lands on global. Both
    // defaults are defensible; the defect is that the non-interactive one was
    // SILENT, so `engram install --ide cursor --yes` run inside a project wrote
    // to the user's home directory without ever saying so. PROVEN in a sandboxed
    // HOME. Changing the default would break every existing script, so the fix
    // is disclosure plus the --local flag above, not a new default.
    if (nonInteractive && supportsGlobal && supportsLocal) {
        const why = forceLocal ? "--local" : forceGlobal ? "--global" : "default for non-interactive installs";
        console.log(`\n   Scope  : ${targetScope}  (${why}${!forceLocal && !forceGlobal ? "; interactive mode would default to local" : ""})`);
    }

    let ok = true;

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
                // Asked to install and installed nowhere. Not a crash, but not
                // a success either, and a sweep must not report it as one.
                ok = false;
            } else if (!nonInteractive && !await confirmGlobalWrite(ide, allPaths)) {
                console.log("  Aborted — nothing was written.");
                return true;
            } else {
                for (const configPath of allPaths) {
                    if (!await installToPath(configPath, ide, universal, globalIdeKey, undefined, { isolated, scope: "global", ideKey: id })) ok = false;
                }
            }
        } else {
            // ALWAYS slot 0, never "the first path that happens to exist".
            // scopes.global carries legacy search paths for --check/--remove (see
            // antigravity), and find(exists) would re-write a legacy entry that the
            // IDE does not read. PROVEN safe for the other 13: no IDE declares more
            // than one CANONICAL global path, so this is what find() already returned.
            const configPath = ide.scopes.global![0];
            if (!nonInteractive && !await confirmGlobalWrite(ide, [configPath])) {
                console.log("  Aborted — nothing was written.");
                return true;
            }
            if (!await installToPath(configPath, ide, universal, globalIdeKey, undefined, { isolated, scope: "global", ideKey: id })) ok = false;
        }
    } else if (targetScope === "local") {
        const cwd = process.cwd();
        if (nonInteractive) {
            // cwd, NOT the detected project root. A script that cd'd somewhere
            // chose that directory deliberately, and silently relocating its
            // write to a parent is the same class of surprise as the global
            // default this file already discloses (decision #42). The root is
            // still passed down so the entry gets an absolute --project-root
            // rather than leaving the server to infer one.
            const configPath = resolveIdeLocalInstallPath(ide, cwd)!;
            if (!await installToPath(configPath, ide, universal, undefined, cwd, { isolated, scope: "local", ideKey: id, projectRoot: cwd })) ok = false;
        } else {
            // ── THE PLAN, SHOWN BEFORE ANYTHING IS WRITTEN ──────────────────
            //
            // What used to be here asked "Is this correct? [Y/n]" under two
            // printed lines, and only when a project root was detected with
            // high confidence. When it was not, it asked for a path and wrote
            // wherever the answer pointed with no confirmation at all — the
            // less certain the installer was, the less it checked.
            //
            // Now every local install renders the same plan and the same three
            // choices, confidence only changes which option is recommended, and
            // "change the directory" re-renders rather than committing. Nothing
            // is written until the user picks Install.
            let root = detectProjectRootForDisplay(cwd).root;
            let evidence = detectProjectRootForDisplay(cwd).evidence;
            let confidence = detectProjectRootForDisplay(cwd).confidence;
            let isolate = isolated;

            for (;;) {
                const configPath = resolveIdeLocalInstallPath(ide, root)!;
                const exists = fs.existsSync(configPath);

                console.log(`\n  ${gray("─".repeat(66))}`);
                console.log(`  ${bold("Install plan")}  ${dim("— nothing has been written yet")}`);
                console.log(`  ${gray("─".repeat(66))}`);
                console.log(`  IDE      : ${ide.name}`);
                console.log(`  Mode     : ${universal ? "universal (single tool, ~80 token schema)" : "classic (4 dispatcher tools, ~1,600 tokens)"}`);
                console.log(`  Scope    : project-local`);
                console.log(`  Project  : ${root}  ${dim("(" + evidence + ")")}`);
                console.log(`  Config   : ${configPath}  ${dim(exists ? "(exists — Engram's entry will be merged in)" : "(will be created)")}`);
                console.log(`  Memory   : ${resolveDbPath(root)}  ${dim(fs.existsSync(resolveDbPath(root)) ? "(exists — kept)" : "(created on first session)")}`);
                console.log(`  Findable : ${isolate ? "no — not recorded in the machine-wide ledger" : "yes — recorded in " + ledgerPath()}`);
                if (confidence !== "high") {
                    console.log(`\n  ${yellow("⚠")}  No project marker (.git, package.json, …) was found here, so this`);
                    console.log(`     is a guess. Check the Project line before continuing.`);
                }
                console.log(`  ${gray("─".repeat(66))}`);

                const choice = await select("Proceed?", [
                    { label: "Install", value: "go" as const, recommended: confidence === "high" },
                    { label: "Change the project directory", value: "dir" as const, recommended: confidence !== "high" },
                    {
                        label: isolate ? "Make it findable (record in the ledger)" : "Isolate it (do not record in the ledger)",
                        hint: isolate ? "appears in engram install --check" : "you will have to remember this path yourself",
                        value: "iso" as const,
                    },
                    { label: "Abort", value: "no" as const },
                ]);

                if (choice.cancelled || choice.value === "no") {
                    console.log("  Aborted — nothing was written.");
                    // A user who aborts got what they asked for. Not a failure,
                    // so the exit code stays 0.
                    return true;
                }
                if (choice.value === "iso") { isolate = !isolate; continue; }
                if (choice.value === "dir") {
                    const typed = (await ask(`\n  Project directory [${root}]: `)).trim();
                    if (typed) {
                        const resolved = path.resolve(typed);
                        if (!fs.existsSync(resolved)) {
                            // Offer rather than assume. A typo and a
                            // not-yet-created directory look identical here, and
                            // creating one silently is how an install lands in
                            // a directory named after a misspelling.
                            if (!await confirm(`  ${resolved} does not exist. Create it?`, false)) continue;
                            try { fs.mkdirSync(resolved, { recursive: true }); }
                            catch (e: any) { console.log(`  ${yellow("Could not create it:")} ${e.message}`); continue; }
                        }
                        root = resolved;
                        const re = detectProjectRootForDisplay(resolved);
                        // Trust what the user typed as the root, but keep the
                        // detector's opinion visible: if they pointed at a
                        // subdirectory of a repo, saying so is more useful than
                        // silently relocating the install.
                        evidence = re.root === resolved ? re.evidence : `chosen by you — detector would have said ${re.root}`;
                        confidence = re.root === resolved ? re.confidence : "medium";
                    }
                    continue;
                }

                if (!await installToPath(configPath, ide, universal, undefined, root, { isolated: isolate, scope: "local", ideKey: id, projectRoot: root })) ok = false;
                break;
            }
        }
    } else if (!supportsGlobal && !supportsLocal) {
        console.log(`\n⚠️  ${ide.name} — No auto-install paths configured.`);
        ok = false;
    }

    return ok;
}

/**
 * TASK #110. Local installs render a full plan and require "Install" before
 * anything is written (decision #44). A global install skipped straight to
 * writing and only reported the path AFTER the fact, in installToPath's
 * success message — the exact asymmetry task #110 named: "the install plan
 * added in c2712fc now does for local scope and does NOT yet do for global."
 * This is the global equivalent, deliberately smaller than the local one:
 * a global path is fixed by the IDE, not something the user picks a
 * directory for, so there is nothing to change here — just something to see
 * before it happens.
 */
async function confirmGlobalWrite(ide: IdeDefinition, paths: string[]): Promise<boolean> {
    const { bold, dim, gray } = makeColors();
    console.log(`\n  ${gray("─".repeat(66))}`);
    console.log(`  ${bold("Install plan")}  ${dim("— nothing has been written yet")}`);
    console.log(`  ${gray("─".repeat(66))}`);
    console.log(`  IDE      : ${ide.name}`);
    console.log(`  Scope    : all projects (user-level config)`);
    for (const p of paths) {
        console.log(`  Config   : ${p}  ${dim(fs.existsSync(p) ? "(exists — Engram's entry will be merged in)" : "(will be created)")}`);
    }
    console.log(`  ${gray("─".repeat(66))}`);
    return await confirm("  Proceed?", true);
}

/**
 * Write one config. Returns whether the write SUCCEEDED.
 *
 * The return value exists because this function's catch block is the installer's
 * only failure path, and it used to end the story: it printed a warning and
 * returned undefined, so `install --ide vscode --yes` exited 0 having written
 * nothing. PROVEN against a deliberately corrupt config — the refusal is
 * correct and the exit code claimed success anyway. A scripted install could
 * not tell "installed" from "refused to install".
 */
async function installToPath(
    configPath: string,
    ide: IdeDefinition,
    universal = false,
    ideKey?: string,
    projectRoot?: string,
    ledger?: { isolated: boolean; scope: "local" | "global"; ideKey: string; projectRoot?: string },
): Promise<boolean> {
    const { dim, gray } = makeColors();
    try {
        const result = addToConfig(configPath, ide, universal, ideKey, projectRoot);
        const currentVersion = getInstallerVersion();
        console.log(`\n   ✅ ${ide.name}`);
        console.log(`      Config : ${configPath}`);

        // WHERE THE MEMORY GOES. The installer knew this and never said it, so
        // the single most common question after a successful install — "where is
        // my data?" — had no answer in the output that just claimed success.
        //
        // Three distinct cases, and the difference matters:
        //   - a project-local install, or any IDE with a workspace variable:
        //     deterministic, so print the actual file path;
        //   - a global install without a workspace variable: genuinely decided
        //     at runtime, so say that rather than print a path that may be wrong;
        //   - the same case where nothing in the cwd looks like a project: name
        //     the shared global fallback explicitly, because that is the one
        //     outcome a user would not want and would not otherwise discover.
        if (projectRoot) {
            console.log(`      Memory : ${resolveDbPath(projectRoot, ideKey)}`);
        } else if (ide.workspaceVar) {
            console.log(`      Memory : ${dim(`<workspace>/.engram/${ideKey ? `memory-${ideKey}.db` : "memory.db"}`)}`);
            console.log(`               ${gray(`resolved by ${ide.name} from ${ide.workspaceVar} at launch`)}`);
        } else {
            const guess = detectProjectRoot(process.cwd());
            if (guess.confidence === "high") {
                console.log(`      Memory : ${dim(resolveDbPath(guess.root, ideKey))}`);
                console.log(`               ${gray(`per project, detected at launch from the IDE's working directory`)}`);
            } else {
                console.log(`      Memory : ${dim("decided at launch from the IDE's working directory")}`);
                console.log(`               ${gray(`if no project is detected it falls back to ${globalFallbackDbPath()},`)}`);
                console.log(`               ${gray("which every project would then share. Pass project_root on session start to fix it.")}`);
            }
        }

        let statusText = "";
        if (result === "added") {
            statusText = `Engram v${currentVersion} installed successfully`;
        } else if (result === "upgraded") {
            statusText = `Upgraded to v${currentVersion}`;
        } else if (result === "legacy-upgraded") {
            statusText = `Found existing install (version unknown — pre-tracking era). Stamped as v${currentVersion}`;
        } else if (result === "exists") {
            statusText = `Already installed at v${currentVersion} — nothing to do`;
        } else if (result === "repaired") {
            // Same version, different entry. Reported distinctly because the
            // whole point is that the previous behaviour said "nothing to do"
            // here and changed nothing. Observation #127.
            statusText = `Repaired the v${currentVersion} entry (command or args had drifted)`;
        } else if (result === "adopted") {
            statusText = `Updated the existing entry to v${currentVersion} (it was not named "engram" — updated in place rather than adding a second server)`;
        }

        console.log(`      Status : ${statusText}`);

        // ── The machine-wide record ────────────────────────────────────────
        //
        // Without this, the only way to answer "where is Engram installed" was
        // to re-scan the config paths of the 14 known IDEs — which cannot find
        // an install the installer itself offers to make, into a custom
        // directory. --isolated is the opt-out, and it is loud rather than
        // silent: an install nothing can find later is a choice the user has to
        // be able to remember making.
        if (ledger) {
            if (ledger.isolated) {
                console.log(`      Ledger : ${dim("not recorded (--isolated)")}`);
                console.log(`               ${gray("`engram install --check` will NOT find this install. Keep this path:")}`);
                console.log(`               ${configPath}`);
            } else {
                const written = recordInstall({
                    configPath, ideKey: ledger.ideKey, ideName: ide.name,
                    scope: ledger.scope, mode: universal ? "universal" : "classic",
                    version: currentVersion,
                    projectRoot: ledger.projectRoot,
                    dbPath: ledger.projectRoot ? resolveDbPath(ledger.projectRoot, ideKey) : undefined,
                    installedAt: new Date().toISOString(),
                });
                // A ledger failure must not fail the install: the config write
                // already succeeded, and the ledger is an index over facts that
                // live in the config file. Reporting it is still required —
                // "recorded" is a claim, and an unwritten ledger would make
                // --check quietly less complete.
                console.log(`      Ledger : ${written ? gray(ledgerPath()) : dim("could not be written — install is fine, --check will rescan instead")}`);
            }
        }
        return true;
    } catch (e: any) {
        console.log(`\n   ⚠️  ${ide.name}`);
        console.log(`      Could not write to: ${configPath}`);
        console.log(`      Reason: ${e.message}`);
        console.log(`\n      Manual setup: add the engram entry to your IDE's MCP config.`);
        console.log(`      Entry: ${JSON.stringify(makeEngramEntry(ide), null, 2)}`);
        return false;
    }
}
