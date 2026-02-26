// ============================================================================
// Engram MCP Server — Utilities
// ============================================================================

import { execSync } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z } from "zod";
import {
  BLOCKED_PATH_PATTERNS,
  EXCLUDED_DIRS,
  LAYER_PATTERNS,
  MAX_FILE_TREE_DEPTH,
  MAX_FILE_TREE_ENTRIES,
  SOFT_PROJECT_MARKERS,
  STRONG_PROJECT_MARKERS,
} from "./constants.js";
import type { ArchLayer } from "./types.js";

/**
 * Zod preprocessor that accepts either a real string array OR a JSON-string-
 * encoded array (e.g. '["a","b"]'). Required because some MCP clients (including
 * Claude Code) occasionally serialize optional array parameters as JSON strings
 * instead of native JSON arrays, causing z.array() to reject them with
 * "Expected array, received string".
 *
 * Usage:  tags: coerceStringArray().optional()
 *         (replaces: z.array(z.string()).optional())
 */
export function coerceStringArray() {
  return z.preprocess((v) => {
    if (typeof v === "string") {
      try { return JSON.parse(v); } catch { return v; }
    }
    return v;
  }, z.array(z.string()));
}

/**
 * Normalize a file path for consistent storage as a database key.
 * 1. Replace backslashes with forward slashes
 * 2. If absolute and projectRoot provided, convert to relative
 * 3. Strip leading ./
 * 4. Collapse consecutive /
 * 5. Strip trailing /
 */
export function normalizePath(filePath: string, projectRoot?: string): string {
  let p = filePath.replace(/\\/g, "/");

  if (projectRoot && path.isAbsolute(p)) {
    p = path.relative(projectRoot, p).replace(/\\/g, "/");
  }

  p = p.replace(/^\.\//, "");
  p = p.replace(/\/+/g, "/");
  p = p.replace(/\/$/, "");

  return p;
}

// ============================================================================
// FLAW-1 FIX: Smart project root detection
//
// Priority chain (first hit wins):
//   0. --project-root=<path>  CLI arg  (highest — explicit IDE config)
//   1. ENGRAM_PROJECT_ROOT env var
//   2. PROJECT_ROOT env var
//   3. git rev-parse --show-toplevel  (authoritative for git repos)
//   4. Walk up — STRONG markers only (.git, .engram)  — never ambiguous
//   5. Walk up — SOFT markers (package.json etc) skipping BLOCKED paths
//   6. ~/.engram/global/  fallback  (never crashes; logged as warning)
//
// Additional enhancements requested:
//   • --project-root flag: IDEs and users can bake the workspace path into
//     the MCP spawn command so detection is never needed.
//   • git command detection: `git rev-parse --show-toplevel` is the most
//     reliable way to find the real project root — it follows git worktrees
//     and submodules correctly.
//   • Logged resolution: the resolved path + method are always logged so
//     users can validate what Engram chose.
// ============================================================================

/** Returns the normalised path with OS separators replaced by forward slashes. */
function normStr(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Check whether a directory path matches any known non-project blocked pattern.
 * Used to reject IDE install dirs, npm globals, and OS system dirs.
 */
function isBlockedPath(dirPath: string): boolean {
  const n = normStr(dirPath);
  return BLOCKED_PATH_PATTERNS.some(re => re.test(n));
}

/**
 * Try `git rev-parse --show-toplevel` from startDir.
 * Returns the git root if found, null otherwise.
 * This is the most authoritative detection method — it follows worktrees,
 * submodules, and nested git repos correctly.
 */
function detectGitRoot(startDir: string): string | null {
  try {
    const result = execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Auto-detect the project root using a 6-tier priority chain.
 *
 * @param startDir  Starting directory for filesystem walk (default: cwd)
 * @returns         Absolute path to the detected or fallback project root
 */
export function findProjectRoot(startDir?: string): string {
  const cwd = startDir || process.cwd();

  // ── Tier 0: --project-root=<path> CLI arg ────────────────────────────────
  // Highest priority: explicit instruction from IDE config or user.
  for (const arg of process.argv) {
    if (arg.startsWith("--project-root=")) {
      const val = arg.slice("--project-root=".length).trim();
      if (val) {
        const resolved = path.resolve(val);
        console.error(`[Engram] [INFO] Project root ← --project-root arg: ${resolved}`);
        return resolved;
      }
    }
    // Also handle separate --project-root <path> style
    if (arg === "--project-root") {
      const idx = process.argv.indexOf(arg);
      const next = process.argv[idx + 1];
      if (next && !next.startsWith("-")) {
        const resolved = path.resolve(next);
        console.error(`[Engram] [INFO] Project root ← --project-root arg: ${resolved}`);
        return resolved;
      }
    }
  }

  // ── Tier 1+2: Explicit env vars ────────────────────────────────────────────
  if (process.env.ENGRAM_PROJECT_ROOT) {
    const resolved = path.resolve(process.env.ENGRAM_PROJECT_ROOT);
    console.error(`[Engram] [INFO] Project root ← ENGRAM_PROJECT_ROOT: ${resolved}`);
    return resolved;
  }
  if (process.env.PROJECT_ROOT) {
    const resolved = path.resolve(process.env.PROJECT_ROOT);
    console.error(`[Engram] [INFO] Project root ← PROJECT_ROOT env: ${resolved}`);
    return resolved;
  }

  // ── Tier 3: git rev-parse --show-toplevel ───────────────────────────────
  // Most reliable: git knows the real project boundary, including worktrees.
  // Blocked paths are checked so we don't accept a git repo that is the IDE
  // install dir itself (unlikely but possible with developer setups).
  const gitRoot = detectGitRoot(cwd);
  if (gitRoot && !isBlockedPath(gitRoot)) {
    console.error(`[Engram] [INFO] Project root ← git: ${gitRoot}`);
    return gitRoot;
  }

  // ── Tier 4: Walk up — STRONG markers only (.git, .engram) ────────────
  // .git and .engram are never present in IDE install dirs; always safe.
  let dir = cwd;
  while (dir !== path.dirname(dir)) {
    for (const marker of STRONG_PROJECT_MARKERS) {
      if (fs.existsSync(path.join(dir, marker))) {
        if (!isBlockedPath(dir)) {
          console.error(`[Engram] [INFO] Project root ← strong marker (${marker}): ${dir}`);
          return dir;
        }
      }
    }
    dir = path.dirname(dir);
  }

  // ── Tier 5: Walk up — SOFT markers, skip blocked paths ────────────────
  // package.json etc. are checked, but only for dirs that don't look like
  // IDE install dirs, npm globals, or OS system directories.
  // Also reject dirs whose package.json has name === "engram-mcp-server"
  // (running from our own source tree).
  dir = cwd;
  while (dir !== path.dirname(dir)) {
    if (!isBlockedPath(dir)) {
      for (const marker of SOFT_PROJECT_MARKERS) {
        if (fs.existsSync(path.join(dir, marker))) {
          // Extra guard: our own package — skip it
          if (marker === "package.json") {
            try {
              const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
              if (pkg?.name === "engram-mcp-server") {
                dir = path.dirname(dir);
                continue;
              }
            } catch { /* malformed package.json — skip */ }
          }
          console.error(`[Engram] [INFO] Project root ← soft marker (${marker}): ${dir}`);
          return dir;
        }
      }
    }
    dir = path.dirname(dir);
  }

  // ── Tier 6: Global home fallback ────────────────────────────────────
  // Nothing found — use a safe per-user global dir rather than cwd.
  // This guarantees the server is always usable even from unknown environments.
  const globalFallback = path.join(os.homedir(), ".engram", "global");
  try { fs.mkdirSync(globalFallback, { recursive: true }); } catch { /* best-effort */ }
  console.error(
    `[Engram] [WARN] No project root found — using global memory at ${globalFallback}.\n` +
    `         Set ENGRAM_PROJECT_ROOT or pass --project-root=<path> to override.`
  );
  return globalFallback;
}

/**
 * Scan the project file tree, respecting exclusions and depth limits.
 */
export function scanFileTree(
  rootDir: string,
  maxDepth: number = MAX_FILE_TREE_DEPTH,
  maxEntries: number = MAX_FILE_TREE_ENTRIES
): string[] {
  const files: string[] = [];

  // Merge .engramignore entries with the default exclusion set
  const exclusions = new Set(EXCLUDED_DIRS);
  try {
    const ignorePath = path.join(rootDir, ".engramignore");
    if (fs.existsSync(ignorePath)) {
      const lines = fs.readFileSync(ignorePath, "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          exclusions.add(trimmed.replace(/\/$/, "")); // Strip trailing slash
        }
      }
    }
  } catch { /* .engramignore is optional */ }

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth || files.length >= maxEntries) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort for deterministic output
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.length >= maxEntries) break;
      if (entry.name.startsWith(".") && entry.isDirectory()) continue;

      if (entry.isDirectory()) {
        if (exclusions.has(entry.name)) continue;
        const subPath = path.relative(rootDir, path.join(dir, entry.name));
        files.push(subPath + "/");
        walk(path.join(dir, entry.name), depth + 1);
      } else {
        const relPath = path.relative(rootDir, path.join(dir, entry.name));
        files.push(relPath);
      }
    }
  }

  walk(rootDir, 0);
  return files;
}

/**
 * Detect the architectural layer of a file based on its path.
 */
export function detectLayer(filePath: string): ArchLayer {
  const normalized = "/" + filePath.replace(/\\/g, "/");
  for (const [layer, patterns] of Object.entries(LAYER_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        return layer as ArchLayer;
      }
    }
  }
  return "other";
}

/**
 * Run a git command in the project root. Returns empty string on failure.
 */
export function gitCommand(projectRoot: string, command: string): string {
  try {
    return execSync(`cd "${projectRoot}" && git ${command}`, {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Check if the project is a git repository.
 */
export function isGitRepo(projectRoot: string): boolean {
  return fs.existsSync(path.join(projectRoot, ".git"));
}

/**
 * Get git log since a given timestamp.
 */
export function getGitLogSince(projectRoot: string, since: string, limit: number = 50): string {
  return gitCommand(
    projectRoot,
    `log --name-status --since="${since}" --pretty=format:"[%h] %s (%ar)" -${limit}`
  );
}

/**
 * Get git diff stat (files changed, insertions, deletions).
 */
export function getGitDiffStat(projectRoot: string, since: string): string {
  return gitCommand(projectRoot, `diff --stat HEAD@{${since}} 2>/dev/null`);
}

/**
 * Get files changed in git since a timestamp.
 */
export function getGitFilesChanged(projectRoot: string, since: string): string[] {
  const result = gitCommand(
    projectRoot,
    `log --name-only --since="${since}" --pretty=format:"" 2>/dev/null`
  );
  if (!result) return [];
  return [...new Set(result.split("\n").filter(Boolean))];
}

/**
 * Get the current git branch name.
 */
export function getGitBranch(projectRoot: string): string {
  return gitCommand(projectRoot, "rev-parse --abbrev-ref HEAD");
}

/**
 * Get the latest git commit hash (short).
 */
export function getGitHead(projectRoot: string): string {
  return gitCommand(projectRoot, "rev-parse --short HEAD");
}

/**
 * Safely parse a JSON string, returning a default value on failure.
 */
export function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Format a response as either JSON or Markdown.
 */
export function formatResponse(data: unknown, format: "json" | "markdown" = "json"): string {
  if (format === "json") {
    return JSON.stringify(data, null, 2);
  }
  // For markdown, we just pretty-print JSON in a code block
  return "```json\n" + JSON.stringify(data, null, 2) + "\n```";
}

/**
 * Calculate minutes between now and a given ISO timestamp.
 */
export function minutesSince(isoTimestamp: string): number {
  const then = new Date(isoTimestamp).getTime();
  const diff = Date.now() - then;
  return Math.floor(diff / 60000);
}

/**
 * Truncate a string to a max length with ellipsis.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

/**
 * Escape a query string for safe use in SQLite FTS5 MATCH expressions.
 * Each word is wrapped in double quotes for exact-word matching.
 * Multiple words are joined with OR so any match surfaces the row.
 *
 * Example: "auth refactor" → `"auth" OR "refactor"`
 */
export function ftsEscape(query: string): string {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '""';
  return words.map(w => `"${w.replace(/"/g, "")}"`).join(" OR ");
}

/**
 * Get the actual modification time (Unix ms) of a file on disk.
 * Resolves relative paths against projectRoot when provided.
 * Returns null if the file does not exist or stat fails.
 */
export function getFileMtime(filePath: string, projectRoot?: string): number | null {
  try {
    const resolved =
      projectRoot && !path.isAbsolute(filePath)
        ? path.join(projectRoot, filePath)
        : filePath;
    return fs.statSync(resolved).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Compute a SHA-256 hex digest of a file's contents.
 * Returns null if the file cannot be read.
 */
export function getFileHash(filePath: string, projectRoot?: string): string | null {
  try {
    const resolved =
      projectRoot && !path.isAbsolute(filePath)
        ? path.join(projectRoot, filePath)
        : filePath;
    const content = fs.readFileSync(resolved);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}
