# Security Policy

## Overview

Engram is a **local MCP server** with no network-facing endpoints, no remote
database, and no telemetry. All data is stored in a project-local SQLite file
(`.engram/memory.db`) and a user-local global database (`~/.engram/memory.db`).
There is no authentication surface, no cloud sync, and no data that leaves the
machine without explicit user action.

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

There is no TCP port opened by default, no HTTP server, and no remote endpoint.
Communication is strictly over a local stdio pipe managed by the IDE's MCP
runtime.

### File System Access

Engram reads and writes:

- `.engram/memory.db` — project-local database
- `~/.engram/memory.db` — global knowledge base
- `.engram/agent_rules_cache.json` — cached agent rules (7-day TTL)
- `.engram/backups/` — user-triggered backup files

It does **not** read arbitrary project files. File notes store only metadata
provided by the agent — not raw file content.

### Network Access

The only outbound network call is an **update check** (`update.service.ts`),
which fetches the latest published version number from the npm registry
(`registry.npmjs.org`). This is:

- Fire-and-forget (async, non-blocking)
- Version number only, no identifying information sent
- Disabled by setting `auto_update_check: false` in Engram config

### `npx` Execution Model

Engram is distributed and executed via `npx -y engram-mcp-server`. The `-y`
flag bypasses the interactive prompt. Users who are concerned about this
pattern can install globally (`npm install -g engram-mcp-server`) and pin to a
specific version.

---

## Acknowledgements

We maintain a list of security reporters who have responsibly disclosed
vulnerabilities. Contributors who report confirmed issues will be credited in
the relevant release notes and GitHub Security Advisory, with their permission.

---

_Security is a shared responsibility. Thank you for helping keep Engram safe._
