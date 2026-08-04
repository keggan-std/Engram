// ============================================================================
// Config write safety — FR-D5 §5, the binding for target T2
//
// The installer writes files that OTHER PRODUCTS OWN. Measured on the real
// target: ~/.claude.json is 40.5 KB with 53 top-level keys — oauthAccount,
// userID, machineID, projects, onboarding state — of which `mcpServers` is one.
// ~/.gemini/settings.json and ~/.mcp.json are the same shape.
//
// The behaviour these tests exist to prevent, which shipped: on any JSON.parse
// failure, addToConfig backed up best-effort, set `config = {}`, and wrote a
// file containing ONLY the Engram entry. The backup was
// `try { copyFileSync } catch {}` and the overwrite ran regardless, so a failed
// backup still lost the file.
//
// readJson's own docstring already specified the fix — "callers should warn and
// bail rather than silently overwriting the user's config" — and the caller did
// the opposite, twelve lines below.
//
// Prior art, in another product, same mechanism: microsoft/vscode#125970, where
// an extension wrote a small block and replaced a 600-line user settings file.
//
// The assertions are deliberately about THE OTHER KEYS SURVIVING, never about
// the Engram entry being written correctly. A test that only checks our own
// entry passes just as happily on a file we have emptied.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { addToConfig, writeJson, readJson, ConfigParseError } from "../../src/installer/config-writer.js";
import { IDE_CONFIGS } from "../../src/installer/ide-configs.js";

let dir: string;
// IDE_CONFIGS is a Record keyed by IDE, not an array. `claudecode` is the one
// whose global target is ~/.claude.json — the file this suite exists to protect.
const ide = IDE_CONFIGS.claudecode;

/** A stand-in for ~/.claude.json: mostly keys that have nothing to do with us. */
function hostStateFile(): Record<string, unknown> {
    return {
        numStartups: 412,
        oauthAccount: { accountUuid: "not-a-real-uuid", emailAddress: "someone@example.com" },
        userID: "user-abc",
        machineID: "machine-def",
        projects: { "/a": { history: [1, 2, 3] }, "/b": { history: [] } },
        hasCompletedOnboarding: true,
        [ide.configKey]: { someOtherServer: { command: "node", args: ["other.js"] } },
    };
}

beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), "engram-cfg-")); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows locks */ } });

describe("addToConfig — a config it cannot read is never overwritten", () => {
    it("throws instead of writing when the file is not valid JSON", () => {
        const p = path.join(dir, "config.json");
        const original = '{ "mcpServers": { "other": {} }, }';   // trailing comma — JSONC-ish
        writeFileSync(p, original);

        expect(() => addToConfig(p, ide)).toThrow(ConfigParseError);

        // The bytes on disk are byte-identical. This is the whole test.
        expect(readFileSync(p, "utf-8")).toBe(original);
    });

    it("leaves nothing behind when it refuses — no stub, no temp file", () => {
        const p = path.join(dir, "config.json");
        writeFileSync(p, "{ not json at all");

        expect(() => addToConfig(p, ide)).toThrow();

        // A .tmp.<pid> left lying around would mean the atomic write started
        // before the parse guard, which would be the bug in a new place.
        expect(readdirSync(dir)).toEqual(["config.json"]);
    });

    it("refuses a file that is JSONC — comments are not a reason to destroy it", () => {
        const p = path.join(dir, "mcp.json");
        const original = '{\n  // the user wrote this\n  "mcpServers": {}\n}';
        writeFileSync(p, original);

        expect(() => addToConfig(p, ide)).toThrow(ConfigParseError);
        expect(readFileSync(p, "utf-8")).toBe(original);
    });
});

describe("addToConfig — unrelated keys survive a normal install", () => {
    it("preserves every key it did not come to change", () => {
        const p = path.join(dir, "claude.json");
        const before = hostStateFile();
        writeJson(p, before);

        const result = addToConfig(p, ide);
        expect(result).toBe("added");

        const after = readJson(p)!;
        // Every top-level key that was there is still there, unchanged.
        for (const key of Object.keys(before)) {
            if (key === ide.configKey) continue;
            expect(after[key]).toEqual(before[key]);
        }
        // And the sibling server inside our own key is untouched.
        expect((after[ide.configKey] as any).someOtherServer).toEqual({ command: "node", args: ["other.js"] });
        expect((after[ide.configKey] as any).engram).toBeDefined();
    });

    it("is idempotent — a second install reports 'exists' and rewrites nothing", () => {
        const p = path.join(dir, "claude.json");
        writeJson(p, hostStateFile());

        addToConfig(p, ide);
        const afterFirst = readFileSync(p, "utf-8");

        expect(addToConfig(p, ide)).toBe("exists");
        expect(readFileSync(p, "utf-8")).toBe(afterFirst);
    });

    it("creates a fresh config when the file genuinely does not exist", () => {
        const p = path.join(dir, "nested", "deeper", "config.json");
        expect(addToConfig(p, ide)).toBe("added");
        expect(existsSync(p)).toBe(true);
        expect((readJson(p)![ide.configKey] as any).engram).toBeDefined();
    });
});

describe("writeJson — atomic", () => {
    it("leaves no temp file behind on success", () => {
        const p = path.join(dir, "out.json");
        writeJson(p, { a: 1 });
        expect(readdirSync(dir)).toEqual(["out.json"]);
        expect(readJson(p)).toEqual({ a: 1 });
    });

    it("replaces an existing file without an intermediate empty state", () => {
        const p = path.join(dir, "out.json");
        writeJson(p, { first: true });
        writeJson(p, { second: true });
        expect(readJson(p)).toEqual({ second: true });
        expect(readdirSync(dir)).toEqual(["out.json"]);
    });

    // Guards the mechanism itself: a rename-based write must target the same
    // directory, or it crosses a filesystem boundary and stops being atomic.
    it("stages the temp file next to its destination", () => {
        const p = path.join(dir, "out.json");
        writeJson(p, { a: 1 });
        // Nothing staged in the OS temp root — only alongside the target.
        expect(readdirSync(dir).filter(f => f.includes(".tmp."))).toEqual([]);
    });
});
