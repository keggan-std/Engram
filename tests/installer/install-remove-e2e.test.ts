// ============================================================================
// Installer end-to-end — the CLI a user actually types
//
// TWO GAPS, ONE SUITE. Both found by the 2026-08-07 installer audit.
//
// GAP 1 (task #99, VERIFIED at index.ts:496-523 before the fix). `--remove`
// resolved targets with resolveIdeGlobalPaths() ONLY. It never looked at
// ide.scopes.localDirs — while the installer's own interactive prompt presents
// local as "project-specific config file (recommended)" and defaults a blank
// answer to it. So uninstall silently failed for the RECOMMENDED install
// location, then printed "Engram was not found in <IDE> configs" about a place
// it had not searched. Absence-of-looking reported as absence.
//
// GAP 2 (task #101). runInstaller() had ZERO test callers, and so did all three
// ide-detector exports. Everything proven about config-writer.ts was proven in
// isolation; nothing proved the chain from argv to a file on disk. That is the
// exact failure shape this repo keeps shipping — a part that is correct and
// unreachable.
//
// WHY A CHILD PROCESS AND NOT AN IMPORT. runInstaller() calls process.exit() on
// nearly every branch, so importing it would kill the test runner. Spawning
// dist/index.js also tests the REAL entry point — argv parsing, the install
// dispatch in src/index.ts, and the installer — which is the wiring the gap was
// about. tests/e2e/mcp-wire.test.ts already establishes this pattern against
// the compiled artifact on purpose.
//
// HERMETIC: every run gets its own temp project directory and its own HOME, so
// nothing here can touch the developer's real IDE configs. That matters more
// than usual for a suite about a tool that writes to other products' files.
// ============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, "..", "..", "dist", "index.js");

/** Run the real CLI in an isolated project + home. */
function runCli(args: string[], cwd: string) {
    return spawnSync(process.execPath, [DIST, ...args], {
        cwd,
        encoding: "utf-8",
        timeout: 60_000,
        env: {
            ...process.env,
            // Isolate anything that resolves against the user's real machine.
            HOME: path.join(cwd, "__home"),
            USERPROFILE: path.join(cwd, "__home"),
            APPDATA: path.join(cwd, "__home", "AppData", "Roaming"),
            // Keep the installer off the network — it fetches npm latest for a
            // version banner and a 5s timeout per test is pure cost.
            ENGRAM_SKIP_UPDATE_CHECK: "1",
        },
    });
}

function makeProject(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "engram-install-e2e-"));
    mkdirSync(path.join(dir, "__home"), { recursive: true });
    // A project marker, so detectProjectRootForDisplay resolves here with high
    // confidence rather than walking up into the real filesystem.
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture" }));
    return dir;
}

/** A local config with Engram already installed, as the installer writes it. */
function seedLocalConfig(projectDir: string, relDir: string, fileName: string, configKey: string) {
    const dir = path.join(projectDir, relDir);
    if (relDir) mkdirSync(dir, { recursive: true });
    const file = path.join(dir, fileName);
    writeFileSync(file, JSON.stringify({
        [configKey]: {
            engram: {
                command: "npx",
                args: ["-y", "engram-mcp-server"],
                _engram_version: "1.12.0",
            },
            // A co-resident server that must survive untouched.
            "some-other-server": { command: "node", args: ["other.js"] },
        },
    }, null, 2));
    return file;
}

beforeAll(() => {
    expect(
        existsSync(DIST),
        "dist/index.js is missing — run `npm run build` before the tests. This suite exercises the COMPILED CLI on purpose; skipping it would defeat the point."
    ).toBe(true);
});

describe("the CLI is reachable at all", () => {
    it("runs and prints its own help without crashing", () => {
        const dir = makeProject();
        try {
            const r = runCli(["install", "--help"], dir);
            expect(r.error, `spawn failed: ${r.error?.message}`).toBeUndefined();
            expect(r.status, `exited ${r.status}\n${r.stderr}`).toBe(0);
            expect(r.stdout + r.stderr).toMatch(/--remove/);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});

describe("--remove reaches the scope the installer recommends", () => {
    // cursor: localDirs [".cursor"], configKey mcpServers — a plain representative.
    it("removes an entry from a project-local config", () => {
        const dir = makeProject();
        try {
            const file = seedLocalConfig(dir, ".cursor", "mcp.json", "mcpServers");

            const r = runCli(["install", "--remove", "--ide", "cursor"], dir);
            expect(r.status, `exited ${r.status}\n${r.stdout}\n${r.stderr}`).toBe(0);

            const after = JSON.parse(readFileSync(file, "utf-8"));
            expect(
                after.mcpServers?.engram,
                "the local entry survived --remove — this is the defect task #99 describes"
            ).toBeUndefined();
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it("leaves a co-resident MCP server completely untouched", () => {
        const dir = makeProject();
        try {
            const file = seedLocalConfig(dir, ".cursor", "mcp.json", "mcpServers");
            runCli(["install", "--remove", "--ide", "cursor"], dir);

            const after = JSON.parse(readFileSync(file, "utf-8"));
            // Non-vacuity guard, added after a tamper run showed this test
            // passing while removal did nothing at all: a neighbour trivially
            // survives when nothing is touched. Removal must have HAPPENED for
            // "it left the neighbour alone" to mean anything.
            expect(after.mcpServers?.engram, "nothing was removed — the assertion below is vacuous").toBeUndefined();
            expect(after.mcpServers?.["some-other-server"]).toEqual({
                command: "node", args: ["other.js"],
            });
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it("handles the empty-localDir form (a bare .mcp.json at the project root)", () => {
        const dir = makeProject();
        try {
            // claudecode declares localDirs [""], so the file is `.mcp.json` at
            // the root rather than `<dir>/mcp.json`. That branch of the filename
            // rule was hand-copied at four sites and is now resolved in one.
            const file = seedLocalConfig(dir, "", ".mcp.json", "mcpServers");

            const r = runCli(["install", "--remove", "--ide", "claudecode"], dir);
            expect(r.status).toBe(0);
            expect(JSON.parse(readFileSync(file, "utf-8")).mcpServers?.engram).toBeUndefined();
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it("names the paths it searched instead of asserting absence", () => {
        const dir = makeProject();
        try {
            // Nothing installed anywhere. The old message was a flat "Engram was
            // not found in <IDE> configs", which read as absence when it was
            // absence-of-looking. The output must now be checkable by the user.
            const r = runCli(["install", "--remove", "--ide", "cursor"], dir);
            expect(r.status).toBe(0);
            const out = r.stdout + r.stderr;
            expect(out, "removal reported 'not found' without saying where it looked").toMatch(/Searched:/);
            expect(out, "the local scope is not named in the searched paths").toMatch(/\.cursor/);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it("does not damage a config it cannot parse", () => {
        const dir = makeProject();
        try {
            mkdirSync(path.join(dir, ".cursor"), { recursive: true });
            const file = path.join(dir, ".cursor", "mcp.json");
            const original = '{ "mcpServers": { "engram": { }, }  // trailing comma + comment\n';
            writeFileSync(file, original);

            const r = runCli(["install", "--remove", "--ide", "cursor"], dir);

            // The contract is the same one hazard H1 was about: a file Engram
            // cannot parse is a file Engram does not write. Byte-identical after.
            expect(readFileSync(file, "utf-8"), "an unparseable config was modified").toBe(original);
            expect(r.status, "an unparseable config should not crash the run").toBe(0);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});

describe("install → remove round trip, through the real CLI", () => {
    it("installs locally, then removes what it installed", () => {
        const dir = makeProject();
        try {
            const install = runCli(["install", "--ide", "cursor", "--yes"], dir);
            expect(install.status, `install exited ${install.status}\n${install.stdout}\n${install.stderr}`).toBe(0);

            // Find whatever the installer actually wrote, rather than asserting
            // a path this test predicted — predicting it would re-implement the
            // resolver and could agree with a bug.
            const local = path.join(dir, ".cursor", "mcp.json");
            const globalish = path.join(dir, "__home", ".cursor", "mcp.json");
            const written = [local, globalish].filter(existsSync);
            expect(written.length, `install wrote nothing.\n${install.stdout}\n${install.stderr}`).toBeGreaterThan(0);

            const target = written[0];
            expect(JSON.parse(readFileSync(target, "utf-8")).mcpServers?.engram).toBeDefined();

            const remove = runCli(["install", "--remove", "--ide", "cursor"], dir);
            expect(remove.status).toBe(0);
            expect(
                JSON.parse(readFileSync(target, "utf-8")).mcpServers?.engram,
                `--remove did not undo what --install wrote at ${target}`
            ).toBeUndefined();
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});
