import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { FileNote } from "../api/types.js";
import EmptyState from "../components/EmptyState.js";

export default function FileNotes() {
  const [search, setSearch] = useState("");
  const { data, isLoading, isError } = useQuery<{ data: FileNote[] }>({
    queryKey: ["file-notes"],
    queryFn: () => api.get("/file-notes?limit=500"),
  });

  if (isLoading) return <div className="page"><p className="loading-text">Loading…</p></div>;
  if (isError) return <div className="page"><p className="error-text">Failed to load file notes.</p></div>;

  const notes = (data?.data ?? []).filter(n =>
    !search || n.file_path.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page">
      <h1 className="page-title">File Notes</h1>
      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Filter by path…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      {notes.length === 0 ? (
        <EmptyState title="No file notes" message="File notes are added via engram_memory get_file_notes / set_file_notes." />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Purpose</th>
              <th>Summary</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {notes.map(n => (
              <tr key={n.file_path}>
                <td className="text-mono">{n.file_path}</td>
                <td>{n.purpose ?? "—"}</td>
                <td className="text-wrap text-faint">{n.executive_summary ?? "—"}</td>
                <td><span className={`badge badge-${n.confidence ?? 'medium'}`}>{n.confidence ?? '—'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
