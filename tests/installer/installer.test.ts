// ============================================================================
// Installer Tests — Config Writer & IDE Entry Generation
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { makeEngramEntry, addToConfig, removeFromConfig, readJson } from "../../src/installer/config-writer.js";
import { IDE_CONFIGS, type IdeDefinition } from "../../src/installer/ide-configs.js";

// Use a temp directory for test config files
let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "engram-test-"));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── makeEngramEntry ─────────────────────────────────────────────────

describe("makeEngramEntry", () => {
    it("should generate basic entry for mcpServers IDEs (Cursor, Windsurf)", () => {
        const entry = makeEngramEntry(IDE_CONFIGS.cursor);
        expect(entry.command).toBe("npx");
        expect(entry.args).toEqual(["-y", "engram-mcp-server"]);
        expect(entry.type).toBeUndefined();
    });

    it("should include type:stdio for VS Code", () => {
        const entry = makeEngramEntry(IDE_CONFIGS.vscode);
        expect(entry.type).toBe("stdio");
        expect(entry.command).toBe("npx");
    });

    it("should include type:stdio for Claude Code", () => {
        const entry = makeEngramEntry(IDE_CONFIGS.claudecode);
        expect(entry.type).toBe("stdio");
    });

    it("should include type:stdio for Trae IDE", () => {
        const entry = makeEngramEntry(IDE_CONFIGS.trae);
        expect(entry.type).toBe("stdio");
    });

    it("should use cmd /c wrapper when requiresCmdWrapper is true", () => {
        // Simulate a Windows-like IDE def
        const windowsIde: IdeDefinition = {
            name: "Test",
            configKey: "mcpServers",
            requiresType: true,
            requiresCmdWrapper: true,
            scopes: {},
        };
        const entry = makeEngramEntry(windowsIde);
        expect(entry.command).toBe("cmd");
        expect(entry.args).toEqual(["/c", "npx", "-y", "engram-mcp-server"]);
        expect(entry.type).toBe("stdio");
    });
});

// ─── addToConfig ─────────────────────────────────────────────────────

describe("addToConfig", () => {
    it("should create config with mcpServers key for Cursor", () => {
        const configPath = path.join(tmpDir, "cursor-mcp.json");
        const result = addToConfig(configPath, IDE_CONFIGS.cursor);

        expect(result).toBe("added");

        const written = readJson(configPath);
        expect(written).toBeDefined();
        expect(written!.mcpServers).toBeDefined();
        expect(written!.mcpServers.engram).toBeDefined();
        expect(written!.mcpServers.engram.command).toBe("npx");
    });

    it("should create config with servers key for VS Code", () => {
        const configPath = path.join(tmpDir, "vscode-mcp.json");
        const result = addToConfig(configPath, IDE_CONFIGS.vscode);

        expect(result).toBe("added");

        const written = readJson(configPath);
        expect(written!.servers).toBeDefined();
        expect(written!.servers.engram).toBeDefined();
        expect(written!.servers.engram.type).toBe("stdio");
        expect(written!.servers.engram.command).toBe("npx");
        // Must NOT have mcpServers key
        expect(written!.mcpServers).toBeUndefined();
    });

    it("should preserve existing entries when adding", () => {
        const configPath = path.join(tmpDir, "existing.json");
        fs.writeFileSync(configPath, JSON.stringify({
            mcpServers: {
                "other-server": { command: "node", args: ["server.js"] }
            }
        }));

        addToConfig(configPath, IDE_CONFIGS.cursor);

        const written = readJson(configPath);
        expect(written!.mcpServers["other-server"]).toBeDefined();
        expect(written!.mcpServers.engram).toBeDefined();
    });

    it("should return 'exists' when entry is identical", () => {
        const configPath = path.join(tmpDir, "dup.json");
        addToConfig(configPath, IDE_CONFIGS.cursor);
        const result = addToConfig(configPath, IDE_CONFIGS.cursor);
        expect(result).toBe("exists");
    });

    it("should return 'legacy-upgraded' when entry exists without _engram_version stamp", () => {
        const configPath = path.join(tmpDir, "legacy.json");
        // Write an old-style entry with no _engram_version (pre-tracking era)
        fs.writeFileSync(configPath, JSON.stringify({
            mcpServers: {
                engram: { command: "node", args: ["old-path/index.js"] }
            }
        }));

        const result = addToConfig(configPath, IDE_CONFIGS.cursor);
        expect(result).toBe("legacy-upgraded");

        const written = readJson(configPath);
        expect(written!.mcpServers.engram.command).toBe("npx");
    });

    it("should return 'upgraded' when entry exists with an older _engram_version stamp", () => {
        const configPath = path.join(tmpDir, "upgrade.json");
        // Write an entry stamped with a known older version
        fs.writeFileSync(configPath, JSON.stringify({
            mcpServers: {
                engram: { command: "npx", args: ["-y", "engram-mcp-server"], _engram_version: "0.0.1" }
            }
        }));

        const result = addToConfig(configPath, IDE_CONFIGS.cursor);
        expect(result).toBe("upgraded");

        const written = readJson(configPath);
        expect(written!.mcpServers.engram._engram_version).not.toBe("0.0.1");
    });
});

// ─── removeFromConfig ────────────────────────────────────────────────

describe("removeFromConfig", () => {
    it("should remove engram entry", () => {
        const configPath = path.join(tmpDir, "remove.json");
        addToConfig(configPath, IDE_CONFIGS.cursor);

        const removed = removeFromConfig(configPath, IDE_CONFIGS.cursor);
        expect(removed).toBe(true);

        const written = readJson(configPath);
        expect(written!.mcpServers?.engram).toBeUndefined();
    });

    it("should return false if entry doesn't exist", () => {
        const configPath = path.join(tmpDir, "empty.json");
        fs.writeFileSync(configPath, "{}");

        const removed = removeFromConfig(configPath, IDE_CONFIGS.cursor);
        expect(removed).toBe(false);
    });

    it("should return false if file doesn't exist", () => {
        const removed = removeFromConfig(path.join(tmpDir, "nonexistent.json"), IDE_CONFIGS.cursor);
        expect(removed).toBe(false);
    });
});

// ─── IDE Config Correctness ──────────────────────────────────────────

describe("IDE Config Definitions", () => {
    it("VS Code should use 'servers' configKey", () => {
        expect(IDE_CONFIGS.vscode.configKey).toBe("servers");
    });

    it("VS Code should require type:stdio", () => {
        expect(IDE_CONFIGS.vscode.requiresType).toBe(true);
    });

    it("Cursor should use 'mcpServers' configKey", () => {
        expect(IDE_CONFIGS.cursor.configKey).toBe("mcpServers");
    });

    it("Claude Code should require type:stdio", () => {
        expect(IDE_CONFIGS.claudecode.requiresType).toBe(true);
    });

    it("Visual Studio should use 'servers' configKey", () => {
        // Confirmed: VS uses "servers" key, not "mcpServers".
        // Source: https://learn.microsoft.com/en-us/visualstudio/ide/mcp-servers
        expect(IDE_CONFIGS.visualstudio.configKey).toBe("servers");
    });

    it("all IDEs should have a name", () => {
        for (const [id, ide] of Object.entries(IDE_CONFIGS)) {
            expect(ide.name, `${id} should have a name`).toBeTruthy();
        }
    });

    it("all IDEs should have at least one scope", () => {
        for (const [id, ide] of Object.entries(IDE_CONFIGS)) {
            const hasScope = (ide.scopes.global?.length ?? 0) > 0 || (ide.scopes.localDirs?.length ?? 0) > 0;
            expect(hasScope, `${id} should have at least one scope`).toBe(true);
        }
    });
});
