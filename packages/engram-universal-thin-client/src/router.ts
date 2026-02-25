// ============================================================================
// Engram Universal Thin Client — Action Router
// Maps action strings → { tool, action } for the 4 Engram dispatcher tools.
// ============================================================================

export type UpstreamTool =
    | "engram_session"
    | "engram_memory"
    | "engram_admin"
    | "engram_find";

export interface RouteTarget {
    tool: UpstreamTool;
    action: string;
}

// ─── Complete route table ──────────────────────────────────────────────────
// Every action supported by Engram's 4 dispatcher tools.
// Maps canonical action name → { tool, action }.
// BM25 fuzzy routing in bm25.ts resolves near-misses to entries in this table.

export const ROUTE_TABLE: Readonly<Record<string, RouteTarget>> = {
    // ── Session ──────────────────────────────────────────────────────────────
    start:                { tool: "engram_session",  action: "start" },
    end:                  { tool: "engram_session",  action: "end" },
    get_history:          { tool: "engram_session",  action: "get_history" },
    handoff:              { tool: "engram_session",  action: "handoff" },
    acknowledge_handoff:  { tool: "engram_session",  action: "acknowledge_handoff" },

    // ── File Notes ───────────────────────────────────────────────────────────
    get_file_notes:        { tool: "engram_memory", action: "get_file_notes" },
    set_file_notes:        { tool: "engram_memory", action: "set_file_notes" },
    set_file_notes_batch:  { tool: "engram_memory", action: "set_file_notes_batch" },

    // ── Changes ──────────────────────────────────────────────────────────────
    record_change:         { tool: "engram_memory", action: "record_change" },
    get_file_history:      { tool: "engram_memory", action: "get_file_history" },
    begin_work:            { tool: "engram_memory", action: "begin_work" },

    // ── Decisions ────────────────────────────────────────────────────────────
    record_decision:       { tool: "engram_memory", action: "record_decision" },
    record_decisions_batch:{ tool: "engram_memory", action: "record_decisions_batch" },
    get_decisions:         { tool: "engram_memory", action: "get_decisions" },
    update_decision:       { tool: "engram_memory", action: "update_decision" },

    // ── Conventions ──────────────────────────────────────────────────────────
    add_convention:        { tool: "engram_memory", action: "add_convention" },
    get_conventions:       { tool: "engram_memory", action: "get_conventions" },
    toggle_convention:     { tool: "engram_memory", action: "toggle_convention" },

    // ── Tasks ─────────────────────────────────────────────────────────────────
    create_task:           { tool: "engram_memory", action: "create_task" },
    update_task:           { tool: "engram_memory", action: "update_task" },
    get_tasks:             { tool: "engram_memory", action: "get_tasks" },
    claim_task:            { tool: "engram_memory", action: "claim_task" },
    release_task:          { tool: "engram_memory", action: "release_task" },
    route_task:            { tool: "engram_memory", action: "route_task" },

    // ── Checkpoint ───────────────────────────────────────────────────────────
    checkpoint:            { tool: "engram_memory", action: "checkpoint" },
    get_checkpoint:        { tool: "engram_memory", action: "get_checkpoint" },

    // ── Intelligence ─────────────────────────────────────────────────────────
    search:                { tool: "engram_memory", action: "search" },
    what_changed:          { tool: "engram_memory", action: "what_changed" },
    get_dependency_map:    { tool: "engram_memory", action: "get_dependency_map" },

    // ── Milestones ───────────────────────────────────────────────────────────
    record_milestone:      { tool: "engram_memory", action: "record_milestone" },
    get_milestones:        { tool: "engram_memory", action: "get_milestones" },

    // ── Scheduler ────────────────────────────────────────────────────────────
    schedule_event:        { tool: "engram_memory", action: "schedule_event" },
    get_scheduled_events:  { tool: "engram_memory", action: "get_scheduled_events" },
    update_scheduled_event:{ tool: "engram_memory", action: "update_scheduled_event" },
    acknowledge_event:     { tool: "engram_memory", action: "acknowledge_event" },
    check_events:          { tool: "engram_memory", action: "check_events" },

    // ── Coordination ─────────────────────────────────────────────────────────
    dump:                  { tool: "engram_memory", action: "dump" },
    agent_sync:            { tool: "engram_memory", action: "agent_sync" },
    get_agents:            { tool: "engram_memory", action: "get_agents" },
    broadcast:             { tool: "engram_memory", action: "broadcast" },

    // ── Admin ─────────────────────────────────────────────────────────────────
    backup:                { tool: "engram_admin", action: "backup" },
    restore:               { tool: "engram_admin", action: "restore" },
    list_backups:          { tool: "engram_admin", action: "list_backups" },
    export:                { tool: "engram_admin", action: "export" },
    import:                { tool: "engram_admin", action: "import" },
    compact:               { tool: "engram_admin", action: "compact" },
    clear:                 { tool: "engram_admin", action: "clear" },
    stats:                 { tool: "engram_admin", action: "stats" },
    health:                { tool: "engram_admin", action: "health" },
    config:                { tool: "engram_admin", action: "config" },
    scan_project:          { tool: "engram_admin", action: "scan_project" },
    install_hooks:         { tool: "engram_admin", action: "install_hooks" },
    remove_hooks:          { tool: "engram_admin", action: "remove_hooks" },
    generate_report:       { tool: "engram_admin", action: "generate_report" },
    get_global_knowledge:  { tool: "engram_admin", action: "get_global_knowledge" },

    // ── Find ──────────────────────────────────────────────────────────────────
    discover:              { tool: "engram_find",  action: "search" },
    lint:                  { tool: "engram_find",  action: "lint" },
} as const;

/** Exact-match lookup: returns route or null. */
export function exactRoute(action: string): RouteTarget | null {
    return (ROUTE_TABLE as Record<string, RouteTarget>)[action] ?? null;
}
