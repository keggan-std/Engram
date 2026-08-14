# Sessions 51–52 — handoff · **v1.14.0 shipped**

**Date:** 2026-08-14 · **Status:** complete, published, verified · **Agent:** `claude-opus-5-session-51/52`
**Predecessor:** [session 50](2026-08-13-session-50-handoff.md)
**Branches:** `v2-foundations` @ `75c595b` · `release/1.14.0` @ `1e87104` · `main` @ `f47df04`

> **`v1.14.0` is live on npm.** `main` is **not yet** merged — [PR #7](https://github.com/keggan-std/Engram/pull/7) is open and is the next action.

---

## The headline

**For the first time in this project's history, a published fix reached every install on the machine.**

```
npx -y engram-mcp-server@latest --check     →  exit 0
UV_HANDLE_CLOSING                            →  0 occurrences
version spread across 15 install entries     →  15 × v1.14.0
```

Before: exit **127**, the assertion as the last line, 13 of 13 outdated.

**Verified against what the registry serves, via `npx` — not against the tree that built it.** That distinction is the whole point of the release and is the one thing worth carrying forward. Release A was verified against its own tree, shipped correctly, and still did not arrive.

---

## What v1.14.0 fixed

Cut from `main`, not from the review line, because merging `v2-foundations` is **breaking** (`agent_name` required on start) and Release B's targets have not landed.

| | |
|---|---|
| **`--check` crashed on Windows** | `process.exit()` after the registry `fetch()`; undici keeps the connection alive and the exit races its teardown. [nodejs/node#58091](https://github.com/nodejs/node/issues/58091) / [#64322](https://github.com/nodejs/node/issues/64322), stalled upstream since Jan 2025. Now sets `exitCode` and returns |
| **One IDE ≠ one install** | Interactive installer took the first matching config path per IDE. Four Android Studio channels made that a coin toss. Now reads the same discovery engine `--check` uses; adds multi-select, a details view, and path shortening that elides the **middle**, never the tail |
| **`v?`** | → `unversioned (pre-1.9)` |
| **README told users to run the cached copy** | **Nine** untagged `npx -y engram-mcp-server` invocations on `main`. This was the highest-value fix in the release |
| **`remove_hooks` never removed anything** | Regex anchored on a `\n---\n\n` terminator its own hook never emits — matched nothing, reported success |
| **`engines: >=18`** | `better-sqlite3` needs `20.x \|\| 22.x \|\| …`, `open` needs `>=20`. Node 18 got EBADENGINE then a native build failure *on the database* |
| **`better-sqlite3 ^12.6.2`** | Permits SQLite 3.51.2 and its WAL-reset corruption bug (fixed 3.51.3). Engram runs WAL as a multi-agent tool — concurrent writers are its normal mode |
| **`package.json` carried v1.13.0's notes** | 6,320 chars committed, no `postpack` to restore what `prepack` writes |

---

## Three things that caught me, and one that caught npm

Recorded because they are the argument for the machinery.

1. **`ci-parity` caught a stale `dist/`.** 11 tests "failed" under `--coverage`; I had built on `release/1.14.0` and switched back. The gate names it exactly: *"a stale build makes the gates lie."* After rebuild, 1021/1021 under coverage.
2. **`register-truth` rejected my constitution edit** — markdown bold after the `@` made the `Covers:` stamp unparseable.
3. **The raw-SQL ratchet caught two attempts** to put new queries in a dispatcher. Both moved to the repository layer instead; the ceiling went **69 → 66**.
4. **npm's `E404` was lying.** Nothing was missing — the token had expired. npm returns 404 rather than 403 so it does not leak package existence. `npm whoami` → 401 was the real signal. **`postpack` restored `package.json` correctly through the failed publish**, which is precisely the path that used to leave a dirty tree.

---

## Documents that were lying

A pre-release sweep, triggered by `DEFERRED-CHANGES.md`'s own header — *"read before every release."*

| Document | Said | Actually |
|---|---|---|
| `tripwire-patch-runbook.md` | *"`main` is still vulnerable to N1, confirmed by inspection"* | `grep -c githubusercontent` on `main` → **0**. Marked **SPENT** |
| `10-public-surface.md` | Published `SECURITY.md` **denies** the fetch, *"live right now"* | It **discloses** it. This doc's own kill switch pre-registered the expiry and fired six days earlier, unactioned |
| `cross-instance-infrastructure.md` | `mark_sensitive` hides records *"from all cross-instance queries"* | `filterSensitive()` has **two definitions, zero call sites**. It hides nothing |

**D5 CLOSED** — its prescribed Action shipped verbatim as `src/tools/session-identity.ts`, and both residual claims were false. **D8, D9, D11 corrected.** D11's correction is the pointed one: it recorded the bare-`npx` trap as *"fixed at both ends"* in a commit **that is not on `main`** — the fix lived on a branch nobody had pulled while the README users actually read still carried it. *The deployment gap, reproducing inside the record of the deployment gap.*

**D9 was deliberately not patched a third time.** Its coverage row was fixed on 2026-08-07 and had already drifted again. A measured number in prose that no gate reads is finding F5 by construction; the entry now records that as the finding.

---

## What is left, in order

| # | | Owner |
|---|---|---|
| 1 | **Merge [PR #7](https://github.com/keggan-std/Engram/pull/7)** → `main`. Until then the GitHub and npm landing pages still show 1.13.0's README, including the nine untagged `npx` commands | maintainer |
| 2 | **Publish the advisory** — [draft](2026-08-13-security-advisory-DRAFT.md), reviewed. Delete the *"notes for the maintainer"* block first. The ordering constraint is satisfied now that `--check` works | maintainer |
| 3 | **Task #114** — merge `main` back into `v2-foundations`, or it stays at 1.13.0 while `main` is 1.14.0 and `register-truth` flags it | next agent |
| 4 | **Task #115** — eight docs still carry stale claims. None ship; none security- or privacy-bearing. Evidence already gathered in the task | next agent |
| 5 | **#38 → #40** — the last two criticals. #38's prerequisite (#58) landed | next agent |

`#69` starts at **step 2, a measurement**, not an edit. `#71` is gated by **D14**, whose trigger has *not* fired — `knip.json` still scopes to `src/**/*.ts`.

**#98's advisory clock still expires 2026-09-16.**

> **A note on budget.** Two sub-agents died mid-sweep on a monthly spend limit on 2026-08-13. Check before delegating breadth.

---

## Task #107 — the honest status

**The diagnosis half is fixed. The delivery half is not.**

`--check` now tells the truth, and `--check --update` acts on it — the update from 13-of-13 stale to 15-of-15 current took one command. But the installer writes a **pinned exact version** by design, so Engram still does not self-upgrade. A machine that installs 1.14.0 stays there until someone re-runs the installer.

Whether it *should* self-upgrade is an open design question, and it is not a small one: an auto-update path writes to other products' config files unasked, which is the **H1 hazard class this project has already paid for**. Do not implement one without making that argument explicitly.

---

<!-- SESSION_51_52_HANDOFF:COMPLETE -->
