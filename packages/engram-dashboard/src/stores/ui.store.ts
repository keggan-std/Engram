// ============================================================================
// Engram Dashboard — UI State Store
// ============================================================================
// Manages: theme, command palette visibility, selected entity (detail panel),
// and toast notifications.
// ============================================================================

import { create } from "zustand";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Theme = "dark" | "light";

export type ToastType = "info" | "success" | "warning" | "error";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

export interface SelectedEntity {
  type: "decision" | "task" | "session" | "file-note" | "convention" | "change";
  data: Record<string, unknown>;
}

interface UiState {
  // Theme
  theme: Theme;
  toggleTheme: () => void;

  // Command palette
  cmdPaletteOpen: boolean;
  openCmdPalette: () => void;
  closeCmdPalette: () => void;

  // Detail panel
  selected: SelectedEntity | null;
  selectEntity: (entity: SelectedEntity | null) => void;

  // Toasts
  toasts: Toast[];
  addToast: (t: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const THEME_KEY = "engram-theme";

function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY) as Theme | null;
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* storage unavailable */ }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useUiStore = create<UiState>((set, get) => ({
  // Theme — init from localStorage / system preference
  theme: (() => {
    const t = getInitialTheme();
    applyTheme(t);
    return t;
  })(),

  toggleTheme() {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    applyTheme(next);
    set({ theme: next });
  },

  // Command palette
  cmdPaletteOpen: false,
  openCmdPalette: () => set({ cmdPaletteOpen: true }),
  closeCmdPalette: () => set({ cmdPaletteOpen: false }),

  // Detail panel
  selected: null,
  selectEntity: (entity) => set({ selected: entity }),

  // Toasts
  toasts: [],
  addToast(t) {
    const id = Math.random().toString(36).slice(2, 9);
    set(s => ({ toasts: [...s.toasts, { ...t, id }] }));
    // Auto-dismiss after 4s
    setTimeout(() => get().removeToast(id), 4000);
  },
  removeToast(id) {
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
  },
}));
