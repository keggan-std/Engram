import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { AnalyticsSummary, ActivityPoint } from "../api/types.js";
import type { Page } from "../App.js";
import ActivityChart from "../components/ActivityChart.js";

// ── Stat Card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number | string;
  page?: Page;
  onNavigate?: (page: Page) => void;
}

function StatCard({ label, value, page, onNavigate }: StatCardProps) {
  const clickable = !!(page && onNavigate);
  return (
    <div
      className={`stat-card${clickable ? " stat-card-link" : ""}`}
      onClick={clickable ? () => onNavigate!(page!) : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavigate!(page!); }
      } : undefined}
    >
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}{clickable && <span className="stat-arrow">→</span>}</div>
    </div>
  );
}

// ── Instance types ────────────────────────────────────────────────────────────

interface InstanceStats {
  sessions: number; decisions: number; file_notes: number;
  tasks: number; conventions: number; changes: number; db_size_kb: number;
}
interface InstanceInfo {
  instance_id: string; label: string; project_root: string; db_path: string;
  schema_version: number; server_version: string; sharing_mode: string;
  sharing_types: string[];
  stats: InstanceStats; last_heartbeat: string;
  status: "active" | "stopped"; pid: number | null;
}
interface InstanceRegistry {
  machine_id: string; last_updated: string;
  instances: Record<string, InstanceInfo>;
}

// ── Instance Card ─────────────────────────────────────────────────────────────

function InstanceCard({ inst, isCurrent }: { inst: InstanceInfo; isCurrent: boolean }) {
  const [open, setOpen] = useState(false);

  const ageMins = inst.last_heartbeat
    ? Math.floor((Date.now() - new Date(inst.last_heartbeat).getTime()) / 60000)
    : null;
  const heartbeat =
    ageMins === null ? "" :
    ageMins < 2      ? " · just now" :
    ageMins < 60     ? ` · ${ageMins}m ago` : " · offline";

  const parts = inst.project_root.replace(/\\/g, "/").split("/");
  const rootShort = parts.slice(-2).join("/");
  const shortId = inst.instance_id.slice(0, 8) + "…";
  const dbShort = inst.db_path?.replace(/\\/g, "/").replace(/.*\/(.engram\/.*)/, "…/$1") ?? "—";

  return (
    <div
      className={`instance-card${isCurrent ? " instance-current" : ""}`}
      onClick={() => setOpen(o => !o)}
      role="button"
      aria-expanded={open}
    >
      <div className="instance-card-header">
        <span className="instance-label-text">{inst.label}</span>
        <span className={`badge ${inst.status === "active" ? "badge-active" : "badge-superseded"}`}>
          {inst.status}
        </span>
        {isCurrent && <span className="badge badge-in-progress">current</span>}
        <span className={`instance-chevron${open ? " open" : ""}`}>▼</span>
      </div>
      <div className="instance-root" title={inst.project_root}>…/{rootShort}</div>
      <div className="instance-stats">
        <span><b>{inst.stats.sessions}</b> sessions</span>
        <span><b>{inst.stats.decisions}</b> decisions</span>
        <span><b>{inst.stats.tasks}</b> tasks</span>
        <span><b>{inst.stats.file_notes}</b> notes</span>
        <span><b>{inst.stats.changes}</b> changes</span>
      </div>
      <div className="instance-meta">
        v{inst.server_version} · schema {inst.schema_version} · {inst.stats.db_size_kb} KB{heartbeat}
      </div>

      {/* Expandable detail */}
      <div className={`instance-expand-body${open ? " open" : ""}`} onClick={e => e.stopPropagation()}>
        <div className="instance-expand-grid">
          <span className="instance-kv-key">Instance ID</span>
          <span className="instance-kv-val" title={inst.instance_id}>{shortId}</span>

          <span className="instance-kv-key">PID</span>
          <span className="instance-kv-val">{inst.pid ?? "stopped"}</span>

          <span className="instance-kv-key">Sharing</span>
          <span className="instance-kv-val">{inst.sharing_mode}</span>

          <span className="instance-kv-key">Shared types</span>
          <span className="instance-kv-val">
            {Array.isArray(inst.sharing_types) && inst.sharing_types.length
              ? inst.sharing_types.join(", ")
              : "none"}
          </span>

          <span className="instance-kv-key instance-kv-full">DB path</span>
          <span className="instance-kv-val instance-kv-full" title={inst.db_path}>{dbShort}</span>

          <span className="instance-kv-key instance-kv-full">Project root</span>
          <span className="instance-kv-val instance-kv-full" title={inst.project_root}>
            {inst.project_root.replace(/\\/g, "/")}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard page ────────────────────────────────────────────────────────────

export default function Dashboard({ onNavigate }: { onNavigate?: (page: Page) => void }) {
  const summary = useQuery<AnalyticsSummary>({
    queryKey: ["analytics-summary"],
    queryFn: () => api.get("/analytics/summary"),
  });
  const activity = useQuery<ActivityPoint[]>({
    queryKey: ["analytics-activity"],
    queryFn: () => api.get("/analytics/activity?days=30"),
  });
  const instances = useQuery<InstanceRegistry>({
    queryKey: ["instances"],
    queryFn: () => api.get("/instances"),
    refetchInterval: 30_000,
  });
  const currentId = useQuery<string | null>({
    queryKey: ["current-instance-id"],
    queryFn: () => api.get<Record<string, string>>("/settings").then(s => s["instance_id"] ?? null),
    staleTime: Infinity,
  });

  const s = summary.data;
  const instList = instances.data
    ? Object.values(instances.data.instances).sort((a, b) => {
        if (a.status !== b.status) return a.status === "active" ? -1 : 1;
        if (a.instance_id === currentId.data) return -1;
        if (b.instance_id === currentId.data) return 1;
        return a.label.localeCompare(b.label);
      })
    : [];

  return (
    <div className="page">
      <h1 className="page-title">Dashboard</h1>

      {summary.isLoading ? (
        <p className="loading-text">Loading…</p>
      ) : summary.isError ? (
        <p className="error-text">Failed to load summary.</p>
      ) : s ? (
        <>
          <div className="stat-grid">
            <StatCard label="Sessions"    value={s.sessions.total}    page="sessions"    onNavigate={onNavigate} />
            <StatCard label="Decisions"   value={s.decisions.total}   page="decisions"   onNavigate={onNavigate} />
            <StatCard label="Open Tasks"  value={s.tasks.open}        page="tasks"       onNavigate={onNavigate} />
            <StatCard label="Conventions" value={s.conventions.total} page="conventions" onNavigate={onNavigate} />
            <StatCard label="File Notes"  value={s.file_notes.total}  page="file-notes"  onNavigate={onNavigate} />
            <StatCard label="Changes"     value={s.changes.total}     page="changes"     onNavigate={onNavigate} />
          </div>
          <section className="chart-section">
            <h2 className="section-title">Activity — last 30 days</h2>
            {activity.data ? (
              <ActivityChart data={activity.data} />
            ) : (
              <p className="loading-text">Loading chart…</p>
            )}
          </section>
        </>
      ) : null}

      {/* Instances section */}
      {instList.length > 0 && (
        <section style={{ marginTop: "var(--space-8)" }}>
          <h2 className="section-title" style={{ marginBottom: "var(--space-4)" }}>
            Engram instances on this machine
          </h2>
          <div className="instance-grid">
            {instList.map(inst => (
              <InstanceCard
                key={inst.instance_id}
                inst={inst}
                isCurrent={inst.instance_id === currentId.data}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
