/**
 * Slice owning everything that touches the `workspace` field
 * directly: workspace CRUD (`createWorkspace` / `renameWorkspace` /
 * `deleteWorkspace` / `refreshWorkspaces`), the switch flow that
 * swaps in a different workspace's collections + environments +
 * history, and the two window-state persistence helpers
 * (`setWindowState`, `persistTabsState`) which write debounced tab
 * snapshots into `workspace.window_state`.
 *
 * `persistTabsTimer` is module-scoped because it's an implementation
 * detail of the debouncing — nothing outside this slice has a
 * legitimate reason to inspect it.
 */

import { invoke } from "@tauri-apps/api/core";
import type { StoreApi } from "zustand";

import type {
  Collection,
  Environment,
  HistoryEntry,
  Workspace,
} from "../../types";
import { createNewRequest, historyEntryToRequest } from "../storeHelpers";
import { syncDerived, type RequestState } from "../storeTypes";

/**
 * Debounce token for tab persistence. Tab content edits fire on every
 * keystroke (URL bar, body editor, ...) and we don't want to serialize +
 * fsync the workspace JSON that often. 500 ms is long enough to coalesce
 * burst typing without losing work if the user closes the window.
 *
 * Module-scoped so `persistTabsState` and `switchWorkspace` share the
 * same timer (the latter needs to flush any pending write before
 * swapping workspaces, otherwise the new workspace's tabs would
 * overwrite the previous one's pending snapshot).
 */
let persistTabsTimer: ReturnType<typeof setTimeout> | null = null;

/** Subset of `RequestState` exposed by this slice. */
export type WorkspaceSlice = Pick<
  RequestState,
  | "saveWorkspaceState"
  | "switchWorkspace"
  | "createWorkspace"
  | "renameWorkspace"
  | "deleteWorkspace"
  | "refreshWorkspaces"
  | "setWindowState"
  | "persistTabsState"
>;

export function createWorkspaceSlice(
  set: StoreApi<RequestState>["setState"],
  get: StoreApi<RequestState>["getState"],
): WorkspaceSlice {
  return {
    saveWorkspaceState: async () => {
      const { workspace } = get();
      if (!workspace) return;
      const updated = { ...workspace, updated_at: Date.now() };
      invoke("save_workspace", { workspace: updated }).catch((err) =>
        console.error("Failed to save workspace:", err),
      );
    },

    switchWorkspace: async (workspaceId) => {
      const { workspaces, workspace: current } = get();
      if (current?.id === workspaceId) return;
      const target = workspaces.find((w) => w.id === workspaceId);
      if (!target) {
        console.error("Cannot switch to unknown workspace:", workspaceId);
        return;
      }

      // Cancel any in-flight requests and close any open streams from the old
      // workspace's tabs — they're scoped to the previous workspace and
      // shouldn't survive the switch.
      const prev = get();
      Object.entries(prev.loadings)
        .filter(([, v]) => v)
        .forEach(([id]) =>
          invoke("cancel_request", { requestId: id }).catch(() => {}),
        );
      Object.entries(prev.wsConnected)
        .filter(([, v]) => v)
        .forEach(([id]) =>
          invoke("ws_close", { requestId: id }).catch(() => {}),
        );
      Object.entries(prev.sseConnected)
        .filter(([, v]) => v)
        .forEach(([id]) =>
          invoke("sse_close", { requestId: id }).catch(() => {}),
        );

      // Flush any pending tab persistence for the workspace we're leaving so
      // we don't lose recently typed-into tabs across the switch.
      if (persistTabsTimer) {
        clearTimeout(persistTabsTimer);
        persistTabsTimer = null;
        if (prev.workspace) {
          const window_state = {
            ...(prev.workspace.window_state ?? {}),
            open_tabs: prev.tabs,
            active_tab_id: prev.activeTabId ?? undefined,
          };
          const flushed: Workspace = {
            ...prev.workspace,
            window_state,
            updated_at: Date.now(),
          };
          invoke("save_workspace", { workspace: flushed }).catch((err) =>
            console.error("Failed to flush previous workspace tabs:", err),
          );
        }
      }

      try {
        const [collections, environments, historyEntries] = await Promise.all([
          invoke<Collection[]>("list_collections", { workspaceId }),
          invoke<Environment[]>("list_environments", { workspaceId }),
          invoke<HistoryEntry[]>("get_history", {
            workspaceId,
            limit: 50,
            offset: 0,
          }),
        ]);
        const history = historyEntries.map(historyEntryToRequest);

        // Restore the target workspace's tabs from its window_state, if any.
        // Falls back to a single fresh blank tab when no snapshot exists.
        const savedTabs = target.window_state?.open_tabs;
        const savedActiveId = target.window_state?.active_tab_id;
        const hasSnapshot = Array.isArray(savedTabs) && savedTabs.length > 0;
        const restoredTabs = hasSnapshot ? savedTabs! : [createNewRequest()];
        const restoredActiveId = hasSnapshot
          ? savedActiveId && restoredTabs.some((t) => t.id === savedActiveId)
            ? savedActiveId
            : restoredTabs[0].id
          : restoredTabs[0].id;

        set((s) => ({
          workspace: target,
          collections,
          environments,
          history,
          tabs: restoredTabs,
          activeTabId: restoredActiveId,
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
            tabs: restoredTabs,
            activeTabId: restoredActiveId,
            responses: {},
            errors: {},
            loadings: {},
          }),
        }));
      } catch (err) {
        console.error("Failed to switch workspace:", err);
      }
    },

    createWorkspace: async (name) => {
      const ws = await invoke<Workspace>("create_workspace", { name });
      set((s) => ({ workspaces: [...s.workspaces, ws] }));
      await get().switchWorkspace(ws.id);
      return ws;
    },

    renameWorkspace: async (id, name) => {
      const { workspaces, workspace } = get();
      const target = workspaces.find((w) => w.id === id);
      if (!target) return;
      const updated: Workspace = { ...target, name, updated_at: Date.now() };
      await invoke("save_workspace", { workspace: updated });
      set((s) => ({
        workspaces: s.workspaces.map((w) => (w.id === id ? updated : w)),
        workspace: workspace?.id === id ? updated : s.workspace,
      }));
    },

    deleteWorkspace: async (id) => {
      const { workspaces, workspace } = get();
      if (workspaces.length <= 1) {
        throw new Error("Cannot delete the last remaining workspace.");
      }
      await invoke("delete_workspace", { id });
      const remaining = workspaces.filter((w) => w.id !== id);
      set({ workspaces: remaining });
      if (workspace?.id === id) {
        // Switch to whichever workspace is left, preferring the oldest.
        const fallback = remaining[0];
        await get().switchWorkspace(fallback.id);
      }
    },

    refreshWorkspaces: async () => {
      const workspaces = await invoke<Workspace[]>("list_workspaces");
      set({ workspaces });
    },

    setWindowState: (patch) => {
      set((state) => {
        if (!state.workspace) return state;
        const next = { ...(state.workspace.window_state ?? {}), ...patch };
        return {
          workspace: { ...state.workspace, window_state: next },
        };
      });
      get().saveWorkspaceState();
    },

    persistTabsState: () => {
      if (persistTabsTimer) clearTimeout(persistTabsTimer);
      persistTabsTimer = setTimeout(() => {
        persistTabsTimer = null;
        const state = get();
        if (!state.workspace) return;
        const next = {
          ...(state.workspace.window_state ?? {}),
          open_tabs: state.tabs,
          active_tab_id: state.activeTabId ?? undefined,
        };
        const updated: Workspace = {
          ...state.workspace,
          window_state: next,
          updated_at: Date.now(),
        };
        // Reflect locally so subsequent reads see the new state. Avoid the
        // standard `setWindowState` action so we don't fire a redundant
        // workspace save — the invoke below handles it.
        set({ workspace: updated });
        invoke("save_workspace", { workspace: updated }).catch((err) =>
          console.error("Failed to persist tabs:", err),
        );
      }, 500);
    },
  };
}
