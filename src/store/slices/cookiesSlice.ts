/**
 * Slice owning the persistent cookie jar. Four actions covering load,
 * single-cookie delete, per-domain clear, and a full wipe across all
 * domains.
 *
 * The jar lives in SQLite on the Rust side; this slice keeps the
 * `cookies` array in memory mirrored to it so the Settings panel can
 * render without re-querying on every render.
 *
 * `clearAllCookies` issues one `clear_cookies_by_domain` per unique
 * domain rather than a single bulk command because the backend has no
 * "drop all" primitive yet — adding one would require touching the
 * cookie store's transaction boundaries and isn't worth it for a
 * settings-panel button.
 */

import { invoke } from "@tauri-apps/api/core";
import type { StoreApi } from "zustand";

import type { CookieEntry } from "../../types";
import type { RequestState } from "../storeTypes";

/** Subset of `RequestState` exposed by this slice. */
export type CookiesSlice = Pick<
  RequestState,
  "refreshCookies" | "deleteCookie" | "clearCookiesByDomain" | "clearAllCookies"
>;

export function createCookiesSlice(
  set: StoreApi<RequestState>["setState"],
  get: StoreApi<RequestState>["getState"],
): CookiesSlice {
  return {
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
      set((state) => ({
        cookies: state.cookies.filter((c) => c.id !== id),
      }));
    },

    clearCookiesByDomain: async (domain) => {
      await invoke("clear_cookies_by_domain", { domain });
      set((state) => ({
        cookies: state.cookies.filter((c) => c.domain !== domain),
      }));
    },

    clearAllCookies: async () => {
      const { cookies } = get();
      const domains = Array.from(
        new Set(cookies.map((c) => c.domain).filter(Boolean)),
      );
      for (const domain of domains) {
        try {
          await invoke("clear_cookies_by_domain", { domain });
        } catch (err) {
          console.error(`Failed to clear cookies for ${domain}:`, err);
        }
      }
      set({ cookies: [] });
    },
  };
}
