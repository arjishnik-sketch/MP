import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stopProjectServers, PROJECT_PORTS } from "./stop-servers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "optimaization finalisation");
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
if (!fs.existsSync(chromePath)) {
  console.error("Chrome not found at:", chromePath);
  process.exit(1);
}

// 1. Clean stale port listeners
stopProjectServers([...PROJECT_PORTS, 9222]);

const env = {
  ...process.env,
  PGPASSWORD: process.env.PGPASSWORD || "a2192003",
  PORT: "3100",
};

console.log("Starting Fastify API on :3100...");
const fastify = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsx", "server/index.ts"],
  { cwd: root, env, stdio: "pipe", shell: true }
);

fastify.stdout.on("data", (d) => process.stdout.write(`[fastify] ${d}`));
fastify.stderr.on("data", (d) => process.stderr.write(`[fastify] ${d}`));

console.log("Starting Next.js frontend on :3001...");
const nextServer = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["--prefix", "frontend", "run", "start", "--", "-p", "3001"],
  { cwd: root, env, stdio: "pipe", shell: true }
);

nextServer.stdout.on("data", (d) => process.stdout.write(`[next] ${d}`));
nextServer.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));

async function waitForUrl(url, timeoutMs = 35000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`✓ Reached ${url} (status ${res.status})`);
        return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
  }
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    this.ws.close();
  }
}

function getPdfPageCount(buffer) {
  const matches = buffer.toString("latin1").match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : 0;
}

async function main() {
  let chromeProc = null;
  try {
    console.log("Waiting for backend and frontend services...");
    await waitForUrl("http://127.0.0.1:3100/health");
    await waitForUrl("http://127.0.0.1:3100/api/charts/2026-09-10");
    await waitForUrl("http://127.0.0.1:3001/charts/2026-09-10");

    console.log("Starting Chrome with remote debugging on port 9222...");
    chromeProc = spawn(chromePath, [
      "--headless=new",
      "--disable-gpu",
      "--window-size=1600,1200",
      "--remote-debugging-port=9222",
      "about:blank",
    ]);

    await waitForUrl("http://127.0.0.1:9222/json/version");
    const targetsRes = await fetch("http://127.0.0.1:9222/json/list");
    const targets = await targetsRes.json();
    const pageTarget = targets.find((t) => t.type === "page") || targets[0];
    console.log("Connecting to Chrome target:", pageTarget.webSocketDebuggerUrl);

    const cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Runtime.enable");

    console.log("\n=======================================================");
    console.log("Generating Rendered PDFs in 'optimaization finalisation'");
    console.log("=======================================================");

    // 1. A4 Landscape
    const a4LandscapePdf = path.join(outDir, "Panchavati_Daily_Duty_10_09_A4_Landscape.pdf");
    console.log(`\n→ Generating: ${path.basename(a4LandscapePdf)}`);
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:3001/charts/2026-09-10?paper=a4&orient=landscape" });
    await new Promise((r) => setTimeout(r, 4000));
    const pdfResA4L = await cdp.send("Page.printToPDF", {
      paperWidth: 11.692,
      paperHeight: 8.267,
      marginTop: 0.236, // 6mm
      marginBottom: 0.236, // 6mm
      marginLeft: 0.315, // 8mm
      marginRight: 0.315, // 8mm
      printBackground: true,
      preferCSSPageSize: true,
    });
    const bufA4L = Buffer.from(pdfResA4L.data, "base64");
    fs.writeFileSync(a4LandscapePdf, bufA4L);
    const countA4L = getPdfPageCount(bufA4L);
    console.log(`  ✓ Written: ${a4LandscapePdf} (${bufA4L.length} bytes, ${countA4L} physical pages)`);

    // 2. A3 Landscape
    const a3LandscapePdf = path.join(outDir, "Panchavati_Daily_Duty_10_09_A3_Landscape.pdf");
    console.log(`\n→ Generating: ${path.basename(a3LandscapePdf)}`);
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:3001/charts/2026-09-10?paper=a3&orient=landscape" });
    await new Promise((r) => setTimeout(r, 4000));
    const pdfResA3L = await cdp.send("Page.printToPDF", {
      paperWidth: 16.535,
      paperHeight: 11.692,
      marginTop: 0.236,
      marginBottom: 0.236,
      marginLeft: 0.315,
      marginRight: 0.315,
      printBackground: true,
      preferCSSPageSize: true,
    });
    const bufA3L = Buffer.from(pdfResA3L.data, "base64");
    fs.writeFileSync(a3LandscapePdf, bufA3L);
    const countA3L = getPdfPageCount(bufA3L);
    console.log(`  ✓ Written: ${a3LandscapePdf} (${bufA3L.length} bytes, ${countA3L} physical pages)`);

    // 3. A4 Portrait
    const a4PortraitPdf = path.join(outDir, "Panchavati_Daily_Duty_10_09_A4_Portrait.pdf");
    console.log(`\n→ Generating: ${path.basename(a4PortraitPdf)}`);
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:3001/charts/2026-09-10?paper=a4&orient=portrait" });
    await new Promise((r) => setTimeout(r, 4000));
    const pdfResA4P = await cdp.send("Page.printToPDF", {
      paperWidth: 8.267,
      paperHeight: 11.692,
      marginTop: 0.236,
      marginBottom: 0.236,
      marginLeft: 0.315,
      marginRight: 0.315,
      printBackground: true,
      preferCSSPageSize: true,
    });
    const bufA4P = Buffer.from(pdfResA4P.data, "base64");
    fs.writeFileSync(a4PortraitPdf, bufA4P);
    const countA4P = getPdfPageCount(bufA4P);
    console.log(`  ✓ Written: ${a4PortraitPdf} (${bufA4P.length} bytes, ${countA4P} physical pages)`);

    console.log("\n=======================================================");
    console.log("Generating High-Resolution Review Sample Screenshots");
    console.log("=======================================================");

    // Sample 1: A4 Landscape Paginated Preview
    const sampleA4 = path.join(outDir, "sample_A4_landscape_preview.png");
    console.log(`\n→ Generating: ${path.basename(sampleA4)}`);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1800, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:3001/charts/2026-09-10?paper=a4&orient=landscape" });
    await new Promise((r) => setTimeout(r, 3500));
    const shotA4 = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(sampleA4, Buffer.from(shotA4.data, "base64"));
    console.log(`  ✓ Saved: ${sampleA4}`);

    // Sample 2: A3 Landscape Master Preview
    const sampleA3 = path.join(outDir, "sample_A3_landscape_preview.png");
    console.log(`\n→ Generating: ${path.basename(sampleA3)}`);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 1800, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:3001/charts/2026-09-10?paper=a3&orient=landscape" });
    await new Promise((r) => setTimeout(r, 3500));
    const shotA3 = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(sampleA3, Buffer.from(shotA3.data, "base64"));
    console.log(`  ✓ Saved: ${sampleA3}`);

    // Sample 3: Fluid Continuous Reduced-Scroll Workspace View
    const sampleContinuous = path.join(outDir, "sample_continuous_workspace_preview.png");
    console.log(`\n→ Generating: ${path.basename(sampleContinuous)}`);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1540, height: 1800, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:3001/charts/2026-09-10?view=continuous" });
    await new Promise((r) => setTimeout(r, 3500));
    const shotCont = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(sampleContinuous, Buffer.from(shotCont.data, "base64"));
    console.log(`  ✓ Saved: ${sampleContinuous}`);

    // Sample 4: Close-up of Sheet 4 (Availability in 4 subcolumns)
    const sampleSheet4 = path.join(outDir, "sample_sheet4_availability_subcolumns.png");
    console.log(`\n→ Generating: ${path.basename(sampleSheet4)}`);
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:3001/charts/2026-09-10?paper=a4&orient=landscape" });
    await new Promise((r) => setTimeout(r, 3500));
    await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const s4 = document.querySelector('[data-document-sheet="sheet-availability"]');
          if (s4) s4.scrollIntoView();
        })()
      `,
    });
    await new Promise((r) => setTimeout(r, 800));
    const shotS4 = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(sampleSheet4, Buffer.from(shotS4.data, "base64"));
    console.log(`  ✓ Saved: ${sampleSheet4}`);

    cdp.close();
    console.log("\n=======================================================");
    console.log("ALL ARTIFACTS GENERATED SUCCESSFULLY!");
    console.log(`Summary:`);
    console.log(`  - A4 Landscape PDF: ${countA4L} pages (Target: 6 pages)`);
    console.log(`  - A3 Landscape PDF: ${countA3L} pages (Target: 6 pages)`);
    console.log(`  - A4 Portrait PDF:  ${countA4P} pages (Target: 6 pages)`);
    console.log(`  - 4 High-Resolution Screenshots in 'optimaization finalisation'`);
    console.log("=======================================================");
  } catch (err) {
    console.error("Artifact generation error:", err);
  } finally {
    if (chromeProc) {
      try { chromeProc.kill(); } catch {}
    }
    try { fastify.kill(); } catch {}
    try { nextServer.kill(); } catch {}
    stopProjectServers([...PROJECT_PORTS, 9222]);
    process.exit(0);
  }
}

main();
