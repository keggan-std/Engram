import type { Page } from "../App.js";
import Sidebar from "./Sidebar.js";
import TopBar from "./TopBar.js";

interface ShellProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  children: React.ReactNode;
}

export default function Shell({ currentPage, onNavigate, children }: ShellProps) {
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopBar currentPage={currentPage} />
        <main style={{
          flex: 1,
          overflow: "auto",
          padding: "var(--space-6)",
        }}>
          {children}
        </main>
      </div>
    </div>
  );
}
