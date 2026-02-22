// ============================================================================
// Engram MCP Server — Utilities
// ============================================================================

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  EXCLUDED_DIRS,
  LAYER_PATTERNS,
  MAX_FILE_TREE_DEPTH,
  MAX_FILE_TREE_ENTRIES,
  PROJECT_MARKERS,
} from "./constants.js";
import type { ArchLayer } from "./types.js";

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

/**
 * Auto-detect the project root by walking up from cwd looking for marker files.
 */
export function findProjectRoot(startDir?: string): string {
  // 1. Explicit env var
  if (process.env.ENGRAM_PROJECT_ROOT) return process.env.ENGRAM_PROJECT_ROOT;
  if (process.env.PROJECT_ROOT) return process.env.PROJECT_ROOT;

  // 2. Walk up directory tree
  let dir = startDir || process.cwd();
  while (dir !== path.dirname(dir)) {
    for (const marker of PROJECT_MARKERS) {
      if (fs.existsSync(path.join(dir, marker))) {
        return dir;
      }
    }
    dir = path.dirname(dir);
  }

  // 3. Fallback to cwd
  return process.cwd();
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
