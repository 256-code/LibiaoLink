#!/usr/bin/env node
/**
 * S6-前置 前端回放（图片直通 · 原对象直签）—— `deploy/preview` 停机态下：
 *   ① 任务详情抽屉「文件」行：真 PNG 行内 40×40 缩略图 = **原对象短时签名直出**（src 含 X-Amz-Signature、
 *      路径 = /projects/{id}/files/{id}/v{n}/…、**不含 previews/**、naturalWidth>0 → 真实渲染成功）；
 *   ② 点缩略图 → 大图浮层（同源短时签名地址渲染）；Esc 先关浮层、抽屉仍在（「Esc 先关内层」）；
 *   ③ 收尾：文件 purge → 项目物理删 → 会话撤销 → 零残留。
 * 本脚本只覆盖图片段 —— Office / 文本 / PDF（查看器通道）与上传交互的完整回放见 `m4-07-task-file-upload-e2e.mjs`；
 * 本切片按计划 S6-前置「停机态图片预览 + 缩略图走通（截图）」补前端证据（预期零前端改动）。
 *
 * 前置（都在本机跑着）：
 *   1. 前端 dev：cd frontend && BACKEND_ORIGIN=http://127.0.0.1:3011 npm run dev（默认 3000）
 *   2. api：cd server && node --env-file-if-exists=.env dist/entry/api.js（PORT=3011）
 *   3. 数据库：本地沙箱 PG（127.0.0.1:55432/libiaolink）；对象存储：deploy/minio（127.0.0.1:9000）
 *   4. `deploy/preview` **已停**（转换器 / worker 不在线 —— 图片缩略图不依赖转换器）
 *   5. 本机 Chrome（headless 自起；CHROME_PATH 可覆盖）
 *
 * 用法：node scripts/s6-pre-image-direct-e2e.mjs
 *   可覆盖：FRONTEND_BASE / API_BASE / DATABASE_URL / CHROME_PATH / CDP_PORT / REPLAY_USER / PG_MODULE / SCREENSHOT_DIR
 * 证据：docs/s6-pre-回放证据(图片直通·原对象直签).md（前端小节）
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

const PG_MODULE = process.env.PG_MODULE ?? new URL("../../server/node_modules/pg/lib/index.js", import.meta.url).href;
const { default: pg } = await import(PG_MODULE);
const { Client } = pg;

const FRONTEND = process.env.FRONTEND_BASE ?? "http://localhost:3000";
const API = process.env.API_BASE ?? "http://127.0.0.1:3011";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(process.env.CDP_PORT ?? 9415);
const DB = process.env.DATABASE_URL ?? "postgres://libiaolink_api@127.0.0.1:55432/libiaolink";
const REPLAY_USER = process.env.REPLAY_USER ?? "panxing";
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? tmpdir();
const TASK_TITLE = "回放任务·S6前置图片直通";
const PNG_NAME = "回放-S6前置-现场图.png";
/** 真图片（1×1 红点 PNG，与 server 侧 S6-前置 回放同款夹具）。 */
const PNG_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const Q = String.fromCharCode(34);
const j = (value) => JSON.stringify(value);

const db = new Client({ connectionString: DB });
await db.connect();
const userRow = (await db.query("select id, username, display_name from users where username = $1", [REPLAY_USER])).rows[0];
if (userRow === undefined) {
  console.error("回放用户不存在：" + REPLAY_USER);
  process.exit(1);
}
const token = "s6pre-fe-" + randomBytes(16).toString("hex");
const csrf = randomBytes(16).toString("hex");
await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(mins => 30))", [sha256(token), userRow.id, "s6-pre-image-e2e"]);
console.log("临时会话：" + userRow.username + "（" + userRow.display_name + "）");

const cookieOf = (sid, csfr) => "ll_sid=" + sid + "; ll_csrf=" + csfr;
async function apiOn(base, cookie, csfr, path, method = "GET", body, extra) {
  const headers = Object.assign({ Cookie: cookie, "X-CSRF-Token": csfr, Accept: "application/json" }, extra || {});
  const init = { method, headers };
  if (body !== undefined) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (error) { json = null; }
  return { status: res.status, json, text };
}
const api = (path, method, body, extra) => apiOn(API, cookieOf(token, csrf), csrf, path, method, body, extra);

const checks = [];
function check(name, ok, detail) {
  checks.push(ok === true);
  console.log((ok === true ? "PASS  " : "FAIL  ") + name + (detail === undefined ? "" : "   [" + detail + "]"));
}

/** 项目清场前把项目内文件先「回收站 → purge」清掉（与 m4-07 / m6 回放同一绕行：files.current_version_id 外键）。 */
async function purgeProjectFiles(projectId) {
  const rows = (await db.query("select id, version, status from files where project_id = $1", [projectId])).rows;
  let purged = 0;
  for (const row of rows) {
    let version = Number(row.version);
    if (row.status !== "recycled") {
      const recycled = await api("/api/v1/files/" + row.id + "/recycle", "POST", { version });
      if (recycled.status !== 200 || recycled.json === null) continue;
      version = Number(recycled.json.version);
    }
    const done = await api("/api/v1/files/" + row.id + "/purge", "POST", { version });
    if (done.status === 200) purged += 1;
  }
  return { total: rows.length, purged };
}

// ---------- 清场：上一轮崩在中途留下的同名临时项目 ----------
const stale = (await db.query("select id from projects where code like $1 and deleted_at is null", ["S6PRE-%"])).rows;
for (const row of stale) {
  const staleRow = await api("/api/v1/projects/" + row.id);
  if (staleRow.json === null) continue;
  await purgeProjectFiles(row.id);
  const gone = await api("/api/v1/projects/" + row.id, "DELETE", undefined, { "If-Match": String(staleRow.json.version) });
  console.log("清场：删残留临时项目 " + row.id + " → " + String(gone.status));
}

// ---------- 夹具：临时项目 + 一条任务 + 一份真 PNG（真实上传管道：init → 分片直传 → complete；带 taskId 关联任务） ----------
const fixtureCode = "S6PRE-" + randomBytes(3).toString("hex").toUpperCase();
const projRes = await api("/api/v1/projects", "POST", { code: fixtureCode, name: "S6前置回放·图片直通", description: "S6前置回放·图片直通", managerIds: [userRow.id] });
check("夹具 a 建临时项目（201）", projRes.status === 201, String(projRes.status) + " " + projRes.text.slice(0, 140));
const projectId = projRes.json === null ? "" : projRes.json.id;
const taskRes = await api("/api/v1/projects/" + projectId + "/tasks", "POST", { stageKey: "design", title: TASK_TITLE, ownerIds: [userRow.id] });
check("夹具 b 建一条任务（201）", taskRes.status === 201, String(taskRes.status) + " " + taskRes.text.slice(0, 140));
const taskId = taskRes.json === null ? "" : taskRes.json.id;

const contentHash = sha256(PNG_BYTES);
const initRes = await api("/api/v1/files/uploads", "POST", { projectId, name: PNG_NAME, sizeBytes: PNG_BYTES.length, mime: "image/png", contentHash, taskId, intent: "version" });
const uploadFileId = initRes.json === null || initRes.json.file === undefined ? "" : initRes.json.file.id;
const uploadId = initRes.json === null || initRes.json.upload === undefined ? "" : initRes.json.upload.id;
if (uploadFileId !== "" && uploadId !== "") {
  const partsRes = await api("/api/v1/files/" + uploadFileId + "/uploads/" + uploadId + "/parts", "POST", { partNumbers: [1] });
  const partUrl = partsRes.json.parts[0].url;
  const putRes = await fetch(partUrl, { method: "PUT", body: PNG_BYTES });
  const completeRes = await api("/api/v1/files/" + uploadFileId + "/uploads/" + uploadId + "/complete", "POST", { contentHash });
  check("夹具 c 上传真 PNG（分片直传 + 关联任务）", putRes.ok === true && completeRes.status === 200 && completeRes.json.version.seq === 1, String(completeRes.status) + " seq=" + String(completeRes.json === null ? null : completeRes.json.version.seq));
} else {
  check("夹具 c 上传真 PNG（分片直传 + 关联任务）", false, "init 未返回 file / upload：" + initRes.text.slice(0, 160));
}

// ---------- 无头 Chrome（CDP） ----------
const profile = mkdtempSync(join(tmpdir(), "pxs6pre-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + String(PORT), "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
async function waitTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + String(PORT) + "/json/list")).json();
      const target = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch (error) { /* 未就绪 */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Chrome 未就绪");
}
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", () => reject(new Error("ws error")));
    });
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const item = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) item.reject(new Error(JSON.stringify(msg.error))); else item.resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.exceptionThrown" || msg.method === "Log.entryAdded") this.events.push("EVT " + msg.method + " " + JSON.stringify(msg.params).slice(0, 400));
    });
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("cdp timeout: " + method)); }, 45000);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}
const target = await waitTarget();
const page = new Cdp(target.webSocketDebuggerUrl);
await page.ready;
await page.send("Network.enable");
await page.send("Page.enable");
await page.send("Runtime.enable");
await page.send("DOM.enable");
await page.send("Log.enable");
await page.send("Network.setCookie", { name: "ll_sid", value: token, url: FRONTEND + "/", path: "/", httpOnly: true, secure: false });
await page.send("Network.setCookie", { name: "ll_csrf", value: csrf, url: FRONTEND + "/", path: "/", httpOnly: false, secure: false });
await page.send("Emulation.setDeviceMetricsOverride", { width: 1560, height: 1000, deviceScaleFactor: 1, mobile: false });
await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ev = async (expression) => {
  const reply = await page.send("Runtime.evaluate", { expression, returnByValue: true });
  if (reply.exceptionDetails !== undefined) throw new Error("页面表达式抛异常：" + JSON.stringify(reply.exceptionDetails).slice(0, 300));
  return reply.result.value;
};
async function waitFor(expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await ev(expression)) === true) return true;
    await sleep(250);
  }
  return false;
}
async function clickAt(point) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(500);
}
async function bail(reason) {
  console.error("中止：" + reason);
  checks.push(false);
  try { page.ws.close(); } catch (error) { /* 忽略 */ }
  chrome.kill();
  await db.end();
  process.exit(1);
}

const FILE_CELL_BUTTON = "[data-cell-action=task-files]";
const DRAWER = "aside[role=dialog]";

// ---------- ① 打开项目总览 → 点任务行 → 详情抽屉「文件」行 ----------
await page.send("Page.navigate", { url: FRONTEND + "/#/project/" + projectId });
const boardReady = await waitFor("document.querySelector(" + j(FILE_CELL_BUTTON) + ")!==null", 20000);
if (boardReady !== true) await bail("项目总览没渲染出「文件」列单元（检查前端 dev / api / 会话）");
await ev("(function(){var rows=document.querySelectorAll(" + j("[role=button]") + ");for(var i=0;i<rows.length;i++){if(rows[i].textContent.indexOf(" + j(TASK_TITLE) + ")>=0){rows[i].scrollIntoView({block:" + j("center") + ",inline:" + j("start") + "});return true;}}return false;})()");
await sleep(400);
const rowPoint = await ev("(function(){var rows=document.querySelectorAll(" + j("[role=button]") + ");for(var i=0;i<rows.length;i++){if(rows[i].textContent.indexOf(" + j(TASK_TITLE) + ")>=0){var b=rows[i].getBoundingClientRect();return {x:Math.round(b.left+60),y:Math.round(b.top+b.height/2)};}}return null;})()");
if (rowPoint === null || rowPoint === undefined) await bail("点不到任务行（行没渲染）");
await clickAt(rowPoint);
const drawerOpen = await waitFor("document.querySelector(" + j(DRAWER) + ")!==null", 10000);
check("① 点任务行打开详情抽屉", drawerOpen === true, String(drawerOpen));
const fileRowReady = await waitFor("(function(){var d=document.querySelector(" + j(DRAWER) + ");if(d===null){return false;}var items=d.querySelectorAll(" + j("[data-drawer-file-item]") + ");for(var i=0;i<items.length;i++){if(items[i].textContent.indexOf(" + j(PNG_NAME) + ")>=0){return true;}}return false;})()", 15000);
check("② 抽屉「文件」行 = 上传的 PNG（详情接口下发）", fileRowReady === true, String(fileRowReady));

// ---------- ③ 缩略图 = 原对象短时签名直出（不依赖转换器 / 不经产物通道） ----------
const thumbProbe = "(function(){var d=document.querySelector(" + j(DRAWER) + ");if(d===null){return null;}var items=d.querySelectorAll(" + j("[data-drawer-file-item]") + ");for(var i=0;i<items.length;i++){if(items[i].textContent.indexOf(" + j(PNG_NAME) + ")>=0){var t=items[i].querySelector(" + j("[data-file-thumb=true]") + ");if(t===null){return null;}var img=t.querySelector(" + j("img") + ");if(img===null){return null;}return {src:String(img.getAttribute(" + j("src") + ")),complete:img.complete===true,naturalWidth:Number(img.naturalWidth),naturalHeight:Number(img.naturalHeight)};}}return null;})()";
const thumbLoaded = await waitFor("(function(){var p=" + thumbProbe + ";return p!==null&&p.complete===true&&p.naturalWidth>0;})()", 30000);
const thumb = await ev(thumbProbe);
const thumbSigned = thumb !== null && thumb !== undefined
  && thumb.src.indexOf("http") === 0
  && thumb.src.indexOf("X-Amz-Signature") >= 0
  && thumb.src.indexOf("/projects/" + projectId + "/files/" + uploadFileId + "/v1/") >= 0
  && thumb.src.indexOf("previews/") < 0;
check("③ 缩略图 src = 原对象短时签名（/projects/{id}/files/{id}/v1/ + X-Amz-Signature + 无 previews/）+ 真实渲染（naturalWidth>0）", thumbLoaded === true && thumbSigned === true, JSON.stringify(thumb));
const thumbShot = await page.send("Page.captureScreenshot", { format: "png" });
writeFileSync(join(SCREENSHOT_DIR, "s6-pre-image-thumb.png"), Buffer.from(thumbShot.data, "base64"));
console.log("截图：" + join(SCREENSHOT_DIR, "s6-pre-image-thumb.png"));

// ---------- ④ 点缩略图 → 大图浮层（同源短时签名地址） ----------
const thumbPoint = await ev("(function(){var d=document.querySelector(" + j(DRAWER) + ");if(d===null){return null;}var items=d.querySelectorAll(" + j("[data-drawer-file-item]") + ");for(var i=0;i<items.length;i++){if(items[i].textContent.indexOf(" + j(PNG_NAME) + ")>=0){var t=items[i].querySelector(" + j("[data-file-thumb=true]") + ");if(t===null){return null;}var r=t.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};}}return null;})()");
if (thumbPoint === null || thumbPoint === undefined) await bail("PNG 行没有缩略图入口（图片判定 / 渲染没接上）");
await clickAt(thumbPoint);
const overlayOpen = await waitFor("document.querySelector(" + j("[data-file-preview]") + ")!==null", 20000);
const overlayProbe = "(function(){var el=document.querySelector(" + j("[data-file-preview]") + ");if(el===null){return null;}var img=el.querySelector(" + j("img") + ");if(img===null){return null;}return {src:String(img.getAttribute(" + j("src") + ")),complete:img.complete===true,naturalWidth:Number(img.naturalWidth),drawer:document.querySelector(" + j(DRAWER) + ")!==null};})()";
const overlayLoaded = await waitFor("(function(){var p=" + overlayProbe + ";return p!==null&&p.complete===true&&p.naturalWidth>0;})()", 30000);
const overlay = await ev(overlayProbe);
const overlaySigned = overlay !== null && overlay !== undefined
  && overlay.src.indexOf("http") === 0
  && overlay.src.indexOf("X-Amz-Signature") >= 0
  && overlay.src.indexOf("/projects/" + projectId + "/files/" + uploadFileId + "/v1/") >= 0
  && overlay.src.indexOf("previews/") < 0;
check("④ 大图浮层：img src = 原对象短时签名 + 真实渲染 + 抽屉仍在（Esc 前）", overlayOpen === true && overlayLoaded === true && overlaySigned === true && overlay.drawer === true, JSON.stringify(overlay));
const overlayShot = await page.send("Page.captureScreenshot", { format: "png" });
writeFileSync(join(SCREENSHOT_DIR, "s6-pre-image-overlay.png"), Buffer.from(overlayShot.data, "base64"));
console.log("截图：" + join(SCREENSHOT_DIR, "s6-pre-image-overlay.png"));

await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
const escInner = await waitFor("(function(){return document.querySelector(" + j("[data-file-preview]") + ")===null&&document.querySelector(" + j(DRAWER) + ")!==null;})()", 8000);
check("⑤ Esc 先关预览浮层、抽屉仍在（「Esc 先关内层」）", escInner === true, String(escInner));

// ---------- ⑥ 收尾：purge 文件 → 物理删临时项目 → 撤销会话 → 零残留 ----------
const purgeResult = await purgeProjectFiles(projectId);
check("⑥a 回放文件 purge（对象真删 + 元数据删 + 留痕）", purgeResult.total === 1 && purgeResult.purged === 1, JSON.stringify(purgeResult));
const projRow = await api("/api/v1/projects/" + projectId);
const delProj = await api("/api/v1/projects/" + projectId, "DELETE", undefined, { "If-Match": String(projRow.json.version) });
check("⑥b 临时项目物理删（200 / 204）", delProj.status === 200 || delProj.status === 204, String(delProj.status) + " " + delProj.text.slice(0, 120));
await db.query("update sessions set revoked_at = now() where token_hash = $1", [sha256(token)]);
const residue = (await db.query("select (select count(*)::int from files where project_id = $1) as files, (select count(*)::int from file_links where object_id = $2) as links, (select count(*)::int from tasks where id = $2) as tasks, (select count(*)::int from projects where id = $1) as projects, (select count(*)::int from sessions where token_hash = $3 and revoked_at is null) as sessions", [projectId, taskId, sha256(token)])).rows[0];
check("⑥c 零残留：文件 / 关联 / 任务 / 项目 / 会话全 0 行", Number(residue.files) === 0 && Number(residue.links) === 0 && Number(residue.tasks) === 0 && Number(residue.projects) === 0 && Number(residue.sessions) === 0, JSON.stringify(residue));

const failed = checks.filter((ok) => ok !== true).length;
console.log("—— 合计 " + String(checks.length) + " 项：" + String(checks.length - failed) + " 通过 / " + String(failed) + " 失败 ——");
const pageEvents = page.events.filter((line) => line.indexOf("EVT ") === 0);
console.log("页面控制台 / 异常：" + String(pageEvents.length) + " 条");
for (const line of pageEvents.slice(0, 8)) { console.log("  " + line.slice(0, 240)); }
try { page.ws.close(); } catch (error) { /* 忽略 */ }
chrome.kill();
await new Promise((resolve) => setTimeout(resolve, 1500));
try { rmSync(profile, { recursive: true, force: true }); } catch (error) { /* 浏览器退出竞态：目录可能仍被占用，留给系统清理 */ }
await db.end();
process.exit(failed === 0 ? 0 : 1);
