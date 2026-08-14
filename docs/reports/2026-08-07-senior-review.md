# Senior Review — Engram, whole project

**Date:** 2026-08-07 · **Status:** COMPLETE · **Reviewer:** `claude-opus-5` (review session, unnumbered)
**Branch reviewed:** `v2-foundations` @ `80fa257`, clean tree
**Revision:** 2 — v1 overstated the dependency findings; corrected in **S9** below with the evidence that falsified them.

> **Evidence grades**, using this project's own convention:
> **PROVEN** = a command was run and its output quoted. **VERIFIED** = source read personally, `file:line` cited.
> **REPORTED** = a document or third party said so and it has not been re-checked.
>
> Vendor and advisory claims were checked against **primary sources** (sqlite.org, nodejs.org,
> GitHub Security Advisories), not against `npm audit`'s summary. That check reversed two of my
> own conclusions — see **S9**.
>
> **Working tree:** returned to exactly the state I found it in. `git status` → only this report.
> One command run during the review mutated `package.json`; it was restored, and the mutation is
> itself finding **S5**.

---

## The short version

The engineering is strong and the documentation culture is genuinely excellent. **887 tests pass
across three clean full-suite runs**, the build is clean, and the security work done by the
Foundations Review is real and holds up under inspection.

Three things are wrong, and they share a single root cause: **a claim that was assessed rather
than executed.**

1. **A shell-injection finding the project graded MEDIUM and marked *"not currently
   exploitable"* is exploitable today.** I proved arbitrary command execution through an ordinary
   advertised action, and confirmed by querying the store directly that **no task tracks it**.
2. **The working branch has drifted behind the published release.** Merging it would roll the
   version back and delete v1.13.0's release notes. The board knows 1.13.0 shipped; the
   documents do not.
3. **`README.md` advertises a dashboard that is not in the npm package.** `npm pack` proves it.

**And a correction I owe up front:** my first draft called the dependency advisories a HIGH
finding and told you to fix `ws` first. **That was wrong.** Reading the actual advisories showed
`ws` is not reachable in Engram's usage, `express-rate-limit` is not used at all, and
`path-to-regexp` needs a developer-controlled route pattern. Details and evidence in **S9**.

---

## Part 1 — What is genuinely good

| What | Evidence |
|---|---|
| **The suite is real, and it is stable.** 887 tests / 54 files, ~44s, zero skipped | PROVEN — three separate clean runs, exit 0 |
| **The reported flaky test did not reproduce.** Observation #122 flags `backup-restore.test.ts` failing under parallel load. I ran it **5× in isolation (5 PASS)** and the full suite three times clean | PROVEN. See **S5** — the full-suite failure I *did* hit had a different cause, and it was mine |
| Build clean | PROVEN — `tsc --noEmit` exit 0 |
| Dead-code gate clean | PROVEN — `knip@5` exit 0 |
| Both generated surface docs match reality | PROVEN — `--check` exit 0 for the MCP surface and the 44-endpoint HTTP surface |
| **No SQL injection.** Every dynamic SQL string interpolates only hardcoded identifiers; values are always bound | VERIFIED — `tasks.ts:111-127`, `dispatcher-memory.ts:746-757`, `constants.ts:315` |
| **The cross-instance authorization hole (F4) is genuinely fixed**, at both ends | VERIFIED — `cross-instance.service.ts:465`, `instance-registry.service.ts:527` |
| **Dashboard auth is well built.** SHA-256-then-`timingSafeEqual` (avoids the length leak raw `timingSafeEqual` would reintroduce) + a DNS-rebinding `Host` guard using exact matching, deliberately not `endsWith` | VERIFIED — `http-auth.ts:58-62`, `:109-122` |
| **`restoreDatabase` is careful.** Probes the candidate **read-only**, runs `integrity_check`, refuses on failure, asks `sqlite_master` before `schema_meta`, and takes a safety backup | VERIFIED — `database.ts:340-370` |
| **The installer's config writer is properly hardened.** Atomic temp-file-plus-rename; `ConfigParseError` refuses to overwrite an unparseable config instead of stubbing it | VERIFIED — `config-writer.ts:125-149` |
| **No XSS sinks in the dashboard.** Zero `innerHTML` / `dangerouslySetInnerHTML` / `eval` across all three `packages/` | PROVEN — grep across 34 source files, no hits |
| **The branch-guard hook is well designed** — blocks history writes on `main`/`develop`, asks on every push, and **fails open deliberately** with the reasoning written down | VERIFIED — `.claude/hooks/guard-branches.mjs:41-113` |
| **The CI-parity ratchet is a genuinely clever binding** | VERIFIED — `ci-parity.test.ts:154-198` |
| **The documentation reasoning is unusually good** — rejected alternatives named, corrections preserved rather than edited out, evidence graded. D11 argues against its own earlier conclusion with citations | VERIFIED throughout `docs/` |

**The honest summary:** the *mechanisms* work. The failures are where a mechanism was
**described** but never **executed**.

---

## Part 2 — Findings, worst first

### 🔴 S1 — CRITICAL: Arbitrary command execution via `engram_memory(action:"what_changed")`

**The most serious thing in the repository, and PROVEN untracked.**

**The path.** `since` is a free string that falls through unvalidated into a shell command:

```
dispatcher-memory.ts:264    since: z.string().optional(),      ← no pattern, no enum
dispatcher-memory.ts:844      } else if (/^\d+[hdm]$/.test(params.since)) { … }
dispatcher-memory.ts:848      } else {
dispatcher-memory.ts:849        sinceTimestamp = params.since;  ← anything else, verbatim
        ↓
utils.ts:361    `log --name-status --since="${since}" --pretty=format:"…" -${limit}`
utils.ts:338    execSync(`cd "${projectRoot}" && git ${command}`, { … })
```

**PROVEN.** A PoC with a harmless `echo` payload created a file only an injected shell command
could create, then removed it:

```
before: marker exists = false
returned: ""
after: marker exists = true
marker contents: "pwned-by-since"
cleaned up.
```

**Node's own documentation confirms both the hazard and the fix** (checked at
[nodejs.org/api/child_process.html](https://nodejs.org/api/child_process.html)):

> *"Never pass unsanitized user input to this function. Any input containing shell metacharacters
> may be used to trigger arbitrary command execution."* — on `exec`/`execSync`
>
> *"`child_process.execFile()` … does not spawn a shell by default."*

**Why the first PoC looked like a false negative** — this will fool the next person too:
`gitCommand` wraps everything in `try { … } catch { return "" }`. An injected command *runs*, but
a non-zero overall exit code makes the output vanish. **Absence of output is not absence of
execution.** The working PoC used `rem` to absorb the trailing arguments so the shell exited 0,
and proved execution by side effect.

**The project's own assessment of this is wrong, and was wrong when written.**

> `engram-deep-audit-2026-08-02.md:355` — *"N7 — MEDIUM … this is **not currently exploitable**"*
> `ENGRAM_CONSTITUTION.md:384` — *"12.7 … **Not currently reachable with user input.**"*

The audit surveyed the call sites of `command` — correctly finding them all literal — and missed
that one of those literals is a **template with a user-controlled hole in it**. A call-site survey
that stopped one level too shallow.

**PROVEN untracked.** I queried the store directly (read-only) across `tasks.description`,
`observations.content`, `decisions.decision`/`.rationale`, `conventions.rule`, `file_notes.notes`
and `sessions.summary` for `gitCommand`, `execSync`, `execFile`, `shell injection`, `N7`, `12.7`.
**No task, observation or decision is about this.** The only hits are incidental — session #5's
summary listing the audit's findings, and decision #21 mentioning `execFile` in an unrelated
FR-D6 rationale.

**Why it matters more here than in a normal app.** Engram is an MCP server. The "user" supplying
`since` **is the agent**, and the agent's parameter choices are shaped by everything in its
context — stored memory rows, file notes, and, via cross-instance sharing, content written by a
*different project on the same machine*. The realistic chain:

> poisoned memory content → agent is induced to call `what_changed` with a crafted `since`
> → **arbitrary shell execution on the developer's machine**

That is the audit's own "Chain A" terminating in code execution rather than a data read. It
upgrades prompt injection from *"the agent reads the wrong thing"* to *"the attacker runs
commands."*

**Affected:** `dispatcher-memory.ts:857-858`, same pattern at `intelligence.ts:408-409`. Latent in
`getGitDiffStat` and `GitService.runGitCommand`.

**Fix** — the audit already wrote the right one; it was simply never done:

1. **`execFile("git", argvArray, { cwd: projectRoot })`.** No shell, no quoting, no `cd`. Also
   fixes paths with spaces — this repo's own path is `d:\Projects\Engram Production\Engram`.
2. **Constrain the parameter at the schema**: enum + two patterns, and **delete the `else`
   fall-through**.
3. **Commit the PoC as a regression test.** It is currently in a session scratchpad, which is
   exactly how `DEFERRED-CHANGES.md` D6 records this project losing two PoCs already.

Do (1) even after (2) — fixing only the parameter leaves the landmine armed for the next caller,
which is precisely what the audit predicted.

---

### 🔴 S2 — HIGH: The working branch has drifted behind the published release

**All PROVEN:**

| Fact | Value |
|---|---|
| Published on npm | **1.13.0** (`npm view` — `latest: '1.13.0'`, modified `2026-08-07T10:02:08Z`) |
| `package.json` on `main` | **1.13.0** |
| `package.json` on `v2-foundations` (where all work happens) | **1.12.0** |
| `main` an ancestor of `v2-foundations`? | **FALSE** |
| Common ancestor | `1afe18f` — the **v1.12.0** release commit |
| Commits on `main` missing from the working branch | **7** |
| `RELEASE_NOTES.md` on `v2-foundations` | still the **v1.12.0** document |

**In plain terms:** `release/1.13.0` was cut from `main`, shipped, and never merged back.
**Merging `v2-foundations` to `main` today would roll `package.json` back to 1.12.0 and delete the
entire v1.13.0 release notes file.**

**The board knows. The documents do not.** Task **#49** is `done` and reads *"RELEASE A IS
PUBLISHED. engram-mcp-server@1.13.0 is live on npm and is the `latest` dist-tag. PROVEN
2026-08-07."* Meanwhile:

| Document | Says | Reality |
|---|---|---|
| `DEFERRED-CHANGES.md` D11 | *"Branch `release/1.13.0` … **not pushed and not published**"* | Published 2026-08-07 |
| `DEFERRED-CHANGES.md:748` (`DONE`) | *"`main` is fully merged into `v2-foundations` … the version regression … resolved"* | False — `merge-base --is-ancestor` → FALSE |
| `docs/STATE.md:26` | *"**Pushed?** No. This branch has no upstream"* | `origin/v2-foundations`, in sync, 0 ahead / 0 behind |
| `docs/STATE.md:27` | *"schema V25"* | Store reports **V26** |
| `.claude/hooks/guard-branches.mjs:80` | *"nothing is disclosed while this branch stays unpushed"* | The branch is pushed |

D11 exists **specifically** to prevent this accident and describes it almost verbatim — *"merging
or releasing this branch as-is would regress `package.json` … and delete the v1.12.0 release
notes."* It was right on 2026-08-05 and stopped being right when 1.13.0 was cut. **This is finding
F5 — the failure the project was founded to fix — reproduced inside the anti-F5 machinery**, in
the file whose header says *"read before every release."*

**Note the disclosure consequence.** The project's tripwire says *"Any decision to push the branch
publicly — **pushing IS disclosure** — inverts this entire calculus."* The branch is pushed. Two
separate registers still tell every agent it is not.

**Fix:**
1. `git merge main` into `v2-foundations` **today**; resolve `package.json` to 1.13.0 and keep
   `main`'s `RELEASE_NOTES.md`.
2. Rewrite D11 — three of its claims are now false.
3. Regenerate `STATE.md` (see S3).
4. **Add a CI check that `main` is an ancestor of the working branch.** One line, and nothing
   performs it.

---

### 🟠 S3 — HIGH: `STATE.md` is stale, and nothing in CI or the suite checks it

**PROVEN**, on a clean tree at `HEAD`:

```
node scripts/generate-state.mjs --check   →  exit 1   "docs/STATE.md is stale"
node scripts/check-state-freshness.mjs    →  exit 1   "STATE.md IS STALE"
npx vitest run                            →  exit 0   (887 passed)
```

Both gates red, suite green — **they are not connected.**

- `ci-parity.test.ts:123-133` mirrors exactly **two** generators into `npm test`. `generate-state.mjs`
  is a **third** and appears in neither the suite nor `.github/workflows/ci.yml`.
- The CI-parity ratchet cannot catch this: it only inspects gates already present as `run:` steps
  in `ci.yml`. **A gate never added to CI is invisible to the mechanism that polices CI.**

So `STATE.md` — the file `CLAUDE.md` orders every agent to read **first** — is the one generated
artifact with **no enforcement at all**, and it is currently wrong about the release state and the
schema version.

**Observation #132 confirmed, and statable more precisely than the observation does.** The gate
compares STATE.md's stamped commit against `HEAD`. Committing the regenerated file *creates a new
commit*, so the stamp is always exactly one behind. Right now: stamped `34ab9e5`, HEAD `80fa257`
— which is `docs(STATE): regenerate after the FR-D2 hardening`, **the regeneration commit
itself.** The alarm is permanently on, so it carries no information and will be ignored.

**Fix — two separate bugs, both needed, in this order:**
1. **Make the gate reachable.** Compare against the commit the file was generated *from*, or
   ignore commits touching only `docs/STATE.md`.
2. **Then wire it in** — `runGate("generate-state.mjs")` beside the other two. Wiring in an
   always-red gate just breaks the build.

---

### 🟠 S4 — HIGH: `README.md` advertises a dashboard that is not in the npm package

**PROVEN** — `npm pack --dry-run --json`: **377 files, 1,668 KB, zero dashboard entries.**
`package.json` `files` is `["dist/", "SECURITY.md", "THIRD-PARTY-NOTICES.md"]`; `packages/` is not
in it.

But the README says:

> `README.md:819` — *"Engram **ships with** a built-in visual dashboard"*
> `README.md:873` — *"The dashboard **is included in the package** but its frontend dependencies
> are installed on first run."*
> `README.md:824` — *"`npm run dashboard`"* — a repo script an npm installer does not have

**VERIFIED in code:** `http-server.ts:182` resolves `../packages/engram-dashboard/dist` relative
to `dist/`. In an npm install that is `<pkg>/packages/engram-dashboard/dist`, which does not
exist, so line 183's `existsSync` fails and the server silently serves an API-only stub page.
**The entire Dashboard section of the README documents a workflow available only from a git
clone.**

`README.md:873` also states *"Node.js v18+"* — see **S8**, that is wrong too.

**The fix is one line in a test that already exists.** `tests/public-surface/public-surface.test.ts:233`
is `it("SECURITY.md ships in the npm package")` — the exact pattern needed. Extend it: if the
README claims the dashboard ships, assert dashboard files appear in `npm pack`. Otherwise correct
the README to say the dashboard is a repo-only development tool.

---

### 🟡 S5 — MEDIUM: `npm pack --dry-run` permanently mutates `package.json` and turns the suite red

**PROVEN, and I hit it by accident during this review.** Running `npm pack --dry-run` fires
`prepack` → `scripts/inject-release-notes.js`, which writes a **4,966-character `releaseNotes`
field into `package.json`** and never removes it, because `--dry-run` does not run `postpack`.

Consequences, all observed:

- `git status` shows `M package.json` after a command whose name says *dry run*.
- The suite goes **red**: `public-surface.test.ts:255` asserts `releaseNotes` is `undefined`.
  `1 failed | 886 passed`.
- The injected text is the **v1.12.0** notes, because `RELEASE_NOTES.md` on this branch is stale
  (**S2**) — so a real `npm pack` here would ship the wrong release notes.
- `prepack` also runs `npm run clean && npm run build`, so `dist/` is deleted and rebuilt as a
  side effect of a "dry run".

**This is also the explanation for a false alarm worth recording:** two full-suite runs failed
during this review and it looked like observation #122's flaky durability test. It was not — it
was this. After `git checkout -- package.json` the suite returned to `887 passed`. **Observation
#122's flake did not reproduce** in 5 isolated runs plus 3 clean full-suite runs.

**Fix.** Have `inject-release-notes.js` restore `package.json` on exit, or write the field to the
packed tarball rather than the working file. The existing test proves the invariant matters —
nothing enforces it at the point it is broken.

---

### 🟡 S6 — MEDIUM: `import` still previews work it will not do (task #33, `critical`/`backlog`)

**VERIFIED — `dispatcher-admin.ts:209-229`.** The dry run counts **four** tables; the executor
writes **one**:

```
importable = ["decisions", "conventions", "file_notes", "milestones"]   // line 215 — counted
const rows = data["decisions"]                                          // line 223 — applied
```

A user runs the dry run, is told four categories will import, sets `dry_run: false`, and three
silently vanish. *"Import complete. N decisions merged."* is technically true and reads as success.

**And the FR-D6 correction points back at the uncorrected path.** `export-import.routes.ts:70`
tells users: *"Use `engram_admin(action:'import', input_path)` over MCP, **which does apply the
data**."* It applies one quarter of it.

**Fix.** Derive the dry-run list and the executor from one array, or implement the other three.

---

### 🟡 S7 — MEDIUM: Status-bearing docs assert things that are no longer true

Every row VERIFIED against source or PROVEN by command. All three documents `CLAUDE.md` names as
required reading are affected.

| Document | Claim | Reality |
|---|---|---|
| **`docs/README.md:94`** — *the router* | *"finding F4 (`searchAll()` skips `checkPermission()`) is **still open**"* | **Fixed** — `cross-instance.service.ts:465`. Closed by `cc138b6`, decision #38 |
| **`ENGRAM_CONSTITUTION.md:388`** §12.8 | same claim | same — fixed |
| `ENGRAM_CONSTITUTION.md:3` | *"Covers 1.11.0, schema V24"* | Branch 1.12.0, published 1.13.0, store **V26**. Two versions and two schema revisions behind |
| `ENGRAM_CONSTITUTION.md:400` | *"570/570 pass"* | **887 pass** (PROVEN) |
| `ENGRAM_CONSTITUTION.md:400` | *"Coverage 28.7% stmt / 20.2% branch"* | **35.36% / 25.45%** (PROVEN). The stale figure *understates* — but a number nobody can cite is still useless |
| `DEFERRED-CHANGES.md` D11, `docs/STATE.md`, the branch-guard hook | see **S2** | three registers, same stale fact |

The F4 rows matter most: a reader trusting the router will burn a session re-fixing a solved bug —
verbatim the harm `archive/cross-instance-sharing-bugs.md` is preserved as evidence of.

**A related instance of the board lagging the tree, which `CLAUDE.md` explicitly warns about.**
Task **#99** (`critical`, **`backlog`**) describes `--remove` searching only global paths. It is
**already fixed** — `installer/index.ts:519-526` searches both scopes and the comment names task
#99. The artifact was fixed and the row was not. `CLAUDE.md`'s *"check the tree before sizing work
from a task row"* is not a hypothetical.

---

### 🟡 S8 — MEDIUM: The declared Node floor is wrong by a whole major version

**PROVEN.** `package.json` declares `"node": ">=18.0.0"`. But:

| Dependency | Actually requires |
|---|---|
| `better-sqlite3@12.6.2` | `20.x \|\| 22.x \|\| 23.x \|\| 24.x \|\| 25.x` |
| `open@11.0.0` | `>=20` |

A user on Node 18 follows the documented support statement and hits `EBADENGINE` then a native
build failure on `better-sqlite3` — the dependency that *is* the database. **CI cannot catch it**:
the matrix is `20.x` and `22.x`. `README.md:873` repeats the wrong floor.

**Fix.** `"node": ">=20.0.0"`, and say so in the release notes — for anyone genuinely on 18 this
is breaking, not a correction.

---

### 🟢 S9 — CORRECTED: the dependency advisories are real but mostly **not reachable**

**My first draft got this wrong and told you to fix `ws` first. Here is the correction and the
evidence, because the reasoning matters more than the verdict.**

`npm audit --omit=dev` reports **9 vulnerabilities — 7 high, 1 moderate, 1 low**, all with
`fixAvailable: true`. I took those severity labels at face value. Reading the **actual advisories**
reversed three conclusions:

| Package | npm says | The advisory actually says | Reachable in Engram? |
|---|---|---|---|
| **`ws` 8.19.0** (direct dep) | HIGH | **Moderate, CVSS 4.4** — and *"the actual severity is believed to be **low**, as the flaw is only exploitable through misuse that is unlikely in practice."* Requires the **server** to call `ws.close(code, <TypedArray>)` | **No.** VERIFIED — Engram's only close call is `wss.close()` at `index.ts:182`, no reason argument |
| **`express-rate-limit`** | HIGH | IPv4-mapped IPv6 bypasses per-client limits | **No.** PROVEN — grep for `rate-limit`/`rateLimit` across `src/` returns **zero hits**. It arrives via `@modelcontextprotocol/sdk`, whose HTTP transports Engram never instantiates — `index.ts:336,342` use `StdioServerTransport` only |
| **`path-to-regexp`** | HIGH | *"The attacker must control the **route pattern definition itself** … Avoid passing user-controlled input as route patterns"* | **No.** Engram's routes are static developer-written strings |
| `hono`, `@hono/node-server`, `fast-uri` | HIGH | Auth bypass / path traversal | **No** — same SDK HTTP-transport path Engram does not use |
| `qs`, `body-parser`, `ip-address` | MOD/LOW/HIGH | DoS / XSS | Via `express`, which Engram *does* use in `--mode=http` — loopback-bound, bearer-gated, opt-in |

**What I got wrong, specifically.** I wrote *"the bypass defeats a control this project
deliberately built."* **Engram built no such control** — it does not use `express-rate-limit` at
all. And I wrote that a memory-disclosure bug in the WebSocket layer *"is not a theoretical
concern"* when the advisory itself says it is only reachable through server-side misuse Engram
does not commit. Both statements came from trusting `npm audit`'s severity column instead of
reading the advisory — the exact "published figure quoted without its baseline" trap.

**The corrected recommendation.** Still run `npm audit fix` and bump `@modelcontextprotocol/sdk`
— it is cheap, every fix is available, and a security-sensitive package should not carry a red
audit. But this is **hygiene, not urgency**, and it should sit *below* S1–S4 in the queue.

**One genuinely new item this turned up, which nothing in the project covers:**
`packages/engram-dashboard` has its own advisories — **`seroval` CRITICAL** (type confusion
invoking attacker-controlled methods during deserialization) and **`lodash` HIGH**. `knip.json`
scopes to `src/**` only, so `packages/` has never had dead-code analysis (task #83 already says
this), and **nothing audits its dependencies either**. Mitigating: the dashboard does not ship to
npm (**S4**), so this is a developer-workstation exposure, not a user-facing one.

---

### 🟢 S10 — MEDIUM: SQLite is on a version with a known WAL corruption bug (task #34)

**PROVEN:** `SELECT sqlite_version()` → **3.51.2**.

**Verified against the vendor directly** ([sqlite.org/releaselog/3_51_3.html](https://sqlite.org/releaselog/3_51_3.html),
[sqlite.org/wal.html](https://www.sqlite.org/wal.html)) rather than taken from the task row:

- *"Fix the WAL-reset database corruption bug."* Affected **3.7.0 → 3.51.2**; fixed in **3.51.3**.
- Trigger: *"only affects databases in WAL mode when there are **two or more database connections
  open on the same file, in separate threads or processes**, and when those two connections
  attempt to write or checkpoint at the same instant."*

**Engram is WAL mode and is explicitly a multi-agent, multi-IDE tool** — it is designed to have
exactly that connection pattern. So the trigger condition is not hypothetical here.

**But quote the base rate too, because the task row does not.** SQLite states the developers could
not reproduce it organically and needed special test-control code, estimating occurrence *"less
than or equal to the expected occurrence rate of SSD malfunctions and/or cosmic-ray hits."*

**So:** task #34 is real and correctly filed, the exposure window is genuine, and the honest
priority is *"do it on the next dependency pass"* rather than *"drop everything."* Task #34 is
currently `critical`/`backlog`; **`critical` overstates it** given the vendor's own base rate.

---

### 🟢 S11 — LOW: Smaller items, each verified

| Item | Detail |
|---|---|
| **`writeJson` does not preserve file mode** | VERIFIED — `config-writer.ts:138-149` does temp-file-plus-rename with no `statSync`/`chmod`. On POSIX the replacement takes the default umask, so a target that was `0600` becomes `0644`. These targets are *other products'* config files (`~/.claude.json` is named in the code comment as holding that product's entire user state). **I could not execute this check — this is Windows, where the mode is a no-op — so it is VERIFIED by source read, not PROVEN.** It is also exactly the platform blind spot task #101 raised |
| **`coverage/` is committed — 101 files** | Not in `.gitignore`. Last updated `e81a565`, **2026-03-04**; the committed HTML reports **29.54% / 21.15%** against a real 35.36% / 25.45%. **PROVEN:** `npm run test:coverage` dirties **103 tracked files** |
| **`temp/` is committed — 10 files** | `carto-src.skill`, `ghostwriter.skill`, `prism.skill`, `agent-handoff.md`… A tracked directory named `temp` is one nobody will dare delete |
| **A test named for a defect that no longer exists** | `ci-parity.test.ts:203` — *"DEFECT: main carries none of the gate inputs — task #93"*. **PROVEN false:** all five gate inputs are on `main` now, and **task #93 is `done`**. The test still passes because it only checks its *own* branch. Its own comment says *"when they ship to main … this pin must be edited in the same commit."* They shipped; it was not |
| **Workflow divergence partly returned** | `main`'s `ci.yml` now has the three gates (Release A carried them — good), but **not** the Windows/macOS matrix added for task #101. The platform coverage added *because* `IS_WINDOWS`/`IS_MAC` were dead in CI is, again, dead on the published line |
| **Dead config branch** | Task #104 confirmed: `envVar?: string` is declared at `ide-configs.ts:55` and **no IDE assigns it**, so `config-writer.ts:90`'s branch is unreachable. `knip` cannot see it — it is a used-in-source optional property |
| **Unconstrained file paths on admin actions** | `params.output_path` (backup/export) and `params.input_path` (import/restore) are arbitrary reads and writes. MCP-local and agent-invoked, so consistent with the trust posture below — but worth stating, because that posture is what S1 breaks |

---

## Part 3 — Quality and maintainability

**Size (PROVEN):** 93 TypeScript files, 19,355 lines in `src/`; 54 test files; 34 more source
files across three `packages/`.

**Coverage (PROVEN, measured today):**

```
ALL FILES   statements 35.36% (2108/5960)   branches 25.45%   functions 52.72%   lines 36.92%
```

The distribution is the story. It is **bimodal** — what the Foundations Review touched is well
covered; everything else is zero.

| Area | Statements |
|---|---|
| `sensitive-data.service.ts` | 97.72% |
| `sessions.ts` | 71.77% |
| **`src/tools/` overall** | **13.15%** |
| `backup.ts`, `changes.ts`, `compaction.ts`, `conventions.ts`, `coordination.ts`, `decisions.ts`, `export-import.ts`, `file-notes.ts`, `intelligence.ts`, `knowledge.ts`, `milestones.ts`, `report.ts`, `scheduler.ts`, `stats.ts`, `tasks.ts` | **0%** — fifteen files |
| `dispatcher-admin.ts` (892 lines; holds import/export/wipe/restore) | 7.81% |
| `dispatcher-memory.ts` (1,246 lines; **holds S1**) | 8.94% |

**Read that last row against S1.** The critical injection lives in the largest file in the
codebase at 8.94% coverage. Not a coincidence — a mechanism.

**Structural observations:**

- **Two parallel implementations exist.** The 0% files in `src/tools/` are v1.6-era predecessors;
  the live path is `dispatcher-*.ts`. The constitution is explicit that 15 files / 4,057 lines are
  dead and **deliberately frozen** as the only record of validation the v1.6 consolidation dropped.
  **I agree with keeping them** — Knight Capital is the right citation. But they are
  indistinguishable from live code to a reader and to `grep`. Move them to `src/attic/` with a
  README, or add a file-header banner. The decision is right; the labelling is not.
- **File size is the root cause of two findings.** `dispatcher-memory.ts` at 1,246 lines with a
  38-branch switch behind **one flat Zod schema** is why S1 exists (a parameter with no per-action
  constraint) and why D14 exists (79 optional top-level parameters, none marked to an action).
  FR-D7's T1 per-action schemas would fix the *class*.
- **The error-handling idiom hides failures.** `gitCommand`'s `catch { return "" }` is what made
  S1 look like a false negative, and it recurs — `dispatcher-admin.ts:201, 288, 295`. FR-D6 found
  this class; the sweep is not finished.
- **The trust posture is coherent but now load-bearing in the wrong place.** Engram treats the
  calling agent as fully trusted — arbitrary file paths, arbitrary `since`. That is a defensible
  design for a local dev tool. It stops being defensible the moment one of those trusted
  parameters reaches a **shell**, because the agent is precisely what prompt injection targets.
  S1 is not an isolated bug; it is the one place where an otherwise-consistent posture has a
  catastrophic edge.

---

## Part 4 — What to do, in order

**Today.**

| # | Action | Why now |
|---|---|---|
| 1 | **Fix S1** — `execFile` + constrain `since` + commit the PoC as a test | Remote-influenced RCE, PoC exists, **no task tracks it** |
| 2 | **Merge `main` into `v2-foundations`**, resolve to 1.13.0 | Every new commit makes the merge harder, and the branch currently threatens v1.13.0's release notes |
| 3 | **File tasks for S1 and S4** | Both are currently untracked; the board is the status register |

**This week.**

| # | Action |
|---|---|
| 4 | Fix the STATE.md freshness gate so it *can* go green, **then** wire it into `ci-parity.test.ts` |
| 5 | Correct README's dashboard claims (or ship the dashboard), and extend `public-surface.test.ts` to assert it |
| 6 | Fix the F4 claims in `docs/README.md:94` and `ENGRAM_CONSTITUTION.md:388`; refresh the constitution header, test count and coverage |
| 7 | Rewrite `DEFERRED-CHANGES.md` D11 — three claims false |
| 8 | Make `import`'s dry run and executor share one list (task #33) |
| 9 | Fix `inject-release-notes.js` to restore `package.json` (S5) |
| 10 | `engines: ">=20.0.0"`, and fix `README.md:873` |
| 11 | Add a CI check that `main` is an ancestor of the working branch |
| 12 | `npm audit fix` + bump the MCP SDK — **hygiene, not urgency** (S9). Add a dependency audit for `packages/` too |
| 13 | Preserve file mode in `writeJson`; port the OS matrix to `main`'s workflow; `.gitignore` `coverage/`; deal with `temp/`; fix the vacuous `ci-parity.test.ts:203` pin; re-grade task #34 down from `critical` |

**The structural recommendation, worth more than any single fix.**

This project's founding insight is correct: *a claim survives only if something executes it.* The
findings above show it is being applied **to structure and not to content**. The gates check that
generated files match their generators, that CI steps are mirrored, that the router enumerates its
own set. **Not one checks whether a sentence is true.**

Every S2/S4/S7 finding, and the assessment error under S1, is that same shape: **a statement about
the world that no mechanism re-evaluates.** Domain 10 already identified this — *"the public
surface had zero content assertions"* — and built them for `README.md`. Two gaps remain: the
assertions do not cover the dashboard claim, and the same treatment was never extended to the
**internal** docs, which is where agents get their instructions.

Concretely, the highest-leverage thing to build next is a test asserting the handful of
**checkable factual claims** in `README.md`, `STATE.md`, the constitution's §12 index and
`DEFERRED-CHANGES.md` against the tree — *is `main` an ancestor? does `searchAll` call
`checkPermission`? does `package.json` match the published version? is the schema version right?
does the dashboard ship?* Each is one line. Together they would have caught **S2, S3, S4, S7 and
half of S10** before I opened the repository.

**And one process note, addressed to whoever writes the next audit.** S1 existed because a finding
was closed with an argument (*"every call site passes a literal"*) instead of a check. S9 exists
because I closed a finding with a label (`npm audit` said HIGH) instead of reading the advisory.
Same error, opposite directions — over- and under-stating. The project's own grading table already
prescribes the cure: **anything CRITICAL gets an executable check, not an argument.** It needs to
bind to *closing* a finding as tightly as it binds to opening one.

---

## Part 5 — What I could not verify

- **I did not read all 93 source files.** I traced what the evidence pointed at: auth, HTTP
  routes, cross-instance, SQL builders, git helpers, admin dispatcher, installer config path,
  `restoreDatabase`. Reviewed by targeted grep rather than full read: `migrations.ts` (1,001
  lines), `scheduler.ts`, `coordination.ts`.
- **`src/installer/index.ts` (960 lines) got a partial review** — the `--remove` scope fix and the
  git-hook strip logic, both of which are sound. The other ~880 lines were not read. It writes to
  real machines and has historically been 0% covered. **It deserves its own review.**
- **The `packages/` review was security-only.** I proved there are no XSS sinks and found the
  advisories. I did not assess the dashboard's correctness, and it remains outside `knip`.
- **The `writeJson` mode downgrade is VERIFIED, not PROVEN** — it cannot be executed on Windows.
- **I did not demonstrate the full S1 chain.** The *sink* is PROVEN. That an agent can be induced
  to supply the payload is a reasoned argument, not a demonstration.
- **`express`-family advisories were not tested for reachability.** I proved the SDK-transport
  ones are unreachable; `qs`/`body-parser`/`path-to-regexp` reach live code only in `--mode=http`,
  and I did not attempt exploitation.
- **Task statuses are now PROVEN** (I queried the store read-only), but **observations and
  decisions were only searched, not read.** 132 observations exist; I read the 8 surfaced in
  `STATE.md` plus keyword hits.
- **Observation #122's flake did not reproduce** in 5 isolated + 3 full-suite runs. That is
  evidence against it, not proof it is gone — timing flakes need far more runs and a loaded
  machine.

---

*Working tree unmodified — `git status` clean before and after, apart from this report. The S1
proof-of-concept and the read-only store queries are in this session's scratchpad; **the PoC
should be committed as a test before it is lost.***
