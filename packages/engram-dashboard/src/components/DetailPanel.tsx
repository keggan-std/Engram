// ============================================================================
// Engram Dashboard — Detail Panel (slide-in from right)
// ============================================================================
// Renders entity details when a row is clicked. 420px, slides from right.
// ============================================================================

import { useUiStore } from "../stores/ui.store.js";
import type { SelectedEntity } from "../stores/ui.store.js";
import StatusBadge from "./StatusBadge.js";

// ─── Close button ─────────────────────────────────────────────────────────────

function CloseBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="detail-close" aria-label="Close panel">
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <line x1={18} y1={6} x2={6} y2={18} /><line x1={6} y1={6} x2={18} y2={18} />
      </svg>
    </button>
  );
}

// ─── Label + value row ────────────────────────────────────────────────────────

function Field({ label, value, mono = false }: { label: string; value: unknown; mono?: boolean }) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  return (
    <div className="detail-field">
      <div className="detail-field-label">{label}</div>
      <div className={`detail-field-value${mono ? " text-mono" : ""}`}>{text}</div>
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: "1px solid var(--border)", margin: "12px 0" }} />;
}

// ─── Entity-specific renderers ────────────────────────────────────────────────

function DecisionDetail({ data }: { data: Record<string, unknown> }) {
  return (
    <>
      <div className="detail-title">{String(data.decision ?? "")}</div>
      <div className="detail-meta">
        <StatusBadge status={String(data.status ?? "active")} />
        {!!data.timestamp && (
        <span className="text-faint" style={{ fontSize: 12 }}>
          {new Date(String(data.timestamp)).toLocaleString()}
        </span>
      )}
      </div>
      <Divider />
      <Field label="Rationale" value={data.rationale} />
      <Field label="Tags" value={data.tags} />
      {!!data.supersedes_id && <Field label="Supersedes ID" value={data.supersedes_id} />}
      <Field label="Session" value={data.session_id ? `#${data.session_id}` : null} />
      <Field label="ID" value={`decision-${data.id}`} mono />
    </>
  );
}

function TaskDetail({ data }: { data: Record<string, unknown> }) {
  return (
    <>
      <div className="detail-title">{String(data.title ?? "")}</div>
      <div className="detail-meta">
        <StatusBadge status={String(data.priority ?? "medium")} />
        <StatusBadge status={String(data.status ?? "not-started")} />
      </div>
      <Divider />
      <Field label="Description" value={data.description} />
      <Field label="Assigned files" value={data.assigned_files} mono />
      <Field label="Blocked by" value={data.blocked_by} />
      <Field label="Session" value={data.session_id ? `#${data.session_id}` : null} />
      {!!data.timestamp && (
        <Field label="Created" value={new Date(String(data.timestamp)).toLocaleString()} />
      )}
      <Field label="ID" value={`task-${data.id}`} mono />
    </>
  );
}

function SessionDetail({ data }: { data: Record<string, unknown> }) {
  const duration = data.started_at && data.ended_at
    ? Math.round((new Date(String(data.ended_at)).getTime() - new Date(String(data.started_at)).getTime()) / 60000)
    : null;
  return (
    <>
      <div className="detail-title">Session #{String(data.id)}</div>
      <div className="detail-meta">
        <span className="text-mono" style={{ fontSize: 12 }}>{String(data.agent_name ?? "")}</span>
        {duration !== null && (
          <span className="text-faint" style={{ fontSize: 12 }}>{duration}m</span>
        )}
      </div>
      <Divider />
      {!!data.started_at && (
        <Field label="Started" value={new Date(String(data.started_at)).toLocaleString()} />
      )}
      {!!data.ended_at && (
        <Field label="Ended" value={new Date(String(data.ended_at)).toLocaleString()} />
      )}
      <Field label="Summary" value={data.summary} />
      <Field label="Tags" value={data.tags} />
      <Field label="ID" value={`session-${data.id}`} mono />
    </>
  );
}

function FileNoteDetail({ data }: { data: Record<string, unknown> }) {
  return (
    <>
      <div className="detail-title text-mono" style={{ fontSize: 13 }}>
        {String(data.file_path ?? "")}
      </div>
      <div className="detail-meta">
        {!!data.confidence && <StatusBadge status={String(data.confidence)} />}
        {!!data.layer && (
          <span className="text-faint" style={{ fontSize: 12 }}>{String(data.layer)}</span>
        )}
      </div>
      <Divider />
      <Field label="Purpose" value={data.purpose} />
      <Field label="Summary" value={data.executive_summary} />
      <Field label="Complexity" value={data.complexity} />
      <Field label="Notes" value={data.notes} />
    </>
  );
}

function ConventionDetail({ data }: { data: Record<string, unknown> }) {
  return (
    <>
      <div className="detail-title">{String(data.rule ?? "")}</div>
      <div className="detail-meta">
        <span className="text-faint" style={{ fontSize: 12 }}>{String(data.category ?? "")}</span>
        <StatusBadge status={data.enforced ? "active" : "archived"} />
      </div>
      <Divider />
      {!!data.timestamp && (
        <Field label="Added" value={new Date(String(data.timestamp)).toLocaleString()} />
      )}
      <Field label="ID" value={`convention-${data.id}`} mono />
    </>
  );
}

function ChangeDetail({ data }: { data: Record<string, unknown> }) {
  return (
    <>
      <div className="detail-title text-mono" style={{ fontSize: 13 }}>
        {String(data.file_path ?? "")}
      </div>
      <div className="detail-meta">
        <StatusBadge status={String(data.change_type ?? "")} />
        <span className="text-faint" style={{ fontSize: 12 }}>{String(data.impact_scope ?? "")}</span>
      </div>
      <Divider />
      <Field label="Description" value={data.description} />
      <Field label="Session" value={data.session_id ? `#${data.session_id}` : null} />
      {!!data.timestamp && (
        <Field label="When" value={new Date(String(data.timestamp)).toLocaleString()} />
      )}
      <Field label="ID" value={`change-${data.id}`} mono />
    </>
  );
}

// ─── Entity type label ────────────────────────────────────────────────────────

const TYPE_LABELS: Record<SelectedEntity["type"], string> = {
  decision:    "Decision",
  task:        "Task",
  session:     "Session",
  "file-note": "File Note",
  convention:  "Convention",
  change:      "Change",
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function DetailPanel() {
  const { selected, selectEntity } = useUiStore();

  // Keyboard: Escape closes the panel
  // (handled in Shell, but also here as fallback)

  if (!selected) return null;

  function renderBody() {
    if (!selected) return null;
    const { type, data } = selected;
    switch (type) {
      case "decision":    return <DecisionDetail   data={data} />;
      case "task":        return <TaskDetail        data={data} />;
      case "session":     return <SessionDetail     data={data} />;
      case "file-note":   return <FileNoteDetail    data={data} />;
      case "convention":  return <ConventionDetail  data={data} />;
      case "change":      return <ChangeDetail      data={data} />;
      default:            return null;
    }
  }

  return (
    <>
      {/* Backdrop for small screens */}
      <div className="detail-backdrop" onClick={() => selectEntity(null)} />

      <aside className="detail-panel">
        {/* Header */}
        <div className="detail-header">
          <span className="detail-type-label">{TYPE_LABELS[selected.type]}</span>
          <CloseBtn onClick={() => selectEntity(null)} />
        </div>

        {/* Body */}
        <div className="detail-body">{renderBody()}</div>

        {/* Copy link action */}
        <div className="detail-footer">
          <button
            className="detail-action-btn"
            onClick={() => {
              const id = selected.data.id ?? selected.data.file_path ?? "";
              navigator.clipboard.writeText(`${selected.type}:${id}`);
            }}
          >
            Copy ref
          </button>
        </div>
      </aside>
    </>
  );
}
