# Domain 1 — Durability & Recovery

**Foundations Review** · Charter: [`00-CHARTER.md`](00-CHARTER.md) §6 domain 1, §7 template
**Owns:** *the data survives.* Storage shape and retrieval quality → domain 3.
**Status is not carried here.** It lives in the Engram task board.

> Engram's failure mode is not a crash. It is a **confident wrong answer that
> survives.** This domain has the sharpest instance of that in the codebase:
> `restore` reports success and does nothing.

---

## 1 — Claims

What Engram promises about survival of data. Explicit claims are quoted with a
source; implied claims are the ones users reasonably infer and nobody wrote down.

| ID | Claim | Source | Kind |
|---|---|---|---|
| **D1-C1** | Your memory survives an upgrade | — | implied; charter §4.2 names it as the product's whole premise |
| **D1-C2** | "The database is a plain file — portable via `backup`, exportable to JSON, **restorable on any machine**" | `README.md:135` | explicit |
| **D1-C3** | "`export` serializes **everything** to JSON" | `README.md:779` | explicit |
| **D1-C4** | `restore` — "Restore from a backup" | `README.md:966`, tool surface | explicit |
| **D1-C5** | "Uses SQLite's **native backup API** for safe, consistent copies" | `src/tools/backup.ts:21` | explicit |
| **D1-C6** | "Creates a **safety backup** of the current database before overwriting" | `src/tools/backup.ts:94` | explicit |
| **D1-C7** | "Decisions are superseded, never deleted — the full evolution of your architecture is **always recoverable**" | `README.md:703` | explicit |
| **D1-C8** | "Work items persist across sessions, restarts, agent switches, and context resets" | `README.md:717` | explicit |
| **D1-C9** | After corruption: delete `.engram/`, restart, "Engram will re-create the database and run all migrations automatically" | `README.md:1263-1269` | explicit |
| **D1-C10** | `health` reporting `healthy: true` means the store is intact | `src/tools/dispatcher-admin.ts:277` | implied |
| **D1-C11** | `import` restores what its dry run previews (`decisions`, `conventions`, `file_notes`, `milestones`) | `src/tools/dispatcher-admin.ts:181-186` | implied by the preview itself |
| **D1-C12** | An older Engram will not damage a database written by a newer one | — | implied by shipping `npx engram@latest` alongside pinned installs |
| **D1-C13** | WAL mode gives crash safety across the 14 supported IDE integrations, which may share a file | `README.md:62,135`, `src/database.ts:60` | explicit mechanism, implied guarantee |

---

## 2 — Reality

Grades per charter §5. **PROVEN** = executable check run, output quoted below.
**VERIFIED** = read in source by the lead, `file:line` cited. **REPORTED** = a lead.

| ID | Verdict | Grade |
|---|---|---|
| D1-C1 | **Unknown for the historical path.** Every migration test but one runs against empty tables; the golden fixture (`tests/migrations/golden-fixture.test.ts`) closes this from V25 forward only. V1→V25-with-data is untested — Engram task #7 | VERIFIED |
| D1-C2 | **False in the direction that costs data.** "Restorable" is the half that does not work — see D1-C4 | PROVEN |
| D1-C3 | **False.** 8 tables hardcoded at `dispatcher-admin.ts:164`. `observations` (57 rows live), `handoffs`, `checkpoints`, `agents`, `broadcasts`, `pending_work`, `tool_call_log`, `annotations`, `audit_log`, `config`, `snapshot_cache` are all absent | VERIFIED |
| D1-C4 | **False. `restore` is a silent no-op under production conditions** | **PROVEN — P1** |
| D1-C5 | **False as written.** `backupDatabase()` does `wal_checkpoint(FULL)` + `fs.copyFileSync` (`database.ts:298-302`). It does not use the backup API. The comment in that function says so explicitly | VERIFIED |
| D1-C6 | **True in dead code, false in the live path.** The safety backup that aborts on failure is `backup.ts:126-131`; `registerBackupTools` has **zero call sites**. The live path is `dispatcher-admin.ts:143` — `try { safetyBackupPath = backupDatabase(); } catch { /* non-blocking */ }`, then overwrite | VERIFIED |
| D1-C7 | **True for decisions, but they cannot be corrected either.** No `update_convention`, no way to amend a decision's text or a session summary. A mistyped write is permanent — observation #57 | VERIFIED |
| D1-C8 | **True.** Tasks persist; `claim_task` atomicity is domain 4's | VERIFIED |
| D1-C9 | **True, and it is the problem.** The documented corruption remedy is *delete everything*, backed by an export that is incomplete by construction (C3) and an import that restores a quarter of what it previews (C11) | VERIFIED |
| D1-C10 | **False.** `PRAGMA integrity_check` validates page structure, not content. It returned `ok` on the database P1 had just silently reverted 200 transactions of | **PROVEN — P1** |
| D1-C11 | **False.** The dry run counts four tables; the run inserts **only** `decisions` — the code comment says "decisions only — safe to merge". No transaction, `INSERT OR IGNORE` on the original `id`, and the reported count counts attempts that did not throw | VERIFIED |
| D1-C12 | **False.** No version ceiling exists | **PROVEN — P4** |
| D1-C13 | **Partly.** WAL is set correctly with `busy_timeout` ordered before other pragmas (`database.ts:60-61`). But the shipped SQLite is `3.51.2` — the last release affected by the WAL-reset corruption bug, whose precondition is exactly the multi-connection case Engram documents | **PROVEN** (version) + vendor-documented (bug) |

### The proofs

Scripts run against throwaway copies; the live store was never touched.

#### P1 — `restore` reports success and does nothing *(CRITICAL)*

`dispatcher-admin.ts:138-146` copies the backup file over `memory.db` while the
server still holds the connection open — which it must, since the same handler
uses `db`, and the success message is *"Please RESTART the MCP server."*
The old `-wal` is never removed. On close, SQLite checkpoints that stale WAL
straight back over the file the user just restored.

```
  before restore: memory.db-wal is 832272 bytes (hot)
  after  restore: memory.db-wal is 832272 bytes  <-- NOT removed
  code does: fs.copyFileSync(input_path, dbPath)   // no unlink of -wal/-shm, no close

  restored db now holds: 200 rows, first value = live-0
  integrity_check: ok
  VERDICT: user asked for the 1-row backup and got 200 rows — the restore did not take.
```

The backup contained one row. After a "successful" restore the database holds the
200 live rows and `integrity_check` says `ok`. **No error, no corruption signal,
no way for the user to tell.** They restarted the server as instructed and their
rollback quietly did not happen.

This run produced the *benign* outcome — the WAL fully overwrote the restored
pages. The other outcome is worse and is documented by the vendor: a mix of
restored main-file pages and stale WAL pages is genuine corruption. SQLite lists
*"Overwriting a database file with another without also deleting any hot journal
associated with the original database"* among the actions **likely to lead to
corruption** ([howtocorrupt.html §1.4](https://www.sqlite.org/howtocorrupt.html)).

`restore` also never checks that `input_path` is a SQLite database at all
(`:141` checks existence only). Any file will be copied over the live store.

#### P2 — `backup` discards the checkpoint result *(latent, NOT reproduced)*

`database.ts:301`: `try { db.pragma("wal_checkpoint(FULL)"); } catch { }`.
The pragma returns `{busy, log, checkpointed}`; `busy: 1` means the checkpoint
did **not** complete, and the file copy on the next line would then miss
committed transactions with no error.

I tried to reproduce that with a second connection holding a read transaction —
the documented multi-IDE case — and **failed**:

```
  wal_checkpoint(FULL) returned: {"busy":0,"log":505,"checkpointed":505}
  live rows: 500   backup rows: 500
  VERDICT: checkpoint completed this run; the unchecked busy flag is still the defect
```

**Stated plainly because the charter forbids the alternative:** the discarded
return value is VERIFIED from source; the silent-short-backup is *not* proven.
It is a latent defect, graded as one.

#### P3 — a mid-chain migration failure strands the schema at a version no release shipped

`migrations.ts` wraps **each** migration in `db.transaction(...)`. The chain has
no such wrapper and takes no backup first.

```
  chain threw: simulated failure in v23
  started at v20, chain targets v24
  schema_meta.version is now: v22
  tables present: a, b, schema_meta
  VERDICT: v22 is a state no release ever shipped. Each migration is atomic; the CHAIN is not.
  And runMigrations() takes no backup first — compare restore/clear, which both do.
```

Note the asymmetry: `restore` and `clear` both attempt a safety backup.
`runMigrations` — which carries D1-C1, the central promise — does not.

#### P4 — an older build opens a newer database and calls it up to date

```
  db says schema v99; this build knows up to v25
  pendingMigrations = migrations.filter(m => m.version > 99) => []
  runMigrations(): "if (pendingMigrations.length === 0) return; // Already up to date"
  VERDICT: no version-ceiling check exists. Old code proceeds against a schema it does not know,
           and writes to it. There is no error, no warning, and no read-only fallback.
```

Reachable today: `npx engram@latest` in one IDE and a pinned older install in
another, against one project database. That is the shipped configuration.

#### P5 — the shipped SQLite is the last version with the WAL-reset bug

```
  runtime sqlite_version(): 3.51.2
  header: #define SQLITE_VERSION "3.51.2"
  better-sqlite3 package: 12.6.2
```

Vendor text, verified directly rather than taken from the sub-agent report:
the bug *"is likely present in all version of SQLite from 3.7.0 (2010-07-21)
through 3.51.2 (2026-01-09). It is fixed in version 3.51.3 (2026-03-13)"*, and
*"only affects databases in WAL mode when there are two or more database
connections open on the same file, in separate threads or processes"*
([wal.html#walresetbug](https://www.sqlite.org/wal.html)).

Engram is WAL mode, and `database.ts:60` and `:123` name the exact precondition
in their own comments — *"multi-IDE shards may still share a file"*,
*"same-IDE multi-window contention"*. **Calibration, stated so this finding does
not outrank the others:** SQLite says the occurrence rate *"appears to be less
than or equal to the expected occurrence rate of SSD malfunctions and/or
cosmic-ray hits"* and that upgrading *"is not an emergency"*. P1 is certain and
happening; P5 is rare and cheap to close. Ranking them the other way round
because one has a vendor advisory attached would be exactly the wrong instinct.

---

## 3 — Failure modes

Silence is scored explicitly. A loud failure is cheaper than a quiet one.

| # | Trigger | Blast radius | Silent? | User recovery |
|---|---|---|---|---|
| **F1** | User calls `restore` on a running server (the only way it can be called) | The rollback does not happen, or the file is corrupted per howtocorrupt §1.4 | **Totally silent** — returns success, `integrity_check` says `ok` | None. They believe they restored |
| **F2** | Any table read fails during `export` | That table becomes `[]` in the output file. A partially failed export is byte-indistinguishable from a complete export of empty tables | **Totally silent** | Discovered at restore time — the classic backup failure |
| **F3** | User exports before wiping a machine | Every observation, handoff, checkpoint, agent record and broadcast is lost. Export reports success | **Silent** | None |
| **F4** | User imports an export into a populated store | Only `decisions` land, and only those whose original `id` is free. The preview promised four tables | **Silent** — the success message reports only decisions, so nothing contradicts the preview | None |
| **F5** | Import fails at row 400 of 500 | 399 rows committed, no transaction, no rollback | Partly — the error surfaces, the partial state does not | Manual |
| **F6** | A migration throws mid-chain | Schema stranded at an intermediate version, no backup taken | Loud at the point of failure, **silent afterwards** — the next start sees a "valid" lower version and resumes the chain into a half-migrated schema | None |
| **F7** | Older build opens a newer database | Writes against an unknown schema | **Totally silent** | None |
| **F8** | Backup taken while another connection holds the WAL busy | Backup silently short of committed transactions | **Totally silent** | None. *Latent — see P2, not reproduced* |
| **F9** | WAL-reset data race across two IDE shards | Database corrupt | Loud eventually (`integrity_check` fails), silent at the moment of loss | Restore from a backup — see F1 |
| **F10** | User follows the documented corruption remedy (`rm -rf .engram/`) | Everything not covered by F2/F3 is gone | Loud, and chosen | None by design |

**Adversarial.** `restore` and `import` both accept an arbitrary path with no
shape validation; `import` runs `JSON.parse` straight into prepared statements.
The threat model for a hostile export file belongs to domain 2 — handed over,
not solved twice.

### 3b — Prior art: how this has gone wrong for other people

Searched as *failure* literature. Two of the four changed a conclusion.

- **SQLite, "How To Corrupt An SQLite Database File" §1.4** — *"Overwriting a
  database file with another without also deleting any hot journal associated
  with the original database"* is listed among actions *likely to lead to
  corruption*. This is a verbatim description of `dispatcher-admin.ts:145`.
  §1.2 further states that safe live-database copies require `sqlite3_rsync`,
  `VACUUM INTO`, or the backup API — and that a plain file copy is safe *only*
  when no transaction is in progress, *"and if the previous write transaction
  failed, then it is important that any rollback journal or write-ahead log be
  copied together with the database file itself."*
  <https://www.sqlite.org/howtocorrupt.html>
  **Changed the work:** I went looking to confirm the stale-WAL hypothesis and
  found the vendor had already written the exact bullet. P1 was written to test
  it and returned a *different, worse* result than corruption — a silent no-op.

- **SQLite, the WAL-reset bug** — affected range, preconditions, and the
  explicit statement that the occurrence rate is at or below SSD-failure rates.
  <https://www.sqlite.org/wal.html> · <https://sqlite.org/releaselog/3_51_3.html>
  **Changed the work:** it *demoted* a finding. The sub-agent surfaced this as a
  headline; the vendor's own calibration puts it below P1 and P4.

- **GitLab, database incident of 2017-01-31** — 300 GB of production data deleted,
  and *five* backup/replication techniques were in place of which none worked.
  The `pg_dump` cron job produced empty output because of a client/server version
  mismatch, and *an email misconfiguration meant nobody was notified*. Recovery
  came from an ad-hoc snapshot an engineer happened to take six hours earlier.
  <https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/>
  **Directly analogous:** `catch { exported[table] = []; }` is the same failure —
  a backup that succeeds loudly and is empty quietly. GitLab's lesson was not
  "add a sixth method"; it was *a backup nobody has restored from is not a
  backup*, which is why §5's binding is a **round-trip** test and not a
  "backup produces a file" test.

- **Migration testing against empty databases** — *"migrations would pass CI
  tests but fail in production because of the data in the production database"*
  (<https://medium.com/ingeniouslysimple/testing-database-migrations-a1c1b5f38b0e>);
  GitLab's database team requires migrations that can cause incidents to be
  tested against an anonymised production clone
  (<https://gitlab.com/groups/gitlab-org/database-team/-/epics/3>).
  Already acted on — `tests/migrations/golden-fixture.test.ts`, observation #58.

**Where prior art does not exist, and it matters.** No postmortem, CVE, or field
study was found for *MCP-server data loss* or *agent-memory corruption* — the
category is too new. Per charter §7, that is itself a finding: on the
agent-memory-specific questions (what does an agent do when recall silently
returns nothing? does a wrong memory cost more than no memory?) **we are the ones
who will be cited, and confidence should drop accordingly.** Every finding above
was borrowed from ordinary database operations, which is the right default —
but it means D1 has no evidence about the *agent* consequences of its own
failure modes, only the storage ones.

---

## 4 — Target and rejected alternatives

*Written by the lead. Charter §9 forbids delegating this section.*

### T1 — `restore` must either restore or fail loudly *(closes F1, D1-C4, D1-C10)*

Validate the candidate before touching anything: open it read-only, require
`integrity_check = ok` and a readable `schema_meta.version`. Then
`wal_checkpoint(TRUNCATE)`, **close the connection**, delete `memory.db`,
`-wal` and `-shm` together, copy, and put the process into a state where every
subsequent tool call returns "restart required" instead of a result.

- **Rejected — keep the copy and rely on the "please restart" message.** This is
  the status quo and P1 disproves it: the stale WAL is checkpointed back over
  the restored file *by the very close that a restart performs*. The instruction
  the user follows is what destroys the restore. A documentation fix cannot
  reach a silent no-op.
- **Rejected — stage the file as `memory.db.restore-pending` and apply it at next
  startup.** Genuinely defensible, and avoids closing a live handle. It loses
  because it defers the only moment the user is paying attention: success or
  failure would be decided in a later process, printed to a log nobody reads,
  with two files on disk each claiming to be the database. F1's whole cost is
  that the user was never told. Moving the telling further away is the wrong
  direction.
- **Rejected — refuse `restore` entirely and document a manual file swap.**
  Honest, and briefly attractive given how badly the current one fails. It loses
  because the documented corruption remedy (D1-C9) is already *delete
  everything*; removing the recovery tool leaves the product with no recovery
  path at all, which is a worse promise than a fixed one.

### T2 — `backup` must verify what it wrote *(closes F8, D1-C5)*

Check the `wal_checkpoint` return value and fail if `busy`. After writing, open
the copy read-only, run `integrity_check`, count the core tables, and return
those counts in the response. Correct the tool description: it is a checkpoint
plus a file copy, not the native backup API.

- **Rejected — `VACUUM INTO`.** SQLite's own recommendation for live copies, and
  it produces a clean, defragmented file. It loses on the case that matters most:
  `VACUUM INTO` requires a *readable, structurally sound* database, so it cannot
  back up a database that is already corrupt — precisely when a user reaches for
  `backup`. Worth adding later as a second, optional mode; wrong as the only one.
- **Rejected — `db.backup()`, the async better-sqlite3 wrapper over the real
  backup API.** The comment at `database.ts:296-300` says it was tried and
  abandoned because callers `statSync` the path immediately. That is a fixable
  `await`, so the comment is not a sufficient reason — but the corrupt-database
  argument above applies to it too, and it is the same trade for more churn.
- **Rejected — verify by comparing file sizes.** Cheap and useless: F2's empty
  export and F8's short backup both produce plausible sizes. Size is the metric
  that made GitLab's `pg_dump` failure invisible.

### T3 — migrating must be recoverable, not just atomic per step *(closes F6, D1-C1)*

Take an automatic backup before the chain runs, keyed to the from/to versions,
and retain it outside the normal prune count. On any failure, restore it
automatically and report both versions.

- **Rejected — wrap the whole chain in one transaction.** `better-sqlite3` nests
  as savepoints so it would technically work, and it is the obvious answer. It
  loses for a reason a transaction cannot fix: a migration that *succeeds and is
  wrong* is at least as likely as one that throws — this project has already
  shipped one (`superseded_by` written backwards, corrected in V25). A backup
  covers both; a transaction covers only the throwing case. It also forbids the
  table-rebuild and `PRAGMA`-dependent patterns migrations legitimately need.
- **Rejected — write down-migrations.** Twenty-five reversals, each of which
  would be tested exactly as thoroughly as the forward migrations were before
  this month — which is to say, against empty tables. A restore-from-backup is
  one code path that covers all twenty-five.
- **Rejected — do nothing, on the grounds that migrations are already
  per-step atomic.** P3 is the answer: v22 is a state no release ever shipped,
  and the next start resumes the chain into it.

### T4 — refuse a database from the future *(closes F7, D1-C12)*

If `schema_meta.version` exceeds this build's highest migration, refuse to open
it. Report both versions and the upgrade command.

- **Rejected — open read-only and degrade.** An agent that can recall but cannot
  record is the confident-wrong-answer shape this whole review is organised
  around: the next session reads memory that silently stopped being updated. A
  hard error costs one confused minute; this costs a wrong decision later.
- **Rejected — attempt the migrations anyway.** Status quo, and P4 shows it is
  not even a decision — the filter simply returns empty and the code says
  "already up to date."

### T5 — `export` must be complete or say what it skipped *(closes F2, F3, D1-C3)*

Derive the table list from `sqlite_master` rather than a literal. A read failure
aborts the export with the table named; it never writes `[]`. Keep a small,
justified deny-list (`tool_call_log`, `snapshot_cache`) in one place with a
comment per entry.

- **Rejected — keep the curated list and just add the missing tables.** The
  smallest change, and wrong for a reason this project measured six days ago:
  the golden-fixture sanitiser carried a hand-written list of "18 text columns
  that matter", missed `snapshot_cache.value`, and would have shipped an absolute
  path into the repository (observation #58). A curated list is right when
  written and silently wrong when a table is added. Same artifact, same failure.
- **Rejected — export the SQLite file instead of JSON.** `backup` already does
  that and is the better answer for whole-store portability. Export's distinct
  job is being readable and mergeable, which a `.db` is not.

### T6 — `import` must stop previewing what it will not do *(closes F4, F5, D1-C11)*

Two steps, in this order. First, immediately: the dry run reports only what the
run will actually insert. That is a few lines and it stops the lie. Then:
implement the remaining three tables inside one transaction, with id remapping
instead of `INSERT OR IGNORE` on the source id, reporting rows landed rather
than calls that did not throw.

- **Rejected — implement all four tables first and leave the preview alone
  meanwhile.** Leaves F4 live for however long the work takes, on a path users
  reach for during recovery. Order matters more than completeness here.
- **Rejected — delete `import`.** An export you cannot import is a diary, not a
  backup, and D1-C9's remedy depends on it.

### T7 — bump SQLite past the WAL-reset fix *(closes F9, D1-C13)*

`better-sqlite3` 12.6.2 ships SQLite 3.51.2. Move to a release bundling ≥ 3.51.3
(12.10.0 bundles 3.53.1; 13.0.2 bundles 3.53.4) and add a check that fails if the
bundled `sqlite_version()` ever regresses below 3.51.3.

- **Rejected — pin and document the risk.** The vendor says upgrade, the fix is a
  lockfile change, and Engram runs the exact multi-connection precondition
  across 14 IDE integrations. There is no cost to weigh against.
- **Rejected — treat it as urgent and ship ahead of the master plan.** Decision
  #19 holds: no release until the master plan exists, and SQLite's own
  assessment is that this *"is not an emergency."* It goes in the queue, not
  around it.

---

## 5 — Binding

Charter §2: the source of truth must be coupled to something that breaks a build.
"Be careful" is not a binding.

| Target | Mechanism | State |
|---|---|---|
| T1 | **`tests/durability/backup-restore.test.ts`** — a full round trip against a real WAL-mode file with the connection open: write, backup, mutate, restore, close, reopen, assert the mutation is gone. This is the test that does not exist and would have caught F1 | **Built this session** |
| T3 | `tests/migrations/golden-fixture.test.ts` — pinned counts, real data, CI-gated. Extend with a mid-chain-failure case asserting the backup is restored | Exists; extension is a task |
| T4 | A test asserting a future `schema_meta.version` throws | Task |
| T5 | A test asserting the exported table list equals `sqlite_master` minus the named deny-list. **Adding a table to the schema then fails CI until someone decides whether it is exportable** — the property that makes this survive, per charter §2 | Task |
| T7 | A check that `sqlite_version()` ≥ 3.51.3, run in CI | Task |
| D1-C3, C5 | `docs/CAPABILITY-SURFACE.md` gates the action surface; it does **not** gate prose claims in README or tool descriptions. Those three false claims were found by reading, not by a gate. **Naming this gap rather than papering over it:** claim-text drift has no binding today, and inventing one belongs to domain 9 | Gap, handed to D9 |

---

## 6 — Kill switch

Written before attachment forms (Trellis §17).

- **T3 reverses** if the pre-migration backup pushes `.engram/` beyond roughly
  2× the database size for ordinary projects, or if backup-restore-on-failure
  proves flakier than the failure it guards. Fallback: keep the backup, drop the
  automatic restore, and print the path.
- **T4 reverses** if it blocks more real users than it protects — measured by
  issue reports of legitimately mixed-version setups. Fallback: a loud warning
  plus read-only, which is T4's own rejected alternative, adopted on evidence.
- **T1's round-trip test reverses** if it proves platform-dependent enough to be
  routinely skipped. A skipped gate is worse than none, because it looks like
  coverage. Fallback: run it on one platform in CI and say which.
- **The whole domain's premise reverses** if the baseline experiment (charter §10)
  fires R3 — if recall turns out not to change outcomes, durability of that
  recall is not worth this machinery, and the target list shrinks to
  "don't corrupt the file."

---

## Handed to other domains

Per charter §8, cross-domain items go to the owner rather than being solved twice.

- **Domain 3 (Storage & Retrieval)** — `fts_file_notes` is declared
  `content='file_notes'` with **no triggers of any kind**; 94 file notes are
  unsearchable and every query falls through silently. Proof and the
  `COUNT(*)`-vs-`MATCH` trap are in observation #62. Also: timestamps are stored
  inconsistently (`handoffs.created_at` is epoch ms, everything else is ISO text)
  — observation #56.
- **Domain 3 + Domain 6** — `compact` with `dry_run:false` cannot compact: the
  dispatcher passes 2 arguments to a 3-parameter signature whose third defaults
  to `true`, and the tool reports work it did not do. Observation #62.
- **Domain 2 (Trust & Safety)** — `restore` and `import` accept arbitrary paths
  with no shape validation.
- **Domain 3 (records cannot be corrected)** and **Domain 9 (claim-text drift has
  no gate)**, as above.
