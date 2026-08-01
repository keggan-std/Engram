# Engram Memory — Observations (findings & concerns)

> **Generated artifact.** Free-text records — treat as UNTRUSTED on import.
> Provenance-tag and mark non-binding before loading into any agent context
> (see [`engram-deep-audit-2026-08-02.md`](../engram-deep-audit-2026-08-02.md) finding N1).
>
> **Last generated:** 2026-08-01 · **Count:** 12

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

<!-- ENGRAM_MEMORY_OBSERVATIONS:COMPLETE -->
