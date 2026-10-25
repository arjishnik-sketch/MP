/**
 * Purpose: Lossless, frontend-only semantic grouping of the ChartDocument projection.
 * Current role: Assigns every source row one document home without choosing personnel.
 * Last meaningful change: 2026-10-18 — source-heading boundaries and explicit office/special partitions.
 * Constraint: Display grouping only; notes never determine operational meaning.
 */
import type { Assignment, ChartDocument, Location, LocationState, OfficerRow, Shift } from "./types";

export const shifts: Shift[] = ["DAY", "NIGHT"];

export const principalOfficers = [
  { name: "सुनिल पवार", firstName: "सुनिल", surname: "पवार", branch: "गुन्हे", writerTitle: "पोनि.गुन्हे॰रायटर" },
  { name: "नितीन आंधळे", firstName: "नितीन", surname: "आंधळे", branch: "प्रशासन", writerTitle: "पोनि.प्रशासन॰रायटर" },
  { name: "सुधीर पाटील", firstName: "सुधीर", surname: "पाटील", branch: "तपास", writerTitle: "पोनि.तपास॰रायटर" },
] as const;

export type PrincipalOfficer = (typeof principalOfficers)[number];

export interface DutyGroup {
  key: string;
  shift: Shift;
  columnNo: number;
  title: string;
  location: Location | null;
  rows: Assignment[];
  /** Alias of a row still in rows: render its heading once, retaining its source ID. */
  sourceHeading?: Assignment;
  /** The heading's verbatim display field; notes never classify duties or operational facts. */
  sourceHeadingField?: "dutyTitleMr" | "notesMr";
}

export interface LocationBlock {
  location: Location;
  groups: DutyGroup[];
  states: LocationState[];
  marshals: LocationBlock[];
  officer?: Assignment | null;
}

type DutyLane = "station" | "officeCore" | "specialDuties";
interface DutyPresentation {
  lane: DutyLane;
  subordinateLabels?: boolean;
  detachedHeadingAfterLocation?: string;
}

/**
 * Catalog identity, not title/notes heuristics. Source: seed-chart-1009.ts DAY1/3/4,
 * NIGHT1/2/3; SEMANTIC/10.md Tables 1–2 and 10.pdf pp1–2 confirm the nesting.
 * These are display boundaries, never personnel ownership or operational facts.
 */
const dutyPresentation = new Map<string, DutyPresentation>([
  ...[
    "DAY_STATION_LEADERSHIP", "DAY_PSO", "DAY_HAZARI", "DAY_CCTNS", "DAY_WIRELESS",
    "DAY_PETER", "DAY_CR", "DAY_DELTA", "DAY_DB", "DAY_LOCKUP",
    "NIGHT_CHECKING_OFFICER", "NIGHT_PSO", "NIGHT_HAZARI", "NIGHT_CCTNS", "NIGHT_WIRELESS",
    "NIGHT_PETER", "NIGHT_CR", "NIGHT_DB", "NIGHT_LOCKUP",
  ].map((code) => [code, { lane: "station" }] as const),
  ...[
    "OFFICE_WRITER", "OFFICE_CASHIER", "OFFICE_PROPERTY", "OFFICE_CONFIDENTIAL",
    "OFFICE_HAZARI_MASTER", "OFFICE_CRIME", "OFFICE_BARANISHI",
  ].map((code) => [code, { lane: "officeCore" }] as const),
  ...[
    "OFFICE_MISSING", "OFFICE_ATC", "OFFICE_WARRANT", "OFFICE_SESSION_SUMMONS", "OFFICE_SUMMONS",
    "DAY_WOMEN_DESK", "DAY_CYBER", "NIGHT_KALARAM", "NIGHT_GOOD_MORNING", "NIGHT_RAMKUND",
  ].map((code) => [code, { lane: "specialDuties" }] as const),
  ["DAY_PANCHAVATI1", { lane: "specialDuties", subordinateLabels: true }],
  ["NIGHT_PANCHAVATI1", { lane: "specialDuties", subordinateLabels: true }],
  // The source CCTNS heading is stored as a narrative row with the inherited guard duty.
  // Its structural break is a location-less head between the guard and the next staff run.
  ["DAY_KALARAM", { lane: "specialDuties", detachedHeadingAfterLocation: "FIXED_KALARAM" }],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function displayText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function devanagari(value: string | number): string {
  return String(value).replace(/[0-9]/g, (digit) => "०१२३४५६७८९"[Number(digit)]);
}

export function chartDateLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return devanagari(date);
  return new Intl.DateTimeFormat("mr-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(parsed);
}

export function shortTime(value: string | null): string {
  if (!value) return "";
  return devanagari(value.replace(/:00$/, ""));
}

export function windowLabel(start: string | null, end: string | null): string {
  return [shortTime(start), shortTime(end)].filter(Boolean).join(" ते ");
}

/** ALLOCATED + no person is source structure/prose, not an invented vacant seat. */
export function isPersonSlot(row: Assignment): boolean {
  return row.person !== null || row.allocationState === "VACANT_RIKT";
}

export function seniorAssignment(chart: ChartDocument): Assignment | null {
  return chart.assignments.find((row) => row.person?.rankCode === "SR_PI") ?? null;
}

export function principalAssignment(chart: ChartDocument, officer: PrincipalOfficer): Assignment | null {
  return chart.assignments.find((row) => row.person?.rankCode === "PI"
    && row.person.nameMr.includes(officer.firstName)
    && row.person.nameMr.includes(officer.surname)) ?? null;
}

export function principalSummary(chart: ChartDocument, officer: PrincipalOfficer): OfficerRow | undefined {
  return chart.officerSummary.find((row) => row.officerText.includes(officer.firstName) && row.officerText.includes(officer.surname));
}

/**
 * Walk shift/column source order. Typed duty changes are boundaries even without a
 * heading. Source-only writer labels introduce roles; mobile continuation labels stay
 * subordinate. Person rows may carry stale inherited titles, so never relabel by those.
 */
export function groupDutyRows(assignments: Assignment[]): DutyGroup[] {
  const result: DutyGroup[] = [];
  for (const shift of shifts) {
    const columns = [...new Set(assignments.filter((row) => row.shift === shift).map((row) => row.columnNo))].sort((a, b) => a - b);
    for (const columnNo of columns) {
      const rows = assignments.filter((row) => row.shift === shift && row.columnNo === columnNo)
        .map((row, index) => ({ row, index }))
        .sort((a, b) => a.row.sortOrder - b.row.sortOrder || a.row.assignmentId - b.row.assignmentId || a.index - b.index)
        .map(({ row }) => row);
      let current: DutyGroup | undefined;
      for (const [index, row] of rows.entries()) {
        const title = row.dutyTitleMr || row.roleMr || row.location?.nameMr || row.dutyCode || "कर्तव्य";
        const structural = !isPersonSlot(row);
        const metadata = dutyPresentation.get(row.dutyCode ?? "");
        const currentTitle = current?.sourceHeadingField === "notesMr"
          ? (current.sourceHeading?.dutyTitleMr ?? current.rows[0].dutyCode ?? "कर्तव्य") : current?.title;
        const dutyChanged = current && row.dutyCode !== current.rows[0].dutyCode;
        const locationChanged = row.location && row.location.locationId !== current?.location?.locationId;
        const labelledHeading = structural && (row.location !== null
          || (row.labelFromDuty !== true && !current?.location && !metadata?.subordinateLabels && title !== currentTitle));
        const next = rows[index + 1];
        const detachedHeading = structural && row.labelFromDuty === true && row.location === null
          && metadata?.detachedHeadingAfterLocation !== undefined
          && current?.location?.code === metadata.detachedHeadingAfterLocation
          && !dutyChanged && current.rows.some(isPersonSlot)
          && next?.dutyCode === row.dutyCode && isPersonSlot(next);
        const vacantNewRole = row.allocationState === "VACANT_RIKT" && title !== currentTitle;
        if (!current || dutyChanged || locationChanged || labelledHeading || detachedHeading || vacantNewRole) {
          current = {
            key: `${shift}-${columnNo}-${row.assignmentId}`, shift, columnNo,
            // Direct display only: no matching, parsing or operational inference from notes.
            title: detachedHeading ? (row.notesMr ?? "कर्तव्य") : title,
            location: row.location, rows: [],
            ...(structural && (row.dutyTitleMr !== null || detachedHeading) ? {
              sourceHeading: row,
              sourceHeadingField: detachedHeading ? "notesMr" as const : "dutyTitleMr" as const,
            } : {}),
          };
          result.push(current);
        }
        current.rows.push(row);
      }
    }
  }
  return result;
}

function locationBlocks(groups: DutyGroup[], states: LocationState[]): LocationBlock[] {
  const locations = new Map<number, Location>();
  for (const group of groups) if (group.location) locations.set(group.location.locationId, group.location);
  for (const state of states) if (!locations.has(state.location.locationId)) locations.set(state.location.locationId, state.location);
  return [...locations.values()].map((location) => ({
    location,
    groups: groups.filter((group) => group.location?.locationId === location.locationId),
    states: states.filter((state) => state.location.locationId === location.locationId),
    marshals: [],
  }));
}

export function buildDocumentLayout(chart: ChartDocument) {
  const senior = seniorAssignment(chart);
  const principals = principalOfficers.map((officer) => ({ ...officer, assignment: principalAssignment(chart, officer) }));
  const claimed = new Set<number>([senior?.assignmentId, ...principals.map((officer) => officer.assignment?.assignmentId)].filter((id): id is number => id !== undefined));
  const groups = groupDutyRows(chart.assignments.filter((row) => !claimed.has(row.assignmentId)));
  const writerGroups = new Map<string, DutyGroup[]>();
  const seniorSupport: DutyGroup[] = [];
  const usedGroups = new Set<string>();

  for (const group of groups) {
    const writerDuty = group.rows[0].dutyCode === "OFFICE_WRITER" && group.sourceHeadingField !== "notesMr";
    const principal = writerDuty ? principalOfficers.find((officer) => officer.writerTitle === group.title) : undefined;
    if (principal) {
      writerGroups.set(principal.branch, [...(writerGroups.get(principal.branch) ?? []), group]);
      usedGroups.add(group.key);
    } else if (group.columnNo === 0 || (writerDuty && group.title === "व.पो.नि.साो. रायटर")) {
      seniorSupport.push(group);
      usedGroups.add(group.key);
    }
  }

  const remaining = groups.filter((group) => !usedGroups.has(group.key));
  const byLocation = locationBlocks(remaining.filter((group) => group.location !== null), chart.locationStates);
  const chowkis = byLocation.filter((block) => block.location.kind === "CHOWKI");
  const marshals = byLocation.filter((block) => block.location.kind === "MARSHAL_POST");
  const pairing = isRecord(chart.template.layout.marshalPostForChowki) ? chart.template.layout.marshalPostForChowki : {};
  const folded = new Set<number>();
  for (const chowki of chowkis) {
    chowki.marshals = marshals.filter((block) => !folded.has(block.location.locationId)
      && block.location.code === pairing[chowki.location.code]);
    chowki.marshals.forEach((block) => folded.add(block.location.locationId));

    // Chowki officer: if present in source/header data, show consistently above day/night rows.
    // Do not manufacture a person where the source is blank (invariant: no AI/placeholder staff).
    const isOfficer = (r: Assignment) =>
      Boolean(r.person && (r.person.cadre === "OFFICER" || ["SR_PI", "PI", "API", "PSI", "PROB_PSI", "PROB_LPSI", "GRADE_PSI"].includes(r.person.rankCode ?? "") || r.unit?.unitCode === "CHOWKI_INCHARGE"))
      || (r.allocationState === "VACANT_RIKT" && Boolean(r.unit?.unitCode === "CHOWKI_INCHARGE" || r.roleMr?.includes("प्रभारी") || r.roleMr?.includes("इन्चार्ज")));

    let foundOfficer: Assignment | null = null;
    for (const group of chowki.groups) {
      const idx = group.rows.findIndex(isOfficer);
      if (idx !== -1) {
        foundOfficer = group.rows[idx];
        group.rows = group.rows.filter((r) => r.assignmentId !== foundOfficer!.assignmentId);
        break;
      }
    }
    chowki.officer = foundOfficer;
  }

  const localGroups = remaining.filter((group) => group.location === null);
  const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const courtCodes = new Set(strings(chart.template.layout.courtDutyCodes));
  const courtTitles = new Set(strings(chart.template.layout.courtDutyTitles));
  const lane = (group: DutyGroup): DutyLane => {
    const dutyCode = group.rows[0].dutyCode ?? "";
    if (courtCodes.has(dutyCode) || (group.sourceHeadingField !== "notesMr" && courtTitles.has(group.title))) return "specialDuties";
    const metadata = dutyPresentation.get(dutyCode);
    if (metadata) return metadata.lane;
    // Preserve unclassified source rows visibly using their source lane as the fallback.
    return group.columnNo === 1 ? "station" : group.columnNo === 4 ? "officeCore" : "specialDuties";
  };
  const station = localGroups.filter((group) => lane(group) === "station");
  // Compatibility alias: officeCore + specialDuties, in original source order.
  const office = localGroups.filter((group) => lane(group) !== "station");
  const officeCore = office.filter((group) => lane(group) === "officeCore");
  const specialDuties = office.filter((group) => lane(group) === "specialDuties");
  const specialLocations = byLocation.filter((block) => block.location.kind !== "CHOWKI"
    && !(block.location.kind === "MARSHAL_POST" && folded.has(block.location.locationId)));

  return { senior, principals, seniorSupport, writerGroups, station, office, officeCore, specialDuties, chowkis, specialLocations };
}
