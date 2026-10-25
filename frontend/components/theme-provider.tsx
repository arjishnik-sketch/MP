/**
 * Purpose: Application-wide theme selection without network or cookie dependencies.
 * Current role: Keep document colors, local preference and other open tabs in sync.
 * Last meaningful change: 2026-10-18 — safe persistence and system-default bootstrap.
 * Constraint: Storage denial must not prevent an in-memory theme change.
 */
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isTheme, persistThemePreference, readThemePreference, resolveTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

type ThemeContextValue = { theme: Theme; setTheme: (theme: Theme) => void; toggleTheme: () => void };
const ThemeContext = createContext<ThemeContextValue | null>(null);

function localStorageOrNull(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Match the server render; the head bootstrap has already applied the actual colors.
  const [theme, setThemeState] = useState<Theme>("light");
  const currentTheme = useRef<Theme>("light");
  const explicitPreference = useRef<Theme | null>(null);

  useEffect(() => {
    let media: MediaQueryList | null = null;
    try { media = window.matchMedia?.("(prefers-color-scheme: dark)") ?? null; } catch { /* Light is the fallback when browser preferences are unavailable. */ }
    explicitPreference.current = readThemePreference(localStorageOrNull());
    const bootstrapped = document.documentElement.dataset.theme;
    const initial = explicitPreference.current ?? (isTheme(bootstrapped) ? bootstrapped : resolveTheme(null, media?.matches));
    const update = (next: Theme) => {
      currentTheme.current = next;
      applyTheme(next);
      setThemeState(next);
    };
    update(initial);

    const onSystemChange = () => {
      if (explicitPreference.current === null) update(resolveTheme(null, media?.matches));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      if (event.storageArea && event.storageArea !== localStorageOrNull()) return;
      explicitPreference.current = isTheme(event.newValue) ? event.newValue : null;
      update(resolveTheme(explicitPreference.current, media?.matches));
    };
    media?.addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
    return () => {
      media?.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    explicitPreference.current = next;
    currentTheme.current = next;
    applyTheme(next);
    setThemeState(next);
    persistThemePreference(localStorageOrNull(), next);
  }, []);
  const toggleTheme = useCallback(() => {
    // Read the applied bootstrap value too, so an early hydration click is effective.
    const applied = document.documentElement.dataset.theme;
    const current = isTheme(applied) ? applied : currentTheme.current;
    setTheme(current === "dark" ? "light" : "dark");
  }, [setTheme]);
  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
