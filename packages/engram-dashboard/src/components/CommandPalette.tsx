// ============================================================================
// Engram Dashboard — Command Palette (Cmd+K / Ctrl+K)
// ============================================================================
// Powered by cmdk. Groups: Navigate, Actions.
// ============================================================================

import { useEffect, useCallback } from "react";
import { Command } from "cmdk";
import { useUiStore } from "../stores/ui.store.js";
import type { Page } from "../App.js";

// ─── Icons (inline SVG to avoid extra deps) ───────────────────────────────────

function Icon({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const ICONS: Record<string, string> = {
  dashboard:    "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  sessions:     "M12 2a10 10 0 100 20A10 10 0 0012 2zm0 6v6l4 2",
  decisions:    "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
  tasks:        "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
  "file-notes": "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6",
  conventions:  "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  changes:      "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7 M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z",
  milestones:   "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  events:       "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z",
  audit:        "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  settings:     "M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z",
};

const NAV_PAGES: { id: Page; label: string }[] = [
  { id: "dashboard",    label: "Dashboard"        },
  { id: "sessions",     label: "Sessions"          },
  { id: "decisions",    label: "Decisions"         },
  { id: "tasks",        label: "Tasks"             },
  { id: "file-notes",   label: "File Notes"        },
  { id: "conventions",  label: "Conventions"       },
  { id: "changes",      label: "Changes"           },
  { id: "milestones",   label: "Milestones"        },
  { id: "events",       label: "Scheduled Events"  },
  { id: "audit",        label: "Audit Log"         },
  { id: "settings",     label: "Settings"          },
];

interface Props {
  onNavigate: (page: Page) => void;
}

export default function CommandPalette({ onNavigate }: Props) {
  const { cmdPaletteOpen, openCmdPalette, closeCmdPalette, toggleTheme, theme } = useUiStore();

  // Global keyboard shortcut: Cmd+K / Ctrl+K
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      cmdPaletteOpen ? closeCmdPalette() : openCmdPalette();
    }
  }, [cmdPaletteOpen, openCmdPalette, closeCmdPalette]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  function select(page: Page) {
    onNavigate(page);
    closeCmdPalette();
  }

  return (
    <Command.Dialog
      open={cmdPaletteOpen}
      onOpenChange={(v) => v ? openCmdPalette() : closeCmdPalette()}
      label="Global command palette"
      className="cmd-overlay"
    >
      <div className="cmd-wrapper">
        <div className="cmd-input-row">
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-faint)", flexShrink: 0 }}>
            <circle cx={11} cy={11} r={8} /><line x1={21} y1={21} x2={16.65} y2={16.65} />
          </svg>
          <Command.Input
            className="cmd-input"
            placeholder="Search memory, jump to page, run action…"
            autoFocus
          />
          <kbd className="cmd-kbd">esc</kbd>
        </div>

        <Command.List className="cmd-list">
          <Command.Empty className="cmd-empty">No results.</Command.Empty>

          <Command.Group heading="Navigate" className="cmd-group">
            {NAV_PAGES.map(p => (
              <Command.Item
                key={p.id}
                value={p.label}
                onSelect={() => select(p.id)}
                className="cmd-item"
              >
                <span className="cmd-item-icon">
                  <Icon d={ICONS[p.id] ?? ICONS.dashboard} />
                </span>
                <span className="cmd-item-label">{p.label}</span>
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Separator className="cmd-separator" />

          <Command.Group heading="Actions" className="cmd-group">
            <Command.Item
              value="Toggle theme dark light"
              onSelect={() => { toggleTheme(); closeCmdPalette(); }}
              className="cmd-item"
            >
              <span className="cmd-item-icon">
                <Icon d={theme === "dark"
                  ? "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
                  : "M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42M12 8a4 4 0 100 8 4 4 0 000-8z"
                } />
              </span>
              <span className="cmd-item-label">
                Switch to {theme === "dark" ? "light" : "dark"} mode
              </span>
            </Command.Item>

            <Command.Item
              value="Go to settings"
              onSelect={() => select("settings")}
              className="cmd-item"
            >
              <span className="cmd-item-icon">
                <Icon d={ICONS.settings} size={13} />
              </span>
              <span className="cmd-item-label">Open settings</span>
            </Command.Item>
          </Command.Group>
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
