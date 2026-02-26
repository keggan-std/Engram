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
 */
export function detectCurrentIde(): string | null {
    const env = process.env;

    // ─── Claude Code (checked first — sets explicit env vars) ────────
    if (env.CLAUDE_CODE || env.CLAUDE_CLI) return "claudecode";

    // ─── Visual Studio (Developer Command Prompt / PowerShell) ───────
    // VS Developer environments always set VSINSTALLDIR and VisualStudioVersion.
    if (env.VSINSTALLDIR || env.VisualStudioVersion) return "visualstudio";

    // ─── JetBrains detection ─────────────────────────────────────────
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

        // ── Fork disambiguation via install path in VSCODE_CWD ───────
        const cwdLower = (env.VSCODE_CWD || "").toLowerCase();
        if (cwdLower.includes("antigravity")) return "antigravity";
        if (cwdLower.includes("cursor")) return "cursor";
        if (cwdLower.includes("windsurf")) return "windsurf";

        // ── Fork disambiguation via PATH ─────────────────────────────
        const pathLower = (env.PATH || "").toLowerCase();
        if (pathLower.includes("antigravity")) return "antigravity";
        if (pathLower.includes("cursor")) return "cursor";
        if (pathLower.includes("windsurf")) return "windsurf";

        return "vscode";
    }

    return null;
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
        if (!ide.scopes.global) continue;
        const isPresent = ide.scopes.global.some(
            p => fs.existsSync(p) || isReliableParent(p)
        );
        if (isPresent) found.push(id);
    }
    return found;
}

function normalisePath(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/$/, "");
}
