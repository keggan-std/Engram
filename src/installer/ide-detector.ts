// ============================================================================
// Engram MCP Server — IDE Environment Detection
// ============================================================================

/**
 * Detect the current IDE from environment variables.
 * Returns the IDE key (e.g., "vscode", "cursor") or null if unknown.
 */
export function detectCurrentIde(): string | null {
    const env = process.env;

    if (env.ANTIGRAVITY_EDITOR_APP_ROOT) return "antigravity";
    if (env.WINDSURF_PROFILE) return "windsurf";

    if (env.TERM_PROGRAM === "vscode" || env.VSCODE_IPC_HOOK || env.VSCODE_CWD) {
        const cwdLower = (env.VSCODE_CWD || "").toLowerCase();
        if (cwdLower.includes("antigravity")) return "antigravity";
        if (cwdLower.includes("cursor")) return "cursor";
        if (cwdLower.includes("windsurf")) return "windsurf";

        const pathLower = (env.PATH || "").toLowerCase();
        if (pathLower.includes("antigravity")) return "antigravity";
        if (pathLower.includes("cursor\\cli")) return "cursor";
        if (pathLower.includes("windsurf")) return "windsurf";

        return "vscode";
    }

    return null;
}
