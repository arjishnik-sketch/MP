// Purpose: ChartDocument → HTML (screen + print projection of the SAME document —
//   PRODUCT_UI_ARCHITECTURE §12). Visual grammar = frozen design/compv3.css + the
//   compact-v3 mock's class vocabulary; data = the document only (never re-derived).
// Current role: P1 renderer v1 — full data coverage, 5-page skeleton; visual polish
//   iterates on user screenshots (user owns the visual pass).
// Last meaningful change: 2026-10-13 — stable presentation hooks and resolved controls.
// Constraint/dependency: AGENTS.md hard rules — no notes parsing (notes only echoed
//   as text), protected tokens (Dial 112, CCTNS, MERS…) never digit-transformed,
//   Marathi wraps never truncates (CSS handles), derived weekday computed once here.
import type {
  ChartDocument, DocAssignment, DocPerson, DocLocationState, MatrixColumn,
} from "../chart-document.js";
import { resolvePresentation, type PresentationElement } from "../chart-presentation.js";

// ---- display helpers -------------------------------------------------------------
const DEV_DIGITS = "०१२३४५६७८९";
/** Devanagari digit display transform (T7) — display ONLY, never touches the store.
 *  Protected tokens (Dial 112, etc.) are never digit-transformed per AGENTS.md. */
export function toMr(s: string): string {
  const protectedTokens = ["Dial 112"];
  let res = s;
  const stash: string[] = [];
  for (const token of protectedTokens) {
    if (res.includes(token)) {
      const key = `__PROT_${String.fromCharCode(65 + stash.length)}__`;
      res = res.replaceAll(token, key);
      stash.push(token);
    }
  }
  res = res.replace(/[0-9]/g, (d) => DEV_DIGITS[Number(d)]);
  stash.forEach((token, idx) => {
    const key = `__PROT_${String.fromCharCode(65 + idx)}__`;
    res = res.replaceAll(key, token);
  });
  return res;
}
const h = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const MONTHS_MR = ["जानेवारी", "फेब्रुवारी", "मार्च", "एप्रिल", "मे", "जून",
  "जुलै", "ऑगस्ट", "सप्टेंबर", "ऑक्टोबर", "नोव्हेंबर", "डिसेंबर"];

/** Display text: escaped + Devanagari digits. For source fields that may contain
 *  protected tokens (notices/narratives like "Dial 112 MERS") use raw() instead. */
const disp = (s: string | null | undefined): string => (s == null || s === "" ? "" : toMr(h(s)));
const raw = (s: string | null | undefined): string => (s == null ? "" : h(s));

function personLine(p: DocPerson): string {
  const short = p.rankShortFormMr ?? p.rankCode;
  // Accessible abbreviation tooltip: visible short form, full form on hover AND keyboard
  // focus (aria-label announces it). Preview-only — CSS kills it in print.
  const rank = p.rankNameMr && p.rankNameMr !== short
    ? `<abbr class="abbr" data-full="${h(p.rankNameMr)}" aria-label="${h(p.rankNameMr)}" tabindex="0">${h(short)}</abbr>`
    : h(short);
  const buckle = p.buckleNo ? ` ${toMr(p.buckleNo)}` : "";
  return `${rank}${buckle} ${h(chartName(p))}`;
}
/** Compact chart name form — a DISPLAY transform only; the staff master keeps the full
 *  name (Staff_Info docx). Matches source chart cells (SEMANTIC/10.md): buckled ranks →
 *  rank+buckle+surname (पोशि 542 आहेर), name-keyed OFFICER cadre → rank+given+surname
 *  (पोनि सुनिल पवार), name-keyed non-officer (ASI/LASI, no buckle) → rank+surname
 *  (सपोउनि शेवाळे). Never touches the store; golden tests pin sample cells. */
function chartName(p: DocPerson): string {
  const toks = p.nameMr.trim().split(/\s+/).filter(Boolean);
  if (toks.length === 0) return p.nameMr;
  if (p.buckleNo != null) return toks[toks.length - 1];
  if (p.cadre != null && p.cadre !== "OFFICER") return toks[toks.length - 1];
  return toks.length <= 2 ? toks.join(" ") : `${toks[0]} ${toks[toks.length - 1]}`;
}
/** Plain-TEXT person line (no markup) — for VALUES that are stored/echoed as text (a sign-off
 *  line the clerk may edit and re-save), where an <abbr> element cannot travel. */
function personText(p: DocPerson): string {
  const short = p.rankShortFormMr ?? p.rankCode;
  return `${short}${p.buckleNo ? ` ${toMr(p.buckleNo)}` : ""} ${chartName(p)}`;
}
function timeRange(start: string | null, end: string | null): string {
  if (!start || !end) return "";
  const sh = start.slice(0, 2), eh = end.slice(0, 2);
  const sm = start.slice(3, 5), em = end.slice(3, 5);
  return sm === "00" && em === "00" ? `${toMr(sh)}–${toMr(eh)}` : `${toMr(start.slice(0, 5))}–${toMr(end.slice(0, 5))}`;
}
function hhmm(t: string | null): string { return t ? t.slice(0, 5) : ""; }
/** The source wraps a branch qualifier in parentheses in its role column ((तपास)); the display
 *  label is the same token bare. Formatting only — the value is never interpreted. */
const bareToken = (s: string | null | undefined): string =>
  (s ?? "").replace(/^\s*[([]\s*/, "").replace(/\s*[)\]]\s*$/, "").trim();
/** dd/mm/yyyy for the header's date control — Devanagari digits are a display transform only
 *  (the stored/injected value stays YYYY-MM-DD everywhere). */
const dateSlash = (date: string): string => {
  const [y, m, d] = date.split("-");
  return `${toMr(d)}/${toMr(m)}/${toMr(y)}`;
};

/** Latin twin of dateSlash — chrome only (the chart itself always prints Marathi/Devanagari). */
const dateLatin = (date: string): string => {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
};

/** English weekday for the toolbar — display transform of the same date, never stored. */
const weekdayEn = (date: string): string => {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[new Date(`${date}T00:00:00Z`).getUTCDay()];
};

/** Date ± n days (YYYY-MM-DD, UTC-safe) — toolbar date navigation, derived never hardcoded. */
function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// ---- row classification (structure only — notes never parsed, only echoed) -------
const isLabel = (r: DocAssignment): boolean => r.person === null && r.notesMr === null;
/** Duty that carries the station's officer band (Sr-PI + branch officers) in the day column —
 *  those rows render as the Sr-PI card and the officer boxes, never twice in the desks. */
const STATION_LEADERSHIP_DUTY = "DAY_STATION_LEADERSHIP";
const isVacant = (r: DocAssignment): boolean => r.allocationState === "VACANT_RIKT";
/** Assignment column reserved for the Sr-PI card's support seats (रायटर / चालक / RTPC).
 *  A dedicated column keeps them out of every duty-desk walk: they belong to the card, not to a
 *  desk. The source chart carries only रायटर, so the rest are seats the clerk fills (they render
 *  as ordinary empty cells and are created on demand — never invented data; user 2026-10-13:
 *  “only keep writer, chalak (both day and night), and rtpc (both day and night), drop operator”). */
const SRPI_SUPPORT_COL = 9;
export const SRPI_SUPPORT_ROLES = ["रायटर", "चालक", "RTPC"] as const;

export interface RenderStats {
  rowsTotal: number;
  rowsRendered: number;   // must equal rowsTotal — the no-loss accounting
}

interface Group { label: DocAssignment | null; rows: DocAssignment[]; }

// ---- per-chart editable names (C-values) -----------------------------------------
// The clerk may rename TABLE / SECTION / COLUMN / LEFT-ROW names for THIS chart only.
// Storage: daily_charts.presentation_overrides → projected into doc.template.overrides
// (so a FINALIZE snapshot carries its names). Two maps:
//   labels    { elementKey: newText }        — "only this element" scope
//   labelsAll { defaultText: newText }       — "everywhere with this default name" scope
// `a()` marks the element so the authoring UI can address it (key + SOURCE text, never the
// overridden text — scope-"all" must match on the default). Masters/DB rows are untouched:
// this is display naming only, never a rename of data, duties or people.
export interface Names {
  /** resolved display text: element override → text-keyed override → default */
  t(key: string, def: string): string;
  /** `data-label` + `data-default` attributes (empty string when the element has no name) */
  a(key: string, def: string): string;
  /** Presentation hook and resolved safe values for the server-rendered element. */
  p(key: string, label: string, kind?: PresentationElement["kind"], empty?: boolean): string;
  /** Presentation hook plus the existing editable-name attributes. */
  e(key: string, def: string, kind?: PresentationElement["kind"], empty?: boolean): string;
  /** Resolved TEXT VALUE (not a name): a chart-local typed value wins over the computed one.
   *  Values are author-entered strings (sign-off names, notes cells) — never source semantics. */
  v(key: string, def: string): string;
  /** Markup for an editable value: the resolved text + the key + the computed default. */
  vt(key: string, def: string, cls: string): string;
}
const NO_NAMES: Names = {
  t: (_key, def) => def, a: () => "", p: () => "", e: () => "",
  v: (_key, def) => def, vt: (_key, def, cls) => `<span class="${cls}">${def}</span>`,
};
function makeNames(doc: ChartDocument, elements?: Map<string, PresentationElement>): Names {
  const ov = (doc.template.overrides ?? {}) as {
    labels?: Record<string, string>;
    labelsAll?: Record<string, string>;
    values?: Record<string, string>;
  };
  const byKey = ov.labels ?? {};
  const byText = ov.labelsAll ?? {};
  const byVal = ov.values ?? {};
  const a = (key: string, def: string): string => {
    if (key === "" || def === "") return "";
    const ovr = byKey[key] !== undefined ? "element" : byText[def] !== undefined ? "all" : "";
    return ` data-label="${h(key)}" data-default="${h(def)}"${ovr ? ` data-override="${ovr}"` : ""}`;
  };
  const p = (key: string, label: string, kind: PresentationElement["kind"] = "label", empty = false): string => {
    const resolved = resolvePresentation(doc, key);
    elements?.set(key, { key, label, kind, ...(empty ? { empty: true } : {}) });
    const attrs = [` data-presentation="${h(key)}"`, ` data-presentation-kind="${kind}"`];
    if (resolved.horizontalAlign) attrs.push(` data-horizontal-align="${resolved.horizontalAlign}"`);
    if (resolved.verticalAlign) attrs.push(` data-vertical-align="${resolved.verticalAlign}"`);
    if (resolved.hidden !== undefined) attrs.push(` data-presentation-hidden="${String(resolved.hidden)}"`);
    if (resolved.compact !== undefined) attrs.push(` data-compact="${String(resolved.compact)}"`);
    return attrs.join("");
  };
  return {
    t: (key, def) => byKey[key] ?? byText[def] ?? def,
    // data-override marks WHICH scope is currently renaming this element, so the popover can
    // pre-select the matching radio (blank + right scope = a real revert, not a no-op).
    a,
    p,
    // `empty` marks an element that currently carries NO data (a seat nobody filled, a रिक्त
    // row). It is what lets the clerk hide that element to compact the sheet without losing a
    // real value — so the flag has to be passed explicitly by every caller that knows.
    e: (key, def, kind = "label", empty = false) =>
      def === "" ? "" : `${a(key, def)}${p(key, def, kind, empty)}`,
    // A VALUE is editable text the clerk owns (sign-off names, added cells) — the server prints
    // the resolved text and the client may re-address it, exactly like an editable name.
    v: (key, def) => (byVal[key] !== undefined ? byVal[key] : def),
    vt: (key, def, cls) => `<span class="${cls} val" data-value-key="${h(key)}"`
      + (def !== "" ? ` data-default="${h(def)}"` : "")
      + `>${h(byVal[key] !== undefined ? byVal[key] : def)}</span>`,
  };
}

/** Assignment rows → grouped label/value table rows (rowspan labels, बिमा runs).
 *  opts.hideLocationLabels: inside location blocks the block heading already carries the
 *  location name, so its label row renders as the (empty) group anchor — counted once,
 *  never duplicated as text (approved mock never repeats the chowki name inside sub-cols).
 *  opts.absorbLabels: the block's बंद/charge .fx line already carries these source label
 *  rows (typed location state = the canonical rendering of the same cell) — counted, not
 *  re-emitted, so no stray standalone rows and no double text (no-loss accounting intact). */
function renderGroups(
  rows: DocAssignment[], count: (n: number) => void,
  opts?: {
    hideLocationLabels?: boolean;
    absorbLabels?: boolean;
    /** A heading with no value rows left prints nothing: in the office register every heading
     *  introduces a run of rows, and a run that moved into an officer box / the Sr-PI card
     *  (or never had rows in the source) leaves an orphan heading the clerk asked us to drop
     *  (user 2026-10-13: “कार्यालयीन अंमलदार / व.पो.नि.साो. रायटर — why are these two empty”).
     *  Display only; the row is still counted for the no-loss ledger. */
    dropEmptyHeadings?: boolean;
    /** Persons whose post group is a DUPLICATE of the officer band above: when every value row
     *  of the group is such a person (and the row carries no location of its own — a chowki/desk
     *  duty is real information and always prints), the group is not repeated here. The officer
     *  box already owns that person's row (“one row, one home”). Rows still counted. */
    dropPersons?: Set<number>;
  },
  n: Names = NO_NAMES,
): string {
  const groups: Group[] = [];
  for (const r of rows) {
    if (isLabel(r)) groups.push({ label: r, rows: [] });
    else (groups.length ? groups[groups.length - 1] : (groups.push({ label: null, rows: [] }), groups[groups.length - 1])).rows.push(r);
  }
  let html = "";
  for (const g of groups) {
    // Location-label groups: text is redundant with the block heading (except a रिक्त seat,
    // whose duty label is the seat's own line and must stay visible).
    const hideLabel = Boolean(opts?.hideLocationLabels && g.label?.location != null && !isVacant(g.label));
    // Group heading = a named element (keyed by its source label row — stable per chart).
    const titleDef = g.label && !hideLabel ? (g.label.dutyTitleMr ?? "") : "";
    const titleKey = g.label ? `grp.${g.label.assignmentId}` : "";
    const title = titleDef === "" ? "" : disp(n.t(titleKey, titleDef));
    const titleAttr = n.e(titleKey, titleDef, "label");
    // Duplicate post group (a person already printed in the officer band of this sheet).
    if (opts?.dropPersons && g.rows.length > 0 && g.rows.every((r) =>
      r.location === null && r.person !== null && opts.dropPersons!.has(r.person.staffId))) {
      if (g.label) count(1);
      count(g.rows.length);
      continue;
    }
    if (g.label) count(1);  // no-loss accounting: the label row materialises as block heading/group anchor
    if (g.rows.length === 0) {
      if (hideLabel) continue; // represented by the block heading
      // A heading with nothing under it prints nothing (counted above) — but a VACANT_SEAT row is
      // not a heading: it is a real रिक्त seat the clerk can fill, so it always renders.
      if (opts?.dropEmptyHeadings && !(g.label != null && isVacant(g.label))) continue;
      const vacant = g.label != null && isVacant(g.label);
      if (opts?.absorbLabels && !vacant) continue; // counted above; the .fx line carries it
      if (!vacant && g.label) {
        // source heading cell (e.g. "(चेकिंग-1 )") — full-width heading row,
        // never an orphan label + empty cell
        html += `<tr class="g"><th class="role" colspan="2"${titleAttr}>${title}</th></tr>\n`;
        continue;
      }
      const cell = vacant
        ? `<span class="chip c-vac">रिक्त</span>`
        : `<span class="blank"></span>`;
      html += `<tr class="g"><th class="role"${titleAttr}>${title}</th><td${g.label ? slotAttrs(g.label) : ""}>${cell}</td></tr>\n`;
      continue;
    }
    // Segment into runs sharing the label the source prints in the row's LEFT cell: the group's
    // duty title for the first run of a desk table, otherwise the row's own ROLE column
    // (रायटर / ऑपरेटर …), and बिमा for beat-marshal rows (explicit flag — never derived from text).
    // Role/बिमा runs are named "left row" elements too — keyed by the run's first row so a
    // rename targets this label cell. The RAW source text is kept for the lookup (disp only
    // at emit time), so a scope-"all" rename matches on the default, never on an override.
    const rowLabel = (r: DocAssignment) =>
      r.person !== null && r.isBima ? { def: "बिमा", cls: "bima-lb" }
        : r.roleMr ? { def: r.roleMr, cls: "role" }
          : { def: "", cls: "role" };
    type Run = { def: string; cls: string; rows: DocAssignment[] };
    const runs: Run[] = [];
    for (const r of g.rows) {
      const lab = rowLabel(r);
      const last = runs[runs.length - 1];
      if (!last || last.def !== lab.def || last.cls !== lab.cls) runs.push({ ...lab, rows: [] });
      runs[runs.length - 1].rows.push(r);
      count(1);
    }
    runs.forEach((run, ri) => {
      const useTitle = ri === 0 && title !== "";
      const key = useTitle ? titleKey : `role.${run.rows[0].assignmentId}`;
      const def = useTitle ? titleDef : run.def;
      const text = useTitle ? title : def === "" ? "" : disp(n.t(key, def));
      const cls = useTitle ? "role" : run.cls;
      // The label cell is always emitted — an empty one keeps the role column aligned between
      // labelled runs (रायटर / बिमा) and the rows the source leaves without a role. Named cells
      // carry data-label/data-default; an unnamed (empty) cell gets no attributes at all.
      const th = `<th class="${cls}" rowspan="${run.rows.length}"${n.e(key, def, "label")}>${text}</th>`;
      run.rows.forEach((r, yi) => {
        const trCls = yi === 0 ? ` class="g"` : "";
        html += `<tr${trCls}>${yi === 0 ? th : ""}<td${slotAttrs(r)}>${valueHtml(r)}</td></tr>\n`;
      });
    });
  }
  return html;
}

/** Editable-slot marker: a value cell that carries an assignment (person or रिक्त seat).
 *  Narrative text rows (source instructions) are NOT staff slots — they are never clickable. */
const slotAttrs = (r: DocAssignment): string => {
  const isSlot = r.person !== null || (r.allocationState === "VACANT_RIKT" && r.notesMr === null);
  if (!isSlot) return "";
  const staff = r.person ? ` data-staff="${r.person.staffId}"` : "";
  const bima = r.isBima ? ` data-bima="1"` : "";
  return ` class="slot" data-asn="${r.assignmentId}" data-shift="${r.shift}"${staff}${bima}`;
};

function valueHtml(r: DocAssignment): string {
  if (r.person) {
    let s = personLine(r.person);
    const tr = timeRange(r.startTime, r.endTime);
    if (tr) s += ` <span class="win duty-time">${tr}</span>`;
    if (r.notesMr) s += ` <span class="win">${raw(r.notesMr)}</span>`;
    return s;
  }
  // narrative row — source text echoed verbatim (protected tokens intact)
  return `<span class="nil">${raw(r.notesMr)}</span>`;
}

// ---- column walk → blocks (page 2 grammar) ---------------------------------------
interface Block {
  key: string;
  name: string;
  kind: string;                 // location kind or 'DUTY'
  locationId: number | null;
  locationCode: string | null;
  marshalLocationId: number | null;  // paired marshal post folded into this chowki (T15)
  day: DocAssignment[];
  night: DocAssignment[];
  incharge: DocPerson | null;
}

interface SpecialPost { title: string; shift: "DAY" | "NIGHT"; head: DocAssignment; rows: DocAssignment[]; }

function walkBlocks(
  doc: ChartDocument, cols: number[],
): { blocks: Block[]; loose: DocAssignment[]; specials: SpecialPost[] } {
  const blocks: Block[] = [];
  const byKey = new Map<string, Block>();
  const loose: DocAssignment[] = [];
  const specials: SpecialPost[] = [];
  let curSp: SpecialPost | null = null;
  // Layer C display config: posts that belong to the page-1 special desk instead of page 2.
  // Location-less posts already fold (मोबाईल / सायबर सेल / महिला कक्ष); a fixed point such as
  // काळाराम मंदीर गार्ड carries a location but is still a desk post, not a chowki/marshal block.
  const specialKinds = new Set(
    (doc.template.layout.specialDeskLocationKinds as string[] | undefined) ?? [],
  );
  const isDeskPostHead = (r: DocAssignment): boolean =>
    isLabel(r) && r.dutyCode != null && r.labelFromDuty === true &&
    (r.location == null || specialKinds.has(r.location.kind));
  for (const shift of ["DAY", "NIGHT"] as const) {
    for (const col of cols) {
      let cur: Block | null = null;
      for (const r of doc.assignments.filter((a) => a.shift === shift && a.columnNo === col)) {
        // SPECIAL POST (no location — मोबाईल / सायबर सेल / काळाराम गार्ड / महिला कक्ष …): the mock
        // never shows these as page-2 blocks; they render as role groups inside page 1's
        // कोर्ट, समन्स, वॉरंट व विशेष कक्ष desk. Same title in both shifts stays ONE group with
        // the source's own दिवसपाळी/रात्रपाळी wording (SEMANTIC officer-summary style).
        if (isDeskPostHead(r)) {
          cur = null;
          curSp = { title: r.dutyTitleMr ?? r.dutyCode!, shift, head: r, rows: [] };
          specials.push(curSp);
          continue;
        }
        // A block starts only at a POST HEAD: a labelled row that carries a location, or whose
        // label text comes from the duty definition. Continuation labels (बंद, चौकी चा चार्ज…,
        // एम.टी.सेक्षन…) inherit the running duty context in the seed exactly as the source cell
        // did — treating them as heads produced one-line stray blocks.
        if (isLabel(r) && (r.location != null || (r.dutyCode != null && r.labelFromDuty === true))) {
          curSp = null;
          // Location posts key by location (day+night of one chowki = one block); location-less
          // posts key by their source title so a DAY and a NIGHT mobile post merge into one block
          // instead of rendering twice.
          const postName = r.location ? r.location.nameMr : (r.dutyTitleMr ?? r.dutyCode ?? "");
          const key = r.location ? `L${r.location.locationId}` : `T${postName}`;
          let b = byKey.get(key);
          if (!b) {
            b = {
              key,
              name: postName,
              kind: r.location ? r.location.kind : "DUTY",
              locationId: r.location ? r.location.locationId : null,
              locationCode: r.location ? r.location.code : null,
              marshalLocationId: null,
              day: [], night: [], incharge: null,
            };
            byKey.set(key, b); blocks.push(b);
          }
          cur = b;
          (shift === "DAY" ? b.day : b.night).push(r);  // header row rendered as block name
          if (!b.incharge && r.person) b.incharge = r.person;
          continue;
        }
        if (curSp) {
          curSp.rows.push(r);
          continue;
        }
        if (cur) {
          (shift === "DAY" ? cur.day : cur.night).push(r);
          if (r.person && !cur.incharge) cur.incharge = r.person;
        } else {
          loose.push(r);
        }
      }
    }
  }
  return { blocks: foldMarshalPosts(blocks, doc), loose, specials };
}

// Special posts → desk rows: one group per TITLE (day crew first, then night crew). When a
// title is staffed in both shifts the two groups keep the source's own shift wording so the
// crews never blur together; single-shift titles print unqualified. Only the label rows are
// cloned (display transform — assignment ids and every data row pass through untouched).
function specialDeskRows(specials: SpecialPost[]): DocAssignment[] {
  const order: string[] = [];
  const byTitle = new Map<string, SpecialPost[]>();
  for (const sp of specials) {
    if (!byTitle.has(sp.title)) { byTitle.set(sp.title, []); order.push(sp.title); }
    byTitle.get(sp.title)!.push(sp);
  }
  const shiftMr = (s: "DAY" | "NIGHT") => (s === "DAY" ? "दिवसपाळी" : "रात्रपाळी");
  const out: DocAssignment[] = [];
  for (const title of order) {
    const posts = byTitle.get(title)!;
    // dual only when the SAME title is staffed in both shifts (two day posts of one title must
    // not be mistaken for a day/night pair)
    const dual = new Set(posts.map((p) => p.shift)).size > 1;
    for (const sp of posts) {
      out.push(dual ? { ...sp.head, dutyTitleMr: `${title} - ${shiftMr(sp.shift)}` } : sp.head);
      out.push(...sp.rows);
    }
  }
  return out;
}

// ---- marshal-post folding (approved T15 — the mock's chowki band) -----------------
// The approved mock never shows a beat-marshal post as its own block: each marshal post prints
// inside its paired chowki as (a) a `मार्शल:` .fx line carrying that marshal post's OWN typed
// बंद/charge state (three-fact distinction kept — the state stays a location fact, only its
// render position moves) and (b) its staff rows merged into the same sub-col. The pairing is
// station-stable DISPLAY config (template layout.marshalPostForChowki, chowki code → marshal
// code; Layer C). Chart data is untouched — every row still renders and is counted, so the
// no-loss guard is unaffected. A marshal post with no configured pair keeps its own block.
function foldMarshalPosts(blocks: Block[], doc: ChartDocument): Block[] {
  const pairing = (doc.template.layout.marshalPostForChowki as Record<string, string> | undefined) ?? {};
  if (Object.keys(pairing).length === 0) return blocks;
  const chowkiOf = new Map(Object.entries(pairing).map(([chowki, marshal]) => [marshal, chowki]));
  const byCode = new Map(
    blocks.filter((b) => b.locationCode != null).map((b) => [b.locationCode as string, b]));
  const out: Block[] = [];
  for (const b of blocks) {
    const chowkiCode = b.kind === "MARSHAL_POST" && b.locationCode != null
      ? chowkiOf.get(b.locationCode) : undefined;
    const host = chowkiCode != null ? byCode.get(chowkiCode) : undefined;
    if (!host) { out.push(b); continue; }
    host.day.push(...b.day);
    host.night.push(...b.night);
    host.marshalLocationId = b.locationId;
  }
  return out;
}

// ---- state fx (चार्ज/बंद lines from explicit location states) ---------------------
function stateFx(states: DocLocationState[], locationId: number | null, shift: "DAY" | "NIGHT", marshal: boolean): string {
  if (locationId == null) return "";
  const s = states.find((x) => x.location.locationId === locationId && x.shift === shift);
  if (!s) return "";
  const cls = marshal ? "fx mrsh" : "fx";
  const lb = marshal ? `<span class="lb">मार्शल:</span> ` : "";
  // The state words stay on one line (`.st` is nowrap) and only the destination phrase wraps,
  // so the line can never break mid-phrase and never sit as an orphan word (authoring.css).
  const words: string[] = [];
  if (s.isClosed) words.push(`<span class="sl">बंद</span>`);
  if (s.chargeTo) words.push(`चार्ज →`);
  if (words.length === 0) return "";
  const dst = s.chargeTo ? ` <span class="dst">${disp(s.chargeTo.nameMr)}</span>` : "";
  // state words are separated by a plain comma, never a decorative middle dot (user correction)
  return `<div class="${cls}">${lb}<span class="st">${words.join(", ")}</span>${dst}</div>`;
}

// ---- page sections ---------------------------------------------------------------
function headHtml(doc: ChartDocument, n: Names): string {
  const [y, m, d] = doc.chartDate.split("-");
  // Date and weekday remain derived, but the printed identity is intentionally one compact line.
  const dateLine = `${toMr(d)} ${MONTHS_MR[Number(m) - 1]} ${toMr(y)}, ${h(doc.weekdayMr)}`;
  const lc = doc.lifecycle.toLowerCase();
  const t1 = "नाशिक शहर पोलीस आयुक्तालय", t2 = "दैनिक कर्तव्य वाटप";
  return `<div class="head">
    <div class="hc">
      <div class="h1"${n.e("head.h1", t1)}>${disp(n.t("head.h1", t1))}</div>
      <div class="h2"${n.e("head.h2", t2)}>${disp(n.t("head.h2", t2))}</div>
      <div class="h3">${dateLine}</div>
    </div>
    <div class="hr"><span class="lc lc-${lc}">${doc.lifecycle}</span></div>
  </div>`;
}

// One printed A4 sheet. `dense` marks the two composite pages whose real source content
// cannot fit the mock's screen type scale on one sheet; the print-only density rules live in
// web/authoring.css (.page.dense) and never drop, truncate or reorder a row.
function page(title: string, doc: ChartDocument, body: string, opts: { dense?: boolean; kind?: string } | undefined, n: Names): string {
  return `<div class="page${opts?.dense ? " dense" : ""}${opts?.kind ? ` ${opts.kind}` : ""}">
  ${headHtml(doc, n)}
${body}
</div>`;
}

export function renderChart(doc: ChartDocument): { html: string; stats: RenderStats; presentationElements: PresentationElement[] } {
  const stats: RenderStats = { rowsTotal: doc.assignments.length, rowsRendered: 0 };
  const count = (n: number) => { stats.rowsRendered += n; };
  // Per-chart editable names for every section/table/column/left-row title below.
  const elementMap = new Map<string, PresentationElement>();
  const n = makeNames(doc, elementMap);
  const col = (shift: "DAY" | "NIGHT", c: number) =>
    doc.assignments.filter((a) => a.shift === shift && a.columnNo === c);
  const dtTable = (
    rows: DocAssignment[],
    opts?: { hideLocationLabels?: boolean; dropEmptyHeadings?: boolean; dropPersons?: Set<number> },
  ) => `<table class="dt"><tbody>\n${renderGroups(rows, count, opts, n)}</tbody></table>`;

  // ---- chart-local STRUCTURE (user 2026-10-13, item 11) ------------------------
  // The clerk can add/remove whole TABLES they own (title, column headers, rows, cells) and
  // add/remove COLUMNS on the manpower matrix — the same CRUD the officer/chowki boxes already
  // have, extended to the rest of the sheet. It lives in daily_charts.presentation_overrides
  // (chart-local, snapshots at FINALIZE, never touches the template or the masters) and is
  // validated + written by PATCH /api/charts/:date/structure.
  interface FreeTable { id: string; title: string; columns: string[]; rows: string[][]; }
  interface StructureOverrides {
    tables?: FreeTable[];
    matrix?: { addedColumns?: MatrixColumn[]; hiddenColumns?: string[]; cells?: Record<string, string> };
  }
  const structure = (doc.template.overrides.structure ?? {}) as StructureOverrides;
  const extraTables: FreeTable[] = Array.isArray(structure.tables) ? structure.tables : [];
  const freeTableHtml = (t: FreeTable): string => `<div class="blk free-tbl">
      <div class="bh"><div class="nm" data-table-title="${h(t.id)}" data-default="${h(t.title)}">${raw(t.title)}</div><span class="chip num">${toMr(String(t.rows.length))}</span><button type="button" class="box-del no-print" data-table-del="${h(t.id)}" title="हा तक्ता काढा (संपादन मोड)">✕</button></div>
      <div class="body">
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr>${t.columns.map((c, ci) => `<th data-table-col="${h(t.id)}" data-col="${ci}" data-default="${h(c)}">${raw(c)}</th>`).join("")}</tr></thead>
          <tbody>
            ${t.rows.map((r, ri) => `<tr>${t.columns.map((_, ci) => `<td data-table-cell="${h(t.id)}" data-row="${ri}" data-col="${ci}">${raw(r[ci] ?? "")}</td>`).join("")}</tr>`).join("\n            ")}
          </tbody>
        </table></div>
        <div class="tbl-actions no-print"><button type="button" class="add-box tiny" data-table-add-row="${h(t.id)}">+ ओळ</button><button type="button" class="add-box tiny" data-table-add-col="${h(t.id)}">+ स्तंभ</button></div>
      </div>
    </div>`;
  const freeTablesHtml = extraTables.length
    ? `<div class="grid g-tables">\n    ${extraTables.map(freeTableHtml).join("\n    ")}\n  </div>`
    : "";

  const courtCodes = (doc.template.layout.courtDutyCodes as string[] | undefined) ?? [];
  const day4 = col("DAY", 4);
  const courtSplit = courtCodes.length > 0 && day4.some((r) => courtCodes.includes(r.dutyCode ?? ""));
  const officeRows = courtSplit ? day4.filter((r) => !courtCodes.includes(r.dutyCode ?? "")) : day4;
  const courtRows = courtSplit ? day4.filter((r) => courtCodes.includes(r.dutyCode ?? "")) : [];

  // location columns walked once: chowki/marshal blocks for page 2, location-less SPECIAL POSTS
  // (मोबाईल / सायबर सेल / काळाराम गार्ड / महिला कक्ष …) as role groups on the office/special sheet.
  const { blocks, loose, specials } = walkBlocks(doc, [2, 3]);
  const specialRows = specialDeskRows(specials);

  // ---- page 1: Sr-PI + officers + paired day/night core --------------------------
  const srpi = doc.assignments.find((a) => a.shift === "DAY" && a.person?.rankCode === "SR_PI")?.person ?? null;
  // The Sr-PI card is fully editable: रायटर is a real seat in the source chart, and the
  // चालक / RTPC / ऑपरेटर day+night seats can be created by the clerk (they do not exist in any
  // Panchavati source chart yet). No dotted “fill-in-the-blank” rules — user correction
  // 2026-10-13; an empty seat simply reads empty and carries an edit-mode + control.
  // The Sr-PI's own रायटर: several office-column seats share the OFFICE_WRITER duty, so the
  // seat WITH a person is the one the card shows (the seed's vacant twin of the same title is
  // another seat, not this one). De-duplication (user 2026-10-13: “don't list them again in the
  // office column if they are not providing more info there”): the card OWNS the row it prints,
  // so the office column no longer repeats that same row — one row, one home.
  const writerRows = doc.assignments.filter((a) => a.dutyCode === "OFFICE_WRITER");
  const writerRow = writerRows.find((a) => a.person !== null)
    ?? writerRows.find((a) => a.allocationState === "VACANT_RIKT")
    ?? writerRows[0] ?? null;
  // The card prints it and the office column no longer does — so the card accounts it.
  if (writerRow) count(1);
  const srpiSeat = (role: string, shift: "DAY" | "NIGHT"): DocAssignment | null =>
    doc.assignments.find((r) => r.columnNo === SRPI_SUPPORT_COL && r.roleMr === role && r.shift === shift) ?? null;
  // A support group with no seat at all currently holds no information, so it is marked empty:
  // the clerk can hide exactly that group to compact the card (and restore it from the bar).
  const seatGroupEmpty = (role: string): boolean => srpiSeat(role, "DAY") === null && srpiSeat(role, "NIGHT") === null;
  // Value cell of the card: exactly ONE class attribute (slotAttrs emits `class="slot"`), so a
  // seat is clickable exactly like every other slot on the chart — same picker, same rules.
  const srpiValue = (r: DocAssignment): string => {
    const inner = r.person ? personLine(r.person) : "";
    const attrs = slotAttrs(r);
    return attrs === "" ? `<span class="v empty">${inner}</span>`
      : `<span${attrs.replace('class="slot"', 'class="v slot"')}>${inner}</span>`;
  };
  const seatLine = (label: string, role: string, shift: "DAY" | "NIGHT"): string => {
    const r = srpiSeat(role, shift);
    if (r === null) {
      // No `+ जागा` button any more (user 2026-10-13: “treat them as already empty cells for a
      // name to fill”). The seat renders as an ordinary empty cell: in edit mode it is
      // highlighted, clicking it creates the real VACANT_RIKT seat through the support API and
      // opens the same staff picker every other slot uses. No person is ever invented here.
      return `<div class="ln"><span class="k">${label}</span>`
        + `<span class="v slot new-seat" data-seat-role="${h(role)}" data-seat-shift="${shift}"`
        + ` aria-label="${h(role)} ${label} रिक्त जागा — कर्मचारी नेमा"></span></div>`;
    }
    count(1);   // support seats live outside every desk walk — they are accounted here
    return `<div class="ln"><span class="k">${label}</span>${srpiValue(r)}`
      + `<button type="button" class="seat-x no-print" data-del-seat="${r.assignmentId}" title="ही जागा काढा (संपादन मोड)" aria-label="जागा काढा">✕</button></div>`;
  };
  const srPiCard = srpi ? `<div class="sr-pi-card">
    <div class="sr-pi-header">
      <div class="sr-pi-title"><span class="rk"><abbr class="abbr" data-full="${h(srpi.rankNameMr ?? "वरिष्ठ पोलीस निरीक्षक")}" aria-label="${h(srpi.rankNameMr ?? "वरिष्ठ पोलीस निरीक्षक")}" tabindex="0">${h(srpi.rankShortFormMr ?? srpi.rankCode)}</abbr></span> <span class="nm">${chartName(srpi)}</span></div>
      <span class="chip c-sr">ठाणे प्रमुख</span>
    </div>
    <div class="sr-pi-body">
       <div class="grp"${n.e("support.srpi.writer", "रायटर", "support", writerRow === null)}>
         <span class="lb">रायटर:</span>
         <div class="ln">${writerRow ? srpiValue(writerRow) : `<span class="v empty"></span>`}</div>
       </div>
       <div class="grp"${n.e("support.srpi.driver", "चालक", "support", seatGroupEmpty("चालक"))}>
         <span class="lb">चालक:</span>
         ${seatLine("दिवस:", "चालक", "DAY")}
         ${seatLine("रात्र:", "चालक", "NIGHT")}
       </div>
       <div class="grp"${n.e("support.srpi.rtpc", "RTPC", "support", seatGroupEmpty("RTPC"))}>
         <span class="lb">RTPC:</span>
         ${seatLine("दिवस:", "RTPC", "DAY")}
         ${seatLine("रात्र:", "RTPC", "NIGHT")}
       </div>
    </div>
  </div>` : "";

  // ---- page-1 officer boxes (.g-off, mock “Level 2”): one box per station-officer post. The
  // officer head is the source's own role token in the day band (col 1); its writer rows are the
  // office-column rows the source names for that branch (col 4) — moved here so they render once.
  interface OfficerBox { label: string; title?: string; writerDutyTitle: string; writerRole: string }
  // Template boxes + boxes the clerk added on THIS chart (presentation_overrides.officerBoxes)
  const baseBoxes = (doc.template.layout.officerBoxes as OfficerBox[] | undefined) ?? [];
  const extraBoxes = (doc.template.overrides.officerBoxes as OfficerBox[] | undefined) ?? [];
  const officerBoxes: OfficerBox[] = [...baseBoxes, ...extraBoxes];
  const writerTitles = new Set(officerBoxes.map((b) => b.writerDutyTitle).filter((t) => t !== ""));
  const day1 = col("DAY", 1);
  const boxRows = new Map<string, DocAssignment[]>();
  const claimed = new Set<DocAssignment>();
  let writerKey: string | null = null;
  for (const r of officeRows) {
    const wt = r.dutyTitleMr != null && writerTitles.has(r.dutyTitleMr) ? r.dutyTitleMr : null;
    if (isLabel(r)) {
      writerKey = wt;
      if (writerKey !== null) boxRows.set(writerKey, [r]);
      continue;
    }
    // A value row that carries a writer duty title IS its box's seat: a रिक्त writer seat
    // keeps that title on the row, so when the clerk fills it (person ≠ null → no longer a
    // label) it must stay in ITS box instead of drifting into the box that precedes it.
    if (wt !== null) writerKey = wt;
    if (writerKey !== null) {
      if (!boxRows.has(writerKey)) boxRows.set(writerKey, []);
      boxRows.get(writerKey)!.push(r);
    }
  }
  for (const rows of boxRows.values()) for (const r of rows) claimed.add(r);
  // Rows already printed by the Sr-PI card are claimed here: one row, one home, no second
  // copy in the office column (the card is where a value provides its information).
  if (writerRow) claimed.add(writerRow);
  const officeDesk = officeRows.filter((r) => !claimed.has(r));

  const boxHead = (box: OfficerBox): DocPerson | null =>
  (box.title ? null : day1.find((r) =>
    r.person?.cadre === "OFFICER" && r.person.rankCode !== "SR_PI"
    && bareToken(r.roleMr) === box.label)?.person ?? null);
  // Only a box the clerk added on THIS chart (presentation_overrides.officerBoxes) can be
  // removed — the template/source boxes are chart structure, not a clerk addition.
  const extraLabels = new Set(extraBoxes.map((b) => b.label));
  const officerBoxHtml = (box: OfficerBox): string => {
    const head = boxHead(box);
    const all = boxRows.get(box.writerDutyTitle) ?? [];
    const rows = all.filter((r) => r.person !== null || isVacant(r));
    // no-loss: the office-column label row materialises as the box's role label, and each
    // value row is printed — both counted exactly once, here.
    count(all.length);
    const roleKey = `box.${box.label}.role`;
    const th = `<th class="role"${rows.length > 1 ? ` rowspan="${rows.length}"` : ""}${n.e(roleKey, box.writerRole)}>${disp(n.t(roleKey, box.writerRole))}</th>`;
    const body = rows.length === 0
      // A box with no writer row AT ALL (nothing configured for its title) prints just its
      // heading — the empty “रायटर + blank” line under “विशेष तपास पथक” was pure whitespace
      // (user 2026-10-13: “remove that just like we removed in above officer boxes”). A box whose
      // seat exists and is रिक्त still prints its रिक्त row.
      ? ""
      : rows.map((r, i) =>
        `<tr${i === 0 ? ` class="g"` : ""}>${i === 0 ? th : ""}<td${slotAttrs(r)}>${r.person ? personLine(r.person) : `<span class="chip c-vac">रिक्त</span>`}</td></tr>`,
      ).join("\n        ");
    const nameDef = box.title ?? box.label;
    const nameKey = `box.${box.label}.nm`;
    // A named post head (title/label) is rename-able; a real officer's person-line is NOT
    // (it is a person's name, not a table/column name — the master stays the authority).
    const name = head ? personLine(head) : disp(n.t(nameKey, nameDef));
    return `<div class="blk">
       <div class="bh"><div class="nm"${head ? "" : n.e(nameKey, nameDef, "section")}>${name}</div><span class="chip c-off"${n.e(`box.${box.label}`, box.label)}>${disp(n.t(`box.${box.label}`, box.label))}</span>${extraLabels.has(box.label)
        ? `<button type="button" class="box-del no-print" data-box-del="officer" data-box-label="${h(box.label)}" title="हा बॉक्स काढा (संपादन मोड)">✕</button>` : ""}</div>${body === "" ? "" : `
      <div class="body"><table class="dt"><tbody>\n        ${body}\n      </tbody></table></div>`}
    </div>`;
  };

  // The station officers are the chart's special band: the Sr-PI is the card above and each branch
  // officer is an officer box. That band's own source group (its label + the officer rows that
  // follow it, up to the next post label) is therefore counted here and NOT repeated inside the
  // generic day desk below — exactly the rows the card and the boxes render once.
  const boxHeads = new Set(officerBoxes.map((b) => boxHead(b)?.staffId).filter((x): x is number => x != null));
  const bandLabelIdx = day1.findIndex((r) => isLabel(r) && r.dutyCode === STATION_LEADERSHIP_DUTY);
  const officerBand: DocAssignment[] = [];
  if (bandLabelIdx >= 0) {
    officerBand.push(day1[bandLabelIdx]);
    for (let i = bandLabelIdx + 1; i < day1.length; i++) {
      const r = day1[i];
      if (isLabel(r)) break;                     // the next post label ends the officer band
      if (r.person !== null && (r.person.rankCode === "SR_PI" || boxHeads.has(r.person.staffId))) {
        officerBand.push(r);
      }
    }
  }
  count(officerBand.length);
  const officerBandSet = new Set(officerBand);
  const dayDesk = day1.filter((r) => !officerBandSet.has(r) && r !== writerRow);
  // The add control is a TILE in the officer band's own row (beside the last box), not a
  // full-width block underneath it — user correction 2026-10-13. Hidden in print (`.add-box`).
  const officerAddBox = `<button type="button" class="add-box add-box-tile" data-add="officer" title="नवीन अधिकारी बॉक्स जोडा (संपादन मोड)">+ अधिकारी बॉक्स</button>`;
  const officerGrid = `<div class="grid g-off fit">
    ${officerBoxes.map(officerBoxHtml).join("\n    ")}
    ${officerAddBox}
  </div>`;

  const deskBlock = (
    key: string, title: string, win: string | undefined, rows: DocAssignment[],
    opts?: { hideLocationLabels?: boolean; dropEmptyHeadings?: boolean; dropPersons?: Set<number> },
  ) =>
    `<div class="blk core">
      <div class="bh"><div class="nm"${n.e(key, title, "section")}>${disp(n.t(key, title))}</div>${win ? `<span class="win">${win}</span>` : ""}</div>
      <div class="body">${dtTable(rows, opts)}</div>
    </div>`;
  // Persons already printed in the officer band of THIS sheet (the Sr-PI card + every officer
  // box head). A duty-desk post group that only repeats one of them is dropped (counted 
  // elsewhere): “ठाणे अंमलदार कक्ष देखरेख — पोनि सुनिल पवार … remove this from here, we have a
  // special box at the top for him” (user 2026-10-13). Rows with a location of their own always
  // print — a chowki/desk duty is different information, never a duplicate of a box heading.
  const bandPersons = new Set<number>([
    ...(srpi ? [srpi.staffId] : []),
    ...[...boxHeads].filter((x): x is number => x != null),
  ]);

  const tail = tailSections();   // hoisted below: officer summary / patrol-scan schedule / sign-off

  // D1 (compact-v5): the wrapper must carry BOTH `grid` (display:grid, design/compv3.css) and
  // `g-core` (1fr 1fr). Without `grid` the browser computed display:block and stacked day above
  // night — 418px of dead height on the command sheet, measured 2026-10-13.
  // Compact-v5 lower band = THREE lanes: दिवस पाळी │ रात्र पाळी │ कार्यालयीन शाखा व कारकून.
  // Measured 2026-10-13: the office register needs only ~294px of height while the night lane is
  // ~451px, so it rides beside them at ZERO added height instead of owning half of the
  // office/court sheet (where it sat next to the 743px court register and left ~465px of blank).
  // Court/summons/warrant/special keep their own sheet — their volume would overflow this band.
  const p1Lower = `<div class="grid g-core">
      ${deskBlock("p1.desk.day", "दिवस पाळी कर्तव्य", "वेळ: ०९:०० ते २१:००", dayDesk, { dropPersons: bandPersons })}
      ${deskBlock("p1.desk.night", "रात्र पाळी कर्तव्य", "वेळ: २१:०० ते ०९:००", col("NIGHT", 1), { dropPersons: bandPersons })}
      ${deskBlock("p1.desk.office", "कार्यालयीन शाखा व कारकून", undefined, officeDesk, { dropEmptyHeadings: true })}
  </div>`;

    const page1 = page("", doc, `  ${srPiCard}
${officerGrid}
${p1Lower}
`, { dense: true, kind: "command" }, n);

  // ---- page 2: location blocks (chowkis + folded marshal posts) ------------------
  const blockHtml = (b: Block): string => {
    const marshal = b.kind === "MARSHAL_POST";
    const sub = (shift: "DAY" | "NIGHT", title: string) => {
      const allRows = shift === "DAY" ? b.day : b.night;
      // The chowki in-charge (person + their time window) prints ONCE, in the block heading
      // `.ch-head .of` — the mock does exactly that. The source cell repeats the same person as
      // its first row; that row is represented by the heading: counted for the no-loss ledger,
      // never printed a second time (it was the source of the wrapped stray time chip).
      const isInchargeRow = (r: DocAssignment) =>
        r.person != null && b.incharge != null && r.person.staffId === b.incharge.staffId &&
        r.startTime != null && r.endTime != null;
      const rows = allRows.filter((r) => !isInchargeRow(r));
      count(allRows.length - rows.length);
      const st = b.locationId != null
        ? stateFx(doc.locationStates, b.locationId, shift, marshal) : "";
      // a folded marshal post keeps its own typed state, printed as the mock's `मार्शल:` line
      // directly below the chowki's own state line inside the same sub-col
      const mrshSt = b.marshalLocationId != null
        ? stateFx(doc.locationStates, b.marshalLocationId, shift, true) : "";
      const closed = doc.locationStates.some(
        (s) => s.location.locationId === b.locationId && s.shift === shift && s.isClosed);
      if (rows.length === 0 && !st && !mrshSt) return "";
      // Source continuation labels (बंद / चौकी चा चार्ज…) duplicate the typed state line the
      // source also carries — they are absorbed into it (still counted once, no-loss) ONLY when
      // that .fx line exists for this shift; otherwise they render as a heading row.
      const cells = renderGroups(rows, count, {
        hideLocationLabels: true,
        absorbLabels: st !== "" || mrshSt !== "",
      }, n);
      const table = cells.includes("<tr") ? `<table class="dt"><tbody>\n${cells}</tbody></table>` : "";
      const stKey = `blk.${b.key}.${shift}`;
      return `<div class="sub-col${closed ? " shut" : ""}">
            <div class="sub-col-title"><span${n.e(stKey, title)}>${disp(n.t(stKey, title))}</span></div>
            ${st}
            ${mrshSt}
            ${table}
          </div>`;
    };
    const incharge = b.incharge ? (() => {
      const row = [...b.day, ...b.night].find(
        (r) => r.person?.staffId === b.incharge!.staffId && r.startTime && r.endTime);
      const tm = row ? ` <span class="tm">${timeRange(row.startTime, row.endTime)}</span>` : "";
      return `<div class="of">अधि. ${personLine(b.incharge)}${tm}</div>`;
    })() : "";
    // A location-backed block can be removed by the clerk while it is empty (no person, no
    // dangling चार्ज) — the domains layer enforces both guards; the control is edit-mode only.
    const delBtn = b.locationId != null
      ? `<button type="button" class="box-del no-print" data-box-del="chowki" data-location-id="${b.locationId}" title="ही चौकी काढा (संपादन मोड)">✕</button>` : "";
    return `<div class="blk">
      <div class="ch-head"><div class="nm"${n.e(`blk.${b.key}`, b.name, "section")}>${disp(n.t(`blk.${b.key}`, b.name))}</div>${incharge}${delBtn}</div>
      <div class="body"><div class="sub-shift-wrap">
        ${sub("DAY", "दिवसपाळी")}
        ${sub("NIGHT", "रात्रपाळी")}
      </div></div>
    </div>`;
  };
  const looseHtml = loose.length
    ? `<div class="blk"><div class="ch-head"><div class="nm"${n.e("blk.loose", "इतर", "section")}>${n.t("blk.loose", "इतर")}</div></div>
      <div class="body">${dtTable(loose)}</div></div>` : "";
  // This sheet is the mock's six-chowki sheet and nothing else. The गस्त/स्कॅनिंग schedule used to
  // ride along at the bottom and pushed the box 35px past one A4 sheet once the schedule became
  // the source's own session cards + folded hourly strip (print:audit, 2026-10-13); a 35px-tight
  // sheet breaks again the moment either section grows, so the schedule moved to the sheet that
  // has room (see page 3) instead of the chowki band being squeezed.
  const page2 = page("", doc, `  <div class="grid g-chowki">
    ${blocks.map(blockHtml).join("\n    ")}
    ${looseHtml}
    <button type="button" class="add-box" data-add="chowki">+ चौकी जोडा</button>
   </div>`, { kind: "chowki" }, n);

  // ---- page 3: court, summons, warrant and special duties ----------------------
  // Option A (user 2026-10-13: “we can copy it as it is”): the source never prints this as one
  // page-wide register — it prints a heading line with the names stacked under it. Each heading
  // becomes its own small card in an auto-fit grid: same rows, same vocabulary, roughly a
  // quarter of the height, and no page-wide row carrying one name and 90% empty width (measured
  // 36 rows / 707px before). Every value row and every heading is still printed exactly once.
  const groupByLabel = (rows: DocAssignment[]): { head: DocAssignment | null; rows: DocAssignment[] }[] => {
    const out: { head: DocAssignment | null; rows: DocAssignment[] }[] = [];
    for (const r of rows) {
      if (isLabel(r)) out.push({ head: r, rows: [] });
      else if (out.length === 0) out.push({ head: null, rows: [r] });
      else out[out.length - 1].rows.push(r);
    }
    return out;
  };
  // A continuation label with no rows of its own (the source's note cell, e.g. “वायरलेस महिला
  // अंमलदार” beside महिला कक्ष) is absorbed as a note line inside the preceding card instead of
  // becoming an empty card of its own (user 2026-10-13: “why are these two empty … remove them”).
  // A post that carries its own duty code keeps its card even with nobody assigned: the post
  // exists on the chart and the clerk can fill it.
  const courtPostGroups: { head: DocAssignment | null; rows: DocAssignment[]; notes: string[] }[] = [];
  for (const g of groupByLabel([...courtRows, ...specialRows])) {
    if (g.rows.length === 0 && g.head && g.head.dutyCode == null && courtPostGroups.length > 0) {
      const def = g.head.dutyTitleMr ?? "";
      const key = `grp.${g.head.assignmentId}`;
      count(1);   // the row is printed — as the note line of the card it annotates
      courtPostGroups[courtPostGroups.length - 1].notes.push(disp(n.t(key, def)));
      continue;
    }
    courtPostGroups.push({ head: g.head, rows: g.rows, notes: [] });
  }
  const courtCards = courtPostGroups.map((g) => {
    if (g.head) count(1);   // the heading row materialises as this card's title
    const def = g.head ? (g.head.dutyTitleMr ?? "") : "";
    const key = g.head ? `grp.${g.head.assignmentId}` : "court.other";
    const title = def === "" ? "" : disp(n.t(key, def));
    const noteLines = g.notes.map((t) => `<div class="p note"><span class="n">${t}</span></div>`).join("\n        ");
    const chip = g.rows.length > 0 ? `<span class="chip num">${toMr(String(g.rows.length))}</span>` : "";
    const body = `${noteLines}${g.rows.length ? dtTable(g.rows) : ""}`;
    // A post title with NOTHING under it prints its name and stops there: the old markup always
    // emitted an empty `.body`, which drew a second bordered band with no content — the two
    // “empty tables” the clerk flagged on the court sheet (user 2026-10-13: “these two empty
    // tables here: महिला कक्ष / वायरलेस महिला अंमलदार … also lots of whitespace”), and the source
    // names no separate roster for those two posts (OPEN_QUESTIONS T25). Nothing is inferred:
    // रिक्त is a source state and is never stamped onto a post the source leaves open.
    return `<div class="blk court${body === "" ? " post-only" : ""}">
      <div class="bh"><div class="nm"${n.e(key, def, "label")}>${title}</div>${chip}</div>${body === "" ? "" : `
      <div class="body">${body}</div>`}
    </div>`;
  }).join("\n    ");
  const courtDesk = courtPostGroups.length > 0
    ? `<div class="grid g-desk alone">
    <div class="blk core">
      <div class="bh"><div class="nm"${n.e("p1.desk.court", "कोर्ट, समन्स, वॉरंट व विशेष कक्ष", "section")}>${disp(n.t("p1.desk.court", "कोर्ट, समन्स, वॉरंट व विशेष कक्ष"))}</div></div>
      <div class="body"><div class="grid g-court">
    ${courtCards}
      </div></div>
    </div>
  </div>`
    : "";
  const page3 = page("", doc, `${courtDesk}
${tail.scanSection}`, { dense: true }, n);

  // ---- page 4: availability (leave section + other duties) ---------------------
  // One block per SOURCE sub-group (category); the source's own column groups decide which
  // section a block lands in (template layout config — display grouping only).
  interface AvailSection { title: string; groupKeys: string[] }
  const availSections = ((doc.template.layout.availabilitySections as AvailSection[] | undefined)
    ?? []).length
    ? (doc.template.layout.availabilitySections as AvailSection[])
    : [{ title: "रजा, साप्ताहिक सुट्टी व गैरहजर", groupKeys: [] as string[] }];
  const availByCategory = new Map<string, typeof doc.availability>();
  for (const a of doc.availability) {
    if (!availByCategory.has(a.category)) availByCategory.set(a.category, []);
    availByCategory.get(a.category)!.push(a);
  }
  const buckets: [string, typeof doc.availability][][] = availSections.map(() => []);
  for (const [category, items] of availByCategory) {
    const group = items[0].groupKey ?? category;
    const idx = availSections.findIndex((s) => s.groupKeys.includes(group));
    buckets[idx === -1 ? 0 : idx].push([category, items]);
  }
  const availBlock = (name: string, items: typeof doc.availability) => {
    const lines = items.map((a) => {
      const win = a.detailMr ? `<span class="win">${disp(a.detailMr)}</span>` : "";
      if (!a.person) {
        // source sub-group label with nobody listed under it
        return `<div class="p"><span class="role">${disp(a.category)}</span>${win}</div>`;
      }
      return `<div class="p"><span class="n">${personLine(a.person)}</span>${win}</div>`;
    }).join("\n        ");
    return `<div class="blk">
      <div class="bh"><div class="nm"${n.e(`avail.${name}`, name, "section")}>${disp(n.t(`avail.${name}`, name))}</div><span class="chip num">${toMr(String(items.length))}</span></div>
      <div class="body">
        ${lines}
      </div>
    </div>`;
  };
  // Notice LINES are author-entered text (`chart_notices`, one row per line) — so every line is
  // an edit target with its real id (user 2026-10-13, item 11: “everything CRUDable”). The
  // render stays a plain line list; the ✕/＋ controls are edit-mode-only chrome (never printed).
  const noticeGroups = new Map<string, typeof doc.notices>();
  for (const item of doc.notices) {
    const k = item.groupKey ?? "सूचना";
    if (!noticeGroups.has(k)) noticeGroups.set(k, []);
    noticeGroups.get(k)!.push(item);
  }
  const noticeBlocks = [...noticeGroups.entries()].map(([k, items]) =>
    `<div class="blk">
      <div class="bh"><div class="nm"${n.e(`notice.${k}`, k, "section")}>${disp(n.t(`notice.${k}`, k))}</div><span class="chip num">${toMr(String(items.length))}</span><button type="button" class="add-box tiny no-print" data-notice-add="${h(k)}" title="या गटात नवीन सूचना जोडा (संपादन मोड)">+ सूचना</button></div>
      <div class="body">
        ${items.map((it) => `<div class="p notice-line" data-notice="${it.noticeId}" data-notice-group="${h(k)}"><span class="n">${raw(it.textMr)}</span></div>`).join("\n        ")}
      </div>
    </div>`).join("\n    "); const availSectionsHtml = buckets.map((blocks, i) => blocks.length === 0 ? "" : `  <div class="sec"${i === 0 ? "" : ` style="margin-top:10px;"`}><h2${n.e(`sec.avail.${i}`, availSections[i].title, "section")}>${disp(n.t(`sec.avail.${i}`, availSections[i].title))}</h2></div>
  <div class="grid g4">
    ${blocks.map(([k, v]) => availBlock(k, v)).join("\n    ")}
  </div>`).join("\n\n");

  // Page 3 splits into the leave/court sheet (dense — real leave lists are long) and a notices
  // sheet. The mock omits the source's notice rows entirely, so nothing in the mock is violated;
  // keeping them here gives every printed sheet a coherent section instead of raw spill-over.
  const page4 = page("", doc, availSectionsHtml, { dense: true }, n);

  const page5 = page("", doc, `  <div class="sec"><h2${n.e("sec.notices", "सूचना व निर्देश", "section")}>${disp(n.t("sec.notices", "सूचना व निर्देश"))}</h2></div>
  <div class="grid g4">
    ${noticeBlocks}
    <button type="button" class="add-box" data-notice-add="" title="नवीन सूचना गट जोडा (संपादन मोड)">+ सूचना गट</button>
   </div>
${freeTablesHtml}
<div class="sec" style="margin-top:10px;"><button type="button" class="add-box" data-table-add="1" title="नवीन तक्ता जोडा (संपादन मोड)">+ तक्ता जोडा</button></div>
${tail.officerSummarySection}`, { kind: "notices" }, n);

  // ---- page 4: manpower matrix + shift summary + sudden changes ----
  const matrixBase = (doc.template.layout.matrixColumns as MatrixColumn[] | undefined) ?? [];
  const matrixAdds = structure.matrix?.addedColumns ?? [];
  const matrixHidden = new Set(structure.matrix?.hiddenColumns ?? []);
  const mcols = [...matrixBase, ...matrixAdds].filter((c) => !matrixHidden.has(c.key));
  const mAdded = new Set(matrixAdds.map((c) => c.key));
  // Matrix headers/row names are editable NAMES; cell VALUES stay verbatim source data (never
  // digit-transformed, never renamed) — header text keeps h() only, exactly as before. A column
  // the CLERK added on this chart is not source data at all: its cells are typed text and its
  // header carries the add/remove controls (column CRUD = user 2026-10-13, item 11).
  const matrixHead = `<tr><th${n.e("mcol.detail", "तपशील")}>${h(n.t("mcol.detail", "तपशील"))}</th>${mcols.map((c) => mAdded.has(c.key)
    ? `<th class="num added" data-matrix-col="${h(c.key)}" data-default="${h(c.label)}">${h(c.label)}<button type="button" class="col-x no-print" data-matrix-col-del="${h(c.key)}" title="हा स्तंभ काढा (संपादन मोड)">✕</button></th>`
    : `<th class="num"${n.e(`mcol.${c.key}`, c.label)}>${h(n.t(`mcol.${c.key}`, c.label))}<button type="button" class="col-x no-print" data-matrix-col-hide="${h(c.key)}" title="हा स्तंभ लपवा (संपादन मोड)">✕</button></th>`).join("")}<th class="num no-print col-add"><button type="button" class="add-box tiny" data-matrix-col-add="1" title="नवीन स्तंभ जोडा (संपादन मोड)">+ स्तंभ</button></th></tr>`;
  const rowOrder = [...new Set(doc.manpower.map((c) => c.displayOrder))].sort((a, b) => a - b);
  const matrixBody = rowOrder.map((ord) => {
    const cells = doc.manpower.filter((c) => c.displayOrder === ord);
    const rowKey = cells[0]?.rowKey ?? "";
    const tds = mcols.map((mc) => {
      if (mAdded.has(mc.key)) {
        const typed = structure.matrix?.cells?.[`${rowKey}|${mc.key}`] ?? "";
        return `<td class="num added" data-matrix-cell="${h(`${rowKey}|${mc.key}`)}">${h(typed)}</td>`;
      }
      const cell = cells.find((c) => c.columnKey === mc.key);
      const v = cell ? cell.valueText : "";
      const muted = v === ".." || v === "" ? " muted" : "";
      // Verbatim source values — NEVER toMr. A cell whose source stacks two numbers on two
      // lines keeps that break (हजर मनुष्यबळ's OFFICE cell is “12” over “04 Pro.”): the seed
      // stores the source's own <br>, each part is escaped separately and the break is re-emitted
      // as a real <br>, so a tag in the data can never inject markup and the sheet never prints
      // the literal text “<br>” (that was the reported “12<br>04 Proण्”).
      const parts = v.split(/<br\s*\/?>/i).map(h);
      return `<td class="num${muted}">${parts.join("<br>")}</td>`;
    }).join("");
    return `<tr><th${n.e(`mrow.${rowKey}`, rowKey)}>${disp(n.t(`mrow.${rowKey}`, rowKey))}</th>${tds}</tr>`;
  }).join("\n      ");

  const sumLabel: Record<string, string> = {
    DAY: "दिवसपाळी (०९:०० ते २१:००)", NIGHT: "रात्रपाळी (२१:०० ते ०९:००)", OTHER: "इतर ड्युटी / रजा / कोर्ट",
  };
  const sumCols = (doc.template.layout.shiftSummaryColumns as string[] | undefined) ?? [];
  const sumBody = (["DAY", "NIGHT", "OTHER"] as const).map((k) => {
    const tds = sumCols.map((c) => {
      const cell = doc.shiftSummaries.find((s) => s.summaryKey === k && s.columnKey === c);
      return `<td class="num">${disp(cell?.valueText ?? "")}</td>`;
    }).join("");
    return `<tr><th${n.e(`ssum.row.${k}`, sumLabel[k])}>${disp(n.t(`ssum.row.${k}`, sumLabel[k]))}</th>${tds}</tr>`;
  }).join("\n      ");

  const changeBody = doc.suddenChanges.map((c) =>
    `<tr><td class="num">${toMr(String(c.seq))}</td><td>${disp(c.detailMr)}</td><td>${disp(c.noteMr ?? "")}</td></tr>`)
    .join("\n      ") || `<tr><td class="num">—</td><td class="nil">नोंद नाही</td><td></td></tr>`;

  const page6 = page("", doc, `  <div class="sec"><h2${n.e("sec.matrix", "मनुष्यबळ स्थिती दर्शक मॅट्रिक्स", "section")}>${disp(n.t("sec.matrix", "मनुष्यबळ स्थिती दर्शक मॅट्रिक्स"))}</h2></div>
  <div class="tbl-wrap">
  <table class="tbl">
    <thead>
      ${matrixHead}
    </thead>
    <tbody>
      ${matrixBody}
    </tbody>
  </table>
  </div>

  <div class="sec" style="margin-top:10px;"><h2${n.e("sec.summary", "पाळीनिहाय सारांश व अचानक बदल नोंद", "section")}>${disp(n.t("sec.summary", "पाळीनिहाय सारांश व अचानक बदल नोंद"))}</h2></div>
  <div class="two">
    <div class="tbl-wrap">
      <table class="tbl">
        <thead><tr><th${n.e("ssum.lbl", "पाळी")}>${disp(n.t("ssum.lbl", "पाळी"))}</th>${sumCols.map((c) => `<th class="num"${n.e(`ssum.col.${c}`, c)}>${h(n.t(`ssum.col.${c}`, c))}</th>`).join("")}</tr></thead>
        <tbody>
      ${sumBody}
        </tbody>
      </table>
    </div>
    <div class="tbl-wrap">
      <table class="tbl">
        <thead><tr><th class="num" style="width:32px"${n.e("chg.h.n", "अ.नं.")}>${disp(n.t("chg.h.n", "अ.नं."))}</th><th${n.e("chg.h.d", "अचानक बदल तपशील")}>${disp(n.t("chg.h.d", "अचानक बदल तपशील"))}</th><th style="width:40%"${n.e("chg.h.note", "नोंद / कारण")}>${disp(n.t("chg.h.note", "नोंद / कारण"))}</th></tr></thead>
        <tbody>
      ${changeBody}
        </tbody>
      </table>
    </div>
   </div>
   ${tail.signoff}`, undefined, n);

  // ---- officer summary / patrol-scan schedule / sign-off (compact-v5: composed onto sheets 1, 5, 6) ----
  // Declared as a HOISTED function so the sheet assembly above can place these sections on the
  // sheets that have room. The seventh sheet they used to own is gone; every row still prints once.
  function tailSections() {
  const offHalf = Math.ceil(doc.officerSummary.length / 2);
  const officerTable = (rows: typeof doc.officerSummary) => `<div class="tbl-wrap">
      <table class="tbl">
        <thead><tr><th class="num" style="width:30px"${n.e("off.h.n", "अ.नं.")}>${disp(n.t("off.h.n", "अ.नं."))}</th><th${n.e("off.h.o", "अधिकारी")}>${disp(n.t("off.h.o", "अधिकारी"))}</th><th${n.e("off.h.d", "कर्तव्य वाटप")}>${disp(n.t("off.h.d", "कर्तव्य वाटप"))}</th></tr></thead>
        <tbody>
        ${rows.map((o) => `<tr><td class="num">${toMr(String(o.rowNo))}</td><td>${disp(o.officerText)}</td><td>${disp(o.dutyText)}</td></tr>`).join("\n        ")}
        </tbody>
      </table>
    </div>`;

  const scanBody = doc.scanSchedule.map((s) =>
    `<tr><th class="win num">${toMr(hhmm(s.startTime))} ते ${toMr(hhmm(s.endTime))}</th><td>${s.location ? disp(s.location.nameMr) : ""}</td><td>${s.person ? personLine(s.person) : ""}</td></tr>`)
    .join("\n        ");

  // Sign-off (user 2026-10-13, item 12): the VALUES are the author's, not machine output.
  // “तक्ता तयार करणारे हजेरी लेखनिक” defaults to the chart's हजेरी मास्तर rows, the signed-in
  // clerk's name is filled in by the client, and the clerk can type any text (persisted per
  // chart). The ठाणे शिक्का line stays an empty, editable field — its second line
  // “ठाणे दैनंदिनी नोंद क्र. ____ / २०२६” was removed by request.
  const hazari = doc.assignments.filter((a) => a.dutyCode === "OFFICE_HAZARI_MASTER" && a.person).map((a) => personText(a.person!));
  // Sign-off LABELS are rename-able (span-wrapped so the value below <br> is never touched);
  // the VALUES are editable text through the same chart-local value store.
  const sig = (key: string, label: string, value: string): string =>
    `<div class="sig"><span${n.e(key, label, "section")}>${disp(n.t(key, label))}</span><br>${value}</div>`;
  const signoff = `<div class="signoff">
    ${sig("signoff.1", "तक्ता तयार करणारे हजेरी लेखनिक:", n.vt("signoff.1", hazari.join(" / "), "sv"))}
    ${sig("signoff.2", "तपासणी अधिकारी (प्रभारी):", srpi ? `<b>${h(srpi.nameMr)}</b>, वरिष्ठ पोलीस निरीक्षक` : "<b>—</b>")}
    ${sig("signoff.3", "ठाणे शिक्का व दैनिक डायरी नोंद:", n.vt("signoff.3", "", "sv"))}
  </div>`;

  // ---- scan / patrol schedule: the source's own session cards (Option A) --------
  // Session structure (patrol mobile + beat-marshal per session) is station-stable config
  // (SEMANTIC 10.md Tables 10/11). Each session is its OWN small card instead of one 3-row body
  // stretched to the height of the long table beside it (measured 281px for 3 rows; user
  // 2026-10-13: “scan / patrol schedule, option A, the source is pretty good designed”).
  interface ScanSession { session: string; patrol: string; beat: string }
  const scanSessions = (doc.template.layout.scanSessions as ScanSession[] | undefined) ?? [];
  const sessionCard = (s: ScanSession, i: number): string => `<div class="tbl-wrap card">
      <table class="tbl">
        <thead><tr><th colspan="2"${n.e(`scan.s.${i}.t`, s.session)}>${disp(n.t(`scan.s.${i}.t`, s.session))}</th></tr></thead>
        <tbody>
          <tr><th${n.e(`scan.s.${i}.p`, "पेट्रोलिंग मोबाईल")}>${disp(n.t(`scan.s.${i}.p`, "पेट्रोलिंग मोबाईल"))}</th><td>${disp(s.patrol)}</td></tr>
          <tr><th${n.e(`scan.s.${i}.b`, "बीट मार्शल नेमणूक")}>${disp(n.t(`scan.s.${i}.b`, "बीट मार्शल नेमणूक"))}</th><td>${disp(s.beat)}</td></tr>
        </tbody>
      </table>
    </div>`;
  const sessionCards = scanSessions.map(sessionCard).join("\n    ");

  // The hourly session (बिट मार्शल व ऑफिस स्टाफ, 09:00–21:00, 12 rows) folds into 3 sub-columns of
  // 4 rows — the source's own compact rectangle instead of one 12-row strip. Same rows, same
  // order, each printed once; the header repeats per sub-column so every block reads on its own.
  const scanChunkTable = (rows: typeof doc.scanSchedule): string => `<div class="tbl-wrap">
    <table class="tbl">
      <thead><tr><th class="num"${n.e("scan.h.t", "वेळ")}>${disp(n.t("scan.h.t", "वेळ"))}</th><th${n.e("scan.h.l", "स्कॅन चौकी हद्द")}>${disp(n.t("scan.h.l", "स्कॅन चौकी हद्द"))}</th><th${n.e("scan.h.p", "नियुक्त अंमलदार")}>${disp(n.t("scan.h.p", "नियुक्त अंमलदार"))}</th></tr></thead>
      <tbody>
        ${rows.map((s) => `<tr><th class="win num">${toMr(hhmm(s.startTime))} ते ${toMr(hhmm(s.endTime))}</th><td>${s.location ? disp(s.location.nameMr) : ""}</td><td>${s.person ? personLine(s.person) : ""}</td></tr>`).join("\n        ")}
      </tbody>
    </table>
  </div>`;
  const scanChunks: (typeof doc.scanSchedule)[] = [];
  for (let i = 0; i < doc.scanSchedule.length; i += 4) scanChunks.push(doc.scanSchedule.slice(i, i + 4));

  const officerSummarySection = `  <div class="sec"><h2${n.e("sec.officers", "पोलीस अधिकारी कर्तव्य सारांश", "section")}>${disp(n.t("sec.officers", "पोलीस अधिकारी कर्तव्य सारांश"))}</h2></div>
  <div class="two">
    ${officerTable(doc.officerSummary.slice(0, offHalf))}
    ${officerTable(doc.officerSummary.slice(offHalf))}
  </div>`;

  const scanSection = `  <div class="sec" style="margin-top:10px;"><h2${n.e("sec.scan", "सुरक्षित नाशिक: गस्त व स्कॅनिंग वेळापत्रक", "section")}>${disp(n.t("sec.scan", "सुरक्षित नाशिक: गस्त व स्कॅनिंग वेळापत्रक"))}</h2></div>
  ${sessionCards ? `<div class="grid g-scan-sessions">\n    ${sessionCards}\n  </div>\n  ` : ""}<div class="grid g-scan-hours">
    ${scanChunks.map(scanChunkTable).join("\n    ")}
  </div>`;

  return { officerSummarySection, scanSection, signoff };
  }

  const html = `<!DOCTYPE html>
<html lang="mr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>पंचवटी दैनिक कर्तव्य तक्ता — ${doc.chartDate}</title>
<link rel="icon" href="/assets/police-logo.png">
<link rel="stylesheet" href="__CSS_HREF__">
<link rel="stylesheet" href="__AUTH_CSS_HREF__">
<link rel="stylesheet" href="__PRESENTATION_CSS_HREF__">
</head>
<body data-chart-date="${doc.chartDate}" data-lifecycle="${doc.lifecycle}">

<div class="toolbar no-print" id="appbar">
  <div class="ab-l">
    <img class="ab-logo" src="/assets/police-logo.png" alt="महाराष्ट्र पोलीस" width="34" height="34">
    <div class="ab-st">
      <b><span data-lang="mr">पंचवटी पोलीस ठाणे</span><span data-lang="en">Panchavati Police Station</span></b>
      <span><span data-lang="mr">नाशिक शहर</span><span data-lang="en">Nashik City</span></span>
    </div>
    <nav class="ab-nav" aria-label="मुख्य नेव्हिगेशन">
      <div class="ab-group">
        <button type="button" class="ab-gbtn active" aria-expanded="false"><span data-lang="mr">दैनिक कर्तव्य तक्ते</span><span data-lang="en">Daily Duty Charts</span><span class="cv">▾</span></button>
        <div class="ab-menu" role="menu">
          <a role="menuitem" href="#sheet-1"><span data-lang="mr">पृष्ठ १ — दैनिक कर्तव्य तक्ता</span><span data-lang="en">Sheet 1 — Daily duty chart</span></a>
          <a role="menuitem" href="#sheet-2"><span data-lang="mr">पृष्ठ २ — चौक्या, गस्त व स्कॅनिंग</span><span data-lang="en">Sheet 2 — Chowkis, patrol &amp; scanning</span></a>
          <a role="menuitem" href="#sheet-3"><span data-lang="mr">पृष्ठ ३ — कोर्ट, समन्स व विशेष कक्ष</span><span data-lang="en">Sheet 3 — Court, summons &amp; special desks</span></a>
          <a role="menuitem" href="#sheet-4"><span data-lang="mr">पृष्ठ ४ — रजा व इतर ड्युटी</span><span data-lang="en">Sheet 4 — Leave &amp; other duties</span></a>
          <a role="menuitem" href="#sheet-5"><span data-lang="mr">पृष्ठ ५ — सूचना व अधिकारी सारांश</span><span data-lang="en">Sheet 5 — Notices &amp; officer summary</span></a>
          <a role="menuitem" href="#sheet-6"><span data-lang="mr">पृष्ठ ६ — मनुष्यबळ व सारांश</span><span data-lang="en">Sheet 6 — Manpower &amp; summary</span></a>
          <div class="ab-sep"><span data-lang="mr">संदर्भ</span><span data-lang="en">Reference</span></div>
          <a role="menuitem" href="#" data-legacy="1"><span data-lang="mr">जुना ६-पृष्ठ तक्ता — १० सप्टेंबर २०२६</span><span data-lang="en">Legacy 6-page chart — 10 Sept 2026</span></a>
        </div>
      </div>
      <div class="ab-group">          <button type="button" class="ab-gbtn" aria-expanded="false"><span data-lang="mr">कार्यवाही</span><span data-lang="en">Operations</span><span class="cv">▾</span></button>
        <div class="ab-menu" role="menu">
          <a role="menuitem" href="#" data-wip="कार्यकारी डॅशबोर्ड"><span data-lang="mr">कार्यकारी डॅशबोर्ड</span><span data-lang="en">Executive dashboard</span><small>WIP</small></a>
          <a role="menuitem" href="#" data-wip="कर्तव्य फलक"><span data-lang="mr">कर्तव्य फलक (दिवसनिहाय)</span><span data-lang="en">Duty board (day-wise)</span><small>WIP</small></a>
          <a role="menuitem" href="#" data-wip="बंदोबस्त व विशेष मोहीम"><span data-lang="mr">बंदोबस्त व विशेष मोहीम</span><span data-lang="en">Bandobast &amp; special operations</span><small>Coming Soon</small></a>
          <a role="menuitem" href="#" data-wip="ऐतिहासिक शोध"><span data-lang="mr">ऐतिहासिक शोध</span><span data-lang="en">Historical search</span><small>Coming Soon</small></a>
          <a role="menuitem" href="#" data-wip="इव्हेंट अ‍ॅनेक्स"><span data-lang="mr">इव्हेंट अ‍ॅनेक्स</span><span data-lang="en">Event annex</span><small>Coming Soon</small></a>
        </div>
      </div>
      <div class="ab-group">          <button type="button" class="ab-gbtn" aria-expanded="false"><span data-lang="mr">डेटा</span><span data-lang="en">Data</span><span class="cv">▾</span></button>
        <div class="ab-menu" role="menu">
          <a role="menuitem" href="#" data-masters="1"><span data-lang="mr">मास्टर डेटा (कर्मचारी, चौक्या, हुद्दे)</span><span data-lang="en">Master data (staff, chowkis, duties)</span></a>
          <a role="menuitem" href="#" data-wip="मास्टर डेटा संपादन"><span data-lang="mr">मास्टर डेटा संपादन / नवीन नोंद</span><span data-lang="en">Edit / add master data</span><small>WIP</small></a>
          <a role="menuitem" href="#" data-wip="दस्तऐवज आयात / OCR"><span data-lang="mr">दस्तऐवज आयात / OCR</span><span data-lang="en">Document import / OCR</span><small>Coming Soon</small></a>
          <a role="menuitem" href="#" data-wip="अहवाल व निर्यात"><span data-lang="mr">अहवाल व PDF निर्यात</span><span data-lang="en">Reports &amp; PDF export</span><small>Coming Soon</small></a>
        </div>
      </div>
      <div class="ab-group">          <button type="button" class="ab-gbtn" aria-expanded="false"><span data-lang="mr">समाकलन</span><span data-lang="en">Integrations</span><span class="cv">▾</span></button>
        <div class="ab-menu" role="menu">
          <a role="menuitem" href="#" data-wip="WhatsApp अलर्ट"><span data-lang="mr">WhatsApp वर तक्ता पाठवा</span><span data-lang="en">Send chart on WhatsApp</span><small>Coming Soon</small></a>
          <a role="menuitem" href="#" data-wip="Telegram अलर्ट"><span data-lang="mr">Telegram अलर्ट</span><span data-lang="en">Telegram alerts</span><small>Coming Soon</small></a>
          <a role="menuitem" href="#" data-wip="बहु-ठाणे"><span data-lang="mr">इतर ठाणी (बहु-ठाणे)</span><span data-lang="en">Other stations (multi-station)</span><small>Coming Soon</small></a>
          <a role="menuitem" href="#" data-wip="टेम्पलेट बिल्डर"><span data-lang="mr">तक्ता टेम्पलेट बिल्डर</span><span data-lang="en">Chart template builder</span><small>Coming Soon</small></a>
        </div>
      </div>
    </nav>
  </div>
  <div class="ab-r">
    <div class="ab-lang" role="group" aria-label="भाषा निवड">
      <button type="button" data-lang-set="mr">मराठी</button>
      <button type="button" data-lang-set="en">EN</button>
    </div>
    <button type="button" class="ab-user" id="ab-user" title="तक्ता तयार करणारे हजेरी लेखनिक">लॉगिन</button>
  </div>
</div>

<div class="chart-toolbar no-print">
  <div class="ct-title"><span><span data-lang="mr">पंचवटी दैनिक कर्तव्य तक्ता</span><span data-lang="en">Panchavati daily duty chart</span></span><strong><span data-lang="mr">${dateSlash(doc.chartDate)}, ${doc.weekdayMr}</span><span data-lang="en">${dateLatin(doc.chartDate)}, ${weekdayEn(doc.chartDate)}</span></strong></div>
  <div class="ct-actions">
    <div class="ab-datewrap">
      <button type="button" class="ab-datebtn" id="date-btn" aria-haspopup="listbox" aria-expanded="false" title="तारीख बदला">
        <svg class="cal" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="3" y="5.5" width="18" height="15" rx="2.5"/><path d="M3 10.5h18M8 3.5v4M16 3.5v4"/></svg>
        <span class="dl">
          <span class="d" data-lang="mr">${dateSlash(doc.chartDate)}</span><span class="d" data-lang="en">${dateLatin(doc.chartDate)}</span>
          <span class="w" data-lang="mr">${doc.weekdayMr}</span><span class="w" data-lang="en">${weekdayEn(doc.chartDate)}</span>
        </span>
        <span class="cv">▾</span>
      </button>
      <div class="ab-datemenu" id="date-menu" role="listbox" hidden></div>
    </div>
    <span class="lc lc-${doc.lifecycle.toLowerCase()}"><span data-lang="mr">${doc.lifecycle === "FINALIZED" ? "अंतिम" : doc.lifecycle === "VALIDATED" ? "तपासलेले" : "मसुदा"}</span><span data-lang="en">${doc.lifecycle}</span></span>
    ${doc.lifecycle === "FINALIZED"
      ? `<button id="amend-btn"><span data-lang="mr">सुधारणा सुरू करा</span><span data-lang="en">Start amendment</span></button>`
      : `<button id="mode-btn"><span data-lang="mr">संपादन</span><span data-lang="en">Edit</span></button><button id="finalize-btn" class="finalize"><span data-lang="mr">अंतिम करा</span><span data-lang="en">Finalize</span></button>`}
    <button class="print" onclick="window.print()"><span data-lang="mr">प्रिंट</span><span data-lang="en">Print</span></button>
  </div>
</div>

${page1}

${page2}

${page3}

${page4}

${page5}

${page6}

<script src="__VENDOR_JS_SRC__" defer></script>
<script src="__AUTH_JS_SRC__" defer></script>
</body>
</html>`;

  // Sheet anchors (nav submenu jumps to a printed sheet): sheet-1 … sheet-N in DOM order.
  let sheetNo = 0;
  const anchored = html.replace(/<div class="page([^"]*)">/g, (_m: string, cls: string) => `<div class="page${cls}" id="sheet-${++sheetNo}">`);

  return { html: anchored, stats, presentationElements: [...elementMap.values()] };
}
