import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { Change } from "../api/types.js";
import EmptyState from "../components/EmptyState.js";
import { useUiStore } from "../stores/ui.store.js";

const CHANGE_COLORS: Record<string, string> = {
  created: "badge-high",
  modified: "badge-medium",
  deleted: "badge-blocked",
  refactored: "badge-in-progress",
  renamed: "badge-medium",
  moved: "badge-medium",
  config_changed: "badge-low",
};

export default function Changes() {
  const { data, isLoading, isError } = useQuery<{ data: Change[] }>({
    queryKey: ["changes"],
    queryFn: () => api.get("/changes?limit=200"),
  });
  const { selectEntity, selected } = useUiStore();

  if (isLoading) return <div className="page"><p className="loading-text">Loading…</p></div>;
  if (isError) return <div className="page"><p className="error-text">Failed to load changes.</p></div>;

  const changes = data?.data ?? [];

  return (
    <div className="page">
      <h1 className="page-title">Changes</h1>
      {changes.length === 0 ? (
        <EmptyState title="No changes recorded" message="Changes are recorded via engram_memory record_change." />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Type</th>
              <th>Scope</th>
              <th>Description</th>
              <th>Session</th>
            </tr>
          </thead>
          <tbody>
            {changes.map(c => (
              <tr
                key={c.id}
                onClick={() => selectEntity({ type: "change", data: c as unknown as Record<string, unknown> })}
                className={selected?.data?.id === c.id ? "row-selected" : "row-clickable"}
              >
                <td className="text-mono" style={{ maxWidth: 220 }}>{c.file_path}</td>
                <td>
                  <span className={`badge ${CHANGE_COLORS[c.change_type] ?? "badge-low"}`}>
                    {c.change_type}
                  </span>
                </td>
                <td className="text-faint">{c.impact_scope}</td>
                <td className="text-wrap">{c.description}</td>
                <td className="text-faint">{c.session_id ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
