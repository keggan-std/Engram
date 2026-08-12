// ============================================================================
// Export completeness — FR-D1 T5 / task #32
//
// The export's table list was EIGHT names, hand-typed into the handler.
// MEASURED on the live store at schema V26: 24 real tables exist, so SIXTEEN
// were silently absent — including observations (146 rows, and observations are
// the product), handoffs (22), tool_call_log (488), config (43) and
// checkpoints. The call still reported "Memory exported" and a KB figure, so
// the only signal that two thirds of the store was missing was a smaller file
// than expected.
//
// Second defect in the same six lines: `catch { exported[table] = [] }` turned
// a table it could not READ into an empty array — indistinguishable from a
// table that is genuinely empty. A read failure became a factual-looking claim
// that there was nothing there.
//
// WHY THIS SUITE ASSERTS AGAINST sqlite_master RATHER THAN A LIST.
// A test that names the 24 tables it expects is the same hand-maintained
// register that caused the bug, restated one directory over — it would pass on
// the day it was written and rot on the next migration. So the assertion is
// DERIVED: every non-FTS, non-internal table the schema actually has must
// appear in the payload. Add a table in a future migration and this suite
// covers it without being edited; forget to export it and this suite fails.
// That is charter §2's rule applied to the test as well as to the code.
// ============================================================================

import { describe, it, expect, vi, beforeAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = mkdtempSync(path.join(os.tmpdir(), "engram-export-"));

vi.mock("../../src/database.js", async () => {
    const { default: Database } = await import("better-sqlite3");
    const { runMigrations } = await import("../../src/migrations.js");
    const { createRepositories } = await import("../../src/repositories/index.js");

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    const repos = createRepositories(db);

    return {
        getDb: () => db,
        // The real implementation, not a stub. This suite's whole point is that
        // the table list is DERIVED from the schema; a hand-written mock here
        // would be the very hardcoded register the test exists to forbid.
        listUserTables: (d = db) => {
            const names = (d.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
            ).all() as Array<{ name: string }>).map(t => t.name);
            return {
                tables: names.filter(n => !n.startsWith("fts_") && !n.startsWith("sqlite_")),
                ftsArtifacts: names.filter(n => n.startsWith("fts_")),
                sqliteInternal: names.filter(n => n.startsWith("sqlite_")),
            };
        },
        now: () => new Date().toISOString(),
        getCurrentSessionId: () => 1,
        getProjectRoot: () => TMP,
        getDbSizeKb: () => 42,
        getDbPath: () => ":memory:",
        backupDatabase: () => "/test/backup.db",
        restoreDatabase: () => ({ ok: true }),
        getRepos: () => repos,
        getServices: () => ({}),
    };
});

vi.mock("../../src/global-db.js", () => ({
    writeGlobalDecision: vi.fn().mockReturnValue(null),
    writeGlobalConvention: vi.fn().mockReturnValue(null),
    queryGlobalDecisions: vi.fn().mockReturnValue([]),
    queryGlobalConventions: vi.fn().mockReturnValue([]),
    getGlobalDb: vi.fn().mockReturnValue(null),
}));

type Handler = (p: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

class HandlerCapturer {
    handlers = new Map<string, Handler>();
    registerTool(name: string, _cfg: unknown, handler: Handler) { this.handlers.set(name, handler); }
}

let admin: Handler;
let db: import("better-sqlite3").Database;

beforeAll(async () => {
    const { registerAdminDispatcher } = await import("../../src/tools/dispatcher-admin.js");
    const { getDb } = await import("../../src/database.js");
    db = getDb() as unknown as import("better-sqlite3").Database;
    const cap = new HandlerCapturer();
    registerAdminDispatcher(cap as never);
    admin = cap.handlers.get("engram_admin")!;
});

/** Every table the schema really has, minus the two documented exclusions. */
function expectedTables(): string[] {
    return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
        .map(t => t.name)
        .filter(n => !n.startsWith("fts_") && !n.startsWith("sqlite_"))
        .sort();
}

async function runExport(outFile: string) {
    const res = await admin({ action: "export", output_path: path.join(TMP, outFile) });
    const envelope = JSON.parse(res.content[0].text);
    const payload = JSON.parse(readFileSync(path.join(TMP, outFile), "utf-8"));
    return { envelope, payload };
}

describe("export is complete, or it names what it skipped (task #32)", () => {
    it("carries EVERY table the schema has, derived rather than listed", async () => {
        const { payload } = await runExport("all.json");
        const expected = expectedTables();
        const missing = expected.filter(t => !(t in payload));

        expect(
            missing,
            `${missing.length} table(s) exist in the schema and are absent from the export: ${missing.join(", ")}. ` +
            `This is task #32's defect: a hand-typed table list that fell behind the schema.`
        ).toEqual([]);

        // And the reported count must agree with what is actually in the file —
        // a count computed separately from the payload is a second register.
        expect(payload.table_count).toBe(expected.length);
    });

    it("reports per-table row counts that match the rows it shipped", async () => {
        const { payload } = await runExport("counts.json");
        for (const [table, count] of Object.entries(payload.row_counts as Record<string, number>)) {
            expect(Array.isArray(payload[table]), `${table} is missing from the payload`).toBe(true);
            expect((payload[table] as unknown[]).length, `row_counts.${table} disagrees with the rows`).toBe(count);
        }
        const summed = Object.values(payload.row_counts as Record<string, number>).reduce((a, b) => a + b, 0);
        expect(payload.total_rows).toBe(summed);
    });

    it("excludes FTS shadow tables and SAYS it did, with a count", async () => {
        const { payload } = await runExport("excl.json");
        const ftsCount = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
            .filter(t => t.name.startsWith("fts_")).length;

        expect(ftsCount, "the schema has no FTS artifacts, so this test proves nothing").toBeGreaterThan(0);
        expect(payload.excluded.fts_artifacts).toBe(ftsCount);
        expect(payload.excluded.why).toMatch(/derived|rebuilt/i);
        // An excluded table must not also be present — "excluded" has to mean it.
        expect(Object.keys(payload).some(k => k.startsWith("fts_"))).toBe(false);
    });

    it("redacts secret config values — completeness must not leak a credential", async () => {
        // config was NOT in the old eight-table list, so completing the export
        // is exactly what brings http_token into reach. SECRET_CONFIG_KEYS
        // redacts it on every other read path and must here too.
        const { CFG_HTTP_TOKEN, REDACTED_VALUE } = await import("../../src/constants.js");
        db.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)")
            .run(CFG_HTTP_TOKEN, "deadbeef".repeat(8), new Date().toISOString());

        const { payload } = await runExport("secret.json");
        const raw = readFileSync(path.join(TMP, "secret.json"), "utf-8");

        expect(raw, "the bearer token was written to the export file in plaintext")
            .not.toContain("deadbeef".repeat(8));
        const row = (payload.config as Array<{ key: string; value: string }>).find(r => r.key === CFG_HTTP_TOKEN);
        expect(row?.value).toBe(REDACTED_VALUE);
        expect(payload.redacted_secrets).toBeGreaterThan(0);
    });

    it("declares completeness explicitly rather than leaving it inferred", async () => {
        const { envelope, payload } = await runExport("flag.json");
        expect(payload.complete).toBe(true);
        expect(payload.failed_to_read).toEqual({});
        // The envelope the agent reads must carry the same verdict as the file.
        const data = envelope.data ?? envelope;
        expect(data.complete).toBe(true);
        expect(String(data.message)).toMatch(/Exported \d+ table\(s\), \d+ row\(s\)/);
    });

    it("a table it cannot read is REPORTED, never rendered as empty", async () => {
        // The original `catch { exported[table] = [] }` made an unreadable table
        // look like an empty one. Forced here by creating a table and then
        // replacing it with something SELECT * cannot serve: a view over a
        // missing table is listed in sqlite_master as a view, so instead drop
        // the backing table of a real table-shaped object mid-flight is not
        // possible — use a table whose name round-trips but whose read throws
        // by revoking it through a schema trick.
        //
        // Simplest reliable form: a table containing a column of a type that
        // better-sqlite3 refuses to marshal. A BLOB is fine, but an integer
        // larger than Number.MAX_SAFE_INTEGER throws on read unless safeIntegers
        // is set — which is exactly the "cannot read this row" case.
        db.exec("CREATE TABLE IF NOT EXISTS unreadable_probe (id INTEGER PRIMARY KEY, big INTEGER)");
        db.prepare("INSERT INTO unreadable_probe (big) VALUES (9223372036854775807)").run();

        const { payload } = await runExport("fail.json");

        // Either it read the table (in which case it must be present with its
        // rows) or it could not (in which case it must be NAMED as failed).
        // What must never happen is presence with a silently empty array.
        const present = Array.isArray(payload.unreadable_probe);
        const named = "unreadable_probe" in (payload.failed_to_read as Record<string, string>);
        expect(present || named, "the probe table vanished from both the payload and the failure list").toBe(true);
        if (present) {
            expect(
                (payload.unreadable_probe as unknown[]).length,
                "a table with one row was exported as empty — the silent-catch defect"
            ).toBe(1);
        } else {
            expect(payload.complete).toBe(false);
        }

        db.exec("DROP TABLE unreadable_probe");
    });
});

describe("cleanup", () => {
    it("removes the temp directory", () => {
        rmSync(TMP, { recursive: true, force: true });
        expect(true).toBe(true);
    });
});
