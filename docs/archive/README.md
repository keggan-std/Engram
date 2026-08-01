# Archive

Superseded, shipped, or point-in-time documents. **Not part of the active working set** — see
[`../README.md`](../README.md) for what to read.

These are kept rather than deleted because git history records *that* a file was removed but not
*why*, and several of these explain decisions still visible in the code.

**Nothing here should be treated as describing current behaviour.**

| Document | Why archived |
|---|---|
| `cross-instance-sharing-bugs.md` | **Resolved in v1.9.2** (`cb707d0`). Kept deliberately, banner and all, as the case study for finding F5 — it asserted "not yet fixed" for ~8 versions *after* the fix shipped. One residual gap (F4) is tracked in task #6 |
| `hotfix-1.8.1.md` | Shipped in v1.8.1. The design it describes lives on in `multi-ide-concurrency.md` |
| `installer-ux-redesign-and-android-studio.md` | Shipped in `804a8d7`. **Note:** the README's `--ide` list still omits `androidstudio` — audit §7 |
| `v1.11-dx-improvements.md` | Shipped in v1.11.0. **Note:** its `record_observation` example does not match the real schema — audit §7. The real columns are `content` / `file_path` / `agent_name` |
| `pm-framework-integration-plan.md` | Superseded by `-v2`, then by the shipped feature |
| `pm-framework-integration-plan-v2.md` | Shipped as PM-Lite / PM-Full. Live reference is `../pm-framework-v1.10.0.md` |
| `dashboard-plan.md`<br>`dashboard-implementation-plan.md`<br>`dashboard-execution-strategy.md`<br>`dashboard-design.md`<br>`dashboard-assets.md`<br>`dashboard-useful-docs-index.md` | Six planning docs for a feature that shipped as `packages/engram-dashboard`. Retained for design rationale only. **Note:** several dashboard routes are stubs or double-mounted — constitution §11 |
| `discoverability-plan.md`<br>`preflight-assessment.md`<br>`github-discussions-setup.md`<br>`logo-spec.md` | Point-in-time launch/marketing work, executed |
| `skill-and-instructions-builder-analysis.md` | Point-in-time analysis, superseded by `../trellis-engram-integration-analysis.md` |

---

## Adding to this archive

1. Add a banner at the top of the doc stating the resolution — version and commit.
2. `git mv` it here.
3. Add a row above saying why.

Step 1 is the one that matters. A doc moved here *without* a banner still misleads anyone who opens
it directly from a search result or a stale link.

---

<!-- ARCHIVE_INDEX:COMPLETE -->
