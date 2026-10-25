// Purpose: Exception-only daily attendance over PostgreSQL availability rows.
// Current role: Active staff roster plus explicit historical facts, typed attendance, narrow writes.
// Last meaningful change: 2026-10-18 — retain finalized snapshot people outside the active directory.
// Constraint: attendance:v1 owns only its own rows; leave/training and assignments are untouched.
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { getSnapshot, projectChart, type ChartDocument, type DocAvailability, type DocPerson, type Lifecycle, type Queryable } from "./chart-document.js";
import { dailyDate, DailyStartError } from "./daily-start.js";

export const ATTENDANCE_GROUP = "attendance:v1";
export const ATTENDANCE_CATEGORIES = { PRESENT: "उपस्थित", ABSENT: "गैरहजर" } as const;
export type AttendanceStatus = "PRESENT" | "ABSENT" | "WEEKLY_OFF" | "UNRECORDED";
export type AttendanceSource = "MANUAL" | "AVAILABILITY" | "WEEKLY_OFF" | "DEFAULT" | "UNRECORDED";

export interface AttendanceRow {
  person: DocPerson;
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

// Exact aliases in the dedicated master field only. Unknown/free-form text is not interpreted.
const WEEKDAY_ALIASES: ReadonlyArray<readonly string[]> = [
  ["रविवार", "sunday", "sun"],
  ["सोमवार", "monday", "mon"],
  ["मंगळवार", "मंगलवार", "tuesday", "tue"],
  ["बुधवार", "wednesday", "wed"],
  ["गुरुवार", "गुरूवार", "thursday", "thu"],
  ["शुक्रवार", "षुक्रवार", "friday", "fri"],
  ["शनिवार", "षनिवार", "saturday", "sat"],
];

export function weeklyOffOnDate(value: string | null, date: string): boolean {
  dailyDate(date);
  return value !== null && WEEKDAY_ALIASES[new Date(`${date}T00:00:00Z`).getUTCDay()]
    .includes(value.trim().normalize("NFC").toLocaleLowerCase());
}

// Leave/training are displayed alongside attendance, not converted into a whole-day absence.
const TYPED_ABSENCES = new Set(["गैरहजर", "अनुपस्थित"]);

function appliesOn(row: DocAvailability, date: string): boolean {
  return (!row.windowStart || row.windowStart <= date) && (!row.windowEnd || row.windowEnd >= date);
}

/** A finalized view uses explicit snapshot facts only, never today's weekly-off defaults. */
async function readAttendance(
  db: Queryable,
  date: string,
  chart: { chart_id: string | number; lifecycle: Lifecycle } | undefined,
): Promise<AttendanceResult> {
  const chartId = chart ? Number(chart.chart_id) : null;
  const finalized = chart?.lifecycle === "FINALIZED";
  const document: ChartDocument | null = chartId === null ? null : finalized
    ? (await getSnapshot(db, chartId)).document
    : await projectChart(db, chartId);
  const staff = (await db.query(
    `SELECT s.staff_id, s.name_mr, s.rank_code, s.buckle_no, s.weekly_off,
            r.short_form_mr, r.name_mr AS rank_name_mr, r.cadre
       FROM staff_members s JOIN ranks r ON r.rank_code = s.rank_code
      WHERE s.active ORDER BY r.display_order, s.name_mr, s.staff_id`,
  )).rows;
  const availability = document?.availability ?? [];
  if (availability.some((row) => row.groupKey === ATTENDANCE_GROUP
    && (!row.person || !Object.values(ATTENDANCE_CATEGORIES).includes(row.category as "उपस्थित" | "गैरहजर")
      || row.windowStart !== null || row.windowEnd !== null || row.timeStart !== null || row.timeEnd !== null))) {
    throw new DailyStartError("Attendance record needs review; no record was overwritten", 409);
  }
  const roster = new Map<number, { person: DocPerson; weeklyOff: string | null }>(staff.map((member) => [Number(member.staff_id), {
    person: {
      staffId: Number(member.staff_id), nameMr: member.name_mr as string, rankCode: member.rank_code as string,
      rankShortFormMr: member.short_form_mr as string | null, rankNameMr: member.rank_name_mr as string,
      cadre: member.cadre as string, buckleNo: member.buckle_no as string | null,
    },
    weeklyOff: member.weekly_off as string | null,
  }]));
  if (finalized) {
    // Only explicit, applicable snapshot facts extend the roster; never freeze today's defaults.
    for (const fact of availability) {
      if (fact.person && appliesOn(fact, date) && !roster.has(fact.person.staffId)) {
        roster.set(fact.person.staffId, { person: fact.person, weeklyOff: null });
      }
    }
  }
  const rows = [...roster.values()].map((member): AttendanceRow => {
    const staffId = member.person.staffId;
    const related = availability.filter((row) => row.person?.staffId === staffId && appliesOn(row, date));
    const manual = related.filter((row) => row.groupKey === ATTENDANCE_GROUP);
    if (manual.length > 1 || manual.some((row) => !Object.values(ATTENDANCE_CATEGORIES).includes(row.category as "उपस्थित" | "गैरहजर"))) {
      throw new DailyStartError(`Attendance records for staff ${staffId} need review; no record was overwritten`, 409);
    }
    const others = related.filter((row) => row.groupKey !== ATTENDANCE_GROUP);
    const absence = others.find((row) => TYPED_ABSENCES.has(row.category) && !row.timeStart && !row.timeEnd);
    const weeklyOff = others.find((row) => row.category === "साप्ताहिक सुट्टी" && !row.timeStart && !row.timeEnd);
    const weeklyOffToday = !finalized && weeklyOffOnDate(member.weeklyOff, date);
    const status: AttendanceStatus = manual.length ? manual[0].category === ATTENDANCE_CATEGORIES.ABSENT ? "ABSENT" : "PRESENT"
      : absence ? "ABSENT"
      : weeklyOff || weeklyOffToday ? "WEEKLY_OFF"
      : finalized ? "UNRECORDED" : "PRESENT";
    const source: AttendanceSource = manual.length ? "MANUAL"
      : absence || weeklyOff ? "AVAILABILITY"
      : weeklyOffToday ? "WEEKLY_OFF"
      : finalized ? "UNRECORDED" : "DEFAULT";
    // Snapshot names win for explicit finalized facts. The remaining list is the live active directory.
    const savedPerson = finalized ? related.find((row) => row.person)?.person : null;
    return {
      person: savedPerson ?? member.person,
      weeklyOff: finalized ? null : member.weeklyOff,
      weeklyOffToday,
      status,
      present: status === "UNRECORDED" ? null : status === "PRESENT",
      source,
      attendanceId: manual.length ? manual[0].availabilityId : null,
      otherAvailability: others.map((row) => ({ availabilityId: row.availabilityId, category: row.category, timeStart: row.timeStart, timeEnd: row.timeEnd })),
    };
  });
  return { ok: true, date, chartId, lifecycle: chart?.lifecycle ?? null, rows };
}

/** GET is side-effect-free: selecting an unstarted date never inserts a chart or attendance. */
export async function getDailyAttendance(db: Queryable, date: string): Promise<AttendanceResult> {
  dailyDate(date);
  const ownsTx = !("release" in db);
  const client = ownsTx ? await (db as pg.Pool).connect() : db as pg.PoolClient;
  try {
    if (ownsTx) await client.query("BEGIN");
    // Serialize a read with finalize/attendance writes so a response never mixes their lifecycles.
    const chart = (await client.query(
      `SELECT chart_id, lifecycle FROM daily_charts WHERE chart_date = $1 FOR SHARE`, [date],
    )).rows[0];
    const result = await readAttendance(client, date, chart);
    if (ownsTx) await client.query("COMMIT");
    return result;
  } catch (error) {
    if (ownsTx) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (ownsTx) client.release();
  }
}

function staffIdentity(value: unknown): number {
  const id = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    throw new DailyStartError("staffId must be a positive integer", 400);
  }
  return id;
}

async function changeAttendance(
  db: Queryable,
  date: string,
  staffId: unknown,
  present: boolean | null,
): Promise<AttendanceResult> {
  dailyDate(date);
  const id = staffIdentity(staffId);
  const ownsTx = !("release" in db);
  const client = ownsTx ? await (db as pg.Pool).connect() : db as pg.PoolClient;
  try {
    if (ownsTx) await client.query("BEGIN");
    const chart = (await client.query(
      `SELECT chart_id, lifecycle FROM daily_charts WHERE chart_date = $1 FOR UPDATE`, [date],
    )).rows[0];
    if (!chart) throw new DailyStartError(`No chart for ${date}; start the empty draft first`, 404);
    if (chart.lifecycle === "FINALIZED") throw new DailyStartError("FINALIZED charts are immutable; use amendment", 409);
    const staff = (await client.query(`SELECT active FROM staff_members WHERE staff_id = $1`, [id])).rows[0];
    if (!staff) throw new DailyStartError(`No staff ${id}`, 404);
    if (!staff.active) throw new DailyStartError("Attendance can only be edited for active staff", 409);
    const existing = (await client.query(
      `SELECT availability_id, category, window_start, window_end, time_start, time_end
         FROM daily_availabilities WHERE chart_id = $1 AND staff_id = $2 AND group_key = $3 FOR UPDATE`,
      [chart.chart_id, id, ATTENDANCE_GROUP],
    )).rows;
    // A generic availability editor can address these rows too. Never silently consume a duplicate,
    // foreign category or hourly/ranged record masquerading as a whole-day attendance exception.
    if (existing.length > 1 || existing.some((row) => !Object.values(ATTENDANCE_CATEGORIES).includes(row.category)
      || row.window_start !== null || row.window_end !== null || row.time_start !== null || row.time_end !== null)) {
      throw new DailyStartError("Attendance record needs review; no record was overwritten", 409);
    }
    if (present === null) {
      await client.query(
        `DELETE FROM daily_availabilities WHERE chart_id = $1 AND staff_id = $2 AND group_key = $3`,
        [chart.chart_id, id, ATTENDANCE_GROUP],
      );
    } else if (existing.length) {
      await client.query(
        `UPDATE daily_availabilities SET category = $1 WHERE availability_id = $2 AND chart_id = $3`,
        [present ? ATTENDANCE_CATEGORIES.PRESENT : ATTENDANCE_CATEGORIES.ABSENT, existing[0].availability_id, chart.chart_id],
      );
    } else {
      await client.query(
        `INSERT INTO daily_availabilities (chart_id, staff_id, category, group_key)
         VALUES ($1, $2, $3, $4)`,
        [chart.chart_id, id, present ? ATTENDANCE_CATEGORIES.PRESENT : ATTENDANCE_CATEGORIES.ABSENT, ATTENDANCE_GROUP],
      );
    }
    const result = await readAttendance(client, date, chart);
    if (ownsTx) await client.query("COMMIT");
    return result;
  } catch (error) {
    if (ownsTx) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (ownsTx) client.release();
  }
}

export async function setDailyAttendance(db: Queryable, date: string, staffId: unknown, input: unknown): Promise<AttendanceResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).length !== 1 || !("present" in input) || typeof input.present !== "boolean") {
    throw new DailyStartError("Send only { present: true | false }", 400);
  }
  return changeAttendance(db, date, staffId, input.present);
}

export const clearDailyAttendance = (db: Queryable, date: string, staffId: unknown): Promise<AttendanceResult> =>
  changeAttendance(db, date, staffId, null);

export function registerAttendanceRoutes(app: FastifyInstance, db: Queryable): void {
  app.get("/api/charts/:date/attendance", async (req, reply) => {
    try {
      return await getDailyAttendance(db, (req.params as { date: string }).date);
    } catch (error) {
      if (error instanceof DailyStartError) return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  });
  app.put("/api/charts/:date/attendance/:staffId", async (req, reply) => {
    const { date, staffId } = req.params as { date: string; staffId: string };
    try {
      return await setDailyAttendance(db, date, staffId, req.body);
    } catch (error) {
      if (error instanceof DailyStartError) return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  });
  app.delete("/api/charts/:date/attendance/:staffId", async (req, reply) => {
    const { date, staffId } = req.params as { date: string; staffId: string };
    try {
      return await clearDailyAttendance(db, date, staffId);
    } catch (error) {
      if (error instanceof DailyStartError) return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  });
}
