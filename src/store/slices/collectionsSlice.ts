/**
 * Slice owning collections + the nested folder tree inside them.
 * Three logical groups of actions all backed by the same
 * `save_collection` / `delete_collection` / `list_collections` Tauri
 * commands:
 *
 *   1. **Collection CRUD** (`addCollection`, `deleteCollection`,
 *      `renameCollection`, `reorderCollections`, `refreshCollections`,
 *      `importPostmanCollection`, `importCollections`,
 *      `updateCollection`, `setCollectionAuth`,
 *      `setCollectionVariables`, `setGlobalVariables`).
 *   2. **Request-in-collection ops** (`addRequestToCollection`,
 *      `loadRequestFromCollection`, `deleteRequestFromCollection`,
 *      `renameRequestInCollection`, `reorderRequestsInCollection`).
 *   3. **Folder ops** (`createFolder`, `renameFolder`, `deleteFolder`,
 *      `moveRequestToFolder`, `moveFolderToFolder`,
 *      `reorderFoldersInCollection`).
 *
 * Every mutating action writes the full updated collection back via
 * `save_collection`. The underlying tree manipulation is delegated to
 * the pure helpers in `utils/folderTree.ts` so the same logic is
 * unit-testable independently of the Zustand wiring.
 */

import { invoke } from "@tauri-apps/api/core";
import type { StoreApi } from "zustand";

import type {
  AuthConfig,
  Collection,
  CollectionRequest,
  HttpMethod,
  RequestItem,
} from "../../types";
import {
  addFolderTo,
  createNewFolder,
  removeFolder,
  renameFolder as renameFolderInTree,
  removeRequest as removeRequestFromTree,
  renameRequest as renameRequestInTree,
  moveRequest,
  moveFolder,
  reorderFoldersInContainer,
  reorderRequestsInContainer,
  type NodeContainer,
} from "../../utils/folderTree";
import { postmanToCollection } from "../../utils/postman";
import {
  createEmptyKeyValue,
  findRequestInCollection,
  generateId,
  updateActiveTab,
} from "../storeHelpers";
import { activeTab, type RequestState } from "../storeTypes";

/** Subset of `RequestState` exposed by this slice. */
export type CollectionsSlice = Pick<
  RequestState,
  | "addCollection"
  | "deleteCollection"
  | "renameCollection"
  | "addRequestToCollection"
  | "loadRequestFromCollection"
  | "deleteRequestFromCollection"
  | "renameRequestInCollection"
  | "reorderCollections"
  | "reorderRequestsInCollection"
  | "createFolder"
  | "renameFolder"
  | "deleteFolder"
  | "moveRequestToFolder"
  | "moveFolderToFolder"
  | "reorderFoldersInCollection"
  | "importPostmanCollection"
  | "importCollections"
  | "updateCollection"
  | "setCollectionAuth"
  | "setCollectionVariables"
  | "setGlobalVariables"
  | "refreshCollections"
>;

export function createCollectionsSlice(
  set: StoreApi<RequestState>["setState"],
  get: StoreApi<RequestState>["getState"],
): CollectionsSlice {
  return {
    addCollection: async (name) => {
      const now = Date.now();
      const { workspace } = get();
      const collection: Collection = {
        id: generateId(),
        name,
        description: "",
        requests: [],
        folders: [],
        created_at: now,
        updated_at: now,
        workspace_id: workspace?.id,
      };
      await invoke("save_collection", { collection });
      set((state) => ({ collections: [...state.collections, collection] }));
    },

    deleteCollection: async (id) => {
      await invoke("delete_collection", { id });
      set((state) => ({
        collections: state.collections.filter((c) => c.id !== id),
      }));
    },

    renameCollection: async (id, name) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === id);
      if (!col) return;
      const updated = { ...col, name, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({
        collections: state.collections.map((c) => (c.id === id ? updated : c)),
      }));
    },

    addRequestToCollection: async (collectionId) => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      const col = state.collections.find((c) => c.id === collectionId);
      if (!col) return;
      const now = Date.now();
      // Default new collection requests to inheriting auth from the
      // collection/folder. If the user already configured concrete auth on
      // this tab, keep it.
      const auth: AuthConfig =
        req.auth && req.auth.auth_type !== "inherit"
          ? req.auth
          : { auth_type: "inherit" };
      const colReq: CollectionRequest = {
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
        created_at: req.createdAt,
        updated_at: now,
      };
      // Tag the open tab with its source collection so future inheritance
      // resolution works without a reload.
      set((s) => ({
        ...updateActiveTab(s, { collectionId, auth }),
      }));
      const updated = {
        ...col,
        requests: [...col.requests, colReq],
        updated_at: now,
      };
      await invoke("save_collection", { collection: updated });
      set((s) => ({
        collections: s.collections.map((c) =>
          c.id === collectionId ? updated : c,
        ),
      }));
    },

    loadRequestFromCollection: (collectionId, requestId) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const req = findRequestInCollection(col, requestId);
      if (!req) return;
      const requestItem: RequestItem = {
        // Keep the original collection request id (not a freshly generated
        // one) so the auth-inheritance walker can locate this request's
        // parent folder inside the collection tree. Re-opening the same
        // collection request reactivates the existing tab.
        id: req.id,
        name: req.name,
        method: req.method as HttpMethod,
        url: req.url,
        headers: req.headers.length > 0 ? req.headers : [createEmptyKeyValue()],
        params: req.params.length > 0 ? req.params : [createEmptyKeyValue()],
        body: req.body,
        bodyType: req.body_type as RequestItem["bodyType"],
        formData: [createEmptyKeyValue()],
        auth: req.auth,
        collectionId,
        preScript: req.pre_script,
        testScript: req.test_script,
        tags: req.tags,
        protocol: "http",
        createdAt: req.created_at,
      };
      get().openTab(requestItem);
      // Fire-and-forget — don't block the tab switch on persistence.
      get()
        .recordRecent({
          item_type: "request",
          item_id: `${collectionId}:${req.id}`,
          name: req.name,
        })
        .catch(() => {});
    },

    deleteRequestFromCollection: async (collectionId, requestId) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      // Walk the whole tree — requests can live inside nested folders
      // since the folder UI shipped. The earlier root-only filter silently
      // succeeded for nested requests.
      const next = removeRequestFromTree(col, requestId);
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({
        collections: state.collections.map((c) =>
          c.id === collectionId ? updated : c,
        ),
      }));
    },

    renameRequestInCollection: async (collectionId, requestId, name) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      // Walk the tree for the same reason as deleteRequestFromCollection.
      const next = renameRequestInTree(col, requestId, name);
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({
        collections: state.collections.map((c) =>
          c.id === collectionId ? updated : c,
        ),
      }));
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
      // Delegate to the folder-tree helper so reorders also work inside
      // nested folders (not just at the collection root).
      const next = reorderRequestsInContainer(col, fromId, toId);
      if (next === col) return;
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({
        collections: state.collections.map((c) =>
          c.id === collectionId ? updated : c,
        ),
      }));
    },

    createFolder: async (collectionId, parentFolderId, name) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const folder = createNewFolder(name);
      const container: NodeContainer =
        parentFolderId === null
          ? { kind: "root" }
          : { kind: "folder", folderId: parentFolderId };
      const next = addFolderTo(col, container, folder);
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({
        collections: state.collections.map((c) =>
          c.id === collectionId ? updated : c,
        ),
      }));
    },

    renameFolder: async (collectionId, folderId, name) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const next = renameFolderInTree(col, folderId, name);
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({
        collections: state.collections.map((c) =>
          c.id === collectionId ? updated : c,
        ),
      }));
    },

    deleteFolder: async (collectionId, folderId) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const next = removeFolder(col, folderId);
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({
        collections: state.collections.map((c) =>
          c.id === collectionId ? updated : c,
        ),
      }));
    },

    moveRequestToFolder: async (collectionId, requestId, targetFolderId) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const target: NodeContainer =
        targetFolderId === null
          ? { kind: "root" }
          : { kind: "folder", folderId: targetFolderId };
      const next = moveRequest(col, requestId, target);
      if (next === col) return;
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({
        collections: state.collections.map((c) =>
          c.id === collectionId ? updated : c,
        ),
      }));
    },

    moveFolderToFolder: async (
      collectionId,
      folderId,
      targetParentFolderId,
    ) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const target: NodeContainer =
        targetParentFolderId === null
          ? { kind: "root" }
          : { kind: "folder", folderId: targetParentFolderId };
      const next = moveFolder(col, folderId, target);
      if (next === col) return;
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({
        collections: state.collections.map((c) =>
          c.id === collectionId ? updated : c,
        ),
      }));
    },

    reorderFoldersInCollection: async (
      collectionId,
      fromFolderId,
      toFolderId,
    ) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const next = reorderFoldersInContainer(col, fromFolderId, toFolderId);
      if (next === col) return;
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({
        collections: state.collections.map((c) =>
          c.id === collectionId ? updated : c,
        ),
      }));
    },

    importPostmanCollection: async (data) => {
      const cols = postmanToCollection(data);
      await get().importCollections(cols);
    },

    importCollections: async (cols) => {
      for (const col of cols) {
        await invoke("save_collection", { collection: col });
      }
      set((state) => ({ collections: [...state.collections, ...cols] }));
    },

    updateCollection: async (col) => {
      const updated = { ...col, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((s) => ({
        collections: s.collections.map((c) =>
          c.id === updated.id ? updated : c,
        ),
      }));
    },

    setCollectionAuth: async (collectionId, auth) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      await get().updateCollection({ ...col, auth });
    },

    setCollectionVariables: async (collectionId, variables) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      await get().updateCollection({ ...col, variables });
    },

    setGlobalVariables: async (variables) => {
      const { workspace } = get();
      if (!workspace) return;
      const updated = { ...workspace, variables, updated_at: Date.now() };
      set({ workspace: updated });
      try {
        await invoke("save_workspace", { workspace: updated });
      } catch (err) {
        console.error("Failed to persist global variables:", err);
      }
    },

    refreshCollections: async () => {
      const { workspace } = get();
      const collections = await invoke<Collection[]>("list_collections", {
        workspaceId: workspace?.id,
      });
      set({ collections });
    },
  };
}
