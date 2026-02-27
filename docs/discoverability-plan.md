# Engram — GitHub & npm Discoverability Plan

**Researched:** February 27, 2026  
**Status:** Backlog (Task #16 in Engram memory)  
**Decision:** #14

---

## Executive Summary

Engram has strong fundamentals (good README, clean package.json description, proper install UX) but is **invisible** in every channel where developers discover MCP tools. Zero GitHub topics, not listed on the main MCP discovery hubs, and severely under-keyworded on npm. All of this is fixable in under a day of effort.

---

## Current State Audit

| Signal | Status | Notes |
|--------|--------|-------|
| GitHub topics | ❌ None set | Single biggest SEO gap |
| awesome-mcp-servers listing | ❌ Not listed | 81.7k ⭐ hub — primary MCP discovery channel |
| glama.ai/mcp/servers listing | ❌ Not listed | Web directory synced from awesome-mcp-servers |
| smithery.ai listing | ❌ Not listed | Growing MCP registry with install stats |
| npm keywords | ⚠️ Only 6 | Should be 20–25 |
| GitHub repo description | ❓ Likely unset | package.json has it; GitHub About may be empty |
| GitHub repo website field | ❌ Not set | Should link to npmjs page |
| package.json `author` | ❌ Empty string | Required for npm search attribution |
| package.json `homepage` | ❌ Missing | npm package page shows no homepage link |
| Social preview image (OG) | ❌ None | Hurts CTR when shared on Twitter/LinkedIn/HN |
| Star CTA in README | ❌ None | No prompt for users to star |
| Demo GIF/video | ❌ None | Visual proof of value missing |
| Comparison table vs alternatives | ❌ None | mem0, MemGPT — devs search comparisons |
| .github/FUNDING.yml | ❌ None | No Sponsor button |
| llms.txt | ❌ None | Emerging AI-crawler standard |
| Community presence | ❌ None | r/ClaudeAI, r/LocalLLaMA, HN, ProductHunt |
| CI badge | ⚠️ Check | Badge references ci.yml — verify it's green |

---

## Prioritized Action Plan

### 🔴 Tier 1 — Critical, 1–2 hrs total

#### 1. Set GitHub Repository Topics (15 min)
Go to: `github.com/keggan-std/Engram` → Settings → Topics (gear icon in About section)

Add all of these:
```
mcp
model-context-protocol
mcp-server
ai-memory
persistent-memory
session-memory
coding-agent
ai-agent
llm
claude
cursor
windsurf
copilot
vscode
typescript
sqlite
nodejs
developer-tools
multi-agent
agent-coordination
```

**Why:** GitHub topic search is how devs find tools. Every competitor on awesome-mcp-servers appears via `topic:mcp-server` searches. This is the single highest-ROI change.

---

#### 2. PR to awesome-mcp-servers (30 min)
Repo: `https://github.com/punkpeye/awesome-mcp-servers`  
Section: **🧠 Knowledge & Memory** (or 🤖 Coding Agents — both apply)

Line to add:
```markdown
• [keggan-std/Engram](https://github.com/keggan-std/Engram) 📇 🏠 🍎 🪟 🐧 - Persistent memory cortex for AI coding agents. Session continuity, change tracking, decision logging, and multi-agent coordination across sessions using local SQLite. Works with Claude Code, Cursor, Windsurf, VS Code Copilot, and any MCP client.
```

Legend used:
- 📇 = TypeScript
- 🏠 = Local service
- 🍎🪟🐧 = macOS + Windows + Linux

**Why:** 81.7k stars, 1,058 contributors, synced to glama.ai directory. This is where every developer looks for MCP tools.

---

#### 3. Expand npm Keywords (5 min)
Edit `package.json` → `keywords` array. Replace current 6 with:

```json
"keywords": [
  "mcp",
  "model-context-protocol",
  "mcp-server",
  "ai-memory",
  "persistent-memory",
  "session-memory",
  "session-continuity",
  "coding-agent",
  "ai-agent",
  "llm",
  "agent-memory",
  "llm-memory",
  "multi-agent",
  "agent-coordination",
  "task-tracking",
  "decision-logging",
  "change-tracking",
  "context-persistence",
  "claude",
  "cursor",
  "windsurf",
  "copilot",
  "vscode",
  "sqlite",
  "developer-tools"
]
```

**Why:** npm search weights keywords heavily. Devs searching "agent memory", "llm memory", "cursor mcp" currently find nothing.

---

#### 4. Set GitHub Repo About Description + Website (2 min)
On GitHub repo page → click gear ⚙️ next to "About"

**Description:**
```
Persistent memory cortex for AI coding agents — session continuity, change tracking, decision logging & multi-agent coordination via MCP
```

**Website:** `https://www.npmjs.com/package/engram-mcp-server`

**Why:** The About section is indexed by GitHub search and Google. Currently invisible.

---

#### 5. Fix package.json Author + Homepage (2 min)

```json
"author": "Keggan Student",
"homepage": "https://github.com/keggan-std/Engram#readme",
```

**Why:** Blank `author` makes npm search results show no attribution. Missing `homepage` means the npm package page has no project link.

---

### 🟠 Tier 2 — High Impact, A Few Hours

#### 6. Submit to glama.ai/mcp/servers (10 min)
URL: `https://glama.ai/mcp/servers`  
Usually done automatically after awesome-mcp-servers PR merges, but can be submitted directly.

#### 7. Submit to smithery.ai (10 min)
URL: `https://smithery.ai`  
Growing MCP registry that tracks install counts + provides one-click install snippets. Good for visibility among non-technical early adopters.

#### 8. Submit to mcp.so (10 min)
Another MCP directory with search. Submit via their contribution process.

---

### 🟡 Tier 3 — Medium Impact, More Effort

#### 9. Social Preview Image / GitHub OG Image (30–60 min)
Go to: Settings → Social Preview → Upload image

Recommended design:
- Dark background
- Engram logo (left)
- Tagline: `"Persistent memory for AI coding agents"`
- Sub-line: `"Session continuity · Decision logging · Multi-agent coordination"`
- `npx -y engram-mcp-server --install` command pill

**Why:** Every share on Twitter/X, LinkedIn, HackerNews, Discord shows this image. Without it GitHub shows a generic placeholder.

#### 10. README Improvements (1–2 hrs)

**Add star CTA** near top of README:
```markdown
⭐ **If Engram saves you tokens, give it a star — it helps others find it!**
```

**Add demo GIF/screenshot** showing a real before/after:
- Before: Agent re-discovering architecture every session
- After: Agent receives full context instantly from `engram_session(action:"start")`

**Add comparison section:**
| Tool | Approach | Local? | MCP Native? | Multi-Agent? |
|------|----------|--------|-------------|--------------|
| Engram | SQLite + structured memory | ✅ | ✅ | ✅ |
| mem0 | Cloud vector DB | ❌ | ⚠️ | ⚠️ |
| MemGPT | In-context manipulation | ✅ | ⚠️ | ❌ |

#### 11. Add .github/FUNDING.yml (5 min)
```yaml
# .github/FUNDING.yml
github: [keggan-std]
```
Shows a "Sponsor" button. Signals active maintenance. Even if not seeking donations.

#### 12. Add llms.txt to repo root (15 min)
Emerging standard (see llmstxt.org). A plain text file describing the project for AI crawlers.

```
# Engram

> Persistent memory cortex for AI coding agents

Engram is an MCP (Model Context Protocol) server that gives AI coding agents 
persistent memory across sessions. Agents call engram_session(action:"start") 
and instantly receive prior session summary, decisions, conventions, tasks, and 
file notes — ranked by relevance.

## Installation
npx -y engram-mcp-server --install

## Source
https://github.com/keggan-std/Engram

## npm
https://www.npmjs.com/package/engram-mcp-server
```

---

### 🔵 Tier 4 — Community & Launch (Plan Separately)

#### 13. Reddit posts
- r/ClaudeAI — most relevant audience
- r/LocalLLaMA — power users who run local models
- r/ChatGPTCoding — broader AI coding audience
- r/programming — general devs

Post angle: "I built a persistent memory layer for AI coding agents — tired of agents re-discovering your codebase every session"

#### 14. Hacker News — Show HN
Title: `Show HN: Engram – Persistent memory for AI coding agents via MCP`

Best time: Tuesday–Thursday, 9–11am US Eastern

#### 15. ProductHunt Launch
Requires more preparation: hunter, tagline, gallery, maker comment. Plan as a separate initiative once listing is polished.

---

## npm Keywords — Current vs Target

| Current (6) | Target additions |
|-------------|-----------------|
| mcp | mcp-server |
| model-context-protocol | claude, cursor, windsurf, copilot, vscode |
| ai-memory | agent-memory, llm-memory, session-memory |
| coding-agent | ai-agent, llm |
| persistent-memory | multi-agent, agent-coordination |
| session-continuity | context-persistence, decision-logging, change-tracking, sqlite, developer-tools |

---

## MCP Ecosystem Directory Checklist

| Directory | URL | Status |
|-----------|-----|--------|
| awesome-mcp-servers | github.com/punkpeye/awesome-mcp-servers | ❌ Not listed |
| glama.ai | glama.ai/mcp/servers | ❌ Not listed |
| smithery.ai | smithery.ai | ❌ Not listed |
| mcp.so | mcp.so | ❌ Unknown |
| mcpregistry.org | mcpregistry.org | ❌ Unknown |

---

## Related Engram Memory
- Decision #14 — Full research findings  
- Task #16 — Ordered action checklist
