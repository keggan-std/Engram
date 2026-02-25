// ============================================================================
// Engram Universal Thin Client — BM25 Fuzzy Action Resolver
// Uses MiniSearch to resolve near-miss / natural-language action strings
// to canonical Engram action names when exact match fails.
// ============================================================================

import MiniSearch from "minisearch";
import { exactRoute, type RouteTarget, ROUTE_TABLE } from "./router.js";

// ─── Catalog entry shape ──────────────────────────────────────────────────

interface ActionEntry {
    id: string; // canonical action name (the route table key)
    desc: string; // description from find.ts MEMORY_CATALOG / ADMIN_CATALOG
    aliases: string; // space-separated natural-language aliases
}

// ─── BM25 index ───────────────────────────────────────────────────────────

const CATALOG: ActionEntry[] = [
    // Session
    { id: "start",                 desc: "begin session start work load context memory",                     aliases: "start session begin work open session" },
    { id: "end",                   desc: "end close finish session save summary",                             aliases: "end session close session finish session" },
    { id: "get_history",           desc: "history past sessions list previous",                              aliases: "session history past sessions" },
    { id: "handoff",               desc: "handoff transfer to next agent context exhausted",                 aliases: "hand off transfer agent handoff" },
    { id: "acknowledge_handoff",   desc: "acknowledge accept read handoff pending",                          aliases: "ack handoff acknowledge handoff" },

    // File Notes
    { id: "get_file_notes",        desc: "read retrieve file notes intelligence purpose staleness",          aliases: "file notes check file know about file get notes" },
    { id: "set_file_notes",        desc: "store save write file notes purpose layer complexity",             aliases: "save file notes write notes set notes" },
    { id: "set_file_notes_batch",  desc: "store save multiple files notes batch",                           aliases: "batch file notes save multiple files" },

    // Changes
    { id: "record_change",         desc: "log record file change edit modification after every edit",       aliases: "record change log change save change write change" },
    { id: "get_file_history",      desc: "get changes decisions history for specific file",                  aliases: "file history changes for file" },
    { id: "begin_work",            desc: "declare intent edit files before starting abandoned work detection", aliases: "begin work declare work start working" },

    // Decisions
    { id: "record_decision",       desc: "log architectural decision rationale design choice",               aliases: "record decision save decision architectural decision design decision" },
    { id: "record_decisions_batch",desc: "log multiple decisions batch architectural",                       aliases: "batch decisions multiple decisions" },
    { id: "get_decisions",         desc: "retrieve list decisions filtered status tag file",                 aliases: "get decisions list decisions check decisions" },
    { id: "update_decision",       desc: "change decision status supersede deprecated active",               aliases: "update decision change decision status" },

    // Conventions
    { id: "add_convention",        desc: "record project coding convention rule category",                   aliases: "add convention save convention code rule" },
    { id: "get_conventions",       desc: "list active conventions rules category",                           aliases: "get conventions list conventions active rules" },
    { id: "toggle_convention",     desc: "enable disable convention enforced",                               aliases: "toggle convention enable disable convention" },

    // Tasks
    { id: "create_task",           desc: "create persistent cross-session task priority tags",               aliases: "create task add task new task" },
    { id: "update_task",           desc: "update task status priority description fields",                   aliases: "update task change task status complete task" },
    { id: "get_tasks",             desc: "retrieve list tasks filtered status priority",                     aliases: "get tasks list tasks open tasks" },
    { id: "claim_task",            desc: "atomically claim task exclusive work agent",                       aliases: "claim task take task assign task" },
    { id: "release_task",          desc: "release claimed task agent",                                       aliases: "release task unclaim task" },
    { id: "route_task",            desc: "find best agent for task specialization scoring",                  aliases: "route task assign best agent" },

    // Checkpoint
    { id: "checkpoint",            desc: "offload working memory save progress context exhausting",         aliases: "checkpoint save progress offload context mid-session save" },
    { id: "get_checkpoint",        desc: "restore last checkpoint current session",                          aliases: "get checkpoint restore checkpoint load checkpoint" },

    // Intelligence
    { id: "search",                desc: "full-text search all memory types sessions changes decisions",     aliases: "search find query memory search notes" },
    { id: "what_changed",          desc: "diff report changes since given time git",                         aliases: "what changed diff report recent changes" },
    { id: "get_dependency_map",    desc: "dependency graph upstream downstream file",                        aliases: "dependency map file dependencies graph" },

    // Milestones
    { id: "record_milestone",      desc: "log project milestone achievement version",                        aliases: "record milestone save milestone achievement" },
    { id: "get_milestones",        desc: "retrieve milestones list",                                         aliases: "get milestones list milestones" },

    // Scheduler
    { id: "schedule_event",        desc: "schedule deferred action future session trigger",                  aliases: "schedule event deferred action future task" },
    { id: "get_scheduled_events",  desc: "list scheduled events status trigger",                             aliases: "scheduled events list events" },
    { id: "update_scheduled_event",desc: "modify cancel scheduled event",                                    aliases: "update event cancel event modify event" },
    { id: "acknowledge_event",     desc: "approve cancel triggered event",                                   aliases: "acknowledge event approve event" },
    { id: "check_events",          desc: "check triggered events mid-session",                               aliases: "check events triggered events" },

    // Coordination
    { id: "dump",                  desc: "smart dump auto-classify free-text memory categories",             aliases: "dump notes save everything classify notes" },
    { id: "agent_sync",            desc: "register agent heartbeat specializations status",                  aliases: "agent sync heartbeat register agent" },
    { id: "get_agents",            desc: "list all registered agents",                                       aliases: "get agents list agents" },
    { id: "broadcast",             desc: "send message all specific agents",                                 aliases: "broadcast message send message agents" },

    // Admin
    { id: "backup",                desc: "create database backup",                                           aliases: "backup create backup save database" },
    { id: "restore",               desc: "restore from backup file",                                         aliases: "restore backup recover database" },
    { id: "list_backups",          desc: "list available backup files",                                      aliases: "list backups available backups" },
    { id: "export",                desc: "export all memory to JSON",                                        aliases: "export memory export data json" },
    { id: "import",                desc: "import from exported JSON",                                        aliases: "import data import memory json" },
    { id: "compact",               desc: "compact old session data save space",                              aliases: "compact sessions clean old data" },
    { id: "clear",                 desc: "clear memory tables destructive delete",                           aliases: "clear memory delete data reset" },
    { id: "stats",                 desc: "overview stored memory counts sizes",                              aliases: "stats statistics overview memory size" },
    { id: "health",                desc: "database health check",                                            aliases: "health check db health status" },
    { id: "config",                desc: "read write engram config values key",                              aliases: "config configuration settings" },
    { id: "scan_project",          desc: "scan filesystem cache project structure",                          aliases: "scan project filesystem project structure" },
    { id: "install_hooks",         desc: "install git post-commit hook hooks",                               aliases: "install hooks git hooks" },
    { id: "remove_hooks",          desc: "remove git hook post-commit",                                      aliases: "remove hooks uninstall hooks" },
    { id: "generate_report",       desc: "generate comprehensive project memory report",                     aliases: "generate report project report" },
    { id: "get_global_knowledge",  desc: "retrieve cross-project global knowledge base entries",             aliases: "global knowledge global kb cross-project" },

    // Find
    { id: "discover",              desc: "search catalog find operation action lookup",                      aliases: "discover find action lookup catalog what can you do" },
    { id: "lint",                  desc: "lint check code conventions violations",                           aliases: "lint check violations code conventions" },
];

// ─── Build MiniSearch instance ────────────────────────────────────────────

const _index = new MiniSearch<ActionEntry>({
    fields: ["id", "desc", "aliases"],
    storeFields: ["id"],
    searchOptions: {
        boost: { id: 3, aliases: 2, desc: 1 },
        fuzzy: 0.2,
        prefix: true,
    },
});

_index.addAll(CATALOG);

// ─── Public API ───────────────────────────────────────────────────────────

export interface ResolveResult {
    route: RouteTarget;
    action: string;
    score: number;
    method: "exact" | "bm25";
}

/**
 * Resolve an action string → RouteTarget using exact match first, then BM25.
 * Returns null if nothing matches above the confidence threshold.
 */
export function resolveAction(raw: string): ResolveResult | null {
    // 1. Exact match (fastest path, zero cost)
    const exact = exactRoute(raw);
    if (exact) {
        return { route: exact, action: raw, score: 1.0, method: "exact" };
    }

    // 2. Normalise: snake_case → spaces, lowercase, strip filler words
    const normalised = raw
        .replace(/_/g, " ")
        .replace(/-/g, " ")
        .toLowerCase()
        .trim();

    // 3. Try exact match on normalised (catches "record change" → "record_change")
    const normalisedKey = normalised.replace(/\s+/g, "_");
    const normExact = exactRoute(normalisedKey);
    if (normExact) {
        return { route: normExact, action: normalisedKey, score: 0.99, method: "exact" };
    }

    // 4. BM25 fuzzy search
    const results = _index.search(normalised);
    if (results.length === 0) return null;

    const best = results[0];
    const route = (ROUTE_TABLE as Record<string, RouteTarget>)[best.id];
    if (!route) return null;

    // Normalise score to [0,1] range — MiniSearch scores are unbounded
    const normScore = Math.min(best.score / 10, 1.0);

    // Reject very weak matches (likely mis-routes)
    if (normScore < 0.05) return null;

    return { route, action: best.id as string, score: normScore, method: "bm25" };
}

/**
 * Return the top-N closest action names for a query (used in did-you-mean errors).
 */
export function suggestActions(raw: string, topN = 3): string[] {
    const normalised = raw.replace(/_/g, " ").toLowerCase().trim();
    const results = _index.search(normalised, { fuzzy: 0.4 });
    return results.slice(0, topN).map(r => r.id as string);
}
