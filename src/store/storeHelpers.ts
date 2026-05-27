/**
 * Pure helper functions for the request store.
 *
 * Living in a dedicated module keeps the store body focused on state
 * shape + Zustand actions, and makes the helpers individually
 * unit-testable. Everything here is a pure function — no calls to
 * `useRequestStore.getState()`, no `invoke(...)`, no DOM access.
 */

import type {
  HttpMethod,
  KeyValue,
  RequestItem,
  ResponseData,
  Collection,
  CollectionRequest,
  HistoryEntry,
} from "../types";
import {
  DEFAULT_MAX_HISTORY_BODY_BYTES,
  buildResponseSnapshot,
} from "../utils/historySnapshot";
import type { RequestState } from "./storeTypes";

/**
 * Apply a patch to the currently focused tab and return the partial
 * state to feed into a Zustand `set()`. Returns an empty object when
 * no tab is focused so the caller can safely spread the result
 * unconditionally.
 *
 * Returns `{ tabs, activeRequest }`; callers that need to recompute
 * the other derived fields (`response`, `loading`, `error`) should
 * follow up with a `syncDerived(...)` spread.
 */
export function updateActiveTab(
  state: RequestState,
  patch: Partial<RequestItem>,
): Partial<RequestState> {
  if (!state.activeTabId) return {};
  const tabs = state.tabs.map((t) =>
    t.id === state.activeTabId ? { ...t, ...patch } : t,
  );
  const active = tabs.find((t) => t.id === state.activeTabId) || null;
  return {
    tabs,
    activeRequest: active,
  };
}

/** Short random id (alphanumeric, 13 chars). Used for tabs / kv rows / new
 *  requests / etc. — anywhere we just need a non-cryptographic local id. */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/** Build an empty enabled key-value row (for headers / params / form data). */
export function createEmptyKeyValue(): KeyValue {
  return { id: generateId(), key: "", value: "", enabled: true };
}

/** Build a fresh blank request for "new tab" / "new from history". */
export function createNewRequest(): RequestItem {
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

/**
 * Convert RequestItem -> HistoryEntry for SQLite persistence. The response
 * snapshot serializers live in `utils/historySnapshot` so they can be
 * unit-tested without spinning up the whole store.
 */
export function requestToHistoryEntry(
  req: RequestItem,
  response?: ResponseData | null,
  workspaceId?: string,
  maxHistoryBodyBytes: number = DEFAULT_MAX_HISTORY_BODY_BYTES,
): HistoryEntry {
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
    created_at: req.createdAt,
    updated_at: now,
    workspace_id: workspaceId,
    ...buildResponseSnapshot(response, maxHistoryBodyBytes),
  };
}

/** Inverse of `requestToHistoryEntry` — reconstructs a RequestItem from
 *  a HistoryEntry row loaded out of SQLite. Defensive about malformed
 *  JSON in the headers/params columns (rows written by older builds may
 *  have empty arrays). */
export function historyEntryToRequest(entry: HistoryEntry): RequestItem {
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

/** Search a collection (including nested folders) for a request by id. */
export function findRequestInCollection(
  collection: Collection,
  requestId: string,
): CollectionRequest | null {
  const direct = collection.requests.find((r) => r.id === requestId);
  if (direct) return direct;
  const walk = (folders: typeof collection.folders): CollectionRequest | null => {
    for (const f of folders) {
      const here = f.requests.find((r) => r.id === requestId);
      if (here) return here;
      const deeper = walk(f.folders);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(collection.folders);
}
