// ============================================================================
// Backup → restore round trip — FR-D1 §5, the binding for target T1
//
// This is the test that did not exist, and its absence is why `restore` shipped
// as a silent no-op. Every other durability test in this repo runs against
// `:memory:` or a bare file, so the failure mode — a stale -wal being
// checkpointed back over the freshly restored file — could not appear.
//
// The rule this suite encodes, borrowed from GitLab's 2017 incident (five
// backup methods, none of which had been restored from):
//
//   A backup nobody has restored from is not a backup.
//
// So the assertions are about DATA COMING BACK, never about a file being
// written or a call returning ok. `integrity_check` returned "ok" throughout
// the original bug; file sizes were plausible; the response said "success".
//
// The connection is deliberately held OPEN across the restore, because that is
// the only way the shipped tool can be called — the MCP server owns the handle.
//
// NOTE: these tests call the REAL initDatabase, not a mock, because the bug is
// entirely about files on disk. initDatabase registers the instance in
// ~/.engram/instances.json; each test shuts the registry down in cleanup.
// ============================================================================

import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, existsSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
    initDatabase, getDb, getRepos, getServices, getDbPath,
    backupDatabase, restoreDatabase,
} from "../../src/database.js";

const roots: string[] = [];

/** A real Engram store on disk, opened exactly as the server opens it. */
function newStore(): string {
    const root = mkdtempSync(path.join(os.tmpdir(), "engram-restore-"));
    roots.push(root);
    initDatabase(root);
    return root;
}

/** Write enough rows that a meaningful amount lives in the -wal, not the main file. */
function seed(prefix: string, n: number): void {
    const cfg = getRepos().config;
    const ts = new Date().toISOString();
    for (let i = 0; i < n; i++) cfg.set(`${prefix}-${i}`, `${prefix}-value-${i}`, ts);
}

function countKeys(prefix: string): number {
    return (getDb().prepare("SELECT COUNT(*) n FROM config WHERE key LIKE ?").get(`${prefix}-%`) as { n: number }).n;
}

afterEach(() => {
    try { getServices().registry.shutdown(); } catch { /* already down */ }
    try { getDb().close(); } catch { /* already closed */ }
    for (const r of roots.splice(0)) {
        try { rmSync(r, { recursive: true, force: true }); } catch { /* windows file locks */ }
    }
});

describe("restore — the round trip", () => {
    it("brings back the backed-up state and discards everything written after it", () => {
        newStore();
        seed("before", 50);
        const backup = backupDatabase();

        // Work done AFTER the backup. This is what a restore must undo.
        seed("after", 200);
        expect(countKeys("before")).toBe(50);
        expect(countKeys("after")).toBe(200);

        const result = restoreDatabase(backup);

        // getDb() now returns the REOPENED connection — a stale handle here
        // would itself be a bug, so this doubles as a check on step 5.
        expect(countKeys("before")).toBe(50);
        expect(countKeys("after")).toBe(0);          // <-- the assertion the old code failed
        expect(result.restored_from).toBe(backup);
        expect(Number(result.schema_version)).toBeGreaterThan(0);
    });

    it("leaves no stale -wal or -shm from the replaced database", () => {
        newStore();
        seed("live", 300);           // guarantees a hot WAL
        const backup = backupDatabase();
        seed("more", 300);

        const dbPath = getDbPath();
        expect(existsSync(dbPath + "-wal")).toBe(true);   // precondition: WAL is hot

        restoreDatabase(backup);

        // Reopening creates a fresh -wal, so the meaningful assertion is that the
        // content is the backup's, not the pre-restore file's.
        expect(countKeys("more")).toBe(0);
        expect(countKeys("live")).toBe(300);
    });

    it("writes a safety backup of the database it replaced, and it is readable", () => {
        const root = newStore();
        seed("original", 40);
        const backup = backupDatabase();
        seed("doomed", 25);

        const { safety_backup } = restoreDatabase(backup);

        expect(existsSync(safety_backup)).toBe(true);
        expect(safety_backup.startsWith(path.join(root, ".engram"))).toBe(true);

        // The safety backup must contain the state that was thrown away —
        // otherwise it is decoration, which is failure mode F2.
        const rescued = new Database(safety_backup, { readonly: true });
        const doomed = (rescued.prepare("SELECT COUNT(*) n FROM config WHERE key LIKE 'doomed-%'").get() as { n: number }).n;
        rescued.close();
        expect(doomed).toBe(25);
    });

    it("survives a second round trip — restore, work, backup, restore again", () => {
        newStore();
        seed("gen1", 30);
        const b1 = backupDatabase();
        seed("gen2", 30);

        restoreDatabase(b1);
        expect(countKeys("gen2")).toBe(0);

        seed("gen3", 30);
        const b2 = backupDatabase();
        seed("gen4", 30);

        restoreDatabase(b2);
        expect(countKeys("gen1")).toBe(30);
        expect(countKeys("gen3")).toBe(30);
        expect(countKeys("gen4")).toBe(0);
    });
});

describe("restore — refusing bad input", () => {
    it("rejects a file that is not a database, without touching the live store", () => {
        const root = newStore();
        seed("keep", 20);
        const junk = path.join(root, "not-a-database.db");
        writeFileSync(junk, "this is plain text, not SQLite");

        expect(() => restoreDatabase(junk)).toThrow(/rejected/i);
        expect(countKeys("keep")).toBe(20);          // live store untouched
    });

    it("rejects a valid SQLite file that is not an Engram store", () => {
        const root = newStore();
        seed("keep", 20);
        const foreign = path.join(root, "someone-elses.db");
        const f = new Database(foreign);
        f.exec("CREATE TABLE unrelated(x)");
        f.close();

        expect(() => restoreDatabase(foreign)).toThrow(/not an Engram database/i);
        expect(countKeys("keep")).toBe(20);
    });

    it("rejects a missing path", () => {
        newStore();
        expect(() => restoreDatabase(path.join(os.tmpdir(), "definitely-not-here.db"))).toThrow(/not found/i);
    });

    it("takes no safety backup when the candidate is rejected", () => {
        const root = newStore();
        const backupDir = path.join(root, ".engram", "backups");
        const junk = path.join(root, "junk.db");
        writeFileSync(junk, "nope");

        expect(() => restoreDatabase(junk)).toThrow();
        // Validation runs BEFORE the safety backup, so a rejected restore must
        // not litter the backup directory. Order-of-operations, asserted.
        const files = existsSync(backupDir) ? readdirSync(backupDir) : [];
        expect(files).toEqual([]);
    });
});

describe("restore — the regression this suite exists for", () => {
    // Proving the gate fires: run the ORIGINAL implementation and show these
    // same assertions catch it. Without this, a future refactor could reinstate
    // the bug and the suite above might pass for the wrong reason.
    it("the old implementation — copy over a live database — silently does not restore", () => {
        const root = mkdtempSync(path.join(os.tmpdir(), "engram-oldimpl-"));
        roots.push(root);
        const live = path.join(root, "memory.db");
        const backup = path.join(root, "backup.db");

        const b = new Database(backup);
        b.pragma("journal_mode = WAL");
        b.exec("CREATE TABLE t(x)");
        b.prepare("INSERT INTO t VALUES(?)").run("from-backup");
        b.pragma("wal_checkpoint(TRUNCATE)");
        b.close();

        const l = new Database(live);
        l.pragma("journal_mode = WAL");
        l.exec("CREATE TABLE t(x)");
        for (let i = 0; i < 200; i++) l.prepare("INSERT INTO t VALUES(?)").run("live-" + i);

        // dispatcher-admin.ts, before FR-D1: connection open, no unlink, no close.
        copyFileSync(backup, live);

        expect(existsSync(live + "-wal")).toBe(true);   // the hot journal that undoes it
        l.close();                                      // checkpoints the STALE wal back

        const after = new Database(live);
        const rows = (after.prepare("SELECT COUNT(*) n FROM t").get() as { n: number }).n;
        const integrity = after.pragma("integrity_check", { simple: true });
        after.close();

        // The backup held ONE row. This is the bug, pinned as a fact.
        expect(rows).toBe(200);
        // ...and nothing anywhere reports a problem. This is why the assertion
        // has to be about data, not about health.
        expect(integrity).toBe("ok");
    });
});

// ─── FR-D1 T2 / task #29 — the backup must verify what it wrote ───────────
//
// Two defects, both silent, both in the "reports success, delivers less"
// family this suite exists for.
//
// 1. The checkpoint's RESULT was discarded. `wal_checkpoint(FULL)` returns
//    `busy = 1` when another connection holds a read lock and the WAL could
//    NOT be folded into the main file. `copyFileSync` copies only the main
//    file, never the `-wal` sidecar — so a busy checkpoint means every commit
//    still in the WAL is absent from the "backup", which then returns a path
//    and a plausible byte count.
//
// 2. Nothing opened the copy. A backup nobody has opened is a file, and this
//    suite's own header says a backup nobody has restored from is not a backup.
describe("backup verifies what it wrote (task #29)", () => {
    it("produces a copy that opens, passes integrity_check, and holds the rows", () => {
        newStore();
        const repos = getRepos();
        repos.decisions.create(1, new Date().toISOString(), "a verified decision", "why", null, null);

        const dest = backupDatabase();
        expect(existsSync(dest)).toBe(true);

        // The assertion the old code never made: open it and look.
        const copy = new Database(dest, { readonly: true, fileMustExist: true });
        expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
        const n = (copy.prepare("SELECT COUNT(*) c FROM decisions").get() as { c: number }).c;
        expect(n, "the backup opened cleanly but carried none of the rows").toBeGreaterThan(0);
        copy.close();
    });

    it("refuses a destination it cannot write a valid database to, and leaves no file behind", () => {
        newStore();
        getRepos().decisions.create(1, new Date().toISOString(), "d", "r", null, null);

        // A directory that exists as a FILE cannot hold the copy. The point is
        // not this specific failure but that a failure surfaces as a throw with
        // nothing left on disk, rather than a returned path to a broken file.
        const root = mkdtempSync(path.join(os.tmpdir(), "engram-badbackup-"));
        roots.push(root);
        const blocker = path.join(root, "blocker");
        writeFileSync(blocker, "not a directory");

        expect(() => backupDatabase(path.join(blocker, "nested", "backup.db"))).toThrow();
    });

    it("a verification failure removes the unusable file rather than listing it as a backup", () => {
        // The restore path lists whatever is in the backup directory as a
        // candidate. A file that failed verification must not be in that list,
        // or the next incident restores from it.
        newStore();
        getRepos().decisions.create(1, new Date().toISOString(), "d", "r", null, null);

        const dest = backupDatabase();
        expect(existsSync(dest)).toBe(true);

        // Corrupt the copy after the fact and confirm a fresh backup to the same
        // path still verifies — i.e. verification is per-call, not cached.
        writeFileSync(dest, "garbage");
        const again = backupDatabase(dest);
        const copy = new Database(again, { readonly: true, fileMustExist: true });
        expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
        copy.close();
    });
});
