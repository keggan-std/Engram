// ============================================================================
// Entry identity — observation #127, targets 3 and 4
//
// Two defects, one cause. The installer had TWO different answers to "is Engram
// already in this config":
//
//   status/list/check  — an entry under ANY key whose command or args mention
//                        "engram" (the predicate was hand-copied at three sites)
//   addToConfig        — literally `config[key].engram`, and nothing else
//
// So a config holding a differently-named entry reported "installed" and then
// received a SECOND entry on install: two servers launched against one
// database, which is the write-lock contention the `--ide=` shard flag exists
// to prevent. `--remove` then deleted only the one called "engram".
//
// Separately, addToConfig decided "already installed" from the _engram_version
// stamp alone and compared neither command nor args, so an entry that was
// corrupt but current-versioned made a reinstall a no-op reporting success.
// Reinstalling is the first thing anyone does when a server will not start.
//
// THE ASSERTIONS ARE ABOUT ENTRY COUNT AND CONTENT, never about the return
// string alone. A test that only checked the return value would pass against
// code that returns "repaired" and writes nothing.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
    addToConfig, removeFromConfig, makeEngramEntry, writeJson, readJson, findEngramEntryKey,
} from "../../src/installer/config-writer.js";
import { IDE_CONFIGS } from "../../src/installer/ide-configs.js";

let dir: string;
const ide = IDE_CONFIGS.claudecode;
const KEY = ide.configKey;

beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), "engram-entry-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const cfgPath = (): string => path.join(dir, "config.json");

function seed(serverMap: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
    const p = cfgPath();
    writeJson(p, { userID: "keep-me", [KEY]: serverMap, ...extra });
    return p;
}

function servers(p: string): Record<string, Record<string, unknown>> {
    // The wrapper key is removed entirely once its last entry goes, so this is
    // legitimately absent after a successful uninstall.
    return ((readJson(p) as Record<string, any>)[KEY] ?? {}) as Record<string, Record<string, unknown>>;
}

/** Count entries that would launch Engram, whatever they are called. */
function engramEntries(p: string): string[] {
    const map = servers(p);
    return Object.keys(map).filter(k =>
        String(map[k]?.command ?? "").includes("engram")
        || (Array.isArray(map[k]?.args) && (map[k].args as string[]).some(a => String(a).includes("engram")))
        || k === "engram"
    );
}

// ─── The duplicate-entry defect ──────────────────────────────────────

describe("an existing entry under a different key", () => {
    /** What a user who added Engram by hand, under their own name, ends up with. */
    const handAdded = {
        "engram-memory": { command: "npx", args: ["-y", "engram-mcp-server@latest"] },
    };

    it("is updated in place, not duplicated", () => {
        const p = seed({ ...handAdded });
        const result = addToConfig(p, ide);

        expect(engramEntries(p)).toEqual(["engram-memory"]);
        expect(result).toBe("adopted");
    });

    it("never produces two servers on one database", () => {
        const p = seed({ ...handAdded });
        addToConfig(p, ide);
        addToConfig(p, ide); // idempotent — reinstalling must not add another
        expect(engramEntries(p).length).toBe(1);
    });

    it("keeps the name the user chose", () => {
        const p = seed({ ...handAdded });
        addToConfig(p, ide);
        expect(Object.keys(servers(p))).toContain("engram-memory");
        expect(Object.keys(servers(p))).not.toContain("engram");
    });

    it("is brought up to the current version and args", () => {
        const p = seed({ ...handAdded });
        addToConfig(p, ide);
        const expected = makeEngramEntry(ide);
        const actual = servers(p)["engram-memory"];
        expect(actual._engram_version).toBe(expected._engram_version);
        expect(actual.args).toEqual(expected.args);
        expect(actual.command).toBe(expected.command);
    });

    it("can then be uninstalled", () => {
        // The half that made this dangerous: --remove deleted only "engram", so
        // an adopted entry was unremovable and the user was told it was gone.
        const p = seed({ ...handAdded });
        addToConfig(p, ide);
        expect(removeFromConfig(p, ide)).toBe(true);
        expect(engramEntries(p)).toEqual([]);
    });

    it("leaves unrelated servers and unrelated top-level keys alone", () => {
        const p = seed(
            { ...handAdded, someOtherServer: { command: "node", args: ["other.js"] } },
            { projects: { "/a": 1 } },
        );
        addToConfig(p, ide);
        expect(servers(p).someOtherServer).toEqual({ command: "node", args: ["other.js"] });
        expect((readJson(p) as Record<string, unknown>).userID).toBe("keep-me");
        expect((readJson(p) as Record<string, unknown>).projects).toEqual({ "/a": 1 });
    });

    it("prefers the canonical key when both exist", () => {
        const p = seed({
            ...handAdded,
            engram: { command: "npx", args: ["-y", "engram-mcp-server"], _engram_version: "0.0.1" },
        });
        addToConfig(p, ide);
        expect(servers(p).engram._engram_version).toBe(makeEngramEntry(ide)._engram_version);
        // The stranger is left untouched rather than silently deleted — removing
        // an entry the user wrote is not the installer's call to make.
        expect(servers(p)["engram-memory"]).toBeDefined();
    });
});

// ─── The unrepairable-entry defect ───────────────────────────────────

describe("an entry at the current version", () => {
    const current = (): Record<string, unknown> => makeEngramEntry(ide);

    it("is left alone when it is genuinely identical", () => {
        const p = seed({ engram: current() });
        expect(addToConfig(p, ide)).toBe("exists");
    });

    it("is repaired when the command has drifted", () => {
        const broken = { ...current(), command: "nvpx" };
        const p = seed({ engram: broken });

        expect(addToConfig(p, ide)).toBe("repaired");
        expect(servers(p).engram.command).toBe(current().command);
    });

    it("is repaired when the args have drifted", () => {
        const broken = { ...current(), args: ["-y", "engram-mcp-server", "--mode=nonsense"] };
        const p = seed({ engram: broken });

        expect(addToConfig(p, ide)).toBe("repaired");
        expect(servers(p).engram.args).toEqual(current().args);
    });

    it("is repaired when a field was dropped entirely", () => {
        const broken = { ...current() };
        delete broken.args;
        const p = seed({ engram: broken });

        expect(addToConfig(p, ide)).toBe("repaired");
        expect(servers(p).engram.args).toEqual(current().args);
    });

    it("keeps fields the user added by hand", () => {
        const p = seed({ engram: { ...current(), command: "wrong", myOwnField: "keep" } });
        addToConfig(p, ide);
        expect(servers(p).engram.myOwnField).toBe("keep");
        expect(servers(p).engram.command).toBe(current().command);
    });

    it("KILL SWITCH — a clean reinstall still reports no work and writes nothing", () => {
        const p = seed({ engram: current() });
        const before = JSON.stringify(readJson(p));
        expect(addToConfig(p, ide)).toBe("exists");
        expect(JSON.stringify(readJson(p))).toBe(before);
    });
});

// ─── Derived: one definition of "is Engram here" ─────────────────────

describe("the predicate has one home", () => {
    it("finds an entry by key, by command and by args", () => {
        expect(findEngramEntryKey({ engram: {} })).toBe("engram");
        expect(findEngramEntryKey({ mine: { command: "engram-mcp-server" } })).toBe("mine");
        expect(findEngramEntryKey({ mine: { command: "npx", args: ["-y", "engram-mcp-server"] } })).toBe("mine");
        expect(findEngramEntryKey({ other: { command: "node", args: ["x.js"] } })).toBeUndefined();
        expect(findEngramEntryKey({})).toBeUndefined();
        expect(findEngramEntryKey(undefined)).toBeUndefined();
    });

    it("is not re-implemented anywhere in src/installer", async () => {
        // The three hand-copied copies in index.ts are what let install and
        // status disagree. Derived so a fourth copy fails here rather than
        // shipping — the FR-D5 shape, third recurrence.
        const { readFileSync, readdirSync } = await import("node:fs");
        const offenders: string[] = [];
        for (const f of readdirSync("src/installer")) {
            if (!f.endsWith(".ts")) continue;
            const src = readFileSync(path.join("src/installer", f), "utf-8");
            // A local re-implementation looks like an inline scan of the server
            // map testing command/args for "engram".
            if (/\.find\(\s*\w+\s*=>[\s\S]{0,400}?includes\(["']engram["']\)/.test(src)
                && f !== "config-writer.ts") {
                offenders.push(f);
            }
        }
        expect(offenders).toEqual([]);
    });
});
