// ============================================================================
// Engram Dashboard — useWebSocket hook
// ============================================================================
// Connects to ws://host/ws?token=TOKEN and auto-reconnects with exponential
// backoff (max 30 s). Calls onMessage for every parsed JSON frame.
// ============================================================================

import { useEffect, useRef, useCallback, useState } from "react";
import { getToken } from "../api/client.js";

export interface WsEvent {
  type: string;
  resource?: string;
  method?: string;
  ts: number;
}

interface UseWebSocketOptions {
  onMessage: (evt: WsEvent) => void;
}

export function useWebSocket({ onMessage }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const onMessageRef = useRef(onMessage);
  const [connected, setConnected] = useState(false);

  // Keep ref up-to-date without re-triggering the effect
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    const token = getToken() ?? "";
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const url = `${proto}://${host}/ws?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      retriesRef.current = 0;
      setConnected(true);
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string) as WsEvent;
        onMessageRef.current(data);
      } catch {
        /* ignore malformed frames */
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Exponential back-off: 1s, 2s, 4s, …, capped at 30s
      const delay = Math.min(1_000 * 2 ** retriesRef.current, 30_000);
      retriesRef.current += 1;
      setTimeout(connect, delay);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      // Prevent reconnect on unmount
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected };
}
