import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { AuditEntry } from "../api/types.js";
import EmptyState from "../components/EmptyState.js";

export default function Audit() {
  const [tableFilter, setTableFilter] = useState("");
  const { data, isLoading, isError } = useQuery<AuditEntry[]>({
    queryKey: ["audit"],
    queryFn: () => api.get("/audit?limit=200"),
  });

  if (isLoading) return <div className="page"><p className="loading-text">Loading…</p></div>;
  if (isError) return <div className="page"><p className="error-text">Failed to load audit log.</p></div>;

  const entries = (data ?? []).filter(e =>
    !tableFilter || e.table_name.toLowerCase().includes(tableFilter.toLowerCase())
  );

  return (
    <div className="page">
      <h1 className="page-title">Audit Log</h1>
      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Filter by table…"
          value={tableFilter}
          onChange={e => setTableFilter(e.target.value)}
        />
      </div>
      {entries.length === 0 ? (
        <EmptyState title="No audit entries" message="Audit entries are recorded automatically by write operations." />
      ) : (
        <table className="data-table">
          <colgroup>
            <col style={{ width: "15%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "8%" }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>Time</th>
              <th>Table</th>
              <th>Action</th>
              <th>Record ID</th>
              <th>Agent</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id}>
                <td className="text-faint text-mono cell-clip">{typeof e.created_at === 'number' ? new Date(e.created_at * 1000).toLocaleString() : new Date(e.created_at).toLocaleString()}</td>
                <td className="text-mono cell-clip">{e.table_name}</td>
                <td><span className={`badge ${e.action === "DELETE" ? "badge-blocked" : e.action === "INSERT" ? "badge-high" : "badge-medium"}`}>{e.action}</span></td>
                <td className="text-faint">{e.record_id ?? "—"}</td>
                <td className="text-faint">{e.actor ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
