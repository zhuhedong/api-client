import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  ResponseData,
  Collection,
  CollectionRequest,
  HistoryEntry,
  Environment,
  Workspace,
  AuthConfig,
  RecentEntry,
} from "../types";
import { activeTab, syncDerived, type RequestState } from "./storeTypes";
import { makeRequestError, toRequestError } from "../utils/requestError";
import {
  executeRequestWithScripts,
  pipelineDefaultsFrom,
} from "../utils/requestPipeline";
import { buildScopedVars } from "../utils/variableScope";
import {
  DEFAULT_MAX_HISTORY_BODY_BYTES,
  historyEntryToResponse,
} from "../utils/historySnapshot";
import { refreshOAuth2Token, updateFolderAuth } from "../utils/oauth2Refresh";
import {
  createNewRequest,
  findRequestInCollection,
  generateId,
  historyEntryToRequest,
  updateActiveTab,
} from "./storeHelpers";
import { createCollectionsSlice } from "./slices/collectionsSlice";
import { createCookiesSlice } from "./slices/cookiesSlice";
import { createEnvironmentsSlice } from "./slices/environmentsSlice";
import { createHistorySlice } from "./slices/historySlice";
import { createProtocolSlice } from "./slices/protocolSlice";
import { createRecentSlice } from "./slices/recentSlice";
import { createSettingsSlice } from "./slices/settingsSlice";
import { createTabSlice } from "./slices/tabSlice";
import { createWorkspaceSlice } from "./slices/workspaceSlice";

// `RequestState`, `activeTab`, and `syncDerived` live in
// `./storeTypes.ts` so slice modules in `./slices/*.ts` can reference
// them without creating a circular import (store → slice → store).

export const useRequestStore = create<RequestState>((set, get) => {
  const initialReq = createNewRequest();
  return {
    collections: [],
    environments: [],
    workspace: null,
    workspaces: [],
    history: [],
    initialized: false,

    tabs: [initialReq],
    activeTabId: initialReq.id,
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

    cookies: [],
    defaultTimeoutMs: 30000,
    verifyTlsDefault: true,
    maxBodyBytes: 10 * 1024 * 1024,
    maxHistoryBodyBytes: DEFAULT_MAX_HISTORY_BODY_BYTES,
    defaultRedirectPolicy: "follow",
    defaultMaxRedirects: 10,
    defaultProxyUrl: "",
    historyResponses: {},
    recentItems: [],

    activeRequest: initialReq,
    activeRequestId: initialReq.id,
    response: null,
    loading: false,
    error: null,

    initialize: async () => {
      try {
        const workspace = await invoke<Workspace>("load_default_workspace");
        // One-shot legacy migration: stamp every pre-multi-workspace artifact
        // with the default workspace id so it appears in exactly one workspace.
        try {
          await invoke<number>("migrate_legacy_to_workspace", { workspaceId: workspace.id });
        } catch (err) {
          console.warn("Legacy workspace migration skipped:", err);
        }
        const workspaces = await invoke<Workspace[]>("list_workspaces");
        const wsId = workspace.id;
        const historyEntries = await invoke<HistoryEntry[]>("get_history", {
          workspaceId: wsId,
          limit: 50,
          offset: 0,
        });
        const history = historyEntries.map(historyEntryToRequest);
        const collections = await invoke<Collection[]>("list_collections", { workspaceId: wsId });
        const environments = await invoke<Environment[]>("list_environments", { workspaceId: wsId });

        let defaultTimeoutMs = 30000;
        try {
          const stored = await invoke<string | null>("get_setting", { key: "default_timeout_ms" });
          if (stored) {
            const v = parseInt(stored, 10);
            if (Number.isFinite(v) && v > 0) defaultTimeoutMs = v;
          }
        } catch {}

        let verifyTlsDefault = true;
        try {
          const stored = await invoke<string | null>("get_setting", { key: "verify_tls_default" });
          if (stored === "false") verifyTlsDefault = false;
        } catch {}

        let maxBodyBytes = 10 * 1024 * 1024;
        try {
          const stored = await invoke<string | null>("get_setting", { key: "max_body_bytes" });
          if (stored) {
            const v = parseInt(stored, 10);
            if (Number.isFinite(v) && v > 0) maxBodyBytes = v;
          }
        } catch {}

        let maxHistoryBodyBytes = DEFAULT_MAX_HISTORY_BODY_BYTES;
        try {
          const stored = await invoke<string | null>("get_setting", { key: "max_history_body_bytes" });
          if (stored) {
            const v = parseInt(stored, 10);
            if (Number.isFinite(v) && v >= 0) maxHistoryBodyBytes = v;
          }
        } catch {}

        let defaultRedirectPolicy: "follow" | "none" | "manual" = "follow";
        try {
          const stored = await invoke<string | null>("get_setting", { key: "default_redirect_policy" });
          if (stored === "follow" || stored === "none" || stored === "manual") {
            defaultRedirectPolicy = stored;
          }
        } catch {}

        let defaultMaxRedirects = 10;
        try {
          const stored = await invoke<string | null>("get_setting", { key: "default_max_redirects" });
          if (stored) {
            const v = parseInt(stored, 10);
            if (Number.isFinite(v) && v >= 0 && v <= 100) defaultMaxRedirects = v;
          }
        } catch {}

        let defaultProxyUrl = "";
        try {
          const stored = await invoke<string | null>("get_setting", { key: "default_proxy_url" });
          if (stored) defaultProxyUrl = stored;
        } catch {}

        // Pre-warm the response cache so loadFromHistory can restore without
        // a network call.
        const historyResponses: Record<string, ResponseData> = {};
        for (const entry of historyEntries) {
          const r = historyEntryToResponse(entry);
          if (r) historyResponses[entry.id] = r;
        }

        let recentItems: RecentEntry[] = [];
        try {
          recentItems = await invoke<RecentEntry[]>("get_recent", { limit: 30 });
        } catch {}

        // Restore the user's tabs from the workspace's window_state, if any.
        // Falls back to the default single blank tab when no snapshot exists
          // or when the snapshot is empty.
        const savedTabs = workspace.window_state?.open_tabs;
        const savedActiveId = workspace.window_state?.active_tab_id;
        const hasSnapshot = Array.isArray(savedTabs) && savedTabs.length > 0;
        const tabs = hasSnapshot ? savedTabs! : get().tabs;
        const activeTabId = hasSnapshot
          ? (savedActiveId && tabs.some((t) => t.id === savedActiveId)
              ? savedActiveId
              : tabs[0].id)
          : get().activeTabId;

        set((s) => ({
          workspace,
          workspaces,
          history,
          collections,
          environments,
          defaultTimeoutMs,
          verifyTlsDefault,
          maxBodyBytes,
          maxHistoryBodyBytes,
          defaultRedirectPolicy,
          defaultMaxRedirects,
          defaultProxyUrl,
          historyResponses,
          recentItems,
          tabs,
          activeTabId,
          initialized: true,
          ...syncDerived({ ...s, tabs, activeTabId }),
        }));
      } catch (err) {
        console.error("Failed to initialize store:", err);
        set({ initialized: true });
      }
    },

    // === Tabs + active-tab field setters ===
    ...createTabSlice(set, get),

    sendRequest: async () => {
      const state = get();
      const req = activeTab(state);
      if (!req || !req.url) return;
      // Streaming protocols (WS, SSE) have their own connect/disconnect flow
      // (wsConnect / sseConnect). Cmd+Enter is wired to sendRequest globally,
      // so without this guard hitting the shortcut on an SSE tab would fire
      // an HTTP GET against the event-stream endpoint and try to buffer the
      // entire long-lived response.
      if (req.protocol === "websocket" || req.protocol === "sse") return;

      // Pre-flight: auto-refresh an expired OAuth2 token if we have a
      // refresh_token on file. Runs before the loading spinner so the user
      // sees "refreshing…" vs "sending…" latency, but errors here are
      // non-fatal — we'll still attempt the request with the stale token
      // and let the 401 inform the user.
      try { await get().ensureFreshOAuth2(req); } catch { /* best-effort */ }

      const reqId = req.id;
      set((s) => ({
        loadings: { ...s.loadings, [reqId]: true },
        errors: { ...s.errors, [reqId]: null },
        responses: { ...s.responses, [reqId]: null },
        testResults: { ...s.testResults, [reqId]: null },
        scriptLogs: { ...s.scriptLogs, [reqId]: null },
        scriptError: { ...s.scriptError, [reqId]: null },
        ...syncDerived({
          ...s,
          loadings: { ...s.loadings, [reqId]: true },
          errors: { ...s.errors, [reqId]: null },
          responses: { ...s.responses, [reqId]: null },
        }),
      }));

      // Build variable map from the full scope hierarchy: global → collection
      // → folder(s) → environment. Pre/post scripts may mutate this map; if
      // anything changes we persist back to the active environment so the
      // change sticks across requests / restarts. (Scripts can only mutate
      // the environment layer — global/collection/folder vars require
      // explicit user edits via their UIs.)
      const envVars = buildScopedVars({
        workspace: state.workspace,
        collections: state.collections,
        environments: state.environments,
        request: req,
      });
      // Snapshot the baseline so we can later attribute script mutations
      // back to the env layer (and not mistake a global/collection var for
      // a new env var).
      const baseline = { ...envVars };
      const activeEnvId = state.workspace?.active_environment_id;
      const activeEnv = activeEnvId
        ? state.environments.find((e) => e.id === activeEnvId)
        : undefined;
      const transientVars: Record<string, string> = {};

      // Per-scope maps so scripts can mutate each layer independently via
      // pm.globals / pm.collectionVariables. Captured as snapshots here;
      // mutations land back on these maps and we diff to persist below.
      const globalVars: Record<string, string> = {};
      for (const v of state.workspace?.variables ?? []) {
        if (v.enabled && v.key) globalVars[v.key] = v.value;
      }
      const globalBaseline = { ...globalVars };

      const owningCollection = req.collectionId
        ? state.collections.find((c) => c.id === req.collectionId)
        : undefined;
      const collectionVars: Record<string, string> = {};
      for (const v of owningCollection?.variables ?? []) {
        if (v.enabled && v.key) collectionVars[v.key] = v.value;
      }
      const collectionBaseline = { ...collectionVars };

      let result: Awaited<ReturnType<typeof executeRequestWithScripts>>;
      try {
        result = await executeRequestWithScripts({
          request: req,
          collections: get().collections,
          envVars,
          transientVars,
          globalVars,
          collectionVars,
          defaults: pipelineDefaultsFrom(get()),
        });
      } catch (err) {
        // Bubble-up failures from the script worker (worker import failure,
        // unexpected exceptions) — never leave the loading spinner stuck.
        const structured = toRequestError(err);
        set((s) => ({
          errors: { ...s.errors, [reqId]: structured },
          loadings: { ...s.loadings, [reqId]: false },
          ...syncDerived({
            ...s,
            errors: { ...s.errors, [reqId]: structured },
            loadings: { ...s.loadings, [reqId]: false },
          }),
        }));
        return;
      }

      // Persist global-scope mutations (pm.globals.set/unset). Diff against
      // the pre-script baseline so we only touch what the script actually
      // changed.
      if (state.workspace) {
        const globalChanges: Record<string, string> = {};
        for (const [k, v] of Object.entries(globalVars)) {
          if (globalBaseline[k] !== v) globalChanges[k] = v;
        }
        const globalDeletions = Object.keys(globalBaseline).filter(
          (k) => !(k in globalVars),
        );
        if (Object.keys(globalChanges).length > 0 || globalDeletions.length > 0) {
          const prev = state.workspace.variables ?? [];
          const nextVars = prev
            .filter((v) => !v.enabled || !v.key || !globalDeletions.includes(v.key))
            .map((v) =>
              v.enabled && v.key && v.key in globalChanges
                ? { ...v, value: globalChanges[v.key] }
                : v,
            );
          for (const k of Object.keys(globalChanges)) {
            if (!prev.some((v) => v.key === k)) {
              nextVars.push({ key: k, value: globalChanges[k], enabled: true, is_secret: false });
            }
          }
          get()
            .setGlobalVariables(nextVars)
            .catch((e) => console.error("Failed to persist global var mutations:", e));
        }
      }

      // Persist collection-scope mutations (pm.collectionVariables.set/unset).
      if (owningCollection) {
        const colChanges: Record<string, string> = {};
        for (const [k, v] of Object.entries(collectionVars)) {
          if (collectionBaseline[k] !== v) colChanges[k] = v;
        }
        const colDeletions = Object.keys(collectionBaseline).filter(
          (k) => !(k in collectionVars),
        );
        if (Object.keys(colChanges).length > 0 || colDeletions.length > 0) {
          const prev = owningCollection.variables ?? [];
          const nextVars = prev
            .filter((v) => !v.enabled || !v.key || !colDeletions.includes(v.key))
            .map((v) =>
              v.enabled && v.key && v.key in colChanges
                ? { ...v, value: colChanges[v.key] }
                : v,
            );
          for (const k of Object.keys(colChanges)) {
            if (!prev.some((v) => v.key === k)) {
              nextVars.push({ key: k, value: colChanges[k], enabled: true, is_secret: false });
            }
          }
          get()
            .setCollectionVariables(owningCollection.id, nextVars)
            .catch((e) => console.error("Failed to persist collection var mutations:", e));
        }
      }

      // Persist script-induced mutations to the env layer only. Script writes
      // are diffed against the pre-script `baseline`, so changes coming from
      // the global / collection / folder layers don't leak into env. Deletions
      // are only honored for keys that originally lived in env (we can't
      // delete from lower scopes through a script).
      if (activeEnv) {
        const changes: Record<string, string> = {};
        for (const [k, v] of Object.entries(envVars)) {
          if (baseline[k] !== v) changes[k] = v;
        }
        const envKeys = new Set(
          activeEnv.variables.filter((v) => v.enabled && v.key).map((v) => v.key)
        );
        const deletions = Object.keys(baseline).filter(
          (k) => !(k in envVars) && envKeys.has(k)
        );
        if (Object.keys(changes).length > 0 || deletions.length > 0) {
          const nextVars = activeEnv.variables
            .filter((v) => !v.enabled || !v.key || !deletions.includes(v.key))
            .map((v) =>
              v.enabled && v.key && v.key in changes
                ? { ...v, value: changes[v.key] }
                : v
            );
          for (const k of Object.keys(changes)) {
            if (!activeEnv.variables.some((v) => v.key === k)) {
              nextVars.push({ key: k, value: changes[k], enabled: true, is_secret: false });
            }
          }
          // Fire-and-forget so a save failure doesn't mask the response.
          get()
            .updateEnvironment({ ...activeEnv, variables: nextVars })
            .catch((e) => console.error("Failed to persist env mutations:", e));
        }
      }

      if (!get().loadings[reqId]) return;

      if (result.error) {
        set((s) => ({
          errors: { ...s.errors, [reqId]: result.error ?? null },
          loadings: { ...s.loadings, [reqId]: false },
          scriptLogs: { ...s.scriptLogs, [reqId]: result.logs },
          scriptError: { ...s.scriptError, [reqId]: result.scriptError ?? null },
          ...syncDerived({
            ...s,
            errors: { ...s.errors, [reqId]: result.error ?? null },
            loadings: { ...s.loadings, [reqId]: false },
          }),
        }));
        return;
      }

      set((s) => {
        const prevHistory = s.responseHistory[reqId] ?? [];
        const nextHistory = result.response
          ? [
              { id: generateId(), takenAt: Date.now(), response: result.response },
              ...prevHistory,
            ].slice(0, 10)
          : prevHistory;
        return {
          responses: { ...s.responses, [reqId]: result.response ?? null },
          loadings: { ...s.loadings, [reqId]: false },
          testResults: { ...s.testResults, [reqId]: result.tests },
          scriptLogs: { ...s.scriptLogs, [reqId]: result.logs },
          scriptError: { ...s.scriptError, [reqId]: result.scriptError ?? null },
          responseHistory: { ...s.responseHistory, [reqId]: nextHistory },
          ...syncDerived({
            ...s,
            responses: { ...s.responses, [reqId]: result.response ?? null },
            loadings: { ...s.loadings, [reqId]: false },
          }),
        };
      });
      if (result.response) {
        get().addToHistory(req, result.response);
      }
    },

    clearResponseHistory: (requestId: string) => {
      set((s) => ({
        responseHistory: { ...s.responseHistory, [requestId]: [] },
      }));
    },

    ensureFreshOAuth2: async (req) => {
      const outcome = await refreshOAuth2Token(req, get().collections, invoke);
      if (outcome.kind === "noop") return;
      const { newAuth, source } = outcome;
      switch (source.source) {
        case "request":
          get().updateActiveRequest({ auth: newAuth });
          break;
        case "collection":
          await get().setCollectionAuth(source.collectionId, newAuth);
          break;
        case "folder": {
          const col = get().collections.find(
            (c) => c.id === source.collectionId,
          );
          if (!col) break;
          await get().updateCollection(
            updateFolderAuth(col, source.folderId, newAuth),
          );
          break;
        }
      }
    },

    cancelRequest: () => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      if (!state.loadings[req.id]) return;
      invoke("cancel_request", { requestId: req.id }).catch(() => {});
      const cancelled = makeRequestError("cancelled", "CANCELLED", "Request cancelled");
      set((s) => ({
        loadings: { ...s.loadings, [req.id]: false },
        errors: { ...s.errors, [req.id]: cancelled },
        ...syncDerived({
          ...s,
          loadings: { ...s.loadings, [req.id]: false },
          errors: { ...s.errors, [req.id]: cancelled },
        }),
      }));
    },

    createNewRequest: () => {
      const newReq = createNewRequest();
      get().openTab(newReq);
    },

    // === History ===
    ...createHistorySlice(set, get),

    // === Collections + folders ===
    ...createCollectionsSlice(set, get),

    // === Environments ===
    ...createEnvironmentsSlice(set, get),

    // === Cookies ===
    ...createCookiesSlice(set, get),

    // === Settings ===
    ...createSettingsSlice(set, get),

    saveActiveRequest: async (target) => {
      const state = get();
      const req = activeTab(state);
      if (!req) return false;
      // Caller-provided target wins; otherwise fall back to whatever
      // collection this tab was opened from. If neither is known the
      // caller must show a picker first.
      const collectionId = target?.collectionId ?? req.collectionId;
      const folderId = target?.folderId ?? null;
      if (!collectionId) return false;
      const col = state.collections.find((c) => c.id === collectionId);
      if (!col) return false;
      const now = Date.now();
      const auth: AuthConfig =
        req.auth && req.auth.auth_type !== "inherit"
          ? req.auth
          : { auth_type: "inherit" };
      const existing = findRequestInCollection(col, req.id);
      const updatedReq: CollectionRequest = {
        id: req.id,
        name: req.name,
        method: req.method,
        url: req.url,
        headers: req.headers,
        params: req.params,
        body: req.body,
        body_type: req.bodyType,
        auth,
        pre_script: req.preScript,
        test_script: req.testScript,
        tags: req.tags,
        created_at: existing?.created_at ?? req.createdAt ?? now,
        updated_at: now,
      };

      // Build an updated collection tree, swapping the matching request
      // wherever it lives (root requests[], or any nested folder).
      const replaceInFolders = (folders: typeof col.folders): typeof col.folders =>
        folders.map((f) => ({
          ...f,
          requests: f.requests.map((r) => (r.id === updatedReq.id ? updatedReq : r)),
          folders: replaceInFolders(f.folders),
        }));

      let updated = {
        ...col,
        requests: col.requests.map((r) => (r.id === updatedReq.id ? updatedReq : r)),
        folders: replaceInFolders(col.folders),
        updated_at: now,
      };

      // If the request didn't exist yet anywhere in the tree, append it
      // to the target location (folder if specified, otherwise root).
      if (!existing) {
        if (folderId) {
          const appendToFolder = (folders: typeof col.folders): typeof col.folders =>
            folders.map((f) =>
              f.id === folderId
                ? { ...f, requests: [...f.requests, updatedReq] }
                : { ...f, folders: appendToFolder(f.folders) },
            );
          updated = { ...updated, folders: appendToFolder(updated.folders) };
        } else {
          updated = { ...updated, requests: [...updated.requests, updatedReq] };
        }
      }

      await invoke("save_collection", { collection: updated });
      set((s) => ({
        ...updateActiveTab(s, { collectionId, auth }),
        collections: s.collections.map((c) => (c.id === collectionId ? updated : c)),
      }));
      return true;
    },



    // === Recent Opened ===
    ...createRecentSlice(set, get),

    // The implementations live in `slices/protocolSlice.ts` to keep
    // this file focused on non-streaming actions.
    ...createProtocolSlice(set, get),

    // === Workspace + window-state persistence ===
    ...createWorkspaceSlice(set, get),
  };
});

