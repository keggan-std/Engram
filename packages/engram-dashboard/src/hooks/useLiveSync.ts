// ============================================================================
// Engram Dashboard — useLiveSync hook
// ============================================================================
// Mounts once in Shell. Listens to WS events and:
//   1. Invalidates the matching TanStack Query cache key(s)
//   2. Shows a toast for sessions-level events
// ============================================================================

import { useQueryClient } from "@tanstack/react-query";
import { useUiStore } from "../stores/ui.store.js";
import { useWebSocket } from "./useWebSocket.js";

// Map API resource names (from the URL path) → query cache key(s)
const RESOURCE_KEYS: Record<string, string[]> = {
  sessions:     ["sessions", "analytics-summary", "analytics-activity"],
  decisions:    ["decisions"],
  tasks:        ["tasks", "analytics-summary"],
  "file-notes": ["file-notes"],
  conventions:  ["conventions"],
  changes:      ["changes", "analytics-activity"],
  milestones:   ["milestones"],
  events:       ["events"],
  annotations:  ["audit"],
  audit:        ["audit"],
  settings:     ["config"],
  search:       [],
};

export function useLiveSync() {
  const qc = useQueryClient();
  const addToast = useUiStore(s => s.addToast);

  const { connected } = useWebSocket({
    onMessage(evt) {
      if (evt.type !== "mutated" || !evt.resource) return;

      // Invalidate relevant query cache keys
      const keys = RESOURCE_KEYS[evt.resource] ?? [evt.resource];
      keys.forEach(k => qc.invalidateQueries({ queryKey: [k] }));

      // Surface notable events as toasts
      if (evt.resource === "sessions" && evt.method === "POST") {
        addToast({ type: "info", title: "New session", message: "A session was started by an agent." });
      } else if (evt.resource === "tasks" && evt.method === "POST") {
        addToast({ type: "info", title: "Task created", message: "A new task was added." });
      }
    },
  });

  return { connected };
}
