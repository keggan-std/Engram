# Discoverability Pre-Flight Assessment

**Date:** February 27, 2026  
**Purpose:** Readiness check before executing the discoverability plan (`docs/discoverability-plan.md`)

---

## Summary

The repo is not ready to submit to directories. Three blockers need resolving first; ignoring them wastes the first impression on every human reviewer and auto-scanner that would evaluate the submission.

---

## 🔴 Blockers

### 1. Broken CI Badge
The README badge references `.github/workflows/ci.yml` — that file does not exist. The badge renders as broken/unknown on GitHub, npm, and every directory listing. This is the first signal a skeptical developer checks. A broken badge implies abandonment or carelessness.

**Fix:** Add a minimal `ci.yml` that runs `npm test` on push, or replace the badge with one that resolves correctly until CI is real. The badge should be green before any public submission.

### 2. Uncommitted Working Tree
`git status` shows the repo is behind on commits:
- `README.md` — modified (today's docs work not yet published)
- `docs/challenges.md`, `improvement-plan.md`, `manual-build-v1.6.md`, `v1.7-implementation-notes.md`, `scheduled-events.md` — deleted on disk, not committed
- `.github/copilot-instructions.md`, `docs/discoverability-plan.md`, `docs/how-to-schedule-events.md` — untracked, not committed

The GitHub repo (what directory reviewers actually see when clicking the link in a PR) reflects none of today's documentation work. Submitting while in this state means reviewers see the old README, no copilot instructions, and stale docs.

**Fix:** Commit and push everything before submitting anywhere.

### 3. Expired npm Token — Keywords Blocked
Expanding `package.json` keywords (Tier 1, highest-ROI npm fix) has no effect until a new version is published. npm search will not pick up new keywords on an unpublished change.

**Fix:** Renew npm token, bump to `v1.7.4` (patch — no code changes needed), publish. This also delivers the `author` and `homepage` fixes to npm.

---

## 🟡 Awareness Items

### Deleted Docs Need a Decision
`challenges.md`, `improvement-plan.md`, `manual-build-v1.6.md`, `v1.7-implementation-notes.md` are deleted on disk but still staged as deletions. Confirm these are intentional cleanups, then commit with a clear message (`docs: remove stale internal development notes`). If any were deleted accidentally, restore them now before committing.

### awesome-mcp-servers PR Is Human-Reviewed
This is the highest-impact submission, but it's reviewed manually. Reviewers check: active repo, GitHub topics set, professional README, some stars (social proof). Engram currently has 0 public stars. It won't cause a rejection, but it lengthens the queue wait. Set GitHub topics first — the CONTRIBUTING guide for that repo asks for it.

### The Directory Submission Chain Has Dependencies
Steps that must happen in order:
1. GitHub topics + repo description → set first (reviewers check this)
2. awesome-mcp-servers PR → after topics are set
3. glama.ai → syncs automatically from awesome-mcp-servers after merge (takes days to weeks, not instant)
4. npm keywords → require a published version

Jumping ahead in this chain (e.g. submitting to glama before awesome-mcp-servers) yields no result.

### Author Field Is Empty
`package.json` has `"author": ""`. Every npm search result card shows "by " with nothing. Fix before next publish (30 seconds).

---

## ✅ Genuine Strengths

- **README quality is high** — detailed, structured, has a logo, architecture diagrams, multi-IDE coverage. Not a toy project.
- **Strong differentiator** — local SQLite, no cloud, MCP-native, multi-agent, 10 IDE support. These are real claims, not marketing.
- **Timing advantage** — MCP ecosystem is growing fast. awesome-mcp-servers adds ~50 tools/week. Early listings compound in visibility.
- **Install UX is polished** — `npx -y engram-mcp-server --install` with auto-detection is a cut above manual JSON editing; it sells itself in a demo.
- **v1.7.3 stability** — the public hotfix release showing 20 bugs systematically fixed signals active, disciplined maintenance.

---

## Pre-Flight Checklist (Ordered)

| # | Action | Est. Time |
|---|--------|-----------|
| 1 | Decide on deleted docs — commit deletions or restore | 5 min |
| 2 | Add `.github/workflows/ci.yml` to fix the build badge | 15–30 min |
| 3 | Commit all changes and push to origin/main | 5 min |
| 4 | Set GitHub topics + repo description (manual on GitHub.com) | 10 min |
| 5 | Fix `author`, `homepage`, and keywords in `package.json` | 5 min |
| 6 | Renew npm token, bump to `v1.7.4`, publish | 15 min |
| **Then** | Execute discoverability plan starting at Tier 1 | — |

---

## Related
- `docs/discoverability-plan.md` — Full prioritized action plan
- Decision #14 — Discoverability research findings
- Task #16 — Ordered action checklist in Engram memory
