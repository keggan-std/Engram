import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { Decision } from "../api/types.js";
import StatusBadge from "../components/StatusBadge.js";
import EmptyState from "../components/EmptyState.js";
import { useUiStore } from "../stores/ui.store.js";

export default function Decisions() {
  const { data, isLoading, isError } = useQuery<Decision[]>({
    queryKey: ["decisions"],
    queryFn: () => api.get("/decisions?limit=200"),
  });
  const { selectEntity, selected } = useUiStore();

  if (isLoading) return <div className="page"><p className="loading-text">Loading…</p></div>;
  if (isError) return <div className="page"><p className="error-text">Failed to load decisions.</p></div>;

  const decisions = data ?? [];

  return (
    <div className="page">
      <h1 className="page-title">Decisions</h1>
      {decisions.length === 0 ? (
        <EmptyState title="No decisions recorded" message="Record architectural decisions via engram_memory record_decision." />
      ) : (
        <table className="data-table">
          <colgroup>
            <col style={{ width: "32%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "15%" }} />
            <col />
          </colgroup>
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
              <tr
                key={d.id}
                onClick={() => selectEntity({ type: "decision", data: d as unknown as Record<string, unknown> })}
                className={selected?.data?.id === d.id ? "row-selected" : "row-clickable"}
              >
                <td className="cell-wrap">{d.decision}</td>
                <td><StatusBadge status={d.status} /></td>
                <td className="text-faint cell-clip">{d.tags ?? "—"}</td>
                <td className="text-faint cell-wrap">{d.rationale ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
