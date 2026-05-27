import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StoreApi } from "zustand";
import { createProtocolSlice } from "./protocolSlice";
import type { RequestState } from "../storeTypes";
import { mockRequestState } from "../__test-utils__/mockRequestState";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { invoke } from "@tauri-apps/api/core";

/**
 * The protocol slice owns 7 well-defined actions. These tests don't
 * exercise the full Tauri wire path — that's covered by the Rust-side
 * `sse.rs` / `ws` unit tests and the e2e Playwright suite. They DO pin
 * the slice's shape and the most failure-prone branches: bailing out
 * when no active tab is focused, emitting WS messages in the right
 * direction, and updating `wsConnected` / `sseConnected` based on the
 * event kind.
 */

function makeStore(initialState: Partial<RequestState> = {}) {
  let state: RequestState = mockRequestState(initialState);
  const set: StoreApi<RequestState>["setState"] = (partial) => {
    const next =
      typeof partial === "function"
        ? (partial as (s: RequestState) => Partial<RequestState>)(state)
        : partial;
    state = { ...state, ...next };
  };
  const get: StoreApi<RequestState>["getState"] = () => state;
  return { set, get, getState: () => state };
}

describe("createProtocolSlice", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
  });

  it("exposes exactly the 7 protocol actions", () => {
    const { set, get } = makeStore();
    const slice = createProtocolSlice(set, get);
    expect(Object.keys(slice).sort()).toEqual([
      "appendSseEvent",
      "appendWsEvent",
      "sseClose",
      "sseConnect",
      "wsClose",
      "wsConnect",
      "wsSend",
    ]);
  });

  it("wsConnect bails out silently when no tab is active", async () => {
    const { set, get } = makeStore({ activeTabId: null });
    const slice = createProtocolSlice(set, get);
    await slice.wsConnect();
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("sseConnect bails out silently when no tab is active", async () => {
    const { set, get } = makeStore({ activeTabId: null });
    const slice = createProtocolSlice(set, get);
    await slice.sseConnect();
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("wsClose bails out silently when no tab is active", async () => {
    const { set, get } = makeStore({ activeTabId: null });
    const slice = createProtocolSlice(set, get);
    await slice.wsClose();
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  describe("appendWsEvent", () => {
    it("appends a 'received' message for kind=message", () => {
      const { set, get, getState } = makeStore();
      const slice = createProtocolSlice(set, get);
      slice.appendWsEvent("req1", "message", "hi");
      expect(getState().wsMessages.req1).toHaveLength(1);
      expect(getState().wsMessages.req1[0].direction).toBe("received");
      expect(getState().wsMessages.req1[0].text).toBe("hi");
    });

    it("appends a 'system' message and marks connected for kind=open", () => {
      const { set, get, getState } = makeStore();
      const slice = createProtocolSlice(set, get);
      slice.appendWsEvent("req1", "open");
      expect(getState().wsMessages.req1[0].direction).toBe("system");
      expect(getState().wsMessages.req1[0].text).toBe("(connected)");
      expect(getState().wsConnected.req1).toBe(true);
    });

    it("marks disconnected for kind=close and kind=error", () => {
      const { set, get, getState } = makeStore({
        wsConnected: { req1: true },
      });
      const slice = createProtocolSlice(set, get);
      slice.appendWsEvent("req1", "close");
      expect(getState().wsConnected.req1).toBe(false);
      slice.appendWsEvent("req1", "open");
      expect(getState().wsConnected.req1).toBe(true);
      slice.appendWsEvent("req1", "error");
      expect(getState().wsConnected.req1).toBe(false);
    });

    it("preserves the existing connected flag for unrelated event kinds", () => {
      const { set, get, getState } = makeStore({
        wsConnected: { req1: true },
      });
      const slice = createProtocolSlice(set, get);
      slice.appendWsEvent("req1", "message", "hi");
      // 'message' kind shouldn't touch wsConnected.
      expect(getState().wsConnected.req1).toBe(true);
    });
  });

  describe("appendSseEvent", () => {
    it("appends an event record with detail fields preserved", () => {
      const { set, get, getState } = makeStore();
      const slice = createProtocolSlice(set, get);
      slice.appendSseEvent("req1", "message", {
        event: "update",
        data: "payload",
        id: "42",
        retry: 3000,
      });
      expect(getState().sseEvents.req1).toHaveLength(1);
      const rec = getState().sseEvents.req1[0];
      expect(rec.event).toBe("update");
      expect(rec.data).toBe("payload");
      expect(rec.lastEventId).toBe("42");
      expect(rec.retry).toBe(3000);
    });

    it("marks connected=true on kind=open and false on kind=close/error", () => {
      const { set, get, getState } = makeStore();
      const slice = createProtocolSlice(set, get);
      slice.appendSseEvent("req1", "open", {});
      expect(getState().sseConnected.req1).toBe(true);
      slice.appendSseEvent("req1", "close", {});
      expect(getState().sseConnected.req1).toBe(false);
    });
  });
});
