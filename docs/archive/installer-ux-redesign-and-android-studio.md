# Installer UX Redesign + Android Studio Support Analysis

**Date**: 2026-03-06  
**Scope**: Three interrelated improvements to the installer CLI experience, plus a feasibility assessment of Android Studio MCP support.

---

## Part 1 — Installer Flow Redesign

### Current Behavior (Problems)

When `npx -y engram-mcp-server --install` runs:

1. Detects current IDE from env vars → OK
2. Scans filesystem for all other installed IDEs → OK
3. Immediately asks: **"Install Engram for all N IDEs (VS Code, Cursor, Cline, ...)? [Y/n]"** ← the core problem

This is wrong because:
- User didn't ask to carpet-bomb every IDE on their machine
- The "current IDE" context is lost in a sea of other IDE names
- No version status, no DB location, no config path shown before asking
- No differentiation between "install" and "update" flows

### Target UX Flow

```
────────────────────────────────────────────────────────────────
  🧠 Engram MCP Installer  v1.11.0
────────────────────────────────────────────────────────────────
  Detected IDE    : VS Code (Copilot)
  Config file     : %APPDATA%\Code\User\mcp.json
  Database        : C:\Users\me\projects\myapp\.engram\memory.db
  Installed       : v1.10.2  ⬆  v1.11.0 available
────────────────────────────────────────────────────────────────

  What would you like to do?

    1. Update to v1.11.0 in VS Code         ← default if update available
    2. Reinstall / repair                   ← shown if already installed
    3. Install to VS Code                   ← default if not installed
    4. Enter a custom config directory...
    5. Install to another IDE on this system...
    0. Cancel

  Select [0-5]:
```

Key changes vs current code:

| Old | New |
|-----|-----|
| Immediately asks about all IDEs | Shows current IDE status first |
| No version info before confirm | Installed version + latest npm version shown, color-coded |
| No DB location shown | DB location derived from CWD shown |
| "Install all?" Y/n | Numbered menu: current → custom dir → other IDEs |
| Update/install same prompt | Separate "Update" vs "Install" label |

### Implementation Plan

#### `src/installer/index.ts` — `runInstaller()` auto-detect branch

Replace the current prompt block (lines ~430–470) with a new `showCurrentIdeMenu()` function:

```typescript
async function showCurrentIdeMenu(
  currentIde: string,
  ide: IdeDefinition,
  otherDetected: string[],
  npmLatest: string | null,
  universalMode: boolean,
  forceGlobal: boolean,
) {
  const currentVersion = getInstallerVersion();
  const cwd = process.cwd();

  // Resolve current install status in this IDE
  const entry = resolveCurrentIdeEntry(ide, cwd);           // new helper
  const dbPath = resolveDbPath(cwd);                        // new helper

  // ── Header panel ─────────────────────────────────────────
  const usesColor = process.stdout.isTTY ?? false;
  // ... color helpers ...
  
  printHeader({
    ide: ide.name,
    configPath: entry.configPath,
    dbPath,
    installedVersion: entry.installedVersion,
    npmLatest,
    currentVersion,
  });

  // ── Menu options ──────────────────────────────────────────
  const opts: Array<{ label: string; action: () => Promise<void> }> = [];

  if (entry.state === "installed") {
    const needsUpdate = semverCmp(entry.installedVersion!, currentVersion) < 0;
    if (needsUpdate) {
      opts.push({ label: `Update to v${currentVersion} in ${ide.name}`, action: () => performInstallationForIde(...) });
    } else {
      opts.push({ label: `Reinstall / repair in ${ide.name}`, action: () => performInstallationForIde(...) });
    }
  } else {
    opts.push({ label: `Install Engram in ${ide.name}`, action: () => performInstallationForIde(...) });
  }

  opts.push({ label: "Enter a custom config directory...", action: customDirFlow });
  if (otherDetected.length > 0) {
    opts.push({ label: "Install to another IDE on this system...", action: () => otherIdeMenu(otherDetected) });
  }
  opts.push({ label: "Cancel", action: async () => process.exit(0) });

  // Print numbered list and await selection
  const choice = await selectFromMenu(opts);
  await choice.action();
}
```

---

## Part 2 — Auto-Detect Project Root for DB Initialization

### Current Behavior

When a user runs the installer interactively and chooses **local** scope, the code does:

```typescript
const solutionDir = await askQuestion(
  `Enter the absolute path to your ${ide.name} project directory:\n  [${cwd}]: `
);
const resolvedDir = solutionDir.trim() || cwd;
```

The CWD default is already shown. But:
1. The prompt is confusing — it sounds like "where is your project" not "confirm this is where to write the config"
2. There's no validation that CWD is actually a project root (git, package.json, etc.)
3. For global installs (Windsurf, Antigravity, no `workspaceVar`), the DB path isn't shown at all

### What "Project Root for DB" Means (Clarification)

There are **two separate** root concepts:

| Concept | What it controls | How it works |
|---------|-----------------|--------------|
| **Config file location** | Where `mcp.json`/`.mcp.json` is written | Installer handles this — asks for project dir on local installs |
| **DB root** | Where `.engram/memory.db` is created | Handled at runtime by `findProjectRoot()` in `src/utils.ts` — walks up from CWD looking for `.git`, `package.json`, etc. |

For IDEs WITH `workspaceVar` (VS Code, Cursor, Visual Studio, Trae), `--project-root=${workspaceFolder}` is injected into the MCP config args — the IDE resolves this at spawn time. **No installer prompt needed.** ✅

For IDEs WITHOUT `workspaceVar` (Windsurf, Antigravity, GeminiCLI, Claude Desktop, Roo Code, Cline, JetBrains), the server relies entirely on `findProjectRoot()` at runtime and ignores the installer's project directory question for DB purposes.

### Required Fixes

#### A — CWD Validation Helper

Add to `index.ts`:

```typescript
function detectProjectRoot(startDir: string): { root: string; confidence: "high" | "medium" | "low"; evidence: string } {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, ".git")))
      return { root: dir, confidence: "high", evidence: "git repo root" };
    if (fs.existsSync(path.join(dir, "package.json")))
      return { root: dir, confidence: "high", evidence: "package.json" };
    if (fs.existsSync(path.join(dir, "cargo.toml")) || fs.existsSync(path.join(dir, "Cargo.toml")))
      return { root: dir, confidence: "high", evidence: "Cargo.toml" };
    if (fs.existsSync(path.join(dir, "go.mod")))
      return { root: dir, confidence: "high", evidence: "go.mod" };
    if (fs.existsSync(path.join(dir, "pyproject.toml")))
      return { root: dir, confidence: "high", evidence: "pyproject.toml" };
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  // No strong signals — CWD is a reasonable fallback but may not be the project root
  return { root: startDir, confidence: "low", evidence: "no project markers found — using current directory" };
}
```

#### B — Improved local scope prompt

Replace the vague "Enter the absolute path" prompt with:

```
  Engram database will initialize at:
    C:\Users\me\projects\myapp\.engram\memory.db   (detected git repo root)

  MCP config will be written to:
    C:\Users\me\projects\myapp\.vscode\mcp.json

  Confirm? [Y/n / type a different path]:
```

- High confidence → just press Enter to confirm
- Low confidence → show a more explicit prompt + ask to confirm or enter a different path
- If user types a path: validate it exists and has a project marker

#### C — Global installs without workspaceVar (Windsurf, Antigravity)

For these IDEs, show the DB detection result as **informational** only (the installer can't inject it into the global config anyway):

```
  ℹ️  Windsurf uses a global MCP config (no per-project variable support).
     Engram will detect your project root automatically at runtime
     using git/.git markers from your working directory.
     
     Detected project root: C:\Users\me\projects\myapp (git repo)
```

No need to prompt — just inform.

---

## Part 3 — Android Studio Support

### Actual Behavior (Updated — Official Docs Were Wrong/Incomplete)

> **Correction from initial analysis:** The official Android Studio docs describe an HTTP-only UI flow for adding MCP servers. However, Android Studio **also reads a `mcp.json` file directly from its config directory** and **fully supports stdio transport** (`command`/`args`) — confirmed from a real config file on this machine.

**User-verified config format:**
```json
{
  "mcpServers": {
    "some-server": {
      "command": "python",
      "args": ["C:\\MCP\\server.py"],
      "env": { "KEY": "value" },
      "enabled": true
    }
  }
}
```

Key differences from other IDEs:

| Field | Notes |
|-------|-------|
| `configKey` | `mcpServers` ✅ standard |
| `command`/`args` | stdio transport ✅ works |
| `enabled: true` | **Required** — Android Studio ignores entries without this |
| Config path | **Versioned** — `%APPDATA%\Google\AndroidStudio<VERSION>\mcp.json` |
| Multiple versions | All coexist — installer writes to ALL found versions |

### Implementation Status: **DONE** (v1.11.0+)

**Changes shipped in this session:**

- `ide-configs.ts`: New `resolveGlobalPaths?: () => string[]` field on `IdeDefinition` — used when config paths are version-suffixed and need filesystem discovery. Also new `extraEntryFields?: Record<string, unknown>` for IDE-required fields. `androidstudio` entry added with both.
- `config-writer.ts`: `makeEngramEntry` now spreads `ide.extraEntryFields` — injects `enabled: true` for Android Studio.
- `ide-detector.ts`: New `resolveIdeGlobalPaths()` export (used everywhere instead of `ide.scopes.global` directly). Android Studio detection via `STUDIO_VM_OPTIONS` env var (set by Android Studio JVM launcher) and JetBrains terminal + `ANDROID_HOME` heuristic.
- `index.ts`: All install flows (`--list`, `--check`, `--remove`, `performInstallationForIde`) updated to use `resolveIdeGlobalPaths`. For IDEs with `resolveGlobalPaths`, installs to **every found version** automatically.

### Config Directory (Confirmed on Windows)

```
%APPDATA%\Google\AndroidStudio2025.2.2\mcp.json
%APPDATA%\Google\AndroidStudio2025.2.3\mcp.json   ← found on this machine
%APPDATA%\Google\AndroidStudio2025.3.1\mcp.json
%APPDATA%\Google\AndroidStudio2025.3.2\mcp.json
```

macOS: `~/Library/Application Support/Google/AndroidStudio<VERSION>/mcp.json`  
Linux: `~/.config/Google/AndroidStudio<VERSION>/mcp.json`

### Install Command

```bash
npx -y engram-mcp-server --install --ide androidstudio
# or omit --ide; auto-detection via STUDIO_VM_OPTIONS handles it
```

---

## Summary of Recommended Actions

### Immediate (installer UX)
1. Implement `showCurrentIdeMenu()` — focused single-IDE status panel before any action
2. Implement `detectProjectRoot()` helper — show DB path in the panel
3. Improve local scope prompt — confirm CWD instead of open-ended input
4. Move "other IDEs" to a secondary option in the menu

### Short-term (DB root UX)
5. For global installs without `workspaceVar`: show detected DB path as informational
6. In global installs, if CWD has no project markers, show a note: "DB will init from project CWD at runtime"

### Medium-term (Android Studio)
7. Implement `StreamableHTTPServerTransport` alongside stdio in `src/index.ts`
8. Add `androidstudio` IDE definition in `ide-configs.ts` with glob detection
9. Update installer to handle versioned config dir detection + `httpUrl` entry format
10. Decide on process persistence model (startup entry? manual instruction? both?)

---

## Files to Touch (implementation)

| File | Change |
|------|--------|
| `src/installer/index.ts` | Redesign `runInstaller()` auto-detect branch; add `showCurrentIdeMenu()`, `detectProjectRoot()`, improved local scope prompt |
| `src/installer/ide-configs.ts` | Add `androidstudio` entry (HTTP-only, glob path) |
| `src/installer/ide-detector.ts` | Add Android Studio detection (process name / ANDROID_SDK_ROOT env) + glob for config dirs |
| `src/index.ts` | Add `--port` HTTP MCP transport activation |
| *(new)* `src/http-mcp.ts` | `StreamableHTTPServerTransport` setup for MCP-over-HTTP |
