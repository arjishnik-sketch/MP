/**
 * Purpose: Local-only theme preference and pre-paint bootstrap.
 * Current role: Shared safe preference rules for the shell and document head.
 * Last meaningful change: 2026-10-18 — persistent semantic light/dark themes.
 * Constraint: Storage may be denied; theme selection must remain usable in memory.
 */
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "panchavati-theme";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

export function resolveTheme(preference: unknown, prefersDark = false): Theme {
  return isTheme(preference) ? preference : prefersDark ? "dark" : "light";
}

export function readThemePreference(storage: Pick<Storage, "getItem"> | null | undefined): Theme | null {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function persistThemePreference(storage: Pick<Storage, "setItem"> | null | undefined, theme: Theme): boolean {
  try {
    if (!storage) return false;
    storage.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

// Runs in the head before paint; every API that privacy settings can deny is guarded.
// This is static local code, never a place to interpolate chart or user content.
export const THEME_BOOTSTRAP = `(function(){var t=null;try{t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}if(t!=="light"&&t!=="dark"){try{t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){t="light"}}var r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t})();`;
