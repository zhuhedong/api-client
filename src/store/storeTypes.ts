/**
 * Top-level shape of the Zustand store + the two state-derivation
 * helpers that read from it. This file contains only types and pure
 * derivation functions — no store creation, no Tauri `invoke` calls —
 * so action slices in `./slices/*.ts` can import the type without
 * pulling in the store creator (which would create a circular
 * dependency: store → slice → store).
 */

import type {
  HttpMethod,
  KeyValue,
  RequestItem,
  ResponseData,
  ResponseSnapshot,
  Collection,
  Environment,
  EnvVariable,
  Workspace,
  AuthConfig,
  CookieEntry,
  RecentEntry,
  WsMessage,
  SseEventRecord,
  Protocol,
  TestResult,
  ScriptLog,
  RequestError,
} from "../types";

export interface RequestState {
  // Data
  collections: Collection[];
  environments: Environment[];
  workspace: Workspace | null;
  /** All available workspaces. Always non-empty after `initialize`. */
  workspaces: Workspace[];
  history: RequestItem[];
  initialized: boolean;

  // Multi-tabs
  tabs: RequestItem[];
  activeTabId: string | null;
  responses: Record<string, ResponseData | null>;
  errors: Record<string, RequestError | null>;
  loadings: Record<string, boolean>;
  /** Test results from the most recent post-response script, keyed by request id. */
  testResults: Record<string, TestResult[] | null>;
  /** Script execution logs (pre + post combined), keyed by request id. */
  scriptLogs: Record<string, ScriptLog[] | null>;
  /** Script error message (timeout, syntax, etc.), keyed by request id. */
  scriptError: Record<string, string | null>;
  /** Recent response snapshots (newest first) per request id, capped at 10, for diff view. */
  responseHistory: Record<string, ResponseSnapshot[]>;

  // WebSocket state per tab
  wsConnected: Record<string, boolean>;
  wsMessages: Record<string, WsMessage[]>;

  // Server-Sent Events state per tab
  sseConnected: Record<string, boolean>;
  sseEvents: Record<string, SseEventRecord[]>;

  // Cookies
  cookies: CookieEntry[];

  // Settings
  defaultTimeoutMs: number;
  /** Default TLS verification policy when a request doesn't override it. */
  verifyTlsDefault: boolean;
  /** Inline response body cap sent with every `send_request` call (bytes).
   *  Responses larger than this are truncated server-side and flagged with
   *  `body_truncated=true`. */
  maxBodyBytes: number;
  /** Cap (in bytes) for the response-body snapshot persisted into the
   *  SQLite history table. Defaults to 256 KiB so the DB stays bounded
   *  even after thousands of requests. */
  maxHistoryBodyBytes: number;
  /** Default redirect policy when a request doesn't override it. */
  defaultRedirectPolicy: "follow" | "none" | "manual";
  /** Default redirect cap (applies when policy is "follow"). */
  defaultMaxRedirects: number;
  /** Default proxy URL when a request doesn't override it. Empty string = no proxy. */
  defaultProxyUrl: string;

  /** Cached response snapshots reconstructed from the history table,
   *  keyed by history entry id. Populated lazily on `initialize` /
   *  `searchHistory`. `loadFromHistory` reads from here to restore the
   *  response panel without a network call. */
  historyResponses: Record<string, ResponseData>;
  /** Recent-opened items (newest first). Refreshed via `refreshRecent`. */
  recentItems: RecentEntry[];

  // Computed-like accessors (read from active tab)
  // Derived: activeRequest / response / loading / error
  activeRequest: RequestItem | null;
  activeRequestId: string | null;
  response: ResponseData | null;
  loading: boolean;
  error: RequestError | null;

  // === Actions ===
  initialize: () => Promise<void>;

  // Tabs
  openTab: (request: RequestItem) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  reorderTabs: (fromId: string, toId: string) => void;
  /** Move the active tab focus by `delta` (e.g. `-1` for prev, `+1` for next).
   *  Wraps at both ends. No-op when there are no tabs. */
  cycleTab: (delta: number) => void;
  /** Duplicate the active tab: clones the RequestItem with a fresh id and
   *  reset response state, then makes the clone the active tab. */
  duplicateActiveTab: () => void;

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
  setProtocol: (protocol: Protocol) => void;
  setGraphqlQuery: (q: string) => void;
  setGraphqlVariables: (v: string) => void;
  setPreScript: (s: string) => void;
  setTestScript: (s: string) => void;
  setTags: (tags: string[]) => void;

  sendRequest: () => Promise<void>;
  /** Check whether the request's effective OAuth2 auth needs a refresh
   *  (expired access_token + cached refresh_token) and, if so, swap in a
   *  fresh access_token by calling the token endpoint. Writes the new
   *  tokens back to whichever layer they came from (request / folder /
   *  collection). Safe to call when no oauth2 auth is in effect — it's a
   *  no-op then. */
  ensureFreshOAuth2: (req: RequestItem) => Promise<void>;
  cancelRequest: () => void;
  createNewRequest: () => void;
  clearResponseHistory: (requestId: string) => void;

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

  // === Folders ===

  /** Create a new folder. `parentFolderId === null` places it at the
   *  collection root, otherwise inside the named folder. */
  createFolder: (collectionId: string, parentFolderId: string | null, name: string) => Promise<void>;
  /** Rename a folder anywhere in the collection tree. */
  renameFolder: (collectionId: string, folderId: string, name: string) => Promise<void>;
  /** Delete a folder and its entire subtree (matching Postman/Insomnia). */
  deleteFolder: (collectionId: string, folderId: string) => Promise<void>;
  /** Move a request to a different container within the same collection.
   *  Pass `targetFolderId === null` to move it to the collection root. */
  moveRequestToFolder: (
    collectionId: string,
    requestId: string,
    targetFolderId: string | null,
  ) => Promise<void>;
  /** Move a folder (and its subtree) to a different container within the
   *  same collection. Refuses to move a folder into its own descendant. */
  moveFolderToFolder: (
    collectionId: string,
    folderId: string,
    targetParentFolderId: string | null,
  ) => Promise<void>;
  /** Reorder two folders that share the same parent container. */
  reorderFoldersInCollection: (
    collectionId: string,
    fromFolderId: string,
    toFolderId: string,
  ) => Promise<void>;
  importPostmanCollection: (data: unknown) => Promise<void>;
  /** Save a batch of already-built collections (used by every import format). */
  importCollections: (cols: Collection[]) => Promise<void>;
  updateCollection: (col: Collection) => Promise<void>;
  setCollectionAuth: (collectionId: string, auth: AuthConfig | undefined) => Promise<void>;
  /** Overwrite the variable list on a collection. Used by the variable scope editor. */
  setCollectionVariables: (collectionId: string, variables: EnvVariable[]) => Promise<void>;
  /** Overwrite the workspace-global variable list. */
  setGlobalVariables: (variables: EnvVariable[]) => Promise<void>;
  refreshCollections: () => Promise<void>;

  // Environments
  addEnvironment: (name: string) => Promise<void>;
  deleteEnvironment: (id: string) => Promise<void>;
  updateEnvironment: (env: Environment) => Promise<void>;
  refreshEnvironments: () => Promise<void>;
  setActiveEnvironment: (id: string | null) => void;

  /** Patch the workspace's window_state and persist (debounced via
   *  caller's responsibility — caller is expected to commit on drag end). */
  setWindowState: (patch: Partial<NonNullable<Workspace["window_state"]>>) => void;

  /** Snapshot the current tab list + active tab into `window_state.open_tabs`
   *  and persist (debounced). Wired into every tab-mutating action so users
   *  keep their tabs across restarts. */
  persistTabsState: () => void;

  // Cookies
  refreshCookies: () => Promise<void>;
  deleteCookie: (id: string) => Promise<void>;
  clearCookiesByDomain: (domain: string) => Promise<void>;

  // Settings
  setDefaultTimeoutMs: (ms: number) => Promise<void>;
  setVerifyTlsDefault: (verify: boolean) => Promise<void>;
  setMaxBodyBytes: (bytes: number) => Promise<void>;
  setMaxHistoryBodyBytes: (bytes: number) => Promise<void>;
  setDefaultRedirectPolicy: (policy: "follow" | "none" | "manual") => Promise<void>;
  setDefaultMaxRedirects: (n: number) => Promise<void>;
  setDefaultProxyUrl: (url: string) => Promise<void>;
  /** Save the active tab to its source collection (in-place) when it already
   *  has `collectionId`, or to the named collection/folder otherwise. The
   *  caller is responsible for prompting the user when there's no source
   *  collection — this function only persists when the destination is known.
   *  Returns `true` when a save happened, `false` when the active tab can't
   *  be saved (no collection picked). */
  saveActiveRequest: (target?: { collectionId: string; folderId?: string | null }) => Promise<boolean>;
  /** Clear all entries from a single data store. Used by Settings → Clear data. */
  clearAllRecent: () => Promise<void>;
  clearAllCookies: () => Promise<void>;

  // Recent opened
  /** Record an item as just-opened and refresh the recents list. */
  recordRecent: (entry: Omit<RecentEntry, "id" | "opened_at"> & { id?: string }) => Promise<void>;
  /** Re-read the recents list from the database. */
  refreshRecent: () => Promise<void>;
  /** Wipe the recents list. */
  clearRecent: () => Promise<void>;

  // WebSocket
  wsConnect: () => Promise<void>;
  wsSend: (text: string) => Promise<void>;
  wsClose: () => Promise<void>;
  appendWsEvent: (requestId: string, kind: string, text?: string | null) => void;

  // Server-Sent Events
  sseConnect: () => Promise<void>;
  sseClose: () => Promise<void>;
  appendSseEvent: (
    requestId: string,
    kind: string,
    detail: { event?: string; data?: string; id?: string; retry?: number; error?: string }
  ) => void;

  // Workspace
  saveWorkspaceState: () => Promise<void>;

  /** Switch the active workspace; loads its collections / environments / history. */
  switchWorkspace: (workspaceId: string) => Promise<void>;
  /** Create a new empty workspace and switch to it. */
  createWorkspace: (name: string) => Promise<Workspace>;
  /** Rename an existing workspace. */
  renameWorkspace: (id: string, name: string) => Promise<void>;
  /** Cascade-delete a workspace, its collections, environments, and history. */
  deleteWorkspace: (id: string) => Promise<void>;
  /** Refresh the workspaces list from disk. */
  refreshWorkspaces: () => Promise<void>;
}

/**
 * Look up the currently focused tab. Returns `null` when there is no
 * active tab id or when the active tab id points at a tab that's no
 * longer in the list (race window during tab close / workspace switch).
 */
export function activeTab(state: RequestState): RequestItem | null {
  if (!state.activeTabId) return null;
  return state.tabs.find((t) => t.id === state.activeTabId) ?? null;
}

/**
 * Recompute the four "derived" fields (`activeRequest`, `activeRequestId`,
 * `response`, `loading`, `error`) from the canonical maps. Spread the
 * return value into a `set()` call when an action mutates either
 * `tabs`, `activeTabId`, `responses`, `loadings`, or `errors` so the
 * subscribed components see consistent state.
 */
export function syncDerived(state: RequestState): Partial<RequestState> {
  const active = activeTab(state);
  return {
    activeRequest: active,
    activeRequestId: active?.id ?? null,
    response: active ? state.responses[active.id] ?? null : null,
    loading: active ? !!state.loadings[active.id] : false,
    error: active ? state.errors[active.id] ?? null : null,
  };
}
