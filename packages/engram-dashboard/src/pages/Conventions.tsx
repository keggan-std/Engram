import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { Convention } from "../api/types.js";
import EmptyState from "../components/EmptyState.js";

export default function Conventions() {
  const { data, isLoading, isError } = useQuery<Convention[]>({
    queryKey: ["conventions"],
    queryFn: () => api.get("/conventions?limit=200"),
  });

  if (isLoading) return <div className="page"><p className="loading-text">Loading…</p></div>;
  if (isError) return <div className="page"><p className="error-text">Failed to load conventions.</p></div>;

  const conventions = data ?? [];

  return (
    <div className="page">
      <h1 className="page-title">Conventions</h1>
      {conventions.length === 0 ? (
        <EmptyState title="No conventions" message="Record coding conventions via engram_memory record_convention." />
      ) : (
        <table className="data-table">
          <colgroup>
            <col />
            <col style={{ width: "12%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "8%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Rule</th>
              <th>Category</th>
              <th>Enforced</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {conventions.map(c => (
              <tr key={c.id}>
                <td className="cell-wrap">{c.rule}</td>
                <td className="text-faint">{c.category ?? "—"}</td>
                <td>{c.enforced ? "✓" : "—"}</td>
                <td className="text-faint text-mono">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
