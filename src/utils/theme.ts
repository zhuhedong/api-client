/**
 * Single source of truth for the app's light/dark theme.
 *
 * Theme state lives on `<html class="dark">`. The user has three top-level
 * choices, persisted in `localStorage["theme_mode"]`:
 *   - "light" / "dark"  — explicit override.
 *   - "system"          — follow the OS `prefers-color-scheme`.
 *
 * For backwards compat with the old binary scheme (`localStorage["theme"]`
 * = "light" | "dark"), we read that first if the new key is missing.
 *
 * `applyInitialTheme()` is intentionally a plain function (not a hook) so
 * `main.tsx` can call it BEFORE React mounts — this avoids a flash of the
 * wrong theme during initial paint.
 *
 * `applyTheme(dark)` is the write path: components changing the theme
 * (currently the Sidebar toggle and SettingsPanel) should call this — never
 * touch `document.documentElement.classList` or `localStorage` directly.
 *
 * `setThemeMode(mode)` is the higher-level write path that toggles the
 * binary state correctly when `"system"` is selected (and re-evaluates if
 * the OS preference changes while the app is open).
 *
 * Components reading the current theme use `useDarkMode()` from
 * `./useDarkMode`, which is driven by a `MutationObserver` on `<html>` so
 * any caller of `applyTheme` correctly notifies every subscriber.
 */

const LEGACY_KEY = "theme";
const MODE_KEY = "theme_mode";

export type Theme = "light" | "dark";
export type ThemeMode = "light" | "dark" | "system";

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(MODE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  // Legacy single-value migration.
  const legacy = window.localStorage.getItem(LEGACY_KEY);
  if (legacy === "light" || legacy === "dark") return legacy;
  return "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/** Read the user's stored theme mode (defaults to `"system"`). */
export function getThemeMode(): ThemeMode {
  return readStoredMode();
}

/** Resolve a `ThemeMode` to the binary `"light" | "dark"` actually rendered. */
export function resolveTheme(mode: ThemeMode): Theme {
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return systemPrefersDark() ? "dark" : "light";
}

/** Read the persisted theme (or fall back to the OS preference). */
export function getInitialTheme(): Theme {
  return resolveTheme(readStoredMode());
}

/** Toggle the `dark` class on `<html>` (does NOT persist the user's choice;
 *  call `setThemeMode` from the UI). */
export function applyTheme(dark: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", dark);
  // Keep the legacy "theme" key in sync so older code reading it doesn't
  // break, but the source of truth is "theme_mode".
  try {
    window.localStorage.setItem(LEGACY_KEY, dark ? "dark" : "light");
  } catch {
    // localStorage may be unavailable in some embedded contexts; ignore.
  }
}

/** Persist the high-level mode and re-evaluate the binary `dark` state. */
export function setThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // ignore
  }
  applyTheme(resolveTheme(mode) === "dark");
}

// Bind a global listener once so a "system" choice re-renders when the OS
// preference flips (e.g. macOS dark-mode schedule). Only re-applies when
// the user has actually selected "system".
let systemListenerBound = false;
function bindSystemListener(): void {
  if (systemListenerBound) return;
  if (typeof window === "undefined" || !window.matchMedia) return;
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (readStoredMode() === "system") {
      applyTheme(mql.matches);
    }
  };
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange);
  } else if (typeof mql.addListener === "function") {
    // Safari fallback.
    mql.addListener(onChange);
  }
  systemListenerBound = true;
}

/** Convenience for the boot path. Reads the initial mode, applies it,
 *  and starts watching the OS preference. */
export function applyInitialTheme(): void {
  bindSystemListener();
  applyTheme(getInitialTheme() === "dark");
}
