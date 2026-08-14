// ============================================================================
// Decision Supersession Tests — superseded_by direction and V25 repair
//
// The bug: DecisionsRepo.create() bound its `supersedes` argument to the NEW
// row's `superseded_by` column. That column means "the decision that REPLACED
// this one", so the new, authoritative decision was written pointing backwards
// at the one it replaced — leaving a row that is simultaneously
// status:'active' and superseded_by:<older id>.
//
// Nothing in src/ reads the column. `get_decisions` returns it, and for a
// memory server the consumer of that JSON is an agent deciding which decision
// is current — which is the consumer that matters.
//
// The invariant: superseded_by points FORWARD in time, and only ever on a row
// whose status is 'superseded'.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/migrations.js";
import { createRepositories, type Repositories } from "../../src/repositories/index.js";

const NOW = "2026-08-02T00:00:00.000Z";

let db: InstanceType<typeof Database>;
let repos: Repositories;

beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    runMigrations(db);
    repos = createRepositories(db);
});

afterEach(() => {
    try { db.close(); } catch { /* already closed */ }
});

interface Row { id: number; status: string; superseded_by: number | null }
const row = (id: number): Row =>
    db.prepare("SELECT id, status, superseded_by FROM decisions WHERE id = ?").get(id) as Row;

describe("superseded_by points forward, never backward", () => {
    it("a new decision recording `supersedes` does NOT mark itself superseded", () => {
        const oldId = repos.decisions.create(null, NOW, "Use bcrypt");
        const newId = repos.decisions.create(null, NOW, "Use argon2", null, null, null, "active", oldId);

        expect(row(newId).superseded_by).toBeNull();
        expect(row(newId).status).toBe("active");
    });

    it("supersede() writes the pointer onto the OLD row", () => {
        const oldId = repos.decisions.create(null, NOW, "Use bcrypt");
        const newId = repos.decisions.create(null, NOW, "Use argon2", null, null, null, "active", oldId);
        repos.decisions.supersede(oldId, newId);

        expect(row(oldId).status).toBe("superseded");
        expect(row(oldId).superseded_by).toBe(newId);
        expect(row(newId).superseded_by).toBeNull();
    });

    it("a chain leaves exactly one active decision, and it points nowhere", () => {
        const a = repos.decisions.create(null, NOW, "A");
        const b = repos.decisions.create(null, NOW, "B", null, null, null, "active", a);
        repos.decisions.supersede(a, b);
        const c = repos.decisions.create(null, NOW, "C", null, null, null, "active", b);
        repos.decisions.supersede(b, c);

        expect(row(a).superseded_by).toBe(b);
        expect(row(b).superseded_by).toBe(c);
        expect(row(c).superseded_by).toBeNull();

        const active = db.prepare("SELECT id FROM decisions WHERE status = 'active'").all() as Array<{ id: number }>;
        expect(active.map(r => r.id)).toEqual([c]);
    });

    it("no active decision anywhere carries a superseded_by pointer", () => {
        const a = repos.decisions.create(null, NOW, "A");
        const b = repos.decisions.create(null, NOW, "B", null, null, null, "active", a);
        repos.decisions.supersede(a, b);

        const contradictory = db.prepare(
            "SELECT id FROM decisions WHERE status <> 'superseded' AND superseded_by IS NOT NULL"
        ).all();
        expect(contradictory).toEqual([]);
    });

    it("createBatch never sets superseded_by", () => {
        const ids = repos.decisions.createBatch(
            [{ decision: "One" }, { decision: "Two" }],
            null,
            NOW
        );
        for (const id of ids) expect(row(id).superseded_by).toBeNull();
    });
});

// ─── V25 — the repair for databases that already recorded the bad value ──────

describe("migration V25 repairs already-corrupted rows", () => {
    it("clears superseded_by on rows that were never superseded, and preserves real ones", () => {
        const fresh = new Database(":memory:");
        runMigrations(fresh);

        // Simulate the pre-fix state directly: an active row wrongly pointing
        // backwards, alongside a legitimately superseded row.
        fresh.prepare(
            "INSERT INTO decisions (timestamp, decision, status, superseded_by) VALUES (?, 'old', 'superseded', 2)"
        ).run(NOW);
        fresh.prepare(
            "INSERT INTO decisions (timestamp, decision, status, superseded_by) VALUES (?, 'new', 'active', 1)"
        ).run(NOW);
        fresh.prepare(
            "INSERT INTO decisions (timestamp, decision, status, superseded_by) VALUES (?, 'exp', 'experimental', 1)"
        ).run(NOW);

        // Re-run the repair as the migration defines it.
        fresh.exec(`
            UPDATE decisions SET superseded_by = NULL
             WHERE superseded_by IS NOT NULL AND status <> 'superseded';
        `);

        const all = fresh.prepare("SELECT id, status, superseded_by FROM decisions ORDER BY id").all() as Row[];
        expect(all[0]).toEqual({ id: 1, status: "superseded", superseded_by: 2 }); // legitimate — kept
        expect(all[1]).toEqual({ id: 2, status: "active", superseded_by: null });  // repaired
        expect(all[2]).toEqual({ id: 3, status: "experimental", superseded_by: null }); // repaired

        fresh.close();
    });

    it("is idempotent and a no-op on a database that never used supersedes", () => {
        repos.decisions.create(null, NOW, "Standalone");
        const before = db.prepare("SELECT id, status, superseded_by FROM decisions").all();

        for (let i = 0; i < 3; i++) {
            db.exec(`UPDATE decisions SET superseded_by = NULL WHERE superseded_by IS NOT NULL AND status <> 'superseded';`);
        }

        expect(db.prepare("SELECT id, status, superseded_by FROM decisions").all()).toEqual(before);
    });
});
