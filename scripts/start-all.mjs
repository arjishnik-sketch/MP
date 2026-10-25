// Purpose: Production supervisor for single-service full-stack deployment on Render/Docker.
// Starts Fastify API on an internal port and Next.js frontend on the public Render PORT,
// or runs Fastify API alone when RUN_MODE=api.

import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendDir = path.join(root, "frontend");

// 1. If DATABASE_URL is present, run fail-safe wait, migration, and seed automatically
if (process.env.DATABASE_URL) {
  console.log("[supervisor] DATABASE_URL detected: ensuring database is ready and migrated...");
  const waitRes = spawnSync(process.execPath, [path.join(root, "scripts", "wait-for-db.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  if (waitRes.status !== 0) {
    console.error("[supervisor] Database readiness check failed. Exiting.");
    process.exit(1);
  }

  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const migrateScript = path.join(root, "db", "migrate.ts");
  const migrateRes = spawnSync(process.execPath, [tsxCli, migrateScript], {
    cwd: root,
    stdio: "inherit",
  });
  if (migrateRes.status !== 0) {
    console.error("[supervisor] Database migration failed. Exiting.");
    process.exit(1);
  }

  // Run reference seed and chart seed (preserving existing if PANCHAVATI_KEEP_EXISTING=1)
  const seedRefRes = spawnSync(process.execPath, [tsxCli, path.join(root, "db", "seed-reference.ts")], {
    cwd: root,
    stdio: "inherit",
  });
  if (seedRefRes.status !== 0) {
    console.error("[supervisor] Reference seed failed. Exiting.");
    process.exit(1);
  }
  const seedChartRes = spawnSync(process.execPath, [tsxCli, path.join(root, "db", "seed-chart-1009.ts")], {
    cwd: root,
    stdio: "inherit",
  });
  if (seedChartRes.status !== 0) {
    console.error("[supervisor] Chart seed failed. Exiting.");
    process.exit(1);
  }
}

// 2. Check if user explicitly wants API alone
const runMode = (process.env.RUN_MODE || process.env.SERVICE_TYPE || "").toLowerCase();
if (runMode === "api") {
  console.log("[supervisor] RUN_MODE=api: starting Fastify API alone.");
  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const serverScript = path.join(root, "server", "index.ts");
  const api = spawn(process.execPath, [tsxCli, serverScript], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, HOST: process.env.HOST || "0.0.0.0" },
  });
  api.on("exit", (code) => process.exit(code ?? 0));
} else {
  // 3. Ensure frontend dependencies and production build exist before launching Next.js
  const frontendNodeModules = path.join(frontendDir, "node_modules");
  const nextCli = path.join(frontendNodeModules, "next", "dist", "bin", "next");
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

  if (!fs.existsSync(frontendNodeModules) || !fs.existsSync(nextCli)) {
    console.log("[supervisor] frontend/node_modules missing or incomplete! Installing frontend dependencies...");
    const installRes = spawnSync(npmCmd, ["--prefix", "frontend", "ci"], {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (installRes.status !== 0) {
      console.warn("[supervisor] npm ci failed in frontend; falling back to npm install...");
      spawnSync(npmCmd, ["--prefix", "frontend", "install", "--include=dev"], {
        cwd: root,
        stdio: "inherit",
        shell: process.platform === "win32",
      });
    }
  }

  const dotNextDir = path.join(frontendDir, ".next");
  if (!fs.existsSync(dotNextDir)) {
    console.log("[supervisor] frontend/.next production build not found! Building frontend now...");
    const buildRes = spawnSync(npmCmd, ["--prefix", "frontend", "run", "build"], {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (buildRes.status !== 0) {
      console.error("[supervisor] Frontend build failed!");
      process.exit(1);
    }
  }

  // 4. Full-stack single-service deployment ports
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
  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const serverScript = path.join(root, "server", "index.ts");
  const api = spawn(process.execPath, [tsxCli, serverScript], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(internalApiPort),
      HOST: "0.0.0.0",
      FASTIFY_INTERNAL: "1",
    },
  });
  children.push(api);

  // Start Next.js frontend on publicPort
  // Use direct Node executable pointing to Next.js CLI with augmented PATH and cwd
  const frontendEnv = {
    ...process.env,
    PORT: String(publicPort),
    FASTIFY_URL: fastifyUrl,
    NEXT_PUBLIC_API_URL: fastifyUrl,
    PATH: [
      path.join(frontendDir, "node_modules", ".bin"),
      path.join(root, "node_modules", ".bin"),
      process.env.PATH || "",
    ].join(path.delimiter),
  };

  const frontend = fs.existsSync(nextCli)
    ? spawn(process.execPath, [nextCli, "start", "-p", String(publicPort), "-H", "0.0.0.0"], {
        cwd: frontendDir,
        stdio: "inherit",
        env: frontendEnv,
      })
    : spawn(npmCmd, ["--prefix", "frontend", "run", "start", "--", "-p", String(publicPort), "-H", "0.0.0.0"], {
        cwd: frontendDir,
        stdio: "inherit",
        env: frontendEnv,
        shell: process.platform === "win32",
      });
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
