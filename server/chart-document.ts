// Purpose: ChartDocument — the typed projection of a chart's normalized B-layer rows
//   (T13 hybrid model) and the immutable snapshot shape stored at FINALIZE.
// Current role: P1 slice 1 — projection + snapshot read path; renderer consumes this.
// Last meaningful change: 2026-10-08 — created at P1 start (after P0 DB foundation).
// Constraint/dependency: AGENTS.md hard rules; resolved Layer-A values are embedded at
//   projection time so a snapshot renders without today's masters; D-rule values (weekday)
//   are computed here, never stored.
import type pg from "pg";

export type Lifecycle = "DRAFT" | "VALIDATED" | "FINALIZED";
export type Shift = "DAY" | "NIGHT";

/** Either a pool or a transaction client. */
export type Queryable = pg.Pool | pg.PoolClient;

// ---- embedded master values (render-ready; snapshot never needs a live FK join) ----
export interface DocPerson {
  staffId: number;
  nameMr: string;              // FULL name (staff master / Staff_Info docx — never shortened in storage)
  rankCode: string;            // protected token (PI, PC, ...) — never translated
  rankShortFormMr: string | null;
  /** Rank cadre from ranks master — display-derivation input for the compact chart name
   *  form (OFFICER cadre → given+surname, name-keyed constabulary → surname). Optional:
   *  snapshots taken before this field may not carry it. */
  cadre?: string | null;
  /** Full rank name without the "(short)" suffix — verified from ranks master (tooltip full form).
   *  Optional: snapshots taken before this field existed may not carry it. */
  rankNameMr?: string | null;
  buckleNo: string | null;
}
export interface DocLocation {
  locationId: number;
  code: string;
  nameMr: string;
  kind: string;                // STATION | CHOWKI | MARSHAL_POST | OFFICE | COURT | FIXED_POINT
}
export interface DocUnit { unitCode: string; nameMr: string; }

export interface DocAssignment {
  assignmentId: number;
  shift: Shift;
  columnNo: number;            // source chart's duty-column stack (content structure, not page geometry)
  sortOrder: number;
  dutyCode: string | null;
  dutyTitleMr: string | null;  // row label when present, else duty_definitions.title_mr
  /** TRUE when this labelled row's text comes from the duty DEFINITION (a post head the
   *  seed created with a duty_code), FALSE when the label is source cell text carried on
   *  the row (continuation labels like बंद/चार्ज/एम.टी.सेक्षन). Structure signal only —
   *  never derived from text matching. */
  labelFromDuty?: boolean;
  location: DocLocation | null;
  unit: DocUnit | null;
  person: DocPerson | null;
  allocationState: "ALLOCATED" | "VACANT_RIKT";
  isBima: boolean;             // explicit per-assignment flag — never derived from text
  status: "ACTIVE" | "NEEDS_ATTENTION";
  source: "MANUAL" | "COPIED" | "REPLACED";
  startTime: string | null;    // HH:MM:SS (typed split windows)
  endTime: string | null;
  notesMr: string | null;      // display only — never parsed
  /** Source chart's ROLE column for this row (रायटर / ऑपरेटर / (तपास) …) — the label the
   *  source prints in the row's left cell. Display only, never parsed. Optional: snapshots
   *  taken before the role column existed may not carry it. */
  roleMr?: string | null;
}

export interface DocLocationState {
  shift: Shift;
  location: DocLocation;
  isClosed: boolean;                                   // बंद — a PLACE fact
  chargeTo: { locationId: number; code: string; nameMr: string } | null;
}

export interface DocAvailability {
  availabilityId: number;
  sortOrder: number;
  groupKey: string | null;     // rendered column group (साप्ताहिक सुट्टी, ...)
  category: string;
  person: DocPerson | null;    // null = category label with nobody listed (source)
  windowStart: string | null;  // YYYY-MM-DD
  windowEnd: string | null;
  timeStart: string | null;
  timeEnd: string | null;
  detailMr: string | null;     // verbatim ("08 ते 10") — never parsed
}

export interface DocNotice {
  noticeId: number;          // chart_notices row id — the notice line's edit target (CRUD)
  groupKey: string | null;
  sortOrder: number;
  textMr: string;
}

export interface DocManpowerCell {
  displayOrder: number;        // source row order (मंजूर → हजर → ...)
  rowKey: string;
  columnKey: string;
  valueText: string;           // verbatim source value ("..", "12<br>04 Proण्") — never recalculated
  isDerived: boolean;          // D-rule: derived values are never editable
}

export interface DocShiftSummary { summaryKey: "DAY" | "NIGHT" | "OTHER"; columnKey: string; valueText: string; }

export interface DocOfficerRow {
  rowNo: number;
  officerText: string;         // source spelling preserved
  dutyText: string;
  source: "SOURCE" | "SUGGESTION" | "OVERRIDE";
}

export interface DocScanRow {
  sessionCode: string;
  sequence: number;
  startTime: string | null;
  endTime: string | null;
  location: DocLocation | null;  // चौकी हद्द from the station-stable scan config
  person: DocPerson | null;
  noteMr: string | null;
}

export interface DocSuddenChange {
  seq: number;
  original: DocPerson | null;
  replacement: DocPerson | null;
  detailMr: string;
  noteMr: string | null;
  createdAt: string;           // ISO timestamp
}

export interface DocEvent {
  eventId: number;
  titleMr: string;
  eventDate: string;           // YYYY-MM-DD
  startTime: string | null;
  venueMr: string | null;
  fallInMr: string | null;
  assignments: { person: DocPerson | null; roleMr: string | null; sortOrder: number }[];
}

export interface MatrixColumn { key: string; label: string; }

export interface ChartDocument {
  chartId: number;
  chartDate: string;           // YYYY-MM-DD
  weekdayMr: string;           // D-rule: computed from date at projection, never stored/edited
  lifecycle: Lifecycle;
  template: {
    templateVersionId: number; // pinned at chart creation (§9) — template edits never touch it
    labels: Record<string, unknown>;
    layout: Record<string, unknown> & { matrixColumns?: MatrixColumn[]; shiftSummaryColumns?: string[] };
    overrides: Record<string, unknown>; // chart-only "या तक्त्यासाठी" values, keyed by template node id
  };
  assignments: DocAssignment[];
  locationStates: DocLocationState[];
  availability: DocAvailability[];
  notices: DocNotice[];
  manpower: DocManpowerCell[];
  shiftSummaries: DocShiftSummary[];
  officerSummary: DocOfficerRow[];
  scanSchedule: DocScanRow[];
  suddenChanges: DocSuddenChange[];
  events: DocEvent[];
}

// ---- derived (D-rule) helpers ----------------------------------------------------
const WEEKDAYS_MR = ["रविवार", "सोमवार", "मंगळवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];

/** Weekday from the date itself — computed, never stored, never editable. UTC-safe. */
export function weekdayMr(chartDate: string): string {
  const d = new Date(`${chartDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid chart date: ${chartDate}`);
  return WEEKDAYS_MR[d.getUTCDay()];
}

/** Resolution order for template-bound values: chart overrides → pinned template → undefined. */
export function resolveNode(doc: ChartDocument, nodeId: string): Record<string, unknown> | undefined {
  const base = (doc.template.labels[nodeId] as Record<string, unknown> | undefined)
    ?? (doc.template.layout[nodeId] as Record<string, unknown> | undefined);
  const over = doc.template.overrides[nodeId] as Record<string, unknown> | undefined;
  if (!base && !over) return undefined;
  return { ...(base ?? {}), ...(over ?? {}) };
}

// ---- projection ------------------------------------------------------------------
// Rank full form: master stores "वरिष्ठ पोलीस निरीक्षक (वपोनि)" — tooltip shows the part
// before the verified short-form suffix. Display derivation only; masters never mutated.
function rankFullName(full: string | null): string | null {
  if (!full) return null;
  const stripped = full.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return stripped || null;
}

function personOf(r: Record<string, unknown>): DocPerson | null {
  if (r.staff_id == null) return null;
  return {
    staffId: Number(r.staff_id),
    nameMr: r.staff_name as string,
    rankCode: r.rank_code as string,
    rankShortFormMr: (r.rank_short as string | null) ?? null,
    rankNameMr: rankFullName((r.rank_name as string | null) ?? null),
    cadre: (r.rank_cadre as string | null) ?? null,
    buckleNo: (r.buckle_no as string | null) ?? null,
  };
}
function locOf(r: Record<string, unknown>, p = "loc_"): DocLocation {
  const id = Number(r[`${p}id`]);
  if (!Number.isFinite(id)) throw new Error(`projection: missing/invalid ${p}id in row`); // fail loud
  return {
    locationId: id,
    code: r[`${p}code`] as string,
    nameMr: r[`${p}name`] as string,
    kind: r[`${p}kind`] as string,
  };
}

export async function projectChart(db: Queryable, chartId: number): Promise<ChartDocument> {
  const meta = (await db.query(
    `SELECT c.chart_id, to_char(c.chart_date,'YYYY-MM-DD') AS chart_date, c.lifecycle,
            c.template_version_id, c.presentation_overrides,
            tv.labels, tv.layout
       FROM daily_charts c
       JOIN template_versions tv ON tv.template_version_id = c.template_version_id
      WHERE c.chart_id = $1`, [chartId])).rows;
  if (meta.length !== 1) throw new Error(`projectChart: no chart ${chartId}`);
  const m = meta[0];

  const assignments = (await db.query(
    `SELECT a.assignment_id, a.shift, a.column_no, a.sort_order,
            d.duty_code, d.title_mr AS duty_def_title, a.duty_title_mr,
            a.location_id AS loc_id, l.location_code AS loc_code, l.name_mr AS loc_name, l.kind AS loc_kind,
            a.unit_code, u.name_mr AS unit_name,
            a.staff_id, s.name_mr AS staff_name, s.rank_code, r.short_form_mr AS rank_short, r.name_mr AS rank_name, r.cadre AS rank_cadre, s.buckle_no,
            a.allocation_state, a.is_bima, a.status, a.source,
            to_char(a.start_time,'HH24:MI:SS') AS start_time,
            to_char(a.end_time,'HH24:MI:SS') AS end_time,
            a.notes_mr, a.role_mr
       FROM daily_assignments a
       LEFT JOIN duty_definitions d ON d.duty_id = a.duty_id
       LEFT JOIN locations l ON l.location_id = a.location_id
       LEFT JOIN units u ON u.unit_code = a.unit_code
       LEFT JOIN staff_members s ON s.staff_id = a.staff_id
       LEFT JOIN ranks r ON r.rank_code = s.rank_code
      WHERE a.chart_id = $1
      ORDER BY CASE a.shift WHEN 'DAY' THEN 0 ELSE 1 END, a.column_no, a.sort_order, a.assignment_id`,
    [chartId])).rows.map((r): DocAssignment => ({
    assignmentId: Number(r.assignment_id),
    shift: r.shift as Shift,
    columnNo: Number(r.column_no),
    sortOrder: Number(r.sort_order),
    dutyCode: (r.duty_code as string | null) ?? null,
    dutyTitleMr: (r.duty_title_mr as string | null) ?? (r.duty_def_title as string | null) ?? null,
    labelFromDuty: r.duty_title_mr == null && r.duty_code != null,
    location: r.loc_id == null ? null : locOf(r),
    unit: r.unit_code == null ? null : { unitCode: r.unit_code as string, nameMr: r.unit_name as string },
    person: personOf(r),
    allocationState: r.allocation_state as DocAssignment["allocationState"],
    isBima: Boolean(r.is_bima),
    status: r.status as DocAssignment["status"],
    source: r.source as DocAssignment["source"],
    startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null,
    notesMr: (r.notes_mr as string | null) ?? null,
    roleMr: (r.role_mr as string | null) ?? null,
  }));

  const locationStates = (await db.query(
    `SELECT s.shift, s.is_closed,
            l.location_id AS loc_id, l.location_code AS loc_code, l.name_mr AS loc_name, l.kind AS loc_kind,
            c.location_id AS ch_id, c.location_code AS ch_code, c.name_mr AS ch_name
       FROM location_operational_states s
       JOIN locations l ON l.location_id = s.location_id
       LEFT JOIN locations c ON c.location_id = s.charge_destination_location_id
      WHERE s.chart_id = $1
      ORDER BY CASE s.shift WHEN 'DAY' THEN 0 ELSE 1 END, l.display_order, l.location_code`,
    [chartId])).rows.map((r): DocLocationState => ({
    shift: r.shift as Shift,
    location: locOf(r),
    isClosed: Boolean(r.is_closed),
    chargeTo: r.ch_id == null ? null
      : { locationId: Number(r.ch_id), code: r.ch_code as string, nameMr: r.ch_name as string },
  }));

  const availability = (await db.query(
    `SELECT a.availability_id, a.sort_order, a.group_key, a.category,
            a.staff_id, s.name_mr AS staff_name, s.rank_code, r.short_form_mr AS rank_short, r.name_mr AS rank_name, r.cadre AS rank_cadre, s.buckle_no,
            to_char(a.window_start,'YYYY-MM-DD') AS window_start,
            to_char(a.window_end,'YYYY-MM-DD') AS window_end,
            to_char(a.time_start,'HH24:MI:SS') AS time_start,
            to_char(a.time_end,'HH24:MI:SS') AS time_end,
            a.detail_mr
       FROM daily_availabilities a
       LEFT JOIN staff_members s ON s.staff_id = a.staff_id
       LEFT JOIN ranks r ON r.rank_code = s.rank_code
      WHERE a.chart_id = $1
      ORDER BY a.sort_order, a.availability_id`,
    [chartId])).rows.map((r): DocAvailability => ({
    availabilityId: Number(r.availability_id),
    sortOrder: Number(r.sort_order),
    groupKey: (r.group_key as string | null) ?? null,
    category: r.category as string,
    person: personOf(r),
    windowStart: (r.window_start as string | null) ?? null,
    windowEnd: (r.window_end as string | null) ?? null,
    timeStart: (r.time_start as string | null) ?? null,
    timeEnd: (r.time_end as string | null) ?? null,
    detailMr: (r.detail_mr as string | null) ?? null,
  }));

  const notices = (await db.query(
    `SELECT notice_id, group_key, sort_order, text_mr FROM chart_notices
      WHERE chart_id = $1 ORDER BY sort_order, notice_id`, [chartId]))
    .rows.map((r): DocNotice => ({
      noticeId: Number(r.notice_id),
      groupKey: (r.group_key as string | null) ?? null,
      sortOrder: Number(r.sort_order),
      textMr: r.text_mr as string,
    }));

  const manpower = (await db.query(
    `SELECT row_key, column_key, value_text, is_derived, display_order
       FROM manpower_records WHERE chart_id = $1`, [chartId])).rows
    .map((r): DocManpowerCell => ({
      displayOrder: Number(r.display_order),
      rowKey: r.row_key as string,
      columnKey: r.column_key as string,
      valueText: r.value_text as string,
      isDerived: Boolean(r.is_derived),
    }));
  // Row order = source display_order; column order = pinned template's matrixColumns.
  const colOrder = ((m.layout as Record<string, unknown>).matrixColumns as MatrixColumn[] | undefined) ?? [];
  const colIndex = (k: string) => { const i = colOrder.findIndex((c) => c.key === k); return i === -1 ? 999 : i; };
  manpower.sort((a, b) => a.displayOrder - b.displayOrder || colIndex(a.columnKey) - colIndex(b.columnKey));

  const shiftSummaries = (await db.query(
    `SELECT summary_key, column_key, value_text FROM shift_summary_cells
      WHERE chart_id = $1 ORDER BY CASE summary_key WHEN 'DAY' THEN 0 WHEN 'NIGHT' THEN 1 ELSE 2 END`,
    [chartId])).rows.map((r): DocShiftSummary => ({
    summaryKey: r.summary_key as DocShiftSummary["summaryKey"],
    columnKey: r.column_key as string,
    valueText: r.value_text as string,
  }));

  const officerSummary = (await db.query(
    `SELECT row_no, officer_text, duty_text, source FROM officer_summary_rows
      WHERE chart_id = $1 ORDER BY row_no`, [chartId])).rows
    .map((r): DocOfficerRow => ({
      rowNo: Number(r.row_no),
      officerText: r.officer_text as string,
      dutyText: r.duty_text as string,
      source: r.source as DocOfficerRow["source"],
    }));

  const scanSchedule = (await db.query(
    `SELECT d.session_code, d.sequence,
            to_char(d.start_time,'HH24:MI:SS') AS start_time,
            to_char(d.end_time,'HH24:MI:SS') AS end_time,
            d.note_mr,
            d.staff_id, s.name_mr AS staff_name, s.rank_code, r.short_form_mr AS rank_short, r.name_mr AS rank_name, r.cadre AS rank_cadre, s.buckle_no,
            cl.location_id AS loc_id, cl.location_code AS loc_code, cl.name_mr AS loc_name, cl.kind AS loc_kind
       FROM scan_schedule_daily d
       LEFT JOIN staff_members s ON s.staff_id = d.staff_id
       LEFT JOIN ranks r ON r.rank_code = s.rank_code
       LEFT JOIN scan_schedule_config cfg
              ON cfg.session_code = d.session_code AND cfg.sequence = d.sequence
       LEFT JOIN locations cl ON cl.location_id = cfg.location_id
      WHERE d.chart_id = $1 ORDER BY d.sequence`, [chartId])).rows
    .map((r): DocScanRow => ({
      sessionCode: r.session_code as string,
      sequence: Number(r.sequence),
      startTime: (r.start_time as string | null) ?? null,
      endTime: (r.end_time as string | null) ?? null,
      location: r.loc_id == null ? null : locOf(r),
      person: personOf(r),
      noteMr: (r.note_mr as string | null) ?? null,
    }));

  const suddenChanges = (await db.query(
    `SELECT c.seq, c.detail_mr, c.note_mr, c.created_at,
            o.staff_id AS o_id, o.name_mr AS o_name, o.rank_code AS o_rank, ro.short_form_mr AS o_short, ro.name_mr AS o_rankname, ro.cadre AS o_cadre, o.buckle_no AS o_buckle,
            n.staff_id AS n_id, n.name_mr AS n_name, n.rank_code AS n_rank, rn.short_form_mr AS n_short, rn.name_mr AS n_rankname, rn.cadre AS n_cadre, n.buckle_no AS n_buckle
       FROM sudden_duty_changes c
       LEFT JOIN staff_members o ON o.staff_id = c.original_staff_id
       LEFT JOIN ranks ro ON ro.rank_code = o.rank_code
       LEFT JOIN staff_members n ON n.staff_id = c.replacement_staff_id
       LEFT JOIN ranks rn ON rn.rank_code = n.rank_code
      WHERE c.chart_id = $1 ORDER BY c.seq`, [chartId])).rows
    .map((r): DocSuddenChange => ({
      seq: Number(r.seq),
      original: r.o_id == null ? null : {
        staffId: Number(r.o_id), nameMr: r.o_name as string, rankCode: r.o_rank as string,
        rankShortFormMr: (r.o_short as string | null) ?? null,
        rankNameMr: rankFullName((r.o_rankname as string | null) ?? null),
        cadre: (r.o_cadre as string | null) ?? null,
        buckleNo: (r.o_buckle as string | null) ?? null,
      },
      replacement: r.n_id == null ? null : {
        staffId: Number(r.n_id), nameMr: r.n_name as string, rankCode: r.n_rank as string,
        rankShortFormMr: (r.n_short as string | null) ?? null,
        rankNameMr: rankFullName((r.n_rankname as string | null) ?? null),
        cadre: (r.n_cadre as string | null) ?? null,
        buckleNo: (r.n_buckle as string | null) ?? null,
      },
      detailMr: r.detail_mr as string,
      noteMr: (r.note_mr as string | null) ?? null,
      createdAt: new Date(r.created_at as string).toISOString(),
    }));

  const eventRows = (await db.query(
    `SELECT event_id, title_mr, to_char(event_date,'YYYY-MM-DD') AS event_date,
            to_char(start_time,'HH24:MI:SS') AS start_time, venue_mr, fall_in_mr
       FROM special_events WHERE chart_id = $1 ORDER BY event_id, event_date`, [chartId])).rows;
  const events: DocEvent[] = [];
  for (const e of eventRows) {
    const eas = (await db.query(
      `SELECT ea.staff_id, ea.role_mr, ea.sort_order,
              s.name_mr AS staff_name, s.rank_code, r.short_form_mr AS rank_short, r.name_mr AS rank_name, r.cadre AS rank_cadre, s.buckle_no
         FROM event_assignments ea
         LEFT JOIN staff_members s ON s.staff_id = ea.staff_id
         LEFT JOIN ranks r ON r.rank_code = s.rank_code
        WHERE ea.event_id = $1 ORDER BY ea.sort_order, ea.event_assignment_id`, [e.event_id])).rows;
    events.push({
      eventId: Number(e.event_id),
      titleMr: e.title_mr as string,
      eventDate: e.event_date as string,
      startTime: (e.start_time as string | null) ?? null,
      venueMr: (e.venue_mr as string | null) ?? null,
      fallInMr: (e.fall_in_mr as string | null) ?? null,
      assignments: eas.map((r) => ({ person: personOf(r), roleMr: (r.role_mr as string | null) ?? null, sortOrder: Number(r.sort_order) })),
    });
  }

  return {
    chartId: Number(m.chart_id),
    chartDate: m.chart_date as string,
    weekdayMr: weekdayMr(m.chart_date as string),
    lifecycle: m.lifecycle as Lifecycle,
    template: {
      templateVersionId: Number(m.template_version_id),
      labels: (m.labels as Record<string, unknown>) ?? {},
      layout: (m.layout as Record<string, unknown>) ?? {},
      overrides: (m.presentation_overrides as Record<string, unknown>) ?? {},
    },
    assignments,
    locationStates,
    availability,
    notices,
    manpower,
    shiftSummaries,
    officerSummary,
    scanSchedule,
    suddenChanges,
    events,
  };
}

// ---- snapshot read path (finalized charts render from THIS only) ------------------
export interface Snapshot {
  versionNo: number;
  createdAt: string;
  reason: string | null;
  amendedFromVersionId: number | null;
  document: ChartDocument;
}

export async function getSnapshot(
  db: Queryable, chartId: number, versionNo?: number,
): Promise<Snapshot> {
  const rows = versionNo == null
    ? (await db.query(
        `SELECT version_no, document_json, created_at, reason, amended_from_version_id
           FROM chart_versions WHERE chart_id = $1 ORDER BY version_no DESC LIMIT 1`, [chartId])).rows
    : (await db.query(
        `SELECT version_no, document_json, created_at, reason, amended_from_version_id
           FROM chart_versions WHERE chart_id = $1 AND version_no = $2`, [chartId, versionNo])).rows;
  if (rows.length !== 1) {
    throw new Error(`getSnapshot: chart ${chartId}${versionNo != null ? ` version ${versionNo}` : ""} not found`);
  }
  const r = rows[0];
  return {
    versionNo: Number(r.version_no),
    createdAt: new Date(r.created_at as string).toISOString(),
    reason: (r.reason as string | null) ?? null,
    amendedFromVersionId: r.amended_from_version_id == null ? null : Number(r.amended_from_version_id),
    document: r.document_json as ChartDocument,
  };
}
