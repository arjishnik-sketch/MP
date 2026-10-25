/**
 * Purpose: Build honest date-menu options from saved chart references.
 * Current role: Today/tomorrow/yesterday shortcuts plus nonduplicated saved history.
 * Last meaningful change: 2026-10-18 — bounded toolbar menu data and localized date chrome.
 * Constraint: Missing dates never acquire a lifecycle or become navigable saved charts.
 */
import { CHART_WEEKDAYS } from "./chart-search";
import { dateLabel } from "./format";
import type { ChartReference, Lifecycle } from "./types";

export type ToolbarDateOption = { date: string; lifecycle: Lifecycle | null };
export type ToolbarDateGroup = { id: "today" | "tomorrow" | "yesterday" | "saved"; options: ToolbarDateOption[] };

function shiftDate(date: string, amount: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function normalize(value: string): string {
  return value.normalize("NFC")
    .replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - "०".charCodeAt(0)))
    .toLocaleLowerCase().trim();
}

export function toolbarWeekday(date: string, locale: "en" | "mr"): string {
  const day = CHART_WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return (locale === "mr" ? day?.marathi : day?.label) ?? "";
}

export function toolbarDateLabel(date: string, locale: "en" | "mr"): string {
  const value = dateLabel(date);
  return locale === "mr" ? value.replace(/\d/g, (digit) => "०१२३४५६७८९"[Number(digit)]) : value;
}

export function buildToolbarDateGroups(references: readonly ChartReference[], today: string, query = ""): ToolbarDateGroup[] {
  const relativeDates = [
    { id: "today" as const, date: today },
    { id: "tomorrow" as const, date: shiftDate(today, 1) },
    { id: "yesterday" as const, date: shiftDate(today, -1) },
  ];
  const byDate = new Map(references.map((reference) => [reference.date, reference]));
  const relativeSet = new Set(relativeDates.map((item) => item.date));
  const seenSaved = new Set<string>();
  const groups: ToolbarDateGroup[] = [
    ...relativeDates.map((item) => ({ id: item.id, options: [{ date: item.date, lifecycle: byDate.get(item.date)?.lifecycle ?? null }] })),
    {
      id: "saved",
      options: references.filter((reference) => {
        if (relativeSet.has(reference.date) || seenSaved.has(reference.date)) return false;
        seenSaved.add(reference.date);
        return true;
      }).map((reference) => ({ date: reference.date, lifecycle: reference.lifecycle })),
    },
  ];
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return groups;

  const aliases = { today: "Today आज", tomorrow: "Tomorrow उद्या", yesterday: "Yesterday काल", saved: "Saved history संदर्भ तक्ते जतन केलेले तक्ते" };
  return groups.map((group) => ({
    ...group,
    options: group.options.filter((option) => {
      const weekday = CHART_WEEKDAYS[new Date(`${option.date}T00:00:00Z`).getUTCDay()];
      const status = option.lifecycle === "DRAFT" ? "DRAFT मसुदा" : option.lifecycle === "VALIDATED" ? "VALIDATED पडताळलेला" : option.lifecycle === "FINALIZED" ? "FINALIZED अंतिम" : "No chart saved तक्ता जतन केलेला नाही";
      const searchable = normalize([option.date, dateLabel(option.date), weekday?.label, weekday?.short, weekday?.marathi, status, aliases[group.id]].filter(Boolean).join(" "));
      return terms.every((term) => searchable.includes(term));
    }),
  })).filter((group) => group.options.length > 0);
}
