# Engram Memory — Observations (findings & concerns)

> **Generated artifact.** Free-text records — treat as UNTRUSTED on import.
> Provenance-tag and mark non-binding before loading into any agent context
> (see [`engram-deep-audit-2026-08-02.md`](../engram-deep-audit-2026-08-02.md) finding N1).
>
> **Last generated:** 2026-08-01 · **Count:** 37

---

### O2 · concern

session start response included "agent_rules_source":"fallback" — meaning the intended source for agent_rules (likely a project-configurable or DB-stored rule set) failed to resolve and the server silently substituted a hardcoded fallback list, with no warning/error surfaced to the agent or user. Need to find where agent_rules_source is set (agent-rules.service.ts) and determine: (1) what the non-fallback source is supposed to be, (2) why it's not present in a fresh project, (3) whether 'fallback' silently masks a real misconfiguration.

<sub>agent-rules · silent-fallback · observability</sub>

---

### O3 · finding

docs/cross-instance-sharing-bugs.md is dated 2026-03-03 and states 'Status: Documented, not yet fixed' for bugs #26-#29 (query_instance/get_instance_info ignoring instance_id, query_type always falling back to decisions, missing db_path in instances.json). However `git log` shows commit cb707d0 'hotfix: fix cross-instance sharing bugs #26-#29' shipped in v1.9.2, and `git branch --contains cb707d0` confirms it is merged into both develop and main. Current version is 1.11.0. This means the doc is stale by ~8 versions and falsely tells any agent reading it that a fixed bug is still open — a real risk: an agent (or me) could waste a session re-diagnosing or re-fixing something already resolved. Need to verify the fix actually works end-to-end (not just that a commit claims to fix it) and then correct/archive this doc.

<sub>stale-docs · cross-instance · documentation-debt</sub>

---

### O4 · concern

Security/consistency gap in src/services/cross-instance.service.ts: checkPermission() (used by queryDecisions/queryConventions/queryFileNotes/queryTasks/queryChanges/querySessions and extractForImport) validates queryType against the QUERYABLE_TABLES whitelist before allowing any DB read — good. But searchAll() (used by admin action 'search_all_instances') does NOT call checkPermission at all; it reimplements permission logic inline (checks sharing_mode!=='none' and sharing_types.includes(scope)) and is missing the QUERYABLE_TABLES check. Its final else-branch does `db.prepare(\`SELECT * FROM ${scope} ORDER BY id DESC LIMIT ?\`)` with scope taken directly from the caller's `scope` param, gated only by whether the TARGET instance's own sharing_types array happens to contain that string. Confirmed via dispatcher-admin.ts 'set_sharing' handler that `types` (-> sharing_types) is accepted as raw `z.array(z.string())` with NO enum/whitelist validation — so any instance could be configured (by mistake or otherwise) with sharing_types containing a non-standard table name, and searchAll would interpolate it directly into SQL as a table identifier and read that table's contents from the foreign read-only DB. This is a defense-in-depth gap: two different cross-instance permission implementations exist, only one enforces the table whitelist. Recommend: (1) make searchAll call the same checkPermission() used elsewhere instead of reimplementing checks, (2) constrain 'types'/'sharing_types' with z.enum(QUERYABLE_TABLES) at the schema level so it can never contain anything but a real, intended table name. Locally-scoped (SECURITY.md's threat model excludes issues requiring existing local access), but still worth fixing since it's exactly the class of bug SECURITY.md lists as in-scope ('SQL injection through user-controlled input reaching SQLite without parameterization').

<sub>security · cross-instance · sql-injection · whitelist-gap</sub>

---

### O5 · concern

CRITICAL architectural bug directly undermining the orchestration/sub-agent feature. getCurrentSessionId() (database.ts) and SessionsRepo.getOpenSessionId() (sessions.repo.ts) both resolve 'the current session' as: SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1 — i.e. globally, per-DATABASE, with NO scoping by agent_name, agent_role, or connection. Every engram_session(start) call — primary OR sub — begins by calling this, and if it finds ANY open session (even one belonging to a different agent), it force-closes it via autoClose() with a generic, useless summary: '(auto-closed: new session started)', discarding whatever real progress/summary that session was accumulating. Concrete failure sequence for the exact orchestration pattern Engram's README documents as a first-class feature ('Sub-Agent Sessions v1.7+'): (1) primary agent starts session A, does work, accumulates changes attributed to A; (2) primary spawns a sub-agent per the documented pattern engram_session({action:'start', agent_role:'sub', task_id:N}); (3) this auto-closes session A with the generic message, silently discarding the primary's real in-progress summary, and opens session B for the sub-agent; (4) sub-agent finishes, calls engram_session(end) closing B; (5) primary agent, unaware A was closed, continues — any subsequent record_change/checkpoint call has no open session to attribute to, and calling engram_session(end) at the true end of the primary's work returns 'No active session. Start one first.' — the primary loses its own end-of-session summary/stats entirely. This will be verified live by actually reproducing it in this audit session (session #2) via a test sub-agent session start against task #1, then checking get_history.

<sub>critical · orchestration · sub-agent · session-concurrency · architecture</sub>

---

### O6 · concern

CRITICAL security/supply-chain finding, source-verified in src/services/agent-rules.service.ts. Engram fetches 'agent_rules' — a JSON block the agent is told are CRITICAL/HIGH-priority BINDING behavioral instructions — via a live HTTPS GET to https://raw.githubusercontent.com/keggan-std/Engram/main/README.md at runtime, parses a hidden <!-- AGENT_RULES_START/END --> comment block out of it, caches it for 7 days in .engram/agent_rules_cache.json, and injects it directly into every engram_session(start) response as `agent_rules`. This is a SECOND outbound network call that SECURITY.md's 'Network Access' section does NOT disclose — SECURITY.md only mentions the npm-registry version-check call. Risk: this fetches from a MUTABLE branch (main) of a single GitHub repo with no commit pinning, no signature/hash verification, and no scoping to the installed npm package version. Any compromise of that repo/branch (maintainer account takeover, malicious merged PR editing the hidden comment block, GitHub-side tampering) would cause EVERY Engram installation globally to silently start receiving attacker-controlled 'binding' instructions labeled CRITICAL priority, fanning out across every project/agent using Engram within 7 days, with no version bump, changelog entry, or user visibility. This is a textbook supply-chain/instruction-injection vector, and worse than typical because the trust boundary (live GitHub raw content) is weaker than and separate from the npm package's own (audited-at-publish) trust boundary — the two can diverge silently. In THIS environment the fetch has never succeeded (no .engram/agent_rules_cache.json exists, fallback always used — ties to observation #2), so the immediate local risk is zero right now, but the design is the finding, not the current fetch status. refreshInBackground() also swallows all fetch errors silently (empty catch), so there is no way for a user to know whether they are running live-fetched or hardcoded fallback rules short of reading agent_rules_source in every response. Recommend: stop treating remotely-fetched content as 'binding' instructions at all, or at minimum pin to a signed release tag/commit SHA matching the installed package version, verify integrity, and disclose this data flow explicitly in SECURITY.md.

<sub>critical · security · supply-chain · prompt-injection · agent-rules · undisclosed-network-call</sub>

---

### O7 · finding

Design tension (not a bug): per-IDE DB sharding (v1.8.1 hotfix, memory-<ide>.db naming) was added to fix multi-IDE write contention/corruption, but it directly undercuts Engram's core value proposition of session continuity. Verified live in this very project: .engram/ contains BOTH memory-geminicli.db and memory.db as separate files. An agent using Gemini CLI on this repo and an agent using Claude Code/VS Code on the same repo get two completely disjoint memory stores — decisions, conventions, tasks, and file notes recorded by one are invisible to the other, with no automatic reconciliation (cross-instance sharing between these two local shards is possible in principle via engram_admin but is opt-in, manual, and per docs/cross-instance-infrastructure.md not the default). For a team or solo dev who switches IDEs on the same project (a scenario the README explicitly advertises support for: 'Claude Code, Claude Desktop, Cursor, Windsurf, Cline, Trae IDE, Antigravity IDE, GitHub Copilot'), this means the 'continuity' pitch is only true within a single IDE, not across the multi-IDE support Engram advertises in the same breath. Worth surfacing as a documentation/expectation-setting gap even though the underlying sharding fix was the right call for the contention bug it solved.

<sub>design-tension · multi-ide · db-sharding · continuity</sub>

---

### O8 · finding · `src/services/agent-rules.service.ts`

CRITICAL (new, missed by the 2026-08 audit): Local agent-rules cache poisoning via hostile repository. AgentRulesService.loadCache() reads .engram/agent_rules_cache.json, JSON.parses it and CASTS to RulesCache with zero schema validation, zero size cap and zero provenance check. An attacker publishes a repo with that file git-force-added past .gitignore; the victim clones and opens it; Engram serves the attacker's text as CRITICAL-priority binding agent_rules with source:"cache" (which looks MORE trustworthy than "fallback"). Live-reproduced end-to-end. Three sub-defects: (1) no schema validation, (2) no size cap - a 2,000,000-char rule injected 500k tokens into every session start, (3) TTL bypass - a future-dated fetched_at yields cache_age_hours -87600 and never expires. Strictly worse than the audit's Finding 2 because it needs no GitHub compromise, works offline, and triggers on the single most common agent action (clone + open).

<sub>critical · security · prompt-injection · supply-chain · cache-poisoning · live-reproduced</sub>

---

### O9 · finding · `src/tools/sessions.ts`

Session clobbering is BIDIRECTIONAL, not just sub-destroys-primary as the audit's Finding 1 described. Live-reproduced against real repos+migrations: (1) orchestrator opens #1; (2) sub-agent start auto-closes #1; (3) orchestrator's NEXT start auto-closes the SUB-AGENT's live session #2; (4) the sub-agent then calls end() with its real findings and that summary is written onto the ORCHESTRATOR's session #3. So a summary describing one agent's work is permanently attributed to a different agent's session record. The audit's proposed fix (scope by agent_name) is necessary but INSUFFICIENT, because agent_name defaults to the literal "unknown" (sessions.ts:96) - every agent that omits agent_name collides in the same bucket. A real fix needs a caller-bound session handle or parent_session_id, plus making agent_name required.

<sub>critical · orchestration · sub-agent · data-loss · live-reproduced</sub>

---

### O10 · finding · `src/tools/sessions.ts`

Multi-agent data corruption beyond sessions (new): sessions.ts:280 runs "UPDATE pending_work SET status='abandoned' WHERE status='pending' AND (session_id IS NULL OR session_id < ?)" on EVERY session start. Live-reproduced: agent-C merely starting a session flags agent-A's actively-in-flight pending_work AND all session_id IS NULL rows as 'abandoned'. Nothing about C starting implies A stopped. The guard "if (lastSession?.id)" is dead - lastSession is never used in the query. Separately, handoffs are unscoped: session start surfaces only the newest unacknowledged handoff (LIMIT 1, no agent filter) so concurrent handoffs are silently dropped, and acknowledge_handoff has no ownership check so any agent can acknowledge any other agent's handoff.

<sub>high · orchestration · concurrency · data-loss · pending-work · handoffs · live-reproduced</sub>

---

### O11 · finding · `src/services/agent-rules.service.ts`

External corroboration for observation #8: Cisco Talos "MemoryTrap" / CVE-2026-21852 (published 2026-04-01) is structurally IDENTICAL to Engram's agent-rules cache flaw. A malicious npm postinstall hook appended text to Claude Code's ~/.claude/projects/*/memory/MEMORY.md; Claude Code loaded the first 200 lines into the system prompt every session, so the text became high-authority operating instructions. Anthropic's fix in Claude Code v2.1.50 was to REMOVE user memories from the system-prompt injection path entirely. Engram's agent_rules is the same shape: a repo-adjacent file, auto-loaded into every session start, explicitly labeled CRITICAL/binding. The generalizable rule: any memory system that (a) writes to a location repo-adjacent tooling can reach and (b) auto-loads it into a trusted context is a supply-chain amplifier. This upgrades the finding from "theoretical" to "an attack class already exploited and patched in a first-party product."

<sub>critical · security · cve · memorytrap · supply-chain · external-evidence</sub>

---

### O12 · finding · `src/tools/dispatcher-admin.ts`

Privilege-escalation-equivalent gap (new): engram_admin(action:"config") at dispatcher-admin.ts:257-269 sets ANY config key with no whitelist. The config table holds http_token (dashboard bearer token), sharing_mode, sharing_types, sensitive_keys, instance_id, machine_id, instance_visible. So any MCP client - or any agent that was prompt-injected once - can call engram_admin({action:"config", key:"sharing_mode", value:"full"}) to open this project's memory to every other Engram instance on the machine, or overwrite http_token to hijack the dashboard API. No confirmation, no audit entry, no warning. This is a REGRESSION: the pre-consolidation implementation in src/tools/stats.ts had exactly this protection (KNOWN_CONFIG_KEYS whitelist, lines 22-31) and it was dropped when the dispatchers were consolidated. Fix: restore the whitelist, and make security-relevant keys require a confirm token or be read-only from the tool surface entirely.

<sub>critical · security · privilege-escalation · regression · config</sub>

---

### O13 · finding · `src/migrations.ts`

KEY DISCOVERY for the agent-accountability design: ~70% of multi-agent traceability is ALREADY BUILT into Engram and simply disconnected. (1) sessions.parent_session_id is declared in the V1 BASELINE migration (migrations.ts:31) and in types.ts:15, but has ZERO usages anywhere in src/ or tests/ - SessionsRepo.create() never sets it. This is the exact sub-to-orchestrator link whose absence causes audit finding N3, and wiring it needs NO migration. (2) tool_call_log.agent_id exists but logToolCall (database.ts:420) passes literal null every call, so per-agent attribution in the call log is dead. (3) intelligence.ts's `replay` action is fully implemented dead code whose own description literally reads "reconstructing what sub-agents did, and auditing multi-agent sessions" - the requested audit capability, written and unreachable. Conclusion: the cheapest path to a traceable multi-agent workforce is RECONNECTION, not construction, which also resolves the "don't make Engram heavy" constraint - the light version is the actual work, not a compromise.

<sub>architecture · orchestration · dead-code · accountability · high-value</sub>

---

### O14 · finding · `temp/prism.skill`

Prism convention spec (references/convention-spec.md): defines a dual-audience document format. Frontmatter YAML block requires fields: prism (version string, e.g. "1.0"), type (spec|guide|readme|skill|report|proposal|other), audience ([agent,human]), agent.skip (zone codes to skip, default [H]), agent.navigate (optional anchor list), agent.directives (optional freeform strings), status (draft|review|stable), updated (ISO 8601 date). Zone markers are HTML comments: <!-- [A] -->...<!-- [/A] --> (agent-only), <!-- [H] -->...<!-- [/H] --> (human-only), <!-- [AH] --> (explicit shared; unmarked content is shared by default). Gist marker <!-- [A:gist] text --> appears as first line inside an [H] zone: a lossless compression of the human prose for agents to read instead of the full block. Nesting rule: [A] must never nest inside [H] (agent content would be invisible); innermost tag governs. Structural position contract: frontmatter -> [A] zone -> shared body -> [H] zones (agents read top-down and hit directives first).

<sub>prism · spec · frontmatter · zones</sub>

---

### O15 · pattern · `temp/prism.skill`

Prism retrofit/unretrofit mechanism: retrofit.md defines a 9-step pipeline (READ, MAP, CLASSIFY, DRAFT GISTS, COMPOSE FRONTMATTER, ASSEMBLE, DIFF, CONFIRM, SAVE) that is dry-run by default -- file is never written until user approves a diff summary. Un-retrofit is a deterministic single-pass strip keyed on "PRISM:" origin tags: every addition made during retrofit is wrapped in <!-- PRISM:FM -->, <!-- PRISM:ZONE [x] -->, <!-- PRISM:GIST --> markers distinct from the semantic zone markers ([H],[A]) themselves, so un-retrofit can find-and-delete only agent-inserted structure and restore byte-identical original content. This provenance-tagging idea (distinguish agent-inserted content from human-authored content, so it can be cleanly reversed) is a reusable pattern.

<sub>prism · retrofit · provenance · reversibility</sub>

---

### O16 · pattern · `temp/prism.skill`

Prism classification mechanism (prism-tools/classify.js, spec in retrofit.md sec3-4): a deterministic keyword/pattern scoring engine that classifies a document section as agent|human|shared. Agent signals: imperative verbs (run/install/set/configure...), constraint terms (must/never/required/forbidden), status/version fields, numbered action sequences, code blocks, lookup tables -- each adds weighted score. Human signals: explanatory connectors (because/the reason/why), background phrases (originally/we decided/the team), onboarding phrases, philosophical/vision language -- also weighted. Edge-case pre-checks override scoring: TOC/nav -> shared; changelog -> human (gist only if "breaking change" detected); code-only (>70% code lines) -> agent; short section (<3 non-empty lines and <60 words) -> shared. Decision rule: ratio >=0.70 one side -> that class; otherwise -> shared (ties/uncertainty always default to shared, never agent-only, to avoid hiding content from agents). This is a fully deterministic, no-LLM classifier -- cheap and reusable as a general "is this text a directive/constraint vs narrative" classifier.

<sub>prism · classify · heuristics · deterministic</sub>

---

### O19 · finding · `temp/prism.skill`

Prism tooling summary (prism-tools/*.js, all Node, no external deps except gist.js's https call to Anthropic API): cli.js = dispatcher only, routes to submodule by command name, --manifest returns tool metadata JSON (deterministic). frontmatter.js = builds YAML frontmatter block from --type/--title/--status flags via keyword-based type inference (deterministic, string templates, no YAML lib). nav-parse.js = reads a file, extracts frontmatter (regex-based mini-parser), builds a JSON "read plan" (skip set, navigate anchors, read instructions) implementing convention-spec sec8's 7-step skip protocol (deterministic). validate.js = extractFrontmatter (custom line-based YAML-subset parser, NOT a full YAML parser) + parseZones (regex zone-open/close/gist scanner that is code-fence-aware and inline-code-aware) + checks: required fields present, enum values valid, date format, zone nesting/pairing, gist length/lossy-phrase heuristic, structural position (agent zone must precede human zone) -- all deterministic, outputs errors[]/warnings[]/summary. generate.js = 6 hard-coded doc templates (spec/guide/readme/skill/report/proposal), auto-runs validate() on output, writes to --out if given (deterministic). classify.js = deterministic keyword-scoring classifier (see other observation). gist.js = LLM API call + deterministic heuristic fallback + scoring (non-deterministic due to API, deterministic fallback). retrofit.js = orchestrates classify+gist+frontmatter+validate into full pipeline; dry-run by default, requires --apply to write; detects already-complete or partially-retrofitted docs and refuses to redo work (idempotent). unretrofit.js = pure deterministic line-based strip algorithm, zero agent judgment, essentially regex/string matching only.

<sub>prism · tooling · cli · determinism</sub>

---

### O20 · concern · `temp/prism.skill`

Prism weaknesses / fragility found during full read: (1) validate.js's extractFrontmatter is a hand-rolled regex-based YAML subset parser (not js-yaml) -- explicitly documented as "not a full YAML parser," will silently misparse multi-line strings, nested objects beyond 1 level, or anchors/aliases; a malformed-but-plausible frontmatter could pass or fail incorrectly. (2) gist.js hardcodes model id "claude-sonnet-4-20250514" directly in source -- will bit-rot as models are deprecated; no config/env override shown. (3) classify.js is bag-of-keywords scoring with fixed weights (+2/+3/+4 arbitrarily assigned) -- no calibration/validation against a labeled corpus is evidenced anywhere in the skill; tests/test-cases.md are manual, human-run-in-a-live-session scenarios, not automated/CI-checked, so regressions in classify.js or validate.js would not be caught automatically. (4) retrofit.js's assembleRetrofit for JSON and TXT adapters falls back silently to markdown HTML-comment markers ("json and txt not implemented yet") despite convention-spec.md documenting distinct JSON (_prism key) and TXT (===PRISM===) syntaxes -- the tool and the spec disagree; the tool would inject invalid syntax into JSON/TXT files if actually run on them. (5) The whole convention is a manual/social contract enforced only by an LLM agent choosing to follow it each time -- nothing prevents a future agent (or human) from editing a prism doc and breaking zone pairing/nesting other than the validate tool being run voluntarily. (6) Never proven in production: versions.md shows only internal phase history (2026-05-13 to 2026-05-28), no evidence of real-world multi-week use, so classify.js accuracy and the whole convention's practical value is unverified.

<sub>prism · weaknesses · risk · unproven</sub>

---

### O22 · finding · `temp/prism.skill`

Prism architecture note: it is a documentation-formatting convention (dual-audience markdown/yaml/json/txt files with agent vs human zones), NOT a project-tracking or task-ledger system. Its "source of truth" is convention-spec.md (versioned 1.0), and its unit of work is a single document file, not a project or session. It has no concept of tasks, decisions, sessions, or cross-file state -- everything is scoped to one file at a time. Its only cross-session continuity mechanism is the _wip/write-manifest.md declare-write-verify pattern (see other observation) plus the AGENT:COMPLETE sentinel. This means the DIRECTLY reusable surface for Engram is narrow: not the zone/frontmatter/gist machinery itself (Engram already has structured SQLite tables, it doesn't need markdown zones), but the meta-patterns: (a) declare-before-write / verify-sentinel-on-resume for detecting silently-dropped work, (b) provenance tagging to distinguish agent-inserted vs human-authored state for clean reversal/audit, (c) deterministic lint-before-finalize validation, (d) LLM-with-deterministic-fallback compression for summaries. The zone/adapter/template machinery (60%+ of the skill's file volume) is NOT reusable -- it solves a markdown-rendering problem Engram does not have.

<sub>prism · engram-reuse · scope · architecture</sub>

---

### O25 · finding · `src/migrations.ts`

ROOT-CAUSE DIAGNOSIS for "features get silently dropped and nobody knows": Engram has HORIZONTAL memory but NO VERTICAL TRACEABILITY. Schema check confirms every table links to session_id and nothing else - tasks.milestone_id MISSING, changes.task_id MISSING, decisions.task_id MISSING, tasks.decision_id MISSING. So you can ask "what happened in session 5" but you CANNOT ask the three questions that actually catch drops: (1) "what did we promise in milestone X and did it ship?", (2) "which changes implemented task #7?", (3) "is decision D3 still reflected in the code?". Intent and outcome are stored in the same database and are not connected to each other. That is precisely why a feature can vanish with nobody noticing - nothing links the promise to the delivery, so nothing can report the gap. The fix is small: 3 nullable FK columns (tasks.milestone_id, changes.task_id, decisions.task_id) plus a reconcile pass. It is NOT a new subsystem. Note decisions already has supersedes/superseded_by/depends_on, so the DECISION level already has vertical linkage - it was simply never extended to milestone/task/change.

<sub>architecture · traceability · project-management · root-cause · high-value</sub>

---

### O27 · finding · `temp/tracer.skill`

FINDING: tracer is NOT a code-tracing tool despite its name and the task brief's assumption. It is a stateless conversational debugging methodology (triage taxonomy, 5-whys, bug-type playbooks, fixed Diagnosis/Fix/Verification/Prevention output format). It defines zero data structures, file formats, markers, or persisted artifacts — nothing survives past the chat turn. Its only "concurrency model" is a reference doc listing race/deadlock/livelock/starvation patterns for the USER'S code, not for the skill's own execution. NOT REUSABLE as a ledger mechanism (rated LOW) because there is nothing to persist — but its Stage-5 "Prevention" step (one sentence on the systemic fix that prevents recurrence) is a good candidate prompt/field to attach to Engram's decisions or observations table when a bug fix is recorded, so root-cause context survives instead of being dropped after the chat ends.

<sub>tracer · no-artifact · stateless · naming-collision</sub>

---

### O28 · concern · `temp/tracer.skill`

CONCERN / capability-surface overlap: the skill "tracer" (root-cause debugging playbook, no data structures) shares its core word "trace" with completely unrelated Engram-ecosystem MCP tools mcp__codebase-memory-mcp__trace_path and mcp__codebase-memory-mcp__ingest_traces (actual code-graph execution/dependency tracing). An agent choosing a tool by name alone risks invoking the wrong one — "trace the bug" could dispatch to either. Recommend Engram/skill docs disambiguate explicitly (e.g. rename skill-level concept to "root-cause playbook" in any ledger/skill-catalog entry) to prevent wrong-tool selection.

<sub>tracer · naming-collision · wrong-tool-selection · cross-cutting</sub>

---

### O30 · concern · `docs/cross-instance-sharing-bugs.md`

CRITICAL COUNTER-ARGUMENT to "build a ledger where work signs in and off": Engram ALREADY HAD a ledger, and the ledger became the disinformation source. docs/cross-instance-sharing-bugs.md is a hand-maintained status register; it said "Status: Documented, not yet fixed" for bugs #26-#29 for EIGHT VERSIONS after commit cb707d0 shipped the fix into both develop and main. That is audit finding F5. So the empirical evidence from this very project is that an unreconciled register does not merely fail to help - it actively lies with confidence, which is strictly worse than having none, because an agent reading it will burn a session re-fixing something already fixed. Combined with arXiv 2604.09409 (agents ignore explicit logging instructions 67% of the time; 27% compliance even with detailed instructions), the conclusion is: DO NOT build a ledger whose integrity depends on discipline. Build a RECONCILER - a deterministic pass that compares declared state against actual state and reports the delta. The ledger is fine as a store; its trustworthiness must come from mechanical checking, not from anyone remembering to update it. Same principle as the accountability design's "detectable absence beats guaranteed presence" and as the user's own write-manifest.md sentinel (the ledger CLAIMS, the artifact PROVES).

<sub>project-management · counter-evidence · design-principle · ledger-rot</sub>

---

### O31 · finding · `temp/ghostwriter.skill`

WEAKNESS: ghostwriter's fast-mode.js and voice-save.js persist state to /tmp/ghostwriter-fastmode.json and /tmp/ghostwriter-voice-<hash>.json with TTLs (4h, 7d). This is the exact anti-pattern Engram exists to fix: durable-feeling state (a whole document's voice calibration, a session's process mode) silently evaporates because it lives in OS temp storage with no ledger entry, no cross-session table row, no signed-off record. If a machine reboots or /tmp is cleared, ghostwriter forgets and nobody is notified. Directly illustrates the "silently DROP features/plans" problem Engram is meant to solve — ghostwriter itself needs Engram-style durable storage, not ad hoc temp-file state with arbitrary TTLs.

<sub>ghostwriter · ephemeral-state · weakness · anti-pattern</sub>

---

### O32 · finding

CLASSIFICATION of the ~10 silent-drop incidents found in the Engram audit, by what would mechanically have caught each: (1) lock_file/unlock_file vanished while README:727 still advertises them -> doc-vs-code drift check; (2) config whitelist KNOWN_CONFIG_KEYS dropped in the v1.6 consolidation -> API/behaviour surface diff; (3) seven z.enum constraints and all numeric bounds dropped -> schema surface diff; (4) replay implemented then disconnected -> unreachable-export detection (knip/ts-prune class); (5) sessions.parent_session_id column created in V1 and never wired -> orphaned schema element detection; (6) import silently narrowed from 6 tables to 1 while its own dry-run still reports 4 -> contract/behaviour test; (7) cross-instance-sharing-bugs.md stale 8 versions -> status-bearing doc reconciliation; (8) v1.11 release notes publish a schema that does not match the table -> doc-vs-code drift; (9) observations columns are content/file_path/agent_name not observation/context/source -> same; (10) 15 dead tool files, 4,057 lines -> unreachable-export detection. KEY CONCLUSION: essentially ALL of them are mechanically detectable by static analysis that already exists as off-the-shelf tooling. NOT ONE of them required a human or agent to remember something. This is the strongest argument that the solution is automated reconciliation, not a discipline-based register.

<sub>project-management · drift-detection · tooling · analysis</sub>

---

### O33 · pattern · `temp/prism.skill`

CROSS-CUTTING FINDING: Prism's [A]/[H]/[AH] zone-marker convention (HTML-comment zones, frontmatter with prism/type/audience/agent.skip/status/updated fields) is not just applied to Prism's own document output — carto-src's own SKILL.md is itself authored in the Prism zone convention ([A:quick-ref], [A:read-order], [H] "About carto-src" blocks) and even carries a literal §carto self-stamp at EOF of its own frontmatter block. This shows the three+Prism skills share a common authoring substrate (Prism zones) for skill files themselves, not only for skill *output*. For Engram: adopting a single lightweight "agent-zone / human-zone" convention across whatever ledger docs/config Engram produces (not just memory rows) would give consistency for free and is a genuinely coherent, low-cost idea to borrow.

<sub>prism · carto-src · zone-convention · cross-cutting · coherence</sub>

---

### O34 · finding · `temp/ghostwriter.skill`

FINDING: broken cross-reference confirms Engram's core thesis. ghostwriter/SKILL.md's mode table says the "Wrap" mode (doc complete, prism not yet applied) should load `references/deviations.md §prism-chain`, and versions.md's changelog claims "B7: No prism integration ... prism chain in deviations.md" was fixed. But references/deviations.md (43 lines, fully read) contains no "prism-chain" section at all — only "Handling Deviations", "Artifact & File Rules", "Quality Principles". This is a real instance of a feature being silently dropped/never finished while the changelog and skill routing table both claim it exists — exactly the failure mode Engram's project-state ledger is meant to catch. A ledger with per-feature sign-off status (not just a changelog prose entry) would have caught this at review time.

<sub>ghostwriter · broken-reference · silently-dropped-feature · motivating-example</sub>

---

### O36 · finding

Named concepts for silent feature/requirement drop: 'architecture erosion' (violating architectural principles) vs 'architecture drift' (insensitivity to architecture) — distinction from Perry & Wolf 1992, discussed in ACM 'Drift and Erosion in Software Architecture' (2020) https://dl.acm.org/doi/10.1145/3404663.3404665 and ScienceDirect survey on controlling architecture erosion https://www.sciencedirect.com/science/article/abs/pii/S0164121211002044. The foundational academic framing of the traceability problem itself is Gotel & Finkelstein 1994 'An Analysis of the Requirements Traceability Problem' (ICRE'94, pp94-101) based on 100+ practitioner interviews, distinguishing pre-RS vs post-RS traceability — https://dblp.uni-trier.de/rec/conf/re/GotelF94.html. No single canonical term exists for "silently dropped feature during refactor" specifically; closest practitioner terms are 'dead/orphan code', 'architecture drift', and 'requirements decay'.

<sub>research · traceability · terminology</sub>

---

### O37 · finding

Empirical dead-code data: industrial system study found 30-50% of source code not understood/documented by any current developer; 2021 Muzeel study of ~40,000 pages found median page had 70% unused JS functions; 35 open-source Java projects study found ~16% of methods effectively dead; general estimate is codebases contain 10-30% dead code (multi-study "A Multi-Study Investigation Into Dead Code" TSE'18 https://www.cs.wm.edu/~denys/pubs/TSE'18-DeadCode.pdf). This is the closest empirical proxy for "features silently dropped" — dead code is often the residue of a drop.

<sub>research · dead-code · empirical</sub>

---

### O38 · finding

ADR (Nygard 2011) lifecycle uses status field proposed/accepted/deprecated/superseded; the doctrine is old ADRs are kept and marked superseded, never deleted. BUT evidence of practice: multiple 2024-2026 practitioner sources report ADRs commonly rot — "Nobody superseded the ADR. Nobody deleted it. It just sits there, looking authoritative, contradicting the codebase silently" and teams "most under-write ADRs, and those that exist often aren't kept current" (hidekazu-konishi.com). One cited real incident: a new engineer followed a stale ADR and lost 3 days. Conclusion: ADR status tracking is a documented practice, not a reliably maintained one — it requires an enforced review process or it degrades to a write-only diary. Source: https://hidekazu-konishi.com/entry/architecture_decision_records_templates_and_operations.html

<sub>research · ADR · evidence</sub>

---

### O39 · finding

Automated detection tooling for exactly this class of drift: (1) dead-export/unused-code: knip (active, subsumes ts-prune+depcheck+unimported, all three now archived/unmaintained as of 2025) — https://knip.dev/explanations/comparison-and-migration ; false positives mainly from dynamic imports/framework conventions/generated files. (2) API surface diffing: Microsoft api-extractor generates .api.md golden files, CI can require review on any diff — https://api-extractor.com/pages/overview/demo_api_report/ ; Rust equivalent cargo-public-api (diffing) and cargo-semver-checks (linting+reasoning) both using rustdoc JSON + golden-file snapshot tests — https://github.com/cargo-public-api/cargo-public-api. (3) Docs-vs-code drift: Drift VSCode extension (AST-anchors docs to code, flags staleness) https://github.com/pallaprolus/drift-vscode ; Fiberplane's Drift linter for spec/doc staleness https://fiberplane.com/blog/drift-documentation-linter/. (4) Orphaned DB columns: ColumnLens (Ruby/Rails, classifies columns as used/write-only/read-only/orphaned), SchemaSpy 'Orphan table' view. (5) Weakened/silently-dropped validation logic (e.g. Engram's dropped Zod enums/bounds): mutation testing (PIT, mutmut, Stryker) — deletion mutants that remove a validation but still pass tests reveal exactly this failure mode; ThoughtWorks Tech Radar lists it as an adopted technique https://www.thoughtworks.com/radar/techniques/mutation-testing. (6) Behavioral regression on refactor: golden-master/characterization testing (Michael Feathers) and contract testing catch silently-changed behavior without needing full spec understanding.

<sub>research · tooling · detection · actionable</sub>

---

### O40 · finding

Lightweight ledgers that survive: Keep a Changelog succeeds specifically because it has no tooling, no vendor, no schema — just a convention (fixed categories, ISO dates, newest-first, one file) and is followed by tens of thousands of OSS projects — https://keepachangelog.com/en/0.3.0/ . Shape Up (Basecamp/37signals) explicitly rejects sprints/points/backlogs in favor of a 6-week cycle + betting table + hill charts (a single visual artifact showing uphill/downhill progress, not a task list) — https://37signals.com/06 . 37signals more broadly runs with no full-time managers, replacing status meetings with async daily/weekly Basecamp check-in questions — DHH https://world.hey.com/dhh/manage-process-before-people-20736695 . Common thread: survivors are single-file/single-artifact, zero required tooling, append-only or trivially-updatable, and tied to a forcing function (a release, a cycle boundary) rather than requiring proactive discipline.

<sub>research · ledger · changelog · shapeup</sub>

---

### O41 · concern

COUNTER-EVIDENCE 1: A stale/frozen register is argued to be actively worse than no register because it looks authoritative while misleading readers — "Your Risk Register Is Already Dead" (2026): "A register you built carefully and then froze isn't neutral—it's worse than nothing, because it looks authoritative... everyone builds the register, but almost nobody maintains it" https://ai.plainenglish.io/your-risk-register-is-already-dead-heres-the-15-minute-ai-workflow-that-keeps-it-alive-bcbe960b0e0f . Directly analogous to Engram's own README-says-lock_file-exists-but-it-doesn't failure — the proposed fix (a ledger) carries the identical failure mode if unenforced.  COUNTER-EVIDENCE 2: 'Process theater' — Agile ceremonies (and by extension ADRs/RTMs/registers) performed without underlying intent become symbolic: "teams hold stand-ups, run sprints... these activities become symbolic rather than functional... Employees may comply with visible processes to demonstrate adherence rather than focus on solving real problems" — The New Stack, "Process Theater vs. Technical Excellence" https://thenewstack.io/process-theater-vs-technical-excellence-a-recurring-software-crisis/ . Also Goodhart's Law: any tracked completion/traceability metric invites gaming (spuriously closing tracked items, inflating story points) rather than improving the underlying problem — https://buttondown.com/hillelwayne/archive/goodharts-law-in-software-engineering/ . RTMs specifically: "manual construction and maintenance of a traceability matrix proves to be costly... traceability is not feasible from a financial point of view" per industry case study review, and spreadsheet-based RTMs "produce static, often outdated information."

<sub>research · counter-evidence · goodharts-law · process-theater</sub>

---

### O42 · finding

Agent-specific prior art: GitHub Spec-Kit uses gated phases (Specify->Plan->Tasks->Implement) with persistent spec/plan/constitution files as source of truth for coding agents — https://github.com/github/spec-kit . AWS Kiro generates requirements.md (EARS notation)/design.md/tasks.md with explicit requirement-to-task traceability — https://tessl.io/blog/from-vibe-coding-to-viable-code-aws-dives-into-spec-driven-ai-software-development-with-kiro/ . Tessl (Guy Podjarny/Snyk founder, $125M funding) pushes furthest: 'spec-as-source' where code is a regenerable artifact never hand-edited. COUNTER-EVIDENCE on agent task/todo persistence: practitioner design note observes "Long-lived lists across sessions tend to grow into a junk drawer of stale items, and carrying stale in-progress items into a new session is problematic since the agent has no memory of why they were started" — i.e. even purpose-built agent task persistence tools acknowledge rot risk absent active pruning; ChatBotKit's answer was to auto-expire todo state after 24h rather than trust long-term maintenance. This directly parallels the Engram case: the tooling to persist state existed (parent_session_id column, replay capability) but wasn't wired/pruned, producing exactly the predicted rot.

<sub>research · agents · spec-driven-development · counter-evidence</sub>

---

### O43 · finding

EMPIRICAL PROOF that off-the-shelf static analysis catches the silent-drop class: ran `npx -y knip` on this repo with ZERO configuration. It found all 15 dead tool files (backup, changes, compaction, conventions, coordination, decisions, export-import, file-notes, intelligence, knowledge, milestones, report, scheduler, stats, tasks) in a single pass, plus scripts/fix-mcp-config.js, six unused exports in constants.ts (TOOL_PREFIX, MAX_GIT_LOG_ENTRIES, MAX_RESPONSE_LENGTH, DEFAULT_PAGINATION_LIMIT, DEFAULT_RETENTION_DAYS, PROJECT_MARKERS), and unlisted binaries `reg`/`ioreg` invoked from utils.ts getMachineId. So 4+ of the 10 audited silent-drop incidents were detectable on day one, free, in CI, with no Engram feature at all. FALSE-POSITIVE CHARACTERISTIC worth knowing: it also flagged all of packages/engram-dashboard/src/** and both thin clients as unused, because those are separate build entry points not declared in a knip config - so it needs a small knip.json listing entry points before it is CI-ready, otherwise the signal drowns in noise. RECOMMENDATION: this is Tier A of the drift-detection design and it is NOT an Engram feature - do not build into Engram what a maintained OSS tool already does better.

<sub>tooling · drift-detection · dead-code · ci · verified · high-value</sub>

---

### O44 · finding · `src/tools/sessions.ts`

FINDING N3 REPRODUCED LIVE, UNPROMPTED, BY REAL CONCURRENT SUBAGENTS. While three Sonnet subagents worked in parallel on the project-management research task, each starting its own Engram session, the prism-analysis agent reported verbatim: "Session started as #10, but engram_session end returned session_id: 12". It closed a session it did not open - another agent's. This is not a synthetic PoC; it is the bug occurring in ordinary multi-agent work, in the very session where we are designing multi-agent accountability. Observation IDs in this run are also non-contiguous across agents (25, 30, 32, 43), confirming interleaved concurrent writes. TWO CONSEQUENCES: (1) any per-session statistic gathered during concurrent subagent work in this project is currently unreliable, including the observations_recorded counts the agents reported; (2) this raises P0-1 (task #2) from 'critical per audit' to 'blocking in practice' - the moment Engram is used the way it is marketed, its own bookkeeping corrupts. Use this incident as the regression test case: three concurrent agents, each start+end, assert each session's summary matches the agent that wrote it.

<sub>critical · orchestration · audit-n3 · live-reproduced · concurrency · regression-test</sub>

---

### O45 · finding · `temp/ghostwriter.skill`

THE DECISIVE CASE STUDY, found inside the user's OWN skills: ghostwriter's references/versions.md v2.0 changelog explicitly claims bug "B7: No prism integration" was FIXED by adding a prism chain to references/deviations.md. The subagent read deviations.md in full (43 lines) - NO prism-chain section exists. Only "Handling Deviations", "Artifact & File Rules", "Quality Principles". So a changelog asserts a feature shipped that was never written, and nothing caught it. Pair this with Engram's own docs/cross-instance-sharing-bugs.md, which asserted a bug was NOT fixed for 8 versions after it WAS. TOGETHER THESE PROVE THE CENTRAL POINT: a hand-maintained register lies in BOTH directions - it claims work that never happened, and denies work that did. Neither error is detectable from inside the register; both require reconciliation against the artifact. This is the strongest available argument that the answer to "features get silently dropped" is NOT another register but a mechanical reconciler. Also note ghostwriter persists fast-mode and voice-calibration state to OS /tmp with 4h/7d TTLs, so a reboot silently erases it - the "silently drop work" failure occurring inside a skill built to prevent it.

<sub>project-management · ledger-rot · case-study · decisive-evidence</sub>

---

### O46 · finding

THE SURVIVAL CRITERION - the single most useful result of the PM research. Across every mechanism studied, the ones that stayed alive share exactly ONE trait: the source of truth is coupled to something that BREAKS A BUILD OR BLOCKS A MERGE if it is stale. Survivors: Rust RFCs (status lives in an auto-created tracking ISSUE with labels, triaged per release - not in the proposal doc), Kubernetes KEPs (a dedicated subteam verifies status every release cycle), CI-enforced feature-flag expiry (30/7/0-day alerts, deploy blocked if a deprecated flag is still referenced), Microsoft api-extractor (.api.md golden file, PR review required whenever it diffs). Rotters: ADRs ("nobody superseded it; it sits there looking authoritative, contradicting the codebase" - a cited real incident cost an engineer 3 days), RTMs (shelfware outside FDA/ISO26262/DO-178C where an external auditor forces them; "traceability is not feasible from a financial point of view"), hand-maintained capability manifests (evidence is vendor marketing only). DESIGN RULE FOR ENGRAM: never ship a register whose accuracy depends on someone remembering. Either couple it to CI, or generate it from code. Corollary from Keep a Changelog's survival: it works precisely because there is no tooling and no schema - just a convention updated as a side effect of a release that was happening anyway.

<sub>project-management · design-principle · research · decisive</sub>

---

<!-- ENGRAM_MEMORY_OBSERVATIONS:COMPLETE -->
