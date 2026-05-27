/**
 * Typed adapter that lets slice tests construct a `RequestState`
 * without spelling out every field. Action methods that callers don't
 * override fall through to `stub`, which throws on invocation —
 * surfacing missing test scaffolding loudly rather than silently
 * returning `undefined`.
 *
 * Why this lives in a helper module and not inline in each test:
 * CONTRIBUTING.md bans ad-hoc `as unknown as` casts at call sites. By
 * encapsulating the construction in a typed adapter, individual tests
 * just call `mockRequestState({ ... })` and never need their own
 * casts.
 *
 * The function-return-`never` trick works because `never` is the
 * bottom type — assignable to any return type, including
 * `Promise<Workspace>` or `Promise<boolean>`. The same trick handles
 * actions of different arities: TypeScript treats a zero-arg function
 * as a subtype of any function expecting more args (extra args are
 * silently ignored at runtime, matching JavaScript semantics).
 */

import type { RequestItem } from "../../types";
import type { RequestState } from "../storeTypes";

function stub(): never {
  throw new Error("mockRequestState: action not stubbed in test");
}

/** Build a `RequestState` from an optional partial override. */
export function mockRequestState(
  overrides: Partial<RequestState> = {},
): RequestState {
  const dummyRequest: RequestItem = {
    id: "mock-req",
    name: "Mock",
    method: "GET",
    url: "",
    headers: [],
    params: [],
    body: "",
    bodyType: "none",
    formData: [],
    createdAt: 0,
    updatedAt: 0,
  };
  // Stub once, reuse: avoids 80+ identical arrow expressions.
  const s = stub;
  const base: RequestState = {
    // === Data ===
    collections: [],
    environments: [],
    workspace: null,
    workspaces: [],
    history: [],
    initialized: false,

    // === Multi-tabs ===
    tabs: [],
    activeTabId: null,
    responses: {},
    errors: {},
    loadings: {},
    testResults: {},
    scriptLogs: {},
    scriptError: {},
    responseHistory: {},

    // === WebSocket ===
    wsConnected: {},
    wsMessages: {},

    // === SSE ===
    sseConnected: {},
    sseEvents: {},

    // === Cookies ===
    cookies: [],

    // === Settings ===
    defaultTimeoutMs: 30000,
    verifyTlsDefault: true,
    maxBodyBytes: 0,
    maxHistoryBodyBytes: 0,
    defaultRedirectPolicy: "follow",
    defaultMaxRedirects: 10,
    defaultProxyUrl: "",
    historyResponses: {},
    recentItems: [],

    // === Derived ===
    activeRequest: dummyRequest,
    activeRequestId: null,
    response: null,
    loading: false,
    error: null,

    // === Action stubs (alphabetised within each block) ===
    initialize: s,

    openTab: s,
    closeTab: s,
    setActiveTab: s,
    reorderTabs: s,
    cycleTab: s,
    duplicateActiveTab: s,

    setActiveRequest: s,
    updateActiveRequest: s,
    setMethod: s,
    setUrl: s,
    setHeaders: s,
    setParams: s,
    setBody: s,
    setBodyType: s,
    setFormData: s,
    setAuth: s,
    setName: s,
    setTimeoutMs: s,
    setVerifyTls: s,
    setRedirectPolicy: s,
    setMaxRedirects: s,
    setProxyUrl: s,
    setClientCert: s,
    setProtocol: s,
    setGraphqlQuery: s,
    setGraphqlVariables: s,
    setPreScript: s,
    setTestScript: s,
    setTags: s,

    sendRequest: s,
    ensureFreshOAuth2: s,
    cancelRequest: s,
    createNewRequest: s,
    clearResponseHistory: s,

    addToHistory: s,
    deleteRequestFromHistory: s,
    clearAllHistory: s,
    loadFromHistory: s,
    searchHistory: s,
    reorderHistory: s,

    addCollection: s,
    deleteCollection: s,
    renameCollection: s,
    addRequestToCollection: s,
    loadRequestFromCollection: s,
    deleteRequestFromCollection: s,
    renameRequestInCollection: s,
    reorderCollections: s,
    reorderRequestsInCollection: s,

    createFolder: s,
    renameFolder: s,
    deleteFolder: s,
    moveRequestToFolder: s,
    moveFolderToFolder: s,
    reorderFoldersInCollection: s,

    importPostmanCollection: s,
    importCollections: s,
    updateCollection: s,
    setCollectionAuth: s,
    setCollectionVariables: s,
    setGlobalVariables: s,
    refreshCollections: s,

    addEnvironment: s,
    deleteEnvironment: s,
    updateEnvironment: s,
    refreshEnvironments: s,
    setActiveEnvironment: s,

    setWindowState: s,
    persistTabsState: s,

    refreshCookies: s,
    deleteCookie: s,
    clearCookiesByDomain: s,

    setDefaultTimeoutMs: s,
    setVerifyTlsDefault: s,
    setMaxBodyBytes: s,
    setMaxHistoryBodyBytes: s,
    setDefaultRedirectPolicy: s,
    setDefaultMaxRedirects: s,
    setDefaultProxyUrl: s,
    saveActiveRequest: s,
    clearAllRecent: s,
    clearAllCookies: s,

    recordRecent: s,
    refreshRecent: s,
    clearRecent: s,

    wsConnect: s,
    wsSend: s,
    wsClose: s,
    appendWsEvent: s,

    sseConnect: s,
    sseClose: s,
    appendSseEvent: s,

    saveWorkspaceState: s,
    switchWorkspace: s,
    createWorkspace: s,
    renameWorkspace: s,
    deleteWorkspace: s,
    refreshWorkspaces: s,
  };
  return { ...base, ...overrides };
}
