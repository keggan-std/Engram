// ============================================================================
// Engram MCP Server — Constants
// ============================================================================

export const SERVER_NAME = "engram-mcp-server";
export const SERVER_VERSION = "1.2.0";
export const TOOL_PREFIX = "engram";

// Database
export const DB_DIR_NAME = ".engram";
export const DB_FILE_NAME = "memory.db";
export const DB_VERSION = 4;

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
