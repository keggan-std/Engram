import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { Task } from "../api/types.js";
import StatusBadge from "../components/StatusBadge.js";
import EmptyState from "../components/EmptyState.js";
import { useUiStore } from "../stores/ui.store.js";

export default function Tasks() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<Task[]>({
    queryKey: ["tasks"],
    queryFn: () => api.get("/tasks?limit=200"),
  });
  const { selectEntity, selected } = useUiStore();

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.put(`/tasks/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  if (isLoading) return <div className="page"><p className="loading-text">Loading…</p></div>;
  if (isError) return <div className="page"><p className="error-text">Failed to load tasks.</p></div>;

  const tasks = data ?? [];
  const statuses = ["not-started", "in-progress", "done", "blocked", "cancelled"];

  return (
    <div className="page">
      <h1 className="page-title">Tasks</h1>
      {tasks.length === 0 ? (
        <EmptyState title="No tasks" message="Create tasks via engram_memory create_task." />
      ) : (
        <table className="data-table">
          <colgroup>
            <col style={{ width: "28%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "14%" }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>Title</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map(t => (
              <tr
                key={t.id}
                onClick={() => selectEntity({ type: "task", data: t as unknown as Record<string, unknown> })}
                className={selected?.data?.id === t.id ? "row-selected" : "row-clickable"}
              >
                <td className="cell-wrap">{t.title}</td>
                <td><StatusBadge status={t.priority} /></td>
                <td onClick={e => e.stopPropagation()}>
                  <select
                    className="inline-select"
                    value={t.status}
                    onChange={e => updateStatus.mutate({ id: t.id, status: e.target.value })}
                  >
                    {statuses.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="text-faint cell-wrap">{t.description ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
