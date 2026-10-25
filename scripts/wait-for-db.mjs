// Purpose: Fail-safe database readiness probe for deployment and orchestration.
// Repeatedly attempts a lightweight query against PostgreSQL until it is accepting queries
// or the timeout is reached. Essential on platforms like Render where PostgreSQL and web
// services spin up concurrently during blueprint provisioning.

import pg from "pg";

const MAX_RETRIES = Number(process.env.DB_WAIT_RETRIES) || 30;
const RETRY_INTERVAL_MS = Number(process.env.DB_WAIT_INTERVAL_MS) || 2000;

function getClientConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    };
  }

  const host = process.env.PGHOST ?? "127.0.0.1";
  const port = Number(process.env.PGPORT ?? 5432);
  const user = process.env.PGUSER ?? "postgres";
  const password = process.env.PGPASSWORD;
  const database = process.env.PANCHAVATI_DEV_DB ?? process.env.PGDATABASE ?? "panchavati3_dev";

  return {
    host,
    port,
    user,
    database,
    ...(password ? { password } : {}),
    connectionTimeoutMillis: 5000,
  };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDatabase() {
  const config = getClientConfig();
  const targetLabel = process.env.DATABASE_URL ? "DATABASE_URL" : `${config.host}:${config.port}/${config.database}`;
  console.log(`[wait-for-db] Probing PostgreSQL readiness on ${targetLabel}...`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const client = new pg.Client(config);
    try {
      await client.connect();
      await client.query("SELECT 1 AS ready;");
      await client.end();
      console.log(`[wait-for-db] ✔ PostgreSQL is ready and accepting queries (attempt ${attempt}/${MAX_RETRIES}).`);
      return true;
    } catch (err) {
      try {
        await client.end();
      } catch {
        // ignore client cleanup error
      }

      if (attempt === MAX_RETRIES) {
        console.error(`[wait-for-db] ✘ Exhausted all ${MAX_RETRIES} attempts. Last error: ${err.message}`);
        return false;
      }

      console.log(
        `[wait-for-db] Database not ready yet (${err.message}). Retrying in ${RETRY_INTERVAL_MS / 1000}s (attempt ${attempt}/${MAX_RETRIES})...`
      );
      await sleep(RETRY_INTERVAL_MS);
    }
  }

  return false;
}

const ready = await waitForDatabase();
if (!ready) {
  process.exit(1);
}
