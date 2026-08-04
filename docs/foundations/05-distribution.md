# Domain 5 — Distribution & Lifecycle

**Foundations Review** · Charter: [`00-CHARTER.md`](00-CHARTER.md) §6 domain 5, §7 template
**Owns:** everything between a commit and a user's machine — build, publish, versioning, install across 14 IDEs, what lands on disk, upgrade, uninstall, rollback.
Threat model → [domain 2](02-trust-safety.md). Data survival → [domain 1](01-durability.md).
**Status is not carried here.** It lives in the Engram task board.

> This domain has the review's largest blast radius, and it is not Engram's data.
> **The installer can replace another product's entire user-level state file with
> a four-line stub.** §3 F1.

---

## 1 — Claims · 2 — Reality

| ID | Claim | Reality | Grade |
|---|---|---|---|
| **D5-C1** | *"Run this single command in your terminal. It will automatically detect your IDE and **safely** inject the configuration"* — `README.md:157` | **False on "safely".** On any `JSON.parse` failure the target config is replaced with one containing only the Engram entry — see F1 | **PROVEN** |
| **D5-C2** | Install is idempotent and reversible — implied by `install --remove` existing | **Partly.** `--remove` iterates **global paths only**; every project-local entry survives, and for `firebasestudio` and `trae`, which are local-only, `--remove` is a structural no-op | VERIFIED |
| **D5-C3** | Uninstalling the package removes Engram | **False.** No `preinstall`/`postinstall`/`uninstall` script exists. `npm rm` removes the package; `.engram/`, `.engram/token`, `~/.engram/instances.json`, `~/.engram/global.db` and every `.invalid.*.bak` remain | VERIFIED |
| **D5-C4** | *"no telemetry, no external sync"* — `README.md:126` | **False as written.** `index.ts:316` schedules `update.scheduleCheck()` on every start, default-on, 24 h throttle keyed on a stored timestamp — **so the first run always fires**, to `registry.npmjs.org` and `api.github.com`. It is a version check, not telemetry, and it carries only a User-Agent (D2-C7) — but the sentence is still false | VERIFIED |
| **D5-C5** | *"cosmetic warning … safe to ignore"* about `prebuild-install@7.1.3` — `README.md:199` | **Wrong in substance.** `npm view prebuild-install deprecated` → *"No longer maintained"*, and **7.1.3 is latest** — there is no upgrade path inside the 12.x line. `package.json` `overrides: {"prebuild-install":"7.1.3"}` is **inert for consumers**, since overrides apply only at an install's root | **PROVEN** |
| **D5-C6** | The published package is signed / verifiable | **False, and the evidence is a trap.** `attestations` is absent from `npm view engram-mcp-server@1.12.0 --json`. `dist.signatures` **is** populated — that is **npm's registry transport signature, not publisher signing or build provenance.** `npm audit signatures` passes and proves nothing about who built the tarball | **PROVEN** |
| **D5-C7** | Only `dist/` ships | **True, and it works.** 367 files, 348,586 B packed. **No tests, no `docs/`, no `.engram/`, and crucially not `tests/fixtures/golden-memory.db`** — the committed fixture of real sanitised project memory does not ship | **PROVEN** |
| **D5-C8** | `.npmignore` excludes source maps | **False — the file is inert.** 91 `.js.map` + 91 `.d.ts.map` ship anyway: **611,655 B = 38.3% of unpacked size.** `files: ["dist/"]` is an allowlist that takes precedence. Its other two rules target a tsconfig layout that no longer exists. *Not* a source leak — the maps carry no `sourcesContent` and dangle at unshipped `../src/*.ts` | **PROVEN** |
| **D5-C9** | The version a user sees is the version they run | **False on this branch.** `constants.ts:14` derives `SERVER_VERSION` from `package.json`; the review line is 1.11.0 against a published 1.12.0. Separately `http-server.ts:73-76` hardcodes `"1.9.0"` in `/health` (task #43) | **PROVEN** |
| **D5-C10** | The installer executes nothing | **TRUE.** No `child_process`, `spawn` or `exec` anywhere in `src/installer/`. One network call: a 5 s display-only version fetch (`index.ts:93-107`). **Against this domain's literature that is a strong posture — §4 T6 makes it an invariant rather than an accident** | VERIFIED |

**The tarball measurement, quoted** — run independently of the sub-agent, with
`--ignore-scripts` (see §2b):

```
total files   : 367      packed / unpacked: 348586 / 1595559
.js.map       : 91       .d.ts.map : 91
all .map bytes: 611655 = 38.3% of unpacked
tests/ 0   fixtures 0   .engram 0   docs/ 0
```

### 2b — An error in my own instructions

I told the publish sub-agent that `npm pack --dry-run` *"is read-only and safe to
run."* **It is not.** `package.json` declares:

```
prepack: node scripts/inject-release-notes.js && npm run clean && npm run build
```

and `inject-release-notes.js:65` does `fs.writeFileSync` **on `package.json`
itself**, while `npm run clean` deletes `dist/`. The agent caught it and used
`--ignore-scripts`. Two lessons kept: **a `--dry-run` flag says nothing about
lifecycle scripts**, and a read-only allowlist has to account for package-manager
hooks. It also surfaced a real finding — `package.json` carries a committed
**5,672-byte `releaseNotes` blob**, downloaded by every consumer as package
metadata during resolution, because `CONTRIBUTING.md:355-362` tells maintainers
to run `prepack` at step 5 and commit at step 6.

---

## 3 — Failure modes

| # | Trigger | Blast radius | Silent? | Recovery |
|---|---|---|---|---|
| **F1** | Install runs against a config file that does not parse | **Another product's entire user state.** `addToConfig` (`config-writer.ts:160-173`) backs up *best-effort*, sets `config = {}`, and writes a file containing only the Engram entry. Measured on the real target: `~/.claude.json` is **40.5 KB, 53 top-level keys**, of which `mcpServers` is one — the rest include `oauthAccount`, `userID`, `machineID`, `projects`, onboarding state. Same exposure for `~/.gemini/settings.json` and `~/.mcp.json` | **No — three warnings print.** Which is cheaper than silence, and unread during an `npx` one-liner | The `.invalid.*.bak`, **if the copy succeeded** — its failure is swallowed and the overwrite proceeds anyway |
| **F2** | Any install, ever | `writeJson` (`:138-141`) is `mkdirSync` + `writeFileSync` — no temp file, no rename, no fsync. A crash or full disk mid-write truncates the host's config | **Total** | Restore by hand |
| **F3** | A target file contains a comment or trailing comma | It is JSONC; there is **no JSONC handling anywhere in `src/installer/`**. Parse fails → F1 | As F1 | As F1 |
| **F4** | An older Engram installs over a newer config | `addToConfig:181-192` compares `_engram_version` by **string inequality only**; `semverCmp` exists at `index.ts:53` and is display-only. Downgrade proceeds and prints *"Upgraded"* | **Total** | None |
| **F5** | Upgrade of any kind | `"upgraded"` and `"legacy-upgraded"` **replace the whole entry**, discarding user edits inside it | **Total** | None |
| **F6** | `--install-hooks` | Overwrites `.git/hooks/post-commit` with no existence check and no backup — clobbers husky or a team hook. **`--remove-hooks` *does* check ownership before unlinking**: the safety check is on the wrong side | **Total** | None |
| **F7** | Any install on a platform with no prebuilt binary | Falls through to `node-gyp rebuild`, requiring MSVC / Xcode CLT / build-essential | Loud | Install a toolchain |
| **F8** | Any install, today, under pnpm ≥10 — or under npm ≥12 when it lands | Lifecycle scripts are blocked, so better-sqlite3's `install` never runs and the addon is missing at `require()` | Loud, at first use | None until T1 |
| **F9** | A compromised or malicious publish | Users get it via `npx -y`, which **resolves latest on every server spawn** and whose `-y` suppresses the one prompt that would show what is being downloaded | **Total** | See F10 |
| **F10** | We need to pull a bad release | `npm unpublish` is limited to **72 h and no dependents**, so the only lever is a version bump — and pnpm 11 ships a **24 h cooldown on by default**, with 8 of 10 recent attacks having windows under a week. **A fix is invisible for 24 h–7 d to most non-`npx` users** | — | None. Incident response needs a channel that is not a version bump |
| **F11** | The host app rewrites its own config | Claude Desktop replaces `claude_desktop_config.json` with a stub multiple times per session; `claude-code#69084` reports `mcpServers` stripped every launch. **Our entry is not durable** | **Total** | Reinstall |

### 3b — Prior art

**Our F1 has already happened to someone else, in another product.**

- **VS Code #125970** — an extension wrote a small block and **replaced a
  600-line user settings file.** Independent, and the same mechanism.
  <https://github.com/microsoft/vscode/issues/125970>
- **The host rewrites its own config on its own schedule** —
  <https://github.com/anthropics/claude-code/issues/32345>, `/69084`.
  **Consequence: a correct first write is not enough; the target needs
  verify-and-heal plus a pre-write backup.**
- **VS Code-family configs are JSONC**; parse→stringify silently deletes
  comments and reformats. `jsonc-parser`'s `modify`/`applyEdits` is the
  mechanism that does not. <https://github.com/microsoft/node-jsonc-parser>

**The control everyone recommends is the one the evidence disqualifies.**

- **npm provenance has no documented case of preventing or detecting a real
  compromise — and it decorated two.** **TanStack** (May 2026): the OIDC token
  was lifted from the runner, *"two-factor authentication was bypassed
  entirely"*, and the malicious releases carried **valid Sigstore provenance**.
  <https://phoenix.security/mini-shai-hulud-teampcp-tanstack/>
  **AsyncAPI** (July 2026): all five malicious versions published via OIDC
  **with valid attestations**, zero lifecycle hooks, import-time payload —
  Microsoft's writeup states plainly *"do not rely on `npm install
  --ignore-scripts` as a mitigation."*
  <https://www.microsoft.com/en-us/security/blog/2026/07/15/unpacking-asyncapi-npm-supply-chain-compromise-import-time-payload-delivery/>
  **Consequence: Trusted Publishing/OIDC is not a strict upgrade over token +
  2FA — it was the attack path. Nothing here may be justified by the badge.**
- **`--ignore-scripts` is bypassable** via npm's `.npmrc` git-override RCE,
  which npm closed as *"works as expected"* and left unfixed —
  <https://www.koi.ai/blog/packagegate-6-zero-days-in-js-package-managers-but-npm-wont-act>
  — and irrelevant to import-time payloads.
- **Script-based auditing is blind to the `binding.gyp` GYP command-expansion
  worm** (June 2026, 57 packages): *"there is nothing in package.json for
  script-focused tooling to flag."*
  <https://snyk.io/blog/node-gyp-supply-chain-compromise-self-propagating-npm-worm-binding-gyp/>
- **postmark-mcp** — 15 clean versions, then one BCC line in 1.0.16, no CVE and
  no advisory feed. Download-count and reputation trust are defeated.
  <https://www.koi.ai/blog/postmark-mcp-npm-malicious-backdoor-email-theft>

**The ecosystem is moving under us.**

- **npm v12 makes install scripts opt-in**, including the implicit `node-gyp
  rebuild`, and says so for npx and global installs.
  <https://github.blog/changelog/2026-06-09-upcoming-breaking-changes-for-npm-v12/>
- **pnpm v10 has blocked dependency lifecycle scripts by default since January
  2025** — a share of users cannot install our native dependency **today**.
  <https://pnpm.io/supply-chain-security>
- **Cooldowns cut both ways** — pnpm 11's 24 h default protects users from a bad
  publish *and* delays ours. <https://nesbitt.io/2026/03/04/package-managers-need-to-cool-down.html>
- **`npm unpublish`: 72 hours, no dependents.** <https://docs.npmjs.com/policies/unpublish/>

**No usable prior art, stated because it lowers confidence:** downgrade attacks
against installers; uninstall breaking a host editor; exploitation of the
unsigned prebuild download channel itself (no CVE); and **machine-wide instance
registries of the `~/.engram/instances.json` kind — nothing at all was found.**
On that last one we would be the cited case.

---

## 4 — Target and rejected alternatives

*Written by the lead. Charter §9 forbids delegating this section.*

### T1 — Bump better-sqlite3 to 13.x; it closes five risks at once *(F7, F8, and D1's F9)*

**PROVEN by `npm view`:**

```
better-sqlite3@12.6.2  deps {bindings, prebuild-install}
                       scripts.install "prebuild-install || node-gyp rebuild --release"
better-sqlite3@13.0.2  deps {node-addon-api}
                       (no install script at all)
```

13.x ships N-API prebuilds **inside the tarball**. One bump closes: the SQLite
WAL-reset bug (3.53.4 ≫ 3.51.3), the unverified binary download, the
toolchain requirement, per-Node ABI mismatch, and script-blocking breakage under
npm v12 / pnpm v10.

- **Rejected — stay on 12.x and pin `prebuild-install`.** It is what
  `package.json` already tries, and it is inert: overrides apply only at an
  install's root, so consumers never see it. `prebuild-install` is also EOL with
  7.1.3 as latest — there is no version to pin *to*.
- **Rejected — vendor our own prebuilds.** We would be rebuilding
  `node-gyp-build` badly, and we would own a binary distribution channel whose
  failure literature (category 3) has no prior art to learn from.
- **Rejected — treat this as D1's dependency bump, as originally filed.** That
  framing produced a `medium`. Seen from distribution it is a blocker, and
  task #34 has been reclassified.

### T2 — `addToConfig` must bail on a parse failure, as its own docstring says *(F1, F3)*

Rethrow `ConfigParseError` instead of `config = {}`; make `writeJson` atomic
(temp + rename); back up *blockingly* before any write; use `jsonc-parser` for
JSONC targets.

- **Rejected — keep the backup-then-overwrite, it is recoverable.** The backup is
  `try { copyFileSync } catch { /* best-effort */ }` and the overwrite runs
  regardless. A recovery path that is skipped on failure is not a recovery path
  — this is FR-D1's restore defect verbatim, in unrelated code.
- **Rejected — strip comments and reformat, accepting JSONC loss.** VS Code
  #125970 is what that class of "helpful" rewriting produces. `jsonc-parser`
  exists precisely so an installer can edit one key and leave the file alone.
- **Rejected — refuse to write shared files at all and print instructions.**
  Honest, and it discards the product's best feature. The narrower version —
  never write a file whose pre-image did not fully parse — gets the safety
  without the cost, and is what F1 actually needs.

### T3 — Verify-and-heal, because the host overwrites us *(F11, F5)*

Server start checks its own config entry and repairs it if the host stripped it,
preserving any user edits inside the entry rather than replacing it wholesale.

- **Rejected — write once at install and assume it persists.** The status quo,
  and two upstream issues say the host rewrites that file on its own schedule.
- **Rejected — a background watcher.** Continuous, invisible, and it fights the
  host application. A check at start is bounded and observable.

### T4 — Uninstall must exist and must say what it leaves *(F6, D5-C2, D5-C3)*

`engram uninstall` removes local **and** global entries, and prints the exact
paths it is not deleting (`.engram/`, `~/.engram/`) with the command to remove
them. `--install-hooks` gets the ownership check `--remove-hooks` already has.

- **Rejected — delete the data directories too.** Charter §1's product is
  memory; silently deleting it on uninstall is the one action with no undo.
  Printing paths is the reversible half.
- **Rejected — a `postuninstall` script.** npm does not reliably run it, and this
  domain's literature says lifecycle scripts are being switched off ecosystem-wide.

### T5 — Publish becomes reproducible and attested — for the mechanism, not the badge

Publish from CI on a tag, with a lockfile-pinned build; keep `--provenance`
**only** for the transparency-log record; add the `dist/` manifest gate (§5).

- **Rejected — adopt Trusted Publishing/OIDC as the security control.** This is
  the option the research killed. TanStack and AsyncAPI both shipped malicious
  versions **with valid attestations**, and at TanStack the OIDC token *was* the
  attack path. Provenance answers *"which workflow built this"*, which is
  evidence after the fact, not prevention. Adopting it while describing it as
  protection would be exactly the "documented control that does not hold" error
  D2 §4 was written to avoid.
- **Rejected — `--ignore-scripts` guidance for users.** Bypassable, and
  irrelevant to import-time payloads.
- **Rejected — leave publishing manual.** `_npmVersion 11.6.2 / _nodeVersion
  22.20.0` says a workstation built what 1.12.0 users run. That is unreproducible
  by anyone, including us.

### T6 — Freeze the good properties as invariants *(D5-C7, D5-C10)*

Two things are already right and neither is written down: **the installer
executes nothing**, and **the tarball contains only `dist/`**. Both become
asserted invariants. Also: delete `.npmignore` (it is inert and reads as live) or
make it load-bearing; drop the map files; stop committing `releaseNotes`.

- **Rejected — leave them undocumented since they are already true.** Every other
  finding in this review is a property that used to be true. N2's whitelist, D1's
  aborting restore, N5's bounds — each was correct before a refactor removed it,
  and nothing failed when it did.

### T7 — Rollback needs a channel that is not a version bump *(F10)*

Because `unpublish` is 72 h / no-dependents and cooldowns delay patches by
24 h–7 d, the release process must define an out-of-band advisory path — the
`security_notice` mechanism `agent-rules.service.ts` already uses is the obvious
carrier, and **it reaches users on their next session rather than their next
install.**

- **Rejected — rely on publishing a patch.** Measured false: 8 of 10 recent
  attacks had windows shorter than the cooldown that would delay our fix.
- **Rejected — deprecate the bad version.** `npm deprecate` shows on install,
  which is the event that is not happening for an already-installed user.

**And the blocker this exposes:** the review line is 1.11.0 against a published
1.12.0. With rollback this weak, **that is an emergency-patch blocker, not a
label bug** — a patch cut from this line would be numbered below what npm
already serves. Merge `main` into the review line before anything else ships.

---

## 5 — Binding

| Target | Mechanism | State |
|---|---|---|
| **T2** | **`tests/installer/config-write-safety.test.ts`** — asserts `addToConfig` throws rather than writing when the pre-image does not parse, that unrelated keys survive a normal install, and that the write is atomic | **Built this session** |
| T6 | A packaging test comparing `npm pack --dry-run --ignore-scripts` output to a committed manifest: file count, and zero matches for `tests/`, `fixtures`, `.engram`, `docs/`. Same shape as `CAPABILITY-SURFACE.md` | Task |
| T1 | The `sqlite_version() ≥ 3.51.3` check already specified in D1 T7, plus an assertion that the dependency declares **no install script** | Task |
| T5 | Publish workflow in CI; the manifest gate above runs in it | Task |
| T3, T4, T7 | **None yet.** Verify-and-heal, uninstall completeness and the advisory channel are all runtime or process behaviours with no test written. Stated rather than implied | Gap |

---

## 6 — Kill switch

- **T1 reverses** if better-sqlite3 13.x breaks an API Engram uses or fails the
  golden-fixture suite. Fallback: 12.10.0+, which still closes the SQLite bug
  but leaves the install-script exposure.
- **T2 reverses** if bailing on unparseable configs blocks enough real installs
  to be worse than the clobber it prevents — measured by issue reports, not
  guessed. Fallback: bail by default, `--force` to overwrite, backup blocking.
- **T3 reverses** if verify-and-heal fights a host that is deliberately removing
  our entry. **A tool that reinstates itself against the host's wishes is
  malware behaviour**, and the line is the user's intent, not ours.
- **T5 reverses** if CI publishing becomes the attack surface it was at
  TanStack. Fallback: manual publish from a clean machine with a pinned
  lockfile — worse reproducibility, smaller token surface.

---

## Handed to other domains

- **Domain 8** — the fourth instance of *the correct implementation living where
  the live path cannot reach it*: `atomicWriteJson` exists at
  `instance-registry.service.ts:59-65`, is used at `:126`, and is **module-private**,
  so the installer could not call it even if someone thought to. With N2, D1's
  aborting restore and N5's bounds, that is a property of the codebase, not four bugs.
- **Domain 4** — `pruneStale` (`instance-registry.service.ts:405`) has **no
  production caller**, so the machine-wide registry only ever grows.
- **Domain 6** — `/health` hardcodes `"1.9.0"` (task #43); `SERVER_VERSION` drift.
- **Domain 10** — `README.md:199`'s *"cosmetic … safe to ignore"* and
  `README.md:126`'s *"no telemetry, no external sync"* are both wrong, and
  `README.md:157`'s *"safely inject"* is the claim F1 falsifies.
