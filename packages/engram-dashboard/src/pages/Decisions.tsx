import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { Decision } from "../api/types.js";
import StatusBadge from "../components/StatusBadge.js";
import EmptyState from "../components/EmptyState.js";

export default function Decisions() {
  const { data, isLoading, isError } = useQuery<{ data: Decision[] }>({
    queryKey: ["decisions"],
    queryFn: () => api.get("/decisions?limit=200"),
  });

  if (isLoading) return <div className="page"><p className="loading-text">Loading…</p></div>;
  if (isError) return <div className="page"><p className="error-text">Failed to load decisions.</p></div>;

  const decisions = data?.data ?? [];

  return (
    <div className="page">
      <h1 className="page-title">Decisions</h1>
      {decisions.length === 0 ? (
        <EmptyState title="No decisions recorded" message="Record architectural decisions via engram_memory record_decision." />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Decision</th>
              <th>Status</th>
              <th>Tags</th>
              <th>Rationale</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map(d => (
              <tr key={d.id}>
                <td className="text-wrap">{d.decision}</td>
                <td><StatusBadge status={d.status} /></td>
                <td className="text-faint">{d.tags ?? "—"}</td>
                <td className="text-wrap text-faint">{d.rationale ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
