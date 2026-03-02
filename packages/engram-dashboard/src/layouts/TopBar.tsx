import type { Page } from "../App.js";

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

interface Props { currentPage: Page; }

export default function TopBar({ currentPage }: Props) {
  return (
    <header style={{
      height: "var(--topbar-height)",
      background: "var(--bg-surface)",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      padding: "0 var(--space-6)",
      gap: "var(--space-4)",
      flexShrink: 0,
    }}>
      <h1 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
        {PAGE_LABELS[currentPage]}
      </h1>
      <div style={{ flex: 1 }} />
      <div style={{
        padding: "5px 12px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        fontSize: 12,
        color: "var(--text-faint)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        cursor: "default",
      }}>
        <span style={{ fontSize: 10 }}>🔴</span>
        <span>127.0.0.1:7432</span>
      </div>
    </header>
  );
}
