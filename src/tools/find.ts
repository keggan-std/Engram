// ============================================================================
// Engram MCP Server — Find Tool (engram_find)
// Lean surface: returns tool catalog and operation schemas as text.
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { success } from "../response.js";
import { getRepos } from "../database.js";

// ─── Full Operation Catalog ───────────────────────────────────────────────────

export const MEMORY_CATALOG: Record<string, { desc: string; params: string }> = {
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
  dump:                 { desc: "Smart dump: auto-classifies free-text into memory categories.", params: "{ content: string, hint?: string }" },
  claim_task:           { desc: "Atomically claim a task for exclusive work.", params: "{ task_id: number, agent_id?: string }" },
  release_task:         { desc: "Release a claimed task.", params: "{ task_id: number, agent_id?: string }" },
  agent_sync:           { desc: "Register agent heartbeat and specializations.", params: "{ agent_id: string, specializations?: string[], agent_name?: string, status?: string, current_task_id?: number }" },
  get_agents:           { desc: "List all registered agents.", params: "{}" },
  route_task:           { desc: "Find best-matched agent for a task by specialization scoring.", params: "{ task_id: number }" },
  broadcast:            { desc: "Send a message to all agents, or to a specific agent only.", params: "{ from_agent: string, message: string, target_agent?: string, expires_in_minutes?: number }" },
};

export const ADMIN_CATALOG: Record<string, { desc: string; params: string }> = {
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
  install_hooks:      { desc: "Install Engram git post-commit hook into .git/hooks/.", params: "{}" },
  remove_hooks:       { desc: "Remove Engram git hook from .git/hooks/post-commit.", params: "{}" },
  generate_report:    { desc: "Generate a comprehensive project memory report.", params: "{}" },
  get_global_knowledge: { desc: "Retrieve cross-project global KB entries.", params: "{}" },
  // Cross-instance actions
  discover_instances: { desc: "List all Engram instances on this machine with status, sharing, and stats.", params: "{ include_stale?: boolean }" },
  get_instance_info:  { desc: "Get detailed info about this instance (identity, sharing config, stats).", params: "{}" },
  set_sharing:        { desc: "Configure sharing mode for this instance.", params: "{ mode: 'none'|'read'|'full', types?: string[] }" },
  query_instance:     { desc: "Query memory from another instance (decisions, conventions, file_notes, tasks, sessions, changes).", params: "{ instance_id: string, type?: string, query?: string, limit?: number, status?: string }" },
  search_all_instances: { desc: "Search across all sharing instances at once.", params: "{ query: string, scope?: string, limit?: number }" },
  import_from_instance: { desc: "Import records from another instance (requires full sharing).", params: "{ instance_id: string, type?: string, ids?: number[] }" },
  set_instance_label: { desc: "Set a human-readable label for this instance.", params: "{ label: string }" },
};

// ─── BM25-style keyword search over catalog entries ──────────────────────────

function searchCatalog(query: string): Array<{ tool: string; action: string; desc: string; params: string; score: number }> {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const results: Array<{ tool: string; action: string; desc: string; params: string; score: number }> = [];

  function scoreEntry(action: string, entry: { desc: string; params: string }): number {
    // Split action name on underscores so "record" matches "record_change", etc.
    const expandedAction = action.replace(/_/g, " ");
    let score = 0;
    for (const w of words) {
      if (action.includes(w)) score += 3;
      else if (expandedAction.includes(w)) score += 2;  // "record" in "record change"
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
      description: `Search the Engram tool catalog or lint content against active conventions.

Actions:
  - search (or discover): Find matching engram_memory / engram_admin operations by keyword.
  - lint: Check a snippet of code or text against all active conventions. Returns matched violations.`,
      inputSchema: {
        query: z.string().optional().describe("Keyword query for search action."),
        action: z.enum(["search", "discover", "lint"]).optional().default("search").describe("'search'/'discover' = catalog lookup (default). 'lint' = check content against conventions."),
        content: z.string().optional().describe("Code/text content to lint. For: lint."),
        file_path: z.string().optional().describe("Optional file path for context. For: lint."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, action, content, file_path }) => {
      const op = action ?? "search";

      if (op === "lint") {
        if (!content) return success({ violations: [], message: "No content provided to lint." });
        const repos = getRepos();
        const conventions = repos.conventions.getActive();
        const violations: Array<{ id: number; category: string; rule: string; severity: "warning" | "error" }> = [];
        for (const conv of conventions) {
          const ruleText = conv.rule;
          const ruleTextLower = ruleText.toLowerCase();
          const contentText = content;
          // Detect prohibition vs requirement
          const isProhibition = /\b(never|must not|do not|don'?t|avoid|forbidden)\b/i.test(ruleText);
          const isRequirement = /\b(always|must|required|every|all)\b/i.test(ruleText);
          // Extract backtick-quoted identifiers as high-priority exact tokens
          const backtickTokens = Array.from(ruleText.matchAll(/`([^`]+)`/g)).map(m => m[1]);
          // Fall back to whole-word keyword extraction (min 4 chars, excluding stop words)
          const STOP = new Set(["always","never","must","every","file","with","that","this","when","from","into","call","have","use","using","should","ensure","code","each"]);
          const fallbackKeywords = ruleTextLower.match(/\b[a-z_.]{4,}\b/g)?.filter(w => !STOP.has(w)) ?? [];
          // Prefer backtick tokens; fall back to extracted keywords
          const identifiers = backtickTokens.length > 0 ? backtickTokens : fallbackKeywords.slice(0, 2);
          if (identifiers.length === 0) continue;
          // Whole-token matching: check if the identifier appears as a word/call in the code
          const matchesAny = identifiers.some(id => {
            const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            // Match as a word boundary (handles dot-notation identifiers like console.log)
            return new RegExp(`\\b${escaped}\\b`, "i").test(contentText) ||
              // Also match call-site (identifier followed by ( or .)
              new RegExp(`${escaped}\\s*[.(]`, "i").test(contentText);
          });
          if (isProhibition && matchesAny) {
            violations.push({ id: conv.id, category: conv.category, rule: conv.rule, severity: "warning" });
          } else if (isRequirement && !matchesAny) {
            violations.push({ id: conv.id, category: conv.category, rule: conv.rule, severity: "warning" });
          }
        }
        return success({
          file_path: file_path ?? null,
          violations,
          conventions_checked: conventions.length,
          message: violations.length === 0
            ? `No convention violations detected (${conventions.length} conventions checked).`
            : `${violations.length} potential violation(s) found against ${conventions.length} conventions.`,
        });
      }

      // default: search
      if (!query) return success({ matches: [], message: "Provide a query to search the tool catalog.", all_memory_actions: Object.keys(MEMORY_CATALOG), all_admin_actions: Object.keys(ADMIN_CATALOG) });
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

/**
 * Build the tool catalog at one of three detail levels.
 *
 * Tier 0 (~80 tokens)  — Action names only. For repeat sessions; agent already knows the surface.
 * Tier 1 (~400 tokens) — Names + one-line descriptions. After 30+ days since last delivery.
 * Tier 2 (~1,200 tokens) — Full descriptions + param schemas. First session ever for this agent.
 */
export function buildToolCatalog(tier: 0 | 1 | 2 = 2): Record<string, unknown> {
  if (tier === 0) {
    return {
      memory_actions: Object.keys(MEMORY_CATALOG),
      admin_actions: Object.keys(ADMIN_CATALOG),
      note: "Repeat session — action names only. Use engram_find({query}) to look up params for any action.",
    };
  }
  if (tier === 1) {
    return {
      engram_memory: {
        description: "All memory operations. Pass action + relevant params.",
        operations: Object.fromEntries(
          Object.entries(MEMORY_CATALOG).map(([k, v]) => [k, v.desc])
        ),
      },
      engram_admin: {
        description: "Admin and maintenance operations.",
        operations: Object.fromEntries(
          Object.entries(ADMIN_CATALOG).map(([k, v]) => [k, v.desc])
        ),
      },
      engram_find: { description: "Search this catalog. params: { query: string }" },
      note: "Use engram_find({query}) to retrieve full param schemas for any action.",
    };
  }
  // tier === 2: full catalog (first session)
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
  { priority: "HIGH",     id: "AR-06", rule: "Call engram_memory(action:'set_file_notes') with executive_summary immediately after reading a file for the first time. Include 2-3 sentences in executive_summary for fast future reads." },
  { priority: "MEDIUM",   id: "AR-07", rule: "Batch related record_change calls. Set impact_scope accurately: local|module|cross_module|global." },
  { priority: "MEDIUM",   id: "AR-08", rule: "For large multi-step tasks, checkpoint progress with engram_memory(action:'checkpoint') before context exhausts." },
];
