/**
 * Purpose: Stable normal-flow packing and list continuations for the C1 document.
 * Current role: Balance independent lanes without altering source rows or their facts.
 * Last meaningful change: 2026-10-18 — C1 display-only packing.
 * Constraint: No absolute positions, data mutation, dropped rows or operational inference.
 */
export function splitRegister<T>(rows: readonly T[], columns: number): T[][] {
  if (!rows.length) return [];
  const count = Math.min(rows.length, Math.max(1, Math.floor(columns) || 1));
  const size = Math.ceil(rows.length / count);
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size));
}

export function packFlowLanes<T>(items: readonly T[], columns: number, weight: (item: T) => number): T[][] {
  const count = Math.max(1, Math.floor(columns) || 1);
  const lanes: T[][] = Array.from({ length: count }, () => []);
  const heights = Array.from({ length: count }, () => 0);
  for (const item of items) {
    const lane = heights.indexOf(Math.min(...heights));
    lanes[lane].push(item);
    const estimate = weight(item);
    heights[lane] += Number.isFinite(estimate) ? Math.max(1, estimate) : 1;
  }
  return lanes;
}

/** Text length estimates layout only, never the meaning of Marathi prose. */
export function textLines(text: string | null | undefined, width = 44): number {
  return (text ?? "").split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / width)), 0);
}

/** Exact typed source-role labels only; never a person's name or narrative notes. */
export function writerBranchForRole(role: string | null | undefined, templateBranch: string): string {
  const keys: Record<string, string> = {
    "(तपास)": "तपास", "तपास": "तपास",
    "(गुन्हे)": "गुन्हे", "गुन्हे": "गुन्हे",
    "(प्रषा)": "प्रशासन", "प्रषा": "प्रशासन",
    "(प्रशासन)": "प्रशासन", "प्रशासन": "प्रशासन",
  };
  return Object.hasOwn(keys, role ?? "") ? keys[role ?? ""] : templateBranch;
}
