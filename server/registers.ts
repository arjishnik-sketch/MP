// Purpose: Transactional CRUD for the chart's remaining registers:
//   - scan_schedule_daily
//   - sudden_duty_changes
//   - officer_summary_rows
//   - shift_summary_cells
//   - special_events & event_assignments
// Current role: Fastify routes and domain layer over the Layer-B register tables.
// Last meaningful change: 2026-10-19 — complete register authoring slice.
// Constraint/dependency: FINALIZED charts are immutable; all values parameterized; Marathi text display only.
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import type { Queryable } from "./chart-document.js";

export class RegisterError extends Error {
  constructor(message: string, public readonly statusCode: 400 | 404 | 409) {
    super(message);
    this.name = "RegisterError";
  }
}

type Body = Record<string, unknown>;
const isRecord = (value: unknown): value is Body =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    throw new RegisterError(`${field} must be YYYY-MM-DD`, 400);
  }
  return value;
}

function typedTime(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !TIME_RE.test(value)) {
    throw new RegisterError(`${field} must be HH:MM or HH:MM:SS`, 400);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RegisterError(`${field} must be a positive integer`, 400);
  }
  return parsed;
}

function nullablePositiveInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  return positiveInteger(value, field);
}

function safeText(value: unknown, field: string, max = 400, required = false): string | null {
  if (value === null || value === undefined) {
    if (required) throw new RegisterError(`${field} is required`, 400);
    return null;
  }
  const text = String(value).trim();
  if (required && text === "") throw new RegisterError(`${field} is required`, 400);
  if (text.length > max) throw new RegisterError(`${field} is too long (max ${max} chars)`, 400);
  if (/[\u0000-\u001f\u007f<>]/.test(text)) {
    throw new RegisterError(`${field} contains invalid characters`, 400);
  }
  return text || null;
}

interface ChartCtx {
  chartId: number;
  client: pg.PoolClient;
  ownsTx: boolean;
}

async function withWritableChart<T>(
  db: Queryable,
  date: string,
  fn: (ctx: ChartCtx) => Promise<T>,
): Promise<T> {
  validDate(date, "date");
  const ownsTx = !("release" in db);
  const client = ownsTx ? await (db as pg.Pool).connect() : (db as pg.PoolClient);
  try {
    if (ownsTx) await client.query("BEGIN");
    const rows = (await client.query(
      `SELECT chart_id, lifecycle FROM daily_charts WHERE chart_date = $1 FOR UPDATE`, [date],
    )).rows;
    if (rows.length !== 1) throw new RegisterError(`no chart for ${date}`, 404);
    if (rows[0].lifecycle === "FINALIZED") {
      throw new RegisterError("FINALIZED charts are immutable; use amendment", 409);
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

// -------------------------------------------------------------------------------
// 1. Scan Schedule Daily CRUD
// -------------------------------------------------------------------------------
export async function addScanRow(db: Queryable, date: string, input: unknown) {
  const body = isRecord(input) ? input : {};
  const sessionCode = safeText(body.sessionCode ?? body.session_code, "sessionCode", 40, true) as string;
  const startTime = typedTime(body.startTime ?? body.start_time, "startTime");
  const endTime = typedTime(body.endTime ?? body.end_time, "endTime");
  const staffId = nullablePositiveInteger(body.staffId ?? body.staff_id, "staffId");
  const noteMr = safeText(body.noteMr ?? body.note_mr, "noteMr", 300);

  return withWritableChart(db, date, async ({ chartId, client }) => {
    // Check valid session
    const s = (await client.query(`SELECT 1 FROM scan_sessions WHERE session_code = $1`, [sessionCode])).rows;
    if (s.length === 0) throw new RegisterError(`unknown scan session ${sessionCode}`, 400);

    if (staffId !== null) {
      const st = (await client.query(`SELECT 1 FROM staff_members WHERE staff_id = $1`, [staffId])).rows;
      if (st.length === 0) throw new RegisterError(`unknown staff ${staffId}`, 400);
    }

    let sequence = Number(body.sequence);
    if (!Number.isInteger(sequence) || sequence <= 0) {
      const maxSeq = (await client.query(
        `SELECT COALESCE(MAX(sequence), 0) AS m FROM scan_schedule_daily
          WHERE chart_id = $1 AND session_code = $2`, [chartId, sessionCode],
      )).rows[0].m;
      sequence = Number(maxSeq) + 1;
    }

    const row = (await client.query(
      `INSERT INTO scan_schedule_daily
         (chart_id, session_code, sequence, start_time, end_time, staff_id, note_mr)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING scan_row_id`,
      [chartId, sessionCode, sequence, startTime, endTime, staffId, noteMr],
    )).rows[0];

    return { ok: true, scanRowId: Number(row.scan_row_id) };
  });
}

export async function updateScanRow(db: Queryable, date: string, id: unknown, input: unknown) {
  const scanRowId = positiveInteger(id, "scanRowId");
  const body = isRecord(input) ? input : {};

  return withWritableChart(db, date, async ({ chartId, client }) => {
    const cur = (await client.query(
      `SELECT scan_row_id, chart_id FROM scan_schedule_daily WHERE scan_row_id = $1 FOR UPDATE`, [scanRowId],
    )).rows;
    if (cur.length === 0 || Number(cur[0].chart_id) !== chartId) {
      throw new RegisterError(`no scan row ${scanRowId} on this chart`, 404);
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    const add = (col: string, val: unknown) => {
      values.push(val);
      sets.push(`${col} = $${values.length}`);
    };

    if ("sessionCode" in body || "session_code" in body) {
      const sc = safeText(body.sessionCode ?? body.session_code, "sessionCode", 40, true);
      add("session_code", sc);
    }
    if ("sequence" in body) add("sequence", positiveInteger(body.sequence, "sequence"));
    if ("startTime" in body || "start_time" in body) add("start_time", typedTime(body.startTime ?? body.start_time, "startTime"));
    if ("endTime" in body || "end_time" in body) add("end_time", typedTime(body.endTime ?? body.end_time, "endTime"));
    if ("staffId" in body || "staff_id" in body) {
      const sid = nullablePositiveInteger(body.staffId ?? body.staff_id, "staffId");
      if (sid !== null) {
        const st = (await client.query(`SELECT 1 FROM staff_members WHERE staff_id = $1`, [sid])).rows;
        if (st.length === 0) throw new RegisterError(`unknown staff ${sid}`, 400);
      }
      add("staff_id", sid);
    }
    if ("noteMr" in body || "note_mr" in body) {
      add("note_mr", safeText(body.noteMr ?? body.note_mr, "noteMr", 300));
    }

    if (sets.length > 0) {
      values.push(scanRowId);
      await client.query(`UPDATE scan_schedule_daily SET ${sets.join(", ")} WHERE scan_row_id = $${values.length}`, values);
    }
    return { ok: true, scanRowId };
  });
}

export async function deleteScanRow(db: Queryable, date: string, id: unknown) {
  const scanRowId = positiveInteger(id, "scanRowId");
  return withWritableChart(db, date, async ({ chartId, client }) => {
    const res = await client.query(
      `DELETE FROM scan_schedule_daily WHERE (scan_row_id = $1 OR sequence = $1) AND chart_id = $2 RETURNING scan_row_id`,
      [scanRowId, chartId],
    );
    if (res.rows.length === 0) throw new RegisterError(`no scan row ${scanRowId}`, 404);
    return { ok: true, scanRowId };
  });
}

// -------------------------------------------------------------------------------
// 2. Sudden Duty Changes CRUD
// -------------------------------------------------------------------------------
export async function addSuddenChange(db: Queryable, date: string, input: unknown) {
  const body = isRecord(input) ? input : {};
  const originalStaffId = nullablePositiveInteger(body.originalStaffId ?? body.original_staff_id, "originalStaffId");
  const replacementStaffId = nullablePositiveInteger(body.replacementStaffId ?? body.replacement_staff_id, "replacementStaffId");
  const detailMr = safeText(body.detailMr ?? body.detail_mr ?? body.changeText ?? body.change_text, "detailMr", 400, true) as string;
  const noteMr = safeText(body.noteMr ?? body.note_mr ?? body.reasonText ?? body.reason_text, "noteMr", 400);

  return withWritableChart(db, date, async ({ chartId, client }) => {
    if (originalStaffId !== null) {
      const o = (await client.query(`SELECT 1 FROM staff_members WHERE staff_id = $1`, [originalStaffId])).rows;
      if (o.length === 0) throw new RegisterError(`unknown original staff ${originalStaffId}`, 400);
    }
    if (replacementStaffId !== null) {
      const r = (await client.query(`SELECT 1 FROM staff_members WHERE staff_id = $1`, [replacementStaffId])).rows;
      if (r.length === 0) throw new RegisterError(`unknown replacement staff ${replacementStaffId}`, 400);
    }

    let seq = Number(body.seq);
    if (!Number.isInteger(seq) || seq <= 0) {
      const maxSeq = (await client.query(
        `SELECT COALESCE(MAX(seq), 0) AS m FROM sudden_duty_changes WHERE chart_id = $1`, [chartId],
      )).rows[0].m;
      seq = Number(maxSeq) + 1;
    }

    const row = (await client.query(
      `INSERT INTO sudden_duty_changes
         (chart_id, seq, original_staff_id, replacement_staff_id, detail_mr, note_mr)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING change_id`,
      [chartId, seq, originalStaffId, replacementStaffId, detailMr, noteMr],
    )).rows[0];

    return { ok: true, changeId: Number(row.change_id) };
  });
}

export async function updateSuddenChange(db: Queryable, date: string, id: unknown, input: unknown) {
  const changeId = positiveInteger(id, "changeId");
  const body = isRecord(input) ? input : {};

  return withWritableChart(db, date, async ({ chartId, client }) => {
    const cur = (await client.query(
      `SELECT change_id, chart_id FROM sudden_duty_changes WHERE change_id = $1 FOR UPDATE`, [changeId],
    )).rows;
    if (cur.length === 0 || Number(cur[0].chart_id) !== chartId) {
      throw new RegisterError(`no sudden change ${changeId} on this chart`, 404);
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    const add = (col: string, val: unknown) => {
      values.push(val);
      sets.push(`${col} = $${values.length}`);
    };

    if ("seq" in body) add("seq", positiveInteger(body.seq, "seq"));
    if ("originalStaffId" in body || "original_staff_id" in body) {
      add("original_staff_id", nullablePositiveInteger(body.originalStaffId ?? body.original_staff_id, "originalStaffId"));
    }
    if ("replacementStaffId" in body || "replacement_staff_id" in body) {
      add("replacement_staff_id", nullablePositiveInteger(body.replacementStaffId ?? body.replacement_staff_id, "replacementStaffId"));
    }
    if ("detailMr" in body || "detail_mr" in body) {
      add("detail_mr", safeText(body.detailMr ?? body.detail_mr, "detailMr", 400, true));
    }
    if ("noteMr" in body || "note_mr" in body) {
      add("note_mr", safeText(body.noteMr ?? body.note_mr, "noteMr", 400));
    }

    if (sets.length > 0) {
      values.push(changeId);
      await client.query(`UPDATE sudden_duty_changes SET ${sets.join(", ")} WHERE change_id = $${values.length}`, values);
    }
    return { ok: true, changeId };
  });
}

export async function deleteSuddenChange(db: Queryable, date: string, id: unknown) {
  const changeId = positiveInteger(id, "changeId");
  return withWritableChart(db, date, async ({ chartId, client }) => {
    const res = await client.query(
      `DELETE FROM sudden_duty_changes WHERE (change_id = $1 OR seq = $1) AND chart_id = $2 RETURNING change_id`,
      [changeId, chartId],
    );
    if (res.rows.length === 0) throw new RegisterError(`no sudden change ${changeId}`, 404);
    return { ok: true, changeId };
  });
}

// -------------------------------------------------------------------------------
// 3. Officer Summary Rows CRUD
// -------------------------------------------------------------------------------
export async function upsertOfficerSummaryRow(db: Queryable, date: string, input: unknown) {
  const body = isRecord(input) ? input : {};
  const rowNo = positiveInteger(body.rowNo ?? body.row_no, "rowNo");
  const officerText = safeText(body.officerText ?? body.officer_text, "officerText", 160, true) as string;
  const dutyText = safeText(body.dutyText ?? body.duty_text, "dutyText", 300, true) as string;
  const source = body.source === "OVERRIDE" || body.source === "SUGGESTION" ? body.source : "SOURCE";

  return withWritableChart(db, date, async ({ chartId, client }) => {
    await client.query(
      `INSERT INTO officer_summary_rows (chart_id, row_no, officer_text, duty_text, source)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (chart_id, row_no) DO UPDATE
         SET officer_text = EXCLUDED.officer_text,
             duty_text = EXCLUDED.duty_text,
             source = EXCLUDED.source`,
      [chartId, rowNo, officerText, dutyText, source],
    );
    return { ok: true, rowNo };
  });
}

export async function deleteOfficerSummaryRow(db: Queryable, date: string, rowNo: unknown) {
  const rowNum = positiveInteger(rowNo, "rowNo");
  return withWritableChart(db, date, async ({ chartId, client }) => {
    const res = await client.query(
      `DELETE FROM officer_summary_rows WHERE chart_id = $1 AND row_no = $2 RETURNING row_no`,
      [chartId, rowNum],
    );
    if (res.rows.length === 0) throw new RegisterError(`no officer summary row ${rowNum}`, 404);
    return { ok: true, rowNo: rowNum };
  });
}

// -------------------------------------------------------------------------------
// 4. Shift Summary Cells CRUD
// -------------------------------------------------------------------------------
export async function setShiftSummaryCell(db: Queryable, date: string, input: unknown) {
  const body = isRecord(input) ? input : {};
  const summaryKey = safeText(body.summaryKey ?? body.summary_key, "summaryKey", 20, true) as string;
  const columnKey = safeText(body.columnKey ?? body.column_key, "columnKey", 80, true) as string;
  const valueText = safeText(body.valueText ?? body.value_text, "valueText", 120, false) ?? "";

  return withWritableChart(db, date, async ({ chartId, client }) => {
    if (valueText.trim() === "") {
      await client.query(
        `DELETE FROM shift_summary_cells WHERE chart_id = $1 AND summary_key = $2 AND column_key = $3`,
        [chartId, summaryKey, columnKey],
      );
    } else {
      await client.query(
        `INSERT INTO shift_summary_cells (chart_id, summary_key, column_key, value_text)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (chart_id, summary_key, column_key) DO UPDATE
           SET value_text = EXCLUDED.value_text`,
        [chartId, summaryKey, columnKey, valueText],
      );
    }
    return { ok: true, summaryKey, columnKey, valueText };
  });
}

// -------------------------------------------------------------------------------
// 5. Special Events & Event Assignments CRUD
// -------------------------------------------------------------------------------
export async function createSpecialEvent(db: Queryable, date: string, input: unknown) {
  const body = isRecord(input) ? input : {};
  const titleMr = safeText(body.titleMr ?? body.title_mr, "titleMr", 200, true) as string;
  const eventDate = validDate(body.eventDate ?? body.event_date ?? date, "eventDate");
  const startTime = typedTime(body.startTime ?? body.start_time, "startTime");
  const venueMr = safeText(body.venueMr ?? body.venue_mr, "venueMr", 200);
  const fallInMr = safeText(body.fallInMr ?? body.fall_in_mr, "fallInMr", 300);

  return withWritableChart(db, date, async ({ chartId, client }) => {
    const row = (await client.query(
      `INSERT INTO special_events (chart_id, title_mr, event_date, start_time, venue_mr, fall_in_mr)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING event_id`,
      [chartId, titleMr, eventDate, startTime, venueMr, fallInMr],
    )).rows[0];
    return { ok: true, eventId: Number(row.event_id) };
  });
}

export async function updateSpecialEvent(db: Queryable, date: string, id: unknown, input: unknown) {
  const eventId = positiveInteger(id, "eventId");
  const body = isRecord(input) ? input : {};

  return withWritableChart(db, date, async ({ chartId, client }) => {
    const cur = (await client.query(
      `SELECT event_id, chart_id FROM special_events WHERE event_id = $1 FOR UPDATE`, [eventId],
    )).rows;
    if (cur.length === 0 || Number(cur[0].chart_id) !== chartId) {
      throw new RegisterError(`no event ${eventId} on this chart`, 404);
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    const add = (col: string, val: unknown) => {
      values.push(val);
      sets.push(`${col} = $${values.length}`);
    };

    if ("titleMr" in body || "title_mr" in body) add("title_mr", safeText(body.titleMr ?? body.title_mr, "titleMr", 200, true));
    if ("eventDate" in body || "event_date" in body) add("event_date", validDate(body.eventDate ?? body.event_date, "eventDate"));
    if ("startTime" in body || "start_time" in body) add("start_time", typedTime(body.startTime ?? body.start_time, "startTime"));
    if ("venueMr" in body || "venue_mr" in body) add("venue_mr", safeText(body.venueMr ?? body.venue_mr, "venueMr", 200));
    if ("fallInMr" in body || "fall_in_mr" in body) add("fall_in_mr", safeText(body.fallInMr ?? body.fall_in_mr, "fallInMr", 300));

    if (sets.length > 0) {
      values.push(eventId);
      await client.query(`UPDATE special_events SET ${sets.join(", ")} WHERE event_id = $${values.length}`, values);
    }
    return { ok: true, eventId };
  });
}

export async function deleteSpecialEvent(db: Queryable, date: string, id: unknown) {
  const eventId = positiveInteger(id, "eventId");
  return withWritableChart(db, date, async ({ chartId, client }) => {
    const res = await client.query(
      `DELETE FROM special_events WHERE event_id = $1 AND chart_id = $2 RETURNING event_id`,
      [eventId, chartId],
    );
    if (res.rows.length === 0) throw new RegisterError(`no event ${eventId}`, 404);
    return { ok: true, eventId };
  });
}

export async function addEventAssignment(db: Queryable, date: string, eventIdVal: unknown, input: unknown) {
  const eventId = positiveInteger(eventIdVal, "eventId");
  const body = isRecord(input) ? input : {};
  const staffId = nullablePositiveInteger(body.staffId ?? body.staff_id, "staffId");
  const roleMr = safeText(body.roleMr ?? body.role_mr, "roleMr", 160);
  const sortOrder = Number(body.sortOrder ?? body.sort_order ?? 0);

  return withWritableChart(db, date, async ({ chartId, client }) => {
    const ev = (await client.query(
      `SELECT 1 FROM special_events WHERE event_id = $1 AND chart_id = $2`, [eventId, chartId],
    )).rows;
    if (ev.length === 0) throw new RegisterError(`no event ${eventId} on this chart`, 404);

    if (staffId !== null) {
      const st = (await client.query(`SELECT 1 FROM staff_members WHERE staff_id = $1`, [staffId])).rows;
      if (st.length === 0) throw new RegisterError(`unknown staff ${staffId}`, 400);
    }

    const row = (await client.query(
      `INSERT INTO event_assignments (event_id, staff_id, role_mr, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING event_assignment_id`,
      [eventId, staffId, roleMr, sortOrder],
    )).rows[0];

    return { ok: true, eventAssignmentId: Number(row.event_assignment_id) };
  });
}

export async function deleteEventAssignment(db: Queryable, date: string, assignmentIdVal: unknown) {
  const eventAssignmentId = positiveInteger(assignmentIdVal, "eventAssignmentId");
  return withWritableChart(db, date, async ({ chartId, client }) => {
    const res = await client.query(
      `DELETE FROM event_assignments ea
        USING special_events se
       WHERE ea.event_assignment_id = $1 AND ea.event_id = se.event_id AND se.chart_id = $2
       RETURNING ea.event_assignment_id`,
      [eventAssignmentId, chartId],
    );
    if (res.rows.length === 0) throw new RegisterError(`no event assignment ${eventAssignmentId}`, 404);
    return { ok: true, eventAssignmentId };
  });
}

// -------------------------------------------------------------------------------
// Register Fastify Routes
// -------------------------------------------------------------------------------
const replyFor = (
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  error: unknown,
) => {
  if (error instanceof RegisterError) return reply.code(error.statusCode).send({ error: error.message });
  throw error;
};

export function registerRegisterRoutes(app: FastifyInstance, db: Queryable): void {
  // Scan schedule daily
  app.post("/api/charts/:date/scan-rows", async (req, reply) => {
    const { date } = req.params as { date: string };
    try {
      return reply.code(201).send(await addScanRow(db, date, req.body));
    } catch (e) { return replyFor(reply, e); }
  });
  app.patch("/api/charts/:date/scan-rows/:id", async (req, reply) => {
    const { date, id } = req.params as { date: string; id: string };
    try {
      return await updateScanRow(db, date, id, req.body);
    } catch (e) { return replyFor(reply, e); }
  });
  app.delete("/api/charts/:date/scan-rows/:id", async (req, reply) => {
    const { date, id } = req.params as { date: string; id: string };
    try {
      return await deleteScanRow(db, date, id);
    } catch (e) { return replyFor(reply, e); }
  });

  // Sudden duty changes
  app.post("/api/charts/:date/sudden-changes", async (req, reply) => {
    const { date } = req.params as { date: string };
    try {
      return reply.code(201).send(await addSuddenChange(db, date, req.body));
    } catch (e) { return replyFor(reply, e); }
  });
  app.patch("/api/charts/:date/sudden-changes/:id", async (req, reply) => {
    const { date, id } = req.params as { date: string; id: string };
    try {
      return await updateSuddenChange(db, date, id, req.body);
    } catch (e) { return replyFor(reply, e); }
  });
  app.delete("/api/charts/:date/sudden-changes/:id", async (req, reply) => {
    const { date, id } = req.params as { date: string; id: string };
    try {
      return await deleteSuddenChange(db, date, id);
    } catch (e) { return replyFor(reply, e); }
  });

  // Officer summary rows
  app.post("/api/charts/:date/officer-summary", async (req, reply) => {
    const { date } = req.params as { date: string };
    try {
      return reply.code(201).send(await upsertOfficerSummaryRow(db, date, req.body));
    } catch (e) { return replyFor(reply, e); }
  });
  app.put("/api/charts/:date/officer-summary", async (req, reply) => {
    const { date } = req.params as { date: string };
    try {
      return await upsertOfficerSummaryRow(db, date, req.body);
    } catch (e) { return replyFor(reply, e); }
  });
  app.delete("/api/charts/:date/officer-summary/:rowNo", async (req, reply) => {
    const { date, rowNo } = req.params as { date: string; rowNo: string };
    try {
      return await deleteOfficerSummaryRow(db, date, rowNo);
    } catch (e) { return replyFor(reply, e); }
  });

  // Shift summary cells
  app.put("/api/charts/:date/shift-summary", async (req, reply) => {
    const { date } = req.params as { date: string };
    try {
      return await setShiftSummaryCell(db, date, req.body);
    } catch (e) { return replyFor(reply, e); }
  });

  // Special events
  app.post("/api/charts/:date/events", async (req, reply) => {
    const { date } = req.params as { date: string };
    try {
      return reply.code(201).send(await createSpecialEvent(db, date, req.body));
    } catch (e) { return replyFor(reply, e); }
  });
  app.patch("/api/charts/:date/events/:id", async (req, reply) => {
    const { date, id } = req.params as { date: string; id: string };
    try {
      return await updateSpecialEvent(db, date, id, req.body);
    } catch (e) { return replyFor(reply, e); }
  });
  app.delete("/api/charts/:date/events/:id", async (req, reply) => {
    const { date, id } = req.params as { date: string; id: string };
    try {
      return await deleteSpecialEvent(db, date, id);
    } catch (e) { return replyFor(reply, e); }
  });

  // Event assignments
  app.post("/api/charts/:date/events/:id/assignments", async (req, reply) => {
    const { date, id } = req.params as { date: string; id: string };
    try {
      return reply.code(201).send(await addEventAssignment(db, date, id, req.body));
    } catch (e) { return replyFor(reply, e); }
  });
  app.delete("/api/charts/:date/events/assignments/:assignmentId", async (req, reply) => {
    const { date, assignmentId } = req.params as { date: string; assignmentId: string };
    try {
      return await deleteEventAssignment(db, date, assignmentId);
    } catch (e) { return replyFor(reply, e); }
  });
}
