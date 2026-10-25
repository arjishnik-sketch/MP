import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stopProjectServers, PROJECT_PORTS } from "./stop-servers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

stopProjectServers([...PROJECT_PORTS, 9222]);

const env = {
  ...process.env,
  PGPASSWORD: process.env.PGPASSWORD || "a2192003",
  PORT: "3100",
};

console.log("Starting backend...");
const fastify = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "server/index.ts"], { cwd: root, env, stdio: "pipe", shell: true });
console.log("Starting frontend...");
const nextServer = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["--prefix", "frontend", "run", "start", "--", "-p", "3001"], { cwd: root, env, stdio: "pipe", shell: true });

async function waitForUrl(url, timeoutMs = 35000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
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

async function main() {
  let chromeProc = null;
  try {
    await waitForUrl("http://127.0.0.1:3100/health");
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
    console.log("Connecting to target:", pageTarget.webSocketDebuggerUrl);

    const cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    await cdp.send("Runtime.enable");

    // Test A4 Landscape
    console.log("\n=======================================================");
    console.log("Analyzing A4 Landscape (Target: 297mm × 210mm)");
    console.log("=======================================================");
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:3001/charts/2026-09-10?paper=a4&orient=landscape" });
    await new Promise((r) => setTimeout(r, 4000));

    // Emulate print
    await cdp.send("Emulation.setEmulatedMedia", { media: "print" });

    // Inspect sheets
    const diag = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `
        (() => {
          const sheets = Array.from(document.querySelectorAll('.chart-sheet'));
          return sheets.map((s, idx) => {
            const rect = s.getBoundingClientRect();
            const computed = window.getComputedStyle(s);
            const children = Array.from(s.children).map(c => ({
              tag: c.tagName,
              cls: c.className,
              height: c.getBoundingClientRect().height,
              dataSection: c.getAttribute('data-document-section') || c.id || ''
            }));
            return {
              index: idx,
              id: s.getAttribute('data-document-sheet'),
              offsetHeight: s.offsetHeight,
              scrollHeight: s.scrollHeight,
              rectHeight: rect.height,
              rectWidth: rect.width,
              paddingTop: computed.paddingTop,
              paddingBottom: computed.paddingBottom,
              breakAfter: computed.breakAfter,
              children
            };
          });
        })()
      `,
    });

    console.log("Sheet measurements in print mode:");
    for (const s of diag.result.value) {
      console.log(`Sheet #${s.index + 1} (${s.id}):`);
      console.log(`  Height: ${s.rectHeight.toFixed(1)}px (scrollHeight: ${s.scrollHeight}px), Width: ${s.rectWidth.toFixed(1)}px`);
      console.log(`  breakAfter: ${s.breakAfter}, padding: ${s.paddingTop} / ${s.paddingBottom}`);
      console.log(`  Children:`);
      for (const c of s.children) {
        console.log(`    - ${c.cls || c.tag}: ${c.height.toFixed(1)}px ${c.dataSection ? `(${c.dataSection})` : ''}`);
      }
    }

    const detailDiag = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `
        (() => {
          const avail = document.querySelector('.c1-availability');
          const lanes = avail ? Array.from(avail.querySelectorAll('.c1-flow-lane')).map((l, i) => ({
            lane: i,
            height: l.getBoundingClientRect().height,
            items: Array.from(l.querySelectorAll('.availability-group')).map(g => ({
              category: g.querySelector('h3')?.textContent,
              height: g.getBoundingClientRect().height,
              rows: g.querySelectorAll('.availability-row').length
            }))
          })) : [];

          const noticesSec = document.querySelector('.sheet-sheet-manpower .c1-notices-officers-grid');
          return {
            availLanes: lanes,
            noticesGridHeight: noticesSec ? noticesSec.getBoundingClientRect().height : null
          };
        })()
      `,
    });
    console.log("\nAvailability lanes:", JSON.stringify(detailDiag.result.value.availLanes, null, 2));

    // Now test printing via CDP
    // A4 landscape dimensions in inches: 11.69 x 8.27. Printable height with 6mm margins: 8.27 - (12/25.4) = 7.798 in (~748px at 96dpi)
    const pdfResult = await cdp.send("Page.printToPDF", {
      paperWidth: 11.692,
      paperHeight: 8.267,
      marginTop: 0.236, // 6mm
      marginBottom: 0.236, // 6mm
      marginLeft: 0.315, // 8mm
      marginRight: 0.315, // 8mm
      printBackground: true,
      preferCSSPageSize: true,
    });

    const pdfBufferA4 = Buffer.from(pdfResult.data, "base64");
    const matchesA4 = pdfBufferA4.toString("latin1").match(/\/Type\s*\/Page\b/g);
    console.log(`\nCDP A4 Landscape Page count: ${matchesA4 ? matchesA4.length : 'unknown'}`);

    // Test A3 Landscape
    console.log("\n=======================================================");
    console.log("Analyzing A3 Landscape (Target: 420mm × 297mm)");
    console.log("=======================================================");
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:3001/charts/2026-09-10?paper=a3&orient=landscape" });
    await new Promise((r) => setTimeout(r, 4000));
    const diagA3 = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `
        (() => {
          return Array.from(document.querySelectorAll('.chart-sheet')).map((s, idx) => ({
            index: idx,
            id: s.getAttribute('data-document-sheet'),
            height: s.getBoundingClientRect().height
          }));
        })()
      `,
    });
    console.log("A3 Landscape sheets:", diagA3.result.value);
    const pdfResultA3 = await cdp.send("Page.printToPDF", {
      paperWidth: 16.535,
      paperHeight: 11.692,
      marginTop: 0.236,
      marginBottom: 0.236,
      marginLeft: 0.315,
      marginRight: 0.315,
      printBackground: true,
      preferCSSPageSize: true,
    });
    const pdfBufferA3 = Buffer.from(pdfResultA3.data, "base64");
    const matchesA3 = pdfBufferA3.toString("latin1").match(/\/Type\s*\/Page\b/g);
    console.log(`CDP A3 Landscape Page count: ${matchesA3 ? matchesA3.length : 'unknown'}`);

    // Test A4 Portrait
    console.log("\n=======================================================");
    console.log("Analyzing A4 Portrait (Target: 210mm × 297mm)");
    console.log("=======================================================");
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:3001/charts/2026-09-10?paper=a4&orient=portrait" });
    await new Promise((r) => setTimeout(r, 4000));
    const diagA4P = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `
        (() => {
          return Array.from(document.querySelectorAll('.chart-sheet')).map((s, idx) => ({
            index: idx,
            id: s.getAttribute('data-document-sheet'),
            height: s.getBoundingClientRect().height
          }));
        })()
      `,
    });
    console.log("A4 Portrait sheets:", diagA4P.result.value);
    const pdfResultA4P = await cdp.send("Page.printToPDF", {
      paperWidth: 8.267,
      paperHeight: 11.692,
      marginTop: 0.236,
      marginBottom: 0.236,
      marginLeft: 0.315,
      marginRight: 0.315,
      printBackground: true,
      preferCSSPageSize: true,
    });
    const pdfBufferA4P = Buffer.from(pdfResultA4P.data, "base64");
    const matchesA4P = pdfBufferA4P.toString("latin1").match(/\/Type\s*\/Page\b/g);
    console.log(`CDP A4 Portrait Page count: ${matchesA4P ? matchesA4P.length : 'unknown'}`);

    cdp.close();
  } catch (err) {
    console.error("Diagnosis error:", err);
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
