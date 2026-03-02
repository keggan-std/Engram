import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { Milestone } from "../api/types.js";
import EmptyState from "../components/EmptyState.js";

export default function Milestones() {
  const { data, isLoading, isError } = useQuery<Milestone[]>({
    queryKey: ["milestones"],
    queryFn: () => api.get("/milestones?limit=100"),
  });

  if (isLoading) return <div className="page"><p className="loading-text">Loading…</p></div>;
  if (isError) return <div className="page"><p className="error-text">Failed to load milestones.</p></div>;

  const milestones = data ?? [];

  return (
    <div className="page">
      <h1 className="page-title">Milestones</h1>
      {milestones.length === 0 ? (
        <EmptyState title="No milestones" message='Record milestones via engram_memory({ action: "record_milestone" }).' />
      ) : (
        <div className="card-grid">
          {milestones.map(m => (
            <div key={m.id} className="card">
              <div className="card-header">
                <span className="card-title">{m.title}</span>
                {m.version && <span className="badge badge-low">{m.version}</span>}
              </div>
              {m.description && <p className="card-body">{m.description}</p>}
              <div className="card-footer text-faint">
                {m.achieved_at ? `Achieved ${new Date(m.achieved_at).toLocaleDateString()}` : "Pending"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
