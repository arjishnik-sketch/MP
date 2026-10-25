// Purpose: ONE command for this repo's current API plus Next frontend, with every child reaped when
//   you press Ctrl+C.
// Current role: `npm run demo` starts the root Fastify API on :3100 and this repo's Next frontend on :3001.
// Last meaningful change: 2026-10-19 — made the current supervisor self-contained; legacy reference
//   apps are not part of the current-site startup boundary.
// Constraint/dependency: children are NOT detached and are killed on exit, SIGINT and SIGTERM, so
//   closing this one process leaves nothing behind. Local only — no external service, no data leaves
//   the machine.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stopProjectServers, PROJECT_PORTS } from "./stop-servers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dev = process.argv.includes("--no-watch") ? ["tsx", "server/index.ts"] : ["tsx", "watch", "server/index.ts"];
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

// A stale listener would silently shadow the new one — clean our own ports first and say so.
const stale = stopProjectServers(PROJECT_PORTS);
if (stale.length) console.log(`stopped ${stale.length} stale listener(s): ${stale.join(", ")}`);

const children = [];
const chart = spawn(process.platform === "win32" ? "npx.cmd" : "npx", dev, {
  cwd: root, env: { ...process.env, PORT: String(PROJECT_PORTS[0]) }, stdio: "inherit",
  shell: process.platform === "win32",
});
children.push(chart);

const frontend = spawn(npm, ["--prefix", "frontend", "run", "dev"], {
  cwd: root,
  env: { ...process.env },
  stdio: "inherit",
  shell: process.platform === "win32",
});
children.push(frontend);

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  // any port still held by a child of ours (Windows does not always deliver SIGTERM through to
  // a grandchild) is cleaned explicitly, so nothing is left running after Ctrl+C.
  const left = stopProjectServers(PROJECT_PORTS);
  if (left.length) console.log(`cleaned up ${left.length} leftover listener(s)`);
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("exit", () => { for (const child of children) { if (!child.killed) child.kill(); } });
for (const child of children.slice(0, 2)) child.on("exit", (code) => shutdown(code ?? 0));

console.log(`\nAPI → http://localhost:${PROJECT_PORTS[0]}\nCurrent UI → http://localhost:3001/dashboard  (Ctrl+C stops everything)\n`);
