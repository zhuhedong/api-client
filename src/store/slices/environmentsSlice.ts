/**
 * Slice owning the environments list. Five actions cover the CRUD
 * surface plus the workspace-scoped "active environment" pointer:
 *
 *   - `addEnvironment` / `deleteEnvironment` / `updateEnvironment`
 *   - `refreshEnvironments` (reload from SQLite, called after
 *     workspace switch)
 *   - `setActiveEnvironment` (writes through to
 *     `workspace.active_environment_id` so the choice persists
 *     across launches)
 *
 * Persistence is via the `save_environment` / `delete_environment` /
 * `list_environments` Tauri commands. All environments are scoped to
 * the current workspace by `workspace_id`.
 */

import { invoke } from "@tauri-apps/api/core";
import type { StoreApi } from "zustand";

import type { Environment } from "../../types";
import { generateId } from "../storeHelpers";
import type { RequestState } from "../storeTypes";

/** Subset of `RequestState` exposed by this slice. */
export type EnvironmentsSlice = Pick<
  RequestState,
  | "addEnvironment"
  | "deleteEnvironment"
  | "updateEnvironment"
  | "refreshEnvironments"
  | "setActiveEnvironment"
>;

export function createEnvironmentsSlice(
  set: StoreApi<RequestState>["setState"],
  get: StoreApi<RequestState>["getState"],
): EnvironmentsSlice {
  return {
    addEnvironment: async (name) => {
      const now = Date.now();
      const { workspace } = get();
      const env: Environment = {
        id: generateId(),
        name,
        variables: [],
        created_at: now,
        updated_at: now,
        workspace_id: workspace?.id,
      };
      await invoke("save_environment", { env });
      set((state) => ({ environments: [...state.environments, env] }));
    },

    deleteEnvironment: async (id) => {
      await invoke("delete_environment", { id });
      set((state) => ({
        environments: state.environments.filter((e) => e.id !== id),
      }));
    },

    updateEnvironment: async (env) => {
      const updated = { ...env, updated_at: Date.now() };
      await invoke("save_environment", { env: updated });
      set((state) => ({
        environments: state.environments.map((e) =>
          e.id === env.id ? updated : e,
        ),
      }));
    },

    refreshEnvironments: async () => {
      const { workspace } = get();
      const environments = await invoke<Environment[]>("list_environments", {
        workspaceId: workspace?.id,
      });
      set({ environments });
    },

    setActiveEnvironment: (id) => {
      set((state) => ({
        workspace: state.workspace
          ? { ...state.workspace, active_environment_id: id ?? undefined }
          : null,
      }));
      get().saveWorkspaceState();
    },
  };
}
