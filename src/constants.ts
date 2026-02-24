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
export const DB_VERSION = 8; // V7 on feature/v1.6-agent-safety, V8 on this branch

// Limits
export const MAX_FILE_TREE_DEPTH = 5;
export const MAX_FILE_TREE_ENTRIES = 500;
export const MAX_SEARCH_RESULTS = 50;
export const MAX_GIT_LOG_ENTRIES = 50;
export const MAX_RESPONSE_LENGTH = 50000;
export const DEFAULT_PAGINATION_LIMIT = 20;
export const SNAPSHOT_TTL_MINUTES = 30;
export const COMPACTION_THRESHOLD_SESSIONS = 50;
export const BACKUP_DIR_NAME = "backups";
export const FOCUS_MAX_ITEMS_PER_CATEGORY = 15;
export const FILE_MTIME_STALE_HOURS = 24; // After this many hours of drift, confidence = "stale"
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
export const PROJECT_MARKERS = [
  ".git",
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
