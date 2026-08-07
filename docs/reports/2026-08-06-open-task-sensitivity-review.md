# Open-task sensitivity review — all 71 open tasks

**Date:** 2026-08-06 · **Status:** Point-in-time analysis, not a status-bearing register
**Author:** session 43 (`claude-opus-5`) · **Branch:** `v2-foundations` @ `8609d62`
**Source:** `.engram/memory.db` (copy, per charter §11b.3), read directly. Not generated — do not regenerate; supersede it with a newer dated report.
**Scope:** every task whose status is not `done` — 71 rows, from a store holding 97.

> This is a *judgement* document. Every task's sensitivity below is my reading, not a
> stored field. The board has no sensitivity column, which is part of the finding.

---

## 1 — What "sensitivity" means here, in simple words

Priority already answers *"how much does this matter?"* It does **not** answer *"how much
damage does a careless hand do?"* Those come apart badly on this board: task #7 is `high`
priority and completely safe, and task #47 is `high` priority and can wreck a stranger's
editor config.

So sensitivity here means one thing only:

> **If someone does this task badly, how far does the harm reach, and can it be undone?**

Four bands. Plain words, no jargon:

| Band | Plain meaning | Undo story |
|---|---|---|
| 🔴 **S4 — reaches strangers** | Publishing, the public security policy, or writing/deleting files on a user's machine that Engram does not own | **You cannot recall it.** npm has no true unpublish; a clobbered config is gone |
| 🟠 **S3 — can lose the memory** | Migrations, write paths, backup/restore/import, the SQLite engine itself | Only from a backup — and backup is itself one of these tasks (#29) |
| 🟡 **S2 — breaks what others read** | Tool schemas, response shapes, replayed session context, the HTTP API, plans that direct other agents | Revert the commit. Data survives; callers and agents break meanwhile |
| 🟢 **S1 — stays inside** | Tests, measurements, generated artifacts, dead code, internal cleanups | Revert the commit. Nothing else notices |

**The count:** 🔴 8 · 🟠 20 · 🟡 30 · 🟢 13.

Two things fall out of that split immediately, and both are recommendations before any
individual task:

1. **Only 8 tasks can hurt anyone outside this repo — and 4 of those 8 are one act:
   publishing Release A.** The board looks frightening and mostly is not.
2. **The 13 🟢 tasks are free.** They cost review time and nothing else. Several of them
   (#7, #83, #97) are prerequisites for 🟠 and 🔴 work, which is the argument for doing
   them first rather than last.

---

## 2 — What I checked before trusting the board

`CLAUDE.md` says rows read `backlog` for work that already shipped, so verify against the
tree first. I did. Six things came back, and they change how you should read the board.

| # | Finding | Grade |
|---|---|---|
| B1 | **Release A really is sitting there.** `git log -1 release/1.13.0` → `c4fac06 release: v1.13.0 — gates on the published line, corrected policy, honest version`. Do not rebuild it | **PROVEN** |
| B2 | **The security-policy fix really is sitting there too.** `git log -1 fix/d10-security-policy-corrections` → `1ffe9bc docs(security): correct three false claims…`. Task #84's warning holds | **PROVEN** |
| B3 | **Task #79 is stale — its gate is already green.** `npx -y knip@5 --no-progress` → **exit 0** on this branch. `knip.json` carries the 15-file ignore list and the demoted rules. #79 says "make it green"; it *is* green. Close #79; #82 already carries the remaining debt | **PROVEN** |
| B4 | **Two open tasks have no description at all.** `#95` and `#96` have `description IS NULL` — not empty, NULL. Both have 190- and 164-character titles and intact tags. That is exactly convention #7 / task #77's signature: the long free-text field was swallowed and the column landed empty | **PROVEN** |
| B5 | **19 task rows carry the transport-corruption signature in their description text** (`#35, 57–67, 74–79, 91`, plus `#63` which is done). The text is readable; the *record* is damaged, and per #77 some sibling columns are NULL | **PROVEN** |
| B6 | **The only dated commitment on the project has no open row and no scheduled event.** Master plan §4.4 sets the advisory clock to **2026-09-16**; §7 item 3 assigns it to **task #87** — and #87 is `done`. `scheduled_events` is empty. Handoff #16 calls it "the one dated commitment on the board" and it is not on the board | **PROVEN** |

**B4 and B6 are the two I would act on today.** B4 because a task with a NULL description
is a task the next agent cannot execute — the title is all that survives, and for #96
("2.0.0 must edit the N3 DEFECT pin") the *title alone* happens to carry enough, which is
luck. B6 because a deadline nobody is tracking is how the tripwire fails in exactly the way
§4.4 was written to prevent.

---

## 3 — 🔴 S4 — the eight that reach strangers (8 tasks)

These are the only tasks on the board that can hurt someone who never asked to be involved.
**Seven of the eight are not yours to finish** — they end in a publish, and publishing is
the maintainer's.

| # | Task | Pri | Why it's sensitive, plainly | Recommendation |
|---|---|---|---|---|
| **49** | Release A — publish `1.13.0` | crit · **in progress** | It is built and verified; the only steps left are `npm publish` and pushing `main`. npm has no real unpublish, and the push fires the disclosure tripwire | **Do not touch the branch.** This is a human decision and it is the single highest-value act on the board — four live hazards ship with it |
| **46** | Installer clobbers another product's config | crit · blocked on #49 | The code fix is done on this branch. The hazard is **live on published v1.12.0** — a JSON parse failure wipes another product's entire user state | Leave blocked. It closes when #49 ships. Do not re-fix it, and do not re-add the backup the master plan's old wording asks for — that fix was rejected |
| **84** | Remove false network-access denial from `main`'s SECURITY.md | crit | The published policy tells users Engram makes no network calls. It makes three. People make trust decisions on that sentence | Merge `1ffe9bc` into `main` and push. **Verify the branch first** (B2) — do not rebuild it |
| **47** | Verify-and-heal the config entry; complete the uninstall | high | Engram would start **rewriting a file it does not own**, on a schedule the host app also writes to, and uninstall would start deleting. The worst-case here is #46 again with a self-healing loop | Ship the *heal* half only after #46 is published. Make repair preserve user edits inside the entry, never replace the entry. Uninstall should list what it will remove before removing it |
| **48** | Publish from CI with a manifest gate | high | Handles the npm token and decides what is trusted as a real build. Getting this wrong hands out a signing story that is false — and `dist.signatures` already *looks* like proof and is not | Do it, but after Release A. Do not let "npm audit signatures passes" reach any document as evidence of provenance |
| **86** | Generate and gate the npm tarball manifest | high | Decides what lands on every user's disk. Today it is an unchecked side effect of `files:["dist/"]` — 367 entries including 4,057 lines of dead code | Pair it with #48. Generate + `--check`, following the pattern already proven three times. Low risk to build, high leverage over 🔴 work forever after |
| **85** | Make the vulnerability reporting channel provably live | high | If the channel is dead, a real report goes nowhere and you find out from a blog post. Also puts a working contact address on the public record | Cheap and worth doing before the advisory clock (B6). Actually *send* a test report through the channel — a channel that has never been used is not known to work |
| **88** | Say on the public surface that this is one person | med | SECURITY.md's "we", its 48h/7d/30d SLA and its acknowledgements section promise an organisation's capacity. Overpromising response time to a security reporter is the harm | Do it in the same pass as #42/#84. One honest paragraph. Do not add governance text — the domain already rejected that, with Rust's 2021 moderation resignation as the evidence |

**The one recommendation for this whole band:** #49 first, alone, then #84. Everything else
in 🔴 sits behind them or gets easier once the published line is not carrying live hazards.

---

## 4 — 🟠 S3 — the twenty that can lose the memory (20 tasks)

These touch the database, the write paths, or the engine underneath. A mistake here is not
a revert — it is a restore, and #29 says restore is not yet trustworthy.

### 4.1 The five I would hold to the highest bar

| # | Task | Pri | Why it's sensitive, plainly | Recommendation |
|---|---|---|---|---|
| **30** | Pre-migration backup, auto-restored on chain failure | high | **This is the most dangerous single change on the board.** You are building something that *overwrites the user's database automatically*. A false trigger destroys a healthy store to recover from nothing | Build the backup half first and ship it alone. Make auto-restore opt-in, loud, and gated on an integrity check of both files. Never restore silently |
| **33** | Import: honest dry run first, then implement | crit | Import writes into a *populated* store during recovery — the moment the user is least able to absorb a second failure. Today it previews four tables and inserts one | Do the two halves in the stated order and **commit them separately**. The dry-run correction is a few lines and stops the lie today; the id-remapping rewrite is the risky part and should not ride along with it |
| **77** | Reject malformed records on write | crit | A validator that false-positives **refuses a correct write**. Corrupt text is recoverable; a write that never happened is not. 31 records have already lost 34 fields, so the need is real | Ship it with the kill switch the task already names: one false rejection → revert immediately. Land #91's `update_observation` **first**, so there is a repair path before you start rejecting |
| **80** | Route dispatcher SQL through `repositories/` | high | 99 raw statements moved off the live product path. This is the largest regression surface on the board and it delivers no user-visible value on the day it lands | **Ratchet, do not rewrite.** New code must use repositories; existing statements move one dispatcher action per commit, each with its own test. Do not attempt this before #7 exists |
| **34** | Bump `better-sqlite3` past the WAL fix | crit | Swaps the storage engine and a native module under everyone's existing data; 13.x is a native ABI major | Keep it on Release B where the plan already put it. Do not let its `critical` priority pull it into a patch release — SQLite's own text says this is not an emergency |

### 4.2 The rest of the band

| # | Task | Pri | Why it's sensitive, plainly | Recommendation |
|---|---|---|---|---|
| **38** | Server-resolved provenance on every row | crit | Migration across many tables plus every write site. Provenance that is *wrong* is worse than absent — it makes false attribution authoritative | Do it, in the plan's slot (item 5). Never accept the agent's self-reported name; that is the attack |
| **58** | Attribution must come from the caller | crit | Same root as #38 and #12. A lead agent currently loses credit to its own children 100% of the time | Fold #12, #38 and #58 into **one** piece of work. Three rows, one defect, one migration — doing them separately means touching every write site three times |
| **12** | Residual half of N3a | high | The overlap above | Merge into #58 and close the row, or say in the row why it is separate |
| **59** | One migrator at a time | crit | Two servers cold-starting on a fresh project kills one. The fix is a lock around the whole chain — **and a lock done wrong hangs every start, for everyone** | Do it — it is the converged answer (Rails #22092), not an invention. Test the *contended* path explicitly, with a timeout, before shipping |
| **64** | Freshness must not be laundered by a partial write | crit | Today a write that never read the file marks the notes fresh, and rule AR-02 then tells the next agent **not to open the real file**. It actively suppresses ground truth | Highest-value 🟠 fix after #77. The pinned test must flip to `stale` in the same commit. Honour the stated kill switch: if `stale` becomes the usual answer, delete the feature rather than tune it |
| **35** | `fts_file_notes` has no triggers | crit | Adding triggers rewrites index state for 96 rows; get it wrong with soft deletes and search starts resurrecting deleted notes | Do it with #64 (both are storage). Read the warning in the row first — the obvious row-count check is **vacuous** and will tell you it is healthy |
| **41** | Normalise and cap text at write | high | Stripping characters at write time silently mangles content the user meant to store | Strip only the invisible classes named (TAG block, bidi, zero-width). Log every strip. Cap by rejecting, not truncating — a truncated record is a lie |
| **40** | Trust tier gates the session-start replay | crit · blocked on #38 | Decides what every future agent is *allowed to believe*. Too loose and poisoned text keeps replaying; too tight and agents lose their memory | Keep it blocked. Do not attempt a "this is data, not instructions" preamble — twelve published defences, most above 90% attack success |
| **65** | Two null coercions in one upsert | high | Fixing it changes whether fields can be *cleared*. Pick wrong and callers start nulling data that used to be preserved | Decide the intended semantics first and write it down, then make both groups match. Cheap fix, easy to get backwards |
| **91** | `update_observation` + reject malformed writes | high | The repair path for records that are currently **permanently corrupt** | Split it: ship `update_observation` alone and early — it is additive and safe. The rejection half is #77 |
| **31** | Refuse to open a database from the future | high | A wrong version check **locks the user out of their own memory** | Fail closed but read-only, not shut. Report both versions and how to fix. Do not exit silently |
| **29** | Backup must verify what it wrote | high | Backup is the undo button for every other 🟠 task on this list. It currently discards the checkpoint result | Do this **before** #30 or #33. Verify by reopening the copy and counting rows — not by checking the file exists |
| **10** | Three nullable FK columns + `reconcile` | med | A schema migration, and migrations race (#59) | Safe as designed — nullable, additive, nothing mandatory. Sequence it behind #59 |
| **66** | Delete `deleted_at` | med | Dropping columns in SQLite is a table rebuild across four tables, to remove something nothing reads | Correct call, low urgency. Do it while you are already in a migration for #38 rather than as its own risk |
| **76** | The `enforced` column enforces nothing | high | Making it genuinely enforce would start **rejecting writes** across the board | **Rename it, do not wire it.** Renaming is 🟢; enforcing is 🟠 and nobody asked for it. If you enforce, say so in the row and re-grade the task |

---

## 5 — 🟡 S2 — the thirty that break what others read (30 tasks)

Data survives. Callers, agents and readers break instead. Almost all of these are fine
to do — the recommendation is usually about *sequencing* and *announcing*, not about care.

| # | Task | Pri | Why it's sensitive, plainly | Recommendation |
|---|---|---|---|---|
| **52** | Unify the MCP response envelope | high | Breaks the dashboard and both thin clients at once. The most contract-breaking item here | Release B only. Keep the actionable prose — it is a genuine strength — and add a stable code beside it |
| **71** | Per-action schemas (79 params for actions that take one) | crit | Changes the advertised MCP schema every consumer reads | Blocked on #83 per D14 — that dependency appears nowhere in D7, so a plan read from D7 alone ships it early. Respect it |
| **68** | Session start costs 59,705 tokens against a documented ~730 | crit | Bounding the payload **removes context agents currently rely on** | Fix the documented number in the same commit as the bound. Do not shrink first and re-measure later |
| **69** | Every CRITICAL agent rule gets a mechanism or is deleted | crit | Deleting a rule replayed into every session changes every future agent's behaviour | Delete AR-01 and promote the git hook that already does its job. 21.1% compliance is not a rule, it is a wish |
| **11** | MASTER PLAN | crit | Other agents execute from it. A wrong line here misdirects whole sessions — it has already described a fix its own domain rejected | Keep it thin. Every definition of done should point at a binding, not prose. Correct in place with a dated note, as §7.0a already does |
| **6** | Port dropped validation, then delete 15 dead files | high | Adding bounds starts **rejecting calls that work today**; deleting removes the only record of what v1.6 dropped | Order is the whole task: port, prove, *then* delete. Never the reverse |
| **44** | Both live dispatchers accept an unbounded limit | high | Same shape — a bound rejects previously-accepted calls | Do it with #6. `LIMIT -1` means unlimited in SQLite, so this is a real denial-of-service on your own process |
| **50** | HTTP `/export` claims "all data", ships 5 of 24 tables | crit | Users download it as a backup. It is filtered, capped at 1000, and stamped with the wrong version | Rename it or complete it — do not leave it called "export". Make truncation visible in the response |
| **51** | `POST /import` returns `ok:true` while writing nothing | high | The dashboard renders success for a write that did not happen | Return 501 today. Implementing staging is the larger job and should not delay the honest answer |
| **32** | Export must be complete or name what it skipped | high | Export cannot destroy anything — but it is what #33's import restores *from*, so an export missing 16 tables is a backup that silently is not one. A partly-failed export is byte-identical to a complete one | Derive the table list from `sqlite_master` so new tables are included by default. Do it **before** #33 — there is no point making import honest about data export never captured |
| **56** | HTTP error paths leak internals | high | Express in dev mode returns **HTML stack traces to the client**, and `serverError` echoes raw messages across 41 sites | Safe, additive, do it soon. Add the 4-arg middleware and set NODE_ENV |
| **43** | HTTP mode hardening | med | A Host/Origin allow-list can lock out a working dashboard setup | Do the constant-time compare and the token-out-of-URL first (pure wins); allow-list with a documented override |
| **39** | Delete the false sensitive-data claims | crit | The claim is agent-facing — an AI reads it before deciding what to lock. Users change behaviour on a feature that never runs | Delete the three texts now. Whether the code gets wired or removed is D4's call, not this task's |
| **42** | Correct 19 drifted security claims | high | Public-surface text; 19 of 32 claims wrong or incomplete | Do the text on this line, ship with the next release. #84 is the published half |
| **94** | Public-surface binding is blind to version ranges | high | The binding passed while the sentence named the wrong version — a user on `latest` concluded they were unaffected | Extend the binding to assert version ranges, and treat this as evidence for #97 |
| **57** | STATE.md has no binding | high | The register every agent reads first is coupled to nothing | Real fix is #74. Keep both rows only if they say different things — otherwise merge |
| **74** | STATE.md gets a real gate | high | A git hook that blocks commits is friction every future session pays | Prefer "stops claiming currency it cannot have" over a blocking hook. A header line stating *generated at commit X* costs nothing and cannot be stale |
| **28** | FR-0g agent-orientation register | high | Defines how every future agent orients | Largely delivered by STATE.md + handoffs; re-read the row against the tree before sizing it |
| **73** | Session start re-sends what the agent already has | high | Removes content from the auto-load path | The mechanism already exists for the catalog and was never applied to rules. Reuse it — do not invent a second one |
| **92** | `nano` returns ~5,000 chars, not ~10 tokens | med | The tool description is what an agent reads to pick a parameter. Wrong by two orders of magnitude | Fix the number or fix the tier. Cheap, and it removes a live trap |
| **70** | Dispatcher self-description omits 8 actions | med | An omitted action may never be discovered by an agent that does not call `engram_find` | Generate from the enum. 🟢-adjacent; do it opportunistically |
| **72** | `update_task` advertises `owner`, there is no owner column | med | Setting an "owner" silently takes an **atomic claim lock** the caller did not know about — and per #61 that lock is unreclaimable | Rename to `claimed_by`. Do not add an owner column to justify the parameter |
| **60** | File coordination must refuse or be deleted | high | README advertises locks that do not exist on the live surface, and what survived is not a lock | **Delete and correct the README.** A lock that does not lock is worse than none |
| **61** | A crashed agent's claim is unreclaimable | high | Fixing it wrong releases a *live* agent's claim → two agents on one task | Fix registration and the `working` status first, then reclaim on a generous timeout. Prove the negative case |
| **62** | `agent_name` is self-asserted | med | Two agents with one name retire each other's sessions | Already handed to D2 per §8. Keep it as a pointer, not a second implementation |
| **67** | `_` treated as a LIKE wildcard; TTL unenforced | high | Returns decisions about a *different file* and the caller cannot tell | Escape the LIKE — pure win. Enforcing TTL invalidates caches; do it separately |
| **54** | Ratchet the 154 swallowing catch blocks | med | Turning silent tolerance into real failures can kill startup paths (#59 is exactly that shape) | **Ratchet new code only.** Fix the 68 accidental ones by hand, in small batches. Never a bulk rewrite |
| **90** | Log recall events as they happen | high | New telemetry that records *what was returned* — that is stored content going to a second place | Do it, it unblocks the whole §10 experiment. Record identifiers and sizes, not payloads |
| **96** | 2.0.0 must edit the N3 defect pin | high | Edits a pinned test on the release line during Release B | **Its description is NULL (B4).** Rewrite the row before anyone plans against it |
| **89** | Charter §10.4 — define recall to include re-exports | high | Definitional; both suppression arms already leaked | Cheap, and the honesty of the experiment depends on it |

---

## 6 — 🟢 S1 — the thirteen that stay inside (13 tasks)

Tests, measurements, generated artifacts, dead code. **These are free.** Nothing outside
the repo notices, and several unblock work that is not free.

| # | Task | Pri | Note | Recommendation |
|---|---|---|---|---|
| **7** | Migration upgrade-path test (data survives v1 → v24) | high | Every suite builds a fresh empty DB, so no backfill or idempotency guard is ever exercised | **Do this first.** It is the safety net under #10, #30, #34, #38 and #66 — five 🟠 tasks are betting on a test that does not exist |
| **83** | `packages/*` receive no static analysis | high | They are outside the analysis entirely — not suppressed, outside | Do it. It gates #71 |
| **97** | Re-tamper every binding with verbatim original text | med | The only item on the board that asks whether the review's own machinery works | Cheap, and #94 is a second instance of the same blindness. Do it before trusting any binding in a 🔴 decision |
| **75** | Capability surface must render parameter descriptions | crit | The gate is blind to exactly the defect FR-D7 found | Generator change only. Expect artifact churn in the diff; that is the point |
| **82** | Triage knip's 22 unused exports / 28 types | med | The debt created when the gate was made green | Now the honest follow-up to B3 |
| **79** | Make the knip gate green | high | **Already green — PROVEN, exit 0 (B3)** | Close the row |
| **81** | Generate the file census | med | Six of ten hand-typed numbers were wrong | Generate it. Same shape as the count deletions in `docs/README.md` |
| **8** | Action-catalog distinctness test | high | Measurement; the cheapest high-value experiment identified | Run it. It informs #71 |
| **55** | Inert error classes and helpers | med | Tests test an error hierarchy production never uses | Delete, unless #52 wires them. Do not keep both options open |
| **78** | Session-end stats count by event | med | `tasks.session_id` is stamped once at creation, so cross-session closes report zero | Straightforward |
| **53** | Document `ENGRAM_LOG_LEVEL`; add opt-in log file | med | The only diagnosis knob is undocumented | Do it — but make sure the log file cannot capture stored memory content. That would quietly turn 🟢 into 🔴 |
| **27** | Does the "must be object" transport bug still reproduce? | med | Investigation only | Time-box it. If it does not reproduce in an hour, record that and close |
| **95** | knip is still CI-only — decide, or accept in writing | med | **Description is NULL (B4)** | The decision is small; the row is unusable. Rewrite it, then decide |

Two rows sit on the 🟢/🟡 line and are counted in §5 rather than here: **#70** (generated
self-description — the work is contained, but the output is what an agent reads) and
**#89** (a charter definition — contained, but it governs the experiment's honesty).

---

## 7 — What I would actually do, and why

The master plan's §7 sequencing is sound and I am not replacing it. Four deltas, each with
its reason:

1. **#49 (publish Release A) stays first, alone.** Four live hazards, including #46's
   config clobber, are on users' machines right now. Nothing else on this board reaches a
   user. *Not mine to do — flagged, not attempted.*
2. **Insert #7 before any 🟠 task.** The plan sequences five migrations and write-path
   changes on top of a test suite that has never migrated a database containing data.
   That is the cheapest risk reduction available and it is currently unscheduled.
3. **Split #91 and put `update_observation` before #77.** The plan pairs them at item 4.
   Shipping rejection before a repair path means the first false rejection has no
   remedy — and 31 records are already unrepairable.
4. **Put the 2026-09-16 clock back on the board (B6).** It has no open task and no
   scheduled event. Either create a row or schedule the event; §4.4's entire purpose is to
   stop silence being a default, and right now it is one.

Two board-hygiene items that cost minutes: close **#79** (B3, proven green) and rewrite
**#95 / #96** (B4, NULL descriptions).

---

## 8 — What I could not verify

Stated plainly rather than omitted, per `CLAUDE.md`.

- **I did not re-verify the technical claim inside any task.** All 71 sensitivity ratings
  are my judgement applied to the row's *stated* claim. The rows themselves carry PROVEN
  and VERIFIED grades from their own sessions; I re-checked none of them. Grade every
  claim in §§3–6 as **REPORTED** unless it appears in §2, which is PROVEN.
- **I did not read the source for any file named in a task.** Per `CLAUDE.md` I did not
  re-read the codebase; I also did not pull file notes, because sensitivity is a property
  of the change, not of the current code.
- **#79's green is proven on `v2-foundations` only.** I did not run knip against `main`.
- **B5's 19 corrupted rows** are identified by signature match on `description`. I did not
  check which sibling columns are NULL in each — #77's measurement script does that.
- **I did not verify that #46's code fix is absent from `main`,** only that the branches in
  B1 and B2 exist at the claimed commits. Session 41 and the FR-Phase2-Item0 run both read
  both trees; that claim remains theirs.
- **Prism markers are not applied to this document.** It is a dated report, not a spec; say
  the word and I will retrofit it.
