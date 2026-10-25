// Purpose: author-entered NOTICE lines (`chart_notices`) — add / edit / move group / delete.
// Current role: Fastify routes + domain mutations for the notice CRUD round (user 2026-10-13).
// Last meaningful change: 2026-10-13 — created (the concrete missing half of “everything CRUDable”).
// Constraint/dependency: notice text is verbatim author/source text — never translated, never
//   parsed for meaning and never auto-classified; grouping is by the stored group key only.
//   FINALIZED charts are immutable (amendment = new version).
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import type { Queryable } from "./chart-document.js";

export class NoticeError extends Error {
  constructor(message: string, public readonly statusCode: 400 | 404 | 409) {
    super(message);
    this.name = "NoticeError";
  }
}

const MAX_TEXT = 300;
const MAX_GROUP = 60;

function safeText(value: unknown, max: number, label: string, required = true): string {
  const text = String(value ?? "").trim();
  if (required && text === "") throw new NoticeError(`${label} आवश्यक आहे`, 400);
  if (text.length > max) throw new NoticeError(`${label} खूप मोठा आहे (कमाल ${max} अक्षरे)`, 400);
  if (/[\u0000-\u001f\u007f<>]/.test(text)) throw new NoticeError(`${label} मध्ये अवैध अक्षरे आहेत`, 400);
  return text;
}

interface Ctx { chartId: number; client: pg.PoolClient; ownsTx: boolean }

/** Every notice mutation runs in one transaction that also locks the chart row: a FINALIZED chart
 *  refuses the write (409) before anything is touched. */
async function withChart<T>(db: Queryable, date: string, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new NoticeError("date must be YYYY-MM-DD", 400);
  const ownsTx = !("release" in db);
  const client = ownsTx ? await (db as pg.Pool).connect() : db as pg.PoolClient;
  try {
    if (ownsTx) await client.query("BEGIN");
    const rows = (await client.query(
      `SELECT chart_id, lifecycle FROM daily_charts WHERE chart_date = $1 FOR UPDATE`, [date])).rows;
    if (rows.length !== 1) throw new NoticeError(`no chart for ${date}`, 404);
    if (rows[0].lifecycle === "FINALIZED") {
      throw new NoticeError("FINALIZED charts are immutable; use amendment", 409);
    }
    const out = await fn({ chartId: Number(rows[0].chart_id), client, ownsTx });
    if (ownsTx) await client.query("COMMIT");
    return out;
  } catch (error) {
    if (ownsTx) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (ownsTx) client.release();
  }
}

export async function addNotice(
  db: Queryable, date: string, input: { text?: unknown; group?: unknown },
): Promise<{ noticeId: number }> {
  const text = safeText(input.text, MAX_TEXT, "सूचना मजकूर");
  const group = safeText(input.group, MAX_GROUP, "गट", false) || "सूचना";
  return withChart(db, date, async ({ chartId, client }) => {
    const row = (await client.query(
      `INSERT INTO chart_notices (chart_id, group_key, sort_order, text_mr)
       VALUES ($1, $2,
               COALESCE((SELECT MAX(sort_order) FROM chart_notices WHERE chart_id = $1), 0) + 1, $3)
       RETURNING notice_id`, [chartId, group, text])).rows[0];
    return { noticeId: Number(row.notice_id) };
  });
}

export async function updateNotice(
  db: Queryable, date: string, noticeId: number, input: { text?: unknown; group?: unknown },
): Promise<{ ok: true }> {
  const text = safeText(input.text, MAX_TEXT, "सूचना मजकूर");
  const group = safeText(input.group, MAX_GROUP, "गट", false) || "सूचना";
  if (!Number.isFinite(noticeId) || noticeId <= 0) throw new NoticeError("notice id must be a number", 400);
  return withChart(db, date, async ({ chartId, client }) => {
    const r = (await client.query(
      `UPDATE chart_notices SET text_mr = $1, group_key = $2
        WHERE notice_id = $3 AND chart_id = $4 RETURNING notice_id`, [text, group, noticeId, chartId])).rows;
    if (r.length !== 1) throw new NoticeError(`no notice ${noticeId} on ${date}`, 404);
    return { ok: true as const };
  });
}

export async function removeNotice(
  db: Queryable, date: string, noticeId: number,
): Promise<{ ok: true }> {
  if (!Number.isFinite(noticeId) || noticeId <= 0) throw new NoticeError("notice id must be a number", 400);
  return withChart(db, date, async ({ chartId, client }) => {
    const r = (await client.query(
      `DELETE FROM chart_notices WHERE notice_id = $1 AND chart_id = $2 RETURNING notice_id`,
      [noticeId, chartId])).rows;
    if (r.length !== 1) throw new NoticeError(`no notice ${noticeId} on ${date}`, 404);
    return { ok: true as const };
  });
}

const replyFor = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, error: unknown) => {
  if (error instanceof NoticeError) return reply.code(error.statusCode).send({ error: error.message });
  throw error;
};

export function registerNoticeRoutes(app: FastifyInstance, db: Queryable): void {
  app.post("/api/charts/:date/notices", async (req, reply) => {
    const { date } = req.params as { date: string };
    try {
      return reply.code(201).send(await addNotice(db, date, (req.body ?? {}) as never));
    } catch (error) { return replyFor(reply, error); }
  });
  app.patch("/api/charts/:date/notices/:id", async (req, reply) => {
    const { date, id } = req.params as { date: string; id: string };
    try {
      return await updateNotice(db, date, Number(id), (req.body ?? {}) as never);
    } catch (error) { return replyFor(reply, error); }
  });
  app.delete("/api/charts/:date/notices/:id", async (req, reply) => {
    const { date, id } = req.params as { date: string; id: string };
    try {
      return await removeNotice(db, date, Number(id));
    } catch (error) { return replyFor(reply, error); }
  });
}
