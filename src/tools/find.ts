// ============================================================================
// Engram MCP Server — Find Tool (engram_find)
// Lean surface: returns tool catalog and operation schemas as text.
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { success } from "../response.js";

// ─── Full Operation Catalog ───────────────────────────────────────────────────

const MEMORY_CATALOG: Record<string, { desc: string; params: string }> = {
  // File Notes
  get_file_notes:       { desc: "Read stored notes for a file. Includes staleness confidence.", params: "{ file_path: string, task_focus?: string }" },
  set_file_notes:       { desc: "Store notes for a file. Call immediately after reading a file.", params: "{ file_path, purpose?, layer?, complexity?, dependencies?, dependents?, notes? }" },
  set_file_notes_batch: { desc: "Store notes for multiple files at once.", params: "{ files: [{file_path, purpose?, layer?, complexity?, notes?}] }" },
  // Changes
  record_change:        { desc: "Log a file change. Call after EVERY edit.", params: "{ changes: [{file_path, change_type, description, diff_summary?, impact_scope?}] }" },
  get_file_history:     { desc: "Get all changes + decisions for a specific file.", params: "{ file_path: string, limit?: number }" },
  begin_work:           { desc: "Declare intent to edit files before starting. Enables abandoned-work detection.", params: "{ description: string, files: string[], agent_id?: string }" },
  // Decisions
  record_decision:      { desc: "Log an architectural decision. Always include rationale.", params: "{ decision, rationale?, tags?, affected_files?, status?, supersedes?, depends_on?, export_global? }" },
  record_decisions_batch: { desc: "Log multiple decisions in one call.", params: "{ decisions: [{decision, rationale?, tags?, affected_files?}] }" },
  get_decisions:        { desc: "Retrieve decisions, optionally filtered.", params: "{ status?, tag?, file_path?, limit? }" },
  update_decision:      { desc: "Change decision status.", params: "{ id: number, status: 'active'|'superseded'|'deprecated'|'experimental' }" },
  // Conventions
  add_convention:       { desc: "Record a project coding convention.", params: "{ category, rule, examples? }" },
  get_conventions:      { desc: "List all active conventions.", params: "{ category? }" },
  toggle_convention:    { desc: "Enable or disable a convention.", params: "{ id: number, enforced: boolean }" },
  // Tasks
  create_task:          { desc: "Create a persistent cross-session task.", params: "{ title, description?, priority?, tags?, assigned_files?, blocked_by? }" },
  update_task:          { desc: "Update task status, priority, or fields.", params: "{ id: number, status?, priority?, description?, owner?, add_blocks?, add_blocked_by? }" },
  get_tasks:            { desc: "Retrieve tasks, optionally filtered.", params: "{ status?, priority?, tag?, limit?, include_done? }" },
  // Checkpoint
  checkpoint:           { desc: "Offload working memory before context exhausts.", params: "{ current_understanding: string, progress: string, relevant_files? }" },
  get_checkpoint:       { desc: "Restore last checkpoint for current session.", params: "{}" },
  // Intelligence
  search:               { desc: "Full-text search across all memory types.", params: "{ query: string, scope?: 'all'|'sessions'|'changes'|'decisions'|'file_notes'|'conventions'|'tasks', limit? }" },
  what_changed:         { desc: "Get diff report since a given time.", params: "{ since?: string, include_git?: boolean }" },
  get_dependency_map:   { desc: "Get upstream/downstream dependency graph for a file.", params: "{ file_path: string, depth?: number }" },
  // Milestones
  record_milestone:     { desc: "Log a project milestone or achievement.", params: "{ title: string, description?, version?, tags? }" },
  get_milestones:       { desc: "Retrieve milestones.", params: "{ limit? }" },
  // Scheduler
  schedule_event:       { desc: "Schedule a deferred action for a future session.", params: "{ title, trigger_type: 'next_session'|'datetime'|'task_complete'|'manual', description?, trigger_value?, priority? }" },
  get_scheduled_events: { desc: "List scheduled events.", params: "{ status?, trigger_type?, include_done?, limit? }" },
  update_scheduled_event: { desc: "Modify or cancel a scheduled event.", params: "{ id: number, status?, title?, description?, priority?, trigger_type?, trigger_value? }" },
  acknowledge_event:    { desc: "Approve or cancel a triggered event.", params: "{ id: number, approved: boolean, note? }" },
  check_events:         { desc: "Check for triggered events mid-session.", params: "{}" },
  // Coordination
  dump:                 { desc: "Smart dump: auto-classifies free-text into memory categories.", params: "{ description: string, hint?: string }" },
  claim_task:           { desc: "Atomically claim a task for exclusive work.", params: "{ task_id: number, agent_id?: string }" },
  release_task:         { desc: "Release a claimed task.", params: "{ task_id: number, agent_id?: string }" },
  agent_sync:           { desc: "Register agent heartbeat and specializations.", params: "{ agent_id: string, specializations?, last_seen_ms? }" },
  get_agents:           { desc: "List all registered agents.", params: "{}" },
  broadcast:            { desc: "Send a message to all or specific agents.", params: "{ message: string, target_agents? }" },
};

const ADMIN_CATALOG: Record<string, { desc: string; params: string }> = {
  backup:             { desc: "Create a database backup.", params: "{ output_path? }" },
  restore:            { desc: "Restore from a backup file.", params: "{ input_path: string, confirm: 'yes-restore' }" },
  list_backups:       { desc: "List all available backup files.", params: "{}" },
  export:             { desc: "Export all memory to JSON.", params: "{ output_path? }" },
  import:             { desc: "Import from exported JSON.", params: "{ input_path: string, dry_run?: boolean }" },
  compact:            { desc: "Compact old session data to save space.", params: "{ keep_sessions?, max_age_days?, dry_run? }" },
  clear:              { desc: "Clear memory tables. DESTRUCTIVE.", params: "{ scope: 'all'|'sessions'|..., confirm: 'yes-delete-permanently' }" },
  stats:              { desc: "Overview of all stored memory (counts, sizes).", params: "{}" },
  health:             { desc: "Database health check.", params: "{}" },
  config:             { desc: "Read or write Engram config values.", params: "{ key?: string, value?: string }" },
  scan_project:       { desc: "Scan filesystem and cache project structure.", params: "{ force_refresh?, max_depth? }" },
  generate_report:    { desc: "Generate a comprehensive project memory report.", params: "{}" },
  get_global_knowledge: { desc: "Retrieve cross-project global KB entries.", params: "{}" },
  install_hooks:      { desc: "Install git post-commit hook for auto change recording.", params: "{}" },
};

// ─── BM25-style keyword search over catalog entries ──────────────────────────

function searchCatalog(query: string): Array<{ tool: string; action: string; desc: string; params: string; score: number }> {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const results: Array<{ tool: string; action: string; desc: string; params: string; score: number }> = [];

  function scoreEntry(action: string, entry: { desc: string; params: string }): number {
    const text = `${action} ${entry.desc} ${entry.params}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (action.includes(w)) score += 3;
      if (entry.desc.toLowerCase().includes(w)) score += 2;
      if (entry.params.toLowerCase().includes(w)) score += 1;
    }
    return score;
  }

  for (const [action, entry] of Object.entries(MEMORY_CATALOG)) {
    const score = scoreEntry(action, entry);
    if (score > 0) results.push({ tool: "engram_memory", action, desc: entry.desc, params: entry.params, score });
  }

  for (const [action, entry] of Object.entries(ADMIN_CATALOG)) {
    const score = scoreEntry(action, entry);
    if (score > 0) results.push({ tool: "engram_admin", action, desc: entry.desc, params: entry.params, score });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 8);
}

// ─── Tool Registration ───────────────────────────────────────────────────────

export function registerFindTool(server: McpServer): void {
  server.registerTool(
    "engram_find",
    {
      title: "Find Tool",
      description: `Search the Engram tool catalog. Returns parameter schemas for engram_memory and engram_admin operations. Use this when you know what you want to do but need the exact parameter names.

Examples: "record a file change", "search memory", "get task list", "backup database"`,
      inputSchema: {
        query: z.string().describe("What you want to do, e.g. 'record a file change', 'search memory', 'create a task'"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query }) => {
      const matches = searchCatalog(query);

      if (matches.length === 0) {
        return success({
          query,
          matches: [],
          message: `No catalog entries matched "${query}". Try broader terms.`,
          all_memory_actions: Object.keys(MEMORY_CATALOG),
          all_admin_actions: Object.keys(ADMIN_CATALOG),
        });
      }

      return success({
        query,
        matches: matches.map(m => ({
          call: `${m.tool}(action: "${m.action}", ...params)`,
          description: m.desc,
          params: m.params,
        })),
        message: `Found ${matches.length} matching operation(s) for "${query}".`,
      });
    }
  );
}

// ─── Exported catalog for embedding in start_session response ─────────────────

export function buildToolCatalog(): Record<string, unknown> {
  return {
    engram_memory: {
      description: "All memory operations. Pass action + relevant params.",
      operations: Object.fromEntries(
        Object.entries(MEMORY_CATALOG).map(([k, v]) => [k, `${v.desc} params: ${v.params}`])
      ),
    },
    engram_admin: {
      description: "Admin and maintenance operations. Use rarely.",
      operations: Object.fromEntries(
        Object.entries(ADMIN_CATALOG).map(([k, v]) => [k, `${v.desc} params: ${v.params}`])
      ),
    },
    engram_find: {
      description: "Search this catalog. params: { query: string }",
    },
  };
}

// ─── Agent Rules block ────────────────────────────────────────────────────────

export const AGENT_RULES = [
  { priority: "CRITICAL", id: "AR-01", rule: "Call engram_memory(action:'record_change') after every file edit. Include what changed and why." },
  { priority: "CRITICAL", id: "AR-02", rule: "Call engram_memory(action:'get_file_notes') before opening any file. Open only if notes are absent or stale." },
  { priority: "CRITICAL", id: "AR-03", rule: "Call engram_session(action:'end') before terminating. Include all incomplete work as tasks." },
  { priority: "HIGH",     id: "AR-04", rule: "Call engram_memory(action:'get_decisions') before making any architectural choice." },
  { priority: "HIGH",     id: "AR-05", rule: "Call engram_memory(action:'record_decision') for every new design or architecture decision made." },
  { priority: "HIGH",     id: "AR-06", rule: "Call engram_memory(action:'set_file_notes') immediately after reading a file for the first time." },
  { priority: "MEDIUM",   id: "AR-07", rule: "Batch related record_change calls. Set impact_scope accurately: local|module|cross_module|global." },
  { priority: "MEDIUM",   id: "AR-08", rule: "For large multi-step tasks, checkpoint progress with engram_memory(action:'checkpoint') before context exhausts." },
];
