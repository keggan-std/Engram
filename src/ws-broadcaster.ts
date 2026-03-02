// ============================================================================
// Engram — WebSocket Broadcaster
// ============================================================================
// Module-level singleton. Attached to a WebSocketServer instance in
// index.ts (HTTP mode). Route files import `broadcaster` and call
// broadcast() after successful mutations.
// The mutation middleware in http-server.ts does this automatically.
// ============================================================================

import type { WebSocketServer } from "ws";

export type WsEventType = "mutated" | "connected";

export interface WsEvent {
  type: WsEventType;
  resource?: string;
  method?: string;
  ts: number;
}

class WsBroadcaster {
  private wss: WebSocketServer | null = null;

  attach(wss: WebSocketServer): void {
    this.wss = wss;
    console.error("[Engram WS] broadcaster attached");
  }

  detach(): void {
    this.wss = null;
  }

  broadcast(event: WsEvent): void {
    if (!this.wss) return;
    const msg = JSON.stringify(event);
    this.wss.clients.forEach(client => {
      // WS OPEN === 1
      if ((client as any).readyState === 1) {
        try {
          (client as any).send(msg);
        } catch {
          /* ignore closed sockets */
        }
      }
    });
  }

  get clientCount(): number {
    return this.wss?.clients.size ?? 0;
  }
}

export const broadcaster = new WsBroadcaster();
