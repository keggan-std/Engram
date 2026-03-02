import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client.js";
import EmptyState from "../components/EmptyState.js";

interface ConfigEntry { key: string; value: string; }

export default function Settings() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");

  const { data, isLoading, isError } = useQuery<ConfigEntry[]>({
    queryKey: ["config"],
    queryFn: () =>
      api.get<Record<string, string>>("/settings").then(obj =>
        Object.entries(obj as Record<string, string>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => ({ key, value }))
      ),
  });

  const save = useMutation({
    mutationFn: ({ key, value }: ConfigEntry) => api.put(`/settings/${encodeURIComponent(key)}`, { value }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["config"] }); setEditing(null); },
  });

  if (isLoading) return <div className="page"><p className="loading-text">Loading…</p></div>;
  if (isError) return <div className="page"><p className="error-text">Failed to load settings.</p></div>;

  const entries = data ?? [];

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>
      {entries.length === 0 ? (
        <EmptyState title="No settings" message="Config values will appear here once the server has started with a project." />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Value</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.key}>
                <td className="text-mono">{e.key}</td>
                <td>
                  {editing === e.key ? (
                    <input
                      className="inline-input"
                      value={editVal}
                      onChange={ev => setEditVal(ev.target.value)}
                      onKeyDown={ev => ev.key === "Enter" && save.mutate({ key: e.key, value: editVal })}
                      autoFocus
                    />
                  ) : (
                    <span className="text-faint">{e.value}</span>
                  )}
                </td>
                <td>
                  {editing === e.key ? (
                    <>
                      <button className="btn-sm" onClick={() => save.mutate({ key: e.key, value: editVal })}>Save</button>
                      <button className="btn-sm btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn-sm btn-ghost" onClick={() => { setEditing(e.key); setEditVal(e.value); }}>Edit</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
