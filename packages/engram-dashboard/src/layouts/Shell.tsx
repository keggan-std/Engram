import { useEffect } from "react";
import type { Page } from "../App.js";
import Sidebar from "./Sidebar.js";
import TopBar from "./TopBar.js";
import CommandPalette from "../components/CommandPalette.js";
import DetailPanel from "../components/DetailPanel.js";
import ToastStack from "../components/Toast.js";
import { useUiStore } from "../stores/ui.store.js";
import { useLiveSync } from "../hooks/useLiveSync.js";

interface ShellProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  children: React.ReactNode;
}

export default function Shell({ currentPage, onNavigate, children }: ShellProps) {
  const { selected, selectEntity } = useUiStore();
  const { connected } = useLiveSync();

  // Escape: close detail panel
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && selected) selectEntity(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, selectEntity]);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", position: "relative" }}>
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopBar currentPage={currentPage} onNavigate={onNavigate} wsConnected={connected} />
        <main style={{
          flex: 1,
          overflow: "auto",
          padding: "var(--space-6)",
        }}>
          {children}
        </main>
      </div>

      {/* Slide-in detail panel (sits in document flow on the right) */}
      <DetailPanel />

      {/* Cmd+K command palette (portal/dialog) */}
      <CommandPalette onNavigate={onNavigate} />

      {/* Toast notification stack */}
      <ToastStack />
    </div>
  );
}
