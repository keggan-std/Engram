// ============================================================================
// Engram MCP Server — Constants
// ============================================================================

import { readFileSync } from "fs";
import os from "os";
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
export const DB_VERSION = 26; // V18 http-token, V19 soft-delete, V20 audit-log, V21 import-jobs, V22 annotations, V23 pm-convention-upgrade, V24 observations, V25 superseded_by repair, V26 fts_file_notes triggers

// PM Framework — Phase / Keyword / Nudge constants
/** Maps canonical phase name strings (from task tags like `phase:planning`) to phase numbers 1-6. */
export const PHASE_MAP: Record<string, number> = {
  initiation:    1,
  planning:      2,
  execution:     3,
  quality:       4,
  finalization:  5,
  handover:      6,
  documentation: 6,
};

/** Keywords in task titles that indicate PM-heavy work and may trigger PM-Full offer. */
export const PM_KEYWORDS: ReadonlyArray<string> = [
  "milestone",
  "phase gate",
  "deliverable",
  "wbs",
  "risk register",
  "sprint",
  "iteration",
  "kickoff",
  "handover",
];

/** Maximum number of PM nudges that can be surfaced within a single session. */
export const PM_MAX_NUDGES = 5;

/** Semantic version of the bundled PM knowledge base (principles, phases, checklists). */
export const KNOWLEDGE_BASE_VERSION = "1.0";

// Limits
export const MAX_FILE_TREE_DEPTH = 5;
export const MAX_FILE_TREE_ENTRIES = 500;
export const MAX_SEARCH_RESULTS = 50;
export const DEFAULT_SEARCH_LIMIT = 8; // 8 gives headroom for noise; 50 (max) is available via explicit limit param
export const MAX_GIT_LOG_ENTRIES = 50;
export const MAX_RESPONSE_LENGTH = 50000;
/**
 * How much of a task description survives `get_tasks(compact:true)`.
 *
 * Task #103/#68. `compact` was declared on the schema, documented as defaulting
 * to true, and never read — so the full description of every row shipped.
 * MEASURED 2026-08-13: get_tasks({compact:true, limit:60}) returned 120,020
 * characters and overflowed the tool result. Descriptions in a mature store run
 * to several thousand characters each; 400 is enough to recognise a row and
 * decide whether to fetch it in full.
 */
export const TASK_COMPACT_DESCRIPTION_CHARS = 400;
/**
 * How much of a task description or decision rationale survives session start.
 *
 * Task #68. `verbosity:"full"` returned 59,721 tokens against a documented
 * ~730 (81.8x), and the payload GREW with the store — a memory tool got more
 * expensive to orient in the more it had remembered. Tighter than the
 * get_tasks bound above because session start is unavoidable and automatic,
 * where get_tasks is a call an agent chose to make.
 */
export const SESSION_START_BODY_CHARS = 240;
export const DEFAULT_PAGINATION_LIMIT = 20;
export const SNAPSHOT_TTL_MINUTES = 30;
export const COMPACTION_THRESHOLD_SESSIONS = 50;
export const BACKUP_DIR_NAME = "backups";
export const FOCUS_MAX_ITEMS_PER_CATEGORY = 15;
export const FILE_MTIME_STALE_HOURS = 24; // After this many hours of drift, confidence = "stale"
export const FILE_LOCK_DEFAULT_TIMEOUT_MINUTES = 30; // Auto-expire file locks after this many minutes
export const DEFAULT_RETENTION_DAYS = 90;

// tool_call_log retention. Every action logs a row (since 2026-08-02), and
// nothing else prunes this table — compaction does not touch it. The cap is
// generous enough to keep several sessions of replay history and small enough
// that the table cannot become the largest thing in the database.
export const TOOL_CALL_LOG_MAX_ROWS = 20_000;
export const TOOL_CALL_LOG_PRUNE_INTERVAL = 200;
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
  // NOTE: .engram was removed from STRONG markers in v1.9.1 hotfix.
  // It is self-referential — Engram creates .engram/, so its presence
  // cannot prove a *project* boundary.  When cwd = HOME, any stale
  // ~/.engram/ made the home directory look like a project root,
  // causing all global-only IDEs to share one database.  Real projects
  // always have .git or a soft marker (package.json, etc.).
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

/**
 * Returns true if the given directory is the user's home directory.
 * The home dir is never a valid project root — no one's "project" is ~/.
 * This prevents the bootstrap trap where ~/.engram/ makes HOME look like a project.
 */
export function isHomeDirectory(dirPath: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  return norm(dirPath) === norm(os.homedir());
}

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
export const CFG_HTTP_TOKEN = "http_token";           // Bearer token for dashboard API (file fallback: .engram/token)
export const CFG_INSTANCE_VISIBLE = "instance_visible"; // "true" | "false" — controls permanent enrollment in registry

// ─── Config write policy (audit N2) ─────────────────────────────────────────
//
// `engram_admin(action:"config")` used to write ANY key, including http_token,
// sharing_mode, sharing_types and sensitive_keys — so one ordinary tool call
// could hand this project's memory to every Engram instance on the machine, or
// overwrite the dashboard bearer token. A whitelist existed pre-v1.6 in
// src/tools/stats.ts and was dropped in the dispatcher consolidation.
//
// Restored here rather than in either dispatcher, because the SAME gap exists
// on the HTTP surface (PUT /api/v1/settings/:key). One list, both doors.
//
// The rule: the generic `config` setter writes user preferences only. Every
// security- or identity-bearing key already has a dedicated action that owns
// it and validates it — `set_sharing`, `set_visibility`, `set_instance_label`,
// `mark_sensitive`/`unmark_sensitive`. `config` must not be a back door around
// those, so they are rejected here with a pointer to the action that owns them.

/** Keys a user or agent may freely set through the generic config surface. */
export const TUNABLE_CONFIG_KEYS: ReadonlySet<string> = new Set([
  "auto_compact",
  "compact_threshold",
  "retention_days",
  "max_backups",
  "pm_lite_enabled",
  "pm_full_enabled",
  CFG_AUTO_UPDATE_CHECK,
  CFG_AUTO_UPDATE_SKIP_VERSION,
  CFG_AUTO_UPDATE_REMIND_AFTER,
  CFG_AUTO_UPDATE_NOTIFY_LEVEL,
]);

/**
 * Keys the generic config setter must refuse, mapped to the action that owns
 * them. A named action is a better answer than a confirm token: it keeps the
 * validation in one place instead of duplicating it behind a prompt.
 */
export const PROTECTED_CONFIG_KEYS: ReadonlyMap<string, string> = new Map([
  [CFG_SHARING_MODE, 'engram_admin({action:"set_sharing", mode})'],
  [CFG_SHARING_TYPES, 'engram_admin({action:"set_sharing", mode, types})'],
  [CFG_INSTANCE_VISIBLE, 'engram_admin({action:"set_visibility", visible})'],
  [CFG_INSTANCE_LABEL, 'engram_admin({action:"set_instance_label", label})'],
  [CFG_SENSITIVE_KEYS, 'engram_admin({action:"mark_sensitive"/"unmark_sensitive"})'],
  [CFG_HTTP_TOKEN, "not writable — rotate it by deleting .engram/token and restarting"],
  [CFG_INSTANCE_ID, "not writable — instance identity is seeded at database init"],
  [CFG_MACHINE_ID, "not writable — machine identity is derived from the host"],
  [CFG_INSTANCE_CREATED_AT, "not writable — set once at database init"],
]);

/**
 * Keys whose VALUE must never be returned through a tool or API response.
 * `config` with no key returned the whole table, dashboard bearer token and
 * machine GUID included.
 */
export const SECRET_CONFIG_KEYS: ReadonlySet<string> = new Set([
  CFG_HTTP_TOKEN,
  CFG_MACHINE_ID,
]);

/** Placeholder substituted for a secret value on read. */
export const REDACTED_VALUE = "[redacted]";

/**
 * Why a config write should be refused, or null if it is allowed.
 * Shared by the MCP `config` action and the HTTP settings route.
 */
export function configWriteRejection(key: string): string | null {
  const owner = PROTECTED_CONFIG_KEYS.get(key);
  if (owner) return `Config key "${key}" is security- or identity-bearing and cannot be set through the generic config surface. Use ${owner}.`;
  if (!TUNABLE_CONFIG_KEYS.has(key)) {
    return `Unknown config key "${key}". Settable keys: ${[...TUNABLE_CONFIG_KEYS].sort().join(", ")}.`;
  }
  return null;
}

// Instance registry
export const INSTANCE_REGISTRY_DIR = ".engram";
export const INSTANCE_REGISTRY_FILE = "instances.json";
export const HEARTBEAT_INTERVAL_MS = 60_000;           // 60 seconds
export const STALE_THRESHOLD_MS = 5 * 60_000;          // 5 minutes
export const PRUNE_THRESHOLD_MS = 7 * 24 * 60 * 60_000; // 7 days

// Sharing defaults
export const DEFAULT_SHARING_MODE = "none";
export const DEFAULT_SHARING_TYPES = ["decisions", "conventions"];

// ─── Cross-instance read policy (FR-D2 F4) ──────────────────────────────────
//
// The only tables another instance may read out of this one. It lives here, not
// in cross-instance.service.ts, because it has two enforcement points and used
// to have one: the READER (checkPermission) tested it, and the WRITER
// (setSharing) stored whatever type names it was handed. searchAll() then
// re-implemented the reader's checks inline and omitted this test, so a name
// that setSharing accepted became a table searchAll would read — including
// `observations`, `handoffs` and `audit_log`. PROVEN by scratchpad PoC before
// the fix: checkPermission refused 'observations' while searchAll returned the
// row. Same shape as audit N2 above — one policy, two doors, and the door
// nobody looked at was the open one.
//
// `scope` is interpolated into SQL as an identifier in searchAll's generic
// branch. That is only safe because this set constrains it. Do not relax the
// check without removing the interpolation.
export const QUERYABLE_TABLES: ReadonlySet<string> = new Set([
  "decisions",
  "conventions",
  "file_notes",
  "tasks",
  "sessions",
  "changes",
  "milestones",
]);

// ── `since`: the accepted forms, enforced at BOTH ends ─────────────────────
//
// Same shape as QUERYABLE_TABLES above, and for the same reason. `since` is
// the parameter that carried the arbitrary-command-execution defect fixed in
// 1.14.0 (see gitCommand in src/utils.ts). The sink is closed — execFileSync
// spawns no shell — so this is defence in depth, not the fix. It exists
// because the audit that missed the first bug missed it by reasoning about
// call sites instead of about the parameter, and a bounded parameter survives
// a future caller who reintroduces a shell.
//
// The three accepted forms are exactly the three the handler ever understood:
//   "session_start"          — resolved against the sessions table
//   /^\d+[hdm]$/             — a relative window: 24h, 7d, 30m
//   an ISO-8601 timestamp    — compared directly against stored timestamps
//
// Anything else used to fall through an `else` and be passed along verbatim.
// That fall-through is deleted; unmatched input is now an error, not a shrug.
export const SINCE_LITERALS: ReadonlySet<string> = new Set(["session_start"]);
export const SINCE_RELATIVE = /^\d+[hdm]$/;
// Deliberately stricter than Date.parse, which accepts "now", "Dec 25" and a
// great deal else. Engram stores ISO-8601 and compares as text, so anything
// that is not ISO-8601 would silently compare wrong even with the shell gone.
export const SINCE_ISO = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function isValidSince(value: string): boolean {
  return SINCE_LITERALS.has(value) || SINCE_RELATIVE.test(value) || SINCE_ISO.test(value);
}

export const SINCE_REJECTION =
  "since must be 'session_start', a relative window like '24h' / '7d' / '30m', " +
  "or an ISO-8601 timestamp like '2026-08-07' or '2026-08-07T10:02:08Z'.";

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
