/**
 * Purpose: Local, date-first archive search over the chart-reference response.
 * Current role: Combines multilingual weekday/date queries with explicit archive filters.
 * Last meaningful change: 2026-10-18 — English/Marathi weekday aliases and inclusive date ranges.
 * Constraint: Filtering preserves API order and never changes chart data or lifecycle.
 */
import type { ChartReference, Lifecycle } from "./types";

export const CHART_WEEKDAYS = [
  { value: "0", label: "Sunday", short: "Sun", marathi: "रविवार" },
  { value: "1", label: "Monday", short: "Mon", marathi: "सोमवार" },
  { value: "2", label: "Tuesday", short: "Tue", marathi: "मंगळवार" },
  { value: "3", label: "Wednesday", short: "Wed", marathi: "बुधवार" },
  { value: "4", label: "Thursday", short: "Thu", marathi: "गुरुवार" },
  { value: "5", label: "Friday", short: "Fri", marathi: "शुक्रवार" },
  { value: "6", label: "Saturday", short: "Sat", marathi: "शनिवार" },
] as const;

export type ChartWeekdayFilter = "ALL" | (typeof CHART_WEEKDAYS)[number]["value"];
export type ChartLifecycleFilter = "ALL" | Lifecycle;

export type ChartSearchFilters = {
  query?: string;
  weekday?: ChartWeekdayFilter;
  lifecycle?: ChartLifecycleFilter;
  from?: string;
  to?: string;
};

function normalize(value: string): string {
  return value.normalize("NFC")
    .replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - "०".charCodeAt(0)))
    .toLocaleLowerCase()
    .trim();
}

export function filterCharts(charts: readonly ChartReference[], filters: ChartSearchFilters = {}): ChartReference[] {
  const terms = normalize(filters.query ?? "").split(/\s+/).filter(Boolean);
  return charts.filter((chart) => {
    const weekday = CHART_WEEKDAYS[new Date(`${chart.date}T00:00:00Z`).getUTCDay()];
    if (filters.weekday && filters.weekday !== "ALL" && weekday?.value !== filters.weekday) return false;
    if (filters.lifecycle && filters.lifecycle !== "ALL" && chart.lifecycle !== filters.lifecycle) return false;
    if (filters.from && chart.date < filters.from) return false;
    if (filters.to && chart.date > filters.to) return false;

    const searchable = normalize([
      chart.date,
      chart.date.split("-").reverse().join("/"),
      weekday?.label,
      weekday?.short,
      weekday?.marathi,
      chart.lifecycle,
    ].filter(Boolean).join(" "));
    return terms.every((term) => searchable.includes(term));
  });
}
