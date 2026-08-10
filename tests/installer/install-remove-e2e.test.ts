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

// ============================================================================
// EXIT CODES — the installer could not report failure.
//
// Found by the 2026-08-10 review, which is the one the earlier delegated pass
// was supposed to do and returned all-CLEAN instead. All three were PROVEN by
// running the compiled CLI before any fix, not argued from reading it.
//
// The shape is this repo's signature defect: a surface that is CORRECT and
// UNREADABLE. installToPath's catch block refuses to overwrite a config it
// cannot parse — exactly right, and exactly what task #46 asks for — then
// returned normally, so the process exited 0 having written nothing. A CI
// step running the documented install command could not tell "installed" from
// "refused to install".
//
// Note what the existing round-trip test above does at its "written" line: it
// accepts EITHER the local or the global path, on the sound reasoning that
// predicting the path would re-implement the resolver. The consequence is that
// it cannot see which scope was used — and the scope is the third finding.
// A test written to be robust against a behaviour it did not model will pass
// over a defect in that behaviour.
// ============================================================================

/** A config file that exists and cannot be parsed. The FR-D5 / H1 hazard state. */
function seedCorruptConfig(projectDir: string, relDir: string, fileName: string): string {
    const dir = path.join(projectDir, relDir);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, fileName);
    writeFileSync(file, '{ "mcpServers": { "engram": { }, }  // not JSON\n');
    return file;
}

describe("the installer can report failure", () => {
    it("exits non-zero when the install it was asked to do did not happen", () => {
        const dir = makeProject();
        try {
            const file = seedCorruptConfig(dir, path.join("__home", ".cursor"), "mcp.json");
            const before = readFileSync(file, "utf-8");

            const r = runCli(["install", "--ide", "cursor", "--yes", "--global"], dir);

            // Both halves matter. Refusing to write is the safety property;
            // exiting 1 is what makes the refusal visible to anything but a
            // human reading scrollback.
            expect(readFileSync(file, "utf-8"), "an unparseable config was modified").toBe(before);
            expect(
                r.status,
                `install failed to write anything and still exited ${r.status}\n${r.stdout}\n${r.stderr}`
            ).toBe(1);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it("still exits 0 when the install actually happens", () => {
        // Non-vacuity guard: an exit code that is always 1 carries no more
        // information than one that is always 0.
        const dir = makeProject();
        try {
            const r = runCli(["install", "--ide", "cursor", "--yes"], dir);
            expect(r.status, `a healthy install exited ${r.status}\n${r.stdout}\n${r.stderr}`).toBe(0);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it("--check exits non-zero when a config cannot be parsed", () => {
        const dir = makeProject();
        try {
            seedCorruptConfig(dir, path.join("__home", ".cursor"), "mcp.json");
            const r = runCli(["install", "--check"], dir);

            expect(r.stdout + r.stderr).toMatch(/invalid JSON/);
            expect(
                r.status,
                "--check printed 'invalid JSON' and exited 0, so nothing could act on it"
            ).toBe(1);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it("--check exits 0 when every config it finds is readable", () => {
        const dir = makeProject();
        try {
            seedLocalConfig(dir, ".cursor", "mcp.json", "mcpServers");
            const r = runCli(["install", "--check"], dir);
            expect(r.status, `--check went red on a healthy machine\n${r.stdout}`).toBe(0);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});

describe("install scope is chosen explicitly, not discovered afterwards", () => {
    it("--yes says which scope it picked", () => {
        // The two entry paths disagree: interactive labels local "(recommended)"
        // and takes it on a blank answer; --yes silently takes global. The
        // default is not being changed — that would break every existing
        // script — but it must not be silent.
        const dir = makeProject();
        try {
            const r = runCli(["install", "--ide", "cursor", "--yes"], dir);
            const out = r.stdout + r.stderr;
            expect(out, "a non-interactive install did not say which scope it wrote to").toMatch(/Scope\s*:/);
            expect(out).toMatch(/global/);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it("--local writes into the project, not the home directory", () => {
        const dir = makeProject();
        try {
            const r = runCli(["install", "--ide", "cursor", "--yes", "--local"], dir);
            expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);

            const local = path.join(dir, ".cursor", "mcp.json");
            const globalish = path.join(dir, "__home", ".cursor", "mcp.json");
            expect(existsSync(local), "--local did not write a project-level config").toBe(true);
            expect(existsSync(globalish), "--local wrote to the global scope anyway").toBe(false);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it("--global writes into the home directory, not the project", () => {
        const dir = makeProject();
        try {
            runCli(["install", "--ide", "cursor", "--yes", "--global"], dir);
            expect(existsSync(path.join(dir, "__home", ".cursor", "mcp.json"))).toBe(true);
            expect(existsSync(path.join(dir, ".cursor", "mcp.json"))).toBe(false);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});

describe("process.exit() is never reached after a fetch (nodejs/node#58091)", () => {
    // PROVEN 5/5 on node v24.14.1: `install --check` printed its whole report
    // and then died with exit code 127 and
    //   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c:76
    // because process.exit() races undici's socket teardown on Windows. The
    // upstream fix has been stalled since January 2025.
    //
    // THIS GATE IS STRUCTURAL, NOT BEHAVIOURAL, AND THAT IS DELIBERATE. The
    // crash only fires when the fetch actually runs, so a behavioural test
    // would need the network — which would make the suite non-hermetic to
    // prove a bug about hermeticity, and would go green offline for the wrong
    // reason. Reading the source is the honest gate here. It also matches the
    // derived-binding method observation #131 describes: assert against the
    // tree, not against a remembered line number.
    const SRC = path.join(here, "..", "..", "src", "installer", "index.ts");

    /**
     * Blank out comments, preserving length so offsets stay comparable.
     *
     * The first version of this gate went red against the FIXED source: the
     * comments explaining the defect say "process.exit()", and a scanner that
     * reads prose finds the word rather than the call. A gate that cannot tell
     * code from the comment describing the code is a gate that fails whenever
     * someone documents the thing it guards.
     */
    function stripComments(src: string): string {
        return src
            .replace(/\/\*[\s\S]*?\*\//g, m => " ".repeat(m.length))
            .replace(/\/\/[^\n]*/g, m => " ".repeat(m.length));
    }

    /** Byte offsets of every `await fetchNpmLatest()` in runInstaller. */
    function fetchOffsets(src: string): number[] {
        const out: number[] = [];
        const re = /await fetchNpmLatest\(\)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) out.push(m.index);
        return out;
    }

    it("still has the fetch this gate is about", () => {
        // Non-vacuity. If fetchNpmLatest is ever removed or renamed, the gate
        // below passes for a reason that has nothing to do with the defect.
        const src = stripComments(readFileSync(SRC, "utf-8"));
        expect(
            fetchOffsets(src).length,
            "no `await fetchNpmLatest()` found — this whole gate has gone vacuous"
        ).toBeGreaterThan(0);
    });

    it("no process.exit() follows a fetch inside the same branch", () => {
        const src = stripComments(readFileSync(SRC, "utf-8"));
        const offsets = fetchOffsets(src);

        // The --check branch and the auto-detect branch each fetch and each end
        // in a `return`. Scan from each fetch to the end of its enclosing block
        // by brace depth, which survives the block being moved or renamed.
        const offenders: string[] = [];
        for (const start of offsets) {
            let depth = 0;
            for (let i = start; i < src.length; i++) {
                const c = src[i];
                if (c === "{") depth++;
                else if (c === "}") {
                    if (depth === 0) break; // left the enclosing block
                    depth--;
                }
                if (src.startsWith("process.exit(", i)) {
                    const line = src.slice(0, i).split("\n").length;
                    offenders.push(`line ${line}`);
                }
            }
        }

        expect(
            offenders,
            `process.exit() is reachable after a fetch at ${offenders.join(", ")} — ` +
            `this is the exit-127 libuv assertion. Use \`process.exitCode = n; return;\` instead.`
        ).toEqual([]);
    });
});

describe("the suite's own hermeticity", () => {
    it("honours ENGRAM_SKIP_UPDATE_CHECK instead of merely setting it", () => {
        // runCli has set this variable since this file was written, with a
        // comment saying it keeps the installer off the network. No code read
        // it. The suite was not hermetic; it had only never reached a code path
        // that fetches. --check does. This asserts the control is real, which
        // is the whole difference between a setting and a comment.
        const dir = makeProject();
        try {
            const r = runCli(["install", "--check"], dir);
            const out = r.stdout + r.stderr;
            expect(out, "the update check ran despite ENGRAM_SKIP_UPDATE_CHECK").toMatch(/update check skipped/);
            expect(out, "a skipped check was reported as a broken network").not.toMatch(/npm unreachable/);
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
