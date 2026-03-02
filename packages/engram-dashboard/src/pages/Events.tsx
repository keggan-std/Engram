import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import StatusBadge from "../components/StatusBadge.js";
import EmptyState from "../components/EmptyState.js";

interface EngramEvent {
  id: number;
  name: string;
  description?: string;
  trigger_type: string;
  status: string;
  scheduled_for?: string;
  last_triggered_at?: string;
}

export default function Events() {
  const { data, isLoading, isError } = useQuery<{ data: EngramEvent[] }>({
    queryKey: ["events"],
    queryFn: () => api.get("/events?limit=200"),
  });

  if (isLoading) return <div className="page"><p className="loading-text">Loading…</p></div>;
  if (isError) return <div className="page"><p className="error-text">Failed to load events.</p></div>;

  const events = data?.data ?? [];

  return (
    <div className="page">
      <h1 className="page-title">Events</h1>
      {events.length === 0 ? (
        <EmptyState title="No events" message="Schedule events via engram_memory schedule_event." />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Trigger</th>
              <th>Status</th>
              <th>Scheduled For</th>
              <th>Last Triggered</th>
            </tr>
          </thead>
          <tbody>
            {events.map(e => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td className="text-faint">{e.trigger_type}</td>
                <td><StatusBadge status={e.status} /></td>
                <td className="text-faint">
                  {e.scheduled_for ? new Date(e.scheduled_for).toLocaleString() : "—"}
                </td>
                <td className="text-faint">
                  {e.last_triggered_at ? new Date(e.last_triggered_at).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
