import type { Page } from "../App.js";
import { useUiStore } from "../stores/ui.store.js";

const PAGE_LABELS: Record<Page, string> = {
  dashboard:    "Dashboard",
  sessions:     "Sessions",
  decisions:    "Decisions",
  tasks:        "Tasks",
  "file-notes": "File Notes",
  conventions:  "Conventions",
  changes:      "Changes",
  milestones:   "Milestones",
  events:       "Scheduled Events",
  audit:        "Audit Log",
  settings:     "Settings",
};

interface Props {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  wsConnected?: boolean;
}

export default function TopBar({ currentPage, wsConnected = false }: Props) {
  const { theme, toggleTheme, openCmdPalette } = useUiStore();
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

  return (
    <header style={{
      height: "var(--topbar-height)",
      background: "var(--bg-surface)",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      padding: "0 var(--space-6)",
      gap: "var(--space-3)",
      flexShrink: 0,
    }}>
      <h1 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
        {PAGE_LABELS[currentPage]}
      </h1>

      <div style={{ flex: 1 }} />

      {/* Search / Cmd+K trigger */}
      <button
        onClick={openCmdPalette}
        className="topbar-search-btn"
        aria-label="Open command palette"
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx={11} cy={11} r={8} /><line x1={21} y1={21} x2={16.65} y2={16.65} />
        </svg>
        <span style={{ flex: 1, textAlign: "left" }}>Search…</span>
        <kbd style={{ fontSize: 10, opacity: 0.5 }}>{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="topbar-icon-btn"
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      >
        {theme === "dark" ? (
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx={12} cy={12} r={5} />
            <line x1={12} y1={1} x2={12} y2={3} />
            <line x1={12} y1={21} x2={12} y2={23} />
            <line x1={4.22} y1={4.22} x2={5.64} y2={5.64} />
            <line x1={18.36} y1={18.36} x2={19.78} y2={19.78} />
            <line x1={1} y1={12} x2={3} y2={12} />
            <line x1={21} y1={12} x2={23} y2={12} />
            <line x1={4.22} y1={19.78} x2={5.64} y2={18.36} />
            <line x1={18.36} y1={5.64} x2={19.78} y2={4.22} />
          </svg>
        ) : (
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
          </svg>
        )}
      </button>

      {/* Connection badge — green when WS live, amber when reconnecting */}
      <div
        className="topbar-badge"
        title={wsConnected ? "Live: WebSocket connected" : "Connecting to live updates…"}
      >
        <span style={{ color: wsConnected ? "var(--success)" : "var(--warning)", fontSize: 8, transition: "color 0.3s" }}>●</span>
        <span>{wsConnected ? "Live" : "Connecting…"}</span>
      </div>
    </header>
  );
}
