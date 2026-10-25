// Purpose: Production supervisor for single-service full-stack deployment.
// Starts Fastify API on an internal port and Next.js frontend on the public Render PORT,
// or runs Fastify API alone when RUN_MODE=api.

import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 1. If DATABASE_URL is present, run fail-safe wait, migration, and seed automatically
if (process.env.DATABASE_URL) {
  console.log("[supervisor] DATABASE_URL detected: ensuring database is ready and migrated...");
  const waitRes = spawnSync("node", ["scripts/wait-for-db.mjs"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (waitRes.status !== 0) {
    console.error("[supervisor] Database readiness check failed. Exiting.");
    process.exit(1);
  }

  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const migrateRes = spawnSync(npxCmd, ["tsx", "db/migrate.ts"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (migrateRes.status !== 0) {
    console.error("[supervisor] Database migration failed. Exiting.");
    process.exit(1);
  }

  // Run reference seed and chart seed (preserving existing if PANCHAVATI_KEEP_EXISTING=1)
  spawnSync(npxCmd, ["tsx", "db/seed-reference.ts"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  spawnSync(npxCmd, ["tsx", "db/seed-chart-1009.ts"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

// 2. Check if user explicitly wants API alone
const runMode = (process.env.RUN_MODE || process.env.SERVICE_TYPE || "").toLowerCase();
if (runMode === "api") {
  console.log("[supervisor] RUN_MODE=api: starting Fastify API alone.");
  const api = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsx", "server/index.ts"],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, HOST: process.env.HOST || "0.0.0.0" },
      shell: process.platform === "win32",
    }
  );
  api.on("exit", (code) => process.exit(code ?? 0));
} else {
  // 3. Full-stack single-service deployment
  const publicPort = Number(process.env.PORT) || 3000;
  // If public port is 3100, use 3101 for Fastify internal port to avoid collision
  const internalApiPort = publicPort === 3100 ? 3101 : 3100;

  console.log(`[supervisor] Starting Panchavati Daily Duty full-stack service.`);
  console.log(`[supervisor] Public frontend listening on 0.0.0.0:${publicPort}`);
  console.log(`[supervisor] Internal Fastify API listening on 0.0.0.0:${internalApiPort}`);

  // Set FASTIFY_URL for Next.js rewrites to the internal API port
  const fastifyUrl = `http://127.0.0.1:${internalApiPort}`;

  const children = [];

  // Start Fastify API on internalApiPort
  const api = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsx", "server/index.ts"],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: String(internalApiPort),
        HOST: "0.0.0.0",
        FASTIFY_INTERNAL: "1",
      },
      shell: process.platform === "win32",
    }
  );
  children.push(api);

  // Start Next.js frontend on publicPort
  const frontend = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["--prefix", "frontend", "run", "start"],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: String(publicPort),
        FASTIFY_URL: fastifyUrl,
        NEXT_PUBLIC_API_URL: fastifyUrl,
      },
      shell: process.platform === "win32",
    }
  );
  children.push(frontend);

  let closing = false;
  function shutdown(code = 0) {
    if (closing) return;
    closing = true;
    for (const child of children) {
      if (!child.killed) child.kill("SIGTERM");
    }
    process.exit(code);
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  for (const child of children) {
    child.on("exit", (code) => shutdown(code ?? 0));
  }
}
