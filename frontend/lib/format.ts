import type { Assignment, Person } from "./types";

const WEEKDAYS_MR = ["रविवार", "सोमवार", "मंगळवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];

export function weekdayMr(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "" : WEEKDAYS_MR[parsed.getUTCDay()];
}

export function dateLabel(date: string): string {
  const [year, month, day] = date.split("-");
  return year && month && day ? `${day}/${month}/${year}` : date;
}

/** Return the browser's local calendar date without UTC rollover. */
export function localDateIso(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function personLabel(person: Person | null): string {
  if (!person) return "रिक्त";
  const rank = person.rankShortFormMr || person.rankCode || "";
  const buckle = person.buckleNo ? ` ${person.buckleNo}` : "";
  return `${rank}${buckle} ${person.nameMr}`.trim();
}

export function compactPersonLabel(person: Person | null): string {
  if (!person) return "रिक्त";
  // Same display grammar as the source/legacy chart; the full master name stays
  // available in the chart's title, accessible label and explicit person editor.
  const words = person.nameMr.trim().split(/\s+/).filter(Boolean);
  const surname = words.at(-1) ?? person.nameMr;
  const name = person.buckleNo || (person.cadre && person.cadre !== "OFFICER")
    ? surname : words.length > 2 ? `${words[0]} ${surname}` : words.join(" ");
  return `${person.rankShortFormMr || person.rankCode}${person.buckleNo ? ` ${person.buckleNo}` : ""} ${name}`.trim();
}

export function timeLabel(assignment: Assignment): string {
  if (!assignment.startTime || !assignment.endTime) return "";
  return `${assignment.startTime} ते ${assignment.endTime}`;
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function displayDateTime(value: string): string {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

export function isDateInPast(date: string): boolean {
  const today = new Date();
  const iso = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())).toISOString().slice(0, 10);
  return date < iso;
}
