/**
 * Purpose: Typed daily attendance API boundary.
 * Current role: Read defaults and save only the clerk's per-person exceptions.
 * Last meaningful change: 2026-10-18 — PostgreSQL attendance client.
 * Constraint: No attendance state is saved in localStorage; no assignments are created.
 */
import { apiDelete, apiFetch } from "@/lib/api";
import type { Lifecycle, Person } from "@/lib/types";

/** Reserved persistence namespace; render as a human attendance heading in chart detail views. */
export const ATTENDANCE_GROUP = "attendance:v1";
export type AttendanceStatus = "PRESENT" | "ABSENT" | "WEEKLY_OFF" | "UNRECORDED";
export type AttendanceSource = "MANUAL" | "AVAILABILITY" | "WEEKLY_OFF" | "DEFAULT" | "UNRECORDED";

export interface AttendanceRow {
  person: Person;
  weeklyOff: string | null;
  weeklyOffToday: boolean;
  status: AttendanceStatus;
  present: boolean | null;
  source: AttendanceSource;
  attendanceId: number | null;
  otherAvailability: { availabilityId: number; category: string; timeStart: string | null; timeEnd: string | null }[];
}

export interface AttendanceResult {
  ok: true;
  date: string;
  chartId: number | null;
  lifecycle: Lifecycle | null;
  rows: AttendanceRow[];
}

const pathFor = (date: string) => `/api/charts/${encodeURIComponent(date)}/attendance`;

export const getDailyAttendance = (date: string) => apiFetch<AttendanceResult>(pathFor(date));

export const setDailyAttendance = (date: string, staffId: number, present: boolean) =>
  apiFetch<AttendanceResult>(`${pathFor(date)}/${staffId}`, { method: "PUT", body: JSON.stringify({ present }) });

export const clearDailyAttendance = (date: string, staffId: number) =>
  apiDelete<AttendanceResult>(`${pathFor(date)}/${staffId}`);

export const attendanceLabels: Record<AttendanceStatus, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  WEEKLY_OFF: "Weekly off",
  UNRECORDED: "Not recorded",
};
