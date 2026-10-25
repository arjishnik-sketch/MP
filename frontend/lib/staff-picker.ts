/**
 * Purpose: Pure local filtering for explicit staff choices.
 * Current role: Explicit identity lookup and active name/buckle/rank filtering.
 * Last meaningful change: 2026-10-18 — preserve master fields across bigint JSON identity shapes.
 * Constraint: Preserve source order and records; never select, rank or mutate a person.
 */
type StaffChoice = { staff_id: number | string; name_mr: string; rank_code: string; buckle_no: string | null; active: boolean };

export function staffChoiceById<Row extends Pick<StaffChoice, "staff_id">>(staff: readonly Row[], staffId: unknown): Row | undefined {
  const id = typeof staffId === "number" ? staffId
    : typeof staffId === "string" && /^\d+$/.test(staffId) ? Number(staffId) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) return undefined;
  return staff.find((person) => Number(person.staff_id) === id);
}

function normalize(value: string): string {
  return value.normalize("NFC")
    .replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - "०".charCodeAt(0)))
    .toLocaleLowerCase().trim();
}

export function filterStaffChoices<Row extends StaffChoice>(staff: readonly Row[], query = "", rankCode = ""): Row[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return staff.filter((person) => {
    if (!person.active || (rankCode && person.rank_code !== rankCode)) return false;
    const searchable = normalize(`${person.name_mr} ${person.buckle_no ?? ""} ${person.rank_code}`);
    return terms.every((term) => searchable.includes(term));
  });
}
