# Manual Build & Install — Engram v1.6 (Schema v11)

> **Why this doc?**
> The current npm release is **v1.4.1** (schema v4). Engram v1.6 (schema v11) is unreleased and lives on the `feat/v1.6-lean-surface` branch. This guide lets you build it locally and wire it into your IDE so your agent runs against the latest DB schema.

---

## Prerequisites

| Requirement | Minimum |
|---|---|
| Node.js | 18.0.0 |
| npm | 8+ |
| Git | any recent version |

---

## Step 1 — Clone the branch

```bash
git clone --branch feat/v1.6-lean-surface https://github.com/keggan-std/Engram.git engram-v1.6
cd engram-v1.6
```

---

## Step 2 — Install dependencies

```bash
npm install
```

> `better-sqlite3` compiles a native binary. If it fails, make sure you have build tools installed:
> - **Windows:** `npm install --global windows-build-tools` or install Visual Studio Build Tools
> - **macOS:** `xcode-select --install`
> - **Linux:** `sudo apt install build-essential python3` (or distro equivalent)

---

## Step 3 — Build

```bash
npm run build
```

Output goes to `dist/`. The entry point is `dist/index.js`.

Verify it works:

```bash
node dist/index.js --version
# should print: 1.6.0
```

---

## Step 4 — Wire into your IDE

Pick your IDE below. Replace `ABSOLUTE_PATH_TO_REPO` with the full path to where you cloned the repo.

> **Important:** Always use the absolute path to `dist/index.js`. Relative paths will fail when the IDE spawns the process from a different working directory.

---

### Claude Code (CLI)

```bash
claude mcp add-json engram '{"type":"stdio","command":"node","args":["ABSOLUTE_PATH_TO_REPO/dist/index.js"]}' --scope user
```

---

### Cursor

Edit `~/.cursor/mcp.json` (create if missing):

```json
{
  "mcpServers": {
    "engram": {
      "command": "node",
      "args": ["ABSOLUTE_PATH_TO_REPO/dist/index.js"]
    }
  }
}
```

---

### VS Code (Copilot)

Edit `%APPDATA%/Code/User/mcp.json` on Windows, or `~/Library/Application Support/Code/User/mcp.json` on macOS:

```json
{
  "servers": {
    "engram": {
      "type": "stdio",
      "command": "node",
      "args": ["ABSOLUTE_PATH_TO_REPO/dist/index.js"]
    }
  }
}
```

---

### Cline / Roo Code

Edit `%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "engram": {
      "command": "node",
      "args": ["ABSOLUTE_PATH_TO_REPO/dist/index.js"]
    }
  }
}
```

---

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "engram": {
      "command": "node",
      "args": ["ABSOLUTE_PATH_TO_REPO/dist/index.js"]
    }
  }
}
```

---

### Auto-installer (all IDEs at once)

If you'd rather let the script detect and configure all installed IDEs automatically:

```bash
node scripts/install-mcp.js
```

Or target a specific IDE:

```bash
node scripts/install-mcp.js --ide cursor
node scripts/install-mcp.js --ide vscode
node scripts/install-mcp.js --ide cline
node scripts/install-mcp.js --ide windsurf
```

List what was detected on your machine:

```bash
node scripts/install-mcp.js --list
```

---

## Step 5 — Verify schema version

After restarting your IDE / agent, call the `engram_health` tool. The response should include:

```json
{
  "schema_version": 11,
  "expected_schema_version": 11,
  "needs_migration": false
}
```

If `schema_version` is below 11, the migration ran on first startup and upgraded it automatically.

---

## Using an existing v1.4 database

If you have a database from a v1.4 install (schema v4), Engram v1.6 **will migrate it forward automatically** on first run — no manual steps needed. All data is preserved.

> **One-way only:** A v1.6 database cannot be read back by v1.4. Back up your `.engram/memory.db` before switching if you need to roll back.

Default database location: `~/.engram/memory.db` (or the project-local `.engram/` folder if configured).

---

## Staying up to date

Since this is a local build from a branch, there is no auto-update. To pull new changes:

```bash
cd engram-v1.6
git pull origin feat/v1.6-lean-surface
npm install
npm run build
```

No IDE config changes are needed after a rebuild — the path stays the same.

---

## Commit reference

Built from: `feat/v1.6-lean-surface` @ `ec7ed2e`
Repo: https://github.com/keggan-std/Engram
