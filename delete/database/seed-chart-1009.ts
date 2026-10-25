// 10/09/2026 chart seed — reference/SEMANTIC/10.md is the content authority (the compact-v3
// mock owns visual grammar only; per AGENTS.md authority order SEMANTIC > docs > mock).
// Row-per-source-cell emission: label cells become context rows, person cells become
// assignments, narrative cells become notices, बंद/चार्ज cells become explicit
// location_operational_states (never parsed from notes — the cells ARE the facts here).
import { fileURLToPath } from "node:url";
import path from "node:path";
import type pg from "pg";
import { makePool, DEV_DB, TEST_DB, isTestRun } from "../server/db.js";

const DATE = "2026-09-10";

// ---------- person resolution (fail loud; never guess across multiple matches) ----------
type Person = [rank: string, key: string, note?: string, flags?: string];
// flags: 'bima' | 'w=09:00-14:00' (both allowed via 'bima,w=..')

const staffCache = new Map<string, number>();
async function resolve(pool: pg.Pool, rank: string, key: string): Promise<number> {
  const ck = `${rank}|${key}`;
  if (staffCache.has(ck)) return staffCache.get(ck)!;
  let rows: { staff_id: number }[];
  if (/^\d+$/.test(key)) {
    rows = (await pool.query(
      `SELECT staff_id FROM staff_members WHERE rank_code=$1 AND buckle_no=$2`,
      [rank, key],
    )).rows;
  } else {
    rows = (await pool.query(
      `SELECT staff_id FROM staff_members WHERE rank_code=$1 AND name_mr=$2`,
      [rank, key],
    )).rows;
    if (rows.length === 0) {
      rows = (await pool.query(
        `SELECT staff_id FROM staff_members WHERE rank_code=$1 AND (name_mr LIKE '%'||$2||'%' OR $2 LIKE '%'||name_mr||'%')`,
        [rank, key],
      )).rows;
    }
  }
  if (rows.length !== 1) {
    throw new Error(`seed: cannot uniquely resolve person ${rank}#${key} (matches=${rows.length})`);
  }
  staffCache.set(ck, rows[0].staff_id);
  return rows[0].staff_id;
}

// ---------- column-stack cell types ----------
type Cell =
  | { d: string; code?: string }              // label cell (d = text, code = duty_code when known)
  | { p: Person }                             // person cell
  | { t: string }                             // narrative/text cell
  | { d: string; code?: string; vac: true };  // post label with NO source person → रिक्त slot

async function emitColumn(
  pool: pg.Pool,
  chartId: number,
  shift: "DAY" | "NIGHT",
  col: number,
  cells: Cell[],
): Promise<void> {
  let ctx: { dutyId: number | null; title: string | null } = { dutyId: null, title: null };
  let order = 0;
  const dutyIdByCode = new Map<string, number>();
  for (const cell of cells) {
    order += 10;
    if ("d" in cell) {
      let dutyId: number | null = null;
      if (cell.code) {
        if (!dutyIdByCode.has(cell.code)) {
          const r = await pool.query(`SELECT duty_id FROM duty_definitions WHERE duty_code=$1`, [cell.code]);
          if (r.rows.length !== 1) throw new Error(`unknown duty_code ${cell.code}`);
          dutyIdByCode.set(cell.code, r.rows[0].duty_id);
        }
        dutyId = dutyIdByCode.get(cell.code)!;
        ctx = { dutyId, title: null };
      } else {
        // title-only label: emit the label row and KEEP the current duty context
        // (e.g. "एम.टी.सेक्षन कडील चालक" does not cancel "पंचवटी 1 मोबाईल").
        if (ctx.dutyId === null && ctx.title === null) ctx = { dutyId: null, title: cell.d };
      }
      const loc = await locationFor(pool, cell.code);
      await pool.query(
        `INSERT INTO daily_assignments
           (chart_id, shift, duty_id, duty_title_mr, location_id, allocation_state, sort_order, column_no, notes_mr)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [chartId, shift, dutyId ?? ctx.dutyId, cell.code ? null : cell.d, loc,
         "vac" in cell ? "VACANT_RIKT" : "ALLOCATED", order, col, null],
      );
      continue;
    }
    if ("p" in cell) {
      const [rank, key, note, flags] = cell.p;
      const staffId = await resolve(pool, rank, key);
      const f = (flags ?? "").split(",").filter(Boolean);
      const bima = f.includes("bima");
      const w = f.find((x) => x.startsWith("w="))?.slice(2);
      const [st, en] = w ? w.split("-") : [null, null];
      // The source cell's 3rd element is the chart's ROLE column (रायटर / ऑपरेटर /
      // (तपास)…) — typed into role_mr so the renderer can use it as the row label the
      // source prints, instead of echoing it after the name. Display only, never parsed.
      await pool.query(
        `INSERT INTO daily_assignments
           (chart_id, shift, duty_id, duty_title_mr, staff_id, allocation_state, is_bima,
            start_time, end_time, sort_order, column_no, role_mr)
         VALUES ($1,$2,$3,$4,$5,'ALLOCATED',$6,$7,$8,$9,$10,$11)`,
        [chartId, shift, ctx.dutyId, ctx.dutyId ? null : ctx.title, staffId, bima,
         st, en, order, col, note ?? null],
      );
      continue;
    }
    // narrative cell → assignment text row under current context (display only)
    await pool.query(
      `INSERT INTO daily_assignments
         (chart_id, shift, duty_id, duty_title_mr, allocation_state, sort_order, column_no, notes_mr)
       VALUES ($1,$2,$3,$4,'ALLOCATED',$5,$6,$7)`,
      [chartId, shift, ctx.dutyId, ctx.dutyId ? null : ctx.title, order, col, cell.t],
    );
  }
}

// A cell `code` may be either a location_code or a duty_code; duty codes carry their
// location in duty_definitions (NULL location = desk/post with no physical location).
async function locationFor(pool: pg.Pool, code?: string): Promise<number | null> {
  if (!code) return null;
  const loc = await pool.query(`SELECT location_id FROM locations WHERE location_code=$1`, [code]);
  if (loc.rows.length === 1) return loc.rows[0].location_id;
  const duty = await pool.query(`SELECT location_id FROM duty_definitions WHERE duty_code=$1`, [code]);
  if (duty.rows.length === 1) return duty.rows[0].location_id;
  throw new Error(`unknown location-or-duty code ${code}`);
}

async function locState(
  pool: pg.Pool, chartId: number, locCode: string, shift: "DAY" | "NIGHT",
  closed: boolean, chargeTo?: string,
): Promise<void> {
  const loc = await locationFor(pool, locCode);
  const dest = chargeTo ? await locationFor(pool, chargeTo) : null;
  await pool.query(
    `INSERT INTO location_operational_states
       (chart_id, location_id, shift, is_closed, charge_destination_location_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (chart_id, location_id, shift) DO UPDATE
       SET is_closed=EXCLUDED.is_closed,
           charge_destination_location_id=EXCLUDED.charge_destination_location_id`,
    [chartId, loc, shift, closed, dest],
  );
}

// ============================ DAY column stacks (Table 1) ============================
// col 1 — station
const DAY1: Cell[] = [
  { d: "(पंचवटी पो.स्टे.)", code: "DAY_STATION_LEADERSHIP" },
  { p: ["SR_PI", "गजेंद्र रघुनाथ पाटील"] },
  { p: ["PI", "सुनिल नारायण पवार", "(तपास)"] },
  { p: ["PI", "नितीन आबाजी आंधळे", "(प्रषा)"] },
  { p: ["PI", "सुधीर महादेव पाटील", "(गुन्हे)"] },
  { d: "ठाणे अंमलदार कक्ष देखरेख" },
  { p: ["PI", "सुनिल नारायण पवार", "(तपास)"] },
  { d: "(पंचवटी पो.स्टे.)" },
  { p: ["PROB_LPSI", "अर्चना संभाजी वाघ"] },
  { d: "ठाणे अंमलदार", code: "DAY_PSO" },
  { p: ["HC", "1452"] },
  { d: "हजरपाळी", code: "DAY_HAZARI" },
  { p: ["PC", "2571"] },
  { d: "CCTNS", code: "DAY_CCTNS" },
  { p: ["LHC", "2081"] },
  { d: "वायरलेस", code: "DAY_WIRELESS" },
  { p: ["LPC", "1421"] },
  { d: "पिटर मोबाईल", code: "DAY_PETER" },
  { p: ["DRIVER_PC", "1243"] },
  { p: ["PC", "2351"] },
  { d: "सी.आर.मोबाईल", code: "DAY_CR" },
  { p: ["PC", "297"] },
  { d: "डेल्टा मोबाईल", code: "DAY_DELTA" },
  { p: ["PC", "1709"] },
  { p: ["LPC", "852"] },
  { d: "गुन्हे शोध पथक/DB", code: "DAY_DB" },
  { p: ["HC", "1867"] },
  { p: ["PN", "607"] },
  { p: ["PC", "1881"] },
  { p: ["PC", "2144"] },
  { p: ["PC", "1345"] },
  { d: "पो.स्टे.लॉकअप गार्ड", code: "DAY_LOCKUP" },
  { p: ["LASI", "पदमा वामन गावित"] },
  { p: ["HC", "245"] },
  { p: ["LPC", "2829"] },
];

// col 2 — chowkis. The कारंजा "चौकी चा चार्ज काटया मारूती चौकी कडे" cell becomes a
// location_operational_state below (charge without closure — explicit independent facts).
const DAY2: Cell[] = [
  { d: "काटया मारूती पोलीस चौकी", code: "DAY_KATYA" },
  { p: ["API", "हेमंत विजय मोहिते", undefined, "w=09:00-14:00"] },
  { p: ["PC", "542", "रायटर"] },
  { p: ["PC", "1998", "रायटर"] },
  { p: ["HC", "2100"] },
  { d: "पंचवटी कारंजा पोलीस चौकी", code: "DAY_KARANJA" },
  { p: ["API", "प्रशांत रामदास बोरसे", undefined, "w=16:00-21:00"] },
  { d: "चौकी चा चार्ज काटया मारूती चौकी कडे" },  // rendered from loc state; kept visible (no-loss)
  { d: "मालेगांव स्टॅड चौकी", code: "DAY_MALEGAON" },
  { p: ["PC", "913", "रायटर"] },
  { p: ["HC", "509"] },
  { p: ["PC", "2272", undefined, "bima"] },
  { p: ["PC", "1244", undefined, "bima"] },
  { d: "सरदार पोलीस चौकी", code: "DAY_SARDAR" },
  { p: ["HC", "1045"] },
  { d: "फुलेनगर पोलीस चौकी", code: "DAY_PHULE" },
  { p: ["API", "शरद देविदास पाटील"] },
  { p: ["DRIVER_HC", "1126", "रायटर"] },
  { p: ["PC", "2914", "रायटर"] },
  { p: ["ASI", "सागर प्रभाकर कुलकर्णी"] },
  { p: ["PC", "2157", undefined, "bima"] },
  { p: ["PC", "2914", undefined, "bima"] },
  { d: "मेरी पोलीस चौकी", code: "DAY_MERI" },
  { p: ["HC", "680"] },
  { p: ["PC", "1644", undefined, "bima"] },
  { p: ["PC", "2312", undefined, "bima"] },
];

// col 3 — marshal posts + special duties (बंद/चार्ज cells → loc states below)
const DAY3: Cell[] = [
  { d: "काटया मारूती मार्शल", code: "DAY_MARSHAL_KATYA" },
  { d: "बंद" },
  { d: "मार्शल चा चार्ज मालेगाव स्टॅंन्ड कडे" },
  { d: "पंचवटी कारंजा मार्शल", code: "DAY_MARSHAL_KARANJA" },
  { d: "बंद" },
  { d: "मार्शल चा चार्ज मालेगाव स्टॅंन्ड कडे" },
  { d: "मालेगांव स्टंॅड मार्शल", code: "DAY_MARSHAL_MALEGAON" },
  { p: ["PC", "2272"] },
  { p: ["PC", "1244"] },
  { t: "Dial 112 MERS set" },
  { d: "फुले नगर मार्शल", code: "DAY_MARSHAL_PHULE" },
  { p: ["PC", "2157"] },
  { p: ["PC", "2914"] },
  { d: "मेरी मार्शल", code: "DAY_MARSHAL_MERI" },
  { p: ["PC", "1644"] },
  { p: ["PC", "2312"] },
  { t: "Dial 112 MERS set" },
  { d: "महिला कक्ष", code: "DAY_WOMEN_DESK" },
  { d: "वायरलेस महिला अंमलदार" },
  { d: "काळाराम मंदीर गार्ड ड्युटी", code: "DAY_KALARAM" },
  { p: ["ASI", "दत्तु बुधाजी शेळके"] },
  { p: ["LASI", "पुष्पा जगन चौधरी"] },
  // Source cell text corrected 2026-10-14: the seed carried the OCR garble
  // “ब्ण्ब्ण्ज्ण्छण्ैण्गुन्हे भरणे कामी”. The human-verified reconstruction (authority rank 2) has
  // this cell as “C.C.T.N.S गुन्हे भरणे कामी” (row 32, column D of
  // reference/EXCEL_RECONSTRUCTION/10th_sept_daily_duty_chart_page_1). The CCTNS token keeps the
  // AGENTS.md canonical form, the readable remainder is unchanged, and the string stays a
  // narrative cell that is echoed verbatim and NEVER parsed for meaning.
  { t: "CCTNS गुन्हे भरणे कामी" },
  { p: ["LHC", "1882"] },
  { p: ["LPC", "1136"] },
  { p: ["LPC", "2667"] },
  { d: "सायबर सेल", code: "DAY_CYBER" },
  { p: ["PC", "1434"] },
  { d: "पंचवटी 1 मोबाईल", code: "DAY_PANCHAVATI1" },
  { d: "एम.टी.सेक्षन कडील चालक" },
  { p: ["PROB_PSI", "प्रतिक राजेंद्रराव राऊत"] },
  { p: ["PC", "2553"] },
  { p: ["LPC", "2677"] },
  { p: ["LPC", "2203"] },
  { p: ["LPC", "2207"] },
  { p: ["LPC", "2666"] },
];

// col 4 — office/clerk desks. तपास॰रायटर and नगदी कारकुन have no person in the source
// flow (vac = रिक्त — a slot state, never a person). See OPEN_QUESTIONS T14 (नगदी vs mock).
const DAY4: Cell[] = [
  { d: "कार्यालयीन अंमलदार" },
  { d: "व.पो.नि.साो.रायटर", code: "OFFICE_WRITER" },
  { p: ["HC", "1347"] },
  { d: "पोनि.गुन्हे॰रायटर" },
  { p: ["PC", "2357"] },  // source: पोशि 2357 साबळे (Table 1 col4)
  { d: "पोनि.प्रशासन॰रायटर" },
  { p: ["HC", "936"] },
  { d: "पोनि.तपास॰रायटर", vac: true },
  { d: "नगदी कारकुन", code: "OFFICE_CASHIER", vac: true },
  { d: "मुद्देमाल कारकुन", code: "OFFICE_PROPERTY" },
  { p: ["HC", "1091"] },
  { d: "गोपनिय ड्युटी", code: "OFFICE_CONFIDENTIAL" },
  { p: ["HC", "1425"] },
  { p: ["PC", "2693"] },
  { p: ["PC", "2236"] },
  { d: "हजेरी मास्तर", code: "OFFICE_HAZARI_MASTER" },
  { p: ["HC", "692"] },
  { p: ["PC", "569"] },
  { p: ["LPC", "669"] },
  { d: "क्राईम कारकून", code: "OFFICE_CRIME" },
  { p: ["LHC", "2729"] },
  { p: ["LPC", "29"] },
  { d: "बारनिषी", code: "OFFICE_BARANISHI" },
  { p: ["LPC", "2639"] },
  { d: "MOB/मिसिंग", code: "OFFICE_MISSING" },
  { p: ["LPC", "2033"] },
  { p: ["LPC", "2626"] },
  { d: "मो.मिसिंग/ए.टी.सी.सेल", code: "OFFICE_ATC" },
  { p: ["HC", "2712"] },
  { p: ["PC", "2377"] },
  // “वॉरंन्ट”: the reconstruction writes the precomposed ॉ (U+0949); the seed's decomposed
  // “वाॅरंन्ट” rendered as a stray candra above a आ (user 2026-10-13: “fix this … ग्रीन अॅप”).
  { d: "वॉरंन्ट", code: "OFFICE_WARRANT" },
  { p: ["ASI", "सुनिल दशरथ सोळसे"] },
  { p: ["HC", "477"] },
  { d: "सेशन समन्स", code: "OFFICE_SESSION_SUMMONS" },
  { p: ["PC", "1020"] },
  { d: "समन्स", code: "OFFICE_SUMMONS" },
  { p: ["HC", "632"] },
  { p: ["PC", "2185"] },
];

// =========================== NIGHT column stacks (Table 2) ===========================
const NIGHT1: Cell[] = [
  { d: "(चेकिंग-1 )" },
  { d: "(पंचवटी पो.स्टे.)", code: "NIGHT_CHECKING_OFFICER" }, // station night context
  { p: ["API", "हेमंत विजय मोहिते"] },
  { d: "ठाणे अंमलदार", code: "NIGHT_PSO" },
  { p: ["ASI", "सुनिल पोपटराव शेवाळे"] },
  { d: "हजरपाळी", code: "NIGHT_HAZARI" },
  { p: ["PC", "1358"] },
  { p: ["PC", "2089"] },
  { d: "CCTNS", code: "NIGHT_CCTNS" },
  { p: ["LPC", "2198"] },
  { d: "वायरलेस", code: "NIGHT_WIRELESS" },
  { p: ["LPC", "2658"] },
  { d: "पिटर मोबाईल", code: "NIGHT_PETER" },
  { p: ["DRIVER_PC", "426"] },
  { p: ["HC", "97"] },
  { d: "सी.आर. मोबाईल", code: "NIGHT_CR" },
  { p: ["DRIVER_HC", "980"] },
  { p: ["PC", "2047"] },
  { t: "Dial 112 MERS set" },
  { d: "गुन्हे शोध पथक/DB", code: "NIGHT_DB" },
  { p: ["HC", "1558"] },
  { p: ["PC", "1025"] },
  { p: ["PC", "973"] },
  { p: ["PC", "2069"] },
  { p: ["PC", "597"] },
  { p: ["PC", "2517"] },
  { d: "पो.स्टे.लॉकअप गार्ड", code: "NIGHT_LOCKUP" },
  { p: ["LHC", "1726"] },
  { p: ["LPC", "2658"] },
  { p: ["PC", "2321"] },
];

const NIGHT2: Cell[] = [
  { d: "काटया मारूती पोलीस चौकी", code: "NIGHT_KATYA" },
  { p: ["HC", "2721"] },
  { d: "पंचवटी कारंजा पोलीस चौकी", code: "NIGHT_KARANJA" },
  { p: ["HC", "1717"] },
  { d: "मालेगांव स्टॅड चौकी", code: "NIGHT_MALEGAON" },
  { p: ["HC", "842"] },
  { p: ["PC", "2167", undefined, "bima"] },
  { p: ["PC", "769", undefined, "bima"] },
  { t: "Dial 112 MERS set" },
  { d: "सरदार पोलीस चौकी", code: "NIGHT_SARDAR" },
  { d: "चौकी चा चार्ज ेमालेगाव स्टॅंन्ड कडे" },  // source typo "े" preserved; state below
  { d: "फुलेनगर पोलीस चौकी", code: "NIGHT_PHULE" },
  { p: ["HC", "490"] },
  { d: "मेरी पोलीस चौकी", code: "NIGHT_MERI" },
  { p: ["HC", "1067"] },
  { p: ["PC", "1426", undefined, "bima"] },
  { p: ["PC", "2523", undefined, "bima"] },
  { t: "Dial 112 MERS set" },
  { d: "पंचवटी 1 मोबाईल", code: "NIGHT_PANCHAVATI1" },
  { p: ["PROB_PSI", "सुनिल सुधाकर ठेंग"] },
  { p: ["DRIVER_PC", "1036"] },
  { p: ["HC", "1089"] },
  { p: ["PC", "1836"] },
  { p: ["PC", "2239"] },
  { p: ["HOME_GUARD", "23685"] },
  { p: ["HOME_GUARD", "23613"] },
  { p: ["HOME_GUARD", "23638"] },
  { p: ["HOME_GUARD", "23605"] },
];

// col 3 night — marshal posts (बंद/चार्ज → states) then रामकुंड narrative → notices
const NIGHT3: Cell[] = [
  { d: "काटया मारूती मार्शल", code: "NIGHT_MARSHAL_KATYA" },
  { d: "बंद" },
  { d: "मार्शलचा चार्ज मालेगांव स्टॅड मार्शलकडे" },
  { d: "पंचवटी कारंजा मार्शल", code: "NIGHT_MARSHAL_KARANJA" },
  { d: "बंद" },
  { d: "मार्शलचा चार्ज मालेगांव स्टॅड मार्शलकडे" },
  { d: "मालेगांव स्टॅड मार्शल", code: "NIGHT_MARSHAL_MALEGAON" },
  { p: ["PC", "2167"] },
  { p: ["PC", "769"] },
  { d: "फुले नगर मार्शल", code: "NIGHT_MARSHAL_PHULE" },
  { d: "बंद" },
  { d: "मार्शलचा चार्ज मेरी मार्शलकडे" },
  { d: "मेरी मार्शल", code: "NIGHT_MARSHAL_MERI" },
  { p: ["PC", "1426"] },
  { p: ["PC", "2523"] },
  { t: "Dial 112 MERS set" },
  { d: "काळाराम मंदीर गार्ड ड्युटी", code: "NIGHT_KALARAM" },
  { p: ["HC", "1447"] },
  { p: ["HOME_GUARD", "23520"] },
];  // col 4 night — रात्रगस्त सुचना: label cells are notice groups; the four गुडमॉर्निंग
// स्कॉड names are real squad members (assignments under NIGHT_GOOD_MORNING).
const NIGHT4_CELLS: (Cell | { n: string; g?: string })[] = [
  { d: "रात्रगस्त सुचना" },
  { n: "गुडमॉर्निंग स्कॉड", g: "रात्रगस्त सुचना" },
  { n: "हद्दीतील सर्व बिट मार्शल", g: "रात्रगस्त सुचना" },
  { n: "त्यांचे त्यांचे कार्यक्षेत्रात", g: "रात्रगस्त सुचना" },
  { n: "गुडमॉर्निंग ड्युटी करतील.", g: "रात्रगस्त सुचना" },
  { d: "गुडमॉर्निग स्कॉड", code: "NIGHT_GOOD_MORNING" },
  { p: ["PC", "973"] },
  { p: ["PC", "2069"] },
  { p: ["PC", "597"] },
  { p: ["PC", "2517"] },
  { n: "सि.आर.॰ डि.बी.", g: "रात्रगस्त सुचना" },
  { n: "मोबाईल हे सर्व पुतळयांना", g: "रात्रगस्त सुचना" },
  { n: "भेटी देतील", g: "रात्रगस्त सुचना" },
  { d: "रात्रड्युटी सुचना" },
  { n: "चौकी ड्युटी अंमलदार हे", g: "रात्रड्युटी सुचना" },
  { n: "हददीत रात्रगस्त फिरतील", g: "रात्रड्युटी सुचना" },
  { n: "वरील प्रमाणे DB अंमलदार", g: "रात्रड्युटी सुचना" },
  { n: "बिट मार्शल हे गुडमॉर्नींग", g: "रात्रड्युटी सुचना" },
  { n: "फिरतील व रिपोर्ट पाठवुन", g: "रात्रड्युटी सुचना" },
  { n: "स्थळप्रत गोपनियकडे", g: "रात्रड्युटी सुचना" },
  { n: "देतील", g: "रात्रड्युटी सुचना" },
  { d: "महत्वाचे सुचना" },
  { n: "डीबी मोबाईल/ सीआर", g: "महत्वाचे सुचना" },
  { n: "मोबाईल आस्थापना बंद करून घेतील", g: "महत्वाचे सुचना" },
  { n: "मोबाईल आस्थापना बंद करून घेतील", g: "महत्वाचे सुचना" },
  // “ग्रीन ॲप”: the precomposed ॲ (U+0972) is what reference/SEMANTIC/Page 6.md and
  // docs/DOMAIN.md carry; the seed's decomposed अ+ॅ printed as two separate marks.
  { n: "रात्रपाळी चौकीचे अंमलदार आपआपले चौकी हद्दीतील ग्रीन ॲप करतील.", g: "ग्रीन ॲप" },
];

// रामकुंड narrative cells (night col 3 tail) — instruction text, chart-scoped notices.
const RAMKUND_NOTICES = [
  "रामकुंड",
  "सी.आर.॰ डी.बी.मोबाईल रामकुंड येथे",
  "भेट देतील.",
  "मार्केट यार्ड पोलीस मदत केंद्र",
  "मेरी मार्शल भेट देतील.",
  "मेरी मार्शल व डि.बी.मोबाईल वेळोवेळी",
  "भेट देतील.",
  "मार्केट यार्ड चौकी येथे मदत",
  "लागल्यास गुन्हेशोध पथकास संपर्क",
  "करतील.",
];

// ================================ availability (Table 3) ================================
type Av = [group: string, category: string, person: Person | null, detail?: string];
const AVAIL: Av[] = [
  // साप्ताहिक सुट्टी
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["PSI", "प्रकाश अभिमान नेमाणे"]],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["PSI", "पुंडलिक धोंडीराम पावसे"], "08/09"],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["PSI", "कैलास संतोश जाधव"], "22/08"],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["PROB_PSI", "अशोक संताराम दिंडे"]],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["HC", "443"]],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["HC", "2042"]],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["HC", "480"], "07/09"],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["PC", "67"]],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["PC", "2904"]],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["PC", "341"]],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["PC", "180"]],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["PC", "1457"]],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["PC", "2046"]],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["PC", "2759"]],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["PC", "530"]],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["PC", "2512"]],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["LHC", "1408"]],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["LHC", "1982"]],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["LPC", "2670"]],
  ["साप्ताहिक सुट्टी", "साप्ताहिक सुट्टी", ["LPC", "899"]],
  // किरकोळ रजा (typed where the source gives windows; detail always verbatim)
  ["किरकोळ रजा", "किरकोळ रजा", ["HC", "391"], "08 ते 10"],
  ["किरकोळ रजा", "किरकोळ रजा", ["HC", "742"], "08 ते 10"],
  ["किरकोळ रजा", "किरकोळ रजा", ["HC", "792"], "10"],
  ["किरकोळ रजा", "किरकोळ रजा", ["PC", "2137"], "09 व 10"],
  ["किरकोळ रजा", "किरकोळ रजा", ["LHC", "125"], "08 ते 12"],
  ["किरकोळ रजा", "किरकोळ रजा", ["LHC", "1617"], "09 ते 12"],
  ["किरकोळ रजा", "किरकोळ रजा", ["LHC", "1819"], "10 ते 11"],
  ["किरकोळ रजा", "किरकोळ रजा", ["LPC", "2912"], "10 ते 11"],
  ["किरकोळ रजा", "किरकोळ रजा", ["LPC", "641"], "10 ते 11"],
  ["किरकोळ रजा", "किरकोळ रजा", ["LPC", "2679"], "10"],
  ["किरकोळ रजा", "तपासकामी - गुजरात राज्य", ["API", "सतिश नामदेव शिरसाठ"]],
  ["किरकोळ रजा", "तपासकामी - गुजरात राज्य", ["PC", "2271"]],
  ["किरकोळ रजा", "तपासकामी - गुजरात राज्य", ["PC", "2394"]],
  ["किरकोळ रजा", "तपासकामी - गुजरात राज्य", ["PC", "352"]],
  ["किरकोळ रजा", "तपासकामी - गुजरात राज्य", ["PC", "2507"]],
  ["किरकोळ रजा", "तपासकामी - सातारा", ["PSI", "सचिन अरूण चव्हाण"]],
  ["किरकोळ रजा", "तपासकामी - सातारा", ["PC", "2073"]],
  ["किरकोळ रजा", "तपासकामी - सातारा", ["PC", "2385"]],
  ["किरकोळ रजा", "प्रशिक्षण", null, "डी.टी.एस.॰नाशिक · दिनांक 10 व 11/09/2026"],
  ["किरकोळ रजा", "प्रशिक्षण", ["PC", "2440"], "दिनांक 10 व 11/09/2026"],
  // अर्जित रजा + sub-groups
  ["अर्जित रजा", "अर्जित रजा", ["HC", "1693"], "28/08 ते 11/09"],
  ["अर्जित रजा", "हायकोर्ट - मुंबई", null],           // category present, nobody listed (source)
  ["अर्जित रजा", "सिक", ["PC", "106"], "11/08 पासुन"],
  ["अर्जित रजा", "सिक", ["LPC", "1559"], "30/08 पासुन"],
  ["अर्जित रजा", "प्रसुती रजा", ["LPC", "2671"], "22/06 ते 18/12"],
  ["अर्जित रजा", "बाल संगोपन रजा", ["LPC", "2208"], "18/08 ते 16/10"],
  ["अर्जित रजा", "गैरहजर", ["HC", "1761"], "05/08 पासुन"],
  ["अर्जित रजा", "गैरहजर", ["PC", "1474"], "23/07 पासुन"],
  ["अर्जित रजा", "पो.स्टे.रिझर्व्ह", ["GRADE_PSI", "अशोक काकड"]],
  // इतर ड्युटी
  ["इतर ड्युटी", "प्रतिनियुक्ती", null],
  ["इतर ड्युटी", "मा.सपोआ.साो.पं.वि कार्या.", ["HC", "416"]],
  ["इतर ड्युटी", "मा.सपोआ.साो.पं.वि कार्या.", ["HC", "2502"]],
  ["इतर ड्युटी", "मा.सपोआ.साो.पं.वि कार्या.", ["HC", "531"]],
  ["इतर ड्युटी", "मा.सपोआ.साो.पं.वि कार्या.", ["PC", "2539"]],
  ["इतर ड्युटी", "मा.पो.उप.आ.परि.1 कार्यालय", ["HC", "1381"]],
  ["इतर ड्युटी", "मा.पो.उप.आ.परि.1 कार्यालय", ["PC", "2548"]],
  ["इतर ड्युटी", "पंचवटी निर्भया पथक", ["LPC", "1006"]],
  ["इतर ड्युटी", "पंचवटी निर्भया पथक", ["LPC", "1858"]],
  ["इतर ड्युटी", "मिसिंग सेल कामी", ["LASI", "राठोड"]],
  ["इतर ड्युटी", "मिसिंग सेल कामी", ["LHC", "1734"]],
  ["इतर ड्युटी", "पंचवटी दामिनी पथक", ["LPC", "2699"]],
  ["इतर ड्युटी", "पंचवटी दामिनी पथक", ["LPC", "1061"]],
  ["इतर ड्युटी", "पंचवटी दामिनी पथक", ["LPC", "1799"]],
  ["इतर ड्युटी", "पंचवटी दामिनी पथक", ["LPC", "39"]],
  ["इतर ड्युटी", "मा.सेशन कोर्ट पैरवी", ["HC", "500"]],
  ["इतर ड्युटी", "मा.JMFC कोर्ट पैरवी", ["PC", "1996"]],
  ["इतर ड्युटी", "मा.JMFC कोर्ट पैरवी", ["LPC", "1014"]],
  ["इतर ड्युटी", "जिल्हा व सत्र कोर्ट॰नाशिक", null, "येथे सुरक्षा बंदोबस्तकामी"],
  ["इतर ड्युटी", "वाघ जाप्ता", ["PC", "2149"]],
];

// ============================== matrix / summaries (Table 4–7) ==============================
const MX_COLS = ["PI","API","PSI","GPS","ASI","LASI","LASI#2","HC","LHC","PN","LPN","PC","LPC","OFFICE","ME"];
// value_text verbatim from source (.. and all); never recalculated (N4/N5).
const MX: [row: string, vals: string[]][] = [
  ["मंजूर संख्याबळ", ["02","04","03","..","11","11","11","46","46","53","53","123","123","09","233"]],
  // “हजर मनुष्यबळ” and “12<br>04 Pro.” — the seed's “मनुश्यबळ” and the OCR tail “Proण्” are
  // corrected against reference/SEMANTIC/Page 4.md (line item “हजर मनुष्यबळ”, `12` “(+4 Pro)”)
  // and 16.md, which reads “12<br>04 Pro.”. The <br> is the source's own line break inside the
  // cell and is rendered as one by the matrix (never printed as a literal tag).
  ["हजर मनुष्यबळ", ["04","04","08","01","04","04","03","38","10","01","00","63","31","12<br>04 Pro.","151"]],
  ["मा.DCPएACP कार्या. प्रतिनियुक्ती", ["..","..","00","..","..","..","..","03","02","","","04","2","00","12"]],
  ["अंगरक्षक/जाप्ता", ["..","..","..","..","..","..","..","..","..","..","..","..","..","..","01"]],
  ["मा. कोर्ट /पैरवी", ["..","..","..","..","..","..","..","..","..","..","..","..","..","..","03"]],
  ["सिक", ["..","..","..","..","..","..","..","..","..","..","..","..","..","..",".."]],
  ["से.नि/बा.संगोपन", ["..","..","..","..","..","..","..","..","..","..","..","..","..","..","01"]],
  ["उजळणी कोर्स", ["..","..","..","..","..","..","..","..","..","..","..","..","..","..",".."]],
  ["पो.मु./पोस्टे/ स्पोर्ट", ["..","..","..","..","..","..","..","..","..","..","..","..","..","..",".."]],
  ["तपासकामी / वॉरंट", ["..","..","..","..","..","..","..","..","..","..","..","..","..","..",".."]],
  ["अर्जित रजा", ["..","..","..","..","01","01","..","..","..","..","..","..","02","..","03"]],
  ["किरकोळ रजा", ["..","..","..","..","..","..","..","..","..","..","..","..","01","..","01"]],
  ["साप्ताहिक सुट्टी", ["..","..","03","..","..","..","..","03","02","..","..","14","02","03","21"]],
  ["बाहेर बंदोबस्त", ["..","..","..","..","..","..","..","..","..","..","..","..","..","..",".."]],
  ["मा. हायकोर्ट॰मुंबई", ["..","..","..","..","..","..","..","..","..","..","..","..","..","..",".."]],
  ["दिवस व रात्रकरिता प्रत्यक्ष हजर", ["03","","","","","","","","","","","","","",""]],
];

// Table 9 — officer duty summary (15 rows, verbatim display text)
const OFFICERS: [string, string][] = [
  ["पो.नि.सुनिल पवार (गुन्हे)", "उपस्थित"],
  ["पो.नि.सुधीर पाटील", "उपस्थित"],
  ["पो.नि.नितीन आंधळे", "उपस्थित"],
  ["स.पो.नि.शरद पाटील", "उपस्थित"],
  ["स.पो.नि.सतिश शिरसाठ", "उपस्थित"],
  ["स.पो.नि.हेमंत मोहिते", "9 ते 14 व नाईट"],
  ["स.पो.नि.प्रशांत बोरसे", "उपस्थित"],
  ["पो.उ.नि.कैलास जाधव", "साप्ताहिक सुट्टी"],
  ["पो.उ.नि.प्रकाश नेमाणे", "साप्ताहिक सुट्टी"],
  ["पो.उ.नि.सचिन चव्हाण", "उपस्थित"],
  ["पो.उ.नि पुंडलिक पावसे", "साप्ताहिक सुट्टी"],
  ["परि.म.पो.उ.नि.अर्चना वाघ", "डे पि.एस.ओ."],
  ["परि.पोउनि.प्रतिक राऊत", "पंचवटी 1 मोबाईल - दिवसपाळी"],
  ["परि.पोउनि.सुनिल ठेंग", "पंचवटी 1 मोबाईल - रात्रपाळी"],
  ["परि.पोउनि.अशोक दिंडे", "साप्ताहिक सुट्टी"],
];

// Table 12 — hourly scan staff (12 rows; windows/chowkis mirror scan_schedule_config seq)
const SCAN12: [seq: number, person: Person][] = [
  [1, ["PC", "2357"]], [2, ["LPC", "669"]], [3, ["LHC", "2729"]], [4, ["LPC", "29"]],
  [5, ["LPC", "2639"]], [6, ["LPC", "2033"]], [7, ["LPC", "2626"]], [8, ["HC", "2712"]],
  [9, ["PC", "2377"]], [10, ["LPC", "1136"]], [11, ["LPC", "2667"]], [12, ["PC", "1434"]],
];

// ================================ main ================================
export async function seedChart1009(pool: pg.Pool): Promise<void> {
  staffCache.clear();
  const tv = await pool.query(
    `SELECT template_version_id FROM template_versions ORDER BY template_version_id LIMIT 1`);
  if (tv.rows.length !== 1) throw new Error("no template version — run db:seed:reference first");

  await pool.query(
    `INSERT INTO daily_charts (chart_date, lifecycle, template_version_id)
     VALUES ($1,'DRAFT',$2) ON CONFLICT (chart_date) DO NOTHING`,
    [DATE, tv.rows[0].template_version_id],
  );
  const chart = await pool.query(`SELECT chart_id FROM daily_charts WHERE chart_date=$1`, [DATE]);
  const chartId: number = chart.rows[0].chart_id;

  // Idempotency = wipe-and-reseed (never half-seed): chart-owned rows are replaced
  // wholesale so a previously failed run cannot leave partial data behind. Refuses to
  // touch a non-DRAFT chart (immutability rules still hold for FINALIZED snapshots).
  // A DEPLOYED demo must never lose the clerk's edits to a redeploy: the blueprint sets
  // PANCHAVATI_KEEP_EXISTING=1, and this run then leaves an already-populated chart alone
  // (fresh databases still get the full chart). Local runs keep the documented wipe-and-reseed.
  //
  // ORDER MATTERS: this guard comes BEFORE the lifecycle check below. A demo chart the clerk has
  // FINALIZED is populated *and* non-DRAFT; checked the other way round it threw, the seed exited 1,
  // and the Render start command (`db:migrate && db:seed && start`) never reached `start` — the deploy
  // failed with "no open ports detected". Keep-existing first, immutability second.
  if (process.env.PANCHAVATI_KEEP_EXISTING === "1") {
    const existing = await pool.query(`SELECT count(*) AS n FROM daily_assignments WHERE chart_id=$1`, [chartId]);
    if (Number(existing.rows[0].n) > 0) {
      const cur = await pool.query(`SELECT lifecycle FROM daily_charts WHERE chart_id=$1`, [chartId]);
      console.log(`· chart ${DATE} already seeded (${existing.rows[0].n} assignments, ${cur.rows[0].lifecycle}) — left untouched (PANCHAVATI_KEEP_EXISTING=1)`);
      return;
    }
  }
  const lc = await pool.query(`SELECT lifecycle FROM daily_charts WHERE chart_id=$1`, [chartId]);
  if (lc.rows[0].lifecycle !== "DRAFT") {
    throw new Error(`chart ${DATE} is ${lc.rows[0].lifecycle} — refusing to reseed a non-DRAFT chart`);
  }
  for (const tbl of [
    "daily_assignments", "daily_availabilities", "location_operational_states",
    "chart_notices", "manpower_records", "shift_summary_cells",
    "sudden_duty_changes", "officer_summary_rows", "scan_schedule_daily",
  ]) {
    await pool.query(`DELETE FROM ${tbl} WHERE chart_id=$1`, [chartId]);
  }

  await emitColumn(pool, chartId, "DAY", 1, DAY1);
  await emitColumn(pool, chartId, "DAY", 2, DAY2);
  await emitColumn(pool, chartId, "DAY", 3, DAY3);
  await emitColumn(pool, chartId, "DAY", 4, DAY4);
  await emitColumn(pool, chartId, "NIGHT", 1, NIGHT1);
  await emitColumn(pool, chartId, "NIGHT", 2, NIGHT2);
  await emitColumn(pool, chartId, "NIGHT", 3, NIGHT3);

  // Explicit operational states (source cells ARE the facts — three-fact distinction):
  await locState(pool, chartId, "MARSHAL_KATYA_MARUTI", "DAY", true, "MARSHAL_MALEGAON_STAND");
  await locState(pool, chartId, "MARSHAL_KARANJA", "DAY", true, "MARSHAL_MALEGAON_STAND");
  await locState(pool, chartId, "CHOWKI_KARANJA", "DAY", false, "CHOWKI_KATYA_MARUTI");
  await locState(pool, chartId, "MARSHAL_KATYA_MARUTI", "NIGHT", true, "MARSHAL_MALEGAON_STAND");
  await locState(pool, chartId, "MARSHAL_KARANJA", "NIGHT", true, "MARSHAL_MALEGAON_STAND");
  await locState(pool, chartId, "MARSHAL_PHULENAGAR", "NIGHT", true, "MARSHAL_MERI");
  await locState(pool, chartId, "CHOWKI_SARDAR", "NIGHT", true, "CHOWKI_MALEGAON_STAND");

  // Night notices (NIGHT4) + रामकुंड narrative (night col3 tail)
  let nOrder = 0;
  let noticeGroup: string | null = null;
  for (const cell of NIGHT4_CELLS) {
    if ("d" in cell) { noticeGroup = cell.d; continue; }
    if ("n" in cell) {
      await pool.query(
        `INSERT INTO chart_notices (chart_id, group_key, sort_order, text_mr) VALUES ($1,$2,$3,$4)`,
        [chartId, cell.g ?? noticeGroup, ++nOrder, cell.n]);
    }
  }
  for (const text of RAMKUND_NOTICES) {
    await pool.query(
      `INSERT INTO chart_notices (chart_id, group_key, sort_order, text_mr) VALUES ($1,$2,$3,$4)`,
      [chartId, "रामकुंड पेट्रोलिंग", ++nOrder, text]);
  }

  // Availability (Table 3) — group = rendered column, category = sub-group label
  let aOrder = 0;
  for (const [group, category, person, detail] of AVAIL) {
    const staffId = person ? await resolve(pool, person[0], person[1]) : null;
    // typed windows only for unambiguous date-range forms; detail stays verbatim
    let ws: string | null = null, we: string | null = null;
    if (detail) {
      const range = detail.match(/^(\d{2})\/(\d{2}) ते (\d{2})\/(\d{2})$/);
      const since = detail.match(/^(\d{2})\/(\d{2}) पासुन$/);
      if (range) { ws = `2026-${range[2]}-${range[1]}`; we = `2026-${range[4]}-${range[3]}`; }
      else if (since) { ws = `2026-${since[2]}-${since[1]}`; }
    }
    await pool.query(
      `INSERT INTO daily_availabilities
         (chart_id, staff_id, category, group_key, window_start, window_end, detail_mr, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [chartId, staffId, category, group, ws, we, detail ?? null, ++aOrder],
    );
  }

  // Manpower matrix (Table 4) — verbatim values, stored authoritative (never recalculated)
  for (const [mIdx, [row, vals]] of MX.entries()) {
    if (vals.length !== MX_COLS.length) throw new Error(`matrix row ${row}: ${vals.length} cells`);
    for (let i = 0; i < MX_COLS.length; i++) {
      await pool.query(
        `INSERT INTO manpower_records (chart_id, row_key, column_key, value_text, display_order)
         VALUES ($1,$2,$3,$4,$5)`, [chartId, row, MX_COLS[i], vals[i], mIdx * 10]);
    }
  }

  // Shift summaries (Tables 5–7) — source shows blank; blanks are still represented
  for (const key of ["DAY", "NIGHT", "OTHER"]) {
    for (const col of ["अधिकारी", "अंमलदार", "महिला अंमलदार", "एकूण"]) {
      await pool.query(
        `INSERT INTO shift_summary_cells (chart_id, summary_key, column_key, value_text)
         VALUES ($1,$2,$3,'')`, [chartId, key, col]);
    }
  }

  // Sudden change ledger (Table 8 — one blank numbered row in source)
  await pool.query(
    `INSERT INTO sudden_duty_changes (chart_id, seq, detail_mr) VALUES ($1,1,'')`, [chartId]);

  // Officer duty summary (Table 9)
  for (const [i, [officer, duty]] of OFFICERS.entries()) {
    await pool.query(
      `INSERT INTO officer_summary_rows (chart_id, row_no, officer_text, duty_text)
       VALUES ($1,$2,$3,$4)`, [chartId, i + 1, officer, duty]);
  }

  // Hourly scan staff (Table 12)
  for (const [seq, person] of SCAN12) {
    const staffId = await resolve(pool, person[0], person[1]);
    const win = await pool.query(
      `SELECT start_time, end_time FROM scan_schedule_config
        WHERE session_code='SCAN_HOURLY' AND sequence=$1`, [seq]);
    if (win.rows.length !== 1) throw new Error(`scan config seq ${seq} missing`);
    await pool.query(
      `INSERT INTO scan_schedule_daily (chart_id, session_code, sequence, start_time, end_time, staff_id)
       VALUES ($1,'SCAN_HOURLY',$2,$3,$4,$5)`,
      [chartId, seq, win.rows[0].start_time, win.rows[0].end_time, staffId]);
  }

  const stats = await pool.query(`SELECT
    (SELECT count(*) FROM daily_assignments WHERE chart_id=$1) AS assignments,
    (SELECT count(*) FROM daily_assignments WHERE chart_id=$1 AND is_bima) AS bima,
    (SELECT count(*) FROM daily_assignments WHERE chart_id=$1 AND allocation_state='VACANT_RIKT') AS vacant,
    (SELECT count(*) FROM daily_availabilities WHERE chart_id=$1) AS availability,
    (SELECT count(*) FROM location_operational_states WHERE chart_id=$1) AS loc_states,
    (SELECT count(*) FROM chart_notices WHERE chart_id=$1) AS notices,
    (SELECT count(*) FROM manpower_records WHERE chart_id=$1) AS matrix_cells,
    (SELECT count(*) FROM officer_summary_rows WHERE chart_id=$1) AS officer_rows,
    (SELECT count(*) FROM scan_schedule_daily WHERE chart_id=$1) AS scan_rows`,
    [chartId]);
  console.log(`✔ chart ${DATE}: ${JSON.stringify(stats.rows[0])}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const target = isTestRun() ? TEST_DB : DEV_DB;
  const pool = makePool(target);
  try {
    await seedChart1009(pool);
  } finally {
    await pool.end();
  }
}
