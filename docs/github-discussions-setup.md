# Engram — GitHub Discussions Setup

**Created:** March 4, 2026  
**Purpose:** Define Discussion categories, descriptions, format types, and pinned post bodies for launch.

---

## How to Enable Discussions

1. Go to `github.com/keggan-std/Engram` → **Settings** → **General**
2. Scroll to **Features** section
3. Check **Discussions** → Save
4. Go to the new **Discussions** tab → click **Edit categories** (pencil icon)

---

## Category Definitions

GitHub allows customizing each category with: **emoji**, **name**, **description**, and **format** (`Open discussion`, `Q&A`, or `Announcement`).

---

### 1. 📣 Announcements

| Field | Value |
|-------|-------|
| **Emoji** | 📣 |
| **Name** | Announcements |
| **Description** | Official releases, changelogs, and news from the maintainer. |
| **Format** | `Announcement` — only maintainers can post; anyone can comment. |

**Pinned post body:**

---

```markdown
# Welcome to Engram! 👋

Thanks for being here — this is the official space for Engram announcements,
discussions, and community help.

**Engram** is a persistent memory MCP server for AI coding agents. It gives
agents like Claude, Cursor, and Windsurf session continuity, change history,
decision logs, and file notes — without cloud dependency. Everything lives in
a local SQLite database next to your project.

## Quick links

- 📦 [npm package](https://www.npmjs.com/package/engram-mcp-server)
- 📖 [README](../README.md)
- 🐛 [Report a bug](../../issues/new?template=bug_report.md)
- 💡 [Suggest a feature](../../discussions/new?category=ideas)

## Install in 30 seconds

\`\`\`bash
npx -y engram-mcp-server --install
\`\`\`

This auto-detects your IDE (Claude Desktop, Cursor, Windsurf, VS Code Copilot,
Visual Studio, Trae) and configures Engram for you.

---

Watch this category for version releases and important updates.
```

---

### 2. 🙋 Q&A

| Field | Value |
|-------|-------|
| **Emoji** | 🙋 |
| **Name** | Q&A |
| **Description** | Ask anything about setup, config, IDE integration, or agent workflows. |
| **Format** | `Q&A` — answers can be marked as the accepted solution. |

**Pinned post body:**

---

```markdown
# Ask anything — no question is too basic

Whether you're setting up Engram for the first time or building a complex
multi-agent workflow, this is the place to ask.

## Before posting

1. Check the [README](../README.md) — install, quickstart, and tool reference are there.
2. Search existing Q&A — your question may already be answered.

## Good questions to ask here

- "Engram isn't showing up in my IDE — what do I check?"
- "How do I use `agent_role: sub` for parallel agents?"
- "What's the difference between PM-Lite and PM-Full?"
- "How do I migrate the database when I move a project folder?"

## Getting faster answers

Include:
- Your IDE name and version
- Engram version (`npx engram-mcp-server --version`)
- The exact error message or unexpected behavior
- Your OS (Windows / macOS / Linux)
```

---

### 3. 💡 Ideas

| Field | Value |
|-------|-------|
| **Emoji** | 💡 |
| **Name** | Ideas |
| **Description** | Propose features, integrations, or workflow improvements. Vote with 👍. |
| **Format** | `Open discussion` |

**Pinned post body:**

---

```markdown
# Share your ideas for Engram

This is where the roadmap grows. If you have a feature request, integration
idea, or workflow improvement — post it here.

## Tips for a great idea post

- **One idea per post** — makes it easier to discuss and vote on
- **Describe the problem first** — what can't you do today that you wish you could?
- **Show a usage example** — even pseudo-code helps
- **Vote with 👍** on ideas you want to see prioritized

## Currently considering

- Web dashboard UI for browsing memory, decisions, and tasks
- Git commit hook integration (auto-record changes on commit)
- Export/import memory between projects
- VS Code extension for visual context browsing

Ideas with the most 👍 reactions get moved into the tracked roadmap first.
```

---

### 4. 🛠️ Show & Tell

| Field | Value |
|-------|-------|
| **Emoji** | 🛠️ |
| **Name** | Show & Tell |
| **Description** | Share your Engram setups, agent workflows, and integration wins. |
| **Format** | `Open discussion` |

**Pinned post body:**

---

```markdown
# Show how you use Engram

Did Engram save you from re-explaining your entire codebase to an agent?
Built a clever multi-agent workflow? Found a great `agent_rules` setup?
Share it here.

## Great things to share

- Your `.engram/` setup and what's in your `agent_rules`
- A `session start → session end` transcript showing real context recovery
- Multi-agent coordination patterns (main + sub-agent splits)
- How you structure tasks and decisions for long projects
- IDE-specific configs that work well (Cursor, Windsurf, VS Code Copilot)

## Format suggestion

\`\`\`
## What I built / set up
[description]

## The setup
[config, code, or screenshot]

## What it enables
[what the agent can now do that it couldn't before]
\`\`\`

The best posts may be featured in the README "Community Workflows" section.
```

---

### 5. 🗺️ Roadmap

| Field | Value |
|-------|-------|
| **Emoji** | 🗺️ |
| **Name** | Roadmap |
| **Description** | Track what's coming, react to planned features, and influence priorities. |
| **Format** | `Open discussion` |

**Pinned post body:**

---

```markdown
# Engram Roadmap — What's Coming

This thread tracks features in planning and development. React with 👍 to
signal priority, or reply with implementation thoughts.

## Recently shipped

- ✅ **v1.10.0** — PM Framework (PM-Lite auto-ON, PM-Full opt-in)
- ✅ **v1.9.x** — Multi-instance cross-project sharing
- ✅ **v1.8.x** — Web dashboard (HTTP server + WebSocket broadcaster)
- ✅ **v1.7.x** — Universal mode (single `engram` tool, ~80 token schema)
- ✅ **v1.6.x** — Sub-agent sessions (`agent_role: "sub"`)

## Active development

- 🔄 Dashboard UI polish and performance improvements
- 🔄 Installer coverage for additional IDEs

## Under consideration

- ⏳ VS Code extension for visual memory browsing
- ⏳ `engram export` for shareable project snapshots
- ⏳ Scheduled event enhancements (recurring events)
- ⏳ BM25 + semantic hybrid search

## How priorities are set

1. Upvotes on Ideas (#ideas category)
2. Real user pain points reported in Q&A
3. What the maintainer is using day-to-day

---

Have a strong opinion on any of these? Reply here or open an Idea post.
```

---

### 6. 💬 General

| Field | Value |
|-------|-------|
| **Emoji** | 💬 |
| **Name** | General |
| **Description** | Introductions, off-topic chats, and anything that doesn't fit elsewhere. |
| **Format** | `Open discussion` |

**Pinned post body:**

---

```markdown
# Welcome — introduce yourself!

Tell us what you're building with Engram, which IDE you use, and what
brought you here.

## About this category

General is for anything that doesn't fit the other categories:
- Introductions
- Thoughts on AI agent memory as a concept
- Related tools and integrations you're watching
- Meta feedback about this community

The more specific your question or idea, the better the dedicated categories
(Q&A, Ideas, Show & Tell) will serve you — but nothing is off-topic here.
```

---

## Category Order (recommended)

Set this display order in the GitHub UI:

1. 📣 Announcements
2. 🗺️ Roadmap
3. 🙋 Q&A
4. 💡 Ideas
5. 🛠️ Show & Tell
6. 💬 General

---

## Optional: Discussion Labels

GitHub lets you add labels to discussions (same system as Issues). Recommended set:

| Label | Color | Description |
|-------|-------|-------------|
| `help wanted` | `#008672` | Looking for community input or a contributor |
| `good first issue` | `#7057ff` | Appropriate for new contributors |
| `answered` | `#0075ca` | Q&A thread has an accepted answer |
| `planned` | `#e4e669` | Feature request added to roadmap |
| `won't fix` | `#e0e0e0` | Considered and declined — see comment for reason |
| `stale` | `#ededed` | No activity in 60+ days |
| `v2-candidate` | `#d93f0b` | Held for a future major version |

---

## Setup Checklist

- [ ] Enable Discussions in repo Settings → General → Features
- [ ] Delete default categories (General, Poll) that you won't use
- [ ] Create all 6 categories with matching emoji, description, and format type
- [ ] Reorder categories per the recommended order above
- [ ] Post and **pin** each opening post in its category
- [ ] Create issue labels from the table above
- [ ] Add a "Discussions" badge to README (optional)

### README badge snippet

```markdown
[![GitHub Discussions](https://img.shields.io/github/discussions/keggan-std/Engram)](https://github.com/keggan-std/Engram/discussions)
```
