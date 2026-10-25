// Purpose: Narrow transactional PATCH for persisted chart element presentation.
// Current role: Fastify route + domain mutation, independently injectable for tests.
// Last meaningful change: 2026-10-13 — chart-local alignment/visibility/compact persistence.
// Constraint: Caller-owned PoolClient transactions are preserved; FINALIZED is immutable.
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { projectChart, type Queryable } from "./chart-document.js";
import {
  mergePresentationPatch, PresentationError, resolvePresentation, validatePresentationPatch,
} from "./chart-presentation.js";
import { renderChart } from "./render/chart-html.js";

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/** A Pool owns its transaction; a PoolClient must already be in the caller's transaction.
 * Row lock serializes this mutation with label edits, added boxes and finalization. */
export async function patchChartPresentation(db: Queryable, date: string, input: unknown) {
  const patch = validatePresentationPatch(input);
  if (!validDate(date)) throw new PresentationError("date must be a valid YYYY-MM-DD", 400);
  const ownsTx = !("release" in db);
  const client = ownsTx ? await (db as pg.Pool).connect() : db as pg.PoolClient;
  try {
    if (ownsTx) await client.query("BEGIN");
    const rows = (await client.query(
      `SELECT chart_id, lifecycle, presentation_overrides FROM daily_charts
       WHERE chart_date = $1 FOR UPDATE`, [date])).rows;
    if (rows.length !== 1) throw new PresentationError(`no chart for ${date}`, 404);
    const chart = rows[0];
    if (chart.lifecycle === "FINALIZED") {
      throw new PresentationError("FINALIZED charts are immutable; use amendment", 409);
    }
    const doc = await projectChart(client, Number(chart.chart_id));
    const { presentationElements } = renderChart(doc);
    if (!presentationElements.some((element) => element.key === patch.key)) {
      throw new PresentationError("key is not an editable presentation element on this chart", 400);
    }
    const overrides = mergePresentationPatch(chart.presentation_overrides ?? {}, patch);
    await client.query(
      `UPDATE daily_charts SET presentation_overrides = $1 WHERE chart_id = $2`,
      [overrides, chart.chart_id]);
    doc.template.overrides = overrides;
    if (ownsTx) await client.query("COMMIT");
    return {
      ok: true,
      key: patch.key,
      presentation: resolvePresentation(doc, patch.key),
      presentation_overrides: overrides,
    };
  } catch (error) {
    if (ownsTx) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (ownsTx) client.release();
  }
}

export function registerChartPresentationRoute(app: FastifyInstance, db: Queryable): void {
  app.patch("/api/charts/:date/presentation", async (req, reply) => {
    const { date } = req.params as { date: string };
    try {
      return await patchChartPresentation(db, date, req.body);
    } catch (error) {
      if (error instanceof PresentationError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });
}
