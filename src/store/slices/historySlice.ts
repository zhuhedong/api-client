/**
 * Slice owning the request history list and the per-request response
 * cache that backs the History sidebar tab. Six actions cover the
 * full CRUD + search + drag-reorder surface:
 *
 *   - `addToHistory` (called by the request pipeline on success)
 *   - `deleteRequestFromHistory` / `clearAllHistory`
 *   - `loadFromHistory` (clones the history entry into a fresh tab
 *     and hydrates its response panel from the in-memory cache)
 *   - `searchHistory` (FTS query against the SQLite history table)
 *   - `reorderHistory` (drag-and-drop within the sidebar; in-memory
 *     only — there's no persistent ordering for history)
 *
 * The backing store is SQLite via the `save_history` / `delete_history`
 * / `clear_history` / `search_history` Tauri commands. The slice keeps
 * the in-memory `history` array and the `historyResponses` cache in
 * sync; the response panel reads from the cache to avoid re-running
 * requests when the user clicks an old entry.
 */

import { invoke } from "@tauri-apps/api/core";
import type { StoreApi } from "zustand";

import type { HistoryEntry, RequestItem, ResponseData } from "../../types";
import {
  generateId,
  historyEntryToRequest,
  requestToHistoryEntry,
} from "../storeHelpers";
import { historyEntryToResponse } from "../../utils/historySnapshot";
import { syncDerived, type RequestState } from "../storeTypes";

/** Subset of `RequestState` exposed by this slice. */
export type HistorySlice = Pick<
  RequestState,
  | "addToHistory"
  | "deleteRequestFromHistory"
  | "clearAllHistory"
  | "loadFromHistory"
  | "searchHistory"
  | "reorderHistory"
>;

export function createHistorySlice(
  set: StoreApi<RequestState>["setState"],
  get: StoreApi<RequestState>["getState"],
): HistorySlice {
  return {
    addToHistory: (request, response) => {
      const { workspace, maxHistoryBodyBytes } = get();
      const entry = requestToHistoryEntry(
        request,
        response,
        workspace?.id,
        maxHistoryBodyBytes,
      );
      invoke("save_history", { entry }).catch((err) =>
        console.error("Failed to save history:", err),
      );
      set((state) => {
        const exists = state.history.find((r) => r.id === request.id);
        const nextHistory = exists
          ? state.history.map((r) =>
              r.id === request.id ? { ...request, createdAt: Date.now() } : r,
            )
          : [{ ...request, createdAt: Date.now() }, ...state.history].slice(
              0,
              50,
            );
        // Mirror the persisted snapshot in memory so loadFromHistory can
        // restore the response panel without re-running the request.
        const nextResponses = { ...state.historyResponses };
        if (response) {
          nextResponses[request.id] = response;
        } else {
          delete nextResponses[request.id];
        }
        return { history: nextHistory, historyResponses: nextResponses };
      });
    },

    deleteRequestFromHistory: (id) => {
      invoke("delete_history", { id }).catch((err) =>
        console.error("Failed to delete history:", err),
      );
      set((state) => {
        const nextResponses = { ...state.historyResponses };
        delete nextResponses[id];
        return {
          history: state.history.filter((r) => r.id !== id),
          historyResponses: nextResponses,
        };
      });
    },

    clearAllHistory: async () => {
      await invoke("clear_history");
      set({ history: [], historyResponses: {} });
    },

    loadFromHistory: (id) => {
      const { history, historyResponses } = get();
      const request = history.find((r) => r.id === id);
      if (!request) return;
      // Clone the request into a fresh tab id to avoid stomping the history
      // entry. Carry the cached response so the response panel hydrates
      // immediately on switch.
      const newId = generateId();
      const cloned: RequestItem = { ...request, id: newId };
      const cachedResponse = historyResponses[id];
      get().openTab(cloned);
      if (cachedResponse) {
        set((s) => {
          const responses = { ...s.responses, [newId]: cachedResponse };
          return { responses, ...syncDerived({ ...s, responses }) };
        });
      }
      get()
        .recordRecent({
          item_type: "request",
          item_id: `history:${id}`,
          name: request.name || request.url || request.method,
        })
        .catch(() => {});
    },

    searchHistory: async (query) => {
      try {
        const { workspace } = get();
        const entries = await invoke<HistoryEntry[]>("search_history", {
          workspaceId: workspace?.id,
          query,
        });
        const history = entries.map(historyEntryToRequest);
        // Update the response cache so search results are also restorable.
        const cacheUpdates: Record<string, ResponseData> = {};
        for (const entry of entries) {
          const r = historyEntryToResponse(entry);
          if (r) cacheUpdates[entry.id] = r;
        }
        set((state) => ({
          history,
          historyResponses: { ...state.historyResponses, ...cacheUpdates },
        }));
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
  };
}
