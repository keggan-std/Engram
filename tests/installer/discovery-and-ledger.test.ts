// ============================================================================
// Installer discovery, the install plan, and the machine-wide ledger
//
// THE COMPLAINT THIS SUITE BINDS. The installer answered "is Engram set up
// here?" by sweeping the user-level configs of 14 IDEs and consulting the
// project only if no global config file existed at all — which is almost never,
// since an IDE writes its global file the first time you change any setting. A
// user standing in a project with a project-local install was shown their home
// directory and told nothing was installed. Local paths were also only ever
// checked against the exact cwd, so a config at the repo root was invisible from
// `src/`, which is where people actually run commands.
//
// Three properties are asserted here, each of which was false before:
//
//  1. A project-local install is found from a SUBDIRECTORY, by climbing.
//  2. An install is RECORDED, so it can be found again — including installs to
//     a custom directory that no config scan could ever rediscover — and
//     `--isolated` opts out loudly rather than silently.
//  3. A local install on an IDE with no workspace variable gets an ABSOLUTE
//     --project-root, so the server is told where the project is instead of
//     inferring it from whatever directory the IDE happened to spawn it in.
//     Decision #43. Without it, every marker failing means ~/.engram/global —
//     one database shared by every project, which sessions.ts:227 warns about
//     in exactly those words.
//
// Same child-process, isolated-HOME approach as install-remove-e2e.test.ts, and
// for the same reasons: the compiled CLI is the artifact users run, and a suite
// about a tool that writes into other products' config files must not be able
// to reach the developer's own.
// ============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { appDataDir } from "../../src/installer/ide-configs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, "..", "..", "dist", "index.js");

function runCli(args: string[], cwd: string, home: string) {
    return spawnSync(process.execPath, [DIST, ...args], {
        cwd,
        encoding: "utf-8",
        timeout: 60_000,
        env: {
            ...process.env,
            HOME: home,
            USERPROFILE: home,
            APPDATA: path.join(home, "AppData", "Roaming"),
            ENGRAM_SKIP_UPDATE_CHECK: "1",
        },
    });
}

/** A project with its own HOME. Returns { root, home }. */
function makeProject(): { root: string; home: string } {
    const dir = mkdtempSync(path.join(os.tmpdir(), "engram-discovery-"));
    const home = path.join(dir, "__home");
    mkdirSync(home, { recursive: true });
    const root = path.join(dir, "proj");
    // .git, so the project root resolves here rather than climbing into the
    // real filesystem — and so the walk-up STOPS here, which test 1 relies on.
    mkdirSync(path.join(root, ".git"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }));
    return { root, home };
}

function ledgerOf(home: string): Array<Record<string, string>> {
    const p = path.join(home, ".engram", "installs.json");
    if (!existsSync(p)) return [];
    return JSON.parse(readFileSync(p, "utf-8")).installs;
}

beforeAll(() => {
    expect(
        existsSync(DIST),
        "dist/index.js is missing — run `npm run build`. This suite exercises the COMPILED CLI on purpose."
    ).toBe(true);
});

describe("--check searches the project before the machine, and climbs", () => {
    it("finds a project-local install from three directories below the repo root", () => {
        const { root, home } = makeProject();
        try {
            mkdirSync(path.join(root, ".cursor"), { recursive: true });
            writeFileSync(path.join(root, ".cursor", "mcp.json"), JSON.stringify({
                mcpServers: { engram: { command: "npx", args: ["-y", "engram-mcp-server@1.11.0"], _engram_version: "1.11.0" } },
            }));
            const deep = path.join(root, "src", "deep", "deeper");
            mkdirSync(deep, { recursive: true });

            const r = runCli(["install", "--check", "--scope", "local"], deep, home);
            const out = r.stdout + r.stderr;

            expect(out, "the local install was not found from a subdirectory — the walk-up is not working").toMatch(/Cursor/);
            expect(out).toMatch(/v1\.11\.0/);
            // The distance is reported, not just the hit. A user needs to know
            // the config they are being shown is not in the directory they are
            // standing in.
            expect(out).toMatch(/3 director(y|ies) up/);
            // And the database location, which the old output never showed at all.
            expect(out).toContain(path.join(root, ".engram", "memory.db"));
        } finally { rmSync(path.dirname(root), { recursive: true, force: true }); }
    });

    it("stops climbing at the project root rather than reaching the home directory", () => {
        // An install placed ABOVE the repo root belongs to a different project.
        // Reporting it here would be worse than missing it: it names a config
        // the user cannot reach from this project and would send them to edit
        // someone else's.
        const { root, home } = makeProject();
        try {
            const outside = path.dirname(root);
            mkdirSync(path.join(outside, ".cursor"), { recursive: true });
            writeFileSync(path.join(outside, ".cursor", "mcp.json"), JSON.stringify({
                mcpServers: { engram: { command: "npx", args: ["-y", "x"], _engram_version: "9.9.9" } },
            }));

            const r = runCli(["install", "--check", "--scope", "local"], root, home);
            expect(r.stdout + r.stderr, "the search climbed past the project root").not.toMatch(/9\.9\.9/);
        } finally { rmSync(path.dirname(root), { recursive: true, force: true }); }
    });

    it("--scope global does not report project-local installs, and vice versa", () => {
        // Non-vacuity for the scope flag: if it were ignored, both assertions
        // below would pass for the wrong reason on a machine with one install.
        const { root, home } = makeProject();
        try {
            mkdirSync(path.join(root, ".cursor"), { recursive: true });
            writeFileSync(path.join(root, ".cursor", "mcp.json"), JSON.stringify({
                mcpServers: { engram: { command: "npx", args: ["-y", "x"], _engram_version: "1.2.3" } },
            }));

            const localOnly = runCli(["install", "--check", "--scope", "local"], root, home);
            expect(localOnly.stdout).toMatch(/1\.2\.3/);
            expect(localOnly.stdout, "--scope local printed the machine-wide section").not.toMatch(/MACHINE-WIDE/);

            const globalOnly = runCli(["install", "--check", "--scope", "global"], root, home);
            expect(globalOnly.stdout, "--scope global reported a project-local install").not.toMatch(/1\.2\.3/);
            expect(globalOnly.stdout).toMatch(/MACHINE-WIDE/);
        } finally { rmSync(path.dirname(root), { recursive: true, force: true }); }
    });

    it("rejects a --scope it does not understand instead of silently defaulting", () => {
        const { root, home } = makeProject();
        try {
            const r = runCli(["install", "--check", "--scope", "everywhere"], root, home);
            expect(r.status).toBe(1);
            expect(r.stdout + r.stderr).toMatch(/--scope expects/);
        } finally { rmSync(path.dirname(root), { recursive: true, force: true }); }
    });
});

describe("an install is recorded so it can be found again", () => {
    it("records the config path, the project and the database path", () => {
        const { root, home } = makeProject();
        try {
            const r = runCli(["install", "--ide", "cursor", "--local", "--universal", "--yes"], root, home);
            expect(r.status).toBe(0);

            const rows = ledgerOf(home);
            expect(rows).toHaveLength(1);
            expect(rows[0].ideKey).toBe("cursor");
            expect(rows[0].scope).toBe("local");
            expect(rows[0].mode).toBe("universal");
            expect(rows[0].configPath).toBe(path.join(root, ".cursor", "mcp.json"));
            expect(rows[0].projectRoot).toBe(root);
            // The whole point of recording dbPath: "where is my memory" is the
            // first question after an install and the output never answered it.
            expect(rows[0].dbPath).toBe(path.join(root, ".engram", "memory.db"));
        } finally { rmSync(path.dirname(root), { recursive: true, force: true }); }
    });

    it("--isolated writes nothing to the ledger and says so, with the path", () => {
        const { root, home } = makeProject();
        try {
            const r = runCli(["install", "--ide", "cursor", "--local", "--isolated", "--yes"], root, home);
            expect(r.status).toBe(0);
            expect(ledgerOf(home), "--isolated still recorded the install").toHaveLength(0);

            const out = r.stdout + r.stderr;
            expect(out).toMatch(/not recorded \(--isolated\)/);
            // Loud, not silent. An install nothing can find later is only an
            // acceptable outcome if the user is handed the path at the moment
            // they choose it.
            expect(out).toMatch(/will NOT find this install/);
            expect(out).toContain(path.join(root, ".cursor", "mcp.json"));
            // The config itself must still be written — isolation is about the
            // ledger, not about doing less work.
            expect(existsSync(path.join(root, ".cursor", "mcp.json"))).toBe(true);
        } finally { rmSync(path.dirname(root), { recursive: true, force: true }); }
    });

    it("--remove retracts the row, so --check cannot report a removed install", () => {
        const { root, home } = makeProject();
        try {
            runCli(["install", "--ide", "cursor", "--local", "--yes"], root, home);
            expect(ledgerOf(home)).toHaveLength(1);

            const r = runCli(["install", "--remove", "--ide", "cursor"], root, home);
            expect(r.stdout + r.stderr).toMatch(/Removed Engram/);
            expect(ledgerOf(home), "the ledger still claims an install that was removed").toHaveLength(0);
        } finally { rmSync(path.dirname(root), { recursive: true, force: true }); }
    });
});

describe("the server is told where the project is, not left to infer it", () => {
    it("a local install on an IDE with no workspace variable gets an absolute --project-root", () => {
        // Roo Code declares localDirs and no workspaceVar, which is the case
        // decision #43 identifies as the real gap: seven of fourteen IDEs cannot
        // tell the server where they are, so findProjectRoot() guessed from cwd.
        const { root, home } = makeProject();
        try {
            const r = runCli(["install", "--ide", "roocode", "--local", "--yes"], root, home);
            expect(r.status).toBe(0);

            const entry = JSON.parse(readFileSync(path.join(root, ".roo", "mcp.json"), "utf-8")).mcpServers.engram;
            expect(entry.args, `no absolute --project-root in ${JSON.stringify(entry.args)}`)
                .toContain(`--project-root=${root}`);
        } finally { rmSync(path.dirname(root), { recursive: true, force: true }); }
    });

    it("a GLOBAL install does not get one, because that entry is shared by every project", () => {
        // The mirror assertion, and the one that keeps the fix honest. Pinning
        // an absolute path into a user-level config would tie every project on
        // the machine to whichever one happened to be open at install time.
        const { root, home } = makeProject();
        try {
            const r = runCli(["install", "--ide", "roocode", "--global", "--yes"], root, home);
            expect(r.status).toBe(0);

            // appDataDir(), not a hand-written "<home>/AppData/Roaming" — the
            // child resolves this per-platform and spelling it out here made
            // the assertion Windows-only.
            const cfgPath = path.join(appDataDir(home, path.join(home, "AppData", "Roaming")),
                "Code", "User", "globalStorage",
                "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json");
            const args: string[] = JSON.parse(readFileSync(cfgPath, "utf-8")).mcpServers.engram.args;
            expect(args.filter(a => a.startsWith("--project-root=")), `global entry pinned a project root: ${JSON.stringify(args)}`).toEqual([]);
            // It gets the per-IDE shard key instead, which is the F7 behaviour
            // that keeps two IDEs off one write lock.
            expect(args).toContain("--ide=roocode");
        } finally { rmSync(path.dirname(root), { recursive: true, force: true }); }
    });

    it("an IDE with a workspace variable keeps the variable, not a frozen path", () => {
        // Non-vacuity for the two above: Cursor DOES declare workspaceVar, and
        // substituting an absolute path there would break every other project
        // opened in the same IDE.
        const { root, home } = makeProject();
        try {
            runCli(["install", "--ide", "cursor", "--local", "--yes"], root, home);
            const args: string[] = JSON.parse(readFileSync(path.join(root, ".cursor", "mcp.json"), "utf-8")).mcpServers.engram.args;
            expect(args).toContain("--project-root=${workspaceFolder}");
            expect(args).not.toContain(`--project-root=${root}`);
        } finally { rmSync(path.dirname(root), { recursive: true, force: true }); }
    });
});

describe("Antigravity installs to the path its vendor documents", () => {
    // VERIFIED 2026-08-11 against https://antigravity.google/docs/mcp: "The
    // configuration file is located globally at ~/.gemini/config/mcp_config.json
    // (or locally in your workspace under .agents/mcp_config.json)."
    //
    // The registry declared ~/.gemini/antigravity/mcp_config.json and no local
    // scope at all, so every Antigravity install this product ever performed was
    // written to a file the IDE does not read: silent, successful and inert.
    it("writes the global config the vendor documents", () => {
        const { root, home } = makeProject();
        try {
            const r = runCli(["install", "--ide", "antigravity", "--global", "--yes"], root, home);
            expect(r.status).toBe(0);
            expect(existsSync(path.join(home, ".gemini", "config", "mcp_config.json")),
                "not written to the documented path").toBe(true);
            expect(existsSync(path.join(home, ".gemini", "antigravity", "mcp_config.json")),
                "still writing to the path Antigravity does not read").toBe(false);
        } finally { rmSync(path.dirname(root), { recursive: true, force: true }); }
    });

    it("supports the project-local scope the vendor documents", () => {
        const { root, home } = makeProject();
        try {
            const r = runCli(["install", "--ide", "antigravity", "--local", "--yes"], root, home);
            expect(r.status).toBe(0);
            expect(existsSync(path.join(root, ".agents", "mcp_config.json"))).toBe(true);
        } finally { rmSync(path.dirname(root), { recursive: true, force: true }); }
    });

    it("--remove still cleans up entries earlier versions wrote to the legacy path", () => {
        // The legacy path is kept as a SEARCH path precisely so the inert
        // entries already on users' machines can be cleaned up. Dropping it
        // would strand them forever.
        const { root, home } = makeProject();
        try {
            const legacy = path.join(home, ".gemini", "antigravity");
            mkdirSync(legacy, { recursive: true });
            writeFileSync(path.join(legacy, "mcp_config.json"), JSON.stringify({
                mcpServers: { engram: { command: "npx", args: ["-y", "engram-mcp-server"], _engram_version: "1.12.0" } },
            }));

            const r = runCli(["install", "--remove", "--ide", "antigravity"], root, home);
            expect(r.stdout + r.stderr).toMatch(/Removed Engram/);
            const left = JSON.parse(readFileSync(path.join(legacy, "mcp_config.json"), "utf-8"));
            // `?.` rather than a direct index: removeFromConfig drops the whole
            // mcpServers key once it is empty, so the success case has no object
            // to index into. The property under test is "no engram entry
            // remains", and asserting it through a shape the code is free to
            // change is how a test fails for a reason that is not the defect.
            expect(left.mcpServers?.engram, "the legacy entry survived --remove").toBeUndefined();
        } finally { rmSync(path.dirname(root), { recursive: true, force: true }); }
    });
});
