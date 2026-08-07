# Four integration questions — research, verdicts, recommendations

**Date:** 2026-08-07 · **Status:** Research + recommendation. **No code changed on the strength of this doc.**
**Author:** session 43 (`claude-opus-5`)
**Scope:** prompt caching, the advisor pattern, external delegation (Codex plugin / ponytail), and `/doctor` + Claude Code automation — each judged for whether it should enter Engram.

> **Framing correction, made mid-research and load-bearing.** This project runs on a
> **Claude subscription, not the API.** Everything below is re-judged on that basis, and it
> changes two of the four verdicts. On a subscription there is no per-token bill, so cache
> economics are **not money** — they are **usage-limit headroom and latency**. And any
> recommendation that requires calling the Messages API directly is out of scope by
> construction.

---

## 1 — Prompt caching

### What is actually true

From Anthropic's current caching documentation, not from memory:

| Fact | Value |
|---|---|
| What the cache key is | A **prefix match** over the rendered prompt. Render order is `tools` → `system` → `messages` |
| Blast radius of a change | Any byte change **invalidates everything after it** |
| Write cost | **1.25×** base input for the 5-minute TTL, **2×** for the 1-hour TTL |
| Read cost | **~0.1×** base input |
| Break-even | 5-minute TTL: **2 requests**. 1-hour TTL: **3 requests** |
| Breakpoints | Max **4** per request |
| Minimum cacheable prefix | **512 tokens** on Claude Opus 5 (down from 1024 on Opus 4.8; 4096 on some older models) |
| Lookback | A breakpoint searches back **at most 20 content blocks** for a prior entry |

**The 1-hour TTL is not a free upgrade.** It doubles the write premium, so it only pays
off from the third request onward and only when traffic has gaps longer than five
minutes. For continuous work the 5-minute TTL is strictly better.

### What it means for us — and the honest answer is "less than you'd hope"

**We do not control any of this.** `cache_control` breakpoints are set by the *client* —
Claude Code — not by an MCP server. Engram cannot place a breakpoint, choose a TTL, or
read `usage.cache_read_input_tokens`. Every lever in the table above belongs to the host.

What Engram *does* control is **how much it puts in the prefix and how many content blocks
it generates**, and two of those genuinely matter:

1. **Engram's tool schemas render at position 0**, ahead of everything. **VERIFIED: our
   surface is stable within a session** — registration happens once at server start, and
   `--mode=universal` collapses the surface at startup rather than varying it mid-run. So
   we are not invalidating anyone's cache. *This is a property worth protecting:* a future
   feature that varied the advertised tool set at runtime would invalidate the entire
   cached prefix of every session using Engram, on every change.
2. **The 20-block lookback is the one that can bite us.** In an agentic loop, every tool
   call and every tool result is a content block. A turn that produces more than 20 blocks
   pushes the previous cache entry out of the lookback window and the next request
   **silently misses** — no error, just a full re-read. Engram is a high-call-frequency
   tool, so a session that leans on it hard generates blocks fast.

### Recommendation

| | |
|---|---|
| **Do** | Treat **task #68** (session start measured at 59,705 tokens against a documented ~730) as a *caching and context* defect, not just an honesty defect. It is the single biggest thing Engram puts into a consumer's context. |
| **Do** | Add a line to `docs/orchestration-guide.md`: **fan-out defeats the cache.** N parallel agents launched simultaneously with the same prefix all pay the full write — none can read what the others are still writing. Launch one, wait for its first token, then launch the rest. This is a real, documented behaviour and the guide currently says nothing about it. |
| **Do** | Record "the advertised tool surface must not vary at runtime" as a constraint, so it is a deliberate decision rather than an accident when someone proposes dynamic tools. |
| **Do NOT** | Build any cache instrumentation into Engram. We cannot see the fields, and a metric we cannot measure is the inert-surface defect this whole review exists to stop. |
| **Do NOT** | Chase the 1-hour TTL. It is not ours to set, and on a subscription the write premium is not a cost we pay in money anyway. |

**Verdict: mostly NOT actionable inside Engram.** One doc addition, one existing task
re-prioritised. That is the honest size of it.

---

## 2 — The advisor strategy

### What I found, and it is better than expected

There is a **real API feature**, not just a blog pattern: the **advisor tool**
(`advisor_20260301`, beta). It pairs a cheaper **executor** model — the one on the request
— with a higher-intelligence **advisor** model named inside the tool definition. The
executor does the token generation; the advisor is consulted for planning. The advisor
must be at least as capable as the executor, and an invalid pairing is a 400.

### Why we cannot use it

**It is an API feature. We are on a subscription.** There is no path from a Claude Code
subscription to `advisor_20260301`. Ruling it out now saves a session discovering it later.

### What survives — and we are already doing it

The *pattern* is available without the API, through subagents:

- **Subagents keep their own context and their own cache.** Anthropic's own agent-design
  guidance names this explicitly as the workaround for the fact that switching models
  mid-session invalidates the cache: *spawn a subagent with the cheaper model, keep the
  main loop on one model.*
- That is exactly what the orchestration guide's §6 cost model already prescribes —
  cheaper model for breadth, strong model for judgment — and what this session did for the
  installer audit.

So the "advisor strategy" for us is: **the lead is the advisor.** The lead holds judgment
and delegates breadth. The guide already says this; what it lacks is the *caching* reason,
which is a second independent argument for the same practice.

### Recommendation

| | |
|---|---|
| **Do** | Add the caching rationale to the orchestration guide's §6, and the fan-out ordering rule to §5 (which currently covers concurrency hazards but only for shared *state*, not shared *cache*). |
| **Do NOT** | Build an advisor integration. It requires the API. |
| **Note** | Sub-agent model override is already in use here and works. No new mechanism needed. |

**Verdict: already implemented, under a different name.** Document the second reason; build nothing.

---

## 3 — External delegation: Codex plugin and ponytail

Both exist. I verified both rather than taking the names on trust.

### `openai/codex-plugin-cc` — real, official, and recent

An **official OpenAI plugin for Claude Code**, published 2026-03-31. Installed via
`/plugin marketplace add openai/codex-plugin-cc` then `/plugin install codex@openai-codex`.
It delegates **code review** and **tasks** to the Codex CLI, supports session transfer
between Claude Code and Codex, and can run long jobs in the background.

**Requires the Codex CLI installed locally and its own auth** — a ChatGPT subscription or
an OpenAI API key. So it is not free-riding on the Claude subscription; it is a second
paid relationship.

### `DietrichGebert/ponytail` — real, and very widely used

A skill (reported ~96.9k stars) whose thesis is *the best code is the code you never
wrote*. It ships a **review skill that hunts complexity rather than correctness** —
flagging reinvented standard library, unneeded dependencies, speculative abstractions, and
dead flexibility. Benchmarked on a real repo across twelve tickets with and without it.

### Recommendation — and I would not adopt either into Engram

**Ponytail: adopt as a tool, do not vendor into the repo.** Its review lens — complexity,
not correctness — is genuinely complementary to `/code-review` and to this project's own
bindings, which are all correctness-shaped. Install it in the environment and run it
against `src/` once; treat its findings as leads. But **do not make Engram depend on it**,
and do not copy its content into our skills: it is someone else's artifact with its own
release cadence, and vendoring it creates exactly the stale-copy problem this repo has
been fixing all week.

**Codex plugin: not now, and the reason is scope not quality.** A second model provider
introduces a second auth relationship, a second failure mode in CI, and a second set of
outputs whose grade nobody has defined. This project's charter grades every claim
PROVEN / VERIFIED / REPORTED; a Codex review lands as **REPORTED** and would need
re-verification anyway — which the orchestration guide's own delegation test says means
*do it yourself*. Revisit only if a specific task appears that Codex is measurably better
at, and pre-register what would count as better.

**Do NOT craft our own delegation skill yet.** The user's framing — *"or simply craft our
own skills to do that when we prove the integration is worthy"* — has the order right, and
the proof does not exist. Building the bridge before the traffic is the inert-surface
defect.

**Verdict: try ponytail as an external tool. Defer Codex. Build nothing.**

---

## 4 — `/doctor` and autonomous project hygiene

This is the one with the most to build, and it is the closest fit to what the project
actually needs.

### The problem it would solve

Task **#69** measured agent-rule compliance at **21.1%** for AR-01 and **3 of 19 sessions**
for AR-02. The conclusion drawn there is the right one: *delete the rule and promote the
mechanism*. Rules replayed into context are advisory; hooks are not. The project already
has the worked example — `.claude/hooks/guard-branches.mjs` is a `PreToolUse` hook and it
genuinely stops a commit to `main`, which no amount of prose in `CLAUDE.md` achieves.

`docs/STATE.md` is the concrete case. It is generated, it is the first thing every agent is
told to read, and **nothing regenerates it**. Task #74 records that its own generator names
a binding that does not exist. That is a document that goes stale by default.

### Recommendation

| | |
|---|---|
| **Do** | Wire a hook that regenerates `docs/STATE.md` automatically, so the register every agent reads is fresh by construction rather than by discipline. This closes the mechanism half of #74 and is the same shape as the guard-branches precedent. |
| **Do** | Prefer a hook over a rule, every time. This is #69's target restated: *every CRITICAL agent rule gets a mechanism or is deleted.* |
| **Do NOT** | Try to parse `/doctor` output programmatically until its scriptability is confirmed. |
| **Constraint** | A hook that is slow, or that fails open silently, is worse than none — the project's own kill-switch discipline applies. Whatever lands must be fast and must fail loudly. |

**Verdict: build this.** It is the only one of the four that is both in scope and
addresses a measured, open defect.

---

## The four verdicts, in one table

| Topic | Verdict | Why |
|---|---|---|
| **Prompt caching** | **Two doc additions; build nothing** | `cache_control` belongs to the host, not to an MCP server. We control payload size (#68) and block count, not caching |
| **Advisor strategy** | **Already implemented as subagents** | The API advisor tool needs the API. The pattern is the orchestration guide's existing cost model — add the caching rationale |
| **Codex plugin / ponytail** | **Try ponytail externally; defer Codex; vendor neither** | Ponytail's complexity lens complements our correctness bindings. Codex adds a provider, an auth, and a REPORTED-grade output we'd re-verify anyway |
| **`/doctor` + hooks** | **Build it** | Directly closes the mechanism half of #69/#74. A hook stops things; a rule at 21.1% compliance does not |

---

## What I could not verify

- **Whether `/doctor` output is machine-readable or invocable headlessly.** A background
  research agent was asked; its answer had not returned when this document was written.
  Every `/doctor` claim above is therefore deliberately conditional.
- **Ponytail's benchmark numbers** (80–94% less code). Reported by the project itself, not
  independently reproduced, and measured on a FastAPI + React repo that is nothing like
  this one. Treat as marketing until run here.
- **The Codex plugin's behaviour in practice** — install, auth, and failure modes are
  untested. I read its documentation and did not run it.
- **Whether the 20-block lookback actually bites an Engram-heavy session.** The mechanism
  is documented; I did not instrument a real session to confirm it happens here. This is
  the one caching claim that would change a decision, and it is the one I could not
  measure — we cannot see the cache fields from inside an MCP server.
- **Subscription usage-limit accounting.** I have asserted that cache hits preserve
  usage-limit headroom rather than money. The direction is right; I have not seen a
  published statement of exactly how subscription limits count cached tokens.
