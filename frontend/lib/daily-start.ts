/**
 * Purpose: Explicit, idempotent browser-local daily draft bootstrap.
 * Current role: Shared POST client for the dashboard and attendance page.
 * Last meaningful change: 2026-10-18 — empty-day initialization.
 * Constraint: A new date has no copied assignments, closures, or availability rows.
 */
import { apiPost } from "@/lib/api";
import type { ChartDocument } from "@/lib/types";

export interface DailyStartResult {
  ok: true;
  created: boolean;
  document: ChartDocument;
}

export const ensureDailyDraft = (date: string) =>
  apiPost<DailyStartResult>(`/api/charts/${encodeURIComponent(date)}/ensure-draft`);
