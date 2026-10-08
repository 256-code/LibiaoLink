#!/usr/bin/env node
// b6 深测：签名后篡改客户端 config 为 edit（token 仍 view）
// 流程：c0（合法 edit token，阳性对照，证明输入路径有效）→ c0v 重开核验；
//       c1（view token + 客户端篡改 edit）→ 尝试输入 → c1v（同 key 视图重开）核验服务端是否接受变更
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { presignGet, signJwt, buildConfig, VIEW_PERMISSIONS } from "./poclib.mjs";

const ROOT = process.env.POC10_ROOT ?? "D:/poc10-onlyoffice";
const SHOT_DIR = ROOT + "/shots";
const LOG_DIR = ROOT + "/logs";
const DOCSRV = process.env.POC10_DOCSRV ?? "http://127.0.0.1:8001";
const INTERNAL_S3 = process.env.POC10_INTERNAL_S3 ?? "http://libiaolink-minio:9000";
const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const SECRET = process.env.POC10_JWT_SECRET;
if (!SECRET) { console.error("缺少 POC10_JWT_SECRET"); process.exit(2); }
mkdirSync(SHOT_DIR, { recursive: true });
mkdirSync(LOG_DIR, { recursive: true });
const PORT_HTTP = Number(process.env.POC10_HTTP_PORT ?? 8091);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => Date.now().toString(36) + randomBytes(2).toString("hex");

const cases = new Map();
function pageHtml(id) {
  const jsonId = JSON.stringify(id);
  return [
    "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"></head>",
    "<body style=\"margin:0\"><div id=\"placeholder\" style=\"height:100vh\"></div><script>",
    "window.__poc10 = { caseId: " + jsonId + ", status: \"loading\", t0: performance.now(), errors: [] };",
    "fetch('/api/config/' + encodeURIComponent(" + jsonId + ")).then(r => r.json()).then(function (body) {",
    "  var s = document.createElement('script');",
    "  s.src = '" + DOCSRV + "/web-apps/apps/api/documents/api.js';",
    "  s.onload = function () { var cfg = body.config;",
    "    cfg.events = { onDocumentReady: function () { window.__poc10.status = 'ready'; window.__poc10.readyAt = performance.now(); },",
    "      onError: function (e) { window.__poc10.errors.push('onError: ' + JSON.stringify((e && e.data) || e)); if (window.__poc10.status === 'loading') window.__poc10.status = 'error'; } };",
    "    window.__poc10.docKey = cfg.document && cfg.document.key;",
    "    new DocsAPI.DocEditor('placeholder', cfg); };",
    "  s.onerror = function () { window.__poc10.status = 'error'; }; document.head.appendChild(s);",
    "}).catch(function (e) { window.__poc10.status = 'error'; window.__poc10.errors.push('' + e); });",
    "</script></body></html>",
  ].join("\n");
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://127.0.0.1");
  if (u.pathname.startsWith("/api/config/")) {
    const id = decodeURIComponent(u.pathname.slice("/api/config/".length));
    const c = cases.get(id);
    if (!c) { res.writeHead(404); res.end("{}"); return; }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ config: c.config })); return;
  }
  if (u.pathname.startsWith("/v/")) {
    const id = decodeURIComponent(u.pathname.slice(3));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pageHtml(id)); return;
  }
  res.writeHead(404); res.end("nf");
});
await new Promise((r) => server.listen(PORT_HTTP, "127.0.0.1", r));

class CDP {
  constructor(ws) { this.ws = ws; this.seq = 0; this.pending = new Map(); this.closed = false; }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const c = new CDP(ws);
      ws.onopen = () => {
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id !== undefined && c.pending.has(m.id)) {
            const p = c.pending.get(m.id); c.pending.delete(m.id);
            if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result);
          }
        };
        resolve(c);
      };
      ws.onerror = () => reject(new Error("ws fail"));
      ws.onclose = () => { for (const [, p] of c.pending) p.rej(new Error("closed")); c.pending.clear(); c.closed = true; };
    });
  }
  send(method, params = {}, timeoutMs = 15000) {
    if (this.closed) return Promise.reject(new Error("closed"));
    const id = ++this.seq;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error("timeout " + method)); }, timeoutMs);
      this.pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}
async function startBrowser(port) {
  const profile = ROOT + "/data/edge-" + port + "-" + stamp();
  const proc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-dev-shm-usage", "--disable-extensions", "--mute-audio", "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
  let version = null;
  for (let i = 0; i < 60 && !version; i++) { await sleep(500); try { const r = await fetch("http://127.0.0.1:" + port + "/json/version"); if (r.ok) version = await r.json(); } catch {} }
  if (!version) throw new Error("Edge 未就绪: " + port);
  return { proc, browser: await CDP.connect(version.webSocketDebuggerUrl), port, profile };
}
async function openAndWait(b, id, timeoutMs = 60000) {
  const { targetId } = await b.browser.send("Target.createTarget", { url: "http://127.0.0.1:" + PORT_HTTP + "/v/" + encodeURIComponent(id) });
  let pageWs = null;
  for (let i = 0; i < 40 && !pageWs; i++) { try { const list = await (await fetch("http://127.0.0.1:" + b.port + "/json/list")).json(); const t = list.find((x) => x.id === targetId); if (t) pageWs = t.webSocketDebuggerUrl; } catch {} if (!pageWs) await sleep(250); }
  const page = await CDP.connect(pageWs);
  await page.send("Runtime.enable");
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await page.send("Runtime.evaluate", { expression: "JSON.stringify(window.__poc10 || null)", returnByValue: true }).catch(() => null);
    const v = r && r.result && r.result.value ? JSON.parse(r.result.value) : null;
    if (v) { last = v; if (["ready", "error", "loaded"].includes(v.status)) break; }
    await sleep(1200);
  }
  return { page, targetId, last, id };
}
async function shot(page, name) {
  const s = await page.send("Page.captureScreenshot", { format: "png" });
  const p = SHOT_DIR + "/" + name + ".png";
  writeFileSync(p, Buffer.from(s.data, "base64"));
  return p;
}
async function typeAt(page, x, y, text) {
  await page.send("Page.enable");
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(700);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 2 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 2 });
  await sleep(700);
  await page.send("Input.insertText", { text });
  await sleep(500);
  for (const ch of text.slice(1)) { await page.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch }); await page.send("Input.dispatchKeyEvent", { type: "keyUp" }); await sleep(40); }
}

const f = { objectKey: "poc10/fixtures/poc10-doc-a.docx", fileType: "docx", docType: "word", title: "poc10-doc-a.docx" };
const url = await presignGet(f.objectKey, 900, INTERNAL_S3);
const mk = (key) => buildConfig({ key, url, fileType: f.fileType, docType: f.docType, title: f.title });
const exp = Math.floor(Date.now() / 1000) + 900;

const k0 = "poc10-b6t-c0-" + stamp();
const editCfg = mk(k0);
editCfg.editorConfig.mode = "edit";
editCfg.permissions = { ...VIEW_PERMISSIONS, edit: true };
const token0 = signJwt({ ...editCfg, exp }, SECRET);
cases.set("c0", { config: { ...editCfg, token: token0 } });
cases.set("c0v", { config: { ...mk(k0), token: token0 } });

const k1 = "poc10-b6t-c1-" + stamp();
const viewCfg = mk(k1);
const token1 = signJwt({ ...viewCfg, exp }, SECRET);
const tampered = { ...viewCfg, token: token1, editorConfig: { ...viewCfg.editorConfig, mode: "edit" }, permissions: { ...VIEW_PERMISSIONS, edit: true } };
cases.set("c1", { config: tampered });
cases.set("c1v", { config: { ...mk(k1), token: token1 } });

const out = { at: new Date().toISOString(), key0: k0, key1: k1, steps: [] };
const b = await startBrowser(9450);

async function phase(tag, openId, verifyId) {
  const o = await openAndWait(b, openId);
  out.steps.push({ step: tag + "-open", id: openId, status: o.last?.status, errors: o.last?.errors });
  if ((o.last?.status ?? "") === "ready") {
    out.steps.push({ step: tag + "-before", shot: await shot(o.page, "b6t-" + tag + "-before") });
    await typeAt(o.page, 640, 92, "B6EDITPROBE");
    await sleep(2500);
    out.steps.push({ step: tag + "-typed", shot: await shot(o.page, "b6t-" + tag + "-typed") });
    const v = await openAndWait(b, verifyId);
    await sleep(2500);
    out.steps.push({ step: tag + "-verify", id: verifyId, status: v.last?.status, shot: await shot(v.page, "b6t-" + tag + "-reopen") });
  } else {
    out.steps.push({ step: tag + "-skip", reason: "not-ready" });
  }
}

await phase("c0", "c0", "c0v");
await phase("c1", "c1", "c1v");

console.log(JSON.stringify(out, null, 2));
writeFileSync(LOG_DIR + "/b6type.json", JSON.stringify(out, null, 2));
try { b.browser.ws.close(); } catch {}
try { b.proc.kill(); } catch {}
try { rmSync(b.profile, { recursive: true, force: true }); } catch {}
await new Promise((r) => server.close(r));
process.exit(0);
