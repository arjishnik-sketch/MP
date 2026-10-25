// npm run doctor — objective local-environment diagnostics (Quasar-derived practice,
// constrained to this repo). Prints ✓/✗ per check with evidence; exit 1 on any failure.
// Checks: Node version, PostgreSQL reachability, both DBs exist, migrations current,
// required tables, template present, seed counts sane, no migration checksum drift.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_DB = process.env.PANCHAVATI_DEV_DB ?? "panchavati3_dev";
const TEST_DB = process.env.PANCHAVATI_TEST_DB ?? "panchavati3_test";

let failures = 0;
const ok = (label, evidence) => console.log(`  ✓ ${label}${evidence ? ` — ${evidence}` : ""}`);
const bad = (label, evidence) => { failures += 1; console.log(`  ✗ ${label}${evidence ? ` — ${evidence}` : ""}`); };

const REQUIRED_TABLES = [
  "schema_migrations", "ranks", "staff_members", "locations", "units", "shifts",
  "duty_definitions", "scan_sessions", "scan_schedule_config",
  "chart_templates", "template_versions",
  "daily_charts", "chart_versions", "daily_assignments", "location_operational_states",
  "daily_availabilities", "sudden_duty_changes", "chart_notices",
  "scan_schedule_daily", "manpower_records", "officer_summary_rows",
  "shift_summary_cells", "special_events", "event_assignments",
];

console.log("panchavati doctor\n");

// 1. Node
{
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 22) ok("Node version", process.versions.node);
  else bad("Node version", `${process.versions.node} (need >=22)`);
}

// 2. Migration files vs applied checksums (file-level, no DB needed for drift shape)
const migrationFiles = fs.readdirSync(path.join(root, "db", "migrations"))
  .filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
if (migrationFiles.length > 0) ok("migration files present", `${migrationFiles.length} files`);
else bad("migration files present", "none found in db/migrations/");

// 3. Per-database checks
for (const dbName of [DEV_DB, TEST_DB]) {
  console.log(`\n${dbName}`);
  const client = new pg.Client({
    host: process.env.PGHOST ?? "127.0.0.1",
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? "postgres",
    database: dbName,
    ...(process.env.PGPASSWORD ? { password: process.env.PGPASSWORD } : {}),
  });
  try {
    await client.connect();
    ok("database reachable", dbName);
  } catch (e) {
    bad("database reachable", `${dbName}: ${e.message}`);
    continue;
  }

  try {
    // migrations current
    const applied = (await client.query(
      "SELECT filename, checksum FROM schema_migrations ORDER BY filename")).rows;
    const appliedNames = new Set(applied.map((r) => r.filename));
    const missing = migrationFiles.filter((f) => !appliedNames.has(f));
    if (missing.length === 0) ok("migrations current", `${applied.length} applied, 0 pending`);
    else bad("migrations current", `pending: ${missing.join(", ")} (run npm run db:migrate)`);

    // checksum drift (never edit an applied migration)
    let drifted = 0;
    for (const row of applied) {
      const p = path.join(root, "db", "migrations", row.filename);
      if (!fs.existsSync(p)) { drifted += 1; continue; }
      const sum = createHash("sha256").update(fs.readFileSync(p, "utf8")).digest("hex");
      if (sum !== row.checksum) drifted += 1;
    }
    if (drifted === 0) ok("no migration checksum drift");
    else bad("no migration checksum drift", `${drifted} applied file(s) changed on disk`);

    // required tables
    const have = new Set((await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows
      .map((r) => r.table_name));
    const absent = REQUIRED_TABLES.filter((t) => !have.has(t));
    if (absent.length === 0) ok("required tables present", `${REQUIRED_TABLES.length} tables`);
    else bad("required tables present", `missing: ${absent.join(", ")}`);

    if (have.has("template_versions")) {
      const tv = await client.query("SELECT count(*)::int AS n FROM template_versions");
      if (tv.rows[0].n >= 1) ok("template version exists", `${tv.rows[0].n}`);
      else bad("template version exists", "0 — run npm run db:seed:reference");
    }

    if (have.has("staff_members")) {
      const c = (await client.query(`SELECT
        (SELECT count(*) FROM ranks)::int AS ranks,
        (SELECT count(*) FROM staff_members)::int AS staff,
        (SELECT count(*) FROM locations)::int AS locations,
        (SELECT count(*) FROM duty_definitions)::int AS duties,
        (SELECT count(*) FROM scan_schedule_config)::int AS scan_cfg`)).rows[0];
      const sane = c.ranks >= 10 && c.staff >= 100 && c.locations >= 10 && c.duties >= 40 && c.scan_cfg >= 12;
      const ev = `ranks=${c.ranks} staff=${c.staff} locations=${c.locations} duties=${c.duties} scan_cfg=${c.scan_cfg}`;
      if (sane) ok("seed counts sane", ev);
      else bad("seed counts sane", `${ev} — run npm run db:seed:reference`);
    }

    if (have.has("daily_charts")) {
      const ch = await client.query(
        `SELECT count(*)::int AS n FROM daily_charts WHERE chart_date='2026-09-10'`);
      if (ch.rows[0].n === 1) ok("10/09 chart seeded", "present");
      else if (dbName === TEST_DB) bad("10/09 chart seeded", "missing — run NODE_ENV=test npm run db:seed:chart");
      else ok("10/09 chart seeded", "missing (dev chart seed is run-on-demand)");
    }
  } catch (e) {
    bad("database checks", e.message);
  } finally {
    await client.end();
  }
}

console.log("");
if (failures > 0) {
  console.log(`doctor: ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("doctor: all checks passed");
