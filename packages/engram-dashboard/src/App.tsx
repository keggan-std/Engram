import { useState } from "react";
import { useAuthStore } from "./stores/auth.store.js";
import Shell from "./layouts/Shell.js";
import Dashboard from "./pages/Dashboard.js";
import Sessions from "./pages/Sessions.js";
import Decisions from "./pages/Decisions.js";
import Tasks from "./pages/Tasks.js";
import FileNotes from "./pages/FileNotes.js";
import Conventions from "./pages/Conventions.js";
import Changes from "./pages/Changes.js";
import Milestones from "./pages/Milestones.js";
import Events from "./pages/Events.js";
import Audit from "./pages/Audit.js";
import Settings from "./pages/Settings.js";

export type Page =
  | "dashboard"
  | "sessions"
  | "decisions"
  | "tasks"
  | "file-notes"
  | "conventions"
  | "changes"
  | "milestones"
  | "events"
  | "audit"
  | "settings";

const PAGE_COMPONENTS: Record<Page, React.ComponentType> = {
  dashboard:    Dashboard,
  sessions:     Sessions,
  decisions:    Decisions,
  tasks:        Tasks,
  "file-notes": FileNotes,
  conventions:  Conventions,
  changes:      Changes,
  milestones:   Milestones,
  events:       Events,
  audit:        Audit,
  settings:     Settings,
};

export default function App() {
  const isAuthed = useAuthStore(s => s.isAuthed);
  const [page, setPage] = useState<Page>("dashboard");

  if (!isAuthed) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 16 }}>
        <h2 style={{ color: "var(--accent)" }}>Engram Dashboard</h2>
        <p style={{ color: "var(--text-muted)" }}>
          Start with: <code style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>engram --mode=http</code>
        </p>
        <p style={{ color: "var(--text-faint)", fontSize: 12 }}>No token found. Open this page via the URL provided by the CLI.</p>
      </div>
    );
  }

  const PageComponent = PAGE_COMPONENTS[page];

  return (
    <Shell currentPage={page} onNavigate={setPage}>
      <PageComponent />
    </Shell>
  );
}
