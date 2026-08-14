# Domain 6 — Failure & Observability

**Charter:** [`00-CHARTER.md`](00-CHARTER.md) · **Owns:** *"it went wrong — now what"*
**Status lives in the Engram task board.** `FR-D6` tasks, not here.

> **The one-line finding.** This session changed `compact` from a lying no-op into
> real behaviour, rewrote `/health`, restructured the export payload, and turned a
> live endpoint into a 501 — and **all 660 existing tests still passed.** Not one
> noticed. Every diagnostic Engram offers was, in a specific and provable way,
> unable to report the thing it existed to report.

---

## 1 — Claims

50 claims were inventoried across README, SECURITY.md, RELEASE_NOTES, the
constitution, tool descriptions and Zod `.describe()` text. The 30 load-bearing
ones are graded below; the rest are restatements. Tool descriptions count as
claims because an AI agent reads them and changes its behaviour on them.

| ID | Claim | Source |
|---|---|---|
| D6-C1 | "PM errors are always isolated — they never block core Engram operations." | README.md:796 |
| D6-C2 | `pm_status` returns "PM health, detected phase, advisor nudge state, and recent failures" | README.md:1034 |
| D6-C3 | `health` — "Database health check and diagnostics." | README.md:996 |
| D6-C4 | "Logs to `console.error` (never corrupts MCP stdout)" | RELEASE_NOTES.md:318 |
| D6-C5 | "**Never write to stdout.** Logging goes to `console.error` / `src/logger.ts`." | ENGRAM_CONSTITUTION.md:59 |
| D6-C6 | "On-demand database diagnostics: SQLite integrity / Schema version / **FTS5 availability** / WAL mode / row counts / config" | RELEASE_NOTES.md:1864 |
| D6-C7 | `health` returns `"Database is healthy."` | dispatcher-admin.ts:282 |
| D6-C8 | `/health` returns `{ok:true, version, database:"connected"}` | http-server.ts:75 |
| D6-C9 | "Each migration runs in **its own transaction**; a failure rolls back and is retried from scratch next boot." | ENGRAM_CONSTITUTION.md:130 |
| D6-C10 | `dry_run` — "Show what would be compacted without actually doing it" | compaction.ts:23 |
| D6-C11 | compact returns "CompactionResult with counts and freed storage" | compaction.ts:26 |
| D6-C12 | "Dry run. `${n}` session(s) would be removed." | dispatcher-admin.ts:211 |
| D6-C13 | `POST /api/v1/export` — "returns a JSON snapshot of **all data**" | export-import.routes.ts:6 |
| D6-C14 | `POST /api/v1/import` returns `{status:"staged"}` | export-import.routes.ts:39 |
| D6-C15 | HTTP failure envelope is `{ok:false, error:"<code>", message}` | HTTP-SURFACE.md:40 |
| D6-C16 | `error()` returns `isError:true` — every failing action tells the caller it failed | response.ts:42 *(implied)* |
| D6-C17 | `errorWithData()` — errors carry a machine-readable shape | response.ts:52 *(implied)* |
| D6-C18 | `src/errors.ts` — a typed hierarchy with stable `code` fields callers can branch on | errors.ts:71-82 *(implied)* |
| D6-C19 | `ENGRAM_LOG_LEVEL` — log verbosity can be turned up by the user | logger.ts:21 *(implied)* |
| D6-C20 | Leveled `debug/info/warn/error` logging with structured context — logs exist and are findable | logger.ts:27-50 *(implied)* |
| D6-C21 | "Logging never changes behaviour… a telemetry problem can never fail the operation it is measuring." | tool-telemetry.ts:65 |
| D6-C22 | "Best-effort: an audit failure must not block the operation, **but it is logged rather than swallowed silently**." | dispatcher-admin.ts:29 |
| D6-C23 | "Best-effort: never block the main task-complete flow" | event-trigger.service.ts:128 |
| D6-C24 | A safety backup protects destructive ops (`clear`, `compact`, `restore`) | dispatcher-admin.ts:237 *(implied)* |
| D6-C25 | "FTS not available (pre-V23 DB or corrupt index) — degrade gracefully" | conventions.repo.ts:69 |
| D6-C26 | "A leftover cache file is **detected and reported**, not silently ignored" | ENGRAM_CONSTITUTION.md:367 |
| D6-C27 | Errors are actionable prose, not bare codes ("agent_name is required… Pass a stable identifier") | sessions.ts:151 |
| D6-C28 | `import` dry_run — "Preview import without writing (default: true)" | export-import.ts:80 |
| D6-C29 | Config parse failure — "Engram will not overwrite a config it cannot read" | config-writer.ts:191 |
| D6-C30 | The test suite covers Engram's behaviour | *implied by 660 passing tests* |

---

## 2 — Reality

Grades per charter §5. **PROVEN** = executable check, output quoted. **VERIFIED** =
read in source by the lead. **REPORTED** = a sub-agent said so.

| ID | Verdict | Grade | Evidence |
|---|---|---|---|
| D6-C1 | **TRUE** | VERIFIED | `pmSafe` (pm-diagnostics.ts:96-112, 11 call sites) logs to stderr, records the failure, returns the fallback, never rethrows. The counter-example that shows the rest of the codebase could have been built this way. |
| D6-C2 | **PARTLY TRUE** | REPORTED | The failure count is real, but `pm-diagnostics.ts` is reachable only through `pmSafe`'s own tracker; whether any path increments it in production was not established. |
| D6-C3 | **PARTLY TRUE** | PROVEN | It checks four real things and one fake one — see C6. |
| D6-C4 | **TRUE** | PROVEN | Wire probe: 4 stdout lines, **0 non-JSON**; 3267 bytes on stderr, all `[Engram] [INFO] …`. |
| D6-C5 | **TRUE, and unguarded** | PROVEN | 96 `console.log` and 6 `process.stdout.write` exist in `src/` — **all in `src/installer/`**, which `index.ts:115-129` dispatches to and `return`s from *before* the `StdioServerTransport` branch. Correct today. Nothing enforced it until this domain's binding. |
| D6-C6 | **FALSE** | VERIFIED | The "FTS5 availability" check ran `SELECT * FROM decisions LIMIT 1` — the **base table**. It reported `fts: "available"` whenever `decisions` was readable, which is always. FR-D1 established why this cannot work: `fts_*` are external-content tables, so `SELECT`/`COUNT` delegate to the content table and succeed over a destroyed index. **Fixed** (T4). |
| D6-C7 | **FALSE** | VERIFIED | `const healthy = checks.integrity === "ok";` — four of five checks were computed, displayed, then ignored. "Database is healthy." was returnable with the FTS index destroyed and `schema_version` reading 0. **Fixed** (T4). |
| D6-C8 | **FALSE** | VERIFIED | `res.json({ ok: true, version: "1.9.0", database: "connected" })` — **three literals and zero checks.** It reported `connected` with the database closed, and stamped 1.9.0 on a 1.12.0 server. **Fixed** (T4). |
| D6-C9 | **TRUE** | REPORTED | Not re-verified this domain; carried from FR-D1. |
| D6-C10 | **TRUE** | PROVEN | The dry-run path genuinely changes nothing. |
| D6-C11 | **FALSE — the headline** | **PROVEN** | See §2a. Non-zero past-tense counts for work that never ran. **Fixed** (T1). |
| D6-C12 | **FALSE** | VERIFIED | Compaction **never removes a session.** `compactBeforeCutoff` collapses each ended session's change rows into one summary row. The preview described an operation that does not exist. **Fixed** (T1). |
| D6-C13 | **FALSE** | PROVEN | 5 of **24** tables at V25 — omitting `sessions`, `changes`, `observations`. Also filtered (`getActive` drops superseded, `getOpen` drops completed) and capped at 1000 with no signal. Served as `Content-Disposition: attachment`, so a user experiences it as a backup. **Labelling fixed** (T2); completeness is task #50, handed to FR-D1. |
| D6-C14 | **FALSE** | VERIFIED | No repo call, no write, **no row in `import_jobs`** — a table that exists in V25, so "staged" named a real mechanism the handler did not use. **Fixed** (T2, now 501). |
| D6-C15 | **TRUE** | PROVEN | And it is the *good* surface: `NOT_FOUND` 404, `BAD_REQUEST` 400, `SERVER_ERROR` 500, `UNAUTHORIZED` 401. Real machine-readable codes. |
| D6-C16 | **TRUE** | PROVEN | `isError:true` is set on every failure path measured. |
| D6-C17 | **FALSE — inert** | **VERIFIED** | `errorWithData()` has **0 call sites** in `src/` and `tests/`. The only helper that returns a machine-readable error shape is never called. |
| D6-C18 | **FALSE — inert** | **VERIFIED** | All **10** exported classes in `src/errors.ts` have **0 importers in `src/`**, by two independent searches (`errors.js` import, and all ten class names). Only `tests/services/pm-diagnostics.test.ts` imports them. **The tests test a hierarchy production never constructs.** |
| D6-C19 | **TRUE but undiscoverable, and it could disable logging** | **PROVEN** | `ENGRAM_LOG_LEVEL` appears **0 times** in README, SECURITY.md, `llms.txt` and all of `docs/`. And it was an unchecked cast: `ENGRAM_LOG_LEVEL=verbose` put an unknown key in `currentLevel`, making every `>=` comparison false and **silently disabling all logging**. The one knob for turning observability up was also the way to switch it off by accident. **Fixed** (T6). |
| D6-C20 | **PARTLY TRUE** | PROVEN | The logger is good and half-adopted: **51** `log.*` calls across **14 of 91** `src/` files, against **29** remaining raw `console.error` calls. There is **no log file** — everything is stderr, which most IDE MCP hosts discard. |
| D6-C21 | **TRUE** | REPORTED | `logToolCall` swallows its own failures by design. Correct. |
| D6-C22 | **TRUE** | REPORTED | Genuinely logs rather than swallowing. |
| D6-C23 | **TRUE, and it is the least observable code in the repo** | REPORTED | `event-trigger.service.ts`: **5 of 5** catch blocks are bare `catch {`, with **0** log calls. |
| D6-C24 | **FALSE** | **PROVEN** | Compaction's backup was `try { … } catch (e) { log.warn(…) }` and it deleted rows anyway. A failed backup produced exactly the outcome the backup exists to prevent. **Third instance of this shape** — FR-D1 T1 (restore) and FR-D5 T2 (installer config) were the first two. **Fixed** (T1). |
| D6-C25 | **TRUE** | REPORTED | Degradation is real. |
| D6-C26 | **TRUE** | REPORTED | Carried from FR-D2. |
| D6-C27 | **TRUE** | PROVEN | Error prose is genuinely actionable — see the `agent_name` refusal on the wire. This is a real strength and the reason §4 T5 keeps prose *alongside* a code, not instead of it. |
| D6-C28 | **UNTESTED** | — | `export-import.ts` is an inert module (FR-D2 baseline). Its dry-run is unreachable. |
| D6-C29 | **TRUE** | PROVEN | FR-D5 T2, bound by `tests/installer/config-write-safety.test.ts`. |
| D6-C30 | **FALSE — the structural finding** | **PROVEN** | See §2b. |

### 2a — The compact proof (CRITICAL, executable)

`engram_admin(action:"compact", dry_run:false)` over real MCP stdio, against a
throwaway database seeded with 12 closed sessions:

```
BEFORE            : sessions=12 changes=12
dry_run:true   -> {"dry_run":true,"total_sessions":12,"would_remove":9,
                   "message":"Dry run. 9 session(s) would be removed. Set dry_run: false to execute."}
dry_run:false  -> {"sessionsCompacted":9,"changesSummarized":9}
AFTER             : sessions=12 changes=12
backups on disk   : 0 []

=== VERDICT ===
compact CLAIMED sessionsCompacted = 9
database ACTUALLY changed by      = 0 sessions, 0 changes
FALSE SUCCESS CONFIRMED: non-zero counts reported, nothing was compacted, no backup taken.
```

**Mechanism.** `dispatcher-admin.ts` called `manualCompact(keepSessions, maxAgeDays)`
— two arguments — against
`manualCompact(keepSessions, maxAgeDays?, dryRun: boolean = true)`. The omitted
third argument defaulted to `true`, so `dry_run:false` took the dry-run early
return, and `success(result)` reported its counts in the past tense.

Three lies, from one missing argument:

1. **It reported work it did not do.** Non-zero counts, no backup, database untouched.
2. **The preview and the execution counted different things.** The preview used raw
   SQL (`total_sessions - keep_sessions`); the service used `countCompactableSessions`
   (ended sessions only, age-filtered). Two answers to one question.
3. **Both described the wrong operation.** Sessions are never removed.

The only tell was an *absent* `backupPath` field. Nothing present in the response
was false-looking; the failure was legible only as a missing key.

### 2b — The structural finding: nothing tested the wire

Measured on the pre-D6 tree:

```
$ grep -rn "spawn\|execFile\|fork(" tests/ --include=*.ts     → (no output)
$ grep -rn "dist/" tests/ --include=*.ts                      → (no output)
$ grep -rn "jsonrpc\|tools/call\|StdioServerTransport" tests/  → (no output)
$ find tests -name "*.test.ts" | wc -l                        → 34
```

660 tests, 34 files, and **zero** exercised tool registration, JSON-RPC framing,
Zod parsing of real MCP arguments, stdout purity, or the compiled `dist/` artifact
that users actually run.

> **Correction to an existing document.** [`DEFERRED-CHANGES.md`](../DEFERRED-CHANGES.md)
> D6 says *"All 603 tests call dispatcher handlers directly with a mocked
> database."* That overstates it: only **8** of 34 test files mock `src/database`;
> the rest use real temporary databases. The accurate claim is narrower and still
> damning — no test crossed the **transport**. D6 also states the audit's two PoC
> files "were never committed and no longer exist." They still exist on disk, in
> the session scratchpads. Both are now stale.

**Consequence, demonstrated rather than argued:** every fix in this document was
made *after* those 660 tests were green, and they stayed green throughout.

---

## 3 — Failure modes

| # | Trigger | Blast radius | Silent? | Recoverable? |
|---|---|---|---|---|
| **F1** | A `console.log` is added to any startup path | **Every MCP client**, all 14 integrations. The stream is corrupt; the server appears not to exist | **Totally** — the suite stays green | Yes, once diagnosed. Diagnosis is the expensive part |
| **F2** | `compact(dry_run:false)` | User believes storage was reclaimed; it was not. Repeats until disk pressure is real | **Totally** — reported success | Yes — nothing was destroyed. The *lie* was the damage |
| **F3** | `/export` used as a backup | 19 of 24 tables absent, superseded/closed rows dropped, silent 1000-row cap. Discovered when restoring | **Totally** — a plausible-looking file | **No.** The data is gone by the time you look |
| **F4** | Compaction's safety backup fails | Change rows deleted with no backup | **Totally** — `log.warn` to a stderr nobody reads | **No** |
| **F5** | An unexpected SQL error inside `config.repo.get` | Returns `null`, identical to "table absent". `event-trigger.service.ts:95` reads that as "PM-Full disabled" | **Totally** | Yes, if noticed |
| **F6** | `ENGRAM_LOG_LEVEL=verbose` (a typo) | **All logging disappears** | **Totally** — the diagnosis knob silently disables diagnosis | Yes, once known |
| **F7** | Any throw outside a route's `try/catch` | Express's default handler returns an **HTML stack trace** — `NODE_ENV` is set nowhere in `src/`, `scripts/` or `package.json`, so Express runs in development mode | Loud, and *too* loud — leaks internals | Yes |
| **F8** | Any `serverError(res, err)` (41 call sites) | Raw `err.message` to the client; fs/sqlite errors carry absolute paths | Loud | Yes |
| **F9** | A consumer parses `content[0].text` as JSON on an error | Gets nothing. Success is JSON, error is prose | **Totally** | Yes |
| **F10** | A consumer branches on `isError === false` | Success omits `isError`, so `undefined !== false` → the success path is treated as an error | **Totally** | Yes |
| **F11** | `/health` polled by a supervisor | Reports healthy through a total database failure | **Totally** | — |
| **F12** | One of 154 swallowing `catch` blocks hides a real error | Varies. 68 are un-commented bare returns | **Totally** | Varies |

**Silence score: 10 of 12 are silent.** For a domain whose job is telling you what
went wrong, that is the finding.

### 3b — Prior art

Searched for failures, not tutorials, per charter §3b. Two results **removed**
options that were otherwise the obvious choice.

**1. The spec-blessed fix for the envelope is a landmine. — DISQUALIFIES**
The MCP spec's own tool-error example is plain text, so `error()` is *conformant*;
the JSON-in-text convention is Engram's undocumented invention. But the sanctioned
remedy — declaring `outputSchema` and returning `structuredContent` — breaks
clients:
[anthropics/claude-code#80094](https://github.com/anthropics/claude-code/issues/80094)
— Claude Desktop **refuses dispatch entirely** for tools declaring `outputSchema`;
zero `tools/call` reach the server; removing it fixes it. Corroborated by
[typescript-sdk#654](https://github.com/modelcontextprotocol/typescript-sdk/issues/654)
(outputSchema validation runs *before* `isError`, swallowing errors) and SEP-1624
(Claude Code and Windsurf ignore `structuredContent`, VS Code prefers it, Cursor
prefers `content`). **T5 therefore keeps the envelope inside `content[0].text`.**

**2. Error-code taxonomies calcify. — COMPLICATES**
[rust-lang/rust#85746](https://github.com/rust-lang/rust/pull/85746) — Rust had to
hide its catch-all behind a permanently-unstable `Uncategorized` because downstream
code, *mostly tests*, matched on `Other` and broke every time the taxonomy
improved. RFC 9457's problem-type registry still ships with one entry after two RFC
generations. **Declared gap:** no postmortem of a code scheme being *abandoned* was
found. The literature covers calcification and non-adoption, not repeal — so T5's
confidence is graded down accordingly.

**3. Backups that silently produce nothing. — SUPPORTS**
[GitLab, 2017-01-31](https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/)
— `pg_dump` 9.2 against PostgreSQL 9.6 produced nothing, nightly; the cron error
emails were themselves silently rejected by DMARC. Discovered only when someone
needed a backup. This is F3 and F4 exactly, including the detail that the failure
notification path failed silently too.

**4. Health checks that lie. — SHAPES T4**
[Roblox, Oct 2021](https://blog.roblox.com/2022/01/roblox-return-to-service-10-28-10-31-2021/)
— the monitoring that would have shown the cause depended on the failing system.
The rule taken from it: a health check must be read-only, must not cascade, must
not route solely through the subsystem it indicts, and **must have a test proving
it fails under an injected fault.** That last clause is now a test.

**5. Logging for a stdio process. — SUPPORTS, but redirects to a file**
[golang/go#43738](https://github.com/golang/go/issues/43738) — gopls wants file
logging *by default*, because client-side logs are lost on editor restart and users
cannot share them. LSP has had the stdout-is-the-protocol constraint a decade
longer than MCP. MCP's own `logging/setLevel` defaults to `warning` and many
clients never send it, so it cannot be the primary channel.

**6. E2E over real stdio. — SUPPORTS, strongest of the six**
[ChromeDevTools/chrome-devtools-mcp#570](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/570)
— a Google-maintained MCP server shipped a stdout banner that corrupted the
protocol. Found by echoing raw JSON-RPC at the binary; never by its test suite;
closed as not planned. Registration, negotiation, framing and dist-artifact bugs
are invisible to handler-level tests **by construction**.

---

## 4 — Target and rejected alternatives

*Never delegated (charter §9).*

### T1 — An operation reports only work it actually did ✅ *shipped*

`compact` runs one code path for preview and execution, with `dryRun` passed as
data; the safety backup blocks; the message describes collapsing change rows,
which is what happens.

- **Rejected: delete `dry_run` and always execute.** Fewer states, fewer lies. Lost
  because a preview on a destructive operation is worth keeping — the bug was the
  divergence between preview and execution, not the existence of a preview. Unifying
  the code path removes the divergence and keeps the feature.
- **Rejected: keep the best-effort backup and warn louder.** Lost on precedent: the
  identical shape was fixed by aborting in FR-D1 T1 and FR-D5 T2. A third "warn
  louder" would be this project deciding, three times, that a warning nobody reads
  is a safety mechanism.

### T2 — A surface that does nothing says so ✅ *shipped*

`POST /api/v1/import` returns **501 `NOT_IMPLEMENTED`**. `/export` declares itself
`partial: true`, lists what it `omits`, names its `filters`, states its `row_cap`,
and reports which tables were `truncated`.

- **Rejected: implement HTTP import properly.** It duplicates a working MCP path
  and needs merge-conflict semantics nobody has specified. The honest 501 costs one
  line; the feature costs a design. Filed as task #51 rather than smuggled in here.
- **Rejected: leave `/export` alone and just document it.** Lost because the file
  arrives named `engram-export-*.json` with an attachment header. Documentation does
  not travel with the file; the `warning` field does.
- **Rejected: make `/export` complete right now.** Tempting and wrong: completeness
  is FR-D1's domain ("the data survives"), and doing it here would be solving a
  cross-domain item twice. Handed over as task #50.

### T3 — The wire is tested ✅ *shipped* — **this is §5**

- **Rejected: the SDK's in-memory transport.** Faster, no process spawn. Lost
  because it cannot catch either failure the prior art actually documents:
  stdout pollution (there is no stdout) and dist-artifact drift (it imports
  TypeScript). It would test the parts that already work.
- **Rejected: a `scripts/verify/` script run by hand.** Lost against the charter's
  survival criterion: a check that does not block a merge is a check that stops
  being run. This is precisely how the audit's two PoC files became folklore.

### T4 — A health check must be able to fail ✅ *shipped*

`/health` opens the database and runs `SELECT 1`, returning **503** with
`DATABASE_UNAVAILABLE` when it cannot. `engram_admin health` probes FTS with a real
`MATCH` against `fts_decisions`, and `healthy` is now computed from integrity, FTS
*and* schema version — every check can affect the verdict.

- **Rejected: a deep health check exercising every subsystem.** Lost to Roblox: a
  check that routes through the failing subsystem cascades and takes the
  diagnosis down with the system. Integrity, FTS and schema version are read-only
  and independent.
- **Rejected: keeping `healthy = integrity === "ok"` and just fixing the FTS probe.**
  Lost because a check that cannot affect the verdict is decoration. If FTS being
  destroyed does not make the database unhealthy, the field should not be printed.

### T5 — One envelope, one code, inside `content[0].text` ⏳ *proposed, not shipped*

Every MCP response becomes `{ok, data?, error?, message}` as JSON in
`content[0].text`, with `isError` retained for protocol compatibility and a stable
`error` code alongside the existing actionable prose. **Deliberately not done in
this session** — it changes every consumer, and DEFERRED-CHANGES D7 correctly calls
it a master-plan decision. What this domain adds is that the decision now has
evidence rather than preference.

- **Rejected: `outputSchema` + `structuredContent`.** The spec-sanctioned answer,
  and **disqualified by claude-code#80094** — Claude Desktop refuses to dispatch
  such tools at all. This is the research changing the plan, not ratifying it.
- **Rejected: document the asymmetry and move on.** That is exactly what D7 chose
  in August, and the cost since is measurable: two false FAILs in our own harness
  and one false test assertion (observation #49). The experiment ran; it failed.
- **Rejected: adopt the HTTP envelope verbatim on MCP.** Attractive — that surface
  is already uniform and *has* codes. Lost because `{ok:false}` inside a JSON string
  inside `content[0].text` beside a separate `isError` boolean gives consumers two
  disagreeable sources of truth for the same question.

### T6 — Logging you can find and cannot switch off by accident 🟡 *partly shipped*

`ENGRAM_LOG_LEVEL` is validated; an unknown value falls back to `info` and says so
on stderr. **Still open:** it is documented nowhere, and there is no log file.

- **Rejected: MCP `logging/setLevel` notifications as the primary channel.** Lost
  because the default level is `warning` and many clients never send `setLevel`.
- **Rejected: leaving stderr as the only sink.** Lost to gopls: stderr is discarded
  by most IDE MCP hosts and cannot be attached to a bug report. An opt-in
  `ENGRAM_LOG_FILE` is the proposal; it is filed, not built.

### T7 — The silent-catch census gets a ratchet ⏳ *proposed*

154 swallowing `catch` blocks: **47 correct**, **39 masking**, **68 accidental**.
A committed baseline, in the shape of `KNOWN_INERT` in
`tests/security/no-inert-surface.test.ts`: the number may fall, never rise.

- **Rejected: a lint rule banning empty catch.** Lost because 47 of them are right —
  best-effort cleanup on paths that must not fail. A rule with 47 suppressions is a
  rule people delete.
- **Rejected: fixing all 68 now.** Out of scope and untestable in bulk. The ratchet
  makes the number visible, which is what the charter's survival criterion asks for.

### T8 — Delete or wire the inert error surface ⏳ *proposed*

`errorWithData()`, `textResult()` and all ten classes in `src/errors.ts` are
unreferenced by production. T5 would use them; if T5 is rejected, they should be
deleted.

- **Rejected: leave them as aspiration.** This is the inert-surface pattern FR-D2
  banned — code that is exported, tested and never executed, which reads as a
  capability. **Note for FR-D9:** D2's gate only inspects `register*` functions, so
  it did not catch these. The gate's shape is right; its scope is too narrow.

---

## 5 — Binding

**[`tests/e2e/mcp-wire.test.ts`](../../tests/e2e/mcp-wire.test.ts) — 9 tests.**
Spawns `node dist/index.js` as a real MCP stdio process against a throwaway
project root and speaks hand-rolled JSON-RPC. Hand-rolled deliberately: using the
SDK's client would test the SDK's framing rather than ours, and framing is the
point. CI order is `npm ci` → `npm run build` → `npm test`, so the compiled
artifact exists; a missing `dist/` fails loudly rather than skipping.

What it makes impossible to break quietly:

1. **stdout purity** — every stdout line must parse as JSON. The guard that did not
   exist, against the failure chrome-devtools-mcp shipped.
2. **stderr is alive and level-tagged** — so test 1 cannot pass vacuously on a
   server that says nothing.
3. **the envelope is pinned, defects included** — success is JSON and omits
   `isError`; error is bare prose with `isError:true`. The error assertion is
   `expect(...).toThrow()` **on purpose**: unifying the envelope must edit this line,
   in that commit, where a human sees it.
4. **the flat error taxonomy is pinned** — four failure classes, all `isError:true`,
   JSON-RPC `error` never used. Adding a code becomes a visible diff.
5. **`compact` is checked against the database, not its own report** — counts must
   be backed by an actual row-count drop, sessions must survive, and `backupPath`
   must name a file that exists.
6. **health must fail under an injected fault** — `DROP TABLE fts_decisions`, restart,
   assert `healthy:false`. The Roblox rule, mechanised.

**Second binding: the HTTP envelope is now derived, not asserted.**
`scripts/generate-http-surface.mjs` previously carried the envelope as a hardcoded
template literal — prose pretending to be a gate. Proof it was: this session changed
`/import` to a 501 and added a `notImplemented` helper, and `http-surface:check`
**passed unchanged.** The generator now parses `src/http-routes/api-helpers.ts` and
emits a table of helper → status → `ok` → error code → body shape. Verified to fail:
renaming `NOT_FOUND` to `MISSING` produces
`docs/HTTP-SURFACE.md is out of date — the HTTP surface changed.`

This closes the second half of charter §11b.1's pre-D6 gate. The first half — the
endpoint list — was closed by FR-0f.

**What these do not catch,** stated rather than glossed: a handler that is called
and returns a plausible-but-wrong payload. The transport, the artifact, the
envelope shape and two specific truthfulness properties are mechanised. The rest is
review.

---

## 6 — Kill switch

Written before attachment forms.

1. **If `tests/e2e/mcp-wire.test.ts` becomes flaky in CI, delete it — do not retry it.**
   A spawned process with a real database on three platforms is the classic flaky
   suite, and a flaky gate is worse than none: it trains people to re-run until
   green, which is how a real failure gets waved through. If it flakes, replace it
   with a single stdout-purity check, which is the one property nothing else can
   cover.
2. **If T5 ships and consumers break in the field, revert the envelope, not the
   consumers.** The asymmetry has been survivable for a year. Uniformity is worth
   having, not worth an incident.
3. **If the swallow ratchet (T7) is ever "fixed" by moving entries into the
   baseline rather than removing the catch,** the ratchet has become a permission
   slip and should be deleted. Same rule as `KNOWN_INERT`.
4. **If the health check's injected-fault test is ever weakened to make a refactor
   pass,** the health check has stopped being able to fail and T4 is void. Restore
   it or remove the health endpoint — an endpoint that cannot report ill health is
   worse than no endpoint, because supervisors poll it.
