# Security Policy

## Overview

Engram is a **local MCP server** with no remote database and no telemetry. All
data is stored in a project-local SQLite file (`.engram/memory.db`), a
user-local global knowledge base (`~/.engram/global.db`), and — only when no
project root can be detected — a fallback project database at
`~/.engram/global/memory.db`. There is no cloud sync, and no data that leaves
the machine without explicit user action.

**Engram does ship an HTTP server**, used by the optional dashboard. It is
**off unless explicitly requested** (`--mode=dashboard` or
`ENGRAM_MODE=dashboard`), binds **loopback only** (`127.0.0.1`, default port
7432), and is **token-authenticated** — WebSocket upgrades are rejected on
token mismatch. It is in scope for this policy; see
[Dashboard HTTP Server](#dashboard-http-server) below.

This means Engram's attack surface is narrow and mostly concerns local system
security. Nonetheless, we take security issues seriously and ask for responsible
disclosure for anything that could harm users.

---

## Supported Versions

Security fixes are applied to the **latest stable release** only. We do not
backport security fixes to older minor or patch versions.

| Version                                                | Supported              |
| ------------------------------------------------------ | ---------------------- |
| Latest stable (`npm install engram-mcp-server@latest`) | ✅ Yes                 |
| Older minor versions                                   | ❌ No — please upgrade |

If you are on an older version, upgrade to the latest before reporting a
potential issue. The problem may already be fixed.

---

## Reporting a Vulnerability

**Do not open a public GitHub Issue for security vulnerabilities.** Doing so
discloses the vulnerability to everyone before it can be patched.

Instead, use one of the following private channels:

1. **GitHub Private Security Advisory:**
   Navigate to [Security → Advisories → New draft advisory](https://github.com/keggan-std/Engram/security/advisories/new)
   on the repository. This is the preferred method.

2. **Email:**
   Send a detailed report to the maintainer's email (linked on the GitHub
   profile). Encrypt with PGP if available — public key on Keybase or GitHub.

### What to Include in Your Report

A useful vulnerability report includes:

- **Description** of the vulnerability and its potential impact
- **Affected version(s)** of `engram-mcp-server`
- **Steps to reproduce** — be specific and minimal
- **Proof of concept** code or a demonstration (if applicable)
- **Your suggested fix** (optional, but appreciated)

### What Happens Next

| Timeline            | Action                                       |
| ------------------- | -------------------------------------------- |
| Within **48 hours** | Acknowledgement of receipt                   |
| Within **7 days**   | Initial severity assessment and response     |
| Within **30 days**  | Patch or mitigation, depending on complexity |
| After patch         | Public disclosure coordinated with reporter  |

We follow a **coordinated disclosure** model. We ask that you give us reasonable
time to patch before any public disclosure. We will credit you in the release
notes and security advisory unless you prefer to remain anonymous.

---

## Threat Model

Understanding what Engram does — and doesn't — do helps scope what constitutes
a genuine security issue.

### In Scope

Reports in the following categories are welcome:

- **Path traversal or arbitrary file read/write** via `file_path` parameters or
  the backup/restore functionality
- **SQL injection** through any user-controlled input that reaches the SQLite
  layer without parameterization
- **Code injection** through the `npx` installer or config writer that results
  in unintended code execution
- **Privilege escalation** — any scenario where Engram's operation grants access
  beyond what the user already has
- **Sensitive data leakage** — accidental inclusion of API keys, tokens, or PII
  in MCP responses, logs, or exports
- **Insecure defaults** in the installer that write overly permissive configs
  to IDE configuration files

### Out of Scope

The following are **not** considered security vulnerabilities for Engram:

- Issues requiring **physical access** to the machine (Engram is a local tool)
- Vulnerabilities in `better-sqlite3`, `zod`, or `@modelcontextprotocol/sdk`
  that are not exploitable through Engram's use of those libraries — report
  those directly to the respective package maintainers
- Denial-of-service via large inputs (Engram is not a public service)
- Issues that require the attacker to already have write access to `.engram/`
  or `~/.engram/` (if you own those dirs you own the data)
- Scanner findings without a demonstrated exploit path

---

## Security Architecture Notes

These notes help security researchers understand Engram's design:

### Data Flow

```
AI Agent (IDE) → MCP Protocol (local stdio/pipe) → Engram Server → SQLite (.engram/)
```

**In the default MCP mode** no TCP port is opened and there is no remote
endpoint: communication is over a local stdio pipe managed by the IDE's MCP
runtime. The dashboard mode below is the one exception, and it is opt-in.

<a id="dashboard-http-server"></a>

### Dashboard HTTP Server

Started only by `--mode=dashboard` / `ENGRAM_MODE=dashboard`
(`src/index.ts:140-142`). When started it:

- binds `127.0.0.1` only — never `0.0.0.0`
- refuses any request whose `Host` header is not a loopback **name**, with
  `403 FORBIDDEN_HOST`, before CORS and before any route including `/health`
  (`src/http-auth.ts` → `isLocalHostHeader`, mounted in `src/http-server.ts`
  and repeated in the raw WebSocket upgrade handler, which does not pass
  through Express). This is the DNS-rebinding guard: a rebound request is
  same-origin from the browser's point of view, so it carries no `Origin` and
  CORS cannot see it — only `Host` can.
- generates a per-project token, requires `Authorization: Bearer <token>` on
  every `/api` route, and rejects WebSocket upgrades that do not present it.
  Comparison is constant-time (`src/http-auth.ts`).
- redacts secrets from `GET /api/v1/settings` and refuses writes to
  security-relevant config keys (`src/http-routes/settings.routes.ts`)

The token is passed to the browser in the URL **fragment**, which is never
transmitted to a server and is stripped from `Referer`. It is **not** encrypted
at rest: `.engram/token` is a plain file, mode `0600` on POSIX and unprotected
on Windows.

Reports against this surface **are in scope**, including any path that reaches
it without the token, any bind to a non-loopback interface, and any secret that
survives redaction.

### File System Access

Engram reads and writes:

- `.engram/memory.db` — project-local database
- `~/.engram/global.db` — cross-project global knowledge base
  (`src/global-db.ts:18`)
- `~/.engram/global/memory.db` — fallback project database, used only when no
  project root is detected (`src/utils.ts:251`)
- `.engram/backups/` — user-triggered backup files
- `.engram/token` — dashboard bearer token, written mode `0600` on POSIX and
  with no mode protection on Windows. Created only in dashboard mode.
- `.engram/.gitignore` — written on init (`src/database.ts:412-416`) containing
  `*`, so the database cannot be committed by accident. The repository root
  `.gitignore` is also appended to when present.
- `.engram/git-changes.log` — written by the optional post-commit hook
- `~/.engram/instances.json` — **machine-wide**, and the one entry here that is
  not project-local. Every Engram instance on the machine registers its
  absolute project path, label, machine id and record counts. Any local process
  running as you can read it, and it is how cross-instance discovery works.
  Sharing is `none` by default, so registration alone exposes no memory
  *content* — but the list of project paths is disclosed to anything that can
  read the file.

It also reads `/etc/machine-id` on Linux and the Windows registry
(`src/utils.ts`) to derive a stable machine identifier.

`.engram/agent_rules_cache.json` is **no longer read or written**. It was the
cache-poisoning vector fixed in v1.13.0; the current code names it only to
detect and report a leftover file. If one exists on your machine it is inert.

It does **not** read arbitrary project files. File notes store only metadata
provided by the agent — not raw file content.

### Network Access

Engram makes outbound network calls from exactly **two** places in `src/`, both
version checks against the npm registry:

| Source | Call |
|---|---|
| `src/services/update.service.ts` | latest published version from `registry.npmjs.org`, falling back to the GitHub releases API (`api.github.com`) when npm is unreachable |
| `src/installer/index.ts` | latest published version from `registry.npmjs.org`, to show whether the installed copy is current |

Both are:

- Fire-and-forget (async, non-blocking)
- Version number only, no identifying information sent
- Disabled by setting `auto_update_check: false` in Engram config

Nothing else leaves the machine. In particular there is **no telemetry**, and
agent rules are **not fetched at runtime** — see below.

### Agent Rules Are Packaged, Never Loaded From Disk

The `agent_rules` returned by `engram_session(action:"start")` ship inside the
npm package. They are versioned with the release, and **no file on disk and no
network response can influence them.**

Up to and including **v1.12.0** this was not true, and **v1.13.0 is the release
that fixes it.** Engram fetched rules from the
GitHub README at session start — an undisclosed outbound call this section
previously denied — and cached them at `.engram/agent_rules_cache.json`, which
was read back with a cast rather than a validation. Because `.gitignore` does
not stop a repository from *shipping* a file, any repository could commit that
cache and hand every agent that opened the project a set of attacker-authored
instructions labelled CRITICAL and binding, permanently and offline.

That entire mechanism has been **removed in v1.13.0** rather than hardened, which is the fix
Anthropic shipped for the structurally identical CVE-2026-21852 ("MemoryTrap")
in Claude Code v2.1.50. Validating untrusted instructions harder still leaves
you loading untrusted instructions.

If a leftover `agent_rules_cache.json` is found, Engram ignores it, logs a
warning, and returns a `security_notice` on session start. It does **not**
delete the file — inspect it before you do.

### `npx` Execution Model

Engram is distributed and executed via `npx -y engram-mcp-server`. The `-y`
flag bypasses the interactive prompt. Users who are concerned about this
pattern can install globally (`npm install -g engram-mcp-server`) and pin to a
specific version.

---

## What Engram Does Not Promise

Stated plainly, because a limitation nobody wrote down is one the user finds out
about at the worst moment. These are refusals, not roadmap items.

**We do not promise stored memory is TRUE.** Provenance answers *who wrote this*.
Nothing answers *is this correct*. A decision, convention or file note is a claim
made by whoever wrote it, and agents write confidently about things they are
wrong about. Treat memory as testimony, not as fact.

**We do not defend against a process running as you.** The threat model draws
its line at other *users* and at content arriving from outside — hostile repos,
hostile pull requests, web pages you visit. Anything running under your own
account can read `.engram/memory.db` and `.engram/token` directly. File modes do
not stop it and are a no-op on Windows.

**There is no encryption, at rest or in transit.** The database, the global
knowledge base and the token are plain files. Dashboard traffic is plain HTTP
over loopback. If the disk is not encrypted, neither is your memory.

**Prompt-injection defence raises cost; it does not prevent.** Engram removes
the paths it can — agent rules ship in the package rather than being fetched,
and untrusted text is not loaded into a trusted context — but no filter reliably
stops injection in a model's input. The Microsoft LLMail-Inject challenge
(https://arxiv.org/abs/2506.09956) had every published defence bypassed by at
least one team. The security property we claim against injection is **zero**.
Anything an agent can do with your memory, text that reaches that agent can
attempt to do.

**Denial of service is out of scope.** Oversized inputs, pathological queries
and disk exhaustion are not treated as vulnerabilities. Engram is a local
single-user process; the party who can DoS it is the party running it.

**Cross-instance sensitivity markers do not enforce anything.**
`mark_sensitive` records a local marker. It does **not** hide records from
cross-instance queries — no read path consults it, and the tool now says so at
the point of use. If data must not leave the machine, set `sharing_mode` to
`none`, which is the default.

---

## Acknowledgements

We maintain a list of security reporters who have responsibly disclosed
vulnerabilities. Contributors who report confirmed issues will be credited in
the relevant release notes and GitHub Security Advisory, with their permission.

---

_Security is a shared responsibility. Thank you for helping keep Engram safe._
