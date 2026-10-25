// Purpose: narrow, transactional assignment mutations — the ONLY write path the authoring
//   UI uses for staff slots (never a full-document replace).
// Current role: P1 authoring API domain layer (work unit 1009, vertical slice 1).
// Last meaningful change: 2026-10-09 — created (reassignSlot).
// Constraint/dependency: AGENTS.md hard rules — the clerk chooses personnel; software only
//   applies the explicit choice. रिक्त = slot state (staff_id NULL), BIMA stays an explicit
//   boolean (never derived); unrelated assignment columns are never touched by a slot edit.
//   FINALIZED charts are immutable (checked here AND by DB triggers in migration 0004).
import type { Queryable } from "./chart-document.js";

export interface ReassignInput {
  chartId: number;
  assignmentId: number;
  /** staff_id to place in the slot, or null to clear it back to रिक्त. */
  staffId: number | null;
  /** explicit BIMA qualifier; only meaningful with a person; defaults to the row's current value. */
  isBima?: boolean;
}

export interface ReassignResult {
  assignmentId: number;
  staffId: number | null;
  allocationState: "ALLOCATED" | "VACANT_RIKT";
  isBima: boolean;
}

/** Reassign ONE slot. Everything else about the row (shift, duty, location, column,
 *  ordering, time windows, notes, status, source) is preserved untouched. */
export async function reassignSlot(db: Queryable, input: ReassignInput): Promise<ReassignResult> {
  const chart = (await db.query(
    `SELECT lifecycle FROM daily_charts WHERE chart_id = $1 FOR UPDATE`, [input.chartId])).rows;
  if (chart.length !== 1) throw new Error(`no chart ${input.chartId}`);
  if (chart[0].lifecycle === "FINALIZED") {
    throw new Error("FINALIZED charts are immutable; use amendment");
  }

  const cur = (await db.query(
    `SELECT assignment_id, chart_id, staff_id, allocation_state, is_bima
       FROM daily_assignments WHERE assignment_id = $1 FOR UPDATE`,
    [input.assignmentId])).rows;
  if (cur.length !== 1) throw new Error(`no assignment ${input.assignmentId}`);
  if (Number(cur[0].chart_id) !== input.chartId) {
    throw new Error(`assignment ${input.assignmentId} does not belong to chart ${input.chartId}`);
  }

  let staffId: number | null = input.staffId;
  let isBima: boolean;
  if (staffId == null) {
    // clearing a slot → रिक्त slot state; a vacant seat never carries a person or BIMA
    isBima = false;
  } else {
    const s = (await db.query(
      `SELECT staff_id, active FROM staff_members WHERE staff_id = $1`, [staffId])).rows;
    if (s.length !== 1) throw new Error(`no staff ${staffId}`);
    if (!s[0].active) throw new Error(`staff ${staffId} is inactive (deactivated, not deleted)`);
    isBima = input.isBima ?? Boolean(cur[0].is_bima);
  }

  const updated = (await db.query(
    `UPDATE daily_assignments
        SET staff_id = $1,
            allocation_state = CASE WHEN $1::bigint IS NULL THEN 'VACANT_RIKT' ELSE 'ALLOCATED' END,
            is_bima = $2
      WHERE assignment_id = $3
      RETURNING assignment_id, staff_id, allocation_state, is_bima`,
    [staffId, isBima, input.assignmentId])).rows[0];

  return {
    assignmentId: Number(updated.assignment_id),
    staffId: updated.staff_id == null ? null : Number(updated.staff_id),
    allocationState: updated.allocation_state,
    isBima: Boolean(updated.is_bima),
  };
}

// ---- add chowki block (edit-mode `+ चौकी जोडा`) -------------------------------
export interface AddChowkiInput {
  chartId: number;
  /** existing master location to place on the chart… */
  locationId?: number;
  /** …or a brand-new location (kind required) */
  nameMr?: string;
  kind?: string;
}
export interface AddChowkiResult { locationId: number; assignmentIds: number[]; createdDutyCodes: string[]; }

const CHOWKI_KINDS = new Set(["CHOWKI", "MARSHAL_POST"]);

/** Add a chowki/marshal block to a DRAFT chart: ensures the Layer-A location and its
 *  DAY/NIGHT duty rows exist, then inserts a location label row + one रिक्त "अंमलदार"
 *  seat per shift (approved interaction grammar — DESIGN_INTERACTION_NOTES §8).
 *  Nothing is invented: no person, no timing, no BIMA — the clerk fills the seat. */
export async function addChowkiBlock(db: Queryable, input: AddChowkiInput): Promise<AddChowkiResult> {
  const chart = (await db.query(
    `SELECT lifecycle FROM daily_charts WHERE chart_id = $1 FOR UPDATE`, [input.chartId])).rows;
  if (chart.length !== 1) throw new Error(`no chart ${input.chartId}`);
  if (chart[0].lifecycle === "FINALIZED") throw new Error("FINALIZED charts are immutable; use amendment");

  // ---- 1. resolve the location -------------------------------------------------
  let locationId: number;
  let locName: string;
  if (input.locationId != null) {
    const l = (await db.query(
      `SELECT location_id, name_mr, kind, active FROM locations WHERE location_id = $1`,
      [input.locationId])).rows;
    if (l.length !== 1) throw new Error(`no location ${input.locationId}`);
    if (!l[0].active) throw new Error(`location ${input.locationId} is inactive`);
    if (!CHOWKI_KINDS.has(l[0].kind)) throw new Error(`location kind ${l[0].kind} cannot become a chart block`);
    locationId = Number(l[0].location_id);
    locName = l[0].name_mr as string;
  } else {
    const name = (input.nameMr ?? "").trim();
    if (!name) throw new Error("nameMr is required when locationId is not given");
    if (!input.kind || !CHOWKI_KINDS.has(input.kind)) throw new Error("kind must be CHOWKI or MARSHAL_POST");
    const dup = (await db.query(
      `SELECT location_id FROM locations WHERE name_mr = $1 AND kind = $2 AND active`, [name, input.kind])).rows;
    if (dup.length > 0) throw new Error(`location "${name}" already exists — pick it from the list instead`);
    const created = (await db.query(
      `INSERT INTO locations (location_code, name_mr, kind, display_order)
       VALUES ('NEW_LOC_' || nextval('locations_location_id_seq')::text, $1, $2, 99)
       RETURNING location_id`, [name, input.kind])).rows[0];
    locationId = Number(created.location_id);
    locName = name;
  }

  // refuse a second block for the same location on this chart
  const already = (await db.query(
    `SELECT 1 FROM daily_assignments WHERE chart_id = $1 AND location_id = $2 LIMIT 1`,
    [input.chartId, locationId])).rows;
  if (already.length > 0) throw new Error("या तक्त्यावर ही चौकी आधीच आहे");

  // ---- 2. append at the end of the location-block columns ----------------------
  const colRow = (await db.query(
    `SELECT COALESCE(MAX(column_no), 2) AS col FROM daily_assignments
      WHERE chart_id = $1 AND location_id IS NOT NULL`, [input.chartId])).rows[0];
  const col = Number(colRow.col);

  // ---- 3. per shift: ensure duty master + label row + रिक्त seat ---------------
  const assignmentIds: number[] = [];
  const createdDutyCodes: string[] = [];
  for (const shift of ["DAY", "NIGHT"] as const) {
    let duty = (await db.query(
      `SELECT duty_id, duty_code FROM duty_definitions
        WHERE location_id = $1 AND default_shift = $2 ORDER BY duty_id LIMIT 1`,
      [locationId, shift])).rows;
    if (duty.length !== 1) {
      const code = `NEW_${shift}_${locationId}`;
      const ins = (await db.query(
        `INSERT INTO duty_definitions (duty_code, title_mr, section_code, default_shift, location_id, display_order)
         VALUES ($1, $2, $3, $4, $5, 99)
         ON CONFLICT (duty_code) DO UPDATE SET active = TRUE
         RETURNING duty_id, duty_code`,
        [code, locName, shift === "DAY" ? "DAY_DEPLOYMENT" : "NIGHT_DEPLOYMENT", shift, locationId])).rows[0];
      duty = [ins];
      createdDutyCodes.push(ins.duty_code as string);
    }
    const dutyId = Number(duty[0].duty_id);
    const maxSort = Number((await db.query(
      `SELECT COALESCE(MAX(sort_order), 0) AS m FROM daily_assignments
        WHERE chart_id = $1 AND shift = $2 AND column_no = $3`,
      [input.chartId, shift, col])).rows[0].m);

    const label = (await db.query(
      `INSERT INTO daily_assignments
         (chart_id, shift, duty_id, location_id, allocation_state, sort_order, column_no)
       VALUES ($1, $2, $3, $4, 'ALLOCATED', $5, $6)
       RETURNING assignment_id`,
      [input.chartId, shift, dutyId, locationId, maxSort + 10, col])).rows[0];
    const seat = (await db.query(
      `INSERT INTO daily_assignments
         (chart_id, shift, duty_title_mr, location_id, allocation_state, sort_order, column_no)
       VALUES ($1, $2, 'अंमलदार', $3, 'VACANT_RIKT', $4, $5)
       RETURNING assignment_id`,
      [input.chartId, shift, locationId, maxSort + 20, col])).rows[0];
    assignmentIds.push(Number(label.assignment_id), Number(seat.assignment_id));
  }
  return { locationId, assignmentIds, createdDutyCodes };
}

// ---- add officer box (edit-mode `+ अधिकारी बॉक्स जोडा`) --------------------------
export interface AddOfficerBoxInput {
  chartId: number;
  /** box label / branch name shown as the chip (e.g. "नवीन शाखा") — required */
  labelMr: string;
  /** optional heading (the officer's post/name); falls back to the label */
  titleMr?: string;
}
export interface AddOfficerBoxResult {
  label: string;
  writerDutyTitle: string;
  assignmentIds: number[];
}

interface BoxLike { label: string; title?: string; writerDutyTitle?: string; writerRole?: string; }

/** Add an अधिकारी box to a DRAFT chart — the officer-box twin of addChowkiBlock.
 *  Two writes, one transaction:
 *   1. presentation_overrides.officerBoxes += { label, title?, writerDutyTitle, writerRole }
 *      (chart-local display config — the renderer appends these to the template's boxes),
 *   2. a REAL VACANT_RIKT रायटर seat in the office column (DAY, column 4 — the renderer's
 *      office desk) whose duty_title is the box's writerDutyTitle. The seed's own grammar for
 *      the vacant तपास writer: the label row IS the रिक्त seat, so the box's role cell and
 *      its fillable slot are one addressable row (data-asn), not fake content.
 *  Nothing is invented: no person, no timing, no BIMA — the clerk fills the seat. */
export async function addOfficerBox(db: Queryable, input: AddOfficerBoxInput): Promise<AddOfficerBoxResult> {
  const label = (input.labelMr ?? "").trim();
  if (!label) throw new Error("labelMr is required");

  const rows = (await db.query(
    `SELECT c.lifecycle, c.presentation_overrides, tv.layout
       FROM daily_charts c
       JOIN template_versions tv ON tv.template_version_id = c.template_version_id
      WHERE c.chart_id = $1 FOR UPDATE OF c`, [input.chartId])).rows;
  if (rows.length !== 1) throw new Error(`no chart ${input.chartId}`);
  if (rows[0].lifecycle === "FINALIZED") throw new Error("FINALIZED charts are immutable; use amendment");

  const ov = { ...((rows[0].presentation_overrides as Record<string, unknown>) ?? {}) };
  const baseBoxes = ((rows[0].layout as Record<string, unknown>).officerBoxes as BoxLike[] | undefined) ?? [];
  const extraBoxes = (ov.officerBoxes as BoxLike[] | undefined) ?? [];
  if ([...baseBoxes, ...extraBoxes].some((b) => b.label === label)) {
    throw new Error(`या नावाचा अधिकारी बॉक्स आधीच आहे`);
  }

  // The renderer's office desk is DAY column 4 (chart-html col4); append after its last row.
  const writerDutyTitle = `${label}॰रायटर`;
  const maxSort = Number((await db.query(
    `SELECT COALESCE(MAX(sort_order), 0) AS m FROM daily_assignments
      WHERE chart_id = $1 AND shift = 'DAY' AND column_no = 4`, [input.chartId])).rows[0].m);
  const seatRow = (await db.query(
    `INSERT INTO daily_assignments (chart_id, shift, duty_title_mr, allocation_state, sort_order, column_no)
     VALUES ($1, 'DAY', $2, 'VACANT_RIKT', $3, 4)
     RETURNING assignment_id`, [input.chartId, writerDutyTitle, maxSort + 10])).rows[0];

  const title = (input.titleMr ?? "").trim();
  const box: BoxLike = { label, ...(title ? { title } : {}), writerDutyTitle, writerRole: "रायटर" };
  ov.officerBoxes = [...extraBoxes, box];
  await db.query(
    `UPDATE daily_charts SET presentation_overrides = $1 WHERE chart_id = $2`,
    [ov, input.chartId]);

  return {
    label,
    writerDutyTitle,
    assignmentIds: [Number(seatRow.assignment_id)],
  };
}

// ---- remove a chart block (edit-mode ✕ on an officer box or a chowki) ----------
// The counterpart of the two add functions above: the clerk can undo their own addition.
// Two hard guards keep this from becoming an information-loss path:
//   1. a block that holds ANY person is refused — the clerk clears the seats first, so no
//      assignment row can ever be swept away by a display control;
//   2. a chowki that another block's चार्ज points at is refused — that state would dangle.
// Only the chart's own rows are deleted (the master location/duty stay; the source chart in
// reference/ is never touched). FINALIZED charts are immutable, like every other edit.
export interface RemoveBlockInput { chartId: number; locationId?: number; label?: string; }
export interface RemoveBlockResult { removedAssignmentIds: number[]; removedStates: number; }

/** Remove ALL chart-local display names/keys that belonged to a box or block. */
function stripBlockOverrides(
  ov: Record<string, unknown>, prefixes: string[],
): Record<string, unknown> {
  const owns = (k: string) => prefixes.some((p) => k === p || k.startsWith(`${p}.`));
  const labels = { ...((ov.labels as Record<string, string>) ?? {}) };
  for (const k of Object.keys(labels)) if (owns(k)) delete labels[k];
  if (Object.keys(labels).length) ov.labels = labels; else delete ov.labels;
  const elements = { ...((ov.elements as Record<string, unknown>) ?? {}) };
  for (const k of Object.keys(elements)) if (owns(k)) delete elements[k];
  if (Object.keys(elements).length) ov.elements = elements; else delete ov.elements;
  // labelsAll is deliberately NOT touched: it is keyed by DEFAULT TEXT ("everywhere this name
  // appears"), not by element identity — a removal must not silently change other elements.
  return ov;
}

async function lockChartOverrides(db: Queryable, chartId: number): Promise<Record<string, unknown>> {
  const rows = (await db.query(
    `SELECT lifecycle, presentation_overrides FROM daily_charts WHERE chart_id = $1 FOR UPDATE`,
    [chartId])).rows;
  if (rows.length !== 1) throw new Error(`no chart ${chartId}`);
  if (rows[0].lifecycle === "FINALIZED") throw new Error("FINALIZED charts are immutable; use amendment");
  return { ...((rows[0].presentation_overrides as Record<string, unknown>) ?? {}) };
}

export async function removeOfficerBox(db: Queryable, input: RemoveBlockInput): Promise<RemoveBlockResult> {
  const label = (input.label ?? "").trim();
  if (!label) throw new Error("label is required");
  const ov = await lockChartOverrides(db, input.chartId);
  const extra = (ov.officerBoxes as BoxLike[] | undefined) ?? [];
  const box = extra.find((b) => b.label === label);
  if (!box) throw new Error(`no officer box ${label}`);

  // the seat(s) this box created — DAY column 4 rows carrying the box's writer title
  const writerDutyTitle = box.writerDutyTitle ?? `${label}॰रायटर`;
  const seats = (await db.query(
    `SELECT assignment_id, staff_id FROM daily_assignments
      WHERE chart_id = $1 AND shift = 'DAY' AND column_no = 4 AND duty_title_mr = $2
      FOR UPDATE`, [input.chartId, writerDutyTitle])).rows;
  if (seats.some((s) => s.staff_id != null)) {
    throw new Error("या बॉक्समध्ये कर्मचारी नेमलेला आहे — आधी ती जागा रिक्त करा");
  }
  const removed = (await db.query(
    `DELETE FROM daily_assignments
      WHERE chart_id = $1 AND shift = 'DAY' AND column_no = 4 AND duty_title_mr = $2 AND staff_id IS NULL
      RETURNING assignment_id`, [input.chartId, writerDutyTitle])).rows
    .map((r) => Number(r.assignment_id));

  const cleaned = stripBlockOverrides(ov, [`box.${label}`]);
  const rest = extra.filter((b) => b.label !== label);
  if (rest.length) cleaned.officerBoxes = rest; else delete cleaned.officerBoxes;
  await db.query(
    `UPDATE daily_charts SET presentation_overrides = $1 WHERE chart_id = $2`,
    [cleaned, input.chartId]);
  return { removedAssignmentIds: removed, removedStates: 0 };
}

export async function removeChowkiBlock(db: Queryable, input: RemoveBlockInput): Promise<RemoveBlockResult> {
  const locationId = Number(input.locationId);
  if (!Number.isFinite(locationId) || locationId <= 0) throw new Error("locationId is required");
  const ov = await lockChartOverrides(db, input.chartId);

  const rows = (await db.query(
    `SELECT assignment_id, staff_id FROM daily_assignments
      WHERE chart_id = $1 AND location_id = $2 FOR UPDATE`, [input.chartId, locationId])).rows;
  if (rows.length === 0) throw new Error("या तक्त्यावर ही चौकी नाही");
  if (rows.some((r) => r.staff_id != null)) {
    throw new Error("या चौकीवर कर्मचारी नेमलेले आहेत — आधी त्या जागा रिक्त करा");
  }
  // a चार्ज on ANOTHER block pointing here would be left dangling by the removal
  const charges = (await db.query(
    `SELECT location_id FROM location_operational_states
      WHERE chart_id = $1 AND charge_destination_location_id = $2`, [input.chartId, locationId])).rows;
  if (charges.length > 0) {
    throw new Error("दुसऱ्या चौकीचा चार्ज या चौकीकडे आहे — आधी तो बदला");
  }

  const removed = (await db.query(
    `DELETE FROM daily_assignments WHERE chart_id = $1 AND location_id = $2 AND staff_id IS NULL
      RETURNING assignment_id`, [input.chartId, locationId])).rows.map((r) => Number(r.assignment_id));
  // the block's own बंद/चार्ज states belong to the block
  const states = (await db.query(
    `DELETE FROM location_operational_states WHERE chart_id = $1 AND location_id = $2
      RETURNING location_id`, [input.chartId, locationId])).rows.length;

  const cleaned = stripBlockOverrides(ov, [`blk.L${locationId}`]);
  await db.query(
    `UPDATE daily_charts SET presentation_overrides = $1 WHERE chart_id = $2`,
    [cleaned, input.chartId]);
  return { removedAssignmentIds: removed, removedStates: states };
}

// ---- Sr-PI support seats (edit-mode `+ जागा` in the station-officer card) ----------
// The source charts carry only the Sr-PI's रायटर. चालक / RTPC / ऑपरेटर (day and night) are
// seats the clerk creates here; the renderer keeps them in their own assignment column so they
// never join a duty desk. Nothing is invented — a new seat starts VACANT_RIKT with no person,
// no timing and no BIMA, exactly like every other seat (user 2026-10-13: “ensure everything is
// crudable”).
export const SRPI_SUPPORT_COL = 9;
export const SRPI_SUPPORT_ROLES = ["रायटर", "चालक", "RTPC", "ऑपरेटर"] as const;
export type SrpiSupportRole = (typeof SRPI_SUPPORT_ROLES)[number];

export interface AddSupportSeatInput {
  chartId: number;
  role: string;
  shift: "DAY" | "NIGHT";
}
export interface SupportSeatResult {
  assignmentId: number;
  role: string;
  shift: "DAY" | "NIGHT";
}

async function lockChartForWrite(db: Queryable, chartId: number): Promise<void> {
  const rows = (await db.query(
    `SELECT lifecycle FROM daily_charts WHERE chart_id = $1 FOR UPDATE`, [chartId])).rows;
  if (rows.length !== 1) throw new Error(`no chart ${chartId}`);
  if (rows[0].lifecycle === "FINALIZED") {
    throw new Error("FINALIZED charts are immutable; use amendment");
  }
}

/** Create ONE vacant Sr-PI support seat. Idempotence is refused, not silently reused, so the
 *  clerk always knows whether the click created something. */
export async function addSupportSeat(db: Queryable, input: AddSupportSeatInput): Promise<SupportSeatResult> {
  const role = (input.role ?? "").trim();
  if (!(SRPI_SUPPORT_ROLES as readonly string[]).includes(role)) {
    throw new Error(`role must be one of ${SRPI_SUPPORT_ROLES.join(", ")}`);
  }
  if (input.shift !== "DAY" && input.shift !== "NIGHT") throw new Error("shift must be DAY or NIGHT");
  await lockChartForWrite(db, input.chartId);

  const dup = (await db.query(
    `SELECT 1 FROM daily_assignments
      WHERE chart_id = $1 AND column_no = $2 AND role_mr = $3 AND shift = $4 LIMIT 1`,
    [input.chartId, SRPI_SUPPORT_COL, role, input.shift])).rows;
  if (dup.length > 0) throw new Error("ही जागा आधीच आहे");

  const maxSort = Number((await db.query(
    `SELECT COALESCE(MAX(sort_order), 0) AS m FROM daily_assignments
      WHERE chart_id = $1 AND column_no = $2`, [input.chartId, SRPI_SUPPORT_COL])).rows[0].m);
  const row = (await db.query(
    `INSERT INTO daily_assignments (chart_id, shift, role_mr, column_no, allocation_state, sort_order)
     VALUES ($1, $2, $3, $4, 'VACANT_RIKT', $5)
     RETURNING assignment_id`,
    [input.chartId, input.shift, role, SRPI_SUPPORT_COL, maxSort + 10])).rows[0];

  return { assignmentId: Number(row.assignment_id), role, shift: input.shift };
}

/** Remove ONE vacant Sr-PI support seat (the clerk's own undo for `+ जागा`). Guards: only a
 *  support-column row may be deleted, and a seat holding a person must be cleared first —
 *  a display control can never sweep an assignment with a person on it. */
export async function removeSupportSeat(
  db: Queryable, input: { chartId: number; assignmentId: number },
): Promise<{ removedAssignmentIds: number[] }> {
  await lockChartForWrite(db, input.chartId);
  const cur = (await db.query(
    `SELECT assignment_id, chart_id, column_no, role_mr, staff_id
       FROM daily_assignments WHERE assignment_id = $1 FOR UPDATE`, [input.assignmentId])).rows;
  if (cur.length !== 1) throw new Error(`no assignment ${input.assignmentId}`);
  if (Number(cur[0].chart_id) !== input.chartId) {
    throw new Error(`assignment ${input.assignmentId} does not belong to chart ${input.chartId}`);
  }
  if (Number(cur[0].column_no) !== SRPI_SUPPORT_COL || cur[0].role_mr == null) {
    throw new Error("ही जागा सपोर्ट जागा नाही — ती तक्त्याचा भाग आहे");
  }
  if (cur[0].staff_id != null) {
    throw new Error("या जागेवर कर्मचारी नेमलेला आहे — आधी ती जागा रिक्त करा");
  }
  const removed = (await db.query(
    `DELETE FROM daily_assignments WHERE assignment_id = $1 RETURNING assignment_id`,
    [input.assignmentId])).rows.map((r) => Number(r.assignment_id));
  return { removedAssignmentIds: removed };
}

// ---- General dated assignment / seat CRUD -------------------------------------
export interface CreateSeatInput {
  chartId: number;
  shift: "DAY" | "NIGHT";
  columnNo?: number;
  sortOrder?: number;
  dutyId?: number | null;
  dutyTitleMr?: string | null;
  locationId?: number | null;
  unitCode?: string | null;
  roleMr?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  notesMr?: string | null;
  staffId?: number | null;
  isBima?: boolean;
}

export async function createAssignmentSeat(db: Queryable, input: CreateSeatInput): Promise<{ assignmentId: number }> {
  if (input.shift !== "DAY" && input.shift !== "NIGHT") throw new Error("shift must be DAY or NIGHT");
  await lockChartForWrite(db, input.chartId);

  const columnNo = Number.isInteger(input.columnNo) ? Number(input.columnNo) : 1;
  let sortOrder = input.sortOrder;
  if (!Number.isInteger(sortOrder)) {
    const maxSort = (await db.query(
      `SELECT COALESCE(MAX(sort_order), 0) AS m FROM daily_assignments
        WHERE chart_id = $1 AND shift = $2 AND column_no = $3`,
      [input.chartId, input.shift, columnNo])).rows[0].m;
    sortOrder = Number(maxSort) + 10;
  }

  let staffId: number | null = input.staffId ?? null;
  let isBima = false;
  let allocState: "ALLOCATED" | "VACANT_RIKT" = "VACANT_RIKT";

  if (staffId !== null) {
    const s = (await db.query(`SELECT staff_id, active FROM staff_members WHERE staff_id = $1`, [staffId])).rows;
    if (s.length !== 1) throw new Error(`no staff ${staffId}`);
    if (!s[0].active) throw new Error(`staff ${staffId} is inactive`);
    allocState = "ALLOCATED";
    isBima = Boolean(input.isBima);
  }

  if (input.locationId != null) {
    const l = (await db.query(`SELECT 1 FROM locations WHERE location_id = $1`, [input.locationId])).rows;
    if (l.length === 0) throw new Error(`no location ${input.locationId}`);
  }

  if (input.dutyId != null) {
    const d = (await db.query(`SELECT 1 FROM duty_definitions WHERE duty_id = $1`, [input.dutyId])).rows;
    if (d.length === 0) throw new Error(`no duty ${input.dutyId}`);
  }

  if (input.unitCode != null && input.unitCode.trim()) {
    const u = (await db.query(`SELECT 1 FROM units WHERE unit_code = $1`, [input.unitCode.trim()])).rows;
    if (u.length === 0) throw new Error(`no unit ${input.unitCode}`);
  }

  const res = (await db.query(
    `INSERT INTO daily_assignments
       (chart_id, shift, column_no, sort_order, duty_id, duty_title_mr, location_id, unit_code,
        role_mr, start_time, end_time, notes_mr, staff_id, allocation_state, is_bima)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING assignment_id`,
    [
      input.chartId,
      input.shift,
      columnNo,
      sortOrder,
      input.dutyId ?? null,
      input.dutyTitleMr ? input.dutyTitleMr.trim() : null,
      input.locationId ?? null,
      input.unitCode ? input.unitCode.trim() : null,
      input.roleMr ? input.roleMr.trim() : null,
      input.startTime || null,
      input.endTime || null,
      input.notesMr ? input.notesMr.trim() : null,
      staffId,
      allocState,
      isBima,
    ])).rows[0];

  return { assignmentId: Number(res.assignment_id) };
}

export async function deleteAssignmentSeat(
  db: Queryable, input: { chartId: number; assignmentId: number },
): Promise<{ ok: true; removedAssignmentId: number }> {
  await lockChartForWrite(db, input.chartId);
  const cur = (await db.query(
    `SELECT assignment_id, chart_id, staff_id FROM daily_assignments
      WHERE assignment_id = $1 FOR UPDATE`, [input.assignmentId])).rows;
  if (cur.length !== 1) throw new Error(`no assignment ${input.assignmentId}`);
  if (Number(cur[0].chart_id) !== input.chartId) {
    throw new Error(`assignment ${input.assignmentId} does not belong to chart ${input.chartId}`);
  }
  if (cur[0].staff_id != null) {
    throw new Error("या जागेवर कर्मचारी नेमलेला आहे — आधी ती जागा रिक्त करा");
  }

  await db.query(`DELETE FROM daily_assignments WHERE assignment_id = $1`, [input.assignmentId]);
  return { ok: true, removedAssignmentId: input.assignmentId };
}

export interface UpdateSeatMetadataInput {
  chartId: number;
  assignmentId: number;
  dutyTitleMr?: string | null;
  roleMr?: string | null;
  unitCode?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  notesMr?: string | null;
  shift?: "DAY" | "NIGHT";
  columnNo?: number;
  sortOrder?: number;
  locationId?: number | null;
  dutyId?: number | null;
}

export async function updateAssignmentMetadata(
  db: Queryable, input: UpdateSeatMetadataInput,
): Promise<{ ok: true; assignmentId: number }> {
  await lockChartForWrite(db, input.chartId);
  const cur = (await db.query(
    `SELECT assignment_id, chart_id FROM daily_assignments
      WHERE assignment_id = $1 FOR UPDATE`, [input.assignmentId])).rows;
  if (cur.length !== 1) throw new Error(`no assignment ${input.assignmentId}`);
  if (Number(cur[0].chart_id) !== input.chartId) {
    throw new Error(`assignment ${input.assignmentId} does not belong to chart ${input.chartId}`);
  }

  const sets: string[] = [];
  const values: unknown[] = [];

  const addField = (col: string, val: unknown) => {
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  };

  if ("dutyTitleMr" in input) addField("duty_title_mr", input.dutyTitleMr ? input.dutyTitleMr.trim() : null);
  if ("roleMr" in input) addField("role_mr", input.roleMr ? input.roleMr.trim() : null);
  if ("unitCode" in input) addField("unit_code", input.unitCode ? input.unitCode.trim() : null);
  if ("startTime" in input) addField("start_time", input.startTime || null);
  if ("endTime" in input) addField("end_time", input.endTime || null);
  if ("notesMr" in input) addField("notes_mr", input.notesMr ? input.notesMr.trim() : null);
  if ("shift" in input && input.shift) {
    if (input.shift !== "DAY" && input.shift !== "NIGHT") throw new Error("shift must be DAY or NIGHT");
    addField("shift", input.shift);
  }
  if ("columnNo" in input && input.columnNo != null) addField("column_no", Number(input.columnNo));
  if ("sortOrder" in input && input.sortOrder != null) addField("sort_order", Number(input.sortOrder));
  if ("locationId" in input) addField("location_id", input.locationId ?? null);
  if ("dutyId" in input) addField("duty_id", input.dutyId ?? null);

  if (sets.length === 0) return { ok: true, assignmentId: input.assignmentId };

  values.push(input.assignmentId);
  await db.query(`UPDATE daily_assignments SET ${sets.join(", ")} WHERE assignment_id = $${values.length}`, values);
  return { ok: true, assignmentId: input.assignmentId };
}

