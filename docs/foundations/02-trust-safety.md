# Domain 2 — Trust & Safety

**Foundations Review** · Charter: [`00-CHARTER.md`](00-CHARTER.md) §6 domain 2, §7 template
**Owns:** the adversary — threat model, provenance, injection surfaces, secrets, encryption, and **what we refuse to promise.**
Concurrent-agent trust → domain 4. Durability of the data → [domain 1](01-durability.md).
**Status is not carried here.** It lives in the Engram task board.

> ### ⚠️ T4 and T6 have shipped; T5 is half done — findings below are the state at review time
>
> **2026-08-07, commits `e9cc88d` and `ad56060`.** Fixed ahead of publishing this
> branch, because these pages describe weaknesses in the line released as
> v1.13.0 and pushing the description before the fix is disclosure.
>
> - **T6 — DONE.** Host allow-list on every request (`403 FORBIDDEN_HOST`, before
>   CORS and before `/health`, repeated in the raw WS upgrade which inherits no
>   middleware); constant-time token compare; token moved to the URL fragment.
>   Item 3 of that target, `/health` reporting a hardcoded `1.9.0`, had already
>   been fixed under FR-D6 — the task row was stale on it.
> - **T4 — DONE.** The three false sensitivity claims are corrected, plus a
>   fourth the target did not name: `mark_sensitive`'s **response**, which said
>   "Marked N record(s) as sensitive" and stopped. It now returns
>   `enforced: false`. The code is still unwired on purpose — whether to
>   implement or delete it is domain 4's call (charter §8).
> - **T5 — PARTIAL.** Every claim that was outright FALSE is corrected, and the
>   refusals section exists in `SECURITY.md`. One correction this review missed:
>   `SECURITY.md` listed `agent_rules_cache.json` among files Engram reads and
>   writes, and it reads and writes no such file — the inventory predates the N1
>   fix that removed it. Still open: the three duplicated README claims, the
>   backup.ts/README "No cloud" contradiction, and the claims-manifest gate.
>
> Everything else on this page — T1 provenance, T2 trust tier, T3 normalisation,
> and failure modes F1–F4 — remains open. Task board is authoritative.

> The deep audit already named this domain's central sentence, and nothing found
> since has displaced it:
>
> **Engram's `agent_rules` mechanism is structurally identical to CVE-2026-21852
> ("MemoryTrap"), which Anthropic patched in Claude Code v2.1.50 by removing
> memory from the system-prompt injection path entirely.**
>
> `agent_rules` is now fixed. The *pattern* — storing text and replaying it into
> an agent's context unprompted — is the product, and cannot be patched out.

---

## 1 — Claims · 2 — Reality

32 claims inventoried. **9 TRUE · 15 PARTLY TRUE · 4 FALSE · 4 other.**
Full evidence table with `file:line` for every row is Engram observation **#65**;
the lead's re-verification, including two corrections, is observation **#68**.

Grades per charter §5. Everything below is **VERIFIED** unless marked otherwise.

### The four that are false

| ID | Claim | Reality |
|---|---|---|
| **D2-C25** | *"Cross-instance queries automatically filter out sensitive items"* · *"Lock specific records as sensitive (hidden from cross-instance queries)"* — `sensitive-data.service.ts:5-7,77-78`, `find.ts:92` (**agent-facing**) | **The feature does not execute.** `filterSensitive` (`:129`) and `isAccessApproved` (`:256`) have **zero callers** in `src/`. `cross-instance.service.ts` contains no occurrence of "sensitive" and queries with plain `SELECT *`. Marking a record sensitive changes nothing about what another instance can read. Documented, tested in isolation, exposed as three MCP actions, **inert** |
| **D2-C4** | `SECURITY.md:125-131` — *"Engram reads and writes:"* followed by a 4-item list | **Not exhaustive.** Also writes `.engram/token`, `.engram/.gitignore`, `.engram/git-changes.log`, `~/.engram/instances.json`. Also reads `/etc/machine-id` and the Windows registry (`utils.ts:505-523`) |
| **D2-C20** | `README.md:779` — *"`export` serializes everything to JSON. You own it entirely."* | 8 tables (`dispatcher-admin.ts:169`); import is decisions-only. D1's finding; listed here because *"you own it entirely"* is a **trust** claim |
| **D2-C17** | `README.md:833` — *"every HTTP request and WebSocket connection is validated against the `?token=` query parameter"* | **Corrected by the lead from FALSE to PARTLY TRUE — see §2b.** Both transports *are* authenticated. The described mechanism is wrong for one of them |

### The load-bearing one, which is only "partly true"

| ID | Claim | Reality |
|---|---|---|
| **D2-C31** | `find.ts:292`, agent rule **AR-02**, priority **CRITICAL**: *"Call `get_file_notes` before opening any file. Open only if notes are absent or stale."* | Freshness detection is real — `withStaleness` (`dispatcher-memory.ts:63-81`) compares mtime and verifies a SHA-256 `content_hash`. But `confidence: "high"` (`:76`) means *"this file has not changed since somebody wrote this note."* It carries **no information about whether the note was ever correct**, and `file_notes` (`migrations.ts:61-71`) has **no author column**. A note written by a confused or hostile agent is replayed at high confidence indefinitely — and AR-02 instructs the next agent to read it **instead of the file**. **The field that gates substituting stored text for ground truth is named `confidence` and measures freshness.** |

### The rest, in brief

**PARTLY TRUE:** C1, C2, C3 (SECURITY.md and both architecture diagrams omit the
HTTP/WS surface, `~/.engram/instances.json`, and the global DB — all true *by
default*, false for the shipped dashboard mode) · C5 (`getFileHash` reads full
file contents at `utils.ts:472-479`; contents are hashed, never stored, so the
spirit holds and the sentence does not) · C7 (**the outbound sweep came back
clean** — `update.service.ts:72` is the only runtime network call, a bare GET;
the N1 GitHub fetch is genuinely gone) · C8 (a GET discloses an IP; definitional,
flagged as a judgment call not a code fact) · C13/C14/C15 (**the same claim
written three times** — `README:135`, `:779`, `:1293`; `tool-telemetry.ts:69-96`
logs every call locally, so the codebase uses the word "telemetry" for a thing
the README says does not exist) · C16 · C18 (`0o600` excludes other *users*, not
other *processes as the same user* — which is precisely the threat the sentence
names; a no-op on Windows, and `ENGRAM_CONSTITUTION.md:95` already concedes this
while README does not) · C21 · C24 · C26 · C27.

**TRUE — stated because a review that finds everything broken is as useless as
one that finds nothing:** C6 (`file_notes` genuinely has no content column) ·
C9 · **C10** (agent rules ship in the package, `source:"packaged"` is a typed
literal with no other possible value, and a leftover cache is detected, logged,
refused and *not deleted* — this section is accurate and unusually honest about
its own past) · C11 · C12 · C19 (binds `127.0.0.1` explicitly, CORS allow-list is
loopback-only) · C22 (**"one list, both doors"** holds exactly as written) ·
C28 (sharing genuinely defaults to `none` and is enforced at two sites) ·
**C30** (*no encryption claim exists anywhere* — the product correctly declines
to over-promise, and the Constitution discloses the Windows weakness the README
omits).

**Undisclosed, found by inventory rather than by claim:** **C29** —
`database.ts:167-168` writes every project's `project_root`, `db_path`,
`machine_id`, versions, PID and record counts into machine-wide
`~/.engram/instances.json` on **every** `initDatabase`, regardless of
`sharing_mode`, disclosed in neither SECURITY.md's file list nor the README.
Local-only, so not a "data leaves the machine" violation — but it is the
mechanism by which one project's Engram learns every other project's absolute
path. **C32** — `backup.ts:21` tells agents to save the database to *"Dropbox,
OneDrive, Google Drive"* while README:79 and :779 say *"No cloud."* Both texts
cannot stand.

### 2b — Two corrections the lead made to the delegated reports

Recorded rather than quietly folded in, per charter §5.

**The WebSocket is authenticated. I nearly published that it was not.**
`index.ts:212-225` rejects any path but `/ws`, then
`if (url.searchParams.get("token") !== token)` → 401, destroy. I suspected
otherwise because `token` appears in `http-server.ts` only at lines 40, 47 and
79 — the check lives in `index.ts`. **A grep-shaped hole read as a security
hole; the third instance of that on this project.** The claim inventory had
graded C17 FALSE on both halves; the correct grade is PARTLY TRUE. HTTP `/api`
uses `Authorization: Bearer`, WS uses `?token=`, and the README describes one
transport's scheme for both. A user following it puts the token in a URL, gets a
401, and is told nothing. That is a documentation defect with a real cost — not
an authentication bypass, and grading it FALSE would have overstated a security
claim inside a security document.

**Attack path 3 does not exist.** The injection report flagged
`tools/export-import.ts` (JSON.parse of an arbitrary path → insert conventions
with `enforced` taken from the file → `INSERT OR REPLACE` over `file_notes`) and
honestly marked reachability unverified. Settled: `registerExportImportTools` is
referenced **nowhere**. The HTTP route of the same name is a different 47-line
file whose `POST /import` is a **stub** returning `{status:"staged"}` while
writing nothing. Two separate consequences: the attack is not real, and *the
endpoint lies about staging something it discards* — which is D6's.

---

## 3 — Failure modes

Silence is scored explicitly. A loud failure is cheaper than a quiet one.

| # | Trigger | Blast radius | Silent? | Recovery |
|---|---|---|---|---|
| **F1** | Any agent writes a handoff. `next_agent_instructions` is stored raw — presence-checked, uncapped | Auto-replayed **raw and untruncated** at every next session start (`sessions.ts:478,491`), in the same flat JSON object as `agent_rules` | **Total** — a field literally named *instructions*, delivered unprompted, indistinguishable from Engram's own directives | None |
| **F2** | Any agent writes a task description | Returned **in full** to every sub-agent spawned against that task (`sessions.ts:253`), with no `agent_rules` and no framing. Confirmed empirically: the delegated agent's own session start returned task #37's full text | **Total** | None |
| **F3** | A file note is wrong — hostile or merely confused | Replayed at `confidence: "high"` forever, and AR-02 tells the next agent to trust it **over the file** (D2-C31) | **Total** — freshness is measured, correctness is not | None |
| **F4** | Concurrent agents write memory | `getCurrentSessionId()` is called **bare at every single write site**, resolving to *"the newest open session belonging to anyone"* | **Total** | None — and see §3a |
| **F5** | User marks a record sensitive and enables sharing | Nothing filters it. The record is returned to any querying instance (D2-C25) | **Total** — the UI, the tool description and the tests all say otherwise | None |
| **F6** | User reads SECURITY.md to decide whether to install | 19 of 32 claims are wrong or incomplete; the file list omits four written paths and two read paths | Loud in effect, silent at the time | Read the source |
| **F7** | `--mode=dashboard`, malicious page in the same browser | DNS rebinding reaches `/health` and the static SPA. `/api` and `/ws` require the token, so **memory is not reachable**. `/health` also reports a hardcoded, wrong version (`"1.9.0"`) | Partly | Opt-in mode; close the dashboard |
| **F8** | Any same-user local process | Reads `.engram/token`, or skips the API and opens `memory.db` directly. `0o600` is the wrong boundary for the threat README:808 names, and a no-op on Windows | **Total** | None — this is a stated limit, not a bug (§4 T7) |
| **F9** | Engram opened in any project | Absolute path, machine_id and counts written to machine-wide `~/.engram/instances.json` (D2-C29) | **Total** — undisclosed | Delete the file; it is rewritten |

### 3a — The finding that outranks the rest

**Provenance is not merely missing. It is actively wrong, and the fix was
written down and never applied.**

`database.ts:getCurrentSessionId(agentName?)` carries this comment, added *by the
N3a fix*:

> *"the unscoped form answers 'the newest open session belonging to ANYONE'.
> Since sessions are no longer force-closed on every start, more than one may be
> open at a time, so any caller that knows its own identity should pass
> `agentName`."*

**Zero call sites pass it.** Not one — `dispatcher-memory.ts` at lines 364, 396,
417, 456, 478, 512, 554, 595, 683, 698, 813, 873, 893, 946, plus `changes.ts`,
`conventions.ts`, `coordination.ts`, `decisions.ts`. Under the concurrent-agent
configuration this product is built for — and which this review has been running
all week — a memory row is attributed to whichever session was newest and open,
not to its author.

Tables with **no author column at all**: `decisions`, `conventions`, `tasks`,
`changes`, `file_notes`, `milestones`, `snapshot_cache`. **No table on any schema
records the ingress route.** And `record_observation` takes `agent_name`
*straight from client params* (`dispatcher-memory.ts:1024`) — a self-report.

### 3b — Prior art: how this has gone wrong for other people

Searched as failure literature. The results **removed more options than they
confirmed**, which is the outcome the charter says to look for.

**The mitigation shelf is empty. This is the most consequential finding in the
domain and it kills the obvious plan.**

- **12 published prompt-injection defences, attack success rate above 90% for
  most, and *"the majority of defenses originally reported near-zero attack
  success rates."*** *The Attacker Moves Second*, <https://arxiv.org/abs/2510.09023>
  — abstract **verified by the lead**; the per-defence table (Spotlighting
  1%→>95%, Sandwiching 1%→>95%, MetaSecAlign 2%→96%, Circuit Breakers→100%,
  PromptGuard/ProtectAI/ModelArmor→>90%) is **REPORTED**, from the paper body.
  **Consequence: delimiters, "this is data not instructions" preambles, and
  injection classifiers are not available to us as controls, and must not be
  described as such.**
- Meta's purpose-built classifier fell to **inserting spaces between letters**
  (100% → 0.2% accuracy) — <https://github.com/meta-llama/llama-models/issues/50>.
  Any regex or keyword scan we write is strictly weaker than that.
- Instruction-hierarchy prose in a system prompt is not a control — 0.68–0.75 ASR
  — <https://embracethered.com/blog/posts/2024/chatgpt-gpt-4o-mini-instruction-hierarchie-bypasses/>
- **Contradicting evidence, deliberately kept.** LLMail-Inject: all three
  defences bypassed, yet end-to-end success only 0.8% / 0.3%, and the authors
  hold that defences have *"practical value"* — <https://arxiv.org/abs/2506.09956>.
  **The honest posture is "raises cost, does not prevent" — so the *documented
  security property* must be zero.**

**Our exact architecture has already been measured.**

- **MemGhost** — one email → a write into session-start-loaded memory → the
  agent's reply conceals the write. **87.5% (GPT-5.4), 71.4% (Claude Code SDK)**,
  against plain-file *and* vector stores. The vendor called it out of scope and
  pointed at provenance, audit and confirmation.
  <https://thehackernews.com/2026/07/new-memghost-attack-plants-persistent.html>
  **Consequence: the audit record must be server-generated at write time — the
  agent's self-report is part of the attack.** (`record_observation` currently
  takes `agent_name` from client params.)
- **MINJA** — memory poisoned through query-only interaction; 98.2% injection,
  76.8% attack. <https://arxiv.org/abs/2503.03704> **Consequence: "only the local
  user writes to our database" is not a defence.** The writer is our own
  legitimate agent, acting on hostile input.
- **PoisonedRAG** — 5 poisoned texts among 2.68M → 97% ASR; retrieval embeds the
  query verbatim, so a record shaped for *"what should I know about this
  project"* wins a session-start replay. <https://arxiv.org/abs/2402.07867>
  **Consequence: dilution arguments are arithmetically dead.**

**Approval and consent do not work where we would have put them.**

- **Approval dialogs are not a control.** MCP never requires the bytes a human
  approves to equal the bytes the model receives; Unicode TAG block
  (U+E0000–E007F) is invisible in every mainstream renderer; 8/8 techniques
  landed payloads across 3 MCP libraries. <https://arxiv.org/abs/2607.05744>
- **CVE-2025-59536** (SessionStart hook from a cloned `.claude/settings.json`)
  and **CVE-2026-21852** — *"a dialog was shown"* was the defence in both, and it
  failed both times.
  <https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/>
- **Line jumping** — payloads enter context at connect time, *before* any gate,
  so consent must gate **context insertion, not tool invocation**.
  <https://blog.trailofbits.com/2025/04/21/jumping-the-line-how-mcp-servers-can-attack-you-before-you-ever-use-them/>
- **MCPoison (CVE-2025-54136)** — Cursor bound approval to an MCP entry's *name*.
  **Pin content hashes, never names.** <https://research.checkpoint.com/2025/cursor-vulnerability-mcpoison/>

**"It only binds to localhost" failed three times inside MCP itself.**

- **CVE-2025-49596** — MCP Inspector, CVSS 9.4, DNS rebinding.
  <https://www.oligo.security/blog/critical-rce-vulnerability-in-anthropic-mcp-inspector-cve-2025-49596>
- **CVE-2025-66416 / 66414** — the official Python and TypeScript SDKs shipped
  DNS-rebinding protection **off by default**; CVSS 7.6, fixed in 1.23.0.
  <https://github.com/advisories/GHSA-9h52-p55h-vw2f> — **verified by the lead.**
  **Calibration:** the advisory's precondition is *"run on localhost **without
  authentication**"*. Our `/api` and `/ws` both require the token, so the data
  endpoints do not match it. What rebinding reaches here is `/health` and a
  static asset bundle. Real, small, and stated at its true size — not imported
  at the CVE's severity because the CVE is more dramatic.
- **No token in a URL.** Portainer GHSA-jvp4-q659-95mj harvested JWTs from
  `?token=` via logs and `Referer`; an injected `<meta name="referrer">` forces
  full-URL leakage. **Our dashboard renders memory content, so that primitive
  points at our own token** — which we put in a URL for the WS upgrade.

**Two more that change specific decisions.**

- **Rules File Backdoor** — invisible Unicode in repository files, invisible in
  the editor *and* in the PR diff; Cursor and GitHub both declined it as "user
  responsibility". <https://www.pillar.security/blog/new-vulnerability-in-github-copilot-and-cursor-how-hackers-can-weaponize-code-agents>
  **Consequence: a file summary must inherit its source's untrusted provenance,
  or summarising laundo it into Engram-authored trusted text.**
- **postmark-mcp** — 15 clean versions, then one BCC line in 1.0.16. No CVE, no
  advisory feed. <https://www.koi.ai/blog/postmark-mcp-npm-malicious-backdoor-email-theft>
  **Consequence: download-count and reputation trust is defeated; our own
  14-IDE install path is the same shape.**
- **Best-supported structural defence: trust-aware retrieval — provenance as a
  *ranking input*, not an audit field.** <https://arxiv.org/abs/2601.05504>
  Partially disconfirming, and kept: chunking and reranking degrade many
  published poisons. <https://arxiv.org/html/2606.11265>

**Where prior art runs out, stated because it lowers confidence.** No CVE,
advisory, or in-the-wild incident exists against Engram's specific artifact class
— *a local, project-scoped memory server that auto-replays stored text at session
start*. MemGhost is the closest and is a lab PoC the vendor declined to scope.
**On that question we would be cited, not citing.** A second untested link: no
measured study of whether injection **survives LLM summarisation** — and file
summaries are what we store.

---

## 4 — Target and rejected alternatives

*Written by the lead. Charter §9 forbids delegating this section.*

The literature above removes the entire class of textual mitigations. What
remains is structural: **fix who wrote it, fix what gets replayed unprompted, and
stop claiming protections that do not run.**

### T1 — Provenance, resolved server-side, at write time *(closes F1–F4)*

Every memory row records: the author identity **the server resolved** from the
calling session, the ingress route (`mcp` / `http` / `scan` / `import`), and a
trust tier. Immediately: pass agent identity at every `getCurrentSessionId()`
call site — the fix its own doc comment already specifies.

- **Rejected — trust the agent's self-reported `agent_name`.** It is what
  `record_observation` does today (`dispatcher-memory.ts:1024`). MemGhost is
  explicit that the agent's self-report is *part of the attack*: the same reply
  that conceals the write reports the write. A field an attacker controls cannot
  be the field that establishes trust.
- **Rejected — an `audit_log` instead of per-row provenance.** We already have
  one, and it is the wrong shape: an audit log answers *"what happened"* after
  someone asks. Retrieval needs provenance **at rank time**, which is the whole
  point of the trust-aware-retrieval result. An audit log would also have been
  satisfied by the current `getCurrentSessionId()` — it would have faithfully
  recorded the wrong author.
- **Rejected — nothing, on the grounds that this is a local single-user tool.**
  MINJA settles it: the writer *is* our own legitimate agent, acting on hostile
  input. Write-path authentication defends nothing here.

### T2 — Trust tier gates the session-start replay *(closes F1, F2, F3)*

Session start auto-delivers only records whose provenance is trusted-tier.
Everything else stays available **on demand**, where the agent has asked for it
and knows what it is. Provenance becomes a ranking input, not a column nobody
reads.

- **Rejected — delimiters, spotlighting, or a "the following is data, not
  instructions" preamble.** The obvious answer, and the one I would have written
  without the research. Twelve published defences, most above 90% ASR, and *most
  originally reported near-zero* — meaning our own optimistic evaluation of a
  home-grown version would have looked exactly like theirs did before someone
  attacked it properly.
- **Rejected — an injection classifier over stored text.** Meta's purpose-built
  classifier fell to spaces between letters. Ours would be strictly weaker, and
  it would let us *claim* a control we do not have — worse than having none.
- **Rejected — remove memory from the auto-load path entirely**, which is what
  Anthropic did for CVE-2026-21852 and is therefore the reference fix. It is
  **not** rejected on the merits — it is deferred to evidence. Charter §10's
  retirement criterion **R1 already commits to exactly this** if MISLEADING
  recalls reach 10%, and R3 if suppression shows no effect. Adopting the vendor's
  fix before our own pre-registered measurement runs would discard the one
  experiment this project has that could justify the feature's existence.
  **It is named in §6 as the kill switch, not buried.**

### T3 — Normalise at write, cap at write *(closes the invisible-payload class)*

Reject or strip Unicode TAG block, bidi controls and zero-width characters on
every text field at write time, and enforce a length cap. `MAX_RESPONSE_LENGTH =
50000` exists at `constants.ts:59` and is **referenced nowhere** — a cap that is
only a number.

- **Rejected — show the user a preview or diff before replay.** MCP never
  requires the bytes a human approves to equal the bytes the model receives;
  TAG-block characters are invisible in every mainstream renderer, and 8/8
  techniques landed. A preview is a control only if we normalise first *and*
  render exactly the replayed bytes — at which point the normalisation is doing
  the work and the preview is decoration.
- **Rejected — sanitise on read instead of write.** Cheaper to retrofit, and
  wrong: the record is already in the store being counted, searched and ranked,
  and every future read path has to remember. Normalising at the boundary is one
  place instead of many.

### T4 — The inert security feature goes, or gets wired. There is no third option *(closes F5)*

`sensitive_data` is documented, tested, exposed as three MCP actions, and does
nothing. **Immediately: delete the claims** — `find.ts:92` is agent-facing and
is the one an AI reads before deciding what to lock. Whether the code is wired or
deleted is D4's call, since cross-instance is D4's surface.

- **Rejected — leave it and document the limitation.** A security feature that
  does not execute is worse than one that does not exist: users lock records and
  change their behaviour on the strength of it. The claim is the harm.
- **Rejected — wire it now, inside D2.** It would be solving a cross-instance
  problem inside the threat-model domain, which charter §8 forbids for good
  reason. The false claim is D2's and goes today; the implementation is D4's.

### T5 — Claims get a gate, because 19 of 32 drifted *(closes F6)*

Every security or privacy claim moves into one machine-checkable manifest, each
row naming the claim, its source `file:line`, and the check that would fail if it
stopped being true. C13/C14/C15 are the same sentence in three places — fixing
one leaves the product still saying it.

- **Rejected — careful review at release time.** *"Be careful"* is not a binding
  (charter §7 §5). This exact review is what careful review looks like, it took
  three agents and a day, and it found 19 drifted claims that had shipped.
- **Rejected — delete the claims and say nothing.** Silence is a worse promise
  than a limited one; C30 shows the product is already good at declining to
  over-promise, and that is the model to extend.

### T6 — HTTP mode: close what the localhost literature says will be attacked *(closes F7)*

`Host`/`Origin` allow-list on every request; `timingSafeEqual` for the token
compare; `/health` reports the real version or nothing; the WS token moves out of
the query string.

- **Rejected — "it is loopback-only and opt-in, so this is theoretical."** That
  assumption failed three times *inside MCP itself*, including in Anthropic's own
  SDKs, which shipped rebinding protection off by default. Cost is a few lines.
- **Rejected — treating it at CVE-2025-49596's severity.** The Inspector CVE and
  the SDK advisory both require an unauthenticated localhost server. Ours
  authenticates `/api` and `/ws`. Importing the severity along with the mechanism
  would be the same error as ranking the SQLite WAL bug above the restore no-op
  in D1.

### T7 — Write down the refusals *(the section most reviews skip)*

Stated as commitments, not caveats:

1. **We do not promise stored memory is true.** Provenance says who wrote it;
   nothing says it is correct.
2. **We do not defend against a same-user local process.** It can read
   `.engram/token` or open `memory.db` directly. `0o600` excludes other *users*,
   and is a no-op on Windows.
3. **No encryption at rest or in transit.** Already true of the product (C30);
   now explicit.
4. **Injection defence raises cost and does not prevent.** Per LLMail-Inject the
   documented security property is **zero**.
5. **DoS via large inputs stays out of scope** — consistent with SECURITY.md:102
   and with there being no rate limiting.

- **Rejected — omitting the refusals to avoid handing an attacker a map.** The
  attacker has the source; the user does not have the caveats. Every item above
  is discoverable in an afternoon by anyone who would act on it, and the only
  party the silence protects is us.

---

## 5 — Binding

Charter §2: coupled to something that breaks a build. *"Be careful"* is not a binding.

| Target | Mechanism | State |
|---|---|---|
| **T4**, and the whole *inert feature* class | **`tests/security/no-inert-surface.test.ts`** — resolves every exported `register*Tools` symbol against all of `src/` and compares the unreferenced set to a committed baseline. **A new unreachable module fails CI; removing one fails until the baseline is updated, as a reviewable diff.** This is the gate that would have caught D2-C25, and D1's dead safe-restore, and audit finding N4 | **Built this session** |
| T1 | A test asserting every write path records a non-null server-resolved author; and that no `getCurrentSessionId()` call site is bare | Task |
| T3 | A test asserting TAG-block, bidi and zero-width characters are rejected at write on every text field | Task |
| T5 | The claims manifest, checked in CI the way `CAPABILITY-SURFACE.md` is | Task — **and it is D9's `claim-text drift has no gate` handoff from D1, arriving with 19 instances of evidence** |
| T6 | A test asserting a foreign `Origin`/`Host` is refused | Task |
| T2 | **Honestly, none yet.** Trust-tiered replay cannot be bound until trust tiers exist (T1). Stated rather than papered over: **T2 is the most important target in this document and currently the least bound** | Gap |

---

## 6 — Kill switch

Written before attachment forms (Trellis §17).

- **T2 reverses into deletion** if charter §10's **R1** fires (MISLEADING ≥ 10%
  of judged recalls) or **R3** fires (suppression shows no detectable
  difference). Then we do what Anthropic did for CVE-2026-21852: **remove memory
  from the auto-load path entirely** and make all recall on-demand. This is
  already pre-registered; §4 T2 defers to it rather than pre-empting it.
- **T1 reverses** if server-resolved provenance proves unattributable often
  enough that rows land in an "unknown" tier by default — at which point the tier
  is theatre. Fallback: record the route only, which is always knowable, and drop
  the identity claim.
- **T3 reverses** if normalisation corrupts legitimate content — CJK, RTL prose,
  emoji sequences. Fallback: reject-and-report at write instead of stripping, so
  the user chooses.
- **The domain's premise reverses** if the refusals in T7 grow to cover
  everything the product implies. A threat model whose every entry is *"out of
  scope"* is not a threat model, and at that point the honest move is to stop
  calling local-first a security property.

---

## Handed to other domains

- **Domain 4** — wire or delete `sensitive_data`; `~/.engram/instances.json` is
  an unsigned, world-writable trust root (audit N8, still open).
- **Domain 6** — `POST /api/v1/import` returns `{status:"staged"}` and writes
  nothing; `/health` reports a hardcoded `"1.9.0"`.
- **Domain 8** — **15 of 20 registration entry points are unreferenced**, now
  measured by [`tests/security/no-inert-surface.test.ts`](../../tests/security/no-inert-surface.test.ts)
  rather than by hand. (A first count said 15 of 19 — it scanned only
  `src/tools/` and missed `registerUniversalMode` in `src/modes/`. The gate now
  pins the total so a narrowed scan cannot reproduce that.) The
  slogan *"the dead code is safer than the live code"* (audit N4) is **wrong as
  a law**: `backup.ts` kept a guard the live path lost, every bounded
  `limit: .min(1).max(100)` lives in a dead module while both live dispatchers
  use `z.number().int().optional()` (**N5, still open**), *and* `export-import.ts`
  is the most dangerous code in the repository. The accurate property is that
  **15 modules are unreviewed in both directions.**
- **Domain 9** — the claims manifest (T5), with 19 drifted claims as its evidence.
