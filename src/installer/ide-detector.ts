// ============================================================================
// Engram MCP Server — IDE Environment Detection
// ============================================================================

/**
 * Detect the current IDE from environment variables.
 * Returns the IDE key (e.g., "vscode", "cursor") or null if unknown.
 */
export function detectCurrentIde(): string | null {
    const env = process.env;

    // ─── Claude Code (checked first — sets explicit env vars) ────────
    if (env.CLAUDE_CODE || env.CLAUDE_CLI) return "claudecode";

    // ─── VS Code family detection ────────────────────────────────────
    // Antigravity and Windsurf are VS Code forks, so their signals are
    // only meaningful inside a VS Code family environment.
    if (env.TERM_PROGRAM === "vscode" || env.VSCODE_IPC_HOOK || env.VSCODE_CWD) {
        // Explicit fork-specific signals (most reliable)
        if (env.ANTIGRAVITY_EDITOR_APP_ROOT) return "antigravity";
        if (env.WINDSURF_PROFILE) return "windsurf";

        // Disambiguate via install path in VSCODE_CWD
        const cwdLower = (env.VSCODE_CWD || "").toLowerCase();
        if (cwdLower.includes("antigravity")) return "antigravity";
        if (cwdLower.includes("cursor")) return "cursor";
        if (cwdLower.includes("windsurf")) return "windsurf";

        // Disambiguate via PATH
        const pathLower = (env.PATH || "").toLowerCase();
        if (pathLower.includes("antigravity")) return "antigravity";
        if (pathLower.includes("cursor")) return "cursor";
        if (pathLower.includes("windsurf")) return "windsurf";

        return "vscode";
    }

    // ─── JetBrains detection ─────────────────────────────────────────
    if (env.JETBRAINS_IDE || env.TERMINAL_EMULATOR?.includes("JetBrains")) return "jetbrains";

    return null;
}
