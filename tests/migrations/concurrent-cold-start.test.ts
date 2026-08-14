// ============================================================================
// Concurrent cold start — two servers must not race the migration chain
//
// TASK #59 (FR-D4 T5), PROVEN before this file existed by spawning two real
// dist/index.js processes against a fresh project root. Quoted from the task:
//
//   --- A ---  initialize replied: false (NO REPLY in 25s)
//              [Engram] [ERROR] Fatal error {"message":"duplicate column name: git_branch"}
//              exited: 1
//   --- B ---  initialize replied: true (3532 ms)
//   memory.db integrity_check: ok, schema version 25, 65 tables
//
// MECHANISM. runMigrationsTo() read the schema version, then ran each migration
// in its own DEFERRED transaction. Nothing serialised read-version → run-chain
// ACROSS PROCESSES, so both processes read v0 and both ran the whole chain. The
// loser reached V22's unconditional
// `ALTER TABLE file_notes ADD COLUMN git_branch TEXT` and died.
//
// BLAST RADIUS. The DATA survives — integrity_check returns ok — and the
// PROCESS does not. That is why this is a concurrency finding and not a
// durability one. It is loud in stderr and IDE MCP hosts discard stderr, so
// what the user sees is an Engram that is simply absent. First run only: a
// restart succeeds because the chain is complete by then.
//
// WHY THIS SUITE SPAWNS CHILDREN RATHER THAN OPENING TWO CONNECTIONS.
// better-sqlite3 is synchronous. Two connections inside one process cannot
// interleave read-version → run-chain, which is the entire defect, so an
// in-process test would assert nothing about it. Separate OS processes contend
// for the real SQLite file locks, which is the real mechanism.
//
// It spawns the compiled `dist/migrations.js` rather than the whole server:
// same code path, none of the MCP handshake, and the test is a second rather
// than half a minute. The worker is written to the OS temp directory and given
// ABSOLUTE file URLs for both of its imports, so it resolves nothing by
// walking node_modules and cannot accidentally load a different copy.
//
// HERMETIC: every round gets its own temp directory and its own database file.
// ============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { runMigrations, getCurrentSchemaVersion } from "../../src/migrations.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST_MIGRATIONS = path.join(here, "..", "..", "dist", "migrations.js");
const require_ = createRequire(import.meta.url);

/**
 * The worker: open the shared database, wait for a common start instant so the
 * children genuinely collide, then run the chain to head.
 *
 * The barrier matters. Without it the first child spawned wins by however long
 * `spawn` takes to get the next one running — on a warm machine that is enough
 * to serialise them by accident, and the suite would pass while proving
 * nothing. A shared wall-clock deadline removes that luck.
 */
function makeWorker(): string {
    return [
        `const [, , dbPath, sqlitePath, migrationsPath, startAtMs] = process.argv;`,
        `const { default: Database } = await import(sqlitePath);`,
        `const { runMigrations, getCurrentSchemaVersion } = await import(migrationsPath);`,
        `const db = new Database(dbPath);`,
        `db.pragma("busy_timeout = 15000");`,
        // WAL, via the same check-then-convert the production opener uses. A
        // bare `journal_mode = WAL` here would reintroduce the OTHER cold-start
        // race (src/database.ts ensureWalMode) and this suite would fail for a
        // reason that has nothing to do with the migration chain it is about.
        `for (let i = 0; i < 100; i++) {`,
        `  if (String(db.pragma("journal_mode", { simple: true })).toLowerCase() === "wal") break;`,
        `  try { db.pragma("journal_mode = WAL"); break; }`,
        `  catch (e) { if (e.code !== "SQLITE_BUSY") throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); }`,
        `}`,
        // Spin to the shared deadline. A sleep would be kinder to the CPU and
        // less precise; precision is the point here.
        `while (Date.now() < Number(startAtMs)) { /* barrier */ }`,
        `try {`,
        `  runMigrations(db);`,
        `  process.stdout.write("OK " + getCurrentSchemaVersion(db));`,
        `  process.exit(0);`,
        `} catch (e) {`,
        `  process.stdout.write("FAIL " + (e && e.message ? e.message : String(e)));`,
        `  process.exit(1);`,
        `}`,
    ].join("\n");
}

interface WorkerResult { code: number | null; out: string }

function spawnWorkers(count: number, dbPath: string, workerPath: string, sqliteUrl: string, migrationsUrl: string): Promise<WorkerResult[]> {
    const startAt = Date.now() + 400; // enough for every child to reach the barrier
    const running = Array.from({ length: count }, () =>
        new Promise<WorkerResult>(resolve => {
            const child = spawn(
                process.execPath,
                [workerPath, dbPath, sqliteUrl, migrationsUrl, String(startAt)],
                { stdio: ["ignore", "pipe", "pipe"] },
            );
            let out = "";
            child.stdout.on("data", d => { out += d.toString(); });
            child.stderr.on("data", d => { out += d.toString(); });
            child.on("close", code => resolve({ code, out }));
        }),
    );
    return Promise.all(running);
}

describe("two servers cold-starting on a fresh project (task #59)", () => {
    let tmpRoot: string;
    let workerPath: string;
    let sqliteUrl: string;
    let migrationsUrl: string;
    /** What the chain reaches when nothing is contending. The control. */
    let headVersion: number;

    beforeAll(() => {
        // The compiled artifact is what the children load. Failing loudly here
        // beats a confusing import error inside four child processes at once.
        expect(
            existsSync(DIST_MIGRATIONS),
            `dist/migrations.js is missing — run \`npm run build\` before this suite`,
        ).toBe(true);

        tmpRoot = mkdtempSync(path.join(os.tmpdir(), "engram-migrate-race-"));
        workerPath = path.join(tmpRoot, "worker.mjs");
        writeFileSync(workerPath, makeWorker(), "utf8");
        sqliteUrl = pathToFileURL(require_.resolve("better-sqlite3")).href;
        migrationsUrl = pathToFileURL(DIST_MIGRATIONS).href;

        // Control: a single uncontended run, through the SOURCE chain, so the
        // expected head is derived rather than hard-coded. A hard-coded 26 is a
        // hand-maintained register that goes wrong on the next migration.
        const controlDb = new Database(path.join(tmpRoot, "control.db"));
        runMigrations(controlDb);
        headVersion = getCurrentSchemaVersion(controlDb);
        controlDb.close();
        expect(headVersion).toBeGreaterThan(0);
    });

    // Four contenders, three rounds. One round can pass by luck if the OS
    // happens to serialise the spawns; three rounds of four make that unlikely
    // enough that a regression shows up rather than hides.
    for (let round = 1; round <= 3; round++) {
        it(`round ${round}: four processes migrate the same fresh database and all survive`, async () => {
            const dbPath = path.join(tmpRoot, `race-${round}.db`);
            const results = await spawnWorkers(4, dbPath, workerPath, sqliteUrl, migrationsUrl);

            const failed = results.filter(r => r.code !== 0);
            expect(
                failed.length,
                `${failed.length} of ${results.length} processes died: ${failed.map(f => f.out).join(" | ")}`,
            ).toBe(0);

            // Every survivor must agree the database is at head. A process that
            // exits 0 having silently skipped the chain would be a worse bug
            // than the crash this fixes.
            for (const r of results) {
                expect(r.out.trim()).toBe(`OK ${headVersion}`);
            }

            // And the database itself must be sound — the original finding was
            // careful that the data survived while the process did not, so
            // asserting only on exit codes would miss a regression that trades
            // one for the other.
            const check = new Database(dbPath, { readonly: true });
            expect(check.pragma("integrity_check", { simple: true })).toBe("ok");
            expect(getCurrentSchemaVersion(check)).toBe(headVersion);
            check.close();
        }, 60_000);
    }

    it("a database already at head is not migrated again, and takes no write lock to find out", () => {
        // The fast path exists because BEGIN IMMEDIATE blocks every other
        // writer: paying that on every process start, to guard a race that can
        // only happen on first run, would be a worse trade than the race. This
        // asserts the property that pays for it — an up-to-date database can be
        // checked WHILE another connection holds a write lock.
        const dbPath = path.join(tmpRoot, "at-head.db");
        const writer = new Database(dbPath);
        writer.pragma("journal_mode = WAL");
        runMigrations(writer);

        const second = new Database(dbPath);
        second.pragma("busy_timeout = 250"); // deliberately short: a block here fails fast

        writer.exec("BEGIN IMMEDIATE");
        try {
            expect(() => runMigrations(second)).not.toThrow();
            expect(getCurrentSchemaVersion(second)).toBe(headVersion);
        } finally {
            writer.exec("ROLLBACK");
            second.close();
            writer.close();
        }
    });

    it("cleans up", () => {
        rmSync(tmpRoot, { recursive: true, force: true });
        expect(existsSync(tmpRoot)).toBe(false);
    });
});
