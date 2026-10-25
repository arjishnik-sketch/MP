// Applies db/seed/*.sql reference (master) seeds idempotently to the target DB.
// Daily chart data has its own runner (seed-chart-1009.ts).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { makePool, DEV_DB, TEST_DB, isTestRun } from "../server/db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, "seed");

export async function seedReference(pool: pg.Pool): Promise<string[]> {
  const files = fs
    .readdirSync(seedDir)
    .filter((f) => /\.sql$/.test(f))
    .sort();
  const ran: string[] = [];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(seedDir, file), "utf8");
    try {
      await pool.query(sql);
      ran.push(file);
    } catch (err) {
      throw new Error(`Reference seed ${file} failed: ${(err as Error).message}`);
    }
  }
  return ran;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const target = isTestRun() ? TEST_DB : DEV_DB;
  const pool = makePool(target);
  try {
    const ran = await seedReference(pool);
    const counts = await pool.query(`SELECT
      (SELECT count(*) FROM ranks) AS ranks,
      (SELECT count(*) FROM staff_members) AS staff,
      (SELECT count(*) FROM locations) AS locations,
      (SELECT count(*) FROM duty_definitions) AS duties,
      (SELECT count(*) FROM scan_schedule_config) AS scan_cfg,
      (SELECT count(*) FROM template_versions) AS template_versions`);
    console.log(`✔ ${target}: seeds applied ${JSON.stringify(ran)}`);
    console.log(`✔ counts: ${JSON.stringify(counts.rows[0])}`);
  } finally {
    await pool.end();
  }
}
