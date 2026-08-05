# Domain 10 — Public Surface

**Date:** 2026-08-05 · **Status:** Complete · **Engram decision:** #29
**Charter:** [`00-CHARTER.md`](00-CHARTER.md) §6 domain 10 — *"README, SECURITY.md, licence,
contribution, issue/advisory process, what is public and what is not. Owns what a stranger
sees."*

> **This document does not carry status.** Progress lives in the Engram task board.

---

## 0 — The finding, in one paragraph

Nine domains built mechanisms against code. **The public surface has none.** No test, CI
job, or generated artifact asserts anything about the content of `README.md`,
`SECURITY.md`, `LICENSE`, `CONTRIBUTING.md`, or `llms.txt` — PROVEN by absence in §2.8.
Left ungated, it is now wrong in eight verified places. Seven of those are ordinary
staleness. **The eighth is not:** the security policy published at
`github.com/keggan-std/Engram` — a repository confirmed **public** — states that the only
outbound network call is an npm version check. The version it describes, v1.12.0, is the
current npm `latest`, and it fetches agent rules from a GitHub README at session start and
caches them to disk. The document does not merely fail to disclose the vulnerability. **It
denies it**, in the section a researcher reads to decide there is nothing to look for.

That is the charter's framing question arriving at the last domain and pointing outward:
*a confident wrong answer that survives.* Every previous domain found one aimed at us.
This one is aimed at a stranger, it is signed "Security Policy", and it is live right now.

### 0.1 A note on this session's evidence

FR-D10 is the second of the two pre-registered suppression arms (charter §10.4, decision
#25). **No Engram recall action was called during the production of §1–§4.** Every number
and quotation below comes from the source tree, the npm registry, the GitHub API, or an
executable check.

The leak recorded by FR-D8 as observation #99 recurred identically — `docs/STATE.md` is
generated from Engram's memory, is the file every agent is told to read first, and
delivered decision #28, three sessions, five gating tasks and eight observations as prose.
Third occurrence.

**And it is not one channel but three.** Two more were found once writing began, and
neither is session start (observation #108):

| # | Channel | What arrived |
|---|---|---|
| 1 | `STATE.md` — a generated re-export of the store | decision #28, 3 sessions, 5 tasks, 8 observations |
| 2 | **`record_decision`'s own response** | four similar decisions **with full rationales** (#25, #18, #19, #27) — content, not a prompt, returned by a **write** |
| 3 | the `_advisor` field on write calls | unsolicited *"use `get_decisions`"* prompts, as FR-D8 saw |

**This is a finding about charter R1, not only about the arm.** R1 defines retirement as
*"stop auto-loading memory at session start."* Two of these three channels are not session
start. **R1 as written would not achieve what it describes** — FR-D8 reached the same
conclusion from the advisor prompts alone; channel 2 shows the store returning the content
itself. §4 T5 and task #89 stop treating this as an accident.

The arm still suppressed the *interactive* channel completely: **no recall action was
called during §1–§4.** What leaked is bounded and enumerable, which is why §4 T5 rejects
declaring the arm void.

**One deliberate ordering, stated so the claim stays checkable.** §1–§5 were written to
completion before instrument 1 (§8) was run, because instrument 1 is *inherently* a
reading of the stored record and cannot be done under suppression. The two are fenced, in
that order, and §8 changed nothing in §1–§4.

---

## 1 — Claims

What this project promises a stranger. `D10-C1`…`D10-C12`. Explicit claims are quoted;
implied ones are marked **(implied)**.

| ID | Claim | Where |
|---|---|---|
| **D10-C1** | *"The only outbound network call is an **update check** (`update.service.ts`)"* | `SECURITY.md:137` **on `main`** — the published line |
| **D10-C2** | *"a **local MCP server** with no network-facing endpoints… There is no authentication surface"* | `SECURITY.md:5-8` |
| **D10-C3** | *"There is no TCP port opened by default, no HTTP server, and no remote endpoint. Communication is strictly over a local stdio pipe"* | `SECURITY.md:119-121` |
| **D10-C4** | Engram reads and writes `~/.engram/memory.db` — *"global knowledge base"* | `SECURITY.md:7`, `SECURITY.md:128` |
| **D10-C5** | Vulnerability reports get acknowledgement **within 48 hours**, assessment within 7 days, patch within 30 | `SECURITY.md:59-64` |
| **D10-C6** | *"Security fixes are applied to the **latest stable release**"* — latest is ✅ Supported | `SECURITY.md:19-25` |
| **D10-C7** | `engram-thin-client` and `engram-universal-client` are installable options | `README.md:229-231`, `packages/*/README.md`, `CONTRIBUTING.md` |
| **D10-C8** | The project is **MIT licensed** | `package.json:license`, `LICENSE:1` |
| **D10-C9** | *"Engram bundles or depends on the following open-source packages, **all** MIT-licensed"* | `LICENSE:27` |
| **D10-C10** | Android Studio is the **14th** supported IDE | `package.json:releaseNotes`, `RELEASE_NOTES.md` |
| **D10-C11** | *"75% line threshold on `src/repositories/**`"* is enforced | `.github/copilot-instructions.md:117` |
| **D10-C12** | **(implied)** What a stranger reads *is* what a stranger installs — the repo, the npm tarball and the registry metadata describe one artifact | the existence of a published package with a public repo |

---

## 2 — Reality

### 2.1 D10-C1 — the published security policy denies a live vulnerability · **PROVEN**

`main` is the default branch, the repository is public, and `main` @ `1afe18f` is the
source of the published v1.12.0.

```
$ curl -s https://api.github.com/repos/keggan-std/Engram
private: false | stars: 0 | forks: 0 | watchers: 0
default_branch: main

$ npm view engram-mcp-server version
1.12.0
```

```
$ git show main:SECURITY.md   # §Network Access, as published
The only outbound network call is an **update check** (`update.service.ts`),
which fetches the latest published version number from the npm registry
(`registry.npmjs.org`). This is:
- Fire-and-forget (async, non-blocking)
- Version number only, no identifying information sent
```

v1.12.0 also fetches agent rules from the GitHub README at session start and caches them
to `.engram/agent_rules_cache.json`, read back with a cast rather than a validation
(audit N1, DEFERRED [D3](../DEFERRED-CHANGES.md)). **This branch's own SECURITY.md says so
in as many words** — *"an undisclosed outbound call this section previously denied"*
(`SECURITY.md:156`). That correction has never been pushed.

**The distinction that makes this the domain's central finding.** An undisclosed
vulnerability is a decision — decision #19, deliberately taken, with a tripwire attached
(D11). A security policy that *affirmatively denies* the vulnerability is not the same
object. It converts silence into a statement, and the statement is load-bearing: a
researcher who reads §Network Access and moves on has been actively steered away from N1
by the document whose purpose is to steer them toward it. **Nothing in D11's risk
calculus accounts for this**, because D11 reasons about disclosure and this is
misdirection.

### 2.2 D10-C2, C3 — "no HTTP server" ships an HTTP server · **VERIFIED**

| Claim | Reality |
|---|---|
| *"no network-facing endpoints"* | `express`, `cors`, `ws` are **runtime dependencies** (`package.json:dependencies`) |
| *"no HTTP server"* | `src/index.ts:166` `createHttpNodeServer(app)`; `:244` `httpServer.listen(port, "127.0.0.1")`; **17** compiled route files ship in `dist/http-routes/` |
| *"no authentication surface"* | `src/index.ts:157` `ensureToken(projectRoot)`; `:218` rejects WebSocket upgrades on token mismatch; `http_token` is a config key with its own policy test |
| *"strictly over a local stdio pipe"* | False whenever `--mode=dashboard` is used |

**Stated precisely, because over-reading this would be the failure mode.** The server is
**opt-in** (`--mode=dashboard` or `ENGRAM_MODE=dashboard`, `src/index.ts:140-142`), binds
**loopback only**, and is **token-authenticated**. The hedged clause — *"no TCP port
opened **by default**"* — is therefore true, and the design is sound.

The two clauses on either side of it are not hedged and are not true. This is the exact
inverse of FR-D8 §2.2's `console.log` correction: there, a **rule** was written more
broadly than the hazard, and reporting violations would have misled. Here a **claim** is
written more broadly than the truth, and the error runs in the direction that reassures.
The consequence is concrete and visible in the same file: `SECURITY.md:102` puts
*"denial-of-service via large inputs"* out of scope on the grounds that *"Engram is not a
public service"* — a scoping decision derived from the false half of the claim.

### 2.3 D10-C4 — SECURITY.md names a database that does not exist · **VERIFIED**

`SECURITY.md:7` and `:128` both name `~/.engram/memory.db`. That path appears **nowhere**
in `src/`. There are two global paths and they are different things:

| Real path | What it is | Source |
|---|---|---|
| `~/.engram/global.db` | the cross-project knowledge base | `src/global-db.ts:18` |
| `~/.engram/global/memory.db` | tier-6 fallback when no project root is found | `src/utils.ts:251`, `src/tools/sessions.ts:189` |

README is **correct** in both places — `:886` names the KB, `:281-286` name the fallback —
and describes them as the different things they are. The error is SECURITY.md's alone, and
it invents a third path by collapsing the two. In the section titled **File System
Access**, which exists so a researcher knows what to audit, that is the wrong place to be
imprecise.

### 2.4 D10-C7 — two documented packages have never existed · **PROVEN**

```
$ npm view engram-mcp-server version        1.12.0
$ npm view engram-thin-client version       npm error code E404
$ npm view engram-universal-client version  npm error code E404
```

Both are documented in `README.md`, in `CONTRIBUTING.md`'s project structure, and in their
own `README.md` files, with install commands. `README.md:229` says the universal client
*"still works"*. Neither has ever been published. Every published version of the one real
package:

```
1.2.0 … 1.2.9, 1.4.0, 1.4.1, 1.6.1, 1.7.0 … 1.7.3, 1.9.0 … 1.9.3, 1.11.0, 1.12.0
```

This is finding **F5**'s shape — a status-bearing claim that quietly stopped being true —
except it was never true. Compare incident #1 in
[`project-state-tracking-design.md`](../project-state-tracking-design.md): `lock_file`
advertised in the README for versions after it was deleted. **Same repository, same
document, same failure, opposite direction:** the README advertises forward as readily as
it advertises backward.

### 2.5 D10-C8, C9 — the licence is MIT and GitHub does not agree · **PROVEN**

```
$ curl -s https://api.github.com/repos/keggan-std/Engram | jq .license.spdx_id
"NOASSERTION"
```

`package.json` says `"license": "MIT"`. `LICENSE:1-23` is verbatim MIT. The mismatch is
mechanical: `LICENSE:25-35` appends a `## Third-Party Dependencies` section, so GitHub's
licence detector no longer matches the template and reports **no licence at all**. npm
says MIT; GitHub says nothing; both are public, and consumers read whichever they land on.

**C9 is true, and its table is incomplete.** All seven runtime dependencies really are MIT
— checked individually, `@modelcontextprotocol/sdk`, `better-sqlite3`, `cors`, `express`,
`open`, `ws`, `zod`. The attribution table lists **three**. `cors`, `express`, `open` and
`ws` are bundled as dependencies and their copyright notices are absent, which is the one
thing MIT actually requires of a redistributor.

### 2.6 D10-C12 — what a stranger reads is not what a stranger installs · **PROVEN**

`package.json` sets `"files": ["dist/"]`. `npm pack --dry-run`: **367 entries, 1.54 MB
unpacked.**

| File | In tarball? |
|---|---|
| `README.md`, `LICENSE`, `package.json` | shipped (npm always includes these) |
| `SECURITY.md` | **not shipped** |
| `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` | **not shipped** |
| `llms.txt`, `RELEASE_NOTES.md`, `.github/` | **not shipped** |

The security policy is a GitHub-only artifact. That is defensible on its own — but it
means the **only** channel carrying the vulnerability-reporting instructions is the one
whose copy of them is wrong (§2.1). A user who installs from npm and never visits GitHub
has no reporting channel at all.

**And the tarball ships the dead code.** `dist/tools/` contains **19** compiled modules —
all four live ones and **all fifteen** that FR-D8 §2.3 proved unreachable. The 4,057 lines
D10 of `DEFERRED-CHANGES` deliberately preserves as an internal record are compiled,
source-mapped and shipped to every user. (Checked: `sourcesContent` is **absent** from the
182 `.map` files, so original TypeScript is not embedded — the maps reference
`../src/*.ts`, which is not in the tarball. That specific leak does not occur.)

### 2.7 The release notes have two sources of truth and one silently overwrites the other · **PROVEN**

`package.json` carries a `releaseNotes` **string field**, served by the npm registry as
part of the package document. `prepack` regenerates it from `RELEASE_NOTES.md`:

```
"prepack": "node scripts/inject-release-notes.js && npm run clean && npm run build"
```

Running `npm pack --dry-run` on the clean tree:

```
✅ inject-release-notes: injected 4966 chars into package.json (v1.12.0)

$ git status --porcelain
 M package.json
```

| | chars |
|---|---|
| committed in `package.json` | **3,194** |
| regenerated by `prepack` | **4,966** |

The committed value is a stale, condensed copy of `RELEASE_NOTES.md`, drifting **right
now**, on a clean tree. Nothing reports it, because `prepack` overwrites it at publish
time — the drift is real but never observable at the moment it matters. Two further
consequences, both PROVEN by having hit them:

1. **`prepack` mutates a tracked file and does not restore it.** Any `npm pack` or
   `npm publish` leaves the working tree dirty. It also runs `npm run clean`, so a
   dry-run deletes and rebuilds `dist/`.
2. **`inject-release-notes.js` writes to stdout**, corrupting `npm pack --json`:
   `SyntaxError: Unexpected token '✅'`. This broke two attempts at the §2.6 measurement
   before it was worked around. It is Law 2 (*"never write to stdout"*) violated in a
   build script — outside the MCP path, so FR-D8 §2.2's correction applies to the *law* —
   but here it demonstrably corrupts a machine-readable interface, which the console
   output in `installer/` does not.

### 2.8 Nothing gates any of this · **PROVEN by absence**

Every reference to a public-surface file anywhere in `tests/`, `scripts/` or
`.github/workflows/`:

| Hit | What it is |
|---|---|
| `tests/services/agent-rules.test.ts:60` | a **string literal** of the old fetch URL, inside a regression test |
| `tests/tools/config-policy.test.ts:7` | a **comment** mentioning SECURITY.md |
| `scripts/generate-state.mjs:312` | a markdown **link** in generated output |

**Zero assertions about public-surface content.** The capability-surface generator
(charter §0d) covers the MCP tool contract; the HTTP surface generator covers routes.
Neither reads a document. Eight verified errors accumulated in the one artifact class with
no mechanism — which is charter §2's survival criterion doing exactly what it predicts.

### 2.9 Corrections to inherited records

Both were found while measuring, and both are recorded rather than quietly fixed.

**DEFERRED D11 is stale in its first half.** It states *"`package.json` here says
**1.11.0**; `main` says **1.12.0**"* and lists a version regression as release-blocking.
`git merge-base --is-ancestor main HEAD` → **true**: `main` is fully merged into
`v2-foundations`, and `package.json` on this branch reads **1.12.0**. The stated Action
(*"Rebase onto `main` (or merge `main` in)"*) has already been done. **The rest of D11 —
the hold, the tripwire, and "published v1.12.0 is the vulnerable build" — is
untouched and more urgent than when it was written.** Task **#87**.

**A sub-agent lead I am declining to promote.** The claim inventory flagged *"557 tests
pass"* (`RELEASE_NOTES.md`, `package.json:releaseNotes`) as false, against the measured
`722 passed (40 files)`. **That is a miscall and it is worth naming.** Those notes are a
point-in-time description of v1.12.0, dated March 6 2026, and 557 was accurate then. The
real defect in the same text is §2.7's — two copies drifting — and "a number went up" would
have crowded it out. Per orchestration-guide §3: a sub-agent's report is a set of leads.

### 2.10 Scoring the pre-registration

Written to
[`measurements/d10-preregistration.md`](measurements/d10-preregistration.md) — committed
unedited — before any public-surface file was opened and before either delegate was
launched. Copied into Engram as observation **#100** later in the session.

> **The provenance is weaker than decision #25's and saying so is the point.** #25's *row
> timestamp* is what made "in advance" checkable. Observation #100's does not, because the
> row was written after the measuring. The committed file is the artifact that carries the
> claim, and it is quoted below verbatim.

| | Prediction | Outcome |
|---|---|---|
| **P1** | A published security-relevant claim is false for the published build | **CONFIRMED** — and worse than predicted: it is a denial, not an omission (§2.1) |
| **P2** | SECURITY.md's reporting channel is unexercised, with no advisory published | **CONFIRMED** (§3 F4) |
| **P3** | README's `ENGRAM_INSTRUCTIONS` block has drifted from the generated surface | **FALSIFIED** — no drift found; but §2.8 shows this is luck, not a gate |
| **P4** | The IDE count is wrong or inconsistent across the public surface | **FALSIFIED** — **14** `IdeDefinition` entries in `src/installer/ide-configs.ts`; *"14th IDE"* is correct |
| **P5** | `package.json`'s `files` publishes something unintended or omits something documented | **CONFIRMED** — SECURITY.md unshipped, 15 dead modules shipped (§2.6) |

**Two of five failed — the same score as FR-D8 and FR-D9, for the third consecutive
domain.** P3's failure is the useful one: it predicted drift in the one place a reasonable
person would expect it, and there was none. Had the prediction not been registered first,
§2.8's "nothing gates this" would read as an explanation for the eight errors found. It is
not — the same absence of a gate covers the block that happens to be *correct*. **An
ungated surface is not the same as a wrong one, and P3 is the only reason this document
can tell the difference.**

---

## 3 — Failure modes

| # | Trigger | Blast radius | Silent? | Recoverable? |
|---|---|---|---|---|
| **F1** | A researcher reads `main`'s SECURITY.md §Network Access and concludes there is nothing to look for | N1 stays unreported by the one population most able to report it | **Totally** | Yes — one push |
| **F2** | A user installs from npm, hits a security issue, looks for a policy, and the tarball has none | Report goes to a public issue, or nowhere | **Totally** | Yes |
| **F3** | Someone runs `npm install engram-thin-client` from the README | Install fails; the reader concludes the project is abandoned | No — loud | Yes |
| **F4** | A vulnerability is reported and the 48h/7d/30d SLA is missed | A published commitment is broken at the worst moment | No | **No** — the SLA is already public |
| **F5** | A compliance scanner reads GitHub metadata and sees `NOASSERTION` | Corporate adoption blocked; the project looks unlicensed | **Totally** | Yes |
| **F6** | `npm publish` runs with a dirty tree from a previous `prepack` | Published metadata differs from any commit; unreproducible | **Totally** | Only by republishing |
| **F7** | An agent ingests the README's instruction block from a fork with it modified | Attacker-authored instructions, labelled authoritative | **Totally** | — |

**F1 is the one with a one-line fix and the largest asymmetry**, and F4 is the one that is
already unrecoverable: the SLA was published before anyone checked whether it could be met,
and there is no evidence the advisory channel has ever been exercised (0 stars, 0 watchers,
0 forks — nobody has ever tried).

### 3b — Prior art: how this has gone wrong for other people

Searched for the **failure** literature. Every load-bearing citation below contradicts an
obvious move; the two that only confirm are labelled as such.

**"Small project, nobody will target it" is contradicted by the closest possible case —
`postmark-mcp`.**
[thehackernews.com](https://thehackernews.com/2025/09/first-malicious-mcp-server-found.html)
An MCP server with **~1,500 weekly downloads** behaved identically to the legitimate
package for versions 1.0.0–1.0.15, then 1.0.16 added a one-line BCC backdoor exfiltrating
every outgoing email. *Contradicts:* **DEFERRED D11's central risk argument** — *"a
targeted attack on a package with 26 downloads/week, 0 stars, 0 watchers."* The first
malicious MCP server ever found in the wild was a small one, and low download counts were
the *reason* it went unscrutinised for fifteen versions. Grade: **PRIMARY-INCIDENT**.

**Obscurity is the ecosystem's default state, not a defence.**
[arXiv:2003.03471](https://arxiv.org/pdf/2003.03471) — **93.9%** of npm packages receive
fewer than 350 weekly downloads. *Contradicts:* "we are too small to be worth attacking."
An attacker filtering on popularity would ignore almost the entire registry; nobody does.
Grade: **PEER-REVIEWED**.

**Undisclosed vulnerabilities are attacked anyway.**
[Arora, Nandkumar & Telang, *Information Systems Frontiers* 2006](https://link.springer.com/article/10.1007/s10796-006-9012-5)
Secret vulnerabilities are attacked at slowly *increasing* rates without ever being
published; disclosure changes the shape of the curve, not its existence. *Contradicts:*
"exposure is low **because** it is undisclosed" — the silent case is not the zero case.
Grade: **PEER-REVIEWED**.

**Both extremes have produced real incidents in the same year.**
[therecord.media](https://therecord.media/jetbrains-rapid7-silent-patching-dispute) —
Fortinet silently patched a FortiWeb zero-day already under mass exploitation, leaving only
*defenders* uninformed; separately, Rapid7's immediate full disclosure of JetBrains bugs
post-patch was followed by JetBrains *"hearing from customers who noticed their servers had
been compromised."* *Contradicts:* both "quietly fix it later" **and** "disclose the moment
you patch." This is why §4 T1 fixes the *denial* now and leaves the *disclosure* to the
master plan — they are separable, and the literature says only one of them is urgent.
Grade: **PRIMARY-INCIDENT**.

**There is an institutional deadline precisely because indefinite silence is the failure
mode.** [CERT/CC disclosure policy](https://certcc.github.io/certcc_disclosure_policy/) —
45 days regardless of patch status, while explicitly warning that *"gratuitously announcing
vulnerabilities may not be in the best interest of public safety."* *Contradicts:* both
poles again, and supplies the shape D11's tripwire is missing: a **clock**, not only a set
of event triggers. Grade: **PRIMARY-INCIDENT** (policy).

**A single maintainer's private disclosure calculus is not a private matter.**
[socket.dev on libxml2](https://socket.dev/blog/libxml2-maintainer-ends-embargoed-vulnerability-reports)
libxml2's maintainer unilaterally ended embargoed handling, citing burnout; it became a
public controversy, with critics warning that details without a fix get bugs *"exploited in
the wild."* *Contradicts:* "this is a small call I can make quietly." Closest real-world
analogue to this project's governance. Grade: **PRACTITIONER-ESSAY / PRIMARY-INCIDENT**.

**SECURITY.md mostly does not do what it looks like it does.**
[arXiv:2510.05604](https://arxiv.org/pdf/2510.05604) — of 711 sampled SECURITY.md-related
GitHub issues, **79.5% were requests to *add* the file**, not vulnerability reports; issues
carrying a working reporting link closed a median of **2 days** faster. *Contradicts:*
"we have a SECURITY.md, so reporting is handled." Its measured effect is on *friction*, not
on attracting disclosures — which is why §4 T2 makes the channel **testable** rather than
merely present. Grade: **PEER-REVIEWED** (preprint).

**Structured advisory channels have not replaced email.**
[arXiv:2511.22186](https://arxiv.org/pdf/2511.22186) — across PyPI, email remains the
primary reporting channel even where GitHub advisories exist; absent SECURITY.md correlates
with lower OpenSSF Scorecard results. *Contradicts:* SECURITY.md:39-45's ordering, which
makes the GitHub advisory *"the preferred method"* and relegates email to *"the maintainer's
email (linked on the GitHub profile)"* — an indirection through a third page.
Grade: **PEER-REVIEWED** (preliminary).

**Repository text reaching an agent's context is a demonstrated attack class, not a
hypothesis.** [GHSA-jh7p-qr78-84p7](https://github.com/advisories/GHSA-jh7p-qr78-84p7)
(CVE-2026-21852) — Claude Code applied a repo-supplied `ANTHROPIC_BASE_URL` and sent
authenticated requests to it *before* the trust prompt. And
[Invariant Labs](https://invariantlabs.ai/blog/mcp-github-vulnerability) — a hidden payload
in a **public GitHub issue** coerced an agent into exfiltrating private repositories;
researchers stated it *"cannot be resolved through server-side patches."* *Contradicts:*
"the README instruction block is inert if someone forks and edits it." Notable that
`SECURITY.md:164` **already cites CVE-2026-21852 as its own precedent** — the project has
the right citation and has applied it to `agent_rules` only, not to the README block that
is the same ingestion path (F7). Grade: **PRIMARY-INCIDENT**.

**A tarball can ship broken while CI is green.**
[tiptap#7613](https://github.com/ueberdosis/tiptap/issues/7613) — March 2026, multiple
packages published **without their `dist/` directories**; installed fine, unusable, found
by users. *Contradicts:* "CI passes, therefore the artifact is correct." Directly sizes the
risk in §4 T3: `files: ["dist/"]` plus a `prepack` that runs `clean` has exactly this shape.
Grade: **PRIMARY-INCIDENT**.

**MCP servers as a class are measurably exposed.**
[csoonline.com](https://www.csoonline.com/article/4168979/1800-mcp-servers-exposed-without-authentication-how-zero-trust-can-secure-the-ai-agent-revolution.html)
Knostic's internet-wide scan found **1,862** MCP servers answering unauthenticated
tool-listing requests; **119 of 119** manually sampled allowed it, because the MCP spec
makes authorization optional. *Confirms* that Engram's token-gated loopback dashboard is on
the right side of a real, class-wide problem — and *contradicts* SECURITY.md's framing that
there is no server to reason about at all (§2.2). Grade: **INDUSTRY-REPORT**.

**A Code of Conduct is not an enforcement capability.**
[The Register on Rust](https://www.theregister.com/2021/11/23/rust_moderation_team_quits/)
Rust's entire moderation team resigned, stating they were *"unable to enforce the Rust Code
of Conduct."* The document existed; the governance did not. *Contradicts:* treating
`CODE_OF_CONDUCT.md` as a solved item. For a single-maintainer project the honest position
is that enforcement is one person — §4 T4. Grade: **PRIMARY-INCIDENT**.

**`llms.txt` is probably not read by anything.**
[longato.ch](https://www.longato.ch/llms-recommendation-2025-august/) — 90 days, **84 of
62,100** AI-bot requests (0.1%) touched the file; no major vendor has committed to reading
it. *Confirms only*, and with a caveat that matters: this measures *crawler* ingestion, not
an agent that clones a repo and reads files directly — which CVE-2026-21852 shows is
effective. **Do not generalise this into "README text is inert to agents."** Grade:
**INDUSTRY-REPORT**.

**Where the literature is thin — stated, not padded.** Two lookout items returned nothing
solid and are recorded as gaps rather than filled with weak citations. **(a)** No
incident-grade case was found of a false *"zero breaking changes"* changelog claim being
the traceable proximate cause of a bad upgrade — §2.9's restraint on the "557 tests" lead
rests on reasoning, not evidence. **(b)** No documented case was found of a `LICENSE`-vs-
`package.json` metadata mismatch actually causing a compliance failure or corporate ban; the
mechanism is well documented in SPDX/SBOM tooling, the *consequence* is not. F5's severity
is therefore **reasoned, not evidenced**, and colors.js was considered and **rejected as too
loose** — sabotage is a provenance-trust failure, not a metadata mismatch.

---

## 4 — Target and rejected alternatives

### T1 — Delete the false denial. Do not couple it to the disclosure decision · task #84 · **CRITICAL**

**Target.** `main`'s `SECURITY.md` §Network Access stops asserting that the update check is
the only outbound call. The minimum correct edit states that v1.12.0 and earlier also fetch
agent rules at session start, and that this is being addressed. It does **not** require
publishing an advisory, cutting a release, or pushing `v2-foundations`.

**Rejected — wait for the release, and fix the policy then.** This is the status quo and it
is the option the literature most directly refutes. Fortinet's silent patch left only
defenders uninformed; Arora et al. show undisclosed vulnerabilities are attacked on a rising
curve regardless. But the decisive argument is narrower and does not depend on either:
**decision #19 held the *fix*; nobody ever decided to publish a *denial*.** The denial is
not a considered position — it is the residue of a document written before N1 was known.
Deferring it treats an artifact of ignorance as though it were a choice.

**Rejected — publish a full advisory now.** Rapid7/JetBrains is the counter-case, and D11's
tripwire already reasons carefully about disclosure timing. The advisory is a master-plan
decision with a real trade-off. **Removing a false statement is not.** Keeping these coupled
is what has kept the false statement alive for three days and nine domains: it inherits the
release decision's blocking condition without sharing its trade-off.

**Rejected — push `v2-foundations`, which has a correct SECURITY.md.** D11 is explicit that
**pushing IS disclosure** and inverts the entire risk calculus. T1 must be a `main`-only
documentation commit, and that constraint is why it is cheap.

> **Stated plainly.** I am not overriding decision #19, and this document does not
> recommend a release. It separates two things that were bundled by accident and asserts
> that only one of them was ever decided.

### T2 — The reporting channel must be provably live · task #85

**Target.** Ship `SECURITY.md` in the npm tarball. Make the email channel direct rather than
*"linked on the GitHub profile."* A test asserts the advisory URL is well-formed, that the
file is in `files`, and that every SLA in the table has an owner.

**Rejected — leave the channel as-is because nobody has reported anything.** Zero reports
against 0 stars and 0 watchers is not evidence the channel works; it is absence of evidence
either way. arXiv:2510.05604 measures the file's real effect as friction reduction, and
`SECURITY.md:44`'s two-hop indirection through a GitHub profile is friction.

**Rejected — drop the 48h/7d/30d SLA rather than commit to it.** Considered seriously: a
single maintainer cannot guarantee a 48-hour acknowledgement, and F4 is unrecoverable. It
loses because the SLA is **already published** — deleting it silently is the same class of
move as §2.1, and arXiv:2511.22186 shows a working channel measurably speeds resolution.
Making it accurate beats making it absent. If it must change, it changes *visibly*.

### T3 — What is public becomes a generated, gated fact · task #86

**Target.** Extend the pattern already proven three times (`generate-capability-surface`,
`generate-http-surface`, `generate-state`) to the tarball: a committed manifest of what
`npm pack` produces, with `--check` in CI.

**Rejected — assert the exact file list in a test.** This is the alternative FR-D8 §4 T5
rejected for the census, for the same reason: it fails on every legitimate build change,
goes red, and is then ignored — which is precisely how `knip` stayed red from `307d2f2`
through nine sessions. A generator fails only on real disagreement.

**Rejected — trust `files: ["dist/"]` because it is simple.** tiptap#7613 is a March 2026
instance of exactly this shape shipping broken, and §2.7 shows `prepack` already runs
`clean` and mutates a tracked file. Simplicity is not the property under test.

**Rejected — fix the `releaseNotes` drift by hand and move on.** It would be correct for
one commit. The field is regenerated by `prepack`, so the committed value is *structurally*
untrustworthy; the fix is to stop committing a generated value, not to refresh it.

### T4 — Say what governance actually is · task #88

**Target.** State plainly on the public surface that this is a single-maintainer project,
that CoC enforcement is one person, and that the SLA is best-effort by one person.

**Rejected — adopt a fuller governance document.** Rust had the documents and the
enforcement failed anyway. For n=1 maintainers, more process text increases the gap between
the stated and the real, which is this domain's entire failure mode.

**Rejected — say nothing, since it is obvious from the commit history.** It is obvious to
someone who looks. `SECURITY.md`'s *"we"*, its SLA table, and its acknowledgements section
all read as an organisation. The document creates the impression; the document should
correct it.

### T5 — `STATE.md` is the suppression leak, and the experiment must own it · task #89

**Target.** Charter §10.4 is amended to state that generated re-exports of Engram memory
are recall. `STATE.md` gains a header line naming itself as a recall channel, so a future
suppressed arm is told at the point of reading.

**Rejected — instruct future agents not to read `STATE.md`.** `STATE.md:83` is *"Where to
go next: 1. This file."* An instruction that contradicts the artifact's own first line, in a
project where the entry-point document is the one thing every agent reads, will lose. This
is the third identical occurrence (FR-D8 obs #99, and twice before); two sessions have now
tried noting it.

**Rejected — declare the suppression arm void.** Tempting and wrong. The arm suppressed the
interactive channel completely — no recall action was called across either D8 or D10 — and
what leaked is a bounded, enumerable prose summary. Voiding it discards the only control
data the experiment has (n=2 of a planned 2). Charter §10.6 already commits to reporting
honest limits rather than pretending them away; **the leak is a limit, not a
disqualification**, and R3 must be read as "no detectable difference *given a leaked
summary*."

---

## 5 — Binding

[`tests/public-surface/public-surface.test.ts`](../../tests/public-surface/public-surface.test.ts)
— **10 tests.** The first mechanism in this repository that reads a documentation file and
asserts something about its content.

| # | Asserts | Fails when |
|---|---|---|
| 1 | Every file in `src/` that calls out to the network is named in `SECURITY.md` | §2.1 regresses, from any direction |
| 2 | `SECURITY.md` does not deny an HTTP server or an auth surface while `src/index.ts` starts one | §2.2 regresses |
| 3 | Every `~/.engram/*.db` path named in the docs resolves to segments present in `src/` | A doc invents a database (**§2.3**) |
| 4 | Every `engram-*` package named in `README.md` is known-published, or carries the unpublished warning | **F3** |
| 5 | `LICENSE` is an unmodified MIT template with nothing appended | GitHub silently reverts to `NOASSERTION` (**F5**) |
| 6 | `package.json.license` matches the `LICENSE` file | npm and GitHub disagree |
| 7 | Every runtime dependency is attributed in `THIRD-PARTY-NOTICES.md` | A bundled dependency's notice goes missing (**§2.5**) |
| 8 | `SECURITY.md` is in `files[]`, so it ships in the tarball | **F2** |
| 9 | `package.json` commits no `releaseNotes` value for `prepack` to overwrite | **§2.7** — the drift returns |
| 10 | `scripts/inject-release-notes.js` does not write to stdout | **§2.7** — `npm pack --json` breaks again |

**Test 1 earned its keep while being written, which is the argument for the whole
section.** This branch's `SECURITY.md` had *already* been corrected to drop the false
agent-rules denial. It still said the only outbound calls *"come from the update check
(`update.service.ts`)"* — and `src/installer/index.ts:97` also calls `fetch()`. **The
corrected document was still wrong, by one file, and the test is what found it.** Prose
that has been carefully fixed by hand is not thereby correct; it is merely fixed once.

**Every assertion proven to fail under probe, not merely to pass.** A green test proves
nothing until it is shown red. Each probe was applied alone and reverted from a snapshot:

```
=== BASELINE (expect ALL PASS)                     ALL PASS

1  undisclosed fetch site in src/                  1 failed
2  SECURITY.md re-denies the HTTP server           1 failed
3  SECURITY.md names a nonexistent database        1 failed
4  README advertises an unlisted engram-* package  1 failed
5  LICENSE gains an appended section               1 failed
6  package.json license disagrees with LICENSE     1 failed
7  a runtime dependency loses its attribution      1 failed
8  SECURITY.md dropped from files[]                1 failed
9  a releaseNotes value is committed again         1 failed
10 prepack script writes to stdout again           1 failed

=== FINAL (expect ALL PASS)                        ALL PASS
```

**Why content assertions are legitimate here where FR-D9 rejected counts.** That suite
rejected *"there are N of X"* because it fails on every legitimate addition. These assert
**referential integrity** — that a name in a document resolves to a thing that exists. They
cannot fail on an improvement, and they cannot sit green through the regression they exist
to catch.

**FR-D9's binding adopted this one without being asked.** The suite went from 722 tests in
40 files to **733 in 41**. Ten of the eleven new tests are the ones above. The eleventh was
generated by [`tests/process/anti-drift.test.ts`](../../tests/process/anti-drift.test.ts),
which enumerates `docs/foundations/NN-*.md` and asserts that every `tests/…test.ts` path a
domain doc cites **exists and is matched by a vitest include glob** — so it cannot be
claimed as a binding while never running. It picked up `10-public-surface.md` on the first
run and passed. Second occurrence, after FR-D8 §2.4, of one domain's mechanism silently
covering another's work.

**All gates green:**

```
npm test                                    733 passed (41 files)
npm run build                               exit 0
generate-capability-surface.mjs --check     exit 0
generate-http-surface.mjs --check           exit 0
npm run deadcode                            exit 0
```

---

## 6 — Kill switch

Written now, before attachment forms.

1. **If test 3 is ever satisfied by deleting the documentation rather than publishing the
   package**, the thin clients are dead and should be removed from the repo — charter §6
   domain 8 owns *"what belongs in this repo at all."* Decide that deliberately; do not let
   a test drive it.
2. **If `SECURITY.md`'s SLA is missed once**, delete the table and replace it with
   best-effort language the same day. A published SLA that has been broken is worse than
   none, and F4 has no other recovery.
3. **If the public surface tests are edited to pass more than twice** without the underlying
   document becoming more true, they have become a formality — delete them and record that
   the public surface is ungated, rather than keeping a gate that is routinely relaxed.
   (Adopted from FR-D8 §6.1; the failure mode transfers exactly.)
4. **If a release ships before T1 lands**, T1 is moot and this document's central finding
   expires — check that before doing the work.
5. **If instrument 1 (§8) is ever re-run with a larger sample and inverts its verdict**,
   §8's conclusion goes with it. n=12 is a signal, not a result.

---

## 7 — Handed to other domains

| To | What |
|---|---|
| **Master plan** | T1's disclosure half. D11's tripwire has event triggers but **no clock** — CERT/CC's 45 days is the missing shape. And D11's first half is now stale (§2.9, task #87) |
| **FR-D8 / D14** | `packages/*` are not merely unanalysed by knip (D8 §2.7) — **two of them are documented as installable and have never been published** (§2.4). "What belongs in this repo at all" now has a second input |
| **FR-D2** | F7: the README instruction block is the same ingestion path as `agent_rules`, and CVE-2026-21852 — which `SECURITY.md:164` already cites — applies to it. The fix was applied to one and not the other |
| **Charter §10.4** | T5: generated re-exports of Engram memory are recall. Three sessions, three identical leaks |

---

## 8 — Instrument 1: the shadow judgment, finally run

Charter §10.3 names shadow judgment the **primary** instrument. It had produced **zero
output across nine completed domains** — flagged in observation #90, and again by FR-D9 and
FR-D8 without either running it. D10 is the last domain; after this there is no more sample.

**Run.** Method, sample and per-event verdicts are in
[`measurements/instrument-1-shadow-judgment.md`](measurements/instrument-1-shadow-judgment.md).

**Method.** **n = 14** recall events, reconstructed from the nine completed domain docs'
own citations of stored Engram records — the only surviving evidence, because recall events
were never logged at the time. Sample built by one agent under instructions to write every
event **neutrally**, then judged by **two independent fresh-context judges over disjoint
halves** (E-01…E-07, E-08…E-14), each answering §10.3's single question per event.

| Verdict | n | % |
|---|---|---|
| REQUIRED | 1 | 7% |
| REPLACEABLE | 10 | 71% |
| IRRELEVANT | 0 | 0% |
| **MISLEADING** | **3** | **21%** |

### 8.1 The sample is enriched, and R1 therefore cannot be read off it

**Stated first, because it is the number everyone will quote.** 21% is **not** an estimate
of the MISLEADING base rate, and R1 must not be reported as having fired.

The sample instructions required *"at least two events where the recalled item turned out to
be WRONG, STALE, or was later corrected"* — on the reasoning that a sample containing none
cannot evaluate the bucket §10.3 calls the one that matters. The builder found and included
**five**. **All three MISLEADING verdicts came from those five.** The other nine events
produced **zero**.

| Stratum | n | MISLEADING |
|---|---|---|
| Deliberately selected as corrections | 5 | 3 |
| Not so selected | 9 | **0** |

So the design that made the bucket measurable is the same design that makes its rate
uninterpretable. This is my error, and it is the one that would have mattered most had it
gone unstated: a 21% MISLEADING rate reported bare would have fired R1, retired
session-start auto-load, and been **an artefact of my own sampling instruction.** Recorded
as observation #106.

What the strata *do* support is narrower and still useful: when a stored record is wrong,
blind judges reliably identify it as misleading rather than merely unhelpful — 3 of 5, with
the other 2 judged REPLACEABLE because the correction was reachable from source anyway. The
instrument discriminates. Its calibration is unknown.

### 8.2 R4 is the finding, and it is not an artefact

R2 **does not fire**: REQUIRED + REPLACEABLE = 11/14 = **79%**, well above 50%.

R4 — *"any single memory category scores 0 REQUIRED over the full sample"* — **fires for
four of the five categories present.** The single REQUIRED verdict was a **convention**
(convention #7, the tool-call syntax error, where three prior code-only diagnoses had been
wrong and retracted — the judge's stated reason was that *"just read the code" was
demonstrably not reliable here*).

| Category | n | REQUIRED |
|---|---|---|
| decision | 5 | **0** |
| observation | 5 | **0** |
| task | 2 | **0** |
| handoff | 2 | **0** |
| convention | 1 | 1 |

**Enrichment does not explain this.** The instruction biased which events were *included*,
not how REQUIRED was assigned, and REQUIRED is the verdict the enrichment would if anything
have inflated — a corrected record is a record someone needed.

**The judges' stated reason is consistent and is the real result.** Across the ten
REPLACEABLE verdicts, the substitute they named was, repeatedly, **a committed document in
this repository**: `DEFERRED-CHANGES.md:458-460` for decision #19, `00-CHARTER.md` §10.4 for
decision #25, `STATE.md:50` for task #35, `scripts/make-golden-fixture.mjs`'s own comments
for observation #58, `generate-state.mjs` for observation #99.

> **Engram's recall is replaceable here largely because this project writes everything into
> git as well.** That is a property of *this* project, not of the tool — charter §10.6
> already warns the result cannot distinguish "Engram helps" from "Engram helps this
> project." It now has a mechanism for that warning rather than only the caveat. And it cuts
> both ways: the documentary discipline that makes recall replaceable is itself a product of
> the review that recall was supporting.

### 8.3 What this run does and does not establish

**Does:** the primary instrument is **executable**, and cost one delegation round plus two
judging rounds. The reason given across three sessions for not running it was cost. That
reason does not survive contact.

**Does not:** produce a usable base rate for R1, or an unbiased sample of any kind. n=14
against a planned 50–150; reconstructed rather than logged; enriched by construction; both
judges the same model family, which §10.6 already flags as a shared-blind-spot risk.

**R3 is unevaluable** and should be recorded as such rather than scored: it compares the
suppression arms against the judged prediction, and both arms leaked the same generated
channel (§0.1). Task **#90** carries the logging change — record recall events at the time
they happen — without which no future run does better than this one.

**The master plan should not retire anything on these numbers.** It should note that after
ten domains the primary instrument has one real run, that run's most defensible signal is
R4-shaped, and the honest sample size is fourteen.

---

---

## 9 — One failure of my own, and what it turned out to be

Convention #7 — the tool-call malformation that swallows the parameter *after* a long text
value — occurred **13 times in this session, all mine**, including inside the observation
written to report it. That makes occurrences ten through twelve land in exactly the
recursion that produced occurrence seven, which corrupted handoff #7, the record whose
purpose was to warn about it. Observations **#100, #101, #102 and #104 are permanently
corrupt.**

My first diagnosis was that the caller confuses the closing tag with the parameter name.
**A control probe falsified it.** Observation #103 — one short sentence, single parameter —
is byte-clean, and so is every short write after it.

> **The cause is length, not knowledge.** Every corrupted write was a long multi-paragraph
> value; every clean one was short. That is why four agents across two model families have
> been warned, have explicitly resolved to be careful, and have reproduced it anyway.
> *"Be careful with parameters"* has now failed thirteen consecutive times, and it was never
> going to work — it addresses attention, and attention is not the variable.

The signature is exact and machine-checkable: a stored text field ending in a closing tag,
optionally followed by `<parameter name=` or `</invoke>`, with the next parameter NULL.
Decisions #16–#19 and #27 carry it one field earlier, with `rationale` NULL — which is why
this document put its rationale in the `rationale` field and checked. **This turns FR-D9's
T2 (task #77, *reject malformed records on write*) from an intention into a one-regex
acceptance test.** Task **#91**, which also carries the second half: there is no
`update_observation` action, so nothing corrupted this way can ever be repaired — including
FR-D9's 51 measured corrupt records.

Recorded rather than smoothed over, because a domain about documents that mislead their
readers has no standing to quietly fix its own.

---

<!-- FOUNDATIONS_D10:COMPLETE -->
