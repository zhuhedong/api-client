/**
 * Slice owning the "Recently Opened" sidebar tab — four actions to
 * record a freshly-opened item, refresh the list from disk, and wipe
 * it (the sidebar's per-tab `clearRecent` and the Settings panel's
 * "Clear all data" entry point `clearAllRecent` both flush the same
 * underlying SQLite table; they exist as separate actions so the two
 * UI surfaces can render distinct loading / confirmation flows).
 *
 * The backing store is SQLite via the `add_recent` / `get_recent` /
 * `clear_recent` Tauri commands. The slice's only responsibility is
 * keeping the in-memory `recentItems` array in sync, deduping by
 * `(item_type, item_id)`, and clamping the visible list to 30 entries.
 */

import { invoke } from "@tauri-apps/api/core";
import type { StoreApi } from "zustand";

import type { RecentEntry } from "../../types";
import { generateId } from "../storeHelpers";
import type { RequestState } from "../storeTypes";

/** Subset of `RequestState` exposed by this slice. */
export type RecentSlice = Pick<
  RequestState,
  "recordRecent" | "refreshRecent" | "clearRecent" | "clearAllRecent"
>;

export function createRecentSlice(
  set: StoreApi<RequestState>["setState"],
  get: StoreApi<RequestState>["getState"],
): RecentSlice {
  return {
    recordRecent: async (input) => {
      // Cheap dedupe at the call site: if the most recent item is the same
      // (type+item_id), we skip the round-trip. Backend also dedupes by id
      // via INSERT OR REPLACE, but skipping avoids needless writes.
      const { recentItems } = get();
      const top = recentItems[0];
      if (
        top &&
        top.item_type === input.item_type &&
        top.item_id === input.item_id
      ) {
        return;
      }
      const entry: RecentEntry = {
        id: input.id ?? generateId(),
        item_type: input.item_type,
        item_id: input.item_id,
        name: input.name,
        opened_at: Date.now(),
      };
      try {
        await invoke("add_recent", { entry });
      } catch (err) {
        console.error("Failed to record recent:", err);
        return;
      }
      // Optimistically push to the head; clamp the visible list to 30.
      set((s) => ({
        recentItems: [
          entry,
          ...s.recentItems.filter(
            (r) =>
              !(r.item_type === entry.item_type && r.item_id === entry.item_id),
          ),
        ].slice(0, 30),
      }));
    },

    refreshRecent: async () => {
      try {
        const items = await invoke<RecentEntry[]>("get_recent", { limit: 30 });
        set({ recentItems: items });
      } catch (err) {
        console.error("Failed to refresh recent:", err);
      }
    },

    clearRecent: async () => {
      try {
        await invoke("clear_recent");
        set({ recentItems: [] });
      } catch (err) {
        console.error("Failed to clear recent:", err);
      }
    },

    clearAllRecent: async () => {
      try {
        await invoke("clear_recent");
      } catch (err) {
        console.error("Failed to clear recent:", err);
      }
      set({ recentItems: [] });
    },
  };
}
