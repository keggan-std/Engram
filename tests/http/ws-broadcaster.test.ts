// ============================================================================
// WsBroadcaster — Unit Tests
// ============================================================================
// Tests the WsBroadcaster singleton class in isolation.
// No real WebSocket connections are opened — clients are simulated with
// plain objects that match the readyState / send interface.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { broadcaster } from "../../src/ws-broadcaster.js";
import type { WsEvent } from "../../src/ws-broadcaster.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClient(readyState = 1, sendFn = vi.fn()) {
  return { readyState, send: sendFn };
}

function makeWss(clients: ReturnType<typeof makeClient>[] = []) {
  return {
    clients: new Set(clients),
  } as any;
}

// ─── Reset broadcaster between tests ──────────────────────────────────────────

beforeEach(() => {
  broadcaster.detach();
});

// ─────────────────────────────────────────────────────────────────────────────
// attach / detach / clientCount
// ─────────────────────────────────────────────────────────────────────────────

describe("WsBroadcaster.attach / detach / clientCount", () => {
  it("clientCount is 0 when not attached", () => {
    expect(broadcaster.clientCount).toBe(0);
  });

  it("clientCount reflects wss.clients.size after attach", () => {
    const wss = makeWss([makeClient(), makeClient()]);
    broadcaster.attach(wss);
    expect(broadcaster.clientCount).toBe(2);
  });

  it("clientCount returns 0 after detach", () => {
    const wss = makeWss([makeClient()]);
    broadcaster.attach(wss);
    broadcaster.detach();
    expect(broadcaster.clientCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// broadcast — no wss attached
// ─────────────────────────────────────────────────────────────────────────────

describe("WsBroadcaster.broadcast (detached)", () => {
  it("does nothing when not attached", () => {
    // Should not throw
    expect(() =>
      broadcaster.broadcast({ type: "mutated", resource: "tasks", method: "POST", ts: 1 })
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// broadcast — delivers to OPEN clients
// ─────────────────────────────────────────────────────────────────────────────

describe("WsBroadcaster.broadcast (attached)", () => {
  it("sends JSON to all OPEN clients (readyState === 1)", () => {
    const send1 = vi.fn();
    const send2 = vi.fn();
    broadcaster.attach(makeWss([makeClient(1, send1), makeClient(1, send2)]));

    const event: WsEvent = { type: "mutated", resource: "sessions", method: "POST", ts: 1000 };
    broadcaster.broadcast(event);

    expect(send1).toHaveBeenCalledOnce();
    expect(send2).toHaveBeenCalledOnce();
    expect(JSON.parse(send1.mock.calls[0][0])).toEqual(event);
  });

  it("skips clients that are not OPEN (readyState !== 1)", () => {
    const sendOpen = vi.fn();
    const sendClosed = vi.fn();
    // readyState 0=CONNECTING, 2=CLOSING, 3=CLOSED
    broadcaster.attach(makeWss([
      makeClient(1, sendOpen),
      makeClient(0, sendClosed),
      makeClient(2, sendClosed),
      makeClient(3, sendClosed),
    ]));

    broadcaster.broadcast({ type: "mutated", resource: "tasks", method: "DELETE", ts: 2 });

    expect(sendOpen).toHaveBeenCalledOnce();
    expect(sendClosed).not.toHaveBeenCalled();
  });

  it("silently ignores send() errors", () => {
    const throwingSend = vi.fn().mockImplementation(() => { throw new Error("socket gone"); });
    broadcaster.attach(makeWss([makeClient(1, throwingSend)]));

    expect(() =>
      broadcaster.broadcast({ type: "connected", ts: 3 })
    ).not.toThrow();
  });

  it("broadcasts correct JSON for every field combination", () => {
    const send = vi.fn();
    broadcaster.attach(makeWss([makeClient(1, send)]));

    broadcaster.broadcast({ type: "connected", ts: 999 });
    const parsed = JSON.parse(send.mock.calls[0][0]);
    expect(parsed.type).toBe("connected");
    expect(parsed.ts).toBe(999);
    expect(parsed.resource).toBeUndefined();
  });

  it("sends to zero clients without error when set is empty", () => {
    broadcaster.attach(makeWss([]));
    expect(() =>
      broadcaster.broadcast({ type: "mutated", resource: "changes", method: "POST", ts: 5 })
    ).not.toThrow();
  });
});
