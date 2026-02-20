#!/usr/bin/env node
// ============================================================================
// Engram — Git Hook Installer
//
// Installs a post-commit hook that records git commits in Engram's memory,
// so the agent always knows what changed between sessions even without
// explicitly recording changes.
// ============================================================================

import * as fs from "fs";
import * as path from "path";

const HOOK_CONTENT = `#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Engram Post-Commit Hook
# Records commit info into .engram/git-changes.log
# The Engram MCP server reads this on session start.
# ─────────────────────────────────────────────────────────────

ENGRAM_DIR=".engram"
CHANGE_LOG="$ENGRAM_DIR/git-changes.log"

# Ensure the directory exists
mkdir -p "$ENGRAM_DIR"

# Get commit info
HASH=$(git rev-parse --short HEAD)
MSG=$(git log -1 --pretty=format:"%s")
AUTHOR=$(git log -1 --pretty=format:"%an")
DATE=$(git log -1 --pretty=format:"%aI")
FILES=$(git diff-tree --no-commit-id --name-status -r HEAD)

# Append to change log
{
  echo "--- COMMIT $HASH ---"
  echo "date: $DATE"
  echo "author: $AUTHOR"
  echo "message: $MSG"
  echo "files:"
  echo "$FILES"
  echo "---"
  echo ""
} >> "$CHANGE_LOG"

# Keep only last 200 entries to prevent unbounded growth
if [ -f "$CHANGE_LOG" ]; then
  LINES=$(wc -l < "$CHANGE_LOG")
  if [ "$LINES" -gt 2000 ]; then
    tail -1000 "$CHANGE_LOG" > "$CHANGE_LOG.tmp"
    mv "$CHANGE_LOG.tmp" "$CHANGE_LOG"
  fi
fi
`;

function installHooks(): void {
  // Find .git directory
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      break;
    }
    dir = path.dirname(dir);
  }

  const gitDir = path.join(dir, ".git");
  if (!fs.existsSync(gitDir)) {
    console.error("Error: Not a git repository. Navigate to a project with .git and try again.");
    process.exit(1);
  }

  const hooksDir = path.join(gitDir, "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });

  const hookPath = path.join(hooksDir, "post-commit");

  // Check for existing hook
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, "utf-8");
    if (existing.includes("Engram Post-Commit Hook")) {
      console.log("Engram post-commit hook is already installed.");
      return;
    }
    // Append to existing hook
    fs.appendFileSync(hookPath, "\n\n" + HOOK_CONTENT);
    console.log("Engram post-commit hook appended to existing hook.");
  } else {
    fs.writeFileSync(hookPath, HOOK_CONTENT);
    console.log("Engram post-commit hook installed.");
  }

  // Make executable
  fs.chmodSync(hookPath, "755");
  console.log(`Hook location: ${hookPath}`);
}

installHooks();
