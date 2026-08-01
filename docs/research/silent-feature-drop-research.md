# Research Report: Silent Feature/Requirement Drop — Literature, Detection, and Mitigation

**Date:** 2026-08-02 · **Commissioned by:** the Engram deep-audit cycle
**Method:** delegated web research (Sonnet 5), reviewed and re-classified by Opus 5
**Consumed by:** [`project-state-tracking-design.md`](../project-state-tracking-design.md)

> **Evidence grading used throughout:** **(a)** documented practice · **(b)** empirical evidence/study · **(c)** vendor marketing. Where evidence is thin it is said plainly.

**Motivating context.** An audit of Engram found ~10 concrete instances of the same failure: features and plans silently dropped, unnoticed for many versions. A documented feature (`lock_file`/`unlock_file`) vanished while the README still advertises it; a config-key security whitelist was removed during a refactor; seven Zod enum validations and all numeric bounds were dropped; a `replay` capability was written then disconnected; a DB column (`parent_session_id`) was created and never wired; an `import` action silently narrowed from 6 tables to 1 while its own dry-run still reports 4; a bug-tracking doc said "not yet fixed" for 8 versions after the fix shipped.

---

## Q1 — What is this called, and what actually detects it?

### Named concepts

- **Requirements traceability problem** — the foundational academic framing, from Gotel & Finkelstein, *"An Analysis of the Requirements Traceability Problem"*, ICRE'94, based on 100+ practitioner interviews. They split it into *pre-RS* and *post-RS* traceability and found most real-world failures trace back to inadequate pre-RS work — the loss happens early and silently, long before anyone notices. [dblp](https://dblp.uni-trier.de/rec/conf/re/GotelF94.html)
- **Architecture erosion vs. drift** — Perry & Wolf (1992), still current: *erosion* = violations of architectural principles (someone knowingly broke the rule); *drift* = insensitivity to the architecture (nobody was tracking the rule at all). **Drift is the closer match to Engram's case.** [ACM 2020 survey](https://dl.acm.org/doi/10.1145/3404663.3404665) · [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0164121211002044)
- **Dead code / orphan code** — the residue left behind after a silent drop.

**There is no single canonical term** for "feature was documented/built/shipped, then silently removed and nobody noticed." It sits at the intersection of traceability failure, architecture drift, and dead-code accumulation. Practitioners describe it ad hoc ("scope rot", "silent regression"); it has not been named as a discrete phenomenon with its own research literature.

### Empirical data (b)

| Finding | Source |
|---|---|
| Industrial system: **30–50% of source not understood or documented** by any current developer | [TSE'18 multi-study](https://www.cs.wm.edu/~denys/pubs/TSE'18-DeadCode.pdf) |
| ~40,000 web pages: **median page had 70% of its JS functions unused** | Muzeel 2021 |
| 35 open-source Java projects: **~16% of methods effectively dead** | [Springer 2023](https://link.springer.com/article/10.1007/s10664-023-10303-0) |
| General estimate: codebases carry **10–30% dead code**, accumulating continuously | [axify.io](https://axify.io/blog/dead-code) |
| PHP web-app subsystem: developers eventually removed **30% of files** as dead | — |

*(Engram's own figure — 4,057 lines, 23% of `src/` unreachable — sits squarely inside the 10–30% band.)*

### What actually detects it

Overwhelmingly **tooling, not process**: static dead-code/export analysis, API surface diffing, mutation testing (for silently-weakened validation), golden-master/characterization testing (for silently-changed behaviour), doc-vs-code drift linters. Most of these matured only 2018–2024. **This is a tooling-first problem.**

---

## Q2 — Mechanisms, and whether they are actually maintained

| Mechanism | How it works | Cost | Maintained in practice? |
|---|---|---|---|
| **(a) ADRs, SUPERSEDED lifecycle** | Nygard format: status `proposed/accepted/deprecated/superseded`; old ADRs never edited, only superseded by a new one referencing them. [Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) | Low (~20 min/decision) | **Weak.** 2024–26 practitioner sources describe rotting ADR directories: *"Nobody superseded the ADR. Nobody deleted it. It just sits there, looking authoritative, contradicting the codebase silently"* — with a cited incident where an engineer built 3 days of work on a stale ADR. [source](https://hidekazu-konishi.com/entry/architecture_decision_records_templates_and_operations.html) Consensus: without an enforced review process they *"degrade into a write-only diary."* |
| **(b) RFC / PEP / KEP processes** | Rust: merged RFC → **auto-created tracking issue** in `rust-lang/rust`, labeled `B-RFC-approved`/`B-RFC-implemented`, triaged like any issue. [RFC book](https://rust-lang.github.io/rfcs/) · Python: PEP status field, editors enforce updates. [PEP 1](https://peps.python.org/pep-0001/) · Kubernetes: KEP stages `Provisional→Implementable→Implemented/Deferred/Rejected/Withdrawn/Replaced`, with a **dedicated enhancements subteam** tracking status every release. [k8s blog](https://kubernetes.io/blog/2022/08/11/enhancing-kubernetes-one-kep-at-a-time/) | Medium — needs an owning team or bot | **Strong**, and the reason is structural: **status is not self-reported.** A separate live tracker (labeled GitHub issue, or per-release subteam verification) is the source of truth, not the proposal doc. This is the key difference from ADRs. |
| **(c) Requirements traceability matrices** | Spreadsheet/tool linking requirement → design → test → code | High, manual | **Mostly shelfware outside regulated industries.** Mandatory under FDA / ISO 26262 / DO-178C / Automotive SPICE. [Perforce](https://www.perforce.com/resources/alm/requirements-traceability-matrix) Absent that: *"manual construction and maintenance… proves to be costly… traceability is not feasible from a financial point of view"*; spreadsheet RTMs *"produce static, often outdated information."* Survives only where an auditor forces it. |
| **(d) Definition-of-Done / exit gates** | Team-wide checklist gating "done" | Low–medium | Plausible mechanism (a binary gate is cheap to check and hard to skip silently because it blocks the PR). One source claims 63–78% success rates vs 24% for weak performers — **could not find independent validation; treat as (c), evidence thin.** |
| **(e) Deprecation policies with enforced timelines** | Flag lifecycle states + **automated expiration alerts at 30/7/0 days** + CI blocking deploys that reference deprecated flags. [oneuptime](https://oneuptime.com/blog/post/2026-01-30-flag-lifecycle-management/view) | Medium — needs CI | **Strongest evidence of the set**, *when automated*: enforcement is a build failure, not a human checking a doc. The ledger and the enforcement are the same system. |
| **(f) Feature registries / capability manifests** | "Single source of truth for every approved tool" | Medium–high | **Thin/generic.** Sources are product marketing for registry tooling (SBOM, artifact registries), not independent studies of whether hand-maintained manifests stay accurate. Treat as (c). |

### The cross-cutting finding

> Every mechanism with real evidence of staying alive shares one trait: **the source of truth is coupled to something that breaks a build or blocks a merge if stale.** Pure documentation — ADRs, RTMs, capability manifests — rots without that coupling.

---

## Q3 — Automated detection tooling *(the most actionable question)*

| Category | Tools | Catches | False-positive profile |
|---|---|---|---|
| **Dead code / unreachable exports** | **knip** — now the standard; it absorbed `ts-prune`, `depcheck` and `unimported`, all three archived/unmaintained as of 2025. [comparison](https://knip.dev/explanations/comparison-and-migration) | Unused files, exports, dependencies | FPs from dynamic imports, framework conventions (e.g. Next.js pages), generated code. **Needs manual entry-file config to suppress.** |
| **API surface diffing** | Microsoft **api-extractor** → `.api.md` golden file per package; PR policy requires review whenever it diffs; `printApiReportDiff` prints the delta. [docs](https://api-extractor.com/pages/overview/demo_api_report/) · Rust: **cargo-public-api** (diffing) + **cargo-semver-checks** (semantic linting of *why* it breaks), both on rustdoc JSON with golden-file snapshot support. [github](https://github.com/cargo-public-api/cargo-public-api) | **Exactly the Engram failure mode** — a capability silently narrowing, or a param removed, appears as a diff line in review rather than something a human must remember to check | **Low.** These diff structural signatures, not implementation, so noise is limited to intentional non-breaking additions. `cargo-public-api` needs a nightly toolchain. |
| **Docs-vs-code drift** | **Drift** (VS Code ext; AST-anchors doc blocks to code) [repo](https://github.com/pallaprolus/drift-vscode) · Fiberplane's **Drift linter** (frontmatter-anchored specs) [blog](https://fiberplane.com/blog/drift-documentation-linter/) · DeepDocs (watches commits, proposes doc updates) | README claiming a feature the code no longer implements — the `lock_file` case | Anchor-based tools only catch drift for content explicitly anchored. **Un-anchored README claims — exactly the Engram case — are missed until anchors are retrofitted.** |
| **Orphaned DB columns** | **ColumnLens** (Rails/Ecto; classifies columns used / write-only / read-only / **orphaned**) [blog](https://geekmonkey.org/detecting-unused-database-columns-using-ecto-schemas/) · SchemaSpy "Orphan table" view · cloud DMV/query-log approaches | **Exactly the `parent_session_id` case** — a column written but never read, or vice versa | Needs either static ORM-schema analysis (framework-specific) or runtime query-log sampling (misses rare paths) |
| **"Documented but not implemented"** | **No dedicated tool category exists.** Closest: (1) **mutation testing** — PIT, mutmut, Stryker; deletion mutants that remove a validation yet stay green reveal exactly "a Zod enum/bound was dropped and nothing noticed" (ThoughtWorks Radar–adopted) [radar](https://www.thoughtworks.com/radar/techniques/mutation-testing) · (2) **golden-master / characterization testing** (Feathers) — records actual I/O as a baseline, flags deviation without needing the intended spec [wiki](https://en.wikipedia.org/wiki/Characterization_test) · (3) **contract testing** | The closest thing to automated spec-vs-reality checking | **None of them read prose docs.** All require an executable spec/contract or a pre-existing suite to diff. Mutation testing is compute-expensive (suite × N mutants) and needs tuning for equivalent-mutant noise; golden-master is brittle to *intentional* change. |

### Bottom line for Engram

**knip-class tooling would *not* have caught the Zod-enum or import-narrowing cases** — those are logic deletions, not dead exports. The correct fits are **mutation testing** for dropped validation, **API/contract snapshot diffing** for the `import` narrowing and `replay` disconnection, and a **doc-anchor drift linter** for the `lock_file` README claim.

---

## Q4 — Lightweight ledgers that did not become ceremony

- **Keep a Changelog** — succeeds precisely because there is **no tooling, no vendor, no schema**, just a convention: fixed categories (Added/Changed/**Removed**/Deprecated/Fixed/Security), ISO dates, newest-first, one file. Followed by tens of thousands of OSS projects. [keepachangelog.com](https://keepachangelog.com/en/0.3.0/)
  **Note:** its **`Removed`** category is exactly where an intentional feature removal goes. Had Engram used it, the `lock_file` disappearance would have been a one-line entry instead of a silent gap.
- **Shape Up (Basecamp/37signals)** — explicitly rejects sprints, story points and backlogs. The **hill chart** is one visual per piece of work showing "figuring out" (uphill) → "executing" (downhill). Not a task ledger — a *shared-understanding* artifact updated by whoever is doing the work, with no separate PM layer. [37signals](https://37signals.com/06)
- **37signals more broadly** — no full-time managers; status meetings replaced by automated async check-ins. DHH: *"manage processes before people."* [world.hey.com/dhh](https://world.hey.com/dhh/manage-process-before-people-20736695)
- **Walking skeleton** (Cockburn) — not a ledger but a structural analog: a minimal end-to-end implementation linking all main components early, so integration gaps surface immediately. **Directly relevant to the `import` narrowing** — a walking-skeleton test hitting all 6 tables from day one would have caught the 6→1 narrowing at commit time.

**Common thread among survivors:** a single artifact, zero required tooling, updated as a **side effect of work that was happening anyway** (a release, a cycle close) — never as separate governance work. The failures (RTMs outside regulated industries, generic capability manifests) all required dedicated upkeep disconnected from the flow of shipping.

---

## Q5 — Agent-specific prior art

- **GitHub Spec-Kit** — gated phases `Specify → Plan → Tasks → Implement`, each producing a persistent artifact (spec, plan, constitution) that later AI interactions must adhere to. [repo](https://github.com/github/spec-kit)
- **AWS Kiro** — generates `requirements.md` (EARS notation), `design.md`, `tasks.md` with **explicit requirement-to-task traceability built into the spec format**. [coverage](https://tessl.io/blog/from-vibe-coding-to-viable-code-aws-dives-into-spec-driven-ai-software-development-with-kiro/)
- **Tessl** (Guy Podjarny, $125M) — most aggressive position: "spec-as-source," code is a regenerable artifact never hand-edited; specs are the only durable truth.

### Counter-evidence on whether agents maintain such state

A practitioner design note on agent todo-persistence states plainly:

> *"Long-lived lists across sessions tend to grow into a junk drawer of stale items, and carrying stale in-progress items into a new session is problematic since the agent has no memory of why they were started."*

One implementation (ChatBotKit) responded by **auto-expiring** todo state after 24 hours rather than trusting long-term maintenance — an explicit admission that persisted agent state rots without active pruning. [discussion](https://mcpmarket.com/server/agent-todos)

This maps directly onto the Engram findings: the *capability* to persist state (`parent_session_id`, `replay`) existed but was never wired end-to-end — the exact failure mode spec-driven tools try to prevent by making the spec generative, and that todo tools try to prevent by expiring rather than accumulating.

---

## Q6 — Counter-evidence against adding tracking machinery

1. **A stale register is worse than none.** *"A register you built carefully and then froze isn't neutral — it's worse than nothing, because it looks authoritative… everyone builds the register, but almost nobody maintains it."* This is the sharpest counter to the originally-proposed fix: an unenforced ledger reproduces the audited failure mode (a README claiming an untrue capability), just relocated. [source](https://ai.plainenglish.io/your-risk-register-is-already-dead-heres-the-15-minute-ai-workflow-that-keeps-it-alive-bcbe960b0e0f)
2. **Process theater.** *"Teams hold stand-ups, run sprints, and conduct retrospectives, but these become symbolic rather than functional… Employees may comply with visible processes to demonstrate adherence rather than solve real problems."* [The New Stack](https://thenewstack.io/process-theater-vs-technical-excellence-a-recurring-software-crisis/)
3. **Goodhart's Law.** Any tracked completion/traceability metric invites gaming — spuriously closing items to clean a dashboard, inflating linked-requirement counts. *"Even 100% honest pursuit of a metric, taken far enough, is harmful to your goals."* [Hillel Wayne](https://buttondown.com/hillelwayne/archive/goodharts-law-in-software-engineering/)
4. **RTM cost.** *"Manual construction and maintenance of a traceability matrix proves to be costly… not feasible from a financial point of view"*; spreadsheets *"produce static, often outdated information and lack proactive notification."* [Jama](https://www.jamasoftware.com/requirements-management-guide/requirements-traceability/traceability-matrix-101/)
5. **ADR overhead.** *"If a team creates an ADR for every library bump, naming tweak, or trivial refactor, people stop reading them and the signal gets buried under noise."* The failure isn't having no record — it's having so many low-value records that people stop reading any.

### Practical synthesis

The mechanisms with genuine survival evidence avoid this trap **not by more willpower**, but by either:

- **(a)** coupling the ledger to something that already breaks or blocks when wrong — CI-enforced flag expiry, RFC tracking-issue labels checked at triage, api-extractor's PR-blocking diff; or
- **(b)** keeping it so cheap and tightly scoped that maintaining it costs less than not maintaining it — Keep a Changelog's single file, Shape Up's hill chart as an update-in-passing artifact.

**A register that is only a register — reviewed by nobody, enforced by nothing — has no empirical track record of surviving**, and the strongest counter-evidence says it actively makes things worse by manufacturing false authority.

---

<!-- SILENT_FEATURE_DROP_RESEARCH:COMPLETE -->
