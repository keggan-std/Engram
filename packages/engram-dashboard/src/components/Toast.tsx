// ============================================================================
// Engram Dashboard — Toast Notifications
// ============================================================================
// Bottom-right stack, auto-dismissed after 4s.
// ============================================================================

import { useUiStore } from "../stores/ui.store.js";
import type { Toast as ToastItem } from "../stores/ui.store.js";

const TOAST_COLORS: Record<ToastItem["type"], string> = {
  info:    "var(--info)",
  success: "var(--success)",
  warning: "var(--warning)",
  error:   "var(--danger)",
};

const TOAST_ICONS: Record<ToastItem["type"], string> = {
  info:    "ℹ",
  success: "✓",
  warning: "⚠",
  error:   "✕",
};

function ToastItem({ toast, onRemove }: { toast: ToastItem; onRemove: () => void }) {
  const color = TOAST_COLORS[toast.type];
  return (
    <div className="toast" role="alert">
      <div className="toast-bar" style={{ background: color }} />
      <div className="toast-icon" style={{ color }}>
        {TOAST_ICONS[toast.type]}
      </div>
      <div className="toast-content">
        <div className="toast-title">{toast.title}</div>
        {toast.message && (
          <div className="toast-message">{toast.message}</div>
        )}
      </div>
      <button className="toast-dismiss" onClick={onRemove} aria-label="Dismiss">
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
          <line x1={18} y1={6} x2={6} y2={18} /><line x1={6} y1={6} x2={18} y2={18} />
        </svg>
      </button>
    </div>
  );
}

export default function ToastStack() {
  const { toasts, removeToast } = useUiStore();
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
      {toasts.slice(-3).map(t => (
        <ToastItem key={t.id} toast={t} onRemove={() => removeToast(t.id)} />
      ))}
    </div>
  );
}
