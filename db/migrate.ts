// Forward-only migration runner. Applies db/migrations/NNNN_*.sql in filename order,
// records each in schema_migrations, and refuses to run applied files that changed
// (never edit an applied migration — AGENTS.md; add a new file instead).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type pg from "pg";
import { makePool, DEV_DB, TEST_DB, isTestRun } from "../server/db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "migrations");

// Render's free Postgres requires TLS. Request it explicitly for every connection pool
// (the pool config alone does not always force it on the Node 26 pg driver).
// Scoped to DATABASE_URL: this module is imported by tests and local tooling, and forcing
// sslmode=require there breaks local trust-auth PostgreSQL ("server does not support SSL
// connections" → the whole invariants suite fails). Render always sets DATABASE_URL, so the
// deploy path is unchanged.
if (process.env.DATABASE_URL && !/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(process.env.DATABASE_URL)) {
  process.env.PGSSLMODE = "require";
}

export async function migrate(pool: pg.Pool): Promise<string[]> {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
  if (files.length === 0) throw new Error(`No migrations found in ${migrationsDir}`);

  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const applied = new Map(
    (await pool.query("SELECT filename, checksum FROM schema_migrations")).rows.map(
      (r) => [r.filename, r.checksum] as const,
    ),
  );

  const ran: string[] = [];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const prior = applied.get(file);
    if (prior) {
      if (prior !== checksum) {
        throw new Error(
          `Migration ${file} was applied with a different checksum — applied migrations are immutable; add a new migration instead.`,
        );
      }
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [
        file,
        checksum,
      ]);
      await client.query("COMMIT");
      ran.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return ran;
}

// CLI entry: migrate the DB this process targets (test env → test DB).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const target = isTestRun() ? TEST_DB : DEV_DB;
  const pool = makePool(target);
  try {
    const ran = await migrate(pool);
    console.log(ran.length ? `✔ ${target}: applied ${ran.join(", ")}` : `✔ ${target}: up to date`);
  } finally {
    await pool.end();
  }
}
