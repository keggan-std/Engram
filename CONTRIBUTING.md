# Contributing to Engram

Thank you for your interest in contributing to Engram. This document covers
everything you need to know to participate effectively — whether you're fixing a
bug, proposing a feature, improving documentation, or writing a test.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Before You Start](#before-you-start)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Branch & Commit Conventions](#branch--commit-conventions)
- [Testing Requirements](#testing-requirements)
- [Pull Request Process](#pull-request-process)
- [Proposing Features or Architectural Changes](#proposing-features-or-architectural-changes)
- [Reporting Bugs](#reporting-bugs)
- [Documentation](#documentation)
- [Release Process](#release-process)
- [Maintainer Notes](#maintainer-notes)

---

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).
By participating you agree to uphold it. Report unacceptable behavior to the
repository maintainers via a private GitHub message or by email.

---

## Ways to Contribute

| Type                   | How                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Bug report             | [Open a GitHub Issue](https://github.com/keggan-std/Engram/issues/new?template=bug_report.md) |
| Feature proposal       | [Open a GitHub Discussion](https://github.com/keggan-std/Engram/discussions) or Issue         |
| Code fix / improvement | Fork → branch → PR (see below)                                                                |
| Documentation          | Same PR flow; docs live in `README.md`, `docs/`, and code-level JSDoc                         |
| Test coverage          | PRs adding tests for uncovered code are always welcome                                        |
| Security issue         | See [SECURITY.md](SECURITY.md) — **do not open a public issue**                               |

---

## Before You Start

1. **Search existing Issues and Discussions** before opening a new one. Your
   question or proposal may already have a thread.
2. **For non-trivial changes** (new features, refactors touching multiple
   modules, changes to the MCP API surface), open an Issue or Discussion first
   to align on direction before writing code.
3. **For bug fixes or small improvements**, feel free to go straight to a PR.

---

## Development Setup

### Prerequisites

- **Node.js** v18 or higher
- **npm** v9 or higher
- A C++ toolchain for `better-sqlite3` native compilation:
    - **Windows:** Visual C++ Build Tools (`npm install -g windows-build-tools`) or
      "Desktop development with C++" via the Visual Studio Installer
    - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
    - **Linux:** `build-essential` and `python3`

### Install and Build

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/Engram.git
cd Engram

# 2. Install dependencies
npm install

# 3. Build TypeScript → dist/
npm run build

# 4. Run all tests
npm test
```

### Development Workflow

```bash
# Rebuild on every TypeScript change
npm run dev         # tsc --watch

# Run tests once
npm test            # vitest run

# Run tests in watch mode
npm run test:watch  # vitest

# Run with coverage
npm run test:coverage

# Launch the MCP Inspector against a local build
npm run inspect
```

### Testing Against a Live IDE

After building, you can point your IDE at the local build by using an absolute
path in your MCP config instead of `npx`:

```json
{
    "servers": {
        "engram": {
            "type": "stdio",
            "command": "node",
            "args": [
                "/absolute/path/to/Engram/dist/index.js",
                "--project-root",
                "${workspaceFolder}"
            ]
        }
    }
}
```

---

## Project Structure

```
src/
  index.ts               Entry point — starts MCP server
  database.ts            SQLite connection, WAL config, migration runner
  migrations.ts          All DB schema migrations (append-only)
  types.ts               Shared TypeScript types
  response.ts            Response builder helpers — ALL responses go through here
  constants.ts           Shared constants (limits, defaults)
  repositories/          One file per DB entity (sessions, decisions, tasks, …)
  services/              Business logic services (git, events, compaction, …)
  tools/                 MCP tool implementations (dispatcher-memory, dispatcher-admin, …)
  modes/                 Universal mode server (single-tool BM25 routing)
  installer/             IDE detection and config injection logic
tests/
  repositories/          Unit tests for all repos
  tools/                 Smoke tests for dispatchers
  services/              Service-level tests
  unit/                  Isolated utility tests
packages/
  engram-thin-client/    Defer-loading proxy (Anthropic API only)
  engram-universal-thin-client/  Single-tool universal proxy (all agents)
docs/                    Supplemental documentation
```

### Architectural Invariants

These are non-negotiable. Any PR violating them will not be merged:

1. **All MCP tool responses must go through `src/response.ts`** (`success()`,
   `error()`). Never return raw objects from tools.
2. **All Zod array params that accept optional string arrays must use
   `coerceStringArray()`**. Not `z.array(z.string()).optional()`.
3. **All logging must use `console.error`** (never `console.log`). MCP uses
   stdout for protocol messages; anything on stdout breaks the transport.
4. **Migrations are append-only.** Never modify an existing migration. Always
   add a new one.
5. **No breaking changes to the 4-dispatcher API surface** without a major
   version bump.

---

## Branch & Commit Conventions

### Branches

Use the following naming scheme:

| Type    | Pattern                       | Example                       |
| ------- | ----------------------------- | ----------------------------- |
| Feature | `feature/<short-description>` | `feature/context-pressure-ui` |
| Bug fix | `fix/<issue-or-description>`  | `fix/backup-enoent`           |
| Hotfix  | `hotfix/<description>`        | `hotfix/enum-validation`      |
| Docs    | `docs/<description>`          | `docs/contributing-guide`     |
| Tests   | `test/<description>`          | `test/repo-batch-coverage`    |
| Chore   | `chore/<description>`         | `chore/update-deps`           |

Branch from `main`. PRs target `main`.

### Commit Messages

Engram uses [Conventional Commits](https://www.conventionalcommits.org/). Every
commit message must follow this format:

```
<type>(<scope>): <short imperative summary>

[optional body — wrap at 72 chars]

[optional footer(s): Closes #123, BREAKING CHANGE: …]
```

**Types:**

| Type       | When to use                                       |
| ---------- | ------------------------------------------------- |
| `feat`     | A new feature or behaviour                        |
| `fix`      | A bug fix                                         |
| `refactor` | Code restructuring without behaviour change       |
| `test`     | Adding or updating tests                          |
| `docs`     | Documentation only                                |
| `chore`    | Tooling, deps, config (no production code change) |
| `perf`     | Performance improvement                           |
| `ci`       | CI/CD pipeline changes                            |

**Scopes** (optional but encouraged):

`sessions`, `memory`, `admin`, `find`, `repos`, `migrations`, `installer`,
`universal`, `thin-client`, `tests`, `docs`

**Examples:**

```
feat(memory): add route_task action for specialization-based routing
fix(sessions): resolve session_start sentinel in what_changed query
docs(contributing): add branch naming and commit conventions
test(repos): add batch file-notes atomicity test
chore: bump better-sqlite3 to 12.6.2
```

---

## Testing Requirements

All PRs must pass the full test suite. New functionality must include tests.

```bash
npm test            # must exit 0 before opening a PR
```

### What to Test

- **New actions or tool handlers:** Add a smoke test in `tests/tools/`.
- **Repository changes:** Add or extend tests in `tests/repositories/`.
- **Migration changes:** Verify the migration runs cleanly on both a fresh DB
  and an existing DB with prior data.
- **Bug fixes:** Add a regression test that fails before the fix and passes
  after.

### Test Helpers

`tests/helpers/test-db.ts` provides `createTestDb()` — an in-memory SQLite
instance with all migrations applied. Use it instead of mocking the database.

### Coverage

There is no enforced coverage gate today, but new code should be covered. PRs
that dramatically reduce coverage will receive review feedback requesting tests.

---

## Pull Request Process

1. **Open a PR against `main`** with a clear title following the Conventional
   Commits format.
2. **Fill in the PR template** (title, what changed, why, how it was tested,
   any breaking changes).
3. **Ensure `npm test` passes** and the build compiles cleanly with `npm run build`.
4. **Keep PRs focused.** One logical change per PR. Split large changes into a
   stack of smaller PRs if possible.
5. **Respond to review feedback** within a reasonable time. PRs with no
   activity for 30 days may be closed.
6. A maintainer will merge once approved. Squash merging is used to keep the
   main branch history clean.

### PR Checklist

Before requesting review, confirm:

- [ ] `npm run build` succeeds with no TypeScript errors
- [ ] `npm test` passes (all tests green)
- [ ] New behaviour has corresponding tests
- [ ] Response helpers from `src/response.ts` are used (not raw objects)
- [ ] No `console.log` introduced (use `console.error`)
- [ ] Migrations are append-only if schema changed
- [ ] Commit messages follow Conventional Commits format
- [ ] `RELEASE_NOTES.md` updated if this is a user-visible change

---

## Proposing Features or Architectural Changes

For anything beyond a bug fix or small improvement:

1. **Open a GitHub Discussion or Issue** describing the problem you want to
   solve and your proposed solution.
2. Wait for feedback from maintainers before writing code. This avoids wasted
   effort on approaches that won't be accepted.
3. Once aligned, implement in a feature branch and open a draft PR early so
   maintainers can track progress.

### Things Engram Will Not Do

Understanding the project's boundaries helps you write proposals that will land:

- **No cloud sync or remote database.** The memory stays local by design.
- **No telemetry or analytics.** No data leaves the machine.
- **No additional authentication surface.** Engram is a local tool.
- **No breaking changes to the 4-dispatcher API surface** without a major
  version bump.
- **No new top-level tools** beyond the 4 dispatchers (or the single universal
  tool). New operations go inside an existing dispatcher as a new `action`.

---

## Reporting Bugs

Use the [Bug Report issue template](https://github.com/keggan-std/Engram/issues/new?template=bug_report.md).

A good bug report includes:

- **Engram version** (`npx -y engram-mcp-server --check` or `npm list engram-mcp-server`)
- **Node.js version** (`node --version`)
- **Operating system** (Windows / macOS / Linux, with version)
- **IDE and AI tool** (e.g. VS Code Copilot, Cursor, Claude Desktop)
- **Minimal repro steps** — exactly what you called, in what order
- **Expected behaviour** vs **actual behaviour**
- **Relevant error messages or logs** (redact any sensitive file paths if needed)

For security issues, see [SECURITY.md](SECURITY.md).

---

## Documentation

Documentation lives in multiple places:

| Location           | Content                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `README.md`        | Primary user-facing documentation — install, features, reference |
| `docs/`            | In-depth guides (scheduled events, migration notes, etc.)        |
| `RELEASE_NOTES.md` | User-facing changelog — update for every user-visible change     |
| Source-level JSDoc | Inline documentation for complex functions                       |

Documentation PRs are welcome and valued equally with code PRs.

---

## Release Process

> This section is for maintainers.

1. Finalize all changes on `main`.
2. Update `RELEASE_NOTES.md` with a complete list of changes.
3. Bump the version in `package.json` (follows [Semantic Versioning](https://semver.org)):
    - `patch` — bug fixes only
    - `minor` — new functionality, backwards-compatible
    - `major` — breaking changes to the public API
4. Run `npm run build` and `npm test` — both must pass.
5. Run `npm pack --dry-run` and verify the file list looks correct.
6. Commit: `chore: vX.Y.Z release — <summary>`
7. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
8. Publish: `npm publish`

---

## Maintainer Notes

- The `scripts/inject-release-notes.js` script embeds the latest release notes
  into `package.json` at pack time. It runs automatically via the `prepack`
  npm hook.
- The `src/installer/` module handles IDE detection and config injection.
  Always test installer changes against all supported IDEs listed in `README.md`
  (or mock them via the test suite).
- GitHub Actions CI runs `npm test` on every push and PR. See `.github/workflows/ci.yml`.

---

_We appreciate every contribution — code, words, or a well-written bug report.
Thank you for helping make Engram better._
