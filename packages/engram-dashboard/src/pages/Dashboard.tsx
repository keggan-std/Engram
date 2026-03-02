import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { AnalyticsSummary, ActivityPoint } from "../api/types.js";
import ActivityChart from "../components/ActivityChart.js";

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const summary = useQuery<AnalyticsSummary>({
    queryKey: ["analytics-summary"],
    queryFn: () => api.get("/analytics/summary"),
  });
  const activity = useQuery<{ data: ActivityPoint[] } | ActivityPoint[]>({
    queryKey: ["analytics-activity"],
    queryFn: () => api.get("/analytics/activity?days=30"),
  });

  const s = summary.data;

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
            <StatCard label="Sessions" value={s.sessions.total} />
            <StatCard label="Decisions" value={s.decisions.total} />
            <StatCard label="Open Tasks" value={s.tasks.open} />
            <StatCard label="Conventions" value={s.conventions.total} />
            <StatCard label="File Notes" value={s.file_notes.total} />
            <StatCard label="Changes" value={s.changes.total} />
          </div>
          <section className="chart-section">
            <h2 className="section-title">Activity — last 30 days</h2>
            {activity.data ? (
              <ActivityChart data={Array.isArray(activity.data) ? activity.data : (activity.data as { data: ActivityPoint[] }).data} />
            ) : (
              <p className="loading-text">Loading chart…</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
