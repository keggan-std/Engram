# Senior Review — Response and Handoff

**Date:** 2026-08-07 · **Status:** COMPLETE for the review's findings; follow-ups listed in §5
**Agent:** `claude-opus-5` (remediation session)
**Branch:** `v2-foundations`, from `80fa257` → `ffdc205` + this commit
**Responds to:** [`2026-08-07-senior-review.md`](2026-08-07-senior-review.md)

> Evidence grades are this project's own. **PROVEN** = a command was run and its output
> quoted. **VERIFIED** = source read personally, `file:line` cited. **REPORTED** = a document
> or sub-agent said so and it has not been re-checked.

---

## 1. Status of every finding

| # | Finding | State | Commit |
|---|---|---|---|
| **S1** | CRITICAL — arbitrary command execution via `what_changed(since)` | **FIXED**, PoC committed as a test | `a036e25` |
| **S2** | HIGH — branch drifted behind the published release | **MERGED**, `main` now an ancestor | `dbeac30` |
| **S3** | HIGH — `STATE.md` stale, freshness gate unreachable | **FIXED** (gate reachable). Wiring deliberately declined — see §3 | `276230c` |
| **S4** | HIGH — README advertised a dashboard not in the package | **FIXED** + bound by a test | `d354172` |
| **S5** | MED — `npm pack --dry-run` mutated `package.json` | **FIXED**; review's diagnosis corrected — see §4 | `d354172` |
| **S6** | MED — `import` previewed four tables, wrote one | **FIXED** (one registry, honest reporting) | `276230c` |
| **S7** | MED — status docs asserting untrue things | **FIXED** + bound by a test | `276230c` |
| **S8** | MED — Node floor wrong by a major version | **FIXED** (`>=20.0.0`) | `dbeac30`, `d354172` |
| **S9** | dependency advisories, corrected to "hygiene not urgency" | **NOT DONE** — see §5 | — |
| **S10** | SQLite WAL-reset corruption (task #34) | **CLOSED** — minor bump, not the major the row assumed | `ffdc205` |
| **S11** | LOW — file mode, `coverage/`, `temp/`, vacuous CI pin | **FIXED** | `ffdc205`, `dbeac30` |

**Plus one finding the review did not have** — the install path could not install the current
version. It is the most user-visible defect found this session and is described in §2.

## 2. The defect the review missed

The review never ran the README's commands. Doing so reproduced the user's reported symptom
and found the cause.

**PROVEN:**

```
npx -y engram-mcp-server         --version   →  v1.12.0   (cache entry from 03/04)
npx -y engram-mcp-server@latest  --version   →  v1.13.0
```

Both answer with the network disabled, so both are cache reads. `npx` caches per **exact
spec string** and does not re-check the registry. The bare spec is pinned to an old snapshot
indefinitely, and every install/check command in the README used it.

`--check` on this machine showed **v1.12.0 live in five IDE configs**.

**VERIFIED** at `config-writer.ts:58`: the installer wrote that same unpinned spec into the
IDE config, so `_engram_version: "1.13.0"` could sit beside args launching 1.12.0.

Fixed at both ends: README commands pin `@latest`; the installer writes a pinned exact
version. The trade-off is stated in `config-writer.ts` and in the release notes — **Engram no
longer self-upgrades**, and a machine that has never fetched the pinned version needs one
online run before the server starts.

## 3. Where I did not follow the review, and why

**Review action #4: "wire `generate-state.mjs --check` into `ci-parity.test.ts`."** Declined.

- `check-state-freshness.mjs`'s own header states the deliberate decision not to be a test:
  *"a gate that fails constantly is one a developer switches off inside a week."* That
  reasoning is sound and the review contradicts it two sentences after endorsing it.
- `generate-state.mjs --check` compares `STATE.md` against the **live Engram database**,
  which every session mutates, and CI has no database at all because `.engram/` is
  gitignored. It cannot be a CI gate even in principle.

**What was built instead** — `tests/process/register-truth.test.ts`, which is the review's own
higher-value Part 4 recommendation: assert the *checkable factual claims*. Five assertions,
each one line of git or one regex, each **mutation-tested** to go red on the defect it names.
Two of them found live defects while being written (the guard hook's stale disclosure claim,
and `docs/README.md:94`).

## 4. Two corrections to the review

Both were checked rather than assumed.

1. **S5's mechanism.** The review says `--dry-run` does not run `postpack`. **PROVEN
   otherwise** with a probe package on npm 11: `postpack` runs on *both* dry and real packs.
   The real cause was duller — there was **no `postpack` script at all**, so nothing restored
   the file on any path.
2. **S10's cost.** The review says "do it on the next dependency pass" and regrade down.
   **PROVEN** that `better-sqlite3@12.11.1` bundles SQLite **3.53.2**, inside the existing
   `^12` range — a minor bump, no major migration, no ABI risk. Task #34's own description
   had already recorded that `12.10.0` bundles 3.53.1 and the row still sat
   `critical`/`backlog`. `CLAUDE.md`'s *"check the tree before sizing work from a task row"*
   cuts both ways: a row can overstate the work as easily as the status.

## 5. What is NOT done — start here next session

Ordered by value.

| # | Item | Notes |
|---|---|---|
| 1 | **The retrospective advice document** the user asked for | *"How to do this from scratch, better."* Not started. Raw material is §6 below and this session's commit messages, which are deliberately long-form for exactly this |
| 2 | **S9 — `npm audit fix` + bump `@modelcontextprotocol/sdk`** | Hygiene, not urgency; the review's own corrected verdict. Also add a dependency audit for `packages/`, which has **`seroval` CRITICAL** and **`lodash` HIGH** and is covered by nothing |
| 3 | **Regenerate `docs/STATE.md`** and commit | It is stale again after this session's commits. `node scripts/generate-state.mjs` |
| 4 | **Rewrite `DEFERRED-CHANGES.md` D11** | Three of its claims are false. `register-truth.test.ts` covers the hook and the router but **not D11's prose** — I ran out of budget before extending it |
| 5 | **`src/installer/index.ts` full review** | The delegated pass returned all-CLEAN and was **wrong** — it graded the `writeJson` file-mode item CLEAN when it is real, and it missed the npx-cache defect entirely while answering the upgrade-path question. Treat its report as unreliable; the file still deserves the review the senior review asked for |
| 6 | **Decide `temp/`** | `temp/README.md` lists the three options. Owner's call — I deliberately did not move authored assets |
| 7 | **Port the OS matrix to `main`'s workflow** | `main` still lacks the Windows/macOS legs |
| 8 | **Coverage on `dispatcher-memory.ts` / `dispatcher-admin.ts`** | 8.94% and 7.81%. S1 lived in the largest file at the lowest coverage — the review calls that a mechanism, not a coincidence, and it is right |

**Not started at all:** the user also asked for the advice document (item 1). It is the one
deliverable of this session that is outstanding.

## 6. What I would tell the next person — raw notes for item 1

Kept here so the material is not lost if this session's context is.

- **A finding closed with an argument is not closed.** S1 existed because a call-site survey
  concluded "every caller passes a literal." Every caller did. One literal was a template
  with a hole in it. The project's own grading table already prescribes the cure —
  *anything CRITICAL gets an executable check* — but it bound **opening** a finding, not
  **closing** one. Bind both.
- **Never trust a green gate you have not seen red.** Every gate added this session was
  mutation-tested. One pre-existing gate (`ci-parity.test.ts:203`) had been green for weeks
  while asserting a defect that no longer existed, because it only ever inspected its own
  branch.
- **Run the commands in your own README.** Four sessions of review, ten domain documents, an
  external senior review — and the headline install command had been serving an April build
  the whole time. Nobody typed it.
- **Generated registers need a reachable gate, not just a gate.** The `STATE.md` freshness
  check could not reach exit 0 by construction: committing the regenerated file created the
  commit that made it stale. A permanently-on alarm carries no information.
- **Distinguish artifacts derived from source from artifacts derived from runtime state.**
  They look identical and need opposite treatment. The first can be a CI gate; the second
  cannot.
- **A sub-agent's report is a set of leads, not facts.** The all-CLEAN installer report is
  the worked example, and it is in the project's own orchestration guide already.
- **The same bug bites twice in one session if you let it.** `register-truth.test.ts` hit
  `main^{commit}` being eaten by `cmd.exe`'s escape character — the identical shell-eats-your-
  argument class as S1, an hour after fixing S1. The lesson does not generalise on its own;
  the fix has to be structural (delete the string signature) not local.

---

## 7. Verification for this session

```
npx tsc --noEmit          exit 0
npx vitest run            906 passed, 57 files, zero skipped
npm pack --dry-run        377 files, 1,676 KB, package.json byte-identical after
git merge-base --is-ancestor main v2-foundations   → true
```

Suite grew 887 → 906. Backup ref at tag `pre-merge-backup` (`80fa257`), the pre-merge state.

**Nothing was pushed.** The branch guard asks before any push and this session did not
request one.
