// ============================================================================
// Engram MCP Server — IDE Configuration Definitions
// ============================================================================

import path from "path";
import os from "os";

const HOME = os.homedir();
const IS_WINDOWS = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

/**
 * OS-aware application data directory.
 *
 * - Windows : %APPDATA%  (e.g. C:\Users\User\AppData\Roaming)
 * - macOS   : ~/Library/Application Support
 * - Linux   : ~/.config  (XDG Base Directory spec)
 *
 * The old code used `process.env.APPDATA || path.join(HOME, ".config")` which
 * accidentally gave the correct value on Linux but the WRONG value on macOS
 * (~/.config instead of ~/Library/Application Support).  This broke VS Code,
 * Cline, and any other path that hangs off the AppData root on Mac.
 */
const APPDATA: string = IS_WINDOWS
    ? (process.env.APPDATA ?? path.join(HOME, "AppData", "Roaming"))
    : IS_MAC
        ? path.join(HOME, "Library", "Application Support")
        : path.join(HOME, ".config"); // Linux / other POSIX

export interface IdeDefinition {
    name: string;
    /** The top-level JSON key that holds server entries */
    configKey: "mcpServers" | "servers";
    /** Whether each server entry requires "type": "stdio" */
    requiresType: boolean;
    /** Whether Windows requires cmd /c wrapper for npx */
    requiresCmdWrapper: boolean;
    /**
     * FLAW-4 FIX: IDE-native variable for the current workspace/project root.
     * When set, the installer injects `--project-root=<var>` into the MCP args
     * so the server receives the actual workspace path at spawn time, bypassing
     * all heuristic detection.
     *
     * Examples: "${workspaceFolder}" (VS Code/Cursor), "${SolutionDir}" (VS)
     */
    workspaceVar?: string;
    scopes: {
        global?: string[];
        localDirs?: string[];
        /** CLI command for IDE-native installation (e.g. claude mcp add-json) */
        cli?: string;
    };
}

export const IDE_CONFIGS: Record<string, IdeDefinition> = {
    // ─── VS Code forks ──────────────────────────────────────────────
    vscode: {
        name: "VS Code (Copilot)",
        configKey: "servers",
        requiresType: true,
        requiresCmdWrapper: false,
        // FLAW-4 FIX: VS Code expands ${workspaceFolder} at spawn time — ensures
        // the server always receives the correct project root without heuristics.
        workspaceVar: "${workspaceFolder}",
        scopes: {
            global: [
                path.join(APPDATA, "Code", "User", "mcp.json"),
            ],
            localDirs: [".vscode"],
        },
    },
    cursor: {
        name: "Cursor",
        configKey: "mcpServers",
        requiresType: false,
        requiresCmdWrapper: false,
        // FLAW-4 FIX: Cursor also expands ${workspaceFolder}
        workspaceVar: "${workspaceFolder}",
        scopes: {
            global: [
                path.join(HOME, ".cursor", "mcp.json"),
            ],
            localDirs: [".cursor"],
        },
    },
    windsurf: {
        name: "Windsurf",
        configKey: "mcpServers",
        requiresType: false,
        requiresCmdWrapper: false,
        scopes: {
            // Confirmed: ~/.codeium/windsurf/mcp_config.json on all platforms.
            // Source: https://docs.windsurf.com/windsurf/cascade/mcp
            // Old fallback APPDATA/Windsurf/mcp.json was wrong: wrong dir + wrong filename.
            global: [
                path.join(HOME, ".codeium", "windsurf", "mcp_config.json"),
            ],
        },
    },
    antigravity: {
        name: "Antigravity IDE",
        configKey: "mcpServers",
        requiresType: false,
        requiresCmdWrapper: false,
        scopes: {
            // NOTE: Antigravity (Google) is newly announced; this path is unconfirmed.
            // Marked best-effort until official docs are published.
            global: [path.join(HOME, ".gemini", "antigravity", "mcp_config.json")],
        },
    },

    // ─── Anthropic ──────────────────────────────────────────────────
    claudecode: {
        name: "Claude Code (CLI)",
        // Confirmed: uses "mcpServers" key.
        // Source: https://code.claude.com/docs/en/mcp
        configKey: "mcpServers",
        requiresType: true,
        requiresCmdWrapper: IS_WINDOWS,
        scopes: {
            // User-level: ~/.claude.json  (cross-platform, same path everywhere)
            global: [path.join(HOME, ".claude.json")],
            // Project-level: .mcp.json in workspace root
            localDirs: [""],
            // CLI alternative
            cli: "claude mcp add-json",
        },
    },
    claudedesktop: {
        name: "Claude Desktop",
        // Confirmed: uses "mcpServers" key.
        // Source: https://modelcontextprotocol.io/docs/develop/connect-local-servers
        configKey: "mcpServers",
        requiresType: false,
        requiresCmdWrapper: IS_WINDOWS,
        scopes: {
            // With the corrected APPDATA constant, all three OS paths are now right:
            //   Windows : %APPDATA%\Claude\claude_desktop_config.json
            //   macOS   : ~/Library/Application Support/Claude/claude_desktop_config.json
            //   Linux   : ~/.config/Claude/claude_desktop_config.json
            global: [path.join(APPDATA, "Claude", "claude_desktop_config.json")],
        },
    },

    // ─── Microsoft ──────────────────────────────────────────────────
    visualstudio: {
        name: "Visual Studio 2022/2026",
        configKey: "servers",
        requiresType: false,
        requiresCmdWrapper: false,
        // FLAW-4 FIX: Visual Studio expands ${SolutionDir} at spawn time
        workspaceVar: "${SolutionDir}",
        scopes: {
            global: [path.join(HOME, ".mcp.json")],
            localDirs: ["", ".vs"],
        },
    },

    // ─── Other IDEs ─────────────────────────────────────────────────
    cline: {
        name: "Cline / Roo Code",
        configKey: "mcpServers",
        requiresType: false,
        requiresCmdWrapper: false,
        scopes: {
            // With corrected APPDATA:
            //   Windows : %APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json
            //   macOS   : ~/Library/Application Support/Code/User/globalStorage/.../cline_mcp_settings.json
            //   Linux   : ~/.config/Code/User/globalStorage/.../cline_mcp_settings.json
            global: [
                path.join(APPDATA, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
                // Roo Code uses a different extension ID
                path.join(APPDATA, "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json"),
            ],
        },
    },
    trae: {
        name: "Trae IDE",
        configKey: "mcpServers",
        requiresType: true,
        requiresCmdWrapper: false,
        scopes: {
            localDirs: [".trae"],
        },
    },
    jetbrains: {
        name: "JetBrains (Copilot Plugin)",
        configKey: "mcpServers",
        requiresType: false,
        requiresCmdWrapper: false,
        scopes: {
            // ~/.config/github-copilot/intellij/mcp.json on Mac/Linux.
            // On Windows the GitHub Copilot JetBrains plugin uses the same
            // ~/.config path (it does NOT use %APPDATA%).
            global: [
                path.join(HOME, ".config", "github-copilot", "intellij", "mcp.json"),
            ],
        },
    },
};

export { IS_WINDOWS };
