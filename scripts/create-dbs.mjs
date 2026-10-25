// Creates the new rebuild databases if missing (T6: old panchavati*_dev/test DBs stay untouched).
// Local PostgreSQL only; fails loudly on connection problems.
import pg from "pg";

const base = {
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  ...(process.env.PGPASSWORD ? { password: process.env.PGPASSWORD } : {}),
};

const wanted = [
  process.env.PANCHAVATI_DEV_DB ?? "panchavati3_dev",
  process.env.PANCHAVATI_TEST_DB ?? "panchavati3_test",
];

const admin = new pg.Client({ ...base, database: "postgres" });
try {
  await admin.connect();
  for (const db of wanted) {
    const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [db]);
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${db}"`);
      console.log(`✔ created ${db}`);
    } else {
      console.log(`✔ ${db} already exists`);
    }
  }
} catch (err) {
  console.error(`✘ cannot reach PostgreSQL at ${base.host}:${base.port} as ${base.user}: ${err.message}`);
  process.exitCode = 1;
} finally {
  await admin.end();
}
