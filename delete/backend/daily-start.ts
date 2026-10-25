// Purpose: Idempotently open a browser-selected day with an empty chart.
// Current role: POST bootstrap and shared date validation; no personnel decisions.
// Last meaningful change: 2026-10-18 — empty-day initialization.
// Constraint: Existing charts, snapshots and source dates are never updated or reseeded.
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { getSnapshot, projectChart, type ChartDocument, type Queryable } from "./chart-document.js";

export class DailyStartError extends Error {
  constructor(message: string, public readonly statusCode: 400 | 404 | 409) {
    super(message);
    this.name = "DailyStartError";
  }
}

/** The caller supplies the browser-local calendar date, not a server/UTC "today". */
export function dailyDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) {
    throw new DailyStartError("date must be YYYY-MM-DD", 400);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new DailyStartError("date must be a valid calendar date", 400);
  }
  return value;
}

export interface DailyStartResult {
  ok: true;
  created: boolean;
  document: ChartDocument;
}

/** Pool calls own a transaction; a supplied transaction client remains caller-owned. */
export async function ensureDailyDraft(db: Queryable, date: string): Promise<DailyStartResult> {
  dailyDate(date);
  const ownsTx = !("release" in db);
  const client = ownsTx ? await (db as pg.Pool).connect() : db as pg.PoolClient;
  try {
    if (ownsTx) await client.query("BEGIN");
    let chart = (await client.query(
      `SELECT chart_id, lifecycle FROM daily_charts WHERE chart_date = $1 FOR UPDATE`, [date],
    )).rows[0];
    let created = false;
    if (!chart) {
      // The schema's active/default selector is is_default (there is no template active flag).
      // Refuse an ambiguous station configuration rather than choosing an arbitrary template.
      const templates = (await client.query(
        `SELECT template_id FROM chart_templates WHERE is_default ORDER BY template_id`,
      )).rows;
      if (templates.length !== 1) {
        throw new DailyStartError("Exactly one default chart template is required to start a day", 409);
      }
      const version = (await client.query(
        `SELECT template_version_id FROM template_versions
          WHERE template_id = $1 ORDER BY template_version_id DESC LIMIT 1`,
        [templates[0].template_id],
      )).rows[0];
      if (!version) throw new DailyStartError("The default chart template has no version", 409);
      const inserted = (await client.query(
        `INSERT INTO daily_charts (chart_date, lifecycle, template_version_id)
         VALUES ($1, 'DRAFT', $2)
         ON CONFLICT (chart_date) DO NOTHING RETURNING chart_id`,
        [date, version.template_version_id],
      )).rows;
      created = inserted.length === 1;
      // A concurrent opener may have inserted the date. A fresh statement sees its committed row;
      // DO NOTHING is important: even updated_at on an existing/finalized chart stays untouched.
      chart = (await client.query(
        `SELECT chart_id, lifecycle FROM daily_charts WHERE chart_date = $1 FOR UPDATE`, [date],
      )).rows[0];
      if (!chart) throw new DailyStartError("The day's chart could not be opened; retry", 409);
    }
    const chartId = Number(chart.chart_id);
    const document = chart.lifecycle === "FINALIZED"
      ? (await getSnapshot(client, chartId)).document
      : await projectChart(client, chartId);
    if (ownsTx) await client.query("COMMIT");
    return { ok: true, created, document };
  } catch (error) {
    if (ownsTx) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (ownsTx) client.release();
  }
}

export function registerDailyStartRoutes(app: FastifyInstance, db: Queryable): void {
  app.post("/api/charts/:date/ensure-draft", async (req, reply) => {
    const { date } = req.params as { date: string };
    try {
      if (req.body !== undefined && (req.body === null || typeof req.body !== "object"
        || Array.isArray(req.body) || Object.keys(req.body).length !== 0)) {
        throw new DailyStartError("Empty body required; initialization never copies chart data", 400);
      }
      const result = await ensureDailyDraft(db, date);
      return reply.code(result.created ? 201 : 200).send(result);
    } catch (error) {
      if (error instanceof DailyStartError) return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  });
}
