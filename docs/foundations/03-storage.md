# Domain 3 — Storage & Retrieval

**Charter:** [`00-CHARTER.md`](00-CHARTER.md) · **Owns:** *"can we get it back, and is it the right thing"*
**Status lives in the Engram task board.** `FR-D3` tasks, not here.

> **The one-line finding.** Engram's freshness signal can be **refreshed by a write
> that did not read the file.** A one-field drive-by flips a correctly-`stale` note
> to `confidence: "high"` while leaving another agent's now-false summary in place —
> and agent rule AR-02 then instructs the next agent *not* to open the file. The
> unsearchable-file-notes defect that seeded this domain (task #35) is real, proven,
> and **the less dangerous of the two.**

> **Method note.** Reviewed **serially and un-delegated**, for the reason in
> [handoff #7](../STATE.md): records written while a sub-agent session is open are
> stamped with the wrong session (task #58, deterministic). Every grade below is
> **PROVEN** or **VERIFIED**; there is no REPORTED tier in this document.
> All harnesses ran against a **temp copy** of `memory.db` under a temp project
> root, never the live store (charter §11b.3), and a verified backup was taken
> first — the first use of `engram_admin(backup)` in this project's history.

---

## 1 — Claims

Inventoried from README, tool descriptions, the agent rules replayed at every
session start, and the schema. Agent rules count as claims in the strongest
sense: they are instructions an agent *follows*, not prose it reads.

| ID | Claim | Source |
|---|---|---|
| D3-C1 | "`search` — **FTS5-ranked full-text search across all memory.** Results include `confidence`" | README:969 |
| D3-C2 | "All context is **FTS5-ranked** around the `focus` topic — the most relevant memory surfaces first" | README:123 |
| D3-C3 | Architecture diagram names a component: **"FTS5 Search Index"** | README:885 |
| D3-C4 | "An AI agent should only need to **deeply review a file once**" | README:62 |
| D3-C5 | "a **SQLite database** — one per project — that stores **all agent memory**" | README:276 |
| D3-C6 | "`get_file_notes` — Read stored notes for a file. **Includes staleness confidence**" | `find.ts:15` |
| D3-C7 | **AR-02:** "call `get_file_notes` before opening any file. **Open only if notes are absent or stale**" | agent rules, priority CRITICAL |
| D3-C8 | **AR-06:** "call `set_file_notes` with `executive_summary` … 2-3 sentences **for fast future reads**" | agent rules, priority HIGH |
| D3-C9 | A note's freshness verdict reflects whether **its stored content** is still current | *implied by D3-C6 + D3-C7* |
| D3-C10 | A field, once written, can be **corrected** | *implied — every store permits it* |
| D3-C11 | `deleted_at` on four tables means deleted rows **stop being returned** | schema V-soft-delete *(implied)* |
| D3-C12 | `snapshot_cache.ttl_minutes` **bounds** how stale a cached snapshot may be | schema + `SnapshotRepo.upsert` *(implied)* |
| D3-C13 | `get_decisions(file_path:…)` returns decisions affecting **that file** | `decisions.getByFile` *(implied)* |
| D3-C14 | A `limit` parameter **bounds** the response | *implied by the parameter existing* |
| D3-C15 | What one agent writes, another agent **can find** | the premise of the domain *(implied)* |

---

## 2 — Reality

Grades per charter §5. Executable checks quoted in §3.

| ID | Grade | Reality |
|---|---|---|
| **D3-C9** | **PROVEN — FALSE** | **The headline.** Freshness is computed from `file_mtime` vs the file on disk (`intelligence.ts:296-303`), which is a sound design. But `set_file_notes` **re-stats the file unconditionally on every write** (`dispatcher-memory.ts:367-368`), regardless of which fields the agent supplied. A one-field write therefore refreshes `file_mtime` and `content_hash` — the sole inputs to the verdict — while `COALESCE` preserves every field the writer omitted. Measured: `stale (72h drift)` → `high`, with the false summary untouched. See §3 F1. |
| **D3-C7** | **PROVEN — actively harmful under D3-C9** | AR-02 is CRITICAL priority and gates whether the agent reads the real file. Because D3-C9 is false, the rule converts a wrong freshness signal directly into *"do not open the file."* The rule is only as good as the signal, and the signal can be forged by accident. |
| **D3-C1** | **PROVEN — FALSE** | Not "across all memory." `fts_file_notes` has **no triggers and no writer anywhere in `src/`** — grep finds only two readers (`intelligence.ts:200`, `dispatcher-memory.ts:735`). Its inverted index has never been populated. `fts_file_notes_data` holds **2 rows** (the fts5 empty-table baseline) against 9–45 for every populated shadow. `MATCH 'the'` → **0 hits** while 70 of 96 base rows contain it. File notes — the largest single category, 96 rows — are unsearchable, silently. |
| **D3-C3** | **VERIFIED — partially inert** | Seven of eight FTS tables work. `file_notes`, the one the product's premise rests on, is the exception. |
| **D3-C15** | **PROVEN — FALSE for file notes** | The union of what agent A writes and what agent B can find excludes file notes entirely via MCP `search`. |
| **D3-C4** | **VERIFIED — FALSE in both directions** | The note cannot be *found* (D3-C1) and, once found, may be wrong while reading as fresh (D3-C9). The claim is the product's premise. |
| **D3-C8** | **VERIFIED — FALSE** | `executive_summary` is **not in the indexed column list** — `fts_file_notes` covers `file_path, purpose, notes` only. The field an agent rule mandates for "fast future reads" is excluded from the only ranked search path. Restoring the triggers alone does **not** fix this. |
| **D3-C10** | **PROVEN — FALSE, inconsistently** | `FileNotesRepo.upsert` uses **two different null coercions in one method**. `purpose`, `notes`, `layer`, `complexity` use `\|\| null` (line 65-67): an empty string collapses to `NULL`, `COALESCE` keeps the old value, **the field can never be cleared.** `executive_summary`, `git_branch`, `content_hash`, `file_mtime` use `?? null` (lines 42-45): they **can** be cleared. Same method, same call shape, opposite behaviour, undocumented. Measured across seven fields: 4 IGNORED, 3 CLEARED. |
| **D3-C11** | **PROVEN — FALSE** | `deleted_at` is added to `decisions`, `file_notes`, `tasks`, `sessions` (`migrations.ts:593-600`) and is **read by nothing and written by nothing** in the entire `src/` tree. Zero readers, zero writers. Soft delete is schema only — the sixth instance of this project's recurring pattern, and the purest: there is not even an unreachable implementation, just the column. |
| **D3-C12** | **PROVEN — FALSE** | `SnapshotRepo.getCached` selects `value, updated_at` and **never reads `ttl_minutes`** and never compares against now. Written on every upsert, enforced nowhere. Measured: an entry stamped `2020-01-01` with `ttl_minutes=5` was returned unchanged. Cache entries are immortal. |
| **D3-C13** | **PROVEN — FALSE, over-matches** | `affected_files LIKE '%path%'` (`decisions.repo.ts:116-119`). The value is bound, so **not injection** — but LIKE metacharacters are unescaped and `_` is a single-character wildcard. `getByFile('src/pocx/file_notes.repo.ts')` returned **both** `file_notes.repo.ts` and `file-notes.repo.ts`. Underscores are pervasive in this codebase's own filenames. It is also a substring match against a JSON array, so any path matches any longer path containing it. |
| **D3-C14** | **PROVEN — FALSE** | Audit N5 / task #44. `limit: z.number().int().optional()` (`dispatcher-memory.ts:249`) — no `.min()`, no `.max()`. SQLite treats `LIMIT -1` as **unlimited**; measured 25 of 25 rows returned. The one guard makes it *worse*: `oversample = Math.min(limit*2, MAX_SEARCH_RESULTS)` evaluates to **-2** for `limit:-1` and **-2000** for `limit:-1000`. `Math.min` cannot clamp a negative. |
| **D3-C2** | **VERIFIED — TRUE where the index exists** | `getActiveFocused` is correctly FTS-ranked with a `getActive` fallback on failure (`decisions.repo.ts:85-100`). |
| **D3-C5** | **VERIFIED — TRUE** | 64 tables, `integrity_check: ok`. Storage itself is sound; retrieval is where this domain fails. |
| **D3-C6** | **VERIFIED — TRUE, mechanically** | A confidence value is returned. Whether it means anything is D3-C9. |

**Correction to inherited material.** Handoff #7 passed down that
`observations.repo.ts search()` has no FTS fallback "unlike decisions/conventions/tasks."
True of the **repo method**, but there is exactly one call site
(`dispatcher-memory.ts:1033`) and it wraps the call in `try/catch` with a
`getRecent` fallback and passes `ftsEscape(query)`. **Downgraded** from the
inherited framing to a latent gap for future callers. Recorded because the
charter's §5 rule cuts both ways: an inherited claim is REPORTED until checked,
including when checking makes it smaller.

**Quoted output — the headline:**

```
STEP 1 — Agent A reviews the file properly and writes a full note.
   confidence       : high
   executive_summary: "A constant-only module exporting VERSION=1. Safe to ignore
                       when tracing behaviour."

STEP 2 — The file is REWRITTEN (now does destructive I/O). Note is factually wrong.
   confidence       : stale (72h drift)      <-- Engram is CORRECT here
   executive_summary: "A constant-only module … Safe to ignore when tracing behaviour."

STEP 3 — Agent B writes ONLY purpose. Never opens the file.
   confidence       : high                   <-- laundered
   purpose          : "Migration helper."
   executive_summary: "A constant-only module … Safe to ignore when tracing behaviour."
```

**Quoted output — the index:**

```
  fts_file_notes       _data rows: 2      <-- fts5 empty-table baseline
  fts_observations     _data rows: 45
  fts_tasks            _data rows: 42

  fts_file_notes       MATCH 'the' ->    0 hits   <-- INDEX EMPTY
  fts_decisions        MATCH 'the' ->   21 hits
  fts_tasks            MATCH 'the' ->   63 hits
  base file_notes rows containing "the": 70
```

---

## 3 — Failure modes

| # | Trigger | Blast radius | Silent? | Recoverable? |
|---|---|---|---|---|
| **F1** | Any partial `set_file_notes` on a file whose content has since changed | Freshness flips `stale`→`high`. The omitted fields keep a **previous author's** now-false description, and AR-02 tells the next agent not to open the file. The wrong answer is served *with a freshness certificate* | **Totally.** The write reports success; the read reports high confidence | No. The prior verdict is not retained anywhere |
| **F2** | Any `set_file_notes`, ever | The note is not added to `fts_file_notes`. `search` cannot return it | **Totally.** Zero results is indistinguishable from "nothing matched" | Yes — `rebuild`, see §4 |
| **F3** | Two agents write one file note | Chimera row: B's `purpose` beside A's `executive_summary`, attributed wholly to B via `last_modified_session`. *(Shared with D4 F1; storage owns the merge semantics)* | Totally | No |
| **F4** | An agent tries to correct a wrong `purpose` by writing `""` | Silently ignored — the wrong value persists. The same call on `executive_summary` succeeds | Totally | Only by writing a non-empty replacement |
| **F5** | `get_decisions(file_path:…)` on any path containing `_` | Returns decisions about **different files**, presented as governing this one | Totally | n/a — the caller cannot tell |
| **F6** | Any caller passes `limit: -1` | Unbounded result set; the whole table serialised into an agent's context. Interacts with FR-D6's response-size work and FR-D7's token budget | Loud only as context exhaustion | Yes |
| **F7** | Snapshot cache warmed once | Served forever regardless of `ttl_minutes` | Totally | Only by overwriting the key |
| **F8** | Anything relies on `deleted_at` | It does nothing. A future "delete" feature built on it would appear to work and delete nothing | Totally | n/a |

**Silence scoring.** Seven of eight are **totally silent**, and F1 is worse than
silent: it emits a *positive* signal of correctness. The domain's characteristic
failure is not "the data is gone." It is **the data is wrong and carries a
freshness certificate** — the charter's framing question in its most literal form.

### 3b — Prior art: how this has gone wrong for other people

**This section changed the ranking of this document.** I began with task #35 (the
empty index) as the headline, because it was inherited as the domain's CRITICAL.
The literature moved it to second.

**1. Freshness signals that lie — the decisive one.**
[STALE: *Can LLM Agents Know When Their Memories Are No Longer Valid?*](https://arxiv.org/html/2605.06527v1)
(arXiv:2605.06527, Chao, Bai, Sheng, Li & Sun) defines exactly F1's shape and
names it: **implicit conflict** — *"a situation where a new observation invalidates
an earlier memory without syntactic negation,"* where *"no later utterance …
explicitly negates, corrects, or marks the obsolescence"* of the prior belief.
Their **Type II (Propagated)** case — a change in one attribute cascading to
invalidate structurally related beliefs — is F1 precisely: `file_mtime` changes,
and it invalidates `executive_summary`, which nothing updates. The headline number
is the argument for ranking this first: **the best evaluated model reaches 55.2%
accuracy at detecting its own invalid memories, and existing memory frameworks
score below 10%.** Agents cannot be relied on to catch this themselves, so a
forged freshness signal is not recoverable downstream by a smarter reader.

**2. Stale-served-as-fresh is a recognised worst quadrant, not an edge case.**
The data-engineering literature is consistent that
[the dangerous case is "fast + stale"](https://tacnode.io/post/data-freshness-vs-latency) —
*"no errors, no timeouts, but every answer is based on outdated information"* — and
that [stale data "looks perfectly normal … dashboards render, no errors"](https://tacnode.io/post/what-is-stale-data).
The specific warning that matches F1: a pipeline **can run successfully and still
produce stale data**, so timestamp-based freshness checks that only verify *a
timestamp exists* rather than *the content actually changed* miss the incident.
Engram's check verifies the timestamp. That is the documented failure.

**3. FTS5 external-content desync is a known, documented footgun — and the obvious
repair is a trap.** The SQLite forum records this class repeatedly:
[rows not searchable with MATCH](https://sqlite.org/forum/forumpost/95090c6d80742d20?t=c),
[corruption from declaring triggers a certain way](https://sqlite.org/forum/info/da59bf102d7a7951740bd01c4942b1119512a86bfa1b11d4f762056c8eb7fc4e),
[external content and trigram desync](https://sqlite.org/forum/info/413819ed723cc007).
Two findings changed the §4 target:
- **`BEFORE` triggers and inserts that omit the rowid cause real corruption**, not
  just staleness. The correct form is `AFTER` triggers plus the special
  `'delete'` command insert. A naive fix copying this repo's `fts_events` trigger
  would use `new.id` — and `file_notes` **has no `id` column**, so it must use
  `new.rowid`. The obvious patch is the corrupting one.
- **[`optimize` does not repair an out-of-sync external-content index](https://sqlite.work/optimizing-fts5-external-content-tables-and-vacuum-interactions/)**,
  and *"users might mistake OPTIMIZE for a data integrity tool."* The repair
  command is `rebuild`. This is the difference between a fix that works and a fix
  that reports success and changes nothing — which would be F2 a second time.

**What this did not confirm.** I searched for prior art justifying the empty-index
defect as the domain headline and did not find it. The literature's consistent
position is the opposite: a search that returns nothing is *loud enough to
redirect the reader*, while a wrong answer wearing a correctness badge is not.
Under charter §10.3's own scale, F2 scores **IRRELEVANT** (consumed context,
changed nothing) and F1 scores **MISLEADING** — the bucket the charter singles out
as the one that matters and nobody measures. The research inverted the ranking I
arrived with, which is the §3b test.

---

## 4 — Target and rejected alternatives

### T1 — A freshness verdict must describe the fields it is a verdict *about*

**Target.** `set_file_notes` refreshes `file_mtime` / `content_hash` **only when the
write supplies the content those fields certify.** A partial write leaves the
verdict alone; the row keeps saying `stale` until someone actually re-reads.

**Rejected — "make the agent pass `file_mtime` explicitly."** Moves a correctness
guarantee onto caller discipline. This project has eight-plus occurrences of a
single tool-call error made by three agents across two models (observations #59,
#80, #86) as evidence that discipline is not a control. Same reason §5 is a
mechanism and not a rule.

**Rejected — "drop the freshness feature."** The feature is *right* and the
STALE result argues it should exist: agents detect their own stale memory at
55.2% at best. A correct staleness signal is worth more here than in a system
with a human reader. The defect is the refresh trigger, not the concept.

**Rejected — "per-field timestamps."** Genuinely correct, and rejected on cost:
it is a schema change across the widest table plus every read path, to solve a
problem that a write-time condition solves. Revisit if T3 lands and per-field
provenance is wanted anyway — noted for **FR-D2**, which owns provenance.

### T2 — `fts_file_notes` gets triggers, `executive_summary`, and a rebuild

**Target.** `AFTER INSERT/UPDATE/DELETE` triggers on `file_notes` using the
external-content `'delete'` command form and **`new.rowid`** (not `new.id` — the
table has none); `executive_summary` added to the indexed columns; a one-time
`INSERT INTO fts_file_notes(fts_file_notes) VALUES('rebuild')` in the migration to
populate the 96 existing rows.

**Rejected — `optimize`.** Documented in §3b as not repairing external-content
desync. It would report success and fix nothing.

**Rejected — "drop external content; make it a contentless or ordinary FTS table."**
Doubles storage for the largest text column set and introduces a second copy that
can itself drift — replacing a desync bug with a duplication bug. External content
is the right shape; it was simply never wired.

**Rejected — "delete the FTS table and let `search` use the LIKE path."** The LIKE
path already exists as the dispatcher's fallback and would work. Rejected because
D3-C1/C2 promise *ranked* retrieval, and rank is what makes a bounded `limit`
return the right rows rather than the first rows — which matters more once T4
bounds it.

### T3 — One coercion rule, and a documented way to clear a field

**Target.** `??` throughout `FileNotesRepo.upsert`; an explicit sentinel (`null`)
clears, an omitted key preserves, `""` is stored as `""`. One rule, stated in the
tool description.

**Rejected — "`||` throughout."** Consistent, and makes every field permanently
uncorrectable. The store is already append-only in practice by accident
(handoff #5: no `update_convention`, no `delete_convention`, decisions not
editable). Standardising on the coercion that *prevents correction* would ratify
the accident as design.

**Rejected — "leave it; document the split."** Documentation is not a binding
(charter §7 §5). It also does not survive the next field being added, where the
author picks a coercion by copy-paste.

### T4 — Bounds that cannot be defeated by sign

**Target.** `limit: z.number().int().min(1).max(MAX).default(20)` at both
dispatchers, and clamp with `Math.max(1, Math.min(n, MAX))`.

**Rejected — "clamp only at the SQL layer."** The bound would live in one place
and be correct, but every existing call site passes `params.limit ?? 20` directly
into a prepared statement; a SQL-layer clamp means auditing all of them. Zod is
the boundary that already exists and already rejects other malformed input.

### T5 — Delete `deleted_at`, or implement it

**Target.** **Delete the four columns.** Nothing reads or writes them.

**Rejected — "implement soft delete."** No feature asks for it. Building a
delete semantic nobody requested, across four tables and every read path, on the
strength of four `ALTER TABLE`s, is how the dead surface got here. If deletion is
wanted it should be designed, not inferred from a column.

**Rejected — "leave it, it is harmless."** It is not: it is a loaded gun for the
next author, who will reasonably assume the reads filter on it. F8.

### T6 — Escape LIKE, or stop using it

**Target.** `getByFile` uses `json_each(affected_files)` with equality — the exact
pattern `getFiltered` already uses one method above it (`decisions.repo.ts:108`).
No escaping needed, no substring semantics, correct by construction.

**Rejected — `ESCAPE '\'` with metacharacter escaping.** Fixes the wildcard but
keeps substring matching, so `src/a.ts` still matches `src/a.ts.bak`. Fixes the
symptom found and leaves the class.

### T7 — TTL enforced or removed

**Target.** `getCached` compares `updated_at + ttl_minutes` against now and returns
`null` when expired.

**Rejected — "drop `ttl_minutes`."** Defensible under T5's logic, and rejected
because unlike `deleted_at` this column has a live **writer** on every upsert, and
a cache with no expiry is a correctness bug rather than dead weight.

---

## 5 — Binding

**[`tests/storage/retrieval-integrity.test.ts`](../../tests/storage/retrieval-integrity.test.ts)**
— builds a real database under a temp root, writes through the real repositories,
and asserts:

1. **FTS parity, per content table, derived from `sqlite_master`.** For every
   `fts_*` table, a row written through its repo is retrievable by `MATCH`. The
   table list is *derived*, not hard-coded, so a new FTS table added without
   triggers fails on the day it is added rather than the day someone searches.
2. **Freshness cannot be laundered.** Write a note, modify the file, partial-write
   one unrelated field, assert the verdict is still `stale`.
3. **Coercion is uniform.** Every nullable text field on `file_notes` behaves
   identically for `""`.
4. **Negative and oversized `limit` are rejected** at the dispatcher boundary.

Per D6/D7 precedent, the currently-failing assertions are **pinned as defects**
— the test asserts today's wrong values with a `DEFECT:` marker naming the task,
so the fix must edit the assertion in the same commit where a human sees it, and
the test never sits green over a known bug.

**Why this and not the alternatives.** A schema-shape assertion ("`file_notes` has
three triggers") would pass against triggers that are present and wrong — exactly
the `BEFORE`-trigger corruption §3b documents. Asserting *retrievability* is
behavioural and cannot be satisfied by a broken trigger. And deriving the table
list from `sqlite_master` is what makes it a binding rather than a test: it fails
on tables nobody remembered to add to it.

---

## 6 — Kill switch

Written before attachment forms.

1. **If T1 makes `stale` the common verdict in practice**, the freshness feature is
   net-negative and should be **removed, not tuned**. A signal that always says
   "stale" is a signal nobody reads, and it would then be a slower way of saying
   "always open the file." Measure before tuning.
2. **If the FTS rebuild in T2 shows `search` over file notes was never load-bearing**
   — the baseline experiment (charter §10) can answer this, since 96 unsearchable
   notes across five completed domains is an accidental natural experiment — then
   **cut `fts_file_notes` entirely** rather than maintain it. Five domain reviews
   completed without it working; that is evidence, and it points away from the
   feature.
3. **If T2's triggers cause any corruption in the golden fixture**, revert to the
   unindexed state immediately. Per §3b, a corrupt FTS index is worse than an empty
   one: the empty one returns nothing, the corrupt one returns wrong rows and
   `integrity_check` will not necessarily say so.

---

<!-- FOUNDATIONS_D3:COMPLETE -->
