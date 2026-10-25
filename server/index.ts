// Purpose: Fastify 5 server entry point — REST API over the existing Kysely/pg layer.
// Current role: P1 server layer — exposes chart CRUD, lifecycle, continuation CRUD, copy-previous,
//   and masters CRUD.
// Last meaningful change: 2026-10-19 — startup banner now points clerks to the current Next UI and
//   no longer advertises the removed mock/legacy entry points.
// Constraint/dependency: AGENTS.md hard rules; all mutations go through domain functions
//   that enforce invariants; no police data leaves the machine.
import Fastify from "fastify";
import cors from "@fastify/cors";
import fs from "node:fs";
import path from "node:path";
import type pg from "pg";
import { makePool, DEV_DB } from "./db.js";
import { projectChart, getSnapshot, weekdayMr, type ChartDocument } from "./chart-document.js";
import { finalizeChart, reopenForAmendment } from "./finalize.js";
import {
  reassignSlot,
  addChowkiBlock,
  addOfficerBox,
  removeChowkiBlock,
  removeOfficerBox,
  addSupportSeat,
  removeSupportSeat,
  createAssignmentSeat,
  deleteAssignmentSeat,
  updateAssignmentMetadata,
} from "./assignments.js";
import { renderChart } from "./render/chart-html.js";
import { registerChartPresentationRoute } from "./presentation.js";
import { registerStructureRoutes } from "./structure.js";
import { registerNoticeRoutes } from "./notices.js";
import { registerContinuationRoutes } from "./continuation.js";
import { registerDailyStartRoutes } from "./daily-start.js";
import { registerAttendanceRoutes } from "./attendance.js";
import { registerRegisterRoutes } from "./registers.js";

// PORT may be present-but-empty in some shells (Number("")===0 → random port);
// fall back to the documented 3100 unless a real port number is provided.
const port = Number(process.env.PORT) || 3100;
// Bind to 0.0.0.0 so containerized / cloud deployment platforms (such as Render)
// can detect open ports and route incoming traffic to the container.
// Can be overridden via HOST environment variable if loopback binding is explicitly required.
const host = process.env.HOST || "0.0.0.0";
const pool = makePool(DEV_DB);

// Logging (user question 2026-10-13: “Whenever I npm run dev … this outputs, is this normal?”).
// It IS normal pino output — Fastify logs every request at `info` — but it is noise for normal
// work, so the default dev experience is now CALM: one startup banner and no per-request lines.
// Level `warn` is what does that (request lines are `info`), so `LOG_LEVEL=info npm run dev`
// brings the full request stream back and `LOG_LEVEL=silent` mutes pino entirely. Real problems
// (errors, warnings) always print.
const LOG_LEVEL = process.env.LOG_LEVEL ?? "warn";
const app = Fastify({ logger: LOG_LEVEL === "silent" ? false : { level: LOG_LEVEL } });

await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
});

// Health: verifies service responsiveness and live PostgreSQL connectivity
app.get("/health", async (_req, reply) => {
  try {
    await pool.query("SELECT 1 AS alive");
    return { ok: true, service: "panchavati", database: "connected" };
  } catch (err) {
    reply.status(503);
    return { ok: false, service: "panchavati", database: "unreachable", error: (err as Error).message };
  }
});

// The browser asks for /favicon.ico on every page load; without a route it is a 404 in the log
// (and in the console). It is the same emblem the header uses, so serve that.
app.get("/favicon.ico", async (_req, reply) => {
  const abs = path.join(process.cwd(), "web", "assets", "Police_Logo.png");
  if (!fs.existsSync(abs)) return reply.code(204).send();
  return reply.header("Content-Type", "image/png").send(fs.readFileSync(abs));
});

// Static assets: frozen visual baseline (design/) + authoring layer (web/).
// Browser code lives in web/ — server/ stays fetch-free (local-only static scan, invariant tests).
const serveFile = (relPath: string, contentType: string) => async (_req: unknown, reply: { header: (k: string, v: string) => { send: (b: string) => unknown } }) => {
  const abs = path.join(process.cwd(), relPath);
  if (!fs.existsSync(abs)) return reply.header("Content-Type", "text/plain").send("not found");
  return reply.header("Content-Type", contentType).send(fs.readFileSync(abs, "utf8"));
};
app.get("/design/compv3.css", serveFile(path.join("design", "compv3.css"), "text/css; charset=utf-8"));
// The frozen visual baseline itself, served read-only so the chart can be reviewed side by side
// against the mock it must match (same origin → the mock's relative compv3.css link resolves).
app.get("/design/panchavati-compv3.html", serveFile(path.join("design", "panchavati-compv3.html"), "text/html; charset=utf-8"));

// Legacy reference chart (user request 2026-10-13): the real legacy six-page chart lives in
// Kushal's repo, which is a SEPARATE app — its own DB (panchavati_dev), its own API shape and its
// own React views (Page1View…Page6View.tsx). It is therefore NOT proxied through this server
// (root-absolute assets + different /api contract would render a broken shell). The header entry
// opens it directly at http://localhost:3100/charts/<date>; `npm run legacy:start` starts it, and
// the browser page probes reachability before embedding it. Nothing here imports that app's code.
// The browser keeps a SAME-ORIGIN url (/legacy/<date>) and this redirect is the only place that
// knows the other app's origin — the client-side invariant "no absolute URLs" stays intact.
// The reference app's origin is CONFIGURATION, never a hardcode: locally it is the supervised
// process on :3101 (`npm run legacy:start`, or the opt-in `npm run demo:legacy`); on a deployed
// demo the legacy chart is its OWN service, so its public origin comes from LEGACY_URL and the
// redirect below follows it. No other file knows that origin, and the browser keeps a same-origin
// /legacy/<date> URL (client stays free of absolute URLs — local-only invariant).
// A deployment that has no reference app sets LEGACY_URL=none (or leaves it empty) and the entry
// answers an honest 404 instead of a dead link to a laptop's localhost (see render.yaml/docs/DEPLOY.md).
const legacyOrigin = (value: string | undefined, port: string): string | null => {
  if (value === undefined) return `http://localhost:${port}`;
  const trimmed = value.trim().replace(/\/$/, "");
  return trimmed === "" || trimmed.toLowerCase() === "none" ? null : trimmed;
};
const LEGACY_URL = legacyOrigin(process.env.LEGACY_URL, process.env.LEGACY_PORT || "3101");
const LEGACY_URL_2 = legacyOrigin(process.env.LEGACY_URL_2, process.env.LEGACY2_PORT || "3102");
const legacyRedirect = (base: string | null) => async (req: { params: unknown }, reply: {
  code: (n: number) => { send: (b: unknown) => unknown }; redirect: (u: string) => unknown;
}) => {
  const { date } = req.params as { date: string };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: "bad date" });
  if (!base) {
    return reply.code(404).send({
      error: "संदर्भ तक्ता या डिप्लॉयमध्ये उपलब्ध नाही",
      hint: "legacy reference chart is a separate app — set LEGACY_URL to its origin (docs/DEPLOY.md)",
    });
  }
  return reply.redirect(`${base}/charts/${date}`);
};
app.get("/legacy/:date", legacyRedirect(LEGACY_URL));
// Second reference app (the other six-page build) — both can run side by side for comparison.
app.get("/legacy2/:date", legacyRedirect(LEGACY_URL_2));
app.get("/authoring.css", serveFile(path.join("web", "authoring.css"), "text/css; charset=utf-8"));
// Offline transliteration engine for the bilingual fields (Sanscript 1.3.3, MIT). It is served from
// this repo's own dependency tree — no CDN, no network call at runtime, so no chart data and no
// name ever leaves the machine (AGENTS.md). One copy, pinned by package.json + lockfile.
app.get("/vendor/sanscript.js", serveFile(
  path.join("node_modules", "@indic-transliteration", "sanscript", "sanscript.js"),
  "application/javascript; charset=utf-8",
));
app.get("/chart-presentation.css", serveFile(path.join("web", "chart-presentation.css"), "text/css; charset=utf-8"));
app.get("/chart-authoring.js", serveFile(path.join("web", "chart-authoring.js"), "text/javascript; charset=utf-8"));
// Maharashtra Police emblem for the app header — binary, so it cannot go through serveFile
// (which reads text). Local file only; nothing is fetched from the network.
app.get("/assets/police-logo.png", async (_req, reply) => {
  const abs = path.join(process.cwd(), "web", "assets", "Police_Logo.png");
  if (!fs.existsSync(abs)) return reply.code(404).send("not found");
  return reply.header("Content-Type", "image/png").header("Cache-Control", "no-cache").send(fs.readFileSync(abs));
});

// The server-rendered chart remains available for regression/print-audit coverage.
// The client-first frontend under frontend/ reads the same ChartDocument API and must not create a
// second lossy persistence model.
app.get("/app", async (_req, reply) => reply.redirect("/charts/2026-09-10"));
app.get("/app/charts/:date", async (req, reply) => {
  const { date } = req.params as { date: string };
  return reply.redirect(`/charts/${date}`);
});

// Chart dates available for the header's date selector (the month grid the clerk jumps between).
app.get("/api/charts", async () => {
  // chart_date::text — pg maps a DATE column to a JS Date, and String(Date) is "Thu Sep 10 …",
  // so the cast keeps the ISO day the client expects.
  const rows = (await pool.query(
    `SELECT chart_date::text AS chart_date, lifecycle FROM daily_charts ORDER BY chart_date DESC`)).rows;
  return rows.map((r) => ({
    date: r.chart_date as string,
    lifecycle: r.lifecycle as string,
  }));
});

// Root redirects to today's baseline chart (10 Sept 2026)
app.get("/", async (req, reply) => {
  reply.redirect("/charts/2026-09-10");
});

// Live ChartBoard View (HTML screen + print preview & edit shell)
app.get("/charts/:date", async (req, reply) => {
  const { date } = req.params as { date: string };
  const rows = await pool.query(
    `SELECT chart_id, lifecycle FROM daily_charts WHERE chart_date = $1`, [date],
  );
  if (rows.rows.length !== 1) return reply.code(404).send(`<h3>No chart found for ${date}</h3>`);

  const { chart_id, lifecycle } = rows.rows[0];
  let doc: ChartDocument;
  if (lifecycle === "FINALIZED") {
    doc = (await getSnapshot(pool, chart_id)).document;
  } else {
    doc = await projectChart(pool, chart_id);
  }
  const { html } = renderChart(doc);
  reply.header("Content-Type", "text/html; charset=utf-8").send(
    html
      .replace("__CSS_HREF__", "/design/compv3.css")
      .replace("__AUTH_CSS_HREF__", "/authoring.css")
      .replace("__PRESENTATION_CSS_HREF__", "/chart-presentation.css")
      .replace("__VENDOR_JS_SRC__", "/vendor/sanscript.js")
      .replace("__AUTH_JS_SRC__", "/chart-authoring.js")
  );
});


// Resolve a chart by date (today's view)
app.get("/api/charts/:date", async (req, reply) => {
  const { date } = req.params as { date: string };
  const rows = await pool.query(
    `SELECT chart_id, lifecycle, template_version_id FROM daily_charts WHERE chart_date = $1`, [date],
  );
  if (rows.rows.length !== 1) return reply.code(404).send({ error: `no chart for ${date}` });

  const { chart_id, lifecycle } = rows.rows[0];
  let doc: ChartDocument;
  if (lifecycle === "FINALIZED") {
    doc = (await getSnapshot(pool, chart_id)).document;
  } else {
    doc = await projectChart(pool, chart_id);
  }
  if (doc.weekdayMr !== weekdayMr(doc.chartDate)) throw new Error("weekday mismatch (D-rule)");
  return doc;
});

// Narrow slot mutation (edit mode): reassign ONE staff slot through the domain layer.
// Deliberately NOT a full-document write — a single-slot edit must never be able to
// erase unrelated assignment rows (handoff §6). FINALIZED → 409 (also DB-enforced).
app.patch("/api/charts/:date/assignments/:id", async (req, reply) => {
  const { date, id } = req.params as { date: string; id: string };
  const body = (req.body ?? {}) as { staffId?: number | null; isBima?: boolean };
  if (!("staffId" in body)) return reply.code(400).send({ error: "staffId is required (null = रिक्त)" });
  const staffId = body.staffId === null ? null : Number(body.staffId);
  if (staffId != null && !Number.isFinite(staffId)) return reply.code(400).send({ error: "staffId must be a number or null" });

  const ch = (await pool.query(`SELECT chart_id FROM daily_charts WHERE chart_date = $1`, [date])).rows;
  if (ch.length !== 1) return reply.code(404).send({ error: `no chart for ${date}` });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await reassignSlot(client, {
      chartId: Number(ch[0].chart_id),
      assignmentId: Number(id),
      staffId,
      isBima: typeof body.isBima === "boolean" ? body.isBima : undefined,
    });
    await client.query("COMMIT");
    return res;
  } catch (e) {
    await client.query("ROLLBACK");
    const msg = (e as Error).message;
    if (/immutable|no chart|no assignment|does not belong|no staff|inactive/.test(msg)) {
      return reply.code(/immutable/.test(msg) ? 409 : 400).send({ error: msg });
    }
    throw e;
  } finally {
    client.release();
  }
});

// Create a new assignment seat on the chart (edit mode)
app.post("/api/charts/:date/assignments", async (req, reply) => {
  const { date } = req.params as { date: string };
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ch = (await pool.query(`SELECT chart_id FROM daily_charts WHERE chart_date = $1`, [date])).rows;
  if (ch.length !== 1) return reply.code(404).send({ error: `no chart for ${date}` });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await createAssignmentSeat(client, {
      chartId: Number(ch[0].chart_id),
      shift: (body.shift as "DAY" | "NIGHT") ?? "DAY",
      columnNo: body.columnNo != null ? Number(body.columnNo) : undefined,
      sortOrder: body.sortOrder != null ? Number(body.sortOrder) : undefined,
      dutyId: body.dutyId != null ? Number(body.dutyId) : null,
      dutyTitleMr: typeof body.dutyTitleMr === "string" ? body.dutyTitleMr : null,
      locationId: body.locationId != null ? Number(body.locationId) : null,
      unitCode: typeof body.unitCode === "string" ? body.unitCode : null,
      roleMr: typeof body.roleMr === "string" ? body.roleMr : null,
      startTime: typeof body.startTime === "string" ? body.startTime : null,
      endTime: typeof body.endTime === "string" ? body.endTime : null,
      notesMr: typeof body.notesMr === "string" ? body.notesMr : null,
      staffId: body.staffId != null ? Number(body.staffId) : null,
      isBima: Boolean(body.isBima),
    });
    await client.query("COMMIT");
    return reply.code(201).send(res);
  } catch (e) {
    await client.query("ROLLBACK");
    const msg = (e as Error).message;
    if (/immutable/.test(msg)) return reply.code(409).send({ error: msg });
    return reply.code(400).send({ error: msg });
  } finally {
    client.release();
  }
});

// Delete an assignment seat (must be VACANT_RIKT)
app.delete("/api/charts/:date/assignments/:id", async (req, reply) => {
  const { date, id } = req.params as { date: string; id: string };
  const assignmentId = Number(id);
  if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
    return reply.code(400).send({ error: "assignment id must be a number" });
  }
  const ch = (await pool.query(`SELECT chart_id FROM daily_charts WHERE chart_date = $1`, [date])).rows;
  if (ch.length !== 1) return reply.code(404).send({ error: `no chart for ${date}` });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await deleteAssignmentSeat(client, {
      chartId: Number(ch[0].chart_id),
      assignmentId,
    });
    await client.query("COMMIT");
    return res;
  } catch (e) {
    await client.query("ROLLBACK");
    const msg = (e as Error).message;
    if (/immutable|कर्मचारी/.test(msg)) return reply.code(409).send({ error: msg });
    if (/no assignment/.test(msg)) return reply.code(404).send({ error: msg });
    return reply.code(400).send({ error: msg });
  } finally {
    client.release();
  }
});

// Update assignment seat metadata (timings, dutyTitle, role, unit, notes, etc.)
app.patch("/api/charts/:date/assignments/:id/metadata", async (req, reply) => {
  const { date, id } = req.params as { date: string; id: string };
  const assignmentId = Number(id);
  if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
    return reply.code(400).send({ error: "assignment id must be a number" });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ch = (await pool.query(`SELECT chart_id FROM daily_charts WHERE chart_date = $1`, [date])).rows;
  if (ch.length !== 1) return reply.code(404).send({ error: `no chart for ${date}` });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const input: Parameters<typeof updateAssignmentMetadata>[1] = {
      chartId: Number(ch[0].chart_id),
      assignmentId,
    };
    if ("dutyTitleMr" in body) input.dutyTitleMr = typeof body.dutyTitleMr === "string" ? body.dutyTitleMr : null;
    if ("roleMr" in body) input.roleMr = typeof body.roleMr === "string" ? body.roleMr : null;
    if ("unitCode" in body) input.unitCode = typeof body.unitCode === "string" ? body.unitCode : null;
    if ("startTime" in body) input.startTime = typeof body.startTime === "string" ? body.startTime : null;
    if ("endTime" in body) input.endTime = typeof body.endTime === "string" ? body.endTime : null;
    if ("notesMr" in body) input.notesMr = typeof body.notesMr === "string" ? body.notesMr : null;
    if ("shift" in body && (body.shift === "DAY" || body.shift === "NIGHT")) input.shift = body.shift;
    if ("columnNo" in body && body.columnNo != null) input.columnNo = Number(body.columnNo);
    if ("sortOrder" in body && body.sortOrder != null) input.sortOrder = Number(body.sortOrder);
    if ("locationId" in body) input.locationId = body.locationId != null ? Number(body.locationId) : null;
    if ("dutyId" in body) input.dutyId = body.dutyId != null ? Number(body.dutyId) : null;

    const res = await updateAssignmentMetadata(client, input);
    await client.query("COMMIT");
    return res;
  } catch (e) {
    await client.query("ROLLBACK");
    const msg = (e as Error).message;
    if (/immutable/.test(msg)) return reply.code(409).send({ error: msg });
    if (/no assignment/.test(msg)) return reply.code(404).send({ error: msg });
    return reply.code(400).send({ error: msg });
  } finally {
    client.release();
  }
});

// Add a chowki/marshal block (edit-mode `+ चौकी जोडा`) — Layer-A location + Layer-B rows
// created together in one transaction; starts with रिक्त seats only (no invented persons).
app.post("/api/charts/:date/chowki", async (req, reply) => {
  const { date } = req.params as { date: string };
  const body = (req.body ?? {}) as { locationId?: number; nameMr?: string; kind?: string };
  if (body.locationId == null && !body.nameMr) {
    return reply.code(400).send({ error: "locationId or nameMr is required" });
  }
  const ch = (await pool.query(`SELECT chart_id FROM daily_charts WHERE chart_date = $1`, [date])).rows;
  if (ch.length !== 1) return reply.code(404).send({ error: `no chart for ${date}` });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await addChowkiBlock(client, {
      chartId: Number(ch[0].chart_id),
      locationId: body.locationId != null ? Number(body.locationId) : undefined,
      nameMr: body.nameMr,
      kind: body.kind,
    });
    await client.query("COMMIT");
    return reply.code(201).send(res);
  } catch (e) {
    await client.query("ROLLBACK");
    const msg = (e as Error).message;
    if (/immutable|already|kind|location|nameMr|no chart/.test(msg)) {
      return reply.code(/immutable|already/.test(msg) ? 409 : 400).send({ error: msg });
    }
    throw e;
  } finally {
    client.release();
  }
});

// Rename a chart-local display name (edit-mode rename popover) — TABLE / SECTION / COLUMN /
// LEFT-ROW titles only. Lives in presentation_overrides (labels = this element,
// labelsAll = everywhere the same default name appears), so it snapshots with the chart at
// FINALIZE and never touches masters, duties, people or any other chart. Blank text clears
// the override (back to the default name). FINALIZED → 409, exactly like the slot PATCH.
app.patch("/api/charts/:date/labels", async (req, reply) => {
  const { date } = req.params as { date: string };
  const body = (req.body ?? {}) as { scope?: string; key?: string; defaultText?: string; text?: string };
  const scope = body.scope;
  const key = String(body.key ?? "").trim();
  const defaultText = String(body.defaultText ?? "").trim();
  const text = String(body.text ?? "").trim();
  if (scope !== "element" && scope !== "all") {
    return reply.code(400).send({ error: "scope must be element or all" });
  }
  if (scope === "element" && !key) return reply.code(400).send({ error: "key is required for scope=element" });
  if (scope === "all" && !defaultText) return reply.code(400).send({ error: "defaultText is required for scope=all" });
  if ([key, defaultText, text].some((s) => s.length > 160)) {
    return reply.code(400).send({ error: "name too long (max 160 characters)" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ch = (await client.query(
      `SELECT chart_id, lifecycle, presentation_overrides FROM daily_charts WHERE chart_date = $1 FOR UPDATE`, [date])).rows;
    if (ch.length !== 1) {
      await client.query("ROLLBACK");
      return reply.code(404).send({ error: `no chart for ${date}` });
    }
    if (ch[0].lifecycle === "FINALIZED") {
      await client.query("ROLLBACK");
      return reply.code(409).send({ error: "FINALIZED charts are immutable; use amendment" });
    }
    const ov = { ...((ch[0].presentation_overrides as Record<string, unknown>) ?? {}) };
    if (scope === "element") {
      const labels = { ...((ov.labels as Record<string, string>) ?? {}) };
      if (text === "") delete labels[key]; else labels[key] = text;
      ov.labels = labels;
    } else {
      const labelsAll = { ...((ov.labelsAll as Record<string, string>) ?? {}) };
      if (text === "") delete labelsAll[defaultText]; else labelsAll[defaultText] = text;
      ov.labelsAll = labelsAll;
    }
    const upd = (await client.query(
      `UPDATE daily_charts SET presentation_overrides = $1 WHERE chart_id = $2 RETURNING presentation_overrides`,
      [ov, ch[0].chart_id])).rows[0];
    await client.query("COMMIT");
    return { ok: true, presentation_overrides: upd.presentation_overrides };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
});

// Enumerated per-element display controls only; source rows and labels are untouched.
registerChartPresentationRoute(app, pool);
// Chart-local STRUCTURE (clerk-owned tables, matrix columns, typed values) and the author-entered
// notice lines — same narrow-write discipline: bounded operations, DRAFT only, FINALIZED → 409.
registerStructureRoutes(app, pool);
registerNoticeRoutes(app, pool);
// Location operational states and daily availability rows are normalized Layer-B continuation data;
// every mutation locks the chart, validates typed fields/FKs, and reads back the ChartDocument.
registerContinuationRoutes(app, pool);
registerDailyStartRoutes(app, pool);
registerAttendanceRoutes(app, pool);
registerRegisterRoutes(app, pool);

// Add an अधिकारी box (edit-mode `+ अधिकारी बॉक्स जोडा`) — display entry in
// presentation_overrides.officerBoxes + a real रिक्त रायटर seat in the office column.
// No invented person: the clerk fills the seat through the normal slot picker.
app.post("/api/charts/:date/officer", async (req, reply) => {
  const { date } = req.params as { date: string };
  const body = (req.body ?? {}) as { labelMr?: string; titleMr?: string };
  if (!body.labelMr || !body.labelMr.trim()) {
    return reply.code(400).send({ error: "labelMr is required" });
  }
  const ch = (await pool.query(`SELECT chart_id FROM daily_charts WHERE chart_date = $1`, [date])).rows;
  if (ch.length !== 1) return reply.code(404).send({ error: `no chart for ${date}` });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await addOfficerBox(client, {
      chartId: Number(ch[0].chart_id),
      labelMr: body.labelMr,
      titleMr: body.titleMr,
    });
    await client.query("COMMIT");
    return reply.code(201).send(res);
  } catch (e) {
    await client.query("ROLLBACK");
    const msg = (e as Error).message;
    if (/immutable|already|आधीच|labelMr|no chart/.test(msg)) {
      return reply.code(/immutable|already|आधीच/.test(msg) ? 409 : 400).send({ error: msg });
    }
    throw e;
  } finally {
    client.release();
  }
});

// Remove a chart block (edit-mode ✕) — the clerk's own undo for the two add controls.
// Same guards as the domain layer: FINALIZED → 409, a block that holds a person → 409,
// a chowki another block charges to → 409. Nothing but this chart's own rows is touched.
const removeErrorReply = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, msg: string) => {
  if (/immutable|कर्मचारी|चार्ज|आधीच/.test(msg)) return reply.code(409).send({ error: msg });
  if (/no officer box|चौकी नाही/.test(msg)) return reply.code(404).send({ error: msg });
  return reply.code(400).send({ error: msg });
};

app.delete("/api/charts/:date/officer/:label", async (req, reply) => {
  const { date, label } = req.params as { date: string; label: string };
  const ch = (await pool.query(`SELECT chart_id FROM daily_charts WHERE chart_date = $1`, [date])).rows;
  if (ch.length !== 1) return reply.code(404).send({ error: `no chart for ${date}` });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await removeOfficerBox(client, {
      chartId: Number(ch[0].chart_id),
      label: decodeURIComponent(label),
    });
    await client.query("COMMIT");
    return { ok: true, ...res };
  } catch (e) {
    await client.query("ROLLBACK");
    return removeErrorReply(reply, (e as Error).message);
  } finally {
    client.release();
  }
});

app.delete("/api/charts/:date/chowki/:locationId", async (req, reply) => {
  const { date, locationId } = req.params as { date: string; locationId: string };
  const ch = (await pool.query(`SELECT chart_id FROM daily_charts WHERE chart_date = $1`, [date])).rows;
  if (ch.length !== 1) return reply.code(404).send({ error: `no chart for ${date}` });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await removeChowkiBlock(client, {
      chartId: Number(ch[0].chart_id),
      locationId: Number(locationId),
    });
    await client.query("COMMIT");
    return { ok: true, ...res };
  } catch (e) {
    await client.query("ROLLBACK");
    return removeErrorReply(reply, (e as Error).message);
  } finally {
    client.release();
  }
});

// Sr-PI support seats (edit-mode `+ जागा` / ✕ inside the station-officer card). Same guards as
// the block routes: DRAFT only (enforced in the domain layer), a seat holding a person cannot be
// deleted, and a duplicate seat is refused instead of silently reused.
const supportErrorReply = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, msg: string) => {
  if (/immutable/.test(msg)) return reply.code(409).send({ error: msg });
  if (/जागा आधीच|role must|shift must|does not belong|सपोर्ट जागा/.test(msg)) {
    return reply.code(/जागा आधीच|सपोर्ट जागा/.test(msg) ? 409 : 400).send({ error: msg });
  }
  return reply.code(400).send({ error: msg });
};

app.post("/api/charts/:date/support", async (req, reply) => {
  const { date } = req.params as { date: string };
  const body = (req.body ?? {}) as { role?: string; shift?: "DAY" | "NIGHT" };
  const ch = (await pool.query(`SELECT chart_id FROM daily_charts WHERE chart_date = $1`, [date])).rows;
  if (ch.length !== 1) return reply.code(404).send({ error: `no chart for ${date}` });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await addSupportSeat(client, {
      chartId: Number(ch[0].chart_id), role: body.role ?? "", shift: body.shift as "DAY" | "NIGHT",
    });
    await client.query("COMMIT");
    return reply.code(201).send(res);
  } catch (e) {
    await client.query("ROLLBACK");
    return supportErrorReply(reply, (e as Error).message);
  } finally {
    client.release();
  }
});

app.delete("/api/charts/:date/support/:id", async (req, reply) => {
  const { date, id } = req.params as { date: string; id: string };
  const assignmentId = Number(id);
  if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
    return reply.code(400).send({ error: "assignment id must be a number" });
  }
  const ch = (await pool.query(`SELECT chart_id FROM daily_charts WHERE chart_date = $1`, [date])).rows;
  if (ch.length !== 1) return reply.code(404).send({ error: `no chart for ${date}` });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await removeSupportSeat(client, { chartId: Number(ch[0].chart_id), assignmentId });
    await client.query("COMMIT");
    return { ok: true, ...res };
  } catch (e) {
    await client.query("ROLLBACK");
    const msg = (e as Error).message;
    if (/immutable/.test(msg)) return reply.code(409).send({ error: msg });
    if (/no assignment/.test(msg)) return reply.code(404).send({ error: msg });
    return supportErrorReply(reply, msg);
  } finally {
    client.release();
  }
});

// Finalize
app.post("/api/charts/:date/finalize", async (req, reply) => {
  const { date } = req.params as { date: string };
  const ch = (await pool.query(
    `SELECT chart_id FROM daily_charts WHERE chart_date = $1`, [date],
  )).rows;
  if (ch.length !== 1) return reply.code(404).send({ error: `no chart for ${date}` });
  try {
    const res = await finalizeChart(pool, ch[0].chart_id);
    return { versionNo: res.versionNo };
  } catch (e) {
    const msg = (e as Error).message;
    if (/FINALIZED|only DRAFT|VALIDATED/.test(msg)) return reply.code(409).send({ error: msg });
    throw e;
  }
});

// Reopen for amendment
app.post("/api/charts/:date/reopen", async (req, reply) => {
  const { date } = req.params as { date: string };
  const ch = (await pool.query(
    `SELECT chart_id, lifecycle FROM daily_charts WHERE chart_date = $1`, [date],
  )).rows;
  if (ch.length !== 1) return reply.code(404).send({ error: `no chart for ${date}` });
  const cl = ch[0].lifecycle as string;
  if (cl !== "FINALIZED") return reply.code(409).send({ error: `chart is ${cl}, not FINALIZED` });
  await reopenForAmendment(pool, ch[0].chart_id);
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Station master data CRUD
// ---------------------------------------------------------------------------
// Master endpoints deliberately keep the SQL surface small: values are always
// parameters, and the only dynamic SQL fragments come from these allow-listed
// column maps. Names and notes are stored as entered; no remote service or
// transliteration is involved.
class MasterInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterInputError";
  }
}

type MasterBody = Record<string, unknown>;
const isRecord = (value: unknown): value is MasterBody =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const bodyOf = (value: unknown): MasterBody => isRecord(value) ? value : {};
const hasOwn = (value: MasterBody, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function textValue(value: unknown, field: string, options: { required?: boolean; max?: number } = {}): string | null {
  const max = options.max ?? 160;
  if (value === null || value === undefined) {
    if (options.required) throw new MasterInputError(`${field} is required`);
    return null;
  }
  if (typeof value !== "string") throw new MasterInputError(`${field} must be text`);
  const text = value.trim();
  if (options.required && !text) throw new MasterInputError(`${field} is required`);
  if (text.length > max) throw new MasterInputError(`${field} is too long (max ${max} characters)`);
  return text || null;
}

function requiredText(value: unknown, field: string, max = 160): string {
  return textValue(value, field, { required: true, max }) as string;
}

function optionalText(value: unknown, field: string, max = 160): string | null {
  return textValue(value, field, { max });
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new MasterInputError(`${field} must be true or false`);
  return value;
}

function integerValue(value: unknown, field: string, defaultValue?: number): number {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 999999) {
    throw new MasterInputError(`${field} must be a whole number between 0 and 999999`);
  }
  return parsed;
}

function positiveId(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new MasterInputError(`${field} must be a positive integer`);
  return parsed;
}

function codeValue(value: unknown, field: string): string {
  const code = requiredText(value, field, 64);
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) {
    throw new MasterInputError(`${field} must use uppercase letters, numbers and underscores`);
  }
  return code;
}

function validationReply(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, error: unknown) {
  if (error instanceof MasterInputError) return reply.code(400).send({ error: error.message });
  throw error;
}

function pgCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}

function conflictReply(
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  message: string,
) {
  return reply.code(409).send({ error: message });
}

type PatchParser = (value: unknown) => unknown;
function patchValues(body: MasterBody, parsers: Record<string, PatchParser>) {
  const sets: string[] = [];
  const values: unknown[] = [];
  const parsedByField: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(body)) {
    if (!Object.prototype.hasOwnProperty.call(parsers, field)) throw new MasterInputError(`field not editable: ${field}`);
    const parse = parsers[field];
    const parsed = parse(value);
    // The own-key check above makes this allow-list the only source of SQL
    // column names; request values remain parameters.
    sets.push(`${field} = $${values.length + 1}`);
    values.push(parsed);
    parsedByField[field] = parsed;
  }
  if (sets.length === 0) throw new MasterInputError("no fields to update");
  return { sets, values, parsedByField };
}

const VALID_RANK_CADRES = new Set(["OFFICER", "CONSTABULARY", "HOME_GUARD"]);
const VALID_LOCATION_KINDS = new Set(["STATION", "CHOWKI", "MARSHAL_POST", "OFFICE", "COURT", "FIXED_POINT"]);
const VALID_UNIT_TYPES = new Set(["PATROL_MOBILE", "CHOWKI_INCHARGE"]);
const VALID_SHIFTS = new Set(["DAY", "NIGHT"]);
const validEnum = (value: unknown, field: string, allowed: Set<string>): string => {
  const text = requiredText(value, field, 40);
  if (!allowed.has(text)) throw new MasterInputError(`${field} must be one of: ${[...allowed].join(", ")}`);
  return text;
};

async function ensureActiveRank(rankCode: string): Promise<void> {
  const result = await pool.query(`SELECT 1 FROM ranks WHERE rank_code = $1 AND active`, [rankCode]);
  if (result.rows.length !== 1) throw new MasterInputError("rank_code must reference an active rank");
}

async function ensureOptionalLocation(locationId: number | null): Promise<void> {
  if (locationId === null) return;
  const result = await pool.query(`SELECT 1 FROM locations WHERE location_id = $1`, [locationId]);
  if (result.rows.length !== 1) throw new MasterInputError("location_id does not reference a location");
}

app.get("/api/masters", async () => {
  const [ranks, staff, locations, duties, units] = await Promise.all([
    pool.query(`SELECT rank_code, name_mr, short_form_mr, cadre, display_order, active FROM ranks ORDER BY display_order, rank_code`),
    pool.query(`SELECT staff_id, name_mr, name_en, rank_code, buckle_no, phone, duty_assignment, weekly_off, active FROM staff_members ORDER BY active DESC, name_mr`),
    pool.query(`SELECT location_id, location_code, name_mr, kind, display_order, active FROM locations ORDER BY display_order, location_code`),
    pool.query(`SELECT duty_id, duty_code, title_mr, section_code, default_shift, location_id, display_order, active FROM duty_definitions ORDER BY display_order, duty_code`),
    pool.query(`SELECT unit_code, name_mr, unit_type, display_order, active FROM units ORDER BY display_order, unit_code`),
  ]);
  return { ranks: ranks.rows, staff: staff.rows, locations: locations.rows, duties: duties.rows, units: units.rows };
});

// Resource reads mirror the aggregate response for callers that manage one
// master tab at a time; the aggregate endpoint remains the page bootstrap path.
app.get("/api/masters/ranks", async () => (await pool.query(
  `SELECT rank_code, name_mr, short_form_mr, cadre, display_order, active FROM ranks ORDER BY display_order, rank_code`,
)).rows);
app.get("/api/masters/staff", async () => (await pool.query(
  `SELECT staff_id, name_mr, name_en, rank_code, buckle_no, phone, duty_assignment, weekly_off, active FROM staff_members ORDER BY active DESC, name_mr`,
)).rows);
app.get("/api/masters/duties", async () => (await pool.query(
  `SELECT duty_id, duty_code, title_mr, section_code, default_shift, location_id, display_order, active FROM duty_definitions ORDER BY display_order, duty_code`,
)).rows);
app.get("/api/masters/locations", async () => (await pool.query(
  `SELECT location_id, location_code, name_mr, kind, display_order, active FROM locations ORDER BY display_order, location_code`,
)).rows);
app.get("/api/masters/units", async () => (await pool.query(
  `SELECT unit_code, name_mr, unit_type, display_order, active FROM units ORDER BY display_order, unit_code`,
)).rows);

// Staff CRUD. name_en remains accepted and returned for the existing chart
// picker contract, but the staff management UI intentionally does not expose
// an English-name field.
app.post("/api/masters/staff", async (req, reply) => {
  try {
    const body = bodyOf(req.body);
    const nameMr = requiredText(body.name_mr, "name_mr");
    const rankCode = codeValue(body.rank_code, "rank_code");
    await ensureActiveRank(rankCode);
    const nameEn = optionalText(body.name_en, "name_en");
    const buckleNo = optionalText(body.buckle_no, "buckle_no", 40);
    const phone = optionalText(body.phone, "phone", 40);
    const dutyAssignment = optionalText(body.duty_assignment ?? body.duty_assignment_mr, "duty_assignment", 160);
    const weeklyOff = optionalText(body.weekly_off ?? body.weekly_off_mr, "weekly_off", 80);
    const result = await pool.query(
      `INSERT INTO staff_members
        (name_mr, name_en, rank_code, buckle_no, phone, duty_assignment, weekly_off, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
       RETURNING staff_id, name_mr, rank_code, buckle_no, phone, duty_assignment, weekly_off, active`,
      [nameMr, nameEn, rankCode, buckleNo, phone, dutyAssignment, weeklyOff],
    );
    return reply.code(201).send({ ...result.rows[0], staff_id: Number(result.rows[0].staff_id) });
  } catch (error) {
    if (error instanceof MasterInputError) return validationReply(reply, error);
    if (pgCode(error) === "23505") return conflictReply(reply, "A staff member with the same rank and buckle/name already exists");
    if (pgCode(error) === "23503") return reply.code(400).send({ error: "rank_code does not reference a valid rank" });
    throw error;
  }
});

const STAFF_PATCH_PARSERS: Record<string, PatchParser> = {
  name_mr: (value) => requiredText(value, "name_mr"),
  name_en: (value) => optionalText(value, "name_en"),
  rank_code: (value) => codeValue(value, "rank_code"),
  buckle_no: (value) => optionalText(value, "buckle_no", 40),
  phone: (value) => optionalText(value, "phone", 40),
  duty_assignment: (value) => optionalText(value, "duty_assignment", 160),
  weekly_off: (value) => optionalText(value, "weekly_off", 80),
  active: (value) => booleanValue(value, "active"),
};

app.patch("/api/masters/staff/:id", async (req, reply) => {
  try {
    const id = positiveId((req.params as { id: string }).id, "staff id");
    const body = bodyOf(req.body);
    const { sets, values } = patchValues(body, STAFF_PATCH_PARSERS);
    const rankValue = hasOwn(body, "rank_code") ? codeValue(body.rank_code, "rank_code") : null;
    if (rankValue) await ensureActiveRank(rankValue);
    values.push(id);
    const result = await pool.query(
      `UPDATE staff_members SET ${sets.join(", ")} WHERE staff_id = $${values.length} RETURNING staff_id`,
      values,
    );
    if (result.rows.length !== 1) return reply.code(404).send({ error: `no staff ${id}` });
    return { ok: true };
  } catch (error) {
    if (error instanceof MasterInputError) return validationReply(reply, error);
    if (pgCode(error) === "23505") return conflictReply(reply, "A staff member with the same rank and buckle/name already exists");
    if (pgCode(error) === "23503") return reply.code(400).send({ error: "rank_code does not reference a valid rank" });
    throw error;
  }
});

app.delete("/api/masters/staff/:id", async (req, reply) => {
  let client: pg.PoolClient | null = null;
  try {
    const id = positiveId((req.params as { id: string }).id, "staff id");
    client = await pool.connect();
    await client.query("BEGIN");
    const staff = await client.query(`SELECT staff_id FROM staff_members WHERE staff_id = $1 FOR UPDATE`, [id]);
    if (staff.rows.length !== 1) {
      await client.query("ROLLBACK");
      return reply.code(404).send({ error: `no staff ${id}` });
    }
    const references = (await client.query(
      `SELECT
        (SELECT count(*)::int FROM daily_assignments WHERE staff_id = $1) AS assignments,
        (SELECT count(*)::int FROM daily_availabilities WHERE staff_id = $1) AS availability,
        (SELECT count(*)::int FROM sudden_duty_changes WHERE original_staff_id = $1 OR replacement_staff_id = $1) AS sudden_changes,
        (SELECT count(*)::int FROM scan_schedule_daily WHERE staff_id = $1) AS scan_rows,
        (SELECT count(*)::int FROM event_assignments WHERE staff_id = $1) AS event_assignments`,
      [id],
    )).rows[0] as Record<string, number>;
    const usedIn = Object.entries(references)
      .filter(([, count]) => Number(count) > 0)
      .map(([name, count]) => `${name.replace(/_/g, " ")} (${count})`);
    if (usedIn.length > 0) {
      await client.query("ROLLBACK");
      return conflictReply(reply, `Cannot delete this staff member; referenced by ${usedIn.join(", ")}. Deactivate the staff member so chart history is preserved.`);
    }
    await client.query(`DELETE FROM staff_members WHERE staff_id = $1`, [id]);
    await client.query("COMMIT");
    return { ok: true, staff_id: id };
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof MasterInputError) return validationReply(reply, error);
    if (pgCode(error) === "23503") return conflictReply(reply, "This staff member is referenced by chart or master data. Deactivate it so history is preserved.");
    throw error;
  } finally {
    client?.release();
  }
});

// Ranks CRUD. rank_code is the stable protected identifier, so updates edit
// profile fields while delete is allowed only when no staff row uses it.
app.post("/api/masters/ranks", async (req, reply) => {
  try {
    const body = bodyOf(req.body);
    const rankCode = codeValue(body.rank_code, "rank_code");
    const nameMr = requiredText(body.name_mr, "name_mr");
    const shortForm = optionalText(body.short_form_mr, "short_form_mr", 80);
    const cadre = validEnum(body.cadre, "cadre", VALID_RANK_CADRES);
    const displayOrder = integerValue(body.display_order, "display_order", 0);
    const active = body.active === undefined ? true : booleanValue(body.active, "active");
    const result = await pool.query(
      `INSERT INTO ranks (rank_code, name_mr, short_form_mr, cadre, display_order, active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING rank_code`,
      [rankCode, nameMr, shortForm, cadre, displayOrder, active],
    );
    return reply.code(201).send(result.rows[0]);
  } catch (error) {
    if (error instanceof MasterInputError) return validationReply(reply, error);
    if (pgCode(error) === "23505") return conflictReply(reply, "That rank code already exists");
    throw error;
  }
});

app.patch("/api/masters/ranks/:code", async (req, reply) => {
  try {
    const code = codeValue(decodeURIComponent((req.params as { code: string }).code), "rank_code");
    const { sets, values } = patchValues(bodyOf(req.body), {
      name_mr: (value) => requiredText(value, "name_mr"),
      short_form_mr: (value) => optionalText(value, "short_form_mr", 80),
      cadre: (value) => validEnum(value, "cadre", VALID_RANK_CADRES),
      display_order: (value) => integerValue(value, "display_order"),
      active: (value) => booleanValue(value, "active"),
    });
    values.push(code);
    const result = await pool.query(`UPDATE ranks SET ${sets.join(", ")} WHERE rank_code = $${values.length} RETURNING rank_code`, values);
    if (result.rows.length !== 1) return reply.code(404).send({ error: `no rank ${code}` });
    return { ok: true };
  } catch (error) {
    if (error instanceof MasterInputError) return validationReply(reply, error);
    throw error;
  }
});

app.delete("/api/masters/ranks/:code", async (req, reply) => {
  try {
    const code = codeValue(decodeURIComponent((req.params as { code: string }).code), "rank_code");
    const references = (await pool.query(
      `SELECT count(*)::int AS staff FROM staff_members WHERE rank_code = $1`, [code],
    )).rows[0] as { staff: number };
    if (Number(references.staff) > 0) return conflictReply(reply, `Cannot delete rank ${code}; ${references.staff} staff member(s) use it. Deactivate the rank instead.`);
    const result = await pool.query(`DELETE FROM ranks WHERE rank_code = $1 RETURNING rank_code`, [code]);
    if (result.rows.length !== 1) return reply.code(404).send({ error: `no rank ${code}` });
    return { ok: true, rank_code: code };
  } catch (error) {
    if (error instanceof MasterInputError) return validationReply(reply, error);
    if (pgCode(error) === "23503") return conflictReply(reply, `Cannot delete rank ${String((req.params as { code: string }).code)} because chart/master data references it. Deactivate it instead.`);
    throw error;
  }
});

// Duties CRUD. duty_code is stable once it is referenced by a chart; edits
// target the display and activation fields. A hard delete is guarded below.
app.post("/api/masters/duties", async (req, reply) => {
  try {
    const body = bodyOf(req.body);
    const dutyCode = codeValue(body.duty_code, "duty_code");
    const titleMr = requiredText(body.title_mr, "title_mr");
    const sectionCode = optionalText(body.section_code, "section_code", 80);
    const defaultShift = body.default_shift === undefined || body.default_shift === null || body.default_shift === ""
      ? null : validEnum(body.default_shift, "default_shift", VALID_SHIFTS);
    const locationId = body.location_id === undefined || body.location_id === null || body.location_id === ""
      ? null : positiveId(body.location_id, "location_id");
    await ensureOptionalLocation(locationId);
    const displayOrder = integerValue(body.display_order, "display_order", 0);
    const active = body.active === undefined ? true : booleanValue(body.active, "active");
    const result = await pool.query(
      `INSERT INTO duty_definitions (duty_code, title_mr, section_code, default_shift, location_id, display_order, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING duty_id`,
      [dutyCode, titleMr, sectionCode, defaultShift, locationId, displayOrder, active],
    );
    return reply.code(201).send({ duty_id: Number(result.rows[0].duty_id) });
  } catch (error) {
    if (error instanceof MasterInputError) return validationReply(reply, error);
    if (pgCode(error) === "23505") return conflictReply(reply, "That duty code already exists");
    if (pgCode(error) === "23503") return reply.code(400).send({ error: "default_shift or location_id is invalid" });
    throw error;
  }
});

app.patch("/api/masters/duties/:id", async (req, reply) => {
  try {
    const id = positiveId((req.params as { id: string }).id, "duty id");
    const body = bodyOf(req.body);
    const { sets, values, parsedByField } = patchValues(body, {
      title_mr: (value) => requiredText(value, "title_mr"),
      section_code: (value) => optionalText(value, "section_code", 80),
      default_shift: (value) => value === null || value === "" ? null : validEnum(value, "default_shift", VALID_SHIFTS),
      location_id: (value) => value === null || value === "" ? null : positiveId(value, "location_id"),
      display_order: (value) => integerValue(value, "display_order"),
      active: (value) => booleanValue(value, "active"),
    });
    if (hasOwn(body, "location_id")) await ensureOptionalLocation(parsedByField.location_id as number | null);
    values.push(id);
    const result = await pool.query(`UPDATE duty_definitions SET ${sets.join(", ")} WHERE duty_id = $${values.length} RETURNING duty_id`, values);
    if (result.rows.length !== 1) return reply.code(404).send({ error: `no duty ${id}` });
    return { ok: true };
  } catch (error) {
    if (error instanceof MasterInputError) return validationReply(reply, error);
    if (pgCode(error) === "23503") return reply.code(400).send({ error: "location_id or default_shift is invalid" });
    throw error;
  }
});

app.delete("/api/masters/duties/:id", async (req, reply) => {
  try {
    const id = positiveId((req.params as { id: string }).id, "duty id");
    const references = (await pool.query(
      `SELECT count(*)::int AS assignments FROM daily_assignments WHERE duty_id = $1`, [id],
    )).rows[0] as { assignments: number };
    if (Number(references.assignments) > 0) return conflictReply(reply, `Cannot delete duty ${id}; ${references.assignments} chart row(s) use it. Deactivate the duty instead.`);
    const result = await pool.query(`DELETE FROM duty_definitions WHERE duty_id = $1 RETURNING duty_id`, [id]);
    if (result.rows.length !== 1) return reply.code(404).send({ error: `no duty ${id}` });
    return { ok: true, duty_id: id };
  } catch (error) {
    if (error instanceof MasterInputError) return validationReply(reply, error);
    if (pgCode(error) === "23503") return conflictReply(reply, `Cannot delete duty ${String((req.params as { id: string }).id)} because chart/master data references it. Deactivate it instead.`);
    throw error;
  }
});

// Locations CRUD. A location may be used as an assignment, charge target,
// scan route, or duty default; all four relationships are included in the
// delete guard so PostgreSQL never turns a clerk action into a vague 500.
app.post("/api/masters/locations", async (req, reply) => {
  try {
    const body = bodyOf(req.body);
    const locationCode = codeValue(body.location_code, "location_code");
    const nameMr = requiredText(body.name_mr, "name_mr");
    const kind = validEnum(body.kind, "kind", VALID_LOCATION_KINDS);
    const displayOrder = integerValue(body.display_order, "display_order", 0);
    const active = body.active === undefined ? true : booleanValue(body.active, "active");
    const result = await pool.query(
      `INSERT INTO locations (location_code, name_mr, kind, display_order, active)
       VALUES ($1,$2,$3,$4,$5) RETURNING location_id`,
      [locationCode, nameMr, kind, displayOrder, active],
    );
    return reply.code(201).send({ location_id: Number(result.rows[0].location_id) });
  } catch (error) {
    if (error instanceof MasterInputError) return validationReply(reply, error);
    if (pgCode(error) === "23505") return conflictReply(reply, "That location code already exists");
    throw error;
  }
});

app.patch("/api/masters/locations/:id", async (req, reply) => {
  try {
    const id = positiveId((req.params as { id: string }).id, "location id");
    const body = bodyOf(req.body);
    const { sets, values } = patchValues(body, {
      name_mr: (value) => requiredText(value, "name_mr"),
      kind: (value) => validEnum(value, "kind", VALID_LOCATION_KINDS),
      display_order: (value) => integerValue(value, "display_order"),
      active: (value) => booleanValue(value, "active"),
    });
    values.push(id);
    const result = await pool.query(`UPDATE locations SET ${sets.join(", ")} WHERE location_id = $${values.length} RETURNING location_id`, values);
    if (result.rows.length !== 1) return reply.code(404).send({ error: `no location ${id}` });
    return { ok: true };
  } catch (error) {
    if (error instanceof MasterInputError) return validationReply(reply, error);
    throw error;
  }
});

app.delete("/api/masters/locations/:id", async (req, reply) => {
  try {
    const id = positiveId((req.params as { id: string }).id, "location id");
    const references = (await pool.query(
      `SELECT
        (SELECT count(*)::int FROM duty_definitions WHERE location_id = $1) AS duties,
        (SELECT count(*)::int FROM daily_assignments WHERE location_id = $1) AS assignments,
        (SELECT count(*)::int FROM location_operational_states WHERE location_id = $1 OR charge_destination_location_id = $1) AS chart_states,
        (SELECT count(*)::int FROM scan_schedule_config WHERE location_id = $1 OR marshal_location_id = $1) AS scan_config`,
      [id],
    )).rows[0] as Record<string, number>;
    const usedIn = Object.entries(references).filter(([, count]) => Number(count) > 0).map(([name, count]) => `${name.replace(/_/g, " ")} (${count})`);
    if (usedIn.length > 0) return conflictReply(reply, `Cannot delete location ${id}; referenced by ${usedIn.join(", ")}. Deactivate the location instead.`);
    const result = await pool.query(`DELETE FROM locations WHERE location_id = $1 RETURNING location_id`, [id]);
    if (result.rows.length !== 1) return reply.code(404).send({ error: `no location ${id}` });
    return { ok: true, location_id: id };
  } catch (error) {
    if (error instanceof MasterInputError) return validationReply(reply, error);
    if (pgCode(error) === "23503") return conflictReply(reply, `Cannot delete location ${String((req.params as { id: string }).id)} because chart/master data references it. Deactivate it instead.`);
    throw error;
  }
});

// Units CRUD. unit_code is stable; routes and assignments are checked before
// a hard delete, while active=false is the history-preserving path.
app.post("/api/masters/units", async (req, reply) => {
  try {
    const body = bodyOf(req.body);
    const unitCode = codeValue(body.unit_code, "unit_code");
    const nameMr = requiredText(body.name_mr, "name_mr");
    const unitType = validEnum(body.unit_type, "unit_type", VALID_UNIT_TYPES);
    const displayOrder = integerValue(body.display_order, "display_order", 0);
    const active = body.active === undefined ? true : booleanValue(body.active, "active");
    const result = await pool.query(
      `INSERT INTO units (unit_code, name_mr, unit_type, display_order, active)
       VALUES ($1,$2,$3,$4,$5) RETURNING unit_code`,
      [unitCode, nameMr, unitType, displayOrder, active],
    );
    return reply.code(201).send(result.rows[0]);
  } catch (error) {
    if (error instanceof MasterInputError) return validationReply(reply, error);
    if (pgCode(error) === "23505") return conflictReply(reply, "That unit code already exists");
    throw error;
  }
});

app.patch("/api/masters/units/:code", async (req, reply) => {
  try {
    const code = codeValue(decodeURIComponent((req.params as { code: string }).code), "unit_code");
    const { sets, values } = patchValues(bodyOf(req.body), {
      name_mr: (value) => requiredText(value, "name_mr"),
      unit_type: (value) => validEnum(value, "unit_type", VALID_UNIT_TYPES),
      display_order: (value) => integerValue(value, "display_order"),
      active: (value) => booleanValue(value, "active"),
    });
    values.push(code);
    const result = await pool.query(`UPDATE units SET ${sets.join(", ")} WHERE unit_code = $${values.length} RETURNING unit_code`, values);
    if (result.rows.length !== 1) return reply.code(404).send({ error: `no unit ${code}` });
    return { ok: true };
  } catch (error) {
    if (error instanceof MasterInputError) return validationReply(reply, error);
    throw error;
  }
});

app.delete("/api/masters/units/:code", async (req, reply) => {
  try {
    const code = codeValue(decodeURIComponent((req.params as { code: string }).code), "unit_code");
    const references = (await pool.query(
      `SELECT
        (SELECT count(*)::int FROM daily_assignments WHERE unit_code = $1) AS assignments,
        (SELECT count(*)::int FROM scan_schedule_config WHERE patrol_unit_code = $1) AS scan_config`,
      [code],
    )).rows[0] as Record<string, number>;
    const usedIn = Object.entries(references).filter(([, count]) => Number(count) > 0).map(([name, count]) => `${name.replace(/_/g, " ")} (${count})`);
    if (usedIn.length > 0) return conflictReply(reply, `Cannot delete unit ${code}; referenced by ${usedIn.join(", ")}. Deactivate the unit instead.`);
    const result = await pool.query(`DELETE FROM units WHERE unit_code = $1 RETURNING unit_code`, [code]);
    if (result.rows.length !== 1) return reply.code(404).send({ error: `no unit ${code}` });
    return { ok: true, unit_code: code };
  } catch (error) {
    if (error instanceof MasterInputError) return validationReply(reply, error);
    if (pgCode(error) === "23503") return conflictReply(reply, `Cannot delete unit ${String((req.params as { code: string }).code)} because chart/master data references it. Deactivate it instead.`);
    throw error;
  }
});

/** One human-readable startup block instead of a stream of JSON: what is running, where, and how
 *  to stop it (user 2026-10-13, items 1 + 4 — “is this normal?” and “make sure you close every
 *  terminal or node process”). */
function banner() {
  const base = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;
  console.log([
    "",
    "  पंचवटी दैनिक कर्तव्य तक्ता — API server",
    "  " + "─".repeat(64),
    "  current UI           http://localhost:3001/dashboard  (npm run demo)",
    `  API                  ${base}/api/charts`,
    `  health              ${base}/health`,
    `  bound to             ${host}:${port}${host === "0.0.0.0" ? "  (reachable from outside this machine — deployment mode)" : "  (loopback only)"}`,
    "  " + "─".repeat(64),
    "  API + Next frontend together:       npm run demo",
    "  API only:                           npm run dev",
    "  per-request log lines:              LOG_LEVEL=info npm run dev",
    "  stop: Ctrl+C   ·   clean up left-over servers: npm run stop",
    "",
  ].join("\n"));
}

/** Ctrl+C must actually stop this process (and free the port) — nothing left behind. */
let closing = false;
const shutdown = async (signal: string) => {
  if (closing) return;
  closing = true;
  console.log(`\n  ${signal} — stopping the chart server …`);
  try { await app.close(); } catch { /* already closed */ }
  try { await pool.end(); } catch { /* pool already drained */ }
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

const start = async () => {
  try {
    await app.listen({ port, host });
    banner();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
start();
