# Tripwire Patch Runbook — cherry-picking the four security fixes onto `main`

**Date:** 2026-08-03 · **Status:** 🔒 **SPENT — the fixes are on `main` and published. Do not execute this procedure.**
**Re-verified:** 2026-08-05 · **Superseded:** 2026-08-13 · **Task:** #26 (FR-0f) item 3
**Governs:** the emergency path in [`../DEFERRED-CHANGES.md`](../DEFERRED-CHANGES.md) **D11**, decision **#19**
**Charter:** [`00-CHARTER.md`](00-CHARTER.md) §11b.2

> # ⛔ THIS RUNBOOK IS SPENT — 2026-08-13
>
> **Its purpose was to get four security fixes onto `main` in an emergency.
> They are already there, and published.** Executing it now would attempt to
> cherry-pick commits that are ancestors of `main`.
>
> **The two claims below that are actively DANGEROUS if believed, both PROVEN false:**
>
> | Where | Claims | Actually |
> |---|---|---|
> | §0 line 22 | *"`main` gained a commit touching `src/` since 2026-08-03: ❌ No. `main` is still `1afe18f`"* | **Five such commits.** `git log main --oneline --since=2026-08-03 -- src/` returns 5. `main` is `f47df04` |
> | §5 | *"`main` is still vulnerable to N1, confirmed by inspection"*, quoting a live `README_URL = https://raw.githubusercontent.com/…` | **The fetch is GONE from `main`.** `git show main:src/services/agent-rules.service.ts \| grep -c githubusercontent` → **0** |
>
> **`main`'s own `SECURITY.md` now discloses what it previously denied** —
> `git show main:SECURITY.md` line 190: *"an undisclosed outbound call this
> section previously denied."*
>
> **§0 is the sharpest lesson here and it should outlive the document.** That
> section exists *because* §7 warns this runbook rots the moment `main` moves.
> It rotted anyway, in exactly that way, one week later — a re-verification
> section that itself went unverified. A doc that knows how it will fail still
> fails that way unless something mechanical checks it.
>
> **What is still live:** nothing in this file. The remaining distribution
> problem — how a published fix reaches a machine that already has the
> vulnerable build — is Engram task **#107** and `DEFERRED-CHANGES.md` **D11**,
> not this runbook.
>
> Kept rather than archived because the *procedure* is a good worked example of
> a verified cherry-pick, and because §6.1's finding — that Recipe A is a minor
> rather than a patch because `f234052` requires `agent_name` — is reused by the
> 2.0.0 planning. **Read it as history. Do not run it.**

> **This document does not carry status.** ~~It records a verified procedure.
> Whether the tripwire has fired lives in the Engram task board.~~ *(That was
> true when written. The banner above supersedes it: the document turned out to
> carry status in two places, and both went false.)*

---

## 0. Re-verification, 2026-08-05 — **still valid, zero drift**

§7 says this document goes stale the moment either side moves, and the master
plan flagged that its numbers were measured at 603 tests while the review line
now runs 742. Re-run rather than assumed. **PROVEN**, in a throwaway worktree
that was removed afterwards:

| Check | Result |
|---|---|
| All four SHAs still resolve, unchanged | ✅ `f234052` `ea347e4` `53eba90` `87712f4`, same subjects and dates |
| `main` gained a commit touching `src/` since 2026-08-03 | ❌ **No.** `git log main --since=2026-08-03 -- src/` is empty; `main` is still `1afe18f` |
| Recipe B cherry-pick | ✅ Zero code conflicts. Both commits hit only the known `DU docs/ENGRAM_CONSTITUTION.md` |
| Build | ✅ `BUILD_EXIT=0` |
| Tests | ✅ `Test Files 27 passed (27)` · `Tests 579 passed (579)` · `TEST_EXIT=0` |
| `npm ci` | ✅ exit 0, 260 packages, `better_sqlite3.node` from a **prebuilt binary** — no source compile |
| `package.json` version in the result | ✅ `1.12.0`, confirming §6.1 |

> **The "re-verify against 733 tests" instruction in the master plan was a
> category error, and correcting it matters.** A Recipe B tree is `main`'s suite
> plus what the two commits bring — **27 files / 579 tests**, which is exactly
> what was recorded in 2026-08-03. The review line's 742 never enters this tree.
> Expecting 733 here would have read as a catastrophic regression when nothing
> was wrong.

**One imprecision found in §6.2 and corrected there.** The claim *"Both gone in
the cherry-picked tree"* is not quite right: `githubusercontent` is fully absent
(0 matches), but the string `agent_rules_cache` survives **by design** as
`LEGACY_CACHE_FILE`, annotated *"Legacy poisoning vector. Never read; detected
only so it can be reported."* The network fetch and the blind trust are what were
removed — not the filename.

---

## 1. Why this exists

Decision #19 holds the release until the master plan. Its tripwire commits to
*"a patch release that week"* if it fires. Off `main`, that means cherry-picking
four security commits out of twenty-six, improvised, under time pressure, in the
one scenario where mistakes are expensive.

Charter §11b.2: **verify it now, while it is free.** This is that verification.

---

## 2. Result

**All four commits apply to `main` with zero code conflicts.** Evidence grade:
**PROVEN** — run in a detached worktree on 2026-08-03, output quoted below.

| Commit | Finding | Applies to `main` |
|---|---|---|
| `f234052` | N3a/N3b — session identity scoped by agent | ✅ code clean |
| `ea347e4` | N3c/N3d — pending_work + handoff ownership | ✅ code clean |
| `53eba90` | N2 — config key whitelist, both doors | ✅ code clean |
| `87712f4` | N1 — agent-rules fetch and cache deleted | ✅ code clean |

Verified on the resulting tree:

```
> engram-mcp-server@1.12.0 build
> tsc
BUILD_EXIT=0

 Test Files  28 passed (28)
      Tests  603 passed (603)
TEST_EXIT=0
```

And the three security suites specifically:

```
 ✓ tests/tools/config-policy.test.ts     (12 tests)
 ✓ tests/services/agent-rules.test.ts    (10 tests)
 ✓ tests/tools/session-identity.test.ts  (24 tests)
 Test Files  3 passed (3)
      Tests  46 passed (46)
```

**Content equivalence.** `git diff 87712f4 HEAD` over every security-relevant
source and test file is **empty** — the cherry-picked result is byte-identical to
the state that was reviewed and tested on the review branch. The fixes are not
merely *applied*, they are *the same fixes*.

---

## 3. The one conflict, and it is not code

Every one of the four trips on the same thing:

| File | Conflict | Present on `main`? |
|---|---|---|
| `docs/ENGRAM_CONSTITUTION.md` | `DU` (deleted by us) — all four commits | ❌ created by `cd0a5b2`, later on the branch |
| `docs/engram-deep-audit-2026-08-02.md` | `DU` — `f234052`, `ea347e4` | ❌ same |

Both are **audit documents that do not exist on `main`**, so git reports
"deleted by us" rather than a content conflict. `grep -c '^<<<<<<<'` returns **0
hunks** in both files: there is nothing to merge, only a decision to make.

**The decision is: leave them absent.** They are internal review artifacts, not
release content. A patch release ships the code fix and `SECURITY.md`.

`README.md` — touched by both `main` (Android Studio section) and `f234052`
(+44 lines) — **merged cleanly**. It was the obvious conflict candidate and is not one.

---

## 4. Recipe A — all four (this is **not** a patch release)

```bash
git worktree add --detach ../engram-hotfix main
cd ../engram-hotfix

for c in f234052 ea347e4 53eba90 87712f4; do
  git cherry-pick -x "$c" || {
    git rm -q --cached docs/ENGRAM_CONSTITUTION.md docs/engram-deep-audit-2026-08-02.md 2>/dev/null
    rm -f docs/ENGRAM_CONSTITUTION.md docs/engram-deep-audit-2026-08-02.md
    git cherry-pick --continue
  }
done

npm ci && npm run build && npm test
```

Cherry-pick **in that order**. `783d902` sits between `ea347e4` and `53eba90` on
the branch and is **not needed** — it is `.mcp.json` dogfooding config.

### ⚠️ Recipe A carries a breaking change

`f234052` has a real trailer:

> **BREAKING: `agent_name` is now required on `engram_session(action:"start")`.**

**A "patch release" containing this is not a patch.** Every existing caller that
starts a session without `agent_name` breaks on upgrade. Shipping it as `1.12.1`
would be a semver violation delivered silently to the exact users the tripwire
exists to protect.

This is the finding that makes the exercise worth having done in advance rather
than at 2am. **Recipe A is a `1.13.0` minor at minimum**, and the tripwire's
"patch release that week" wording is wrong for it.

---

## 5. Recipe B — N1 + N2 only, the actual patch *(recommended if the tripwire fires)*

**Verified independently:** `53eba90` and `87712f4` apply to **bare `main`**
without the two session commits, byte-identical, same docs-only conflict.

```bash
git worktree add --detach ../engram-hotfix main
cd ../engram-hotfix

for c in 53eba90 87712f4; do
  git cherry-pick -x "$c" || {
    git rm -q --cached docs/ENGRAM_CONSTITUTION.md 2>/dev/null
    rm -f docs/ENGRAM_CONSTITUTION.md
    git cherry-pick --continue
  }
done
```

```
BUILD_EXIT=0
 Test Files  27 passed (27)
      Tests  579 passed (579)
TEST_EXIT=0
```

**Why this is the right default.** It carries the two findings with an external
attacker in the story — N1 (hostile repo ships `agent_rules_cache.json`,
structurally identical to CVE-2026-21852 "MemoryTrap") and N2 (config whitelist)
— and **no required-parameter change**. N3 is a data-integrity bug, not
exploitable (D11), so it does not need to travel in an emergency patch.

`87712f4` is marked `!` because it deletes the network-fetched-rules feature
outright. That is a deliberate capability removal under a security exception, not
an API break: no signature changes, `source` simply now has one value
(`"packaged"`). Note it in the release notes; it does not by itself force a minor.

---

## 6. Two things that fall out of doing this early

**6.1 Cherry-picking onto `main` sidesteps D11's version regression.**
`package.json` comes from `main`, so the build reports **1.12.0** — the trees
above built as `engram-mcp-server@1.12.0`. The 1.11.0/1.12.0 stale-label problem
is a *merge-the-branch* problem, not a *cherry-pick* problem. The emergency path
is clean where the ordinary path is not.

**6.2 `main` is still vulnerable to N1, confirmed by inspection.**

```
$ git show main:src/services/agent-rules.service.ts | grep -n "githubusercontent\|agent_rules_cache"
14:const CACHE_FILE = ".engram/agent_rules_cache.json";
16:const README_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/README.md`;
```

The only remaining `fetch(` in `src/` is the disclosed npm update check in
`installer/index.ts:97`. This is a direct check of D11's premise that published
v1.12.0 carries all four findings — **it does.**

> **Corrected 2026-08-05.** This paragraph originally read *"Both gone in the
> cherry-picked tree."* Re-measured: `githubusercontent` is gone (0 matches), but
> `agent_rules_cache` **remains, deliberately** — `LEGACY_CACHE_FILE` at
> `agent-rules.service.ts:38`, annotated *"Legacy poisoning vector. Never read;
> detected only so it can be reported."* That is DEFERRED [D4](../DEFERRED-CHANGES.md)
> working as designed: the file is surfaced, not silently deleted from a user's
> tree. What `87712f4` removes is the fetch and the trust, not the name. Grepping
> for the filename to confirm the fix would give the wrong answer.

---

## 7. Kill switch for this document

**It goes stale the moment either side moves.** Re-run it if `main` gains a
commit touching `src/`, or if any of the four commits is rebased or amended (a
branch rename does not affect them — the SHAs are what matter).

Re-running costs about ten minutes and needs no permission: it happens in a
throwaway `git worktree`, never in the working tree, and touches no database.

> **Not a CI binding, deliberately.** Per charter §11b.2 this is a one-off
> readiness check, not a claim that must stay true continuously. If the hold
> under decision #19 extends past the next domain review, promote it: a CI job
> that dry-runs Recipe B on every push to `main` would make it a real §5 binding.

---

<!-- TRIPWIRE_RUNBOOK:VERIFIED -->
