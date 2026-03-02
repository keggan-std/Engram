// ============================================================================
// Engram Dashboard — API types matching the backend response shapes
// ============================================================================

export interface ApiOk<T> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  ok: false;
  error: string;
  message: string;
}

export interface PageMeta {
  total?: number;
  hasMore?: boolean;
  cursor?: string | null;
}

// ── Entity types ──────────────────────────────────────────────────────────────

export interface Session {
  id: number;
  agent_name: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  tags: string | null;
}

export interface Decision {
  id: number;
  decision: string;
  rationale: string | null;
  status: string;
  tags: string | null;
  timestamp: string;
  session_id: number | null;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  timestamp: string;
  session_id: number | null;
  blocked_by: string | null;
  assigned_files: string | null;
}

export interface FileNote {
  file_path: string;
  purpose: string | null;
  executive_summary: string | null;
  layer: string | null;
  complexity: string | null;
  notes: string | null;
  confidence?: string;
  updated_at?: string;
}

export interface Convention {
  id: number;
  category: string;
  rule: string;
  enforced: number;
  timestamp: string;
}

export interface Change {
  id: number;
  file_path: string;
  change_type: string;
  description: string;
  impact_scope: string;
  timestamp: string;
  session_id: number | null;
}

export interface Milestone {
  id: number;
  title: string;
  description: string | null;
  version: string | null;
  timestamp: string;
  achieved_at?: string | null;
}

export interface AnalyticsSummary {
  decisions: { total: number };
  tasks: { total: number; done: number; open: number; by_status: { status: string; count: number }[] };
  conventions: { total: number };
  file_notes: { total: number };
  sessions: { total: number };
  changes: { total: number };
}

export interface ActivityPoint {
  date: string;
  count: number;
}

export interface AuditEntry {
  id: number;
  action: string;
  actor: string | null;
  table_name: string;
  record_id: number | null;
  session_id: number | null;
  created_at: number;
}

export interface Annotation {
  id: number;
  target_table: string;
  target_id: number;
  note: string;
  author: string | null;
  created_at: number;
}
