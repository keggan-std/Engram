// ============================================================================
// Engram MCP Server — Constants
// ============================================================================

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const _pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");
const _pkg = JSON.parse(readFileSync(_pkgPath, "utf-8"));

export const SERVER_NAME = "engram-mcp-server";
export const SERVER_VERSION: string = _pkg.version;
export const TOOL_PREFIX = "engram";

// Database
export const DB_DIR_NAME = ".engram";
export const DB_FILE_NAME = "memory.db";
export const DB_VERSION = 17; // V7 agent-safety, V8 ctx-pressure, V9 knowledge-graph, V10 handoffs, V11 tool_call_log
                              // V12 checkpoints, V13 content_hash, V14 executive_summary, V15 agent specializations
                              // V16 targeted broadcasts, V17 instance identity

// Limits
export const MAX_FILE_TREE_DEPTH = 5;
export const MAX_FILE_TREE_ENTRIES = 500;
export const MAX_SEARCH_RESULTS = 50;
export const DEFAULT_SEARCH_LIMIT = 8; // 8 gives headroom for noise; 50 (max) is available via explicit limit param
export const MAX_GIT_LOG_ENTRIES = 50;
export const MAX_RESPONSE_LENGTH = 50000;
export const DEFAULT_PAGINATION_LIMIT = 20;
export const SNAPSHOT_TTL_MINUTES = 30;
export const COMPACTION_THRESHOLD_SESSIONS = 50;
export const BACKUP_DIR_NAME = "backups";
export const FOCUS_MAX_ITEMS_PER_CATEGORY = 15;
export const FILE_MTIME_STALE_HOURS = 24; // After this many hours of drift, confidence = "stale"
export const FILE_LOCK_DEFAULT_TIMEOUT_MINUTES = 30; // Auto-expire file locks after this many minutes
export const DEFAULT_RETENTION_DAYS = 90;
export const MAX_BACKUP_COUNT = 10;

// File patterns to exclude from scanning
export const EXCLUDED_DIRS = new Set([
  ".git",
  ".gradle",
  ".idea",
  ".vs",
  ".vscode",
  ".engram",
  ".agent-memory",
  "node_modules",
  "build",
  "dist",
  "out",
  "bin",
  "obj",
  "__pycache__",
  ".next",
  ".nuxt",
  "target",
  "Pods",
  ".dart_tool",
  ".pub-cache",
]);

// Project root markers — used to auto-detect project boundaries
// FLAW-1 FIX: two tiers prevent IDE install dirs from being picked up.

/**
 * STRONG markers: unambiguous project boundaries. Found → return immediately.
 * These never appear in IDE install directories or npm global dirs.
 */
export const STRONG_PROJECT_MARKERS = [
  ".git",
  ".engram",   // already-initialised Engram project
] as const;

/**
 * SOFT markers: typically present in real projects but also in Electron/Node
 * app install dirs. Only used after strong markers are exhausted, AND only if
 * the candidate path passes the BLOCKED_PATH_PATTERNS check.
 */
export const SOFT_PROJECT_MARKERS = [
  "package.json",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "CMakeLists.txt",
  "Makefile",
  "pyproject.toml",
  "setup.py",
  ".sln",
  ".csproj",
  "pubspec.yaml",
  "Gemfile",
  "composer.json",
];

/**
 * Legacy combined list kept for any external callers.
 * Prefer STRONG_PROJECT_MARKERS + SOFT_PROJECT_MARKERS directly.
 */
export const PROJECT_MARKERS = [
  ...STRONG_PROJECT_MARKERS,
  ...SOFT_PROJECT_MARKERS,
];

/**
 * Path-segment patterns that indicate an IDE install, npm global, or OS system
 * directory. A soft-marker candidate whose normalised path matches any of these
 * is rejected so we don't mistake an IDE's own install dir for a project root.
 */
export const BLOCKED_PATH_PATTERNS: RegExp[] = [
  // Windows IDE install / npm global locations
  /[/\\]AppData[/\\]Local[/\\]Programs[/\\]/i,
  /[/\\]AppData[/\\]Roaming[/\\]npm[/\\]/i,
  /[/\\]AppData[/\\]Local[/\\]npm[/\\]/i,
  // Windows system dirs
  /^[A-Za-z]:[/\\]Program Files( \(x86\))?[/\\]/i,
  /^[A-Za-z]:[/\\]Windows[/\\]/i,
  // macOS application bundles and Homebrew
  /\/Applications\/.+\.app\//,
  /\/usr\/local\/(bin|lib|Cellar)\//,
  /\/opt\/(homebrew|local)\//,
  // Linux system dirs
  /^\/usr\/(bin|lib|share|local)\//,
  /^\/opt\//,
  // npm / node global installs (all OSes)
  /[/\\]node_modules[/\\]engram-mcp-server[/\\]/i,
  /[/\\]lib[/\\]node_modules[/\\]/i,
  /[/\\]node_modules\.bin[/\\]/i,
];

// Update check
export const NPM_REGISTRY_URL = "https://registry.npmjs.org/engram-mcp-server/latest";
export const GITHUB_REPO = "keggan-std/Engram";
export const GITHUB_RELEASES_URL = "https://github.com/keggan-std/Engram/releases";
export const GITHUB_RELEASES_API_URL = "https://api.github.com/repos/keggan-std/Engram/releases/latest";

// Config keys — update management
export const CFG_AUTO_UPDATE_CHECK = "auto_update_check";
export const CFG_AUTO_UPDATE_LAST_CHECK = "auto_update_last_check";
export const CFG_AUTO_UPDATE_AVAILABLE = "auto_update_available";
export const CFG_AUTO_UPDATE_CHANGELOG = "auto_update_changelog";
export const CFG_AUTO_UPDATE_SKIP_VERSION = "auto_update_skip_version";
export const CFG_AUTO_UPDATE_REMIND_AFTER = "auto_update_remind_after";
export const CFG_AUTO_UPDATE_NOTIFY_LEVEL = "auto_update_notify_level"; // "major" | "minor" | "patch"

// Config keys — instance identity & cross-instance
export const CFG_INSTANCE_ID = "instance_id";
export const CFG_INSTANCE_LABEL = "instance_label";
export const CFG_INSTANCE_CREATED_AT = "instance_created_at";
export const CFG_MACHINE_ID = "machine_id";
export const CFG_SHARING_MODE = "sharing_mode";       // "none" | "read" | "full"
export const CFG_SHARING_TYPES = "sharing_types";     // JSON array of table names
export const CFG_SENSITIVE_KEYS = "sensitive_keys";   // JSON array of decision/convention IDs marked sensitive

// Instance registry
export const INSTANCE_REGISTRY_DIR = ".engram";
export const INSTANCE_REGISTRY_FILE = "instances.json";
export const HEARTBEAT_INTERVAL_MS = 60_000;           // 60 seconds
export const STALE_THRESHOLD_MS = 5 * 60_000;          // 5 minutes
export const PRUNE_THRESHOLD_MS = 7 * 24 * 60 * 60_000; // 7 days

// Sharing defaults
export const DEFAULT_SHARING_MODE = "none";
export const DEFAULT_SHARING_TYPES = ["decisions", "conventions"];

// Architecture layer detection patterns
export const LAYER_PATTERNS: Record<string, RegExp[]> = {
  ui: [/\/(ui|views?|screens?|pages?|components?|widgets?)\//i, /\.(jsx|tsx|vue|svelte)$/],
  viewmodel: [/\/(viewmodels?|controllers?|presenters?|blocs?)\//i],
  domain: [/\/(domain|models?|entities|usecases?|interactors?)\//i],
  data: [/\/(data|repositories|repos?|datasources?|providers?)\//i],
  network: [/\/(network|api|services?|clients?|http)\//i],
  database: [/\/(database|db|dao|migrations?|schemas?)\//i],
  di: [/\/(di|injection|modules?|containers?)\//i],
  util: [/\/(utils?|helpers?|extensions?|common)\//i],
  test: [/\/(test|tests|spec|specs|__tests__)\//i, /\.(test|spec)\./i],
  config: [/\/(config|configs?|settings?|env)\//i],
  build: [/\/(build|gradle|cmake|scripts?)\//i, /\.(gradle|cmake)$/i],
};
