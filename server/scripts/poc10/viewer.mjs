#!/usr/bin/env node
// PoC-10 查看器驱动：无头 Edge（Chromium）+ 裸 CDP，零新增依赖
// 用法：
//   node viewer.mjs single [--file docx|xlsx] [--label a1] [--shot]
//   node viewer.mjs burst  --n 20 [--file mix|docx|xlsx] [--hold 0] [--label a2] [--shot-every 10] [--timeout 420]
//   node viewer.mjs tamper [--cases b1,b2,b3a,b3b,b4,b5,b6,b7] [--label b]
// 依赖环境：POC10_JWT_SECRET（查看器 JWT 密钥，本地生成不入库）；S3_* 来自 server/.env；
//   端点可用 POC10_ROOT / POC10_DOCSRV / POC10_INTERNAL_S3 / POC10_HTTP_PORT / EDGE_PATH 覆盖。
import { spawn, execFile } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { presignGet, signJwt, signJwtAlgNone, tamperTokenPayload, buildConfig } from "./poclib.mjs";

const ROOT = process.env.POC10_ROOT ?? "D:/poc10-onlyoffice";
const SHOT_DIR = ROOT + "/shots";
const LOG_DIR = ROOT + "/logs";
const DOCSRV = process.env.POC10_DOCSRV ?? "http://127.0.0.1:8001";
const INTERNAL_S3 = process.env.POC10_INTERNAL_S3 ?? "http://libiaolink-minio:9000";
const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const SECRET = process.env.POC10_JWT_SECRET;
const PORT_HTTP = Number(process.env.POC10_HTTP_PORT ?? 8090);
if (!SECRET) { console.error("缺少 POC10_JWT_SECRET"); process.exit(2); }

mkdirSync(SHOT_DIR, { recursive: true });
mkdirSync(LOG_DIR, { recursive: true });

const argv = process.argv.slice(2);
const MODE = argv[0];
function opt(name, def) {
  const i = argv.indexOf("--" + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => Date.now().toString(36) + randomBytes(2).toString("hex");
const sanitize = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, "_");

const FIX = {
  docx: { objectKey: "poc10/fixtures/poc10-doc-a.docx", fileType: "docx", docType: "word", title: "poc10-doc-a.docx" },
  docxB: { objectKey: "poc10/fixtures/poc10-doc-a2.docx", fileType: "docx", docType: "word", title: "poc10-doc-a2.docx" },
  xlsx: { objectKey: "poc10/fixtures/poc10-book-b.xlsx", fileType: "xlsx", docType: "cell", title: "poc10-book-b.xlsx" },
};

const cases = new Map();

function buildConfigWith({ f, url, key }) {
  return buildConfig({ key, url, fileType: f.fileType, docType: f.docType, title: f.title });
}
function withToken(cfg, o = {}) {
  const payload = JSON.parse(JSON.stringify(cfg));
  payload.exp = Math.floor(Date.now() / 1000) + (o.expSec ?? 900);
  if (o.preSignMutate) o.preSignMutate(payload);
  let token = o.algNone ? signJwtAlgNone(payload) : signJwt(payload, o.secret ?? SECRET);
  if (o.postSignTamper) token = tamperTokenPayload(token, o.postSignTamper);
  return { ...cfg, token };
}

function pageHtml(id) {
  const jsonId = JSON.stringify(id);
  return [
    "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>poc10-" + id.replace(/[<>&"]/g, "") + "</title></head>",
    "<body style=\"margin:0\"><div id=\"placeholder\" style=\"height:100vh\"></div>",
    "<script>",
    "window.__poc10 = { caseId: " + jsonId + ", status: \"loading\", t0: performance.now(), errors: [] };",
    "window.addEventListener('error', function (e) { window.__poc10.errors.push('window.error: ' + (e.message || '')); });",
    "fetch('/api/config/' + encodeURIComponent(" + jsonId + ")).then(function (r) { return r.json(); }).then(function (body) {",
    "  if (body.external) {",
    "    var f = document.createElement('iframe'); f.src = body.external; f.style.cssText = 'width:100vw;height:100vh;border:0';",
    "    f.onload = function () { window.__poc10.status = 'loaded'; window.__poc10.readyAt = performance.now(); };",
    "    document.body.appendChild(f); return;",
    "  }",
    "  var s = document.createElement('script');",
    "  s.src = '" + DOCSRV + "/web-apps/apps/api/documents/api.js';",
    "  s.onload = function () { try {",
    "    var cfg = body.config;",
    "    cfg.events = {",
    "      onDocumentReady: function () { window.__poc10.status = 'ready'; window.__poc10.readyAt = performance.now(); },",
    "      onError: function (e) { window.__poc10.errors.push('onError: ' + JSON.stringify((e && e.data) || e)); if (window.__poc10.status === 'loading') { window.__poc10.status = 'error'; window.__poc10.errorAt = performance.now(); } }",
    "    };",
    "    window.__poc10.docKey = cfg.document && cfg.document.key;",
    "    window.__poc10.editorCreated = true;",
    "    new DocsAPI.DocEditor('placeholder', cfg);",
    "  } catch (err) { window.__poc10.status = 'error'; window.__poc10.errors.push('constructor: ' + err.message); } };",
    "  s.onerror = function () { window.__poc10.status = 'error'; window.__poc10.errors.push('api.js 加载失败'); };",
    "  document.head.appendChild(s);",
    "}).catch(function (e) { window.__poc10.status = 'error'; window.__poc10.errors.push('config fetch: ' + e.message); });",
    "setTimeout(function () { if (window.__poc10.status === 'loading') window.__poc10.status = 'timeout'; }, 300000);",
    "</script></body></html>",
  ].join("\n");
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://127.0.0.1");
  if (u.pathname.startsWith("/api/config/")) {
    const id = decodeURIComponent(u.pathname.slice("/api/config/".length));
    const c = cases.get(id);
    if (!c) { res.writeHead(404, { "content-type": "application/json" }); res.end("{}"); return; }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ config: c.config ?? null, external: c.external ?? null }));
    return;
  }
  if (u.pathname.startsWith("/v/")) {
    const id = decodeURIComponent(u.pathname.slice(3));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pageHtml(id));
    return;
  }
  res.writeHead(404); res.end("not found");
});
await new Promise((resolve) => server.listen(PORT_HTTP, "127.0.0.1", resolve));

class CDP {
  constructor(ws) { this.ws = ws; this.seq = 0; this.pending = new Map(); this.listeners = new Map(); this.closed = false; this.closeErr = null; }
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
          } else if (m.method) {
            const arr = c.listeners.get(m.method);
            if (arr) arr.forEach((fn) => { try { fn(m); } catch {} });
          }
        };
        resolve(c);
      };
      ws.onerror = () => reject(new Error("CDP WebSocket 连接失败: " + url));
      ws.onclose = (ev) => c.failAll(new Error("CDP 连接已断开 code=" + (ev?.code ?? "?")));
    });
  }
  failAll(err) {
    this.closed = true; this.closeErr = err;
    for (const [, p] of this.pending) { try { p.rej(err); } catch {} }
    this.pending.clear();
  }
  send(method, params = {}, timeoutMs = 20000) {
    if (this.closed) return Promise.reject(this.closeErr ?? new Error("CDP 已关闭"));
    const id = ++this.seq;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error("CDP 调用超时 " + timeoutMs + "ms: " + method));
      }, timeoutMs);
      this.pending.set(id, {
        res: (v) => { clearTimeout(timer); res(v); },
        rej: (e) => { clearTimeout(timer); rej(e); },
      });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); rej(e); }
    });
  }
  on(method, fn) { const arr = this.listeners.get(method) ?? []; arr.push(fn); this.listeners.set(method, arr); }
  close() { try { this.ws.close(); } catch {} }
}

async function startBrowser(port) {
  const profile = ROOT + "/data/edge-" + port + "-" + stamp();
  const proc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-dev-shm-usage", "--disable-extensions", "--mute-audio", "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
  let version = null;
  for (let i = 0; i < 60 && !version; i++) {
    await sleep(500);
    try { const r = await fetch("http://127.0.0.1:" + port + "/json/version"); if (r.ok) version = await r.json(); } catch {}
  }
  if (!version) { try { proc.kill(); } catch {} throw new Error("Edge 未就绪: port " + port); }
  const browser = await CDP.connect(version.webSocketDebuggerUrl);
  return { proc, browser, port, profile };
}
function cleanupProfile(p) { try { rmSync(p, { recursive: true, force: true }); } catch {} }

function dockerLogs(sinceIso, untilIso) {
  return new Promise((resolve) => {
    execFile("docker", ["logs", "--since", sinceIso, "--until", untilIso, "libiaolink-onlyoffice-poc"], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) { resolve((stdout || "") + (stderr || "")); return; }
      execFile("docker", ["logs", "--since", sinceIso, "libiaolink-onlyoffice-poc"], { maxBuffer: 32 * 1024 * 1024 }, (err2, stdout2, stderr2) => {
        const lines = ((stdout2 || "") + (stderr2 || "")).split("\n");
        resolve(lines.slice(-150).join("\n"));
      });
    });
  });
}
function statsOnce() {
  return new Promise((resolve) => {
    execFile("docker", ["stats", "--no-stream", "--format", "{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}", "libiaolink-onlyoffice-poc"], (err, stdout) => {
      const parts = String(stdout || "").trim().split("|");
      resolve({ cpu: parts[0] ?? "", mem: parts[1] ?? "", memPerc: parts[2] ?? "", err: err ? String(err.message) : undefined });
    });
  });
}

async function openCase(b, id, { timeoutMs = 180000, shot = false, closeAfter = true, extraWaitMs = 0 } = {}) {
  const t0 = Date.now();
  const url = "http://127.0.0.1:" + PORT_HTTP + "/v/" + encodeURIComponent(id);
  const { targetId } = await b.browser.send("Target.createTarget", { url });
  let pageWs = null;
  for (let i = 0; i < 40 && !pageWs; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + b.port + "/json/list")).json();
      const t = list.find((x) => x.id === targetId);
      if (t && t.webSocketDebuggerUrl) pageWs = t.webSocketDebuggerUrl;
    } catch {}
    if (!pageWs) await sleep(250);
  }
  if (!pageWs) throw new Error("找不到页面调试通道: " + id);
  const page = await CDP.connect(pageWs);
  const consoleErrors = [];
  const pushErr = (s) => { if (consoleErrors.length < 200) consoleErrors.push(String(s).slice(0, 600)); };
  const rel = () => ((Date.now() - t0) / 1000).toFixed(1) + "s ";
  const reqUrls = new Map();
  page.on("Runtime.exceptionThrown", (m) => pushErr(rel() + "exception: " + String(m.params?.exceptionDetails?.exception?.description ?? JSON.stringify(m.params))));
  page.on("Runtime.consoleAPICalled", (m) => { const t = m.params?.type; if (t === "error" || t === "warning") pushErr(rel() + t + ": " + (m.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ")); });
  page.on("Log.entryAdded", (m) => { if (m.params?.entry?.level === "error") pushErr(rel() + "log: " + String(m.params.entry.text)); });
  page.on("Network.requestWillBeSent", (m) => { const u = String(m.params?.request?.url ?? ""); if (u.startsWith(DOCSRV)) { reqUrls.set(m.params.requestId, u); if (reqUrls.size > 3000) reqUrls.delete(reqUrls.keys().next().value); } });
  page.on("Network.loadingFailed", (m) => { const u = reqUrls.get(m.params?.requestId); reqUrls.delete(m.params?.requestId); if (u) pushErr(rel() + "netfail: " + String(m.params?.errorText ?? "?") + (m.params?.blockedReason ? " blocked=" + m.params.blockedReason : "") + " " + u.slice(-140)); });
  page.on("Network.responseReceived", (m) => { const s = Number(m.params?.response?.status); if (s >= 400) pushErr(rel() + "http" + s + ": " + String(m.params?.response?.url ?? "").slice(-140)); });
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await page.send("Network.enable");
  await page.send("Page.enable");
  const dsSince = new Date().toISOString();
  let last = null;
  let sendFails = 0;
  let cdpErr = null;
  const deadline = t0 + timeoutMs;
  while (Date.now() < deadline) {
    let v = null;
    try {
      const r = await page.send("Runtime.evaluate", { expression: "JSON.stringify(window.__poc10 || null)", returnByValue: true }, 15000);
      sendFails = 0;
      v = r?.result?.value ? JSON.parse(r.result.value) : null;
    } catch (e) {
      cdpErr = String(e?.message ?? e);
      if (++sendFails >= 3) break;
    }
    if (v) { last = v; if (["ready", "error", "timeout", "loaded"].includes(v.status)) break; }
    await sleep(1500);
  }
  if (extraWaitMs > 0) await sleep(extraWaitMs);
  const dsUntil = new Date().toISOString();
  let shotPath = null;
  if (shot) {
    try {
      const s = await page.send("Page.captureScreenshot", { format: "png" });
      shotPath = SHOT_DIR + "/" + sanitize(id) + ".png";
      writeFileSync(shotPath, Buffer.from(s.data, "base64"));
    } catch (e) { consoleErrors.push("screenshot: " + e.message); }
  }
  const dslogPath = LOG_DIR + "/" + sanitize(id) + ".dslog.txt";
  writeFileSync(dslogPath, await dockerLogs(dsSince, dsUntil), "utf8");
  const closer = async () => { try { await b.browser.send("Target.closeTarget", { targetId }); } catch {} page.close(); };
  if (closeAfter) await closer();
  const term = last && ["ready", "error", "timeout", "loaded"].includes(last.status) ? last.status : null;
  const status = term ?? (cdpErr ? "cdp-broken" : (last?.status ?? "no-status"));
  if (cdpErr) consoleErrors.push("cdp: " + cdpErr);
  return {
    id, status,
    readyMs: last && last.readyAt ? Math.round(last.readyAt - last.t0) : null,
    durationMs: Date.now() - t0,
    docKey: last?.docKey ?? null,
    errors: [...(last?.errors ?? []), ...consoleErrors].slice(0, 40),
    dslogPath, shotPath, _close: closer,
  };
}

async function runSingle() {
  const label = String(opt("label", "single-" + stamp()));
  const file = String(opt("file", "docx"));
  const f = file === "xlsx" ? FIX.xlsx : file === "docxB" ? FIX.docxB : FIX.docx;
  const rawUrl = opt("url", null);
  const url = rawUrl && rawUrl !== true ? String(rawUrl) : await presignGet(f.objectKey, 900, INTERNAL_S3);
  const id = label + "-view";
  cases.set(id, { config: withToken(buildConfigWith({ f, url, key: "poc10-" + label + "-" + stamp() })), meta: {} });
  const b = await startBrowser(9440);
  const shot = Boolean(opt("shot", false));
  const r = await openCase(b, id, { shot, timeoutMs: Number(opt("timeout", 180)) * 1000, extraWaitMs: shot ? 2000 : 0 });
  const out = { label, mode: "single", at: new Date().toISOString(), result: { ...r, _close: undefined } };
  console.log(JSON.stringify(out.result, null, 2));
  writeFileSync(LOG_DIR + "/" + sanitize(label) + ".json", JSON.stringify(out, null, 2));
  b.browser.close(); try { b.proc.kill(); } catch {} cleanupProfile(b.profile);
  await new Promise((resolve) => server.close(resolve));
}

async function runBurst() {
  const n = Number(opt("n", 20));
  const file = String(opt("file", "mix"));
  const label = String(opt("label", "burst-" + n));
  const holdSec = Number(opt("hold", 0));
  const shotEvery = Math.max(1, Number(opt("shot-every", 10)));
  const timeoutSec = Number(opt("timeout", 420));
  const perBrowser = Number(opt("per-browser", 17));
  const ids = [];
  for (let i = 0; i < n; i++) {
    const f = file === "docx" ? FIX.docx : file === "xlsx" ? FIX.xlsx : (i % 2 ? FIX.xlsx : FIX.docx);
    const url = await presignGet(f.objectKey, 900, INTERNAL_S3);
    const id = label + "-" + String(i).padStart(2, "0");
    cases.set(id, { config: withToken(buildConfigWith({ f, url, key: "poc10-" + label + "-" + i + "-" + stamp() })), meta: {} });
    ids.push(id);
  }
  const k = Math.max(1, Math.ceil(n / perBrowser));
  const browsers = [];
  for (let i = 0; i < k; i++) browsers.push(await startBrowser(9420 + i));
  const samples = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      samples.push({ ts: new Date().toISOString(), ...(await statsOnce()) });
      try { writeFileSync(LOG_DIR + "/" + sanitize(label) + "-samples.csv", "ts,cpu,mem,memPerc,phase,err\n" + samples.map((s) => [s.ts, s.cpu, s.mem, s.memPerc, s.phase ?? "", s.err ?? ""].join(",")).join("\n")); } catch {}
      await sleep(5000);
    }
  })();
  const launchStart = Date.now();
  const results = new Array(ids.length).fill(null);
  const tasks = ids.map(async (id, i) => {
    await sleep(120 * i);
    let r;
    try {
      r = await openCase(browsers[i % k], id, { timeoutMs: timeoutSec * 1000, shot: i % shotEvery === 0, closeAfter: holdSec <= 0 });
    } catch (e) {
      r = { id, status: "harness-error", readyMs: null, durationMs: null, docKey: null, errors: [String(e?.message ?? e)], dslogPath: null, shotPath: null, _close: async () => {} };
    }
    results[i] = r;
    try { appendFileSync(LOG_DIR + "/" + sanitize(label) + ".results.jsonl", JSON.stringify({ at: new Date().toISOString(), ...r, _close: undefined }) + "\n"); } catch {}
    return r;
  });
  await Promise.all(tasks);
  if (holdSec > 0) {
    samples.push({ ts: new Date().toISOString(), ...(await statsOnce()), phase: "hold-start" });
    await sleep(holdSec * 1000);
    samples.push({ ts: new Date().toISOString(), ...(await statsOnce()), phase: "hold-end" });
    await Promise.all(results.map((r) => r._close()));
    await sleep(30000);
    samples.push({ ts: new Date().toISOString(), ...(await statsOnce()), phase: "recovery+30s" });
    await sleep(30000);
    samples.push({ ts: new Date().toISOString(), ...(await statsOnce()), phase: "recovery+60s" });
  }
  sampling = false;
  await sampler;
  const ready = results.filter((r) => r.status === "ready");
  const errs = results.filter((r) => r.status === "error");
  const tos = results.filter((r) => r.status === "timeout");
  const others = results.filter((r) => !["ready", "error", "timeout"].includes(r.status));
  const times = ready.map((r) => r.readyMs).filter((x) => typeof x === "number").sort((a, b) => a - b);
  const pct = (p) => (times.length ? times[Math.min(times.length - 1, Math.floor(times.length * p))] : null);
  const summary = {
    label, mode: "burst", n, file, holdSec, launchedAt: new Date(launchStart).toISOString(),
    ready: ready.length, error: errs.length, timeout: tos.length, other: others.length,
    readyMs: { min: times[0] ?? null, p50: pct(0.5), p95: pct(0.95), max: times[times.length - 1] ?? null },
    problemSample: [...errs, ...tos, ...others].slice(0, 6).map((r) => ({ id: r.id, status: r.status, errors: r.errors.slice(0, 4), dslogPath: r.dslogPath })),
    results: results.map((r) => ({ ...r, _close: undefined })),
  };
  console.log(JSON.stringify({ label, n, ready: summary.ready, error: summary.error, timeout: summary.timeout, other: summary.other, readyMs: summary.readyMs }, null, 2));
  writeFileSync(LOG_DIR + "/" + sanitize(label) + ".json", JSON.stringify(summary, null, 2));
  writeFileSync(LOG_DIR + "/" + sanitize(label) + "-samples.csv", "ts,cpu,mem,memPerc,phase,err\n" + samples.map((s) => [s.ts, s.cpu, s.mem, s.memPerc, s.phase ?? "", s.err ?? ""].join(",")).join("\n"));
  for (const b of browsers) { b.browser.close(); try { b.proc.kill(); } catch {} cleanupProfile(b.profile); }
  await new Promise((resolve) => server.close(resolve));
}

async function runTamper() {
  const label = String(opt("label", "tamper-" + stamp()));
  const which = String(opt("cases", "b1,b2,b3a,b3b,b4,b5,b6,b7"));
  const list = which === "all" ? ["b1", "b2", "b3a", "b3b", "b4", "b5", "b6", "b7"] : which.split(",");
  const urlA = await presignGet(FIX.docx.objectKey, 900, INTERNAL_S3);
  const urlB = await presignGet(FIX.docxB.objectKey, 900, INTERNAL_S3);
  const mk = (f, url, key) => buildConfigWith({ f, url, key });
  for (const c of list) {
    const id = label + "-" + c;
    if (c === "b1") cases.set(id, { config: mk(FIX.docx, urlA, "poc10-" + id + "-" + stamp()), meta: { desc: "无 token" } });
    if (c === "b2") cases.set(id, { config: withToken(mk(FIX.docx, urlA, "poc10-" + id + "-" + stamp()), { postSignTamper: (p) => { p.editorConfig.mode = "edit"; p.permissions.edit = true; p.permissions.download = true; } }), meta: { desc: "改 payload 不重签" } });
    if (c === "b3a") cases.set(id, { config: withToken(mk(FIX.docx, urlA, "poc10-" + id + "-" + stamp()), { secret: randomBytes(32).toString("hex"), preSignMutate: (p) => { p.editorConfig.mode = "edit"; p.permissions.edit = true; } }), meta: { desc: "换密钥重签（宣告 edit）" } });
    if (c === "b3b") cases.set(id, { config: withToken(mk(FIX.docx, urlA, "poc10-" + id + "-" + stamp()), { algNone: true, preSignMutate: (p) => { p.editorConfig.mode = "edit"; p.permissions.edit = true; } }), meta: { desc: "alg=none 伪造" } });
    if (c === "b4") cases.set(id, { config: withToken(mk(FIX.docx, urlA, "poc10-" + id + "-" + stamp()), { expSec: -120 }), meta: { desc: "过期 token" } });
    if (c === "b5") {
      const tokenA = withToken(mk(FIX.docx, urlA, "poc10-b5-a-" + stamp()), {}).token;
      cases.set(id, { config: { ...mk(FIX.docxB, urlB, "poc10-b5-b-" + stamp()), token: tokenA }, meta: { desc: "A 的 token 配 B 的 config" } });
    }
    if (c === "b6") {
      const signed = withToken(mk(FIX.docx, urlA, "poc10-" + id + "-" + stamp()));
      const tampered = {
        ...signed,
        permissions: { edit: true, download: true, print: true, comment: true, chat: true },
        editorConfig: { ...(signed.editorConfig ?? {}), mode: "edit" },
      };
      cases.set(id, { config: tampered, meta: { desc: "前端 config 篡改（token 仍 view，签名后改）" } });
    }
    if (c === "b7") cases.set(id, { external: DOCSRV + "/example/", meta: { desc: "直连 DocServer 内置示例页" } });
  }
  const b = await startBrowser(9441);
  const results = [];
  const mine = [...cases.keys()].filter((x) => x.startsWith(label));
  for (const id of mine) {
    let r;
    try {
      r = await openCase(b, id, { timeoutMs: 90000, shot: true, closeAfter: true, extraWaitMs: 3000 });
    } catch (e) {
      r = { id, status: "harness-error", readyMs: null, durationMs: null, docKey: null, errors: [String(e?.message ?? e)], dslogPath: null, shotPath: null };
    }
    r.desc = cases.get(id).meta?.desc ?? "";
    results.push({ ...r, _close: undefined });
    try { appendFileSync(LOG_DIR + "/" + sanitize(label) + ".results.jsonl", JSON.stringify({ at: new Date().toISOString(), ...r }) + "\n"); } catch {}
    console.log("[" + r.status + "] " + id + " readyMs=" + r.readyMs + (r.errors[0] ? " err0=" + String(r.errors[0]).slice(0, 130) : ""));
  }
  writeFileSync(LOG_DIR + "/" + sanitize(label) + ".json", JSON.stringify({ label, mode: "tamper", at: new Date().toISOString(), results }, null, 2));
  b.browser.close(); try { b.proc.kill(); } catch {} cleanupProfile(b.profile);
  await new Promise((resolve) => server.close(resolve));
}

if (MODE === "single") await runSingle();
else if (MODE === "burst") await runBurst();
else if (MODE === "tamper") await runTamper();
else { console.log("用法: node viewer.mjs single|burst|tamper ..."); process.exit(2); }
process.exit(0);
