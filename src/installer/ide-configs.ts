// ============================================================================
// Engram MCP Server — IDE Configuration Definitions
// ============================================================================

import path from "path";
import os from "os";

const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, ".config");
const IS_WINDOWS = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

export interface IdeDefinition {
    name: string;
    /** The top-level JSON key that holds server entries */
    configKey: "mcpServers" | "servers";
    /** Whether each server entry requires "type": "stdio" */
    requiresType: boolean;
    /** Whether Windows requires cmd /c wrapper for npx */
    requiresCmdWrapper: boolean;
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
        scopes: {
            global: [
                path.join(APPDATA, "Code", "User", "mcp.json"),
                path.join(HOME, ".vscode", "mcp.json"),
            ],
            localDirs: [".vscode"],
        },
    },
    cursor: {
        name: "Cursor",
        configKey: "mcpServers",
        requiresType: false,
        requiresCmdWrapper: false,
        scopes: {
            global: [
                path.join(HOME, ".cursor", "mcp.json"),
                path.join(APPDATA, "Cursor", "mcp.json"),
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
            global: [
                path.join(HOME, ".codeium", "windsurf", "mcp_config.json"),
                path.join(APPDATA, "Windsurf", "mcp.json"),
            ],
        },
    },
    antigravity: {
        name: "Antigravity IDE",
        configKey: "mcpServers",
        requiresType: false,
        requiresCmdWrapper: false,
        scopes: {
            global: [path.join(HOME, ".gemini", "antigravity", "mcp_config.json")],
        },
    },

    // ─── Anthropic ──────────────────────────────────────────────────
    claudecode: {
        name: "Claude Code (CLI)",
        configKey: "mcpServers",
        requiresType: true,
        requiresCmdWrapper: IS_WINDOWS,
        scopes: {
            // User-level: ~/.claude.json contains mcpServers
            global: [path.join(HOME, ".claude.json")],
            // Project-level: .mcp.json in workspace root
            localDirs: [""],
            // CLI alternative
            cli: "claude mcp add-json",
        },
    },
    claudedesktop: {
        name: "Claude Desktop",
        configKey: "mcpServers",
        requiresType: false,
        requiresCmdWrapper: IS_WINDOWS,
        scopes: {
            global: IS_MAC
                ? [path.join(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json")]
                : [path.join(APPDATA, "Claude", "claude_desktop_config.json")],
        },
    },

    // ─── Microsoft ──────────────────────────────────────────────────
    visualstudio: {
        name: "Visual Studio 2022/2026",
        configKey: "mcpServers",
        requiresType: false,
        requiresCmdWrapper: false,
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
            global: [
                path.join(APPDATA, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
                path.join(HOME, ".cline", "mcp_settings.json"),
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
            global: [
                path.join(HOME, ".config", "github-copilot", "intellij", "mcp.json"),
            ],
        },
    },
};

export { IS_WINDOWS };
