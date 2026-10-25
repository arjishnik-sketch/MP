/**
 * Purpose: Pure, read-only projections for the approved D1 dashboard.
 * Current role: Validated date browsing, directory identities, attendance provenance and shift/post summaries.
 * Last meaningful change: 2026-10-18 — reuse chart source-heading groups for read-only posting summaries.
 * Constraint: Never choose personnel, interpret notes, or infer closure/marshal staffing from BIMA.
 */
import { groupDutyRows } from "./chart-document-layout";
import type { Assignment, ChartDocument, Location, LocationState, MastersResponse, Person, Shift, StaffMaster } from "./types";

/** Same calendar boundary as the API: four-digit years 0001–9999, with no rollover dates. */
export function isDashboardDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Invalid URL input never becomes an API path or a draft-creation target. */
export function dashboardDateFromSearch(search: string, today: string): string {
  if (!isDashboardDate(today)) throw new RangeError("A valid local calendar date is required.");
  const date = new URLSearchParams(search).get("date");
  return isDashboardDate(date) ? date : today;
}

/** An arbitrary past/future date is a GET-only view, even when no chart exists yet. */
export function dashboardDateMode(date: string, today: string): "bootstrap-today" | "read-only" {
  if (!isDashboardDate(date) || !isDashboardDate(today)) throw new RangeError("A valid calendar date is required.");
  return date === today ? "bootstrap-today" : "read-only";
}

/** Keep unrelated URL state intact. Null selects the rolling browser-local today. */
export function dashboardDateSearch(search: string, date: string | null): string {
  if (date !== null && !isDashboardDate(date)) throw new RangeError("A valid calendar date is required.");
  const params = new URLSearchParams(search);
  if (date === null) params.delete("date"); else params.set("date", date);
  const result = params.toString();
  return result ? `?${result}` : "";
}

export interface PostingSummary {
  locationCode: string;
  nameMr: string;
  assignments: Assignment[];
  people: Person[];
  officers: Person[];
  staffCount: number;
  bimaCount: number;
  vacantCount: number;
  state: LocationState | null;
}

export interface ChowkiShiftSummary {
  chowki: PostingSummary;
  marshal: PostingSummary | null;
}

export interface ChowkiSummary {
  location: Location;
  shifts: Record<Shift, ChowkiShiftSummary>;
}

/** These are owner-approved DIRECTORY labels, not dated chart duties or assignment rules. */
const directoryBranches = [
  { branch: "गुन्हे", nameMr: "सुनिल नारायण पवार" },
  { branch: "प्रशासन", nameMr: "नितीन आबाजी आंधळे" },
  { branch: "तपास / ठाणे अंमलदार कक्ष देखरेख", nameMr: "सुधीर महादेव पाटील" },
] as const;

export function stationOfficerDirectory(masters: MastersResponse) {
  const personOf = (member: StaffMaster): Person => {
    const rank = masters.ranks.find((item) => item.rank_code === member.rank_code);
    return {
      staffId: member.staff_id, nameMr: member.name_mr, rankCode: member.rank_code,
      rankShortFormMr: rank?.short_form_mr, rankNameMr: rank?.name_mr,
      cadre: rank?.cadre, buckleNo: member.buckle_no,
    };
  };
  const uniquePerson = (predicate: (member: StaffMaster) => boolean) => {
    const matches = masters.staff.filter((member) => member.active && predicate(member));
    return matches.length === 1 ? personOf(matches[0]) : null;
  };
  return {
    senior: uniquePerson((member) => member.rank_code === "SR_PI"),
    branches: directoryBranches.map((entry) => ({
      branch: entry.branch,
      person: uniquePerson((member) => member.rank_code === "PI"
        && member.name_mr.normalize("NFC").trim() === entry.nameMr.normalize("NFC")),
    })),
  };
}

/** Match only the explicit template relation. Sardar has no marshal unless one is configured. */
function pairedMarshalCode(document: ChartDocument | null, chowkiCode: string): string | null {
  const pairs = document?.template.layout.marshalPostForChowki;
  if (!pairs || typeof pairs !== "object" || Array.isArray(pairs)) return null;
  const code = (pairs as Record<string, unknown>)[chowkiCode];
  return typeof code === "string" && code.trim() ? code : null;
}

export function buildChowkiBoard(masters: MastersResponse, chart: ChartDocument | null, date: string): ChowkiSummary[] {
  // A directory is reusable; a different date's assignments, states and template are not selected-day facts.
  const document = chart?.chartDate === date ? chart : null;
  // The typed heading owns display location for its continuation rows, as on the chart.
  // Keep original rows intact: grouping is not an operational location assignment.
  const dutyGroups = groupDutyRows(document?.assignments ?? []);
  const cadres = new Map(masters.ranks.map((rank) => [rank.rank_code, rank.cadre]));
  const chowkiLocations = new Map<string, { location: Location; order: number }>();
  for (const master of masters.locations.filter((location) => location.active && location.kind === "CHOWKI")) {
    chowkiLocations.set(master.location_code, {
      location: { locationId: master.location_id, code: master.location_code, nameMr: master.name_mr, kind: master.kind },
      order: master.display_order,
    });
  }
  const recordedLocations = new Map<string, Location>();
  for (const location of [
    ...(document?.assignments ?? []).map((row) => row.location),
    ...(document?.locationStates ?? []).map((row) => row.location),
  ]) {
    if (location?.kind === "CHOWKI" && !recordedLocations.has(location.code)) recordedLocations.set(location.code, location);
  }
  // Historical names/staffing do not disappear when the current directory renames/deactivates a chowki.
  for (const location of recordedLocations.values()) {
    chowkiLocations.set(location.code, {
      location,
      order: masters.locations.find((master) => master.location_code === location.code)?.display_order ?? Number.MAX_SAFE_INTEGER,
    });
  }
  const posting = (locationCode: string, nameMr: string, shift: Shift): PostingSummary => {
    const groups = dutyGroups.filter((group) => group.shift === shift && group.location?.code === locationCode);
    const assignments = groups.flatMap((group) => group.rows);
    const people = new Map<number, Person>();
    const bima = new Set<number>();
    for (const row of assignments) {
      if (row.person && row.allocationState === "ALLOCATED") {
        people.set(row.person.staffId, row.person);
        if (row.isBima) bima.add(row.person.staffId);
      }
    }
    const state = document?.locationStates.find((row) => row.shift === shift && row.location.code === locationCode) ?? null;
    return {
      locationCode,
      nameMr: groups[0]?.location?.nameMr ?? state?.location.nameMr ?? nameMr,
      assignments,
      people: [...people.values()],
      // Typed cadre only; a constable called प्रभारी does not become an officer.
      officers: [...people.values()].filter((person) => (person.cadre ?? cadres.get(person.rankCode)) === "OFFICER"),
      staffCount: people.size,
      bimaCount: bima.size,
      vacantCount: assignments.filter((row) => row.allocationState === "VACANT_RIKT").length,
      state,
    };
  };

  return [...chowkiLocations.values()]
    .sort((a, b) => a.order - b.order || a.location.locationId - b.location.locationId)
    .map(({ location }) => {
      const marshalCode = pairedMarshalCode(document, location.code);
      const marshalName = masters.locations.find((item) => item.location_code === marshalCode)?.name_mr ?? "मार्शल";
      const shifts = (shift: Shift): ChowkiShiftSummary => ({
        chowki: posting(location.code, location.nameMr, shift),
        marshal: marshalCode ? posting(marshalCode, marshalName, shift) : null,
      });
      return {
        location,
        shifts: { DAY: shifts("DAY"), NIGHT: shifts("NIGHT") },
      };
    });
}

// A structural slice of the attendance response keeps this projection independent of API clients.
interface AttendanceInput {
  date: string;
  rows: readonly {
    person: Pick<Person, "staffId">;
    status: "PRESENT" | "ABSENT" | "WEEKLY_OFF" | "UNRECORDED";
    source: "MANUAL" | "AVAILABILITY" | "WEEKLY_OFF" | "DEFAULT" | "UNRECORDED";
  }[];
}

export function summarizeDashboardAttendance(
  staff: readonly Pick<StaffMaster, "staff_id" | "active">[],
  attendance: AttendanceInput | null,
  date: string,
) {
  const summary = {
    registered: new Set(staff.filter((member) => member.active).map((member) => member.staff_id)).size,
    recordedPresent: 0,
    defaultPresent: 0,
    weeklyOff: 0,
    recordedWeeklyOff: 0,
    profileWeeklyOff: 0,
    recordedAbsent: 0,
    unrecorded: 0,
  };
  const rows = attendance?.date === date ? attendance.rows : [];
  for (const row of new Map(rows.map((item) => [item.person.staffId, item])).values()) {
    const recorded = row.source === "MANUAL" || row.source === "AVAILABILITY";
    if (row.status === "PRESENT" && recorded) summary.recordedPresent++;
    else if (row.status === "PRESENT" && row.source === "DEFAULT") summary.defaultPresent++;
    else if (row.status === "ABSENT" && recorded) summary.recordedAbsent++;
    else if (row.status === "WEEKLY_OFF" && recorded) {
      summary.weeklyOff++;
      summary.recordedWeeklyOff++;
    } else if (row.status === "WEEKLY_OFF" && row.source === "WEEKLY_OFF") {
      summary.weeklyOff++;
      summary.profileWeeklyOff++;
    } else summary.unrecorded++;
  }
  return summary;
}
