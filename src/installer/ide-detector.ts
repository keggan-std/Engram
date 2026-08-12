// ============================================================================
// Engram MCP Server — IDE Environment Detection
// ============================================================================

import fs from "fs";
import os from "os";
import path from "path";
import { IDE_CONFIGS } from "./ide-configs.js";

/**
 * Detect the current IDE from environment variables.
 * Returns the IDE key (e.g., "vscode", "cursor") or null if unknown.
 *
 * Detection strategy (in priority order):
 *   1. Explicit env vars set only by a specific IDE (most reliable)
 *   2. process.execPath / argv[0] inspection for VS Code forks
 *   3. PATH / VSCODE_CWD string matching (fallback, fragile)
 *
 * TASK #110 (item 6): CLAUDE_CODE, CLAUDE_CLI, CURSOR_TRACE_ID, WINDSURF_PROFILE
 * and JETBRAINS_IDE appear in no vendor documentation found by a 2026-08-11
 * audit — same status as ANTIGRAVITY_EDITOR_APP_ROOT below, which already
 * carried this caveat. They may be real and empirically observed; nothing on
 * record says which, or by whom. REPORTED, not VERIFIED. An unverifiable
 * signal is not the same defect as a wrong one, and the mitigation for both is
 * the same: the install plan (decision #44, and confirmGlobalWrite in
 * index.ts for the global case) prints the exact path before writing, so a
 * misdetection is something the user catches rather than something that lands
 * silently.
 */
export function detectCurrentIde(): string | null {
    const env = process.env;

    // ─── Claude Code (checked first — sets explicit env vars) ────────
    if (env.CLAUDE_CODE || env.CLAUDE_CLI) return "claudecode";

    // ─── Visual Studio (Developer Command Prompt / PowerShell) ───────
    // VS Developer environments always set VSINSTALLDIR and VisualStudioVersion.
    if (env.VSINSTALLDIR || env.VisualStudioVersion) return "visualstudio";

    // ─── JetBrains detection ─────────────────────────────────────────
    // Android Studio is IntelliJ-based — check it BEFORE generic JetBrains.
    // STUDIO_VM_OPTIONS is set by Android Studio's own JVM launcher and is
    // the only signal here that is actually about which IDE is running.
    //
    // TASK #109 FIX: a second branch used to also fire on
    // TERMINAL_EMULATOR.includes("JetBrains") plus ANDROID_HOME/ANDROID_SDK_ROOT.
    // Those env vars are set machine-wide by anyone doing command-line Android
    // work and say nothing about which JetBrains IDE is running — IntelliJ,
    // WebStorm, PyCharm, GoLand and RubyMine all satisfy it. A Flutter or React
    // Native developer running the installer from IntelliJ's terminal was
    // misdetected as Android Studio and the install was written to
    // %APPDATA%/Google/AndroidStudio*/mcp.json, a product they may not have.
    // Removed rather than tightened: STUDIO_VM_OPTIONS is already the correct,
    // specific signal, and evidence about the machine (an installed SDK) is not
    // evidence about the process using this terminal.
    if (env.STUDIO_VM_OPTIONS) return "androidstudio";

    if (env.JETBRAINS_IDE || env.TERMINAL_EMULATOR?.includes("JetBrains")) return "jetbrains";

    // ─── VS Code family detection ────────────────────────────────────
    // Antigravity and Windsurf are VS Code forks, so their signals only
    // appear inside a VS Code family environment.
    if (env.TERM_PROGRAM === "vscode" || env.VSCODE_IPC_HOOK || env.VSCODE_CWD) {

        // ── Cursor ──────────────────────────────────────────────────
        // Cursor sets CURSOR_TRACE_ID in its integrated terminal sessions.
        // Also check process.execPath for the word "cursor" as a reliable
        // secondary signal (covers cases where env var may not be set).
        if (env.CURSOR_TRACE_ID) return "cursor";
        const execPathLower = (process.execPath || "").toLowerCase();
        if (execPathLower.includes("cursor")) return "cursor";

        // ── Antigravity (Google) ─────────────────────────────────────
        // ANTIGRAVITY_EDITOR_APP_ROOT is the expected env var; unconfirmed
        // until official docs are published — treated as best-effort.
        if (env.ANTIGRAVITY_EDITOR_APP_ROOT) return "antigravity";

        // ── Windsurf ─────────────────────────────────────────────────
        if (env.WINDSURF_PROFILE) return "windsurf";

        // ── Fork disambiguation via the running editor's install dir ──
        // VSCODE_CWD is set by VS Code's terminal integration to the directory
        // the RUNNING editor was launched from, so a fork's name appears in it.
        // It is evidence about THIS PROCESS, which is what we are asking about.
        //
        // When it is present it is AUTHORITATIVE and the search stops here —
        // including when it matches no fork, which means plain VS Code. Falling
        // through to PATH after a VSCODE_CWD that already answered the question
        // is what produced the bug below.
        if (env.VSCODE_CWD) {
            const cwdLower = env.VSCODE_CWD.toLowerCase();
            if (cwdLower.includes("antigravity")) return "antigravity";
            if (cwdLower.includes("cursor")) return "cursor";
            if (cwdLower.includes("windsurf")) return "windsurf";
            return "vscode";
        }

        // ── No VSCODE_CWD: PATH is machine evidence, so do not assert ──
        // PROVEN 2026-08-12 on the maintainer's machine, running the real
        // `engram install --universal` from a VS Code terminal:
        //
        //   Detected IDE  : Antigravity IDE (Gemini)
        //   Config file   : C:\Users\El-Roi\.gemini\antigravity\mcp_config.json
        //
        // while VSCODE_CWD read `...\Programs\Microsoft VS Code`. PATH carried
        // two Antigravity entries — `...\Programs\Antigravity\bin` and
        // `D:\apps data\Antigravity IDE\bin` — because Antigravity is INSTALLED
        // on that machine, not because it was running. The installer was one
        // confirmation away from writing Engram into a product the user was not
        // using, and the panel stated the wrong IDE as fact.
        //
        // This is task #109's defect exactly one file over: evidence about the
        // MACHINE (something on PATH, an Android SDK) is not evidence about the
        // PROCESS using this terminal. #109 was fixed by DELETING the offending
        // branch rather than tightening it, and the same reasoning applies —
        // every fork name that can appear in PATH can appear there without
        // running, and no amount of tightening changes what PATH is evidence of.
        //
        // It is not simply deleted, though, because a fork whose terminal sets
        // VSCODE_IPC_HOOK but not VSCODE_CWD would then be silently misread as
        // VS Code — the task #108 hazard. So the PATH signal is demoted from an
        // assertion to an AMBIGUITY, reported by detectVscodeForkAmbiguity()
        // below and resolved the way #108 resolved its own: by asking.
        return "vscode";
    }

    return null;
}

/**
 * Forks that PATH suggests might be the real caller, when nothing authoritative
 * said so. Returns IDE_CONFIGS keys, or [] when there is nothing to ask about.
 *
 * Only meaningful when detectCurrentIde() returned "vscode". If VSCODE_CWD was
 * set it already answered the question and this returns [] — PATH must never
 * get a second vote against a signal that is actually about this process.
 *
 * See detectCurrentIde() for the PROVEN false positive that demoted PATH from
 * an assertion to a question.
 */
export function detectVscodeForkAmbiguity(): string[] {
    const env = process.env;
    if (env.VSCODE_CWD) return []; // authoritative; nothing to disambiguate
    const pathLower = (env.PATH || "").toLowerCase();
    return ["antigravity", "cursor", "windsurf"].filter(
        id => pathLower.includes(id) && IDE_CONFIGS[id],
    );
}

/**
 * TASK #108. Cline and Roo Code are VS Code extensions, not separate
 * processes — a terminal opened in either extension's panel sets exactly the
 * same TERM_PROGRAM/VSCODE_IPC_HOOK/VSCODE_CWD signals as the host VS Code
 * terminal, so detectCurrentIde() falls through every fork check and returns
 * "vscode". Installing there writes the entry into VS Code's own mcp.json
 * instead of the extension's private settings file — silent and inert,
 * exactly the shape the Antigravity path bug had (fixed in c2712fc).
 *
 * No environment variable distinguishes an extension's integrated terminal
 * from the host's, and inventing one to assert an unverified signal is how
 * this file got four env vars no vendor doc confirms (task #110) — so this
 * does not guess. When detectCurrentIde() lands on "vscode", call this to
 * find out whether Cline and/or Roo Code are even installed on the machine
 * (their extension's globalStorage directory exists, independent of whether
 * an MCP settings file has ever been written inside it). If either is,
 * the caller has a real ambiguity to resolve — by asking, not assuming.
 *
 * Returns IDE_CONFIGS keys, in priority order, or [] when there is nothing
 * to disambiguate and "vscode" can be trusted as-is.
 */
export function detectVscodeExtensionAmbiguity(): string[] {
    const candidates: string[] = [];
    for (const id of ["cline", "roocode"]) {
        const configPath = IDE_CONFIGS[id]?.scopes.global?.[0];
        if (!configPath) continue;
        // configPath is .../globalStorage/<extension-id>/settings/<file>.json.
        // Two dirname() calls reach globalStorage/<extension-id> — the
        // directory VS Code creates once the extension has ever activated,
        // a more reliable "is it installed" signal than the settings FILE
        // itself, which does not exist until something writes an MCP entry.
        const extensionDir = path.dirname(path.dirname(configPath));
        if (fs.existsSync(extensionDir)) candidates.push(id);
    }
    return candidates;
}

/**
 * Resolve the effective list of global config file paths for an IDE.
 * For most IDEs this is just `ide.scopes.global`.
 * For IDEs with `resolveGlobalPaths` (e.g. Android Studio with versioned dirs)
 * that function is called instead, returning all discovered install paths.
 */
export function resolveIdeGlobalPaths(ide: import("./ide-configs.js").IdeDefinition): string[] {
    if (ide.resolveGlobalPaths) return ide.resolveGlobalPaths();
    return ide.scopes.global ?? [];
}

/**
 * The config filename for a project-local install in `dir`.
 *
 * This one-line rule was hand-copied at four call sites in index.ts, and
 * `--remove` was written without a fifth copy — which is exactly why uninstall
 * could not see project-local installs (task #99). It lives here now so there
 * is one rule and one place to change it.
 */
function localFileName(ide: import("./ide-configs.js").IdeDefinition, dir: string): string {
    return ide.scopes.localFile ?? (dir === "" ? ".mcp.json" : "mcp.json");
}

/**
 * EVERY project-local config path this IDE could be installed at, relative to
 * `rootDir`. Use this when SEARCHING — status, listing, removal.
 *
 * Returns paths whether or not they exist; the caller decides what absence
 * means. An empty array means the IDE has no local scope at all, which is a
 * different fact from "nothing was found there".
 */
export function resolveIdeLocalPaths(
    ide: import("./ide-configs.js").IdeDefinition,
    rootDir: string,
): string[] {
    return (ide.scopes.localDirs ?? []).map(dir => path.join(rootDir, dir, localFileName(ide, dir)));
}

/**
 * The single path a local install WRITES to — the first declared localDir.
 * Null when the IDE has no local scope. Searching uses resolveIdeLocalPaths;
 * these are deliberately separate because writing to every candidate would
 * install an IDE several times over.
 */
export function resolveIdeLocalInstallPath(
    ide: import("./ide-configs.js").IdeDefinition,
    rootDir: string,
): string | null {
    const dir = ide.scopes.localDirs?.[0];
    if (dir === undefined) return null;
    return path.join(rootDir, dir, localFileName(ide, dir));
}

/**
 * Scan all IDE_CONFIGS to find which IDEs appear to be installed on this machine.
 *
 * FLAW-9 FIX: The old code treated "parent dir exists" as a detection signal,
 * causing false positives for:
 *   - Visual Studio: ~/.mcp.json parent is HOME — always exists
 *   - Cline: parent is %APPDATA%\Code\... which exists when VS Code is installed
 *
 * New rule: an IDE is detected only when:
 *   (a) Its config file itself exists (previously configured), OR
 *   (b) Its parent dir is at least 2 path segments deeper than a known root
 *       (HOME or APPDATA) AND exists — this filters out shallow paths like
 *       ~/.mcp.json whose parent is just the home directory.
 *
 * An IDE is considered present if any of its global paths passes these checks.
 */
export function detectInstalledIdes(): string[] {
    const HOME = os.homedir();
    const APPDATA = process.env.APPDATA ?? path.join(HOME, "AppData", "Roaming");
    // "shallow" roots — their direct children are not reliable IDE signals
    const shallowRoots = new Set([
        normalisePath(HOME),
        normalisePath(APPDATA),
        normalisePath(path.join(HOME, ".config")),
    ]);

    function isReliableParent(configPath: string): boolean {
        const parent = normalisePath(path.dirname(configPath));
        // If the parent IS a shallow root, the file living directly there
        // (e.g. ~/.mcp.json) is not a reliable "IDE installed" signal
        if (shallowRoots.has(parent)) return false;
        // Otherwise the dir being present is a reasonable signal
        return fs.existsSync(path.dirname(configPath));
    }

    const found: string[] = [];
    for (const [id, ide] of Object.entries(IDE_CONFIGS)) {
        const globalPaths = resolveIdeGlobalPaths(ide);
        if (!globalPaths.length) continue;
        const isPresent = globalPaths.some(
            p => fs.existsSync(p) || isReliableParent(p)
        );
        if (isPresent) found.push(id);
    }
    return found;
}

function normalisePath(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/$/, "");
}
