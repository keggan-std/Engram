import type { Page } from "../App.js";

interface NavItem {
  id: Page;
  label: string;
  icon: string;
}

const NAV: NavItem[] = [
  { id: "dashboard",    label: "Dashboard",    icon: "⬡" },
  { id: "sessions",     label: "Sessions",     icon: "◎" },
  { id: "decisions",    label: "Decisions",    icon: "◈" },
  { id: "tasks",        label: "Tasks",        icon: "◻" },
  { id: "file-notes",   label: "File Notes",   icon: "◧" },
  { id: "conventions",  label: "Conventions",  icon: "◦" },
  { id: "changes",      label: "Changes",      icon: "◪" },
  { id: "milestones",   label: "Milestones",   icon: "◬" },
  { id: "events",       label: "Events",       icon: "◉" },
  { id: "audit",        label: "Audit Log",    icon: "◐" },
  { id: "settings",     label: "Settings",     icon: "⚙" },
];

interface Props {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export default function Sidebar({ currentPage, onNavigate }: Props) {
  return (
    <aside style={{
      width: "var(--sidebar-width)",
      background: "var(--bg-surface)",
      borderRight: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{
        height: "var(--topbar-height)",
        display: "flex",
        alignItems: "center",
        padding: "0 var(--space-4)",
        borderBottom: "1px solid var(--border)",
      }}>
        <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: 15, letterSpacing: "0.02em" }}>
          ◈ Engram
        </span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "var(--space-3) var(--space-2)", overflow: "auto" }}>
        {NAV.map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              padding: "7px var(--space-3)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              textAlign: "left",
              fontSize: 13,
              fontFamily: "var(--font-sans)",
              background: currentPage === item.id ? "var(--accent-dim)" : "transparent",
              color: currentPage === item.id ? "var(--accent)" : "var(--text-muted)",
              transition: "background 0.1s, color 0.1s",
            }}
            onMouseEnter={e => {
              if (currentPage !== item.id) {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-hover)";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)";
              }
            }}
            onMouseLeave={e => {
              if (currentPage !== item.id) {
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)";
              }
            }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div style={{
        padding: "var(--space-3) var(--space-4)",
        borderTop: "1px solid var(--border)",
        fontSize: 11,
        color: "var(--text-faint)",
      }}>
        Engram v1.9.0
      </div>
    </aside>
  );
}
