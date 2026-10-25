/**
 * Purpose: Frontend-only TypeScript view of the Fastify ChartDocument contract.
 * Current role: Keeps chart screens lossless and prevents `any` payloads in components.
 * Last meaningful change: 2026-10-18 — continuation editing identifiers and state contracts.
 * Constraint: These types mirror the existing API; they are not a second persistence model.
 */

export type Lifecycle = "DRAFT" | "VALIDATED" | "FINALIZED";
export type Shift = "DAY" | "NIGHT";

export interface Person {
  staffId: number;
  nameMr: string;
  rankCode: string;
  rankShortFormMr?: string | null;
  rankNameMr?: string | null;
  cadre?: string | null;
  buckleNo?: string | null;
}

export interface Assignment {
  assignmentId: number;
  shift: Shift;
  columnNo: number;
  sortOrder: number;
  dutyCode: string | null;
  dutyTitleMr: string | null;
  labelFromDuty?: boolean;
  location: Location | null;
  unit: Unit | null;
  person: Person | null;
  allocationState: "ALLOCATED" | "VACANT_RIKT";
  isBima: boolean;
  status: "ACTIVE" | "NEEDS_ATTENTION";
  source: "MANUAL" | "COPIED" | "REPLACED";
  startTime: string | null;
  endTime: string | null;
  notesMr: string | null;
  roleMr?: string | null;
}

export interface Location {
  locationId: number;
  code: string;
  nameMr: string;
  kind: string;
}

export interface Unit {
  unitCode: string;
  nameMr: string;
}

export interface LocationState {
  shift: Shift;
  location: Location;
  isClosed: boolean;
  chargeTo: { locationId: number; code: string; nameMr: string } | null;
}

export interface Availability {
  availabilityId: number;
  sortOrder: number;
  groupKey: string | null;
  category: string;
  person: Person | null;
  windowStart: string | null;
  windowEnd: string | null;
  timeStart: string | null;
  timeEnd: string | null;
  detailMr: string | null;
}

export interface Notice {
  noticeId: number;
  groupKey: string | null;
  sortOrder: number;
  textMr: string;
}

export interface ManpowerCell {
  displayOrder: number;
  rowKey: string;
  columnKey: string;
  valueText: string;
  isDerived: boolean;
}

export interface ShiftSummary {
  summaryKey: "DAY" | "NIGHT" | "OTHER";
  columnKey: string;
  valueText: string;
}

export interface OfficerRow {
  rowNo: number;
  officerText: string;
  dutyText: string;
  source: "SOURCE" | "SUGGESTION" | "OVERRIDE";
}

export interface ScanRow {
  sessionCode: string;
  sequence: number;
  startTime: string | null;
  endTime: string | null;
  location: Location | null;
  person: Person | null;
  noteMr: string | null;
}

export interface SuddenChange {
  seq: number;
  original: Person | null;
  replacement: Person | null;
  detailMr: string;
  noteMr: string | null;
  createdAt: string;
}

export interface EventAssignment {
  person: Person | null;
  roleMr: string | null;
  sortOrder: number;
}

export interface EventRecord {
  eventId: number;
  titleMr: string;
  eventDate: string;
  startTime: string | null;
  venueMr: string | null;
  fallInMr: string | null;
  assignments: EventAssignment[];
}

export interface MatrixColumn {
  key: string;
  label: string;
}

export interface FreeTable {
  id: string;
  title: string;
  columns: string[];
  rows: string[][];
}

export interface StructureOverrides {
  tables?: FreeTable[];
  matrix?: {
    addedColumns?: MatrixColumn[];
    hiddenColumns?: string[];
    cells?: Record<string, string>;
  };
}

export interface ChartDocument {
  chartId: number;
  chartDate: string;
  weekdayMr: string;
  lifecycle: Lifecycle;
  template: {
    templateVersionId: number;
    labels: Record<string, unknown>;
    layout: Record<string, unknown> & {
      matrixColumns?: MatrixColumn[];
      shiftSummaryColumns?: string[];
    };
    overrides: Record<string, unknown>;
  };
  assignments: Assignment[];
  locationStates: LocationState[];
  availability: Availability[];
  notices: Notice[];
  manpower: ManpowerCell[];
  shiftSummaries: ShiftSummary[];
  officerSummary: OfficerRow[];
  scanSchedule: ScanRow[];
  suddenChanges: SuddenChange[];
  events: EventRecord[];
}

export interface ChartReference {
  date: string;
  lifecycle: Lifecycle;
}

export interface RankMaster {
  rank_code: string;
  name_mr: string;
  short_form_mr: string | null;
  cadre: string;
  display_order: number;
  active: boolean;
}

export interface StaffMaster {
  staff_id: number;
  name_mr: string;
  /** Compatibility field used by the existing chart picker; staff management does not expose it. */
  name_en: string | null;
  rank_code: string;
  buckle_no: string | null;
  phone: string | null;
  duty_assignment: string | null;
  weekly_off: string | null;
  active: boolean;
}

export interface LocationMaster {
  location_id: number;
  location_code: string;
  name_mr: string;
  kind: string;
  display_order: number;
  active: boolean;
}

export interface DutyMaster {
  duty_id: number;
  duty_code: string;
  title_mr: string;
  section_code: string | null;
  default_shift: Shift | null;
  location_id: number | null;
  display_order: number;
  active: boolean;
}

export interface UnitMaster {
  unit_code: string;
  name_mr: string;
  unit_type: string;
  display_order: number;
  active: boolean;
}

export interface MastersResponse {
  ranks: RankMaster[];
  staff: StaffMaster[];
  locations: LocationMaster[];
  duties: DutyMaster[];
  units: UnitMaster[];
}

export interface ApiErrorPayload {
  error?: string;
  hint?: string;
}

export interface CreateSeatInput {
  shift: Shift;
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

export interface UpdateSeatMetadataInput {
  dutyTitleMr?: string | null;
  roleMr?: string | null;
  unitCode?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  notesMr?: string | null;
  shift?: Shift;
  columnNo?: number;
  sortOrder?: number;
  locationId?: number | null;
  dutyId?: number | null;
}

export interface CreateScanRowInput {
  sessionCode: string;
  sequence?: number;
  startTime?: string | null;
  endTime?: string | null;
  locationId?: number | null;
  staffId?: number | null;
  noteMr?: string | null;
}

export interface UpdateScanRowInput {
  startTime?: string | null;
  endTime?: string | null;
  locationId?: number | null;
  staffId?: number | null;
  noteMr?: string | null;
  sequence?: number;
}

export interface CreateSuddenChangeInput {
  seq?: number;
  originalStaffId?: number | null;
  replacementStaffId?: number | null;
  detailMr: string;
  noteMr?: string | null;
}

export interface CreateOfficerSummaryInput {
  rowNo?: number;
  officerText: string;
  dutyText?: string | null;
  source?: "SOURCE" | "SUGGESTION" | "OVERRIDE";
}

export interface SetShiftSummaryInput {
  summaryKey: "DAY" | "NIGHT" | "OTHER";
  columnKey: string;
  valueText: string;
}

export interface CreateEventInput {
  titleMr: string;
  eventDate?: string | null;
  startTime?: string | null;
  venueMr?: string | null;
  fallInMr?: string | null;
}

export interface CreateEventAssignmentInput {
  staffId?: number | null;
  roleMr?: string | null;
  sortOrder?: number;
}
