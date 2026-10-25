/**
 * Purpose: Read and persist the local chrome language without requiring browser storage.
 * Current role: Pure, injected storage access for locale initialization and selection.
 * Last meaningful change: 2026-10-18 — guard storage property and method denial.
 * Constraint: English is the default; a denied write must not interrupt in-memory changes.
 */
export type Locale = "en" | "mr";

export const LOCALE_STORAGE_KEY = "panchavati-locale";

export function readLocalePreference(getStorage: () => Pick<Storage, "getItem"> | null | undefined): Locale {
  try {
    const stored = getStorage()?.getItem(LOCALE_STORAGE_KEY);
    return stored === "mr" || stored === "en" ? stored : "en";
  } catch {
    return "en";
  }
}

export function persistLocalePreference(getStorage: () => Pick<Storage, "setItem"> | null | undefined, locale: Locale): boolean {
  try {
    const storage = getStorage();
    if (!storage) return false;
    storage.setItem(LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}
