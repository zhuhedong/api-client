import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  HttpMethod,
  KeyValue,
  RequestItem,
  ResponseData,
  Collection,
  CollectionRequest,
  HistoryEntry,
  Environment,
  Workspace,
  AuthConfig,
  CookieEntry,
  WsMessage,
} from "../types";
import { postmanToCollection } from "../utils/postman";

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function createEmptyKeyValue(): KeyValue {
  return { id: generateId(), key: "", value: "", enabled: true };
}

function createNewRequest(): RequestItem {
  return {
    id: generateId(),
    name: "New Request",
    method: "GET",
    url: "",
    headers: [createEmptyKeyValue()],
    params: [createEmptyKeyValue()],
    body: "",
    bodyType: "none",
    formData: [createEmptyKeyValue()],
    protocol: "http",
    createdAt: Date.now(),
  };
}

// Convert RequestItem <-> HistoryEntry for SQLite persistence
function requestToHistoryEntry(req: RequestItem, response?: ResponseData | null): HistoryEntry {
  const now = Date.now();
  return {
    id: req.id,
    name: req.name,
    method: req.method,
    url: req.url,
    headers: JSON.stringify(req.headers),
    params: JSON.stringify(req.params),
    body: req.body,
    body_type: req.bodyType,
    response_status: response?.status,
    response_time_ms: response?.time_ms,
    created_at: req.createdAt,
    updated_at: now,
  };
}

function historyEntryToRequest(entry: HistoryEntry): RequestItem {
  let headers: KeyValue[] = [];
  let params: KeyValue[] = [];
  try { headers = JSON.parse(entry.headers); } catch { headers = [createEmptyKeyValue()]; }
  try { params = JSON.parse(entry.params); } catch { params = [createEmptyKeyValue()]; }
  if (headers.length === 0) headers = [createEmptyKeyValue()];
  if (params.length === 0) params = [createEmptyKeyValue()];

  return {
    id: entry.id,
    name: entry.name,
    method: entry.method as HttpMethod,
    url: entry.url,
    headers,
    params,
    body: entry.body,
    bodyType: entry.body_type as RequestItem["bodyType"],
    formData: [createEmptyKeyValue()],
    protocol: "http",
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  };
}

interface RequestState {
  // Data
  collections: Collection[];
  environments: Environment[];
  workspace: Workspace | null;
  history: RequestItem[];
  initialized: boolean;

  // Multi-tabs
  tabs: RequestItem[];
  activeTabId: string | null;
  responses: Record<string, ResponseData | null>;
  errors: Record<string, string | null>;
  loadings: Record<string, boolean>;

  // WebSocket state per tab
  wsConnected: Record<string, boolean>;
  wsMessages: Record<string, WsMessage[]>;

  // Cookies
  cookies: CookieEntry[];

  // Settings
  defaultTimeoutMs: number;
  /** Default TLS verification policy when a request doesn't override it. */
  verifyTlsDefault: boolean;

  // Computed-like accessors (read from active tab)
  // Derived: activeRequest / response / loading / error
  activeRequest: RequestItem | null;
  activeRequestId: string | null;
  response: ResponseData | null;
  loading: boolean;
  error: string | null;

  // === Actions ===
  initialize: () => Promise<void>;

  // Tabs
  openTab: (request: RequestItem) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  reorderTabs: (fromId: string, toId: string) => void;

  // Active-tab convenience setters (mutate active tab)
  setActiveRequest: (request: RequestItem) => void;
  updateActiveRequest: (partial: Partial<RequestItem>) => void;
  setMethod: (method: HttpMethod) => void;
  setUrl: (url: string) => void;
  setHeaders: (headers: KeyValue[]) => void;
  setParams: (params: KeyValue[]) => void;
  setBody: (body: string) => void;
  setBodyType: (bodyType: RequestItem["bodyType"]) => void;
  setFormData: (formData: KeyValue[]) => void;
  setAuth: (auth: AuthConfig) => void;
  setName: (name: string) => void;
  setTimeoutMs: (ms: number | undefined) => void;
  setVerifyTls: (verify: boolean | undefined) => void;
  setRedirectPolicy: (policy: "follow" | "none" | "manual" | undefined) => void;
  setMaxRedirects: (n: number | undefined) => void;
  setProxyUrl: (url: string | undefined) => void;
  setClientCert: (cert: RequestItem["clientCert"]) => void;
  setProtocol: (protocol: "http" | "websocket") => void;
  setGraphqlQuery: (q: string) => void;
  setGraphqlVariables: (v: string) => void;

  sendRequest: () => Promise<void>;
  cancelRequest: () => void;
  createNewRequest: () => void;

  // History
  addToHistory: (request: RequestItem, response?: ResponseData | null) => void;
  deleteRequestFromHistory: (id: string) => void;
  clearAllHistory: () => Promise<void>;
  loadFromHistory: (id: string) => void;
  searchHistory: (query: string) => Promise<void>;
  reorderHistory: (fromId: string, toId: string) => void;

  // Collections
  addCollection: (name: string) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  renameCollection: (id: string, name: string) => Promise<void>;
  addRequestToCollection: (collectionId: string) => Promise<void>;
  loadRequestFromCollection: (collectionId: string, requestId: string) => void;
  deleteRequestFromCollection: (collectionId: string, requestId: string) => Promise<void>;
  renameRequestInCollection: (collectionId: string, requestId: string, name: string) => Promise<void>;
  reorderCollections: (fromId: string, toId: string) => void;
  reorderRequestsInCollection: (collectionId: string, fromId: string, toId: string) => Promise<void>;
  importPostmanCollection: (data: unknown) => Promise<void>;
  refreshCollections: () => Promise<void>;

  // Environments
  addEnvironment: (name: string) => Promise<void>;
  deleteEnvironment: (id: string) => Promise<void>;
  updateEnvironment: (env: Environment) => Promise<void>;
  refreshEnvironments: () => Promise<void>;
  setActiveEnvironment: (id: string | null) => void;

  // Cookies
  refreshCookies: () => Promise<void>;
  deleteCookie: (id: string) => Promise<void>;
  clearCookiesByDomain: (domain: string) => Promise<void>;

  // Settings
  setDefaultTimeoutMs: (ms: number) => Promise<void>;
  setVerifyTlsDefault: (verify: boolean) => Promise<void>;

  // WebSocket
  wsConnect: () => Promise<void>;
  wsSend: (text: string) => Promise<void>;
  wsClose: () => Promise<void>;
  appendWsEvent: (requestId: string, kind: string, text?: string | null) => void;

  // Workspace
  saveWorkspaceState: () => Promise<void>;
}

function activeTab(state: RequestState): RequestItem | null {
  if (!state.activeTabId) return null;
  return state.tabs.find((t) => t.id === state.activeTabId) ?? null;
}

function updateActiveTab(
  state: RequestState,
  patch: Partial<RequestItem>
): Partial<RequestState> {
  if (!state.activeTabId) return {};
  const tabs = state.tabs.map((t) =>
    t.id === state.activeTabId ? { ...t, ...patch } : t
  );
  const active = tabs.find((t) => t.id === state.activeTabId) || null;
  return {
    tabs,
    activeRequest: active,
  };
}

function syncDerived(state: RequestState): Partial<RequestState> {
  const active = activeTab(state);
  return {
    activeRequest: active,
    activeRequestId: active?.id ?? null,
    response: active ? state.responses[active.id] ?? null : null,
    loading: active ? !!state.loadings[active.id] : false,
    error: active ? state.errors[active.id] ?? null : null,
  };
}

export const useRequestStore = create<RequestState>((set, get) => {
  const initialReq = createNewRequest();
  return {
    collections: [],
    environments: [],
    workspace: null,
    history: [],
    initialized: false,

    tabs: [initialReq],
    activeTabId: initialReq.id,
    responses: {},
    errors: {},
    loadings: {},

    wsConnected: {},
    wsMessages: {},

    cookies: [],
    defaultTimeoutMs: 30000,
    verifyTlsDefault: true,

    activeRequest: initialReq,
    activeRequestId: initialReq.id,
    response: null,
    loading: false,
    error: null,

    initialize: async () => {
      try {
        const workspace = await invoke<Workspace>("load_default_workspace");
        const historyEntries = await invoke<HistoryEntry[]>("get_history", { limit: 50, offset: 0 });
        const history = historyEntries.map(historyEntryToRequest);
        const collections = await invoke<Collection[]>("list_collections");
        const environments = await invoke<Environment[]>("list_environments");

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

        set({
          workspace,
          history,
          collections,
          environments,
          defaultTimeoutMs,
          verifyTlsDefault,
          initialized: true,
        });
      } catch (err) {
        console.error("Failed to initialize store:", err);
        set({ initialized: true });
      }
    },

    // === Tabs ===

    openTab: (request) => {
      const { tabs } = get();
      if (tabs.find((t) => t.id === request.id)) {
        set((s) => ({ activeTabId: request.id, ...syncDerived({ ...s, activeTabId: request.id }) }));
        return;
      }
      const next = [...tabs, request];
      set((s) => ({
        tabs: next,
        activeTabId: request.id,
        ...syncDerived({ ...s, tabs: next, activeTabId: request.id }),
      }));
    },

    closeTab: (id) => {
      const { tabs, activeTabId, responses, errors, loadings, wsConnected } = get();
      // If a WebSocket is still open in this tab, close it on the backend
      if (wsConnected[id]) {
        invoke("ws_close", { requestId: id }).catch(() => {});
      }
      // If an HTTP request is still in flight, cancel it
      if (loadings[id]) {
        invoke("cancel_request", { requestId: id }).catch(() => {});
      }
      if (tabs.length === 1) {
        // Replace with a fresh new request rather than zero tabs
        const fresh = createNewRequest();
        set((s) => ({
          tabs: [fresh],
          activeTabId: fresh.id,
          responses: {},
          errors: {},
          loadings: {},
          ...syncDerived({ ...s, tabs: [fresh], activeTabId: fresh.id, responses: {}, errors: {}, loadings: {} }),
        }));
        return;
      }
      const idx = tabs.findIndex((t) => t.id === id);
      const remaining = tabs.filter((t) => t.id !== id);
      let nextActive = activeTabId;
      if (activeTabId === id) {
        const fallback = remaining[Math.max(0, idx - 1)] ?? remaining[0];
        nextActive = fallback.id;
      }
      const respRest = { ...responses }; delete respRest[id];
      const errRest = { ...errors }; delete errRest[id];
      const loadRest = { ...loadings }; delete loadRest[id];
      const wsConnRest = { ...wsConnected }; delete wsConnRest[id];
      const { wsMessages } = get();
      const wsMsgRest = { ...wsMessages }; delete wsMsgRest[id];
      set((s) => ({
        tabs: remaining,
        activeTabId: nextActive,
        responses: respRest,
        errors: errRest,
        loadings: loadRest,
        wsConnected: wsConnRest,
        wsMessages: wsMsgRest,
        ...syncDerived({
          ...s,
          tabs: remaining,
          activeTabId: nextActive,
          responses: respRest,
          errors: errRest,
          loadings: loadRest,
        }),
      }));
    },

    setActiveTab: (id) => {
      set((s) => ({ activeTabId: id, ...syncDerived({ ...s, activeTabId: id }) }));
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
    },

    setActiveRequest: (request) => {
      get().openTab(request);
    },

    updateActiveRequest: (partial) => {
      set((s) => ({ ...updateActiveTab(s, partial), ...syncDerived({ ...s, ...updateActiveTab(s, partial) } as RequestState) }));
    },

    setMethod: (method) => set((s) => ({ ...updateActiveTab(s, { method }), ...syncDerived({ ...s, ...updateActiveTab(s, { method }) } as RequestState) })),
    setUrl: (url) => set((s) => ({ ...updateActiveTab(s, { url }), ...syncDerived({ ...s, ...updateActiveTab(s, { url }) } as RequestState) })),
    setHeaders: (headers) => set((s) => ({ ...updateActiveTab(s, { headers }), ...syncDerived({ ...s, ...updateActiveTab(s, { headers }) } as RequestState) })),
    setParams: (params) => set((s) => ({ ...updateActiveTab(s, { params }), ...syncDerived({ ...s, ...updateActiveTab(s, { params }) } as RequestState) })),
    setBody: (body) => set((s) => ({ ...updateActiveTab(s, { body }), ...syncDerived({ ...s, ...updateActiveTab(s, { body }) } as RequestState) })),
    setBodyType: (bodyType) => set((s) => ({ ...updateActiveTab(s, { bodyType }), ...syncDerived({ ...s, ...updateActiveTab(s, { bodyType }) } as RequestState) })),
    setFormData: (formData) => set((s) => ({ ...updateActiveTab(s, { formData }), ...syncDerived({ ...s, ...updateActiveTab(s, { formData }) } as RequestState) })),
    setAuth: (auth) => set((s) => ({ ...updateActiveTab(s, { auth }), ...syncDerived({ ...s, ...updateActiveTab(s, { auth }) } as RequestState) })),
    setName: (name) => set((s) => ({ ...updateActiveTab(s, { name }), ...syncDerived({ ...s, ...updateActiveTab(s, { name }) } as RequestState) })),
    setTimeoutMs: (timeoutMs) => set((s) => ({ ...updateActiveTab(s, { timeoutMs }), ...syncDerived({ ...s, ...updateActiveTab(s, { timeoutMs }) } as RequestState) })),
    setVerifyTls: (verifyTls) => set((s) => ({ ...updateActiveTab(s, { verifyTls }), ...syncDerived({ ...s, ...updateActiveTab(s, { verifyTls }) } as RequestState) })),
    setRedirectPolicy: (redirectPolicy) => set((s) => ({ ...updateActiveTab(s, { redirectPolicy }), ...syncDerived({ ...s, ...updateActiveTab(s, { redirectPolicy }) } as RequestState) })),
    setMaxRedirects: (maxRedirects) => set((s) => ({ ...updateActiveTab(s, { maxRedirects }), ...syncDerived({ ...s, ...updateActiveTab(s, { maxRedirects }) } as RequestState) })),
    setProxyUrl: (proxyUrl) => set((s) => ({ ...updateActiveTab(s, { proxyUrl }), ...syncDerived({ ...s, ...updateActiveTab(s, { proxyUrl }) } as RequestState) })),
    setClientCert: (clientCert) => set((s) => ({ ...updateActiveTab(s, { clientCert }), ...syncDerived({ ...s, ...updateActiveTab(s, { clientCert }) } as RequestState) })),
    setProtocol: (protocol) => set((s) => ({ ...updateActiveTab(s, { protocol }), ...syncDerived({ ...s, ...updateActiveTab(s, { protocol }) } as RequestState) })),
    setGraphqlQuery: (graphqlQuery) => set((s) => ({ ...updateActiveTab(s, { graphqlQuery }), ...syncDerived({ ...s, ...updateActiveTab(s, { graphqlQuery }) } as RequestState) })),
    setGraphqlVariables: (graphqlVariables) => set((s) => ({ ...updateActiveTab(s, { graphqlVariables }), ...syncDerived({ ...s, ...updateActiveTab(s, { graphqlVariables }) } as RequestState) })),

    sendRequest: async () => {
      const state = get();
      const req = activeTab(state);
      if (!req || !req.url) return;
      // WebSocket tabs use wsConnect/wsSend rather than sendRequest.
      if (req.protocol === "websocket") return;

      const reqId = req.id;
      set((s) => ({
        loadings: { ...s.loadings, [reqId]: true },
        errors: { ...s.errors, [reqId]: null },
        responses: { ...s.responses, [reqId]: null },
        ...syncDerived({
          ...s,
          loadings: { ...s.loadings, [reqId]: true },
          errors: { ...s.errors, [reqId]: null },
          responses: { ...s.responses, [reqId]: null },
        }),
      }));

      // Build variable map from active environment
      const envVars: Record<string, string> = {};
      const activeEnvId = state.workspace?.active_environment_id;
      if (activeEnvId) {
        const activeEnv = state.environments.find((e) => e.id === activeEnvId);
        if (activeEnv) {
          for (const v of activeEnv.variables) {
            if (v.enabled && v.key) envVars[v.key] = v.value;
          }
        }
      }
      const sub = (str: string) => str.replace(/\{\{(\w+)\}\}/g, (_, key) => envVars[key] ?? `{{${key}}}`);

      try {
        let finalUrl = sub(req.url);
        const enabledParams = req.params.filter((p) => p.enabled && p.key);
        if (enabledParams.length > 0) {
          const qs = enabledParams.map((p) => `${encodeURIComponent(sub(p.key))}=${encodeURIComponent(sub(p.value))}`).join("&");
          const sep = finalUrl.includes("?") ? "&" : "?";
          finalUrl = `${finalUrl}${sep}${qs}`;
        }

        const headers = req.headers
          .filter((h) => h.enabled && h.key)
          .map((h) => ({ key: sub(h.key), value: sub(h.value), enabled: h.enabled }));

        // Inject auth
        const auth = req.auth;
        if (auth && auth.auth_type !== "none") {
          if (auth.auth_type === "bearer" && auth.bearer_token) {
            headers.push({ key: "Authorization", value: `Bearer ${sub(auth.bearer_token)}`, enabled: true });
          } else if (auth.auth_type === "basic" && auth.basic_username) {
            const encoded = btoa(`${sub(auth.basic_username)}:${sub(auth.basic_password || "")}`);
            headers.push({ key: "Authorization", value: `Basic ${encoded}`, enabled: true });
          } else if (auth.auth_type === "api_key" && auth.api_key_key && auth.api_key_in === "header") {
            headers.push({ key: sub(auth.api_key_key), value: sub(auth.api_key_value || ""), enabled: true });
          }
        }

        // Auto Content-Type
        const hasCT = headers.some((h) => h.key.toLowerCase() === "content-type");
        if (!hasCT) {
          if (req.bodyType === "json" || req.bodyType === "graphql") {
            headers.push({ key: "Content-Type", value: "application/json", enabled: true });
          } else if (req.bodyType === "xml") {
            headers.push({ key: "Content-Type", value: "application/xml", enabled: true });
          } else if (req.bodyType === "text") {
            headers.push({ key: "Content-Type", value: "text/plain", enabled: true });
          }
        }

        // API Key in query
        if (auth?.auth_type === "api_key" && auth.api_key_in === "query" && auth.api_key_key) {
          const sep = finalUrl.includes("?") ? "&" : "?";
          finalUrl = `${finalUrl}${sep}${encodeURIComponent(sub(auth.api_key_key))}=${encodeURIComponent(sub(auth.api_key_value || ""))}`;
        }

        // Body
        let bodyStr: string | null = null;
        let formData: { key: string; value: string; enabled: boolean; is_file?: boolean; file_path?: string }[] | null = null;
        if (req.bodyType === "form-data") {
          formData = req.formData
            .filter((f) => f.enabled && f.key)
            .map((f) => ({
              key: f.key,
              value: f.value,
              enabled: f.enabled,
              is_file: !!f.is_file,
              file_path: f.file_path,
            }));
        } else if (req.bodyType === "graphql") {
          bodyStr = JSON.stringify({
            query: sub(req.graphqlQuery || ""),
            variables: req.graphqlVariables ? JSON.parse(sub(req.graphqlVariables)) : undefined,
          });
        } else if (req.bodyType !== "none") {
          bodyStr = sub(req.body || "") || null;
        }

        const payload = {
          method: req.method,
          url: finalUrl,
          headers,
          body: bodyStr,
          body_type: req.bodyType !== "none" ? req.bodyType : null,
          form_data: formData,
          timeout_ms: req.timeoutMs ?? get().defaultTimeoutMs,
          request_id: req.id,
          verify_tls: req.verifyTls ?? get().verifyTlsDefault,
          redirect_policy: req.redirectPolicy ?? null,
          max_redirects: req.maxRedirects ?? null,
          proxy_url: req.proxyUrl?.trim() ? req.proxyUrl.trim() : null,
          client_cert:
            req.clientCert && req.clientCert.path
              ? { path: req.clientCert.path, password: req.clientCert.password ?? null }
              : null,
        };

        const response = await invoke<ResponseData>("send_request", { payload });
        if (get().loadings[reqId]) {
          set((s) => ({
            responses: { ...s.responses, [reqId]: response },
            loadings: { ...s.loadings, [reqId]: false },
            ...syncDerived({
              ...s,
              responses: { ...s.responses, [reqId]: response },
              loadings: { ...s.loadings, [reqId]: false },
            }),
          }));
          get().addToHistory(req, response);
        }
      } catch (err) {
        if (get().loadings[reqId]) {
          set((s) => ({
            errors: { ...s.errors, [reqId]: String(err) },
            loadings: { ...s.loadings, [reqId]: false },
            ...syncDerived({
              ...s,
              errors: { ...s.errors, [reqId]: String(err) },
              loadings: { ...s.loadings, [reqId]: false },
            }),
          }));
        }
      }
    },

    cancelRequest: () => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      if (!state.loadings[req.id]) return;
      invoke("cancel_request", { requestId: req.id }).catch(() => {});
      set((s) => ({
        loadings: { ...s.loadings, [req.id]: false },
        errors: { ...s.errors, [req.id]: "Request cancelled" },
        ...syncDerived({
          ...s,
          loadings: { ...s.loadings, [req.id]: false },
          errors: { ...s.errors, [req.id]: "Request cancelled" },
        }),
      }));
    },

    createNewRequest: () => {
      const newReq = createNewRequest();
      get().openTab(newReq);
    },

    addToHistory: (request, response) => {
      const entry = requestToHistoryEntry(request, response);
      invoke("save_history", { entry }).catch((err) => console.error("Failed to save history:", err));
      set((state) => {
        const exists = state.history.find((r) => r.id === request.id);
        if (exists) {
          return {
            history: state.history.map((r) => (r.id === request.id ? { ...request, createdAt: Date.now() } : r)),
          };
        }
        return { history: [{ ...request, createdAt: Date.now() }, ...state.history].slice(0, 50) };
      });
    },

    deleteRequestFromHistory: (id) => {
      invoke("delete_history", { id }).catch((err) => console.error("Failed to delete history:", err));
      set((state) => ({ history: state.history.filter((r) => r.id !== id) }));
    },

    clearAllHistory: async () => {
      await invoke("clear_history");
      set({ history: [] });
    },

    loadFromHistory: (id) => {
      const { history } = get();
      const request = history.find((r) => r.id === id);
      if (!request) return;
      // Clone the request into a fresh tab id to avoid stomping the history entry.
      const cloned: RequestItem = { ...request, id: generateId() };
      get().openTab(cloned);
    },

    searchHistory: async (query) => {
      try {
        const entries = await invoke<HistoryEntry[]>("search_history", { query });
        const history = entries.map(historyEntryToRequest);
        set({ history });
      } catch (err) {
        console.error("Failed to search history:", err);
      }
    },

    reorderHistory: (fromId, toId) => {
      const { history } = get();
      const from = history.findIndex((r) => r.id === fromId);
      const to = history.findIndex((r) => r.id === toId);
      if (from === -1 || to === -1 || from === to) return;
      const next = [...history];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      set({ history: next });
    },

    // === Collections ===

    addCollection: async (name) => {
      const now = Date.now();
      const collection: Collection = {
        id: generateId(),
        name,
        description: "",
        requests: [],
        folders: [],
        created_at: now,
        updated_at: now,
      };
      await invoke("save_collection", { collection });
      set((state) => ({ collections: [...state.collections, collection] }));
    },

    deleteCollection: async (id) => {
      await invoke("delete_collection", { id });
      set((state) => ({ collections: state.collections.filter((c) => c.id !== id) }));
    },

    renameCollection: async (id, name) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === id);
      if (!col) return;
      const updated = { ...col, name, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({ collections: state.collections.map((c) => (c.id === id ? updated : c)) }));
    },

    addRequestToCollection: async (collectionId) => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      const col = state.collections.find((c) => c.id === collectionId);
      if (!col) return;
      const now = Date.now();
      const colReq: CollectionRequest = {
        id: req.id,
        name: req.name,
        method: req.method,
        url: req.url,
        headers: req.headers,
        params: req.params,
        body: req.body,
        body_type: req.bodyType,
        auth: req.auth,
        created_at: req.createdAt,
        updated_at: now,
      };
      const updated = { ...col, requests: [...col.requests, colReq], updated_at: now };
      await invoke("save_collection", { collection: updated });
      set((s) => ({ collections: s.collections.map((c) => (c.id === collectionId ? updated : c)) }));
    },

    loadRequestFromCollection: (collectionId, requestId) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const req = col.requests.find((r) => r.id === requestId);
      if (!req) return;
      const requestItem: RequestItem = {
        id: generateId(),
        name: req.name,
        method: req.method as HttpMethod,
        url: req.url,
        headers: req.headers.length > 0 ? req.headers : [createEmptyKeyValue()],
        params: req.params.length > 0 ? req.params : [createEmptyKeyValue()],
        body: req.body,
        bodyType: req.body_type as RequestItem["bodyType"],
        formData: [createEmptyKeyValue()],
        auth: req.auth,
        protocol: "http",
        createdAt: req.created_at,
      };
      get().openTab(requestItem);
    },

    deleteRequestFromCollection: async (collectionId, requestId) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const updated = {
        ...col,
        requests: col.requests.filter((r) => r.id !== requestId),
        updated_at: Date.now(),
      };
      await invoke("save_collection", { collection: updated });
      set((state) => ({ collections: state.collections.map((c) => (c.id === collectionId ? updated : c)) }));
    },

    renameRequestInCollection: async (collectionId, requestId, name) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const updated = {
        ...col,
        requests: col.requests.map((r) => (r.id === requestId ? { ...r, name, updated_at: Date.now() } : r)),
        updated_at: Date.now(),
      };
      await invoke("save_collection", { collection: updated });
      set((state) => ({ collections: state.collections.map((c) => (c.id === collectionId ? updated : c)) }));
    },

    reorderCollections: (fromId, toId) => {
      const { collections } = get();
      const from = collections.findIndex((c) => c.id === fromId);
      const to = collections.findIndex((c) => c.id === toId);
      if (from === -1 || to === -1 || from === to) return;
      const next = [...collections];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      set({ collections: next });
    },

    reorderRequestsInCollection: async (collectionId, fromId, toId) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const from = col.requests.findIndex((r) => r.id === fromId);
      const to = col.requests.findIndex((r) => r.id === toId);
      if (from === -1 || to === -1 || from === to) return;
      const reqs = [...col.requests];
      const [moved] = reqs.splice(from, 1);
      reqs.splice(to, 0, moved);
      const updated = { ...col, requests: reqs, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({ collections: state.collections.map((c) => (c.id === collectionId ? updated : c)) }));
    },

    importPostmanCollection: async (data) => {
      const cols = postmanToCollection(data);
      for (const col of cols) {
        await invoke("save_collection", { collection: col });
      }
      set((state) => ({ collections: [...state.collections, ...cols] }));
    },

    refreshCollections: async () => {
      const collections = await invoke<Collection[]>("list_collections");
      set({ collections });
    },

    // === Environments ===

    addEnvironment: async (name) => {
      const now = Date.now();
      const env: Environment = {
        id: generateId(),
        name,
        variables: [],
        created_at: now,
        updated_at: now,
      };
      await invoke("save_environment", { env });
      set((state) => ({ environments: [...state.environments, env] }));
    },

    deleteEnvironment: async (id) => {
      await invoke("delete_environment", { id });
      set((state) => ({ environments: state.environments.filter((e) => e.id !== id) }));
    },

    updateEnvironment: async (env) => {
      const updated = { ...env, updated_at: Date.now() };
      await invoke("save_environment", { env: updated });
      set((state) => ({ environments: state.environments.map((e) => (e.id === env.id ? updated : e)) }));
    },

    refreshEnvironments: async () => {
      const environments = await invoke<Environment[]>("list_environments");
      set({ environments });
    },

    setActiveEnvironment: (id) => {
      set((state) => ({
        workspace: state.workspace ? { ...state.workspace, active_environment_id: id ?? undefined } : null,
      }));
      get().saveWorkspaceState();
    },

    // === Cookies ===

    refreshCookies: async () => {
      try {
        const cookies = await invoke<CookieEntry[]>("get_all_cookies");
        set({ cookies });
      } catch (err) {
        console.error("Failed to load cookies:", err);
      }
    },

    deleteCookie: async (id) => {
      await invoke("delete_cookie", { id });
      set((state) => ({ cookies: state.cookies.filter((c) => c.id !== id) }));
    },

    clearCookiesByDomain: async (domain) => {
      await invoke("clear_cookies_by_domain", { domain });
      set((state) => ({ cookies: state.cookies.filter((c) => c.domain !== domain) }));
    },

    // === Settings ===

    setDefaultTimeoutMs: async (ms) => {
      try {
        await invoke("set_setting", { key: "default_timeout_ms", value: String(ms) });
      } catch (err) {
        console.error("Failed to persist default timeout:", err);
      }
      set({ defaultTimeoutMs: ms });
    },

    setVerifyTlsDefault: async (verify) => {
      try {
        await invoke("set_setting", { key: "verify_tls_default", value: verify ? "true" : "false" });
      } catch (err) {
        console.error("Failed to persist verify-tls default:", err);
      }
      set({ verifyTlsDefault: verify });
    },

    // === WebSocket ===

    wsConnect: async () => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      const reqId = req.id;

      // Variable substitution for URL
      const envVars: Record<string, string> = {};
      const activeEnvId = state.workspace?.active_environment_id;
      if (activeEnvId) {
        const activeEnv = state.environments.find((e) => e.id === activeEnvId);
        if (activeEnv) {
          for (const v of activeEnv.variables) {
            if (v.enabled && v.key) envVars[v.key] = v.value;
          }
        }
      }
      const sub = (str: string) => str.replace(/\{\{(\w+)\}\}/g, (_, key) => envVars[key] ?? `{{${key}}}`);

      try {
        set((s) => ({
          wsMessages: { ...s.wsMessages, [reqId]: [] },
          errors: { ...s.errors, [reqId]: null },
          ...syncDerived({ ...s, errors: { ...s.errors, [reqId]: null } }),
        }));
        await invoke("ws_connect", {
          payload: {
            url: sub(req.url),
            headers: req.headers.filter((h) => h.enabled && h.key).map((h) => ({ key: sub(h.key), value: sub(h.value), enabled: true, is_file: false, file_path: null })),
            request_id: reqId,
          },
        });
      } catch (err) {
        set((s) => ({
          errors: { ...s.errors, [reqId]: String(err) },
          ...syncDerived({ ...s, errors: { ...s.errors, [reqId]: String(err) } }),
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
              { id: generateId(), direction: "sent", text, ts: Date.now() } as WsMessage,
            ],
          },
        }));
      } catch (err) {
        set((s) => ({
          errors: { ...s.errors, [req.id]: String(err) },
          ...syncDerived({ ...s, errors: { ...s.errors, [req.id]: String(err) } }),
        }));
      }
    },

    wsClose: async () => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      try {
        await invoke("ws_close", { requestId: req.id });
      } catch {}
    },

    appendWsEvent: (requestId, kind, text) => {
      set((s) => {
        const list = s.wsMessages[requestId] || [];
        const msg: WsMessage = {
          id: generateId(),
          direction: kind === "message" ? "received" : "system",
          text: text || (kind === "open" ? "(connected)" : kind === "close" ? "(closed)" : kind === "error" ? "(error)" : kind),
          ts: Date.now(),
        };
        return {
          wsMessages: { ...s.wsMessages, [requestId]: [...list, msg] },
          wsConnected: { ...s.wsConnected, [requestId]: kind === "open" ? true : kind === "close" || kind === "error" ? false : !!s.wsConnected[requestId] },
        };
      });
    },

    // === Workspace ===

    saveWorkspaceState: async () => {
      const { workspace } = get();
      if (!workspace) return;
      const updated = { ...workspace, updated_at: Date.now() };
      invoke("save_workspace", { workspace: updated }).catch((err) =>
        console.error("Failed to save workspace:", err)
      );
    },
  };
});
