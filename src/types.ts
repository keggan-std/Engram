// ============================================================================
// Engram MCP Server — Type Definitions
// ============================================================================

// ─── Database Row Types ─────────────────────────────────────────────────────

export interface SessionRow {
  id: number;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  agent_name: string;
  project_root: string;
  tags: string | null;          // JSON array
  parent_session_id: number | null;
}

export interface ChangeRow {
  id: number;
  session_id: number | null;
  timestamp: string;
  file_path: string;
  change_type: ChangeType;
  description: string;
  diff_summary: string | null;
  impact_scope: ImpactScope;
}

export interface DecisionRow {
  id: number;
  session_id: number | null;
  timestamp: string;
  decision: string;
  rationale: string | null;
  affected_files: string | null;  // JSON array
  tags: string | null;            // JSON array
  status: DecisionStatus;
  superseded_by: number | null;
}

export interface FileNoteRow {
  file_path: string;
  purpose: string | null;
  dependencies: string | null;    // JSON array
  dependents: string | null;      // JSON array
  layer: ArchLayer | null;
  last_reviewed: string | null;
  last_modified_session: number | null;
  notes: string | null;
  complexity: Complexity | null;
  file_mtime: number | null;      // Unix ms of file at time notes were saved
  content_hash: string | null;    // SHA-256 of file content at note-write time
  git_branch: string | null;      // git branch at note-write time
  executive_summary: string | null; // 2-3 sentence Tier 1 micro summary
}

export type FileNoteConfidence = "high" | "medium" | "stale" | "unknown";

export interface FileNoteWithStaleness extends FileNoteRow {
  confidence: FileNoteConfidence;
  stale: boolean;
  staleness_hours?: number;       // Present when stale: true
}

export interface ConventionRow {
  id: number;
  session_id: number | null;
  timestamp: string;
  category: ConventionCategory;
  rule: string;
  examples: string | null;       // JSON array
  enforced: boolean;
}

export interface TaskRow {
  id: number;
  session_id: number | null;
  created_at: string;
  updated_at: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_files: string | null;  // JSON array
  tags: string | null;            // JSON array
  completed_at: string | null;
  blocked_by: string | null;      // JSON array of task IDs
  claimed_by: string | null;      // Agent ID that claimed this task
  claimed_at: number | null;      // Unix ms when claimed
}

export interface AgentRow {
  id: string;
  name: string;
  last_seen: number;              // Unix ms
  current_task_id: number | null;
  status: AgentStatus;
}

export interface BroadcastRow {
  id: number;
  from_agent: string;
  message: string;
  created_at: number;             // Unix ms
  expires_at: number | null;      // Unix ms
  read_by: string;                // JSON array of agent IDs
}

export interface SnapshotRow {
  key: string;
  value: string;
  updated_at: string;
  ttl_minutes: number | null;
}

export interface MilestoneRow {
  id: number;
  session_id: number | null;
  timestamp: string;
  title: string;
  description: string | null;
  version: string | null;
  tags: string | null;           // JSON array
}

export interface ScheduledEventRow {
  id: number;
  session_id: number | null;
  created_at: string;
  title: string;
  description: string | null;
  trigger_type: EventTriggerType;
  trigger_value: string | null;
  status: EventStatus;
  triggered_at: string | null;
  acknowledged_at: string | null;
  requires_approval: number;       // 0 or 1 (SQLite boolean)
  action_summary: string | null;
  action_data: string | null;      // JSON
  priority: TaskPriority;
  tags: string | null;             // JSON array
  recurrence: EventRecurrence | null;
}

// ─── Enum Types ─────────────────────────────────────────────────────────────

export type ChangeType =
  | "created"
  | "modified"
  | "deleted"
  | "refactored"
  | "renamed"
  | "moved"
  | "config_changed";

export type ImpactScope =
  | "local"       // Single file change
  | "module"      // Affects a module/package
  | "cross_module"// Affects multiple modules
  | "global";     // Architecture-level change

export type DecisionStatus =
  | "active"
  | "superseded"
  | "deprecated"
  | "experimental";

export type ArchLayer =
  | "ui"
  | "viewmodel"
  | "domain"
  | "data"
  | "network"
  | "database"
  | "di"
  | "util"
  | "test"
  | "config"
  | "build"
  | "other";

export type Complexity =
  | "trivial"
  | "simple"
  | "moderate"
  | "complex"
  | "critical";

export type ConventionCategory =
  | "naming"
  | "architecture"
  | "styling"
  | "testing"
  | "git"
  | "documentation"
  | "error_handling"
  | "performance"
  | "security"
  | "other";

export type TaskStatus =
  | "backlog"
  | "in_progress"
  | "blocked"
  | "review"
  | "done"
  | "cancelled";

export type TaskPriority =
  | "critical"
  | "high"
  | "medium"
  | "low";

export type AgentStatus =
  | "idle"
  | "working"
  | "done"
  | "stale";

export type EventTriggerType =
  | "next_session"
  | "datetime"
  | "task_complete"
  | "manual";

export type EventStatus =
  | "pending"
  | "triggered"
  | "acknowledged"
  | "executed"
  | "cancelled"
  | "snoozed";

export type EventRecurrence =
  | "once"
  | "every_session"
  | "daily"
  | "weekly";

// ─── Response Types ─────────────────────────────────────────────────────────

export interface SessionFocusInfo {
  query: string;
  decisions_returned: number;
  tasks_returned: number;
  changes_returned: number;
  note: string;
}

export interface SessionContext {
  session_id: number;
  previous_session: {
    id: number;
    summary: string | null;
    ended_at: string | null;
    agent: string;
  } | null;
  changes_since_last: {
    recorded: ChangeRow[];
    git_log: string;
  };
  active_decisions: DecisionRow[];
  active_conventions: ConventionRow[];
  open_tasks: TaskRow[];
  project_snapshot_age_minutes: number | null;
  focus?: SessionFocusInfo;       // Present when focus param was used
  message: string;
}

export interface ProjectSnapshot {
  project_root: string;
  file_tree: string[];
  total_files: number;
  file_notes: FileNoteRow[];
  recent_decisions: DecisionRow[];
  active_conventions: ConventionRow[];
  layer_distribution: Record<string, number>;
  generated_at: string;
}

export interface MemoryStats {
  total_sessions: number;
  total_changes: number;
  total_decisions: number;
  total_file_notes: number;
  total_conventions: number;
  total_tasks: number;
  total_milestones: number;
  oldest_session: string | null;
  newest_session: string | null;
  most_changed_files: Array<{ file_path: string; change_count: number }>;
  database_size_kb: number;
}

export interface CompactionResult {
  sessions_compacted: number;
  changes_summarized: number;
  storage_freed_kb: number;
}

export interface ConfigRow {
  key: string;
  value: string;
  updated_at: string;
}

export interface BackupInfo {
  path: string;
  size_kb: number;
  created_at: string;
  database_version: number;
}
