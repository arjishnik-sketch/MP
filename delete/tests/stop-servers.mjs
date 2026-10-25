// Purpose: stop the servers THIS repo starts, so no stale node process survives a session —
//   user 2026-10-13: “Make sure you close every terminal or node processes you open … Even if I
//   close freebuff, still those continue to run, bad.”
// Current role: `npm run stop` (this repo's API/frontend/reference ports) and `npm run stop:all` (every node process,
//   the taskkill /F /IM node.exe the user asked for).
// Last meaningful change: 2026-10-13 — created with the supervisor/demo scripts.
// Constraint/dependency: default mode touches ONLY the ports this project owns (this repo's API,
//   Next frontend and optional legacy reference apps). `--all` is explicit and never the default, so an
//   unrelated node process is never swept by accident.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** The ports this project owns: current API + Next frontend + optional legacy reference apps. */
// `PORT` can be present-but-empty in some shells (Number("") === 0, which would silently make the
// script look at port 0 and report “nothing was listening” while a real server kept running) —
// the same trap server/index.ts guards against.
export const PROJECT_PORTS = [
  Number(process.env.PORT) || 3100,
  Number(process.env.FRONTEND_PORT) || 3001,
  Number(process.env.LEGACY_PORT) || 3101,
  Number(process.env.LEGACY2_PORT) || 3102,
];

/** PIDs currently LISTENING on any of the given ports (empty when nothing is up). */
export function listeningPids(ports = PROJECT_PORTS) {
  const wanted = new Set(ports);
  const pids = new Set();
  if (process.platform === "win32") {
    const res = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
    for (const line of (res.stdout ?? "").split(/\r?\n/)) {
      const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/);
      if (m && wanted.has(Number(m[1]))) pids.add(Number(m[2]));
    }
  } else {
    const args = ports.flatMap((p) => ["-i", `:${p}`]);
    const res = spawnSync("lsof", ["-t", "-sTCP:LISTEN", ...args], { encoding: "utf8" });
    for (const pid of (res.stdout ?? "").split(/\s+/)) {
      if (/^\d+$/.test(pid)) pids.add(Number(pid));
    }
  }
  return [...pids];
}

/** Kill one PID (SIGKILL on Windows via taskkill, SIGTERM elsewhere). Returns true on success. */
export function killPid(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  if (process.platform === "win32") {
    return spawnSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "ignore" }).status === 0;
  }
  return spawnSync("kill", ["-TERM", String(pid)], { stdio: "ignore" }).status === 0;
}

/** Stop everything listening on this project's ports. Returns the PIDs that were killed. */
export function stopProjectServers(ports = PROJECT_PORTS) {
  const killed = [];
  for (const pid of listeningPids(ports)) {
    if (killPid(pid)) killed.push(pid);
  }
  return killed;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  if (process.argv.includes("--all")) {
    console.log("stopping EVERY node process (taskkill /F /IM node.exe) …");
    const res = process.platform === "win32"
      ? spawnSync("taskkill", ["/F", "/IM", "node.exe"], { stdio: "inherit" })
      : spawnSync("pkill", ["-u", String(process.getuid?.() ?? ""), "node"], { stdio: "inherit" });
    process.exit(res.status ?? 1);
  }
  const killed = stopProjectServers();
  console.log(killed.length
    ? `stopped ${killed.length} server process(es) on ports ${PROJECT_PORTS.join(", ")}: ${killed.join(", ")}`
    : `nothing was listening on ports ${PROJECT_PORTS.join(", ")} — already clean`);
}
