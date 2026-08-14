// ============================================================================
// Engram MCP Server — IDE Configuration Definitions
// ============================================================================

import fs from "fs";
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
 *
 * Exported as a PURE function of its inputs, not just as the constant below,
 * because the installer test suites spawn the CLI against a fake HOME and then
 * have to predict where it wrote. They used to spell the Windows layout out by
 * hand — `<home>/AppData/Roaming/...` — which passed on Windows and failed on
 * every POSIX runner, because the rule existed in two places and only one of
 * them knew about macOS and Linux. There is one rule now, and it lives here.
 */
export function appDataDir(home: string, appdataEnv?: string): string {
    if (IS_WINDOWS) return appdataEnv ?? path.join(home, "AppData", "Roaming");
    if (IS_MAC) return path.join(home, "Library", "Application Support");
    return path.join(home, ".config"); // Linux / other POSIX
}

const APPDATA: string = appDataDir(HOME, process.env.APPDATA);

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
    /**
     * IDE-native variable injected as env var ENGRAM_PROJECT_ROOT in the MCP
     * config's "env" block.  Only set this when the IDE is confirmed to expand
     * workspace-aware variables in env values (e.g. a hypothetical "${workspace}").
     * Do NOT set for IDEs that only expand real OS env vars ($VAR/${VAR}) — the
     * literal placeholder string would be passed to the server and silently ignored.
     */
    envVar?: string;
    /**
     * Dynamic global path resolver — used for IDEs with versioned config directories
     * (e.g. Android Studio: AndroidStudio2025.3.2\mcp.json).
     * When set, this function is called at install time to enumerate all matching paths
     * on the current machine instead of using a hardcoded `scopes.global` array.
     * Returns an array of absolute config file paths (may be empty if IDE not installed).
     */
    resolveGlobalPaths?: () => string[];
    /**
     * Extra fields to merge into each server entry written by the installer.
     * Used for IDE-specific required fields (e.g. Android Studio requires `enabled: true`).
     */
    extraEntryFields?: Record<string, unknown>;
    scopes: {
        global?: string[];
        localDirs?: string[];
        /**
         * Override the default config filename for local installs.
         * Defaults: "mcp.json" for non-empty localDirPrefix, ".mcp.json" for empty ("").
         * Example: Gemini CLI uses "settings.json" not "mcp.json".
         */
        localFile?: string;
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
            // TASK #110 (item 1): REPORTED, not VERIFIED. No vendor doc states
            // this exact OS-specific path — VS Code's own docs only say "in
            // your user profile folder", reachable via the "MCP: Open User
            // Configuration" command. This is plausible by settings.json
            // convention (same directory VS Code's other user settings live
            // in) and has not been confirmed against a canonical source.
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
        // No workspaceVar — Windsurf does not expose a workspace placeholder in MCP configs.
        // No envVar — Windsurf config interpolation uses ${env:VAR_NAME} syntax for real OS
        // env vars only; there is no workspace-folder variable equivalent.
        // For global installs the project_root_required fallback handles path resolution.
        scopes: {
            // Confirmed: ~/.codeium/windsurf/mcp_config.json on all platforms.
            // Source: https://docs.windsurf.com/windsurf/cascade/mcp
            global: [
                path.join(HOME, ".codeium", "windsurf", "mcp_config.json"),
            ],
        },
    },
    antigravity: {
        name: "Antigravity IDE (Gemini)",
        configKey: "mcpServers",
        requiresType: false,
        requiresCmdWrapper: false,
        // No workspaceVar — Gemini/Antigravity does not expose a workspace placeholder in MCP configs.
        // No envVar — Gemini CLI only expands real OS env vars ($VAR or ${VAR} syntax);
        // setting ${workspaceFolder} would pass the literal string instead of the resolved path.
        //
        // CORRECTED 2026-08-11, and this entry could not install Engram at all before.
        //
        // VERIFIED against https://antigravity.google/docs/mcp, which states:
        // "The configuration file is located globally at ~/.gemini/config/mcp_config.json
        // (or locally in your workspace under .agents/mcp_config.json)."
        //
        // Two errors, and the comment that used to sit here contained a third.
        //  1. The global path was ~/.gemini/antigravity/mcp_config.json — a
        //     directory Antigravity does not read. Recorded here as
        //     "user-verified", which it was: the file existed on one machine.
        //     What was never verified is that the IDE reads it, and it does not.
        //     An install written there was silent, successful and inert.
        //  2. localDirs was deliberately omitted, on the stated reasoning that
        //     "Antigravity is an IDE, not a CLI" and so reads only the global
        //     file. The vendor documents a project-local path in the same
        //     sentence as the global one.
        //  3. That same comment named ~/.gemini/settings.json as the file it
        //     reads, which is Gemini CLI's config and disagrees with the path
        //     the entry itself declared. Three sources of truth in one entry,
        //     none of them the vendor.
        //
        // The old path is kept as a SEARCH path so `--check` and `--remove` can
        // still find and clean up the inert entries earlier versions wrote.
        // Writing always targets scopes.global[0], so a fresh install cannot
        // land there again.
        scopes: {
            global: [
                path.join(HOME, ".gemini", "config", "mcp_config.json"),
                path.join(HOME, ".gemini", "antigravity", "mcp_config.json"), // legacy, search only
            ],
            localDirs: [".agents"],
            localFile: "mcp_config.json",
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
        name: "Cline",
        configKey: "mcpServers",
        requiresType: false,
        requiresCmdWrapper: false,
        scopes: {
            // Global: VS Code extension globalStorage
            //   Windows : %APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json
            //   macOS   : ~/Library/Application Support/Code/User/globalStorage/.../cline_mcp_settings.json
            //   Linux   : ~/.config/Code/User/globalStorage/.../cline_mcp_settings.json
            //
            // TASK #110 (item 4): "confirmed" below overstated what a 2026-08-11
            // audit could establish — this path is corroborated only by
            // third-party docs describing cline/cline's disk.ts
            // GlobalFileNames.mcpSettings; no canonical vendor page was found
            // that states it directly. REPORTED, not VERIFIED.
            // Source: cline/cline disk.ts GlobalFileNames.mcpSettings (third-party corroboration)
            global: [
                path.join(APPDATA, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
            ],
        },
    },
    roocode: {
        name: "Roo Code",
        configKey: "mcpServers",
        requiresType: false,
        requiresCmdWrapper: false,
        scopes: {
            // Global: VS Code extension globalStorage — filename is mcp_settings.json (not cline_mcp_settings.json)
            // Source: RooCodeInc/Roo-Code src/shared/globalFileNames.ts mcpSettings = "mcp_settings.json"
            global: [
                path.join(APPDATA, "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json"),
            ],
            // Project-level: .roo/mcp.json in workspace root
            // Source: RooCodeInc/Roo-Code McpHub.ts#getProjectMcpPath — watches .roo/mcp.json
            localDirs: [".roo"],
        },
    },
    geminicli: {
        name: "Gemini CLI",
        configKey: "mcpServers",
        requiresType: false,
        requiresCmdWrapper: false,
        // No workspaceVar — Gemini CLI only expands real OS env vars ($VAR or ${VAR}),
        // not workspace-folder placeholders.
        scopes: {
            // Global user config: ~/.gemini/settings.json
            // Source: https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md
            global: [path.join(HOME, ".gemini", "settings.json")],
            // Project-level: .gemini/settings.json (uses settings.json, not mcp.json)
            // Source: https://firebase.google.com/docs/studio/mcp-servers
            localDirs: [".gemini"],
            localFile: "settings.json",
        },
    },
    firebasestudio: {
        name: "Firebase Studio (IDX)",
        configKey: "mcpServers",
        requiresType: false,
        requiresCmdWrapper: false,
        scopes: {
            // Cloud-based IDE (formerly Project IDX): project-level config at .idx/mcp.json.
            // Interactive chat uses .idx/mcp.json; Gemini CLI inside Firebase Studio uses .gemini/settings.json.
            // Source: https://firebase.google.com/docs/studio/mcp-servers
            localDirs: [".idx"],
        },
    },
    trae: {
        name: "Trae IDE",
        configKey: "mcpServers",
        requiresType: true,
        requiresCmdWrapper: false,
        // FLAW-4 FIX: Trae officially supports ${workspaceFolder} in args/command fields.
        // Source: https://docs.trae.ai/ide/add-mcp-servers
        workspaceVar: "${workspaceFolder}",
        // TASK #110 (item 3): only the project-level path (.trae/mcp.json) is
        // vendor-documented. A user-level config may also exist alongside it —
        // two fetches of the vendor page truncated before confirming — so no
        // `global` entry is declared here rather than guess one. REPORTED, not
        // VERIFIED: workspaceVar above is the one confirmed claim in this entry.
        scopes: {
            localDirs: [".trae"],
        },
    },
    jetbrains: {
        name: "JetBrains (Copilot Plugin)",
        // Confirmed: uses "servers" key (same as VS Code Copilot).
        // Source: https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/extend-copilot-chat-with-mcp?tool=jetbrains
        configKey: "servers",
        requiresType: false,
        requiresCmdWrapper: false,
        scopes: {
            // ~/.config/github-copilot/intellij/mcp.json on Mac/Linux.
            // On Windows the GitHub Copilot JetBrains plugin uses the same
            // ~/.config path (it does NOT use %APPDATA%).
            // Note: JetBrains docs don't expose the raw file path publicly (always opened via UI),
            // but this path is consistent with how the GitHub Copilot plugin stores data.
            global: [
                path.join(HOME, ".config", "github-copilot", "intellij", "mcp.json"),
            ],
        },
    },

    // ─── Android Studio ─────────────────────────────────────────────
    androidstudio: {
        name: "Android Studio (Gemini)",
        // Confirmed: uses "mcpServers" key (user-verified from actual mcp.json).
        // Despite official docs only mentioning HTTP transport, Android Studio DOES
        // read stdio configs (command/args) from this file — HTTP UI flow is separate.
        // Source: user-verified on Windows — actual mcp.json entries use command/args.
        configKey: "mcpServers",
        requiresType: false,
        requiresCmdWrapper: false,
        // TASK #110 (item 5): the justification this comment used to give —
        // "without it, the server may be ignored by Gemini Agent mode" — was
        // itself unverified and, per a 2026-08-11 audit, wrong: the vendor
        // documents `enabled` as OPTIONAL, defaulting to true, and omits it
        // from its own example entry. Kept anyway because setting it is
        // harmless and matches the actual mcp.json entries this config key was
        // verified against (see the file-level comment above) — just not for
        // the reason originally written here.
        extraEntryFields: { enabled: true },
        // Config path is versioned: %APPDATA%\Google\AndroidStudio<VERSION>\mcp.json
        // Multiple versions can coexist. `resolveGlobalPaths` discovers all of them
        // via directory listing at install time instead of hardcoding a single path.
        resolveGlobalPaths: () => {
            const baseDir = IS_WINDOWS
                ? path.join(APPDATA, "Google")
                : IS_MAC
                    ? path.join(HOME, "Library", "Application Support", "Google")
                    : path.join(HOME, ".config", "Google");
            if (!fs.existsSync(baseDir)) return [];
            try {
                return fs
                    .readdirSync(baseDir, { withFileTypes: true })
                    .filter(d => d.isDirectory() && d.name.startsWith("AndroidStudio"))
                    .map(d => path.join(baseDir, d.name, "mcp.json"));
            } catch {
                return [];
            }
        },
        scopes: {
            // scopes.global is intentionally empty — resolveGlobalPaths() handles discovery.
            // localDirs is also empty — Android Studio reads only its own config dir,
            // not project-level config files.
            global: [],
        },
    },
};

export { IS_WINDOWS };
