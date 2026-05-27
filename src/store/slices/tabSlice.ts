/**
 * Slice owning everything that mutates the open-tabs list and the
 * active tab's request body. Split into two logical halves:
 *
 *   1. **Tab management** — `openTab`, `closeTab`, `setActiveTab`,
 *      `reorderTabs`, `cycleTab`, `duplicateActiveTab`,
 *      `setActiveRequest`, `updateActiveRequest`.
 *   2. **Field setters** — 21 one-liners (`setMethod`, `setUrl`,
 *      `setHeaders`, …) that all delegate to `updateActiveRequest`.
 *
 * All actions call `persistTabsState()` after mutating tab structure
 * so the workspace's `window_state.open_tabs` snapshot stays in sync
 * (debounced inside the workspace slice). Without this, keystroke-
 * driven edits in RequestPanel would only flush on a structural tab
 * action and a crash mid-edit would lose work.
 */

import { invoke } from "@tauri-apps/api/core";
import type { StoreApi } from "zustand";

import type { RequestItem } from "../../types";
import {
  createNewRequest,
  generateId,
  updateActiveTab,
} from "../storeHelpers";
import { syncDerived, type RequestState } from "../storeTypes";

/** Subset of `RequestState` exposed by this slice. */
export type TabSlice = Pick<
  RequestState,
  | "openTab"
  | "closeTab"
  | "setActiveTab"
  | "reorderTabs"
  | "cycleTab"
  | "duplicateActiveTab"
  | "setActiveRequest"
  | "updateActiveRequest"
  | "setMethod"
  | "setUrl"
  | "setHeaders"
  | "setParams"
  | "setBody"
  | "setBodyType"
  | "setFormData"
  | "setAuth"
  | "setName"
  | "setTimeoutMs"
  | "setVerifyTls"
  | "setRedirectPolicy"
  | "setMaxRedirects"
  | "setProxyUrl"
  | "setClientCert"
  | "setProtocol"
  | "setGraphqlQuery"
  | "setGraphqlVariables"
  | "setPreScript"
  | "setTestScript"
  | "setTags"
>;

export function createTabSlice(
  set: StoreApi<RequestState>["setState"],
  get: StoreApi<RequestState>["getState"],
): TabSlice {
  return {
    openTab: (request) => {
      const { tabs } = get();
      if (tabs.find((t) => t.id === request.id)) {
        set((s) => ({
          activeTabId: request.id,
          ...syncDerived({ ...s, activeTabId: request.id }),
        }));
        get().persistTabsState();
        return;
      }
      const next = [...tabs, request];
      set((s) => ({
        tabs: next,
        activeTabId: request.id,
        ...syncDerived({ ...s, tabs: next, activeTabId: request.id }),
      }));
      get().persistTabsState();
    },

    closeTab: (id) => {
      const state = get();
      const {
        tabs,
        activeTabId,
        responses,
        errors,
        loadings,
        wsConnected,
        wsMessages,
        testResults,
        scriptLogs,
        scriptError,
        responseHistory,
        sseConnected,
        sseEvents,
      } = state;
      // If a WebSocket is still open in this tab, close it on the backend
      if (wsConnected[id]) {
        invoke("ws_close", { requestId: id }).catch(() => {});
      }
      // Same for an open SSE stream
      if (sseConnected[id]) {
        invoke("sse_close", { requestId: id }).catch(() => {});
      }
      // If an HTTP request is still in flight, cancel it
      if (loadings[id]) {
        invoke("cancel_request", { requestId: id }).catch(() => {});
      }
      if (tabs.length === 1) {
        // Replace with a fresh new request rather than zero tabs. Reset every
        // per-request map so we don't keep stale entries (notably
        // responseHistory, which can hold large response bodies).
        const fresh = createNewRequest();
        set((s) => ({
          tabs: [fresh],
          activeTabId: fresh.id,
          responses: {},
          errors: {},
          loadings: {},
          testResults: {},
          scriptLogs: {},
          scriptError: {},
          responseHistory: {},
          wsConnected: {},
          wsMessages: {},
          sseConnected: {},
          sseEvents: {},
          ...syncDerived({
            ...s,
            tabs: [fresh],
            activeTabId: fresh.id,
            responses: {},
            errors: {},
            loadings: {},
          }),
        }));
        // Persist the fresh-tab state too — otherwise the workspace file
        // keeps the closed tab snapshot and the next launch restores it.
        get().persistTabsState();
        return;
      }
      const idx = tabs.findIndex((t) => t.id === id);
      const remaining = tabs.filter((t) => t.id !== id);
      let nextActive = activeTabId;
      if (activeTabId === id) {
        const fallback = remaining[Math.max(0, idx - 1)] ?? remaining[0];
        nextActive = fallback.id;
      }
      const respRest = { ...responses };
      delete respRest[id];
      const errRest = { ...errors };
      delete errRest[id];
      const loadRest = { ...loadings };
      delete loadRest[id];
      const wsConnRest = { ...wsConnected };
      delete wsConnRest[id];
      const wsMsgRest = { ...wsMessages };
      delete wsMsgRest[id];
      const testResultsRest = { ...testResults };
      delete testResultsRest[id];
      const scriptLogsRest = { ...scriptLogs };
      delete scriptLogsRest[id];
      const scriptErrorRest = { ...scriptError };
      delete scriptErrorRest[id];
      const responseHistoryRest = { ...responseHistory };
      delete responseHistoryRest[id];
      const sseConnRest = { ...sseConnected };
      delete sseConnRest[id];
      const sseEventsRest = { ...sseEvents };
      delete sseEventsRest[id];
      set((s) => ({
        tabs: remaining,
        activeTabId: nextActive,
        responses: respRest,
        errors: errRest,
        loadings: loadRest,
        wsConnected: wsConnRest,
        wsMessages: wsMsgRest,
        testResults: testResultsRest,
        scriptLogs: scriptLogsRest,
        scriptError: scriptErrorRest,
        responseHistory: responseHistoryRest,
        sseConnected: sseConnRest,
        sseEvents: sseEventsRest,
        ...syncDerived({
          ...s,
          tabs: remaining,
          activeTabId: nextActive,
          responses: respRest,
          errors: errRest,
          loadings: loadRest,
        }),
      }));
      get().persistTabsState();
    },

    setActiveTab: (id) => {
      set((s) => ({
        activeTabId: id,
        ...syncDerived({ ...s, activeTabId: id }),
      }));
      get().persistTabsState();
    },

    reorderTabs: (fromId, toId) => {
      const { tabs } = get();
      const from = tabs.findIndex((t) => t.id === fromId);
      const to = tabs.findIndex((t) => t.id === toId);
      if (from === -1 || to === -1 || from === to) return;
      const next = [...tabs];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      set({ tabs: next });
      get().persistTabsState();
    },

    cycleTab: (delta) => {
      const { tabs, activeTabId } = get();
      if (tabs.length === 0) return;
      const idx = activeTabId ? tabs.findIndex((t) => t.id === activeTabId) : -1;
      if (idx === -1) {
        get().setActiveTab(tabs[0].id);
        return;
      }
      const len = tabs.length;
      // Modulo arithmetic that handles negative deltas correctly.
      const nextIdx = (((idx + delta) % len) + len) % len;
      get().setActiveTab(tabs[nextIdx].id);
    },

    duplicateActiveTab: () => {
      const { tabs, activeTabId } = get();
      const active = tabs.find((t) => t.id === activeTabId);
      if (!active) return;
      const now = Date.now();
      const clone: RequestItem = {
        ...active,
        id: generateId(),
        name: `${active.name} (copy)`,
        createdAt: now,
        updatedAt: now,
        // Deep-copy mutable arrays so future edits to the clone don't bleed
        // back into the source tab through shared references.
        headers: active.headers.map((h) => ({ ...h })),
        params: active.params.map((p) => ({ ...p })),
        formData: active.formData.map((f) => ({ ...f })),
      };
      get().openTab(clone);
    },

    setActiveRequest: (request) => {
      get().openTab(request);
    },

    updateActiveRequest: (partial) => {
      set((s) => ({
        ...updateActiveTab(s, partial),
        ...syncDerived({ ...s, ...updateActiveTab(s, partial) } as RequestState),
      }));
      get().persistTabsState();
    },

    // === Field setters ===
    //
    // All individual setters delegate to `updateActiveRequest` so the
    // workspace persistence layer fires for every keystroke-driven
    // change.
    setMethod: (method) => get().updateActiveRequest({ method }),
    setUrl: (url) => get().updateActiveRequest({ url }),
    setHeaders: (headers) => get().updateActiveRequest({ headers }),
    setParams: (params) => get().updateActiveRequest({ params }),
    setBody: (body) => get().updateActiveRequest({ body }),
    setBodyType: (bodyType) => get().updateActiveRequest({ bodyType }),
    setFormData: (formData) => get().updateActiveRequest({ formData }),
    setAuth: (auth) => get().updateActiveRequest({ auth }),
    setName: (name) => get().updateActiveRequest({ name }),
    setTimeoutMs: (timeoutMs) => get().updateActiveRequest({ timeoutMs }),
    setVerifyTls: (verifyTls) => get().updateActiveRequest({ verifyTls }),
    setRedirectPolicy: (redirectPolicy) =>
      get().updateActiveRequest({ redirectPolicy }),
    setMaxRedirects: (maxRedirects) =>
      get().updateActiveRequest({ maxRedirects }),
    setProxyUrl: (proxyUrl) => get().updateActiveRequest({ proxyUrl }),
    setClientCert: (clientCert) => get().updateActiveRequest({ clientCert }),
    setProtocol: (protocol) => get().updateActiveRequest({ protocol }),
    setGraphqlQuery: (graphqlQuery) =>
      get().updateActiveRequest({ graphqlQuery }),
    setGraphqlVariables: (graphqlVariables) =>
      get().updateActiveRequest({ graphqlVariables }),
    setPreScript: (preScript) => get().updateActiveRequest({ preScript }),
    setTestScript: (testScript) => get().updateActiveRequest({ testScript }),
    setTags: (tags) => get().updateActiveRequest({ tags }),
  };
}
