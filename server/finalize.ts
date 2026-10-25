// Purpose: Finalize a chart — materialize the complete ChartDocument into the immutable
//   chart_versions snapshot (T13 hybrid model, PRODUCT_UI_ARCHITECTURE §9).
// Current role: P1 slice 1 — the ONLY writer of chart_versions; reprints read via getSnapshot.
// Last meaningful change: 2026-10-08 — created at P1 start.
// Constraint/dependency: snapshot must be render-ready without today's masters (projection
//   embeds resolved Layer-A values); D-rule weekday is computed at projection, stored only
//   as part of the frozen document text. Refuses non-DRAFT/VALIDATED charts; the lifecycle
//   trigger enforces the legal transition regardless.
//   Accepts a Pool (owns BEGIN/COMMIT) or an already-transacting PoolClient (caller owns
//   the transaction) so tests can run finalize inside a rolled-back tx.
import type pg from "pg";
import { projectChart, getSnapshot, type ChartDocument, type Queryable } from "./chart-document.js";

export interface FinalizeResult {
  versionNo: number;
  document: ChartDocument;
}

export async function finalizeChart(db: Queryable, chartId: number): Promise<FinalizeResult> {
  // A pooled client is itself a pg.Client (it has .connect too); the reliable
  // discriminator is .release — only PoolClient has it. Pool ⇒ we own BEGIN/COMMIT.
  const ownsTx = !("release" in db);
  const client: pg.PoolClient = ownsTx ? await (db as pg.Pool).connect() : (db as pg.PoolClient);
  const finish = async () => {
    if (ownsTx) client.release();
  };
  try {
    if (ownsTx) await client.query("BEGIN");
    // Lock the chart row: serializes concurrent finalizes so version_no stays unique.
    const rows = (await client.query(
      `SELECT lifecycle FROM daily_charts WHERE chart_id = $1 FOR UPDATE`, [chartId])).rows;
    if (rows.length !== 1) throw new Error(`finalizeChart: no chart ${chartId}`);
    const lifecycle = rows[0].lifecycle as string;
    if (lifecycle !== "DRAFT" && lifecycle !== "VALIDATED") {
      throw new Error(`finalizeChart: chart ${chartId} is ${lifecycle} — only DRAFT/VALIDATED charts can be finalized`);
    }

    const doc = await projectChart(client, chartId);

    // Version chain: first finalize = 1; a reopened chart's next version references the
    // version being amended (never a mutation of it — append-only trigger enforces).
    const prev = (await client.query(
      `SELECT chart_version_id, version_no FROM chart_versions
        WHERE chart_id = $1 ORDER BY version_no DESC LIMIT 1`, [chartId])).rows;
    const versionNo = prev.length === 1 ? Number(prev[0].version_no) + 1 : 1;
    const amendedFrom = prev.length === 1 ? Number(prev[0].chart_version_id) : null;

    const snapshot: ChartDocument = { ...doc, lifecycle: "FINALIZED" };
    await client.query(
      `INSERT INTO chart_versions (chart_id, version_no, document_json, amended_from_version_id)
       VALUES ($1,$2,$3,$4)`, [chartId, versionNo, JSON.stringify(snapshot), amendedFrom]);
    await client.query(`UPDATE daily_charts SET lifecycle = 'FINALIZED' WHERE chart_id = $1`, [chartId]);

    if (ownsTx) await client.query("COMMIT");
    // Round-trip proof: what we store is exactly what a reader gets back.
    const stored = await getSnapshot(client, chartId, versionNo);
    return { versionNo, document: stored.document };
  } catch (err) {
    if (ownsTx) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await finish();
  }
}

/** Reopen for amendment: FINALIZED → DRAFT (allowed by the lifecycle trigger). The
 *  snapshot is never touched; the next finalize writes version_no+1 referencing it. */
export async function reopenForAmendment(db: Queryable, chartId: number): Promise<void> {
  await db.query(`UPDATE daily_charts SET lifecycle = 'DRAFT' WHERE chart_id = $1`, [chartId]);
  const lc = (await db.query(`SELECT lifecycle FROM daily_charts WHERE chart_id = $1`, [chartId])).rows[0];
  if (lc?.lifecycle !== "DRAFT") throw new Error(`reopenForAmendment: chart ${chartId} did not reopen`);
}
