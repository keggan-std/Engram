// ============================================================================
// Engram MCP Server — IDE Configuration Definitions
// ============================================================================

import path from "path";
import os from "os";

const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, ".config");

export interface IdeDefinition {
    name: string;
    format: "mcpServers" | "servers";
    scopes: {
        global?: string[];
        localDirs?: string[];
    };
}

export const IDE_CONFIGS: Record<string, IdeDefinition> = {
    antigravity: {
        name: "Antigravity IDE",
        format: "mcpServers",
        scopes: {
            global: [path.join(HOME, ".gemini", "antigravity", "mcp_config.json")],
        },
    },
    cursor: {
        name: "Cursor",
        format: "mcpServers",
        scopes: {
            global: [
                path.join(HOME, ".cursor", "mcp.json"),
                path.join(APPDATA, "Cursor", "mcp.json"),
            ],
            localDirs: [".cursor"],
        },
    },
    vscode: {
        name: "VS Code (Copilot)",
        format: "mcpServers",
        scopes: {
            global: [
                path.join(APPDATA, "Code", "User", "mcp.json"),
                path.join(HOME, ".vscode", "mcp.json"),
            ],
            localDirs: ["", ".vscode"],
        },
    },
    cline: {
        name: "Cline / Roo Code",
        format: "mcpServers",
        scopes: {
            global: [
                path.join(APPDATA, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
                path.join(HOME, ".cline", "mcp_settings.json"),
            ],
        },
    },
    windsurf: {
        name: "Windsurf",
        format: "mcpServers",
        scopes: {
            global: [
                path.join(HOME, ".codeium", "windsurf", "mcp_config.json"),
                path.join(APPDATA, "Windsurf", "mcp.json"),
            ],
        },
    },
    visualstudio: {
        name: "Visual Studio 2022/2026",
        format: "mcpServers",
        scopes: {
            global: [path.join(HOME, ".mcp.json")],
            localDirs: ["", ".vs"],
        },
    },
};
