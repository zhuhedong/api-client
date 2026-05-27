/**
 * Slice owning the two streaming protocol implementations (WebSocket +
 * Server-Sent Events) that the sidebar's "WebSocket" / "SSE" protocol
 * toggles delegate to.
 *
 * Each action follows the same recipe:
 *
 *   1. Read the active tab from `get()`. Bail out silently if there
 *      isn't one — the UI shouldn't be able to trigger a protocol
 *      action without a focused tab, but defending against it costs
 *      nothing.
 *   2. Run variable substitution against the full workspace -> collection
 *      -> folder -> environment -> request scope hierarchy so the
 *      `{{var}}` syntax in URL/header fields resolves the same way as
 *      it does in the HTTP pipeline.
 *   3. `invoke()` the matching Tauri command (`ws_connect`, `ws_send`,
 *      `ws_close`, `sse_connect`, `sse_close`) and surface failures as
 *      structured `RequestError`s on `state.errors[reqId]` so the
 *      response panel can render its localized error UI.
 *
 * The append-event actions (`appendWsEvent`, `appendSseEvent`) are
 * called by the Tauri-side listeners we wire up in `App.tsx`. They run
 * on every received frame so they're written to be cheap (no
 * `get()` reads, only `set()`).
 */

import { invoke } from "@tauri-apps/api/core";
import type { StoreApi } from "zustand";

import type { SseEventRecord, WsMessage } from "../../types";
import { buildScopedVars } from "../../utils/variableScope";
import { substituteAll } from "../../utils/dynamicVars";
import { toRequestError } from "../../utils/requestError";
import { generateId } from "../storeHelpers";
import { activeTab, syncDerived, type RequestState } from "../storeTypes";

/** Subset of `RequestState` exposed by this slice. */
export type ProtocolSlice = Pick<
  RequestState,
  | "wsConnect"
  | "wsSend"
  | "wsClose"
  | "appendWsEvent"
  | "sseConnect"
  | "sseClose"
  | "appendSseEvent"
>;

export function createProtocolSlice(
  set: StoreApi<RequestState>["setState"],
  get: StoreApi<RequestState>["getState"],
): ProtocolSlice {
  return {
    // === WebSocket ===

    wsConnect: async () => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      const reqId = req.id;

      // Variable substitution honors the full scope hierarchy.
      const envVars = buildScopedVars({
        workspace: state.workspace,
        collections: state.collections,
        environments: state.environments,
        request: req,
      });
      const sub = (str: string) => substituteAll(str, (key) => envVars[key]);

      try {
        set((s) => ({
          wsMessages: { ...s.wsMessages, [reqId]: [] },
          errors: { ...s.errors, [reqId]: null },
          ...syncDerived({ ...s, errors: { ...s.errors, [reqId]: null } }),
        }));
        await invoke("ws_connect", {
          payload: {
            url: sub(req.url),
            headers: req.headers
              .filter((h) => h.enabled && h.key)
              .map((h) => ({
                key: sub(h.key),
                value: sub(h.value),
                enabled: true,
                is_file: false,
                file_path: null,
              })),
            request_id: reqId,
          },
        });
      } catch (err) {
        const structured = toRequestError(err);
        set((s) => ({
          errors: { ...s.errors, [reqId]: structured },
          ...syncDerived({ ...s, errors: { ...s.errors, [reqId]: structured } }),
        }));
      }
    },

    wsSend: async (text) => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      try {
        await invoke("ws_send", { requestId: req.id, text });
        set((s) => ({
          wsMessages: {
            ...s.wsMessages,
            [req.id]: [
              ...(s.wsMessages[req.id] || []),
              {
                id: generateId(),
                direction: "sent",
                text,
                ts: Date.now(),
              } as WsMessage,
            ],
          },
        }));
      } catch (err) {
        const structured = toRequestError(err);
        set((s) => ({
          errors: { ...s.errors, [req.id]: structured },
          ...syncDerived({ ...s, errors: { ...s.errors, [req.id]: structured } }),
        }));
      }
    },

    wsClose: async () => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      try {
        await invoke("ws_close", { requestId: req.id });
      } catch {
        // Closing a socket that's already gone is fine; we don't want
        // to surface that as an error to the user.
      }
    },

    appendWsEvent: (requestId, kind, text) => {
      set((s) => {
        const list = s.wsMessages[requestId] || [];
        const msg: WsMessage = {
          id: generateId(),
          direction: kind === "message" ? "received" : "system",
          text:
            text ||
            (kind === "open"
              ? "(connected)"
              : kind === "close"
                ? "(closed)"
                : kind === "error"
                  ? "(error)"
                  : kind),
          ts: Date.now(),
        };
        return {
          wsMessages: { ...s.wsMessages, [requestId]: [...list, msg] },
          wsConnected: {
            ...s.wsConnected,
            [requestId]:
              kind === "open"
                ? true
                : kind === "close" || kind === "error"
                  ? false
                  : !!s.wsConnected[requestId],
          },
        };
      });
    },

    // === Server-Sent Events ===

    sseConnect: async () => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      const reqId = req.id;

      // Variable substitution honors the full scope hierarchy. SSE has no
      // request body so there's nothing else to substitute beyond URL/headers.
      const envVars = buildScopedVars({
        workspace: state.workspace,
        collections: state.collections,
        environments: state.environments,
        request: req,
      });
      const sub = (str: string) => substituteAll(str, (key) => envVars[key]);

      try {
        set((s) => ({
          sseEvents: { ...s.sseEvents, [reqId]: [] },
          errors: { ...s.errors, [reqId]: null },
          ...syncDerived({ ...s, errors: { ...s.errors, [reqId]: null } }),
        }));
        await invoke("sse_connect", {
          payload: {
            url: sub(req.url),
            headers: req.headers
              .filter((h) => h.enabled && h.key)
              .map((h) => ({
                key: sub(h.key),
                value: sub(h.value),
                enabled: true,
                is_file: false,
                file_path: null,
              })),
            request_id: reqId,
            verify_tls: req.verifyTls,
            timeout_ms: req.timeoutMs ?? state.defaultTimeoutMs,
          },
        });
      } catch (err) {
        const structured = toRequestError(err);
        set((s) => ({
          errors: { ...s.errors, [reqId]: structured },
          ...syncDerived({ ...s, errors: { ...s.errors, [reqId]: structured } }),
        }));
      }
    },

    sseClose: async () => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      try {
        await invoke("sse_close", { requestId: req.id });
      } catch {
        // Closing a stream that's already gone is fine; we don't want
        // to surface that as an error to the user.
      }
    },

    appendSseEvent: (requestId, kind, detail) => {
      set((s) => {
        const list = s.sseEvents[requestId] || [];
        const next: SseEventRecord = {
          id: generateId(),
          ts: Date.now(),
          kind: kind as SseEventRecord["kind"],
          event: detail.event,
          data: detail.data,
          lastEventId: detail.id,
          retry: detail.retry,
          error: detail.error,
        };
        const connectedNext =
          kind === "open"
            ? true
            : kind === "close" || kind === "error"
              ? false
              : !!s.sseConnected[requestId];
        return {
          sseEvents: { ...s.sseEvents, [requestId]: [...list, next] },
          sseConnected: { ...s.sseConnected, [requestId]: connectedNext },
        };
      });
    },
  };
}
