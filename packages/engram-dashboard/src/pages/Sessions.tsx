import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { Session } from "../api/types.js";
import EmptyState from "../components/EmptyState.js";
import { useUiStore } from "../stores/ui.store.js";

export default function Sessions() {
  const { data, isLoading, isError } = useQuery<{ data: Session[] }>({
    queryKey: ["sessions"],
    queryFn: () => api.get("/sessions?limit=100"),
  });
  const { selectEntity, selected } = useUiStore();

  if (isLoading) return <div className="page"><p className="loading-text">Loading…</p></div>;
  if (isError) return <div className="page"><p className="error-text">Failed to load sessions.</p></div>;

  const sessions = data?.data ?? [];

  return (
    <div className="page">
      <h1 className="page-title">Sessions</h1>
      {sessions.length === 0 ? (
        <EmptyState title="No sessions yet" message="Sessions are recorded automatically when an agent calls session start." />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Started</th>
              <th>Ended</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => (
              <tr
                key={s.id}
                onClick={() => selectEntity({ type: "session", data: s as unknown as Record<string, unknown> })}
                className={selected?.data?.id === s.id ? "row-selected" : "row-clickable"}
              >
                <td className="text-mono">{s.agent_name}</td>
                <td className="text-faint">{new Date(s.started_at).toLocaleString()}</td>
                <td className="text-faint">{s.ended_at ? new Date(s.ended_at).toLocaleString() : "—"}</td>
                <td className="text-wrap">{s.summary ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
