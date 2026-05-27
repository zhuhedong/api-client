/**
 * Slice owning every persisted app-wide default surfaced by the
 * Settings panel. Seven write-through setters; each one persists to
 * SQLite via the `set_setting` Tauri command first, then mirrors the
 * value into the in-memory store so reactive subscribers see the new
 * value immediately.
 *
 * Setters swallow persistence errors with a `console.error` rather
 * than rejecting — the user-visible effect (the new default) still
 * applies for the current session, which is the more useful outcome
 * than refusing the change. The next launch reloads from SQLite and
 * will fall back to the previous value if the write actually failed.
 */

import { invoke } from "@tauri-apps/api/core";
import type { StoreApi } from "zustand";

import type { RequestState } from "../storeTypes";

/** Subset of `RequestState` exposed by this slice. */
export type SettingsSlice = Pick<
  RequestState,
  | "setDefaultTimeoutMs"
  | "setVerifyTlsDefault"
  | "setMaxBodyBytes"
  | "setMaxHistoryBodyBytes"
  | "setDefaultRedirectPolicy"
  | "setDefaultMaxRedirects"
  | "setDefaultProxyUrl"
>;

export function createSettingsSlice(
  set: StoreApi<RequestState>["setState"],
  _get: StoreApi<RequestState>["getState"],
): SettingsSlice {
  return {
    setDefaultTimeoutMs: async (ms) => {
      try {
        await invoke("set_setting", {
          key: "default_timeout_ms",
          value: String(ms),
        });
      } catch (err) {
        console.error("Failed to persist default timeout:", err);
      }
      set({ defaultTimeoutMs: ms });
    },

    setVerifyTlsDefault: async (verify) => {
      try {
        await invoke("set_setting", {
          key: "verify_tls_default",
          value: verify ? "true" : "false",
        });
      } catch (err) {
        console.error("Failed to persist verify-tls default:", err);
      }
      set({ verifyTlsDefault: verify });
    },

    setMaxBodyBytes: async (bytes) => {
      try {
        await invoke("set_setting", {
          key: "max_body_bytes",
          value: String(bytes),
        });
      } catch (err) {
        console.error("Failed to persist max body bytes:", err);
      }
      set({ maxBodyBytes: bytes });
    },

    setMaxHistoryBodyBytes: async (bytes) => {
      try {
        await invoke("set_setting", {
          key: "max_history_body_bytes",
          value: String(bytes),
        });
      } catch (err) {
        console.error("Failed to persist max history body bytes:", err);
      }
      set({ maxHistoryBodyBytes: bytes });
    },

    setDefaultRedirectPolicy: async (policy) => {
      try {
        await invoke("set_setting", {
          key: "default_redirect_policy",
          value: policy,
        });
      } catch (err) {
        console.error("Failed to persist default redirect policy:", err);
      }
      set({ defaultRedirectPolicy: policy });
    },

    setDefaultMaxRedirects: async (n) => {
      try {
        await invoke("set_setting", {
          key: "default_max_redirects",
          value: String(n),
        });
      } catch (err) {
        console.error("Failed to persist default max redirects:", err);
      }
      set({ defaultMaxRedirects: n });
    },

    setDefaultProxyUrl: async (url) => {
      const trimmed = url.trim();
      try {
        await invoke("set_setting", {
          key: "default_proxy_url",
          value: trimmed,
        });
      } catch (err) {
        console.error("Failed to persist default proxy URL:", err);
      }
      set({ defaultProxyUrl: trimmed });
    },
  };
}
