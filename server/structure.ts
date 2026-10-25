// Purpose: chart-local STRUCTURE edits — the clerk's own tables, matrix columns and typed cells.
// Current role: Fastify route + domain mutation for presentation_overrides (validated, narrow).
// Last meaningful change: 2026-10-13 — created with the "everything CRUDable" round (item 11).
// Constraint/dependency: AGENTS.md hard rules — per-chart overrides only (never the pinned
//   template, never a master); enumerated operations with bounded sizes; no HTML/CSS/JS ever
//   stored; FINALIZED is immutable (amendment = new version).
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import type { Queryable } from "./chart-document.js";

/** A table the CLERK owns (not source data): title, column headers, rows, cell text. */
export interface FreeTable {
  id: string;
  title: string;
  columns: string[];
  rows: string[][];
}

export interface StructureOverrides {
  tables?: FreeTable[];
  matrix?: {
    addedColumns?: { key: string; label: string }[];
    hiddenColumns?: string[];
    cells?: Record<string, string>;
  };
}

export class StructureError extends Error {
  constructor(message: string, public readonly statusCode: 400 | 404 | 409) {
    super(message);
    this.name = "StructureError";
  }
}

const MAX_TABLES = 8;
const MAX_COLUMNS = 8;
const MAX_ROWS = 60;
const MAX_CELL = 300;
const MAX_TITLE = 120;
const DANGEROUS = new Set(["__proto__", "prototype", "constructor"]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Free text the clerk typed: trimmed, length-bounded, no control characters, no angle brackets. */
function safeText(value: unknown, max: number, label: string): string {
  const text = String(value ?? "").trim();
  if (text.length > max) throw new StructureError(`${label} खूप मोठा आहे (कमाल ${max} अक्षरे)`, 400);
  if (/[\u0000-\u001f\u007f<>]/.test(text)) throw new StructureError(`${label} मध्ये अवैध अक्षरे आहेत`, 400);
  return text;
}

function safeId(value: unknown): string {
  const id = String(value ?? "").trim();
  if (!/^[A-Za-z0-9-]{1,40}$/.test(id)) throw new StructureError("अवैध तक्ता आयडी", 400);
  return id;
}

function tablesOf(overrides: Record<string, unknown>): FreeTable[] {
  const st = isRecord(overrides.structure) ? overrides.structure as StructureOverrides : {};
  return Array.isArray(st.tables) ? st.tables : [];
}

/** Pure merge of ONE enumerated structure operation into a chart's overrides. Never mutates the
 *  input. Every branch either throws (invalid input) or returns a new overrides object. */
export function applyStructureOp(
  overrides: Record<string, unknown>, input: unknown,
): Record<string, unknown> {
  if (!isRecord(input)) throw new StructureError("structure body must be an object", 400);
  const op = String(input.op ?? "");
  const st: StructureOverrides = isRecord(overrides.structure)
    ? { ...(overrides.structure as StructureOverrides) } : {};
  const tables = tablesOf(overrides).map((t) => ({ ...t, columns: [...t.columns], rows: t.rows.map((r) => [...r]) }));
  const find = (id: string): FreeTable => {
    const t = tables.find((x) => x.id === id);
    if (!t) throw new StructureError(`तक्ता सापडला नाही: ${id}`, 404);
    return t;
  };
  const put = (): Record<string, unknown> => ({ ...overrides, structure: { ...st, tables } });

  switch (op) {
    case "table.add": {
      if (tables.length >= MAX_TABLES) throw new StructureError(`कमाल ${MAX_TABLES} तक्ते`, 400);
      const title = safeText(input.title, MAX_TITLE, "तक्त्याचे नाव");
      if (title === "") throw new StructureError("तक्त्याचे नाव आवश्यक आहे", 400);
      const given = Array.isArray(input.columns) ? input.columns : [];
      const columns = given.slice(0, MAX_COLUMNS).map((c) => safeText(c, 60, "स्तंभ शीर्षक") || "स्तंभ");
      const finalColumns = columns.length ? columns : ["तपशील"];
      tables.push({
        id: randomUUID(),
        title,
        columns: finalColumns,
        // one empty row with one cell per column: the clerk types into it (never fake content)
        rows: [finalColumns.map(() => "")],
      });
      return put();
    }
    case "table.remove": {
      const id = safeId(input.id);
      find(id);
      const rest = tables.filter((t) => t.id !== id);
      return { ...overrides, structure: { ...st, tables: rest } };
    }
    case "table.title": {
      const t = find(safeId(input.id));
      const text = safeText(input.text, MAX_TITLE, "तक्त्याचे नाव");
      if (text === "") throw new StructureError("तक्त्याचे नाव आवश्यक आहे", 400);
      t.title = text;
      return put();
    }
    case "table.col.add": {
      const t = find(safeId(input.id));
      if (t.columns.length >= MAX_COLUMNS) throw new StructureError(`कमाल ${MAX_COLUMNS} स्तंभ`, 400);
      t.columns.push(safeText(input.text, 60, "स्तंभ शीर्षक") || "स्तंभ");
      t.rows.forEach((r) => r.push(""));
      return put();
    }
    case "table.col.remove": {
      const t = find(safeId(input.id));
      const i = Number(input.index);
      if (!Number.isInteger(i) || i < 0 || i >= t.columns.length) throw new StructureError("स्तंभ क्रमांक चुकीचा", 400);
      if (t.columns.length <= 1) throw new StructureError("शेवटचा स्तंभ काढता येत नाही", 400);
      t.columns.splice(i, 1);
      t.rows.forEach((r) => r.splice(i, 1));
      return put();
    }
    case "table.col.label": {
      const t = find(safeId(input.id));
      const i = Number(input.index);
      if (!Number.isInteger(i) || i < 0 || i >= t.columns.length) throw new StructureError("स्तंभ क्रमांक चुकीचा", 400);
      t.columns[i] = safeText(input.text, 60, "स्तंभ शीर्षक") || "स्तंभ";
      return put();
    }
    case "table.row.add": {
      const t = find(safeId(input.id));
      if (t.rows.length >= MAX_ROWS) throw new StructureError(`कमाल ${MAX_ROWS} ओळी`, 400);
      t.rows.push(t.columns.map(() => ""));
      return put();
    }
    case "table.row.remove": {
      const t = find(safeId(input.id));
      const i = Number(input.index);
      if (!Number.isInteger(i) || i < 0 || i >= t.rows.length) throw new StructureError("ओळ क्रमांक चुकीचा", 400);
      if (t.rows.length <= 1) throw new StructureError("शेवटची ओळ काढता येत नाही", 400);
      t.rows.splice(i, 1);
      return put();
    }
    case "table.cell": {
      const t = find(safeId(input.id));
      const r = Number(input.row), c = Number(input.col);
      if (!Number.isInteger(r) || r < 0 || r >= t.rows.length) throw new StructureError("ओळ क्रमांक चुकीचा", 400);
      if (!Number.isInteger(c) || c < 0 || c >= t.columns.length) throw new StructureError("स्तंभ क्रमांक चुकीचा", 400);
      t.rows[r][c] = safeText(input.text, MAX_CELL, "मजकूर");
      return put();
    }
    case "matrix.column.add": {
      const label = safeText(input.label, 40, "स्तंभ शीर्षक");
      if (label === "") throw new StructureError("स्तंभ शीर्षक आवश्यक आहे", 400);
      const matrix = { ...(st.matrix ?? {}) };
      const added = [...(matrix.addedColumns ?? [])];
      if (added.length >= MAX_COLUMNS) throw new StructureError(`कमाल ${MAX_COLUMNS} नवीन स्तंभ`, 400);
      added.push({ key: `ADD_${randomUUID().slice(0, 8).toUpperCase()}`, label });
      matrix.addedColumns = added;
      return { ...overrides, structure: { ...st, matrix } };
    }
    case "matrix.column.remove":
    case "matrix.column.hide": {
      const key = String(input.key ?? "").trim();
      if (!/^[A-Za-z0-9_#]{1,40}$/.test(key)) throw new StructureError("अवैध स्तंभ की", 400);
      const matrix = { ...(st.matrix ?? {}) };
      if (op === "matrix.column.remove") {
        matrix.addedColumns = (matrix.addedColumns ?? []).filter((c) => c.key !== key);
        const cells = { ...(matrix.cells ?? {}) };
        Object.keys(cells).forEach((k) => { if (k.endsWith(`|${key}`)) delete cells[k]; });
        if (Object.keys(cells).length) matrix.cells = cells; else delete matrix.cells;
      } else {
        const hidden = new Set(matrix.hiddenColumns ?? []);
        hidden.add(key);
        matrix.hiddenColumns = [...hidden];
      }
      return { ...overrides, structure: { ...st, matrix } };
    }
    case "matrix.cell": {
      const key = String(input.key ?? "").trim();
      if (!/^[^|<>]{1,80}\|[A-Za-z0-9_#]{1,40}$/.test(key)) throw new StructureError("अवैध सेल की", 400);
      const matrix = { ...(st.matrix ?? {}) };
      const cells = { ...(matrix.cells ?? {}) };
      const text = safeText(input.text, 40, "आकडा");
      if (text === "") delete cells[key]; else cells[key] = text;
      if (Object.keys(cells).length) matrix.cells = cells; else delete matrix.cells;
      return { ...overrides, structure: { ...st, matrix } };
    }
    default:
      throw new StructureError(`अज्ञात क्रिया: ${op || "(रिक्त)"}`, 400);
  }
}

/** One author-owned VALUE (a sign-off line …): chart-local text keyed by the element key. */
export function applyValueEdit(
  overrides: Record<string, unknown>, input: unknown,
): Record<string, unknown> {
  if (!isRecord(input)) throw new StructureError("values body must be an object", 400);
  const key = String(input.key ?? "").trim();
  if (key === "" || key.length > 240 || /[<>\u0000-\u001f]/.test(key)
    || key.split(".").some((p) => DANGEROUS.has(p))) {
    throw new StructureError("अवैध की", 400);
  }
  const text = safeText(input.text, MAX_CELL, "मजकूर");
  const values = { ...((overrides.values as Record<string, string>) ?? {}) };
  if (text === "") delete values[key]; else values[key] = text;
  const next = { ...overrides };
  if (Object.keys(values).length) next.values = values; else delete next.values;
  return next;
}

function chartLock(db: Queryable, date: string) {
  return db.query(
    `SELECT chart_id, lifecycle, presentation_overrides FROM daily_charts
      WHERE chart_date = $1 FOR UPDATE`, [date]);
}

async function withChart<T>(
  db: Queryable, date: string, mutate: (overrides: Record<string, unknown>) => Record<string, unknown>,
): Promise<T> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new StructureError("date must be YYYY-MM-DD", 400);
  const ownsTx = !("release" in db);
  const client = ownsTx ? await (db as pg.Pool).connect() : db as pg.PoolClient;
  try {
    if (ownsTx) await client.query("BEGIN");
    const rows = (await chartLock(client, date)).rows;
    if (rows.length !== 1) throw new StructureError(`no chart for ${date}`, 404);
    if (rows[0].lifecycle === "FINALIZED") {
      throw new StructureError("FINALIZED charts are immutable; use amendment", 409);
    }
    const next = mutate((rows[0].presentation_overrides as Record<string, unknown>) ?? {});
    const upd = (await client.query(
      `UPDATE daily_charts SET presentation_overrides = $1 WHERE chart_id = $2
        RETURNING presentation_overrides`, [next, rows[0].chart_id])).rows[0];
    if (ownsTx) await client.query("COMMIT");
    return upd.presentation_overrides as T;
  } catch (error) {
    if (ownsTx) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (ownsTx) client.release();
  }
}

export function patchChartStructure(db: Queryable, date: string, input: unknown) {
  return withChart(db, date, (ov) => applyStructureOp(ov, input));
}

export function patchChartValues(db: Queryable, date: string, input: unknown) {
  return withChart(db, date, (ov) => applyValueEdit(ov, input));
}

const replyFor = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, error: unknown) => {
  if (error instanceof StructureError) return reply.code(error.statusCode).send({ error: error.message });
  throw error;
};

export function registerStructureRoutes(app: FastifyInstance, db: Queryable): void {
  app.patch("/api/charts/:date/structure", async (req, reply) => {
    const { date } = req.params as { date: string };
    try {
      return { ok: true, presentation_overrides: await patchChartStructure(db, date, req.body) };
    } catch (error) { return replyFor(reply, error); }
  });
  app.patch("/api/charts/:date/values", async (req, reply) => {
    const { date } = req.params as { date: string };
    try {
      return { ok: true, presentation_overrides: await patchChartValues(db, date, req.body) };
    } catch (error) { return replyFor(reply, error); }
  });
}
