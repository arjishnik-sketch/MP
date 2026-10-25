// Purpose: transactional CRUD for the chart's remaining normalized continuation data:
//   location operational state and daily availability rows.
// Current role: narrow Fastify routes + domain mutations over the Layer-B tables.
// Last meaningful change: 2026-10-18 — initial location-state and availability CRUD slice.
// Constraint/dependency: FINALIZED charts are immutable; all values are parameterized; location
//   बंद/चार्ज and assignment रिक्त/बिमा remain separate facts; Marathi detail is display-only.
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import {
  projectChart,
  type ChartDocument,
  type DocAvailability,
  type DocLocationState,
  type Queryable,
  type Shift,
} from "./chart-document.js";

export class ContinuationError extends Error {
  constructor(message: string, public readonly statusCode: 400 | 404 | 409) {
    super(message);
    this.name = "ContinuationError";
  }
}

type Body = Record<string, unknown>;

const isRecord = (value: unknown): value is Body =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hasOwn = (value: Body, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const SHIFTS = new Set<Shift>(["DAY", "NIGHT"]);
const MAX_ID = Number.MAX_SAFE_INTEGER;
const MAX_SORT_ORDER = 1_000_000;
const MAX_CATEGORY = 160;
const MAX_GROUP_KEY = 120;
const MAX_DETAIL = 400;

function validDate(value: unknown, field: string, nullable = true): string | null {
  if (value === null || value === undefined || value === "") {
    if (nullable) return null;
    throw new ContinuationError(`${field} is required`, 400);
  }
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    throw new ContinuationError(`${field} must be YYYY-MM-DD`, 400);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ContinuationError(`${field} must be a valid date`, 400);
  }
  return value;
}

function typedTime(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new ContinuationError(`${field} must be HH:MM or HH:MM:SS`, 400);
  const match = TIME_RE.exec(value);
  if (!match) throw new ContinuationError(`${field} must be HH:MM or HH:MM:SS`, 400);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) {
    throw new ContinuationError(`${field} must be a valid time`, 400);
  }
  return `${match[1]}:${match[2]}:${String(second).padStart(2, "0")}`;
}

function positiveInteger(value: unknown, field: string, max = MAX_ID): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new ContinuationError(`${field} must be a positive integer`, 400);
  }
  return parsed;
}

function nullablePositiveInteger(value: unknown, field: string): number | null {
  if (value === null) return null;
  return positiveInteger(value, field);
}

function nonNegativeInteger(value: unknown, field: string, max: number): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) {
    throw new ContinuationError(`${field} must be a whole number between 0 and ${max}`, 400);
  }
  return parsed;
}

function safeText(value: unknown, field: string, max: number, required: boolean): string | null {
  if (value === null || value === undefined) {
    if (required) throw new ContinuationError(`${field} is required`, 400);
    return null;
  }
  if (typeof value !== "string") throw new ContinuationError(`${field} must be text`, 400);
  const text = value.trim();
  if (required && text === "") throw new ContinuationError(`${field} is required`, 400);
  if (text.length > max) throw new ContinuationError(`${field} is too long (max ${max} characters)`, 400);
  if (/[\u0000-\u001f\u007f<>]/.test(text)) {
    throw new ContinuationError(`${field} contains invalid characters`, 400);
  }
  return text || null;
}

function shiftValue(value: unknown): Shift {
  if (typeof value !== "string" || !SHIFTS.has(value as Shift)) {
    throw new ContinuationError("shift must be DAY or NIGHT", 400);
  }
  return value as Shift;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new ContinuationError(`${field} must be true or false`, 400);
  return value;
}

function requireBody(value: unknown, name: string): Body {
  if (!isRecord(value)) throw new ContinuationError(`${name} body must be an object`, 400);
  return value;
}

interface ChartContext {
  chartId: number;
  client: pg.PoolClient;
  ownsTx: boolean;
}

/** Lock the chart before checking lifecycle and mutate only inside this transaction. */
async function withWritableChart<T>(
  db: Queryable,
  date: string,
  fn: (context: ChartContext) => Promise<T>,
): Promise<T> {
  validDate(date, "date", false);
  const ownsTx = !("release" in db);
  const client = ownsTx ? await (db as pg.Pool).connect() : db as pg.PoolClient;
  try {
    if (ownsTx) await client.query("BEGIN");
    const rows = (await client.query(
      `SELECT chart_id, lifecycle FROM daily_charts WHERE chart_date = $1 FOR UPDATE`, [date],
    )).rows;
    if (rows.length !== 1) throw new ContinuationError(`no chart for ${date}`, 404);
    if (rows[0].lifecycle === "FINALIZED") {
      throw new ContinuationError("FINALIZED charts are immutable; use amendment", 409);
    }
    const result = await fn({ chartId: Number(rows[0].chart_id), client, ownsTx });
    if (ownsTx) await client.query("COMMIT");
    return result;
  } catch (error) {
    if (ownsTx) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (ownsTx) client.release();
  }
}

function locationStateFrom(document: ChartDocument, locationId: number, shift: Shift): DocLocationState {
  const state = document.locationStates.find(
    (candidate) => candidate.location.locationId === locationId && candidate.shift === shift,
  );
  if (!state) throw new ContinuationError("location state could not be read back", 400);
  return state;
}

function availabilityFrom(document: ChartDocument, availabilityId: number): DocAvailability {
  const row = document.availability.find((candidate) => candidate.availabilityId === availabilityId);
  if (!row) throw new ContinuationError("availability row could not be read back", 400);
  return row;
}

export interface LocationStateMutation {
  ok: true;
  locationState: DocLocationState;
  document: ChartDocument;
}

export interface LocationStateDeleteMutation {
  ok: true;
  deleted: { locationId: number; shift: Shift };
  document: ChartDocument;
}

export interface LocationStateInput {
  isClosed: boolean;
  chargeDestinationLocationId: number | null;
}

function parseLocationStateInput(input: unknown): LocationStateInput {
  const body = requireBody(input, "location state");
  for (const key of Object.keys(body)) {
    if (key !== "isClosed" && key !== "chargeDestinationLocationId") {
      throw new ContinuationError(`field not editable: ${key}`, 400);
    }
  }
  if (!hasOwn(body, "isClosed")) throw new ContinuationError("isClosed is required", 400);
  if (!hasOwn(body, "chargeDestinationLocationId")) {
    throw new ContinuationError("chargeDestinationLocationId is required (null = no charge)", 400);
  }
  return {
    isClosed: booleanValue(body.isClosed, "isClosed"),
    chargeDestinationLocationId: nullablePositiveInteger(
      body.chargeDestinationLocationId, "chargeDestinationLocationId",
    ),
  };
}

/** Upsert one explicit location+shift state. No assignment or note field is touched. */
export async function upsertLocationState(
  db: Queryable,
  date: string,
  locationId: unknown,
  shift: unknown,
  input: unknown,
): Promise<LocationStateMutation> {
  const sourceLocationId = positiveInteger(locationId, "locationId");
  const sourceShift = shiftValue(shift);
  const values = parseLocationStateInput(input);
  if (values.chargeDestinationLocationId === sourceLocationId) {
    throw new ContinuationError("chargeDestinationLocationId cannot equal locationId", 400);
  }

  return withWritableChart(db, date, async ({ chartId, client }) => {
    const source = (await client.query(
      `SELECT location_id FROM locations WHERE location_id = $1`, [sourceLocationId],
    )).rows;
    if (source.length !== 1) throw new ContinuationError(`no location ${sourceLocationId}`, 400);
    if (values.chargeDestinationLocationId !== null) {
      const destination = (await client.query(
        `SELECT location_id FROM locations WHERE location_id = $1`,
        [values.chargeDestinationLocationId],
      )).rows;
      if (destination.length !== 1) {
        throw new ContinuationError(
          `no charge destination location ${values.chargeDestinationLocationId}`, 400,
        );
      }
    }
    await client.query(
      `INSERT INTO location_operational_states
         (chart_id, location_id, shift, is_closed, charge_destination_location_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (chart_id, location_id, shift) DO UPDATE
         SET is_closed = EXCLUDED.is_closed,
             charge_destination_location_id = EXCLUDED.charge_destination_location_id`,
      [chartId, sourceLocationId, sourceShift, values.isClosed, values.chargeDestinationLocationId],
    );
    const document = await projectChart(client, chartId);
    return { ok: true, locationState: locationStateFrom(document, sourceLocationId, sourceShift), document };
  });
}

/** Delete one location+shift state; deleting it does not affect assignments at that location. */
export async function deleteLocationState(
  db: Queryable,
  date: string,
  locationId: unknown,
  shift: unknown,
): Promise<LocationStateDeleteMutation> {
  const sourceLocationId = positiveInteger(locationId, "locationId");
  const sourceShift = shiftValue(shift);
  return withWritableChart(db, date, async ({ chartId, client }) => {
    const source = (await client.query(
      `SELECT location_id FROM locations WHERE location_id = $1`, [sourceLocationId],
    )).rows;
    if (source.length !== 1) throw new ContinuationError(`no location ${sourceLocationId}`, 400);
    const deleted = (await client.query(
      `DELETE FROM location_operational_states
        WHERE chart_id = $1 AND location_id = $2 AND shift = $3
        RETURNING location_id`,
      [chartId, sourceLocationId, sourceShift],
    )).rows;
    if (deleted.length !== 1) {
      throw new ContinuationError(
        `no location state for location ${sourceLocationId} ${sourceShift}`, 404,
      );
    }
    const document = await projectChart(client, chartId);
    return { ok: true, deleted: { locationId: sourceLocationId, shift: sourceShift }, document };
  });
}

// Names that read naturally at call sites and in hidden domain consumers.
export const upsertLocationOperationalState = upsertLocationState;
export const deleteLocationOperationalState = deleteLocationState;

export interface AvailabilityValues {
  staffId: number | null;
  category: string;
  groupKey: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  timeStart: string | null;
  timeEnd: string | null;
  detailMr: string | null;
  sortOrder: number;
}

export interface AvailabilityMutation {
  ok: true;
  availability: DocAvailability;
  document: ChartDocument;
}

export interface AvailabilityDeleteMutation {
  ok: true;
  deleted: { availabilityId: number };
  document: ChartDocument;
}

const AVAILABILITY_FIELDS = new Set([
  "staffId", "category", "groupKey", "windowStart", "windowEnd", "timeStart", "timeEnd", "detailMr", "detail", "sortOrder",
]);

function availabilityBody(input: unknown): Body {
  const body = requireBody(input, "availability");
  for (const key of Object.keys(body)) {
    if (!AVAILABILITY_FIELDS.has(key)) throw new ContinuationError(`field not editable: ${key}`, 400);
  }
  if (hasOwn(body, "detailMr") && hasOwn(body, "detail")) {
    throw new ContinuationError("send only one of detailMr or detail", 400);
  }
  return body;
}

function detailKey(body: Body): "detailMr" | "detail" | null {
  if (hasOwn(body, "detailMr")) return "detailMr";
  if (hasOwn(body, "detail")) return "detail";
  return null;
}

type AvailabilityPatch = Partial<AvailabilityValues>;

function parseAvailabilityPatch(input: unknown): AvailabilityPatch {
  const body = availabilityBody(input);
  if (Object.keys(body).length === 0) throw new ContinuationError("no fields to update", 400);
  const patch: AvailabilityPatch = {};
  if (hasOwn(body, "staffId")) patch.staffId = nullablePositiveInteger(body.staffId, "staffId");
  if (hasOwn(body, "category")) {
    patch.category = safeText(body.category, "category", MAX_CATEGORY, true) as string;
  }
  if (hasOwn(body, "groupKey")) patch.groupKey = safeText(body.groupKey, "groupKey", MAX_GROUP_KEY, false);
  if (hasOwn(body, "windowStart")) patch.windowStart = validDate(body.windowStart, "windowStart");
  if (hasOwn(body, "windowEnd")) patch.windowEnd = validDate(body.windowEnd, "windowEnd");
  if (hasOwn(body, "timeStart")) patch.timeStart = typedTime(body.timeStart, "timeStart");
  if (hasOwn(body, "timeEnd")) patch.timeEnd = typedTime(body.timeEnd, "timeEnd");
  const detail = detailKey(body);
  if (detail) patch.detailMr = safeText(body[detail], "detailMr", MAX_DETAIL, false);
  if (hasOwn(body, "sortOrder")) {
    patch.sortOrder = nonNegativeInteger(body.sortOrder, "sortOrder", MAX_SORT_ORDER);
  }
  return patch;
}

function availabilityCreate(input: unknown): AvailabilityValues {
  const body = availabilityBody(input);
  const required = ["staffId", "category", "groupKey", "windowStart", "windowEnd", "timeStart", "timeEnd", "sortOrder"];
  for (const key of required) {
    if (!hasOwn(body, key)) throw new ContinuationError(`${key} is required (use null when empty)`, 400);
  }
  if (!detailKey(body)) throw new ContinuationError("detailMr is required (use null when empty)", 400);
  const patch = parseAvailabilityPatch(body);
  return {
    staffId: patch.staffId as number | null,
    category: patch.category as string,
    groupKey: patch.groupKey as string | null,
    windowStart: patch.windowStart as string | null,
    windowEnd: patch.windowEnd as string | null,
    timeStart: patch.timeStart as string | null,
    timeEnd: patch.timeEnd as string | null,
    detailMr: patch.detailMr as string | null,
    sortOrder: patch.sortOrder as number,
  };
}

function validateWindowOrder(values: AvailabilityValues): void {
  if (values.windowStart && values.windowEnd && values.windowEnd < values.windowStart) {
    throw new ContinuationError("windowEnd must be on or after windowStart", 400);
  }
  if (values.timeStart && values.timeEnd && values.timeEnd < values.timeStart) {
    throw new ContinuationError("timeEnd must be on or after timeStart", 400);
  }
}

async function ensureStaffForeignKey(client: pg.PoolClient, staffId: number | null): Promise<void> {
  if (staffId === null) return;
  const rows = (await client.query(`SELECT staff_id FROM staff_members WHERE staff_id = $1`, [staffId])).rows;
  if (rows.length !== 1) throw new ContinuationError(`no staff ${staffId}`, 400);
}

async function existingAvailability(client: pg.PoolClient, chartId: number, availabilityId: number) {
  const rows = (await client.query(
    `SELECT availability_id, staff_id, category, group_key,
            to_char(window_start, 'YYYY-MM-DD') AS window_start,
            to_char(window_end, 'YYYY-MM-DD') AS window_end,
            to_char(time_start, 'HH24:MI:SS') AS time_start,
            to_char(time_end, 'HH24:MI:SS') AS time_end,
            detail_mr, sort_order
       FROM daily_availabilities
      WHERE chart_id = $1 AND availability_id = $2
      FOR UPDATE`,
    [chartId, availabilityId],
  )).rows;
  if (rows.length !== 1) throw new ContinuationError(`no availability ${availabilityId}`, 404);
  return rows[0] as Record<string, unknown>;
}

function availabilityValuesFromRow(row: Record<string, unknown>): AvailabilityValues {
  return {
    staffId: row.staff_id == null ? null : Number(row.staff_id),
    category: row.category as string,
    groupKey: (row.group_key as string | null) ?? null,
    windowStart: (row.window_start as string | null) ?? null,
    windowEnd: (row.window_end as string | null) ?? null,
    timeStart: (row.time_start as string | null) ?? null,
    timeEnd: (row.time_end as string | null) ?? null,
    detailMr: (row.detail_mr as string | null) ?? null,
    sortOrder: Number(row.sort_order),
  };
}

/** Create one availability row. The row's Marathi detail is stored verbatim as display text. */
export async function createAvailability(
  db: Queryable,
  date: string,
  input: unknown,
): Promise<AvailabilityMutation> {
  const values = availabilityCreate(input);
  validateWindowOrder(values);
  return withWritableChart(db, date, async ({ chartId, client }) => {
    await ensureStaffForeignKey(client, values.staffId);
    const row = (await client.query(
      `INSERT INTO daily_availabilities
         (chart_id, staff_id, category, group_key, window_start, window_end,
          time_start, time_end, detail_mr, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING availability_id`,
      [chartId, values.staffId, values.category, values.groupKey, values.windowStart, values.windowEnd,
        values.timeStart, values.timeEnd, values.detailMr, values.sortOrder],
    )).rows[0];
    const availabilityId = Number(row.availability_id);
    const document = await projectChart(client, chartId);
    return { ok: true, availability: availabilityFrom(document, availabilityId), document };
  });
}

/** Patch only supplied availability fields, retaining all other typed values. */
export async function updateAvailability(
  db: Queryable,
  date: string,
  availabilityId: unknown,
  input: unknown,
): Promise<AvailabilityMutation> {
  const id = positiveInteger(availabilityId, "availabilityId");
  const patch = parseAvailabilityPatch(input);
  return withWritableChart(db, date, async ({ chartId, client }) => {
    const current = availabilityValuesFromRow(await existingAvailability(client, chartId, id));
    const next: AvailabilityValues = { ...current, ...patch };
    validateWindowOrder(next);
    await ensureStaffForeignKey(client, next.staffId);
    await client.query(
      `UPDATE daily_availabilities
          SET staff_id = $1, category = $2, group_key = $3,
              window_start = $4, window_end = $5, time_start = $6, time_end = $7,
              detail_mr = $8, sort_order = $9
        WHERE chart_id = $10 AND availability_id = $11`,
      [next.staffId, next.category, next.groupKey, next.windowStart, next.windowEnd,
        next.timeStart, next.timeEnd, next.detailMr, next.sortOrder, chartId, id],
    );
    const document = await projectChart(client, chartId);
    return { ok: true, availability: availabilityFrom(document, id), document };
  });
}

/** Delete one availability row belonging to the date's chart. */
export async function deleteAvailability(
  db: Queryable,
  date: string,
  availabilityId: unknown,
): Promise<AvailabilityDeleteMutation> {
  const id = positiveInteger(availabilityId, "availabilityId");
  return withWritableChart(db, date, async ({ chartId, client }) => {
    const rows = (await client.query(
      `DELETE FROM daily_availabilities
        WHERE chart_id = $1 AND availability_id = $2
        RETURNING availability_id`, [chartId, id],
    )).rows;
    if (rows.length !== 1) throw new ContinuationError(`no availability ${id}`, 404);
    const document = await projectChart(client, chartId);
    return { ok: true, deleted: { availabilityId: id }, document };
  });
}

export const addAvailability = createAvailability;
export const removeAvailability = deleteAvailability;

const replyFor = (
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  error: unknown,
) => {
  if (error instanceof ContinuationError) return reply.code(error.statusCode).send({ error: error.message });
  throw error;
};

export function registerContinuationRoutes(app: FastifyInstance, db: Queryable): void {
  const upsertHandler = async (
    req: { params: unknown; body: unknown },
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ) => {
    const { date, locationId, shift } = req.params as { date: string; locationId: string; shift: string };
    try {
      return await upsertLocationState(db, date, locationId, shift, req.body);
    } catch (error) {
      return replyFor(reply, error);
    }
  };
  const locationPath = "/api/charts/:date/location-states/:locationId/:shift";
  app.put(locationPath, upsertHandler);
  // PATCH is accepted as the same complete, explicit upsert contract for clients that use the
  // existing narrow-PATCH convention; omitted fields are still rejected rather than defaulted.
  app.patch(locationPath, upsertHandler);
  app.delete(locationPath, async (req, reply) => {
    const { date, locationId, shift } = req.params as { date: string; locationId: string; shift: string };
    try {
      return await deleteLocationState(db, date, locationId, shift);
    } catch (error) {
      return replyFor(reply, error);
    }
  });

  app.post("/api/charts/:date/availabilities", async (req, reply) => {
    const { date } = req.params as { date: string };
    try {
      return reply.code(201).send(await createAvailability(db, date, req.body));
    } catch (error) {
      return replyFor(reply, error);
    }
  });
  app.patch("/api/charts/:date/availabilities/:id", async (req, reply) => {
    const { date, id } = req.params as { date: string; id: string };
    try {
      return await updateAvailability(db, date, id, req.body);
    } catch (error) {
      return replyFor(reply, error);
    }
  });
  app.delete("/api/charts/:date/availabilities/:id", async (req, reply) => {
    const { date, id } = req.params as { date: string; id: string };
    try {
      return await deleteAvailability(db, date, id);
    } catch (error) {
      return replyFor(reply, error);
    }
  });
}
