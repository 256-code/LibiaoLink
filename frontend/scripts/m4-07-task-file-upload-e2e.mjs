#!/usr/bin/env node
/**
 * LibiaoLink 前端 · 回放：任务「文件」列下拉（Push 246：添加 / 预览 / 删除）/ 任务详情抽屉「文件」行上传接真（Push 226 · 「文件」那一刀前端接线）
 *
 * 前置（都在本机跑着）：
 *   1. 前端 dev：cd frontend && npm run dev（默认 3000）
 *   2. api：cd server && npm run start:api（默认 3001，需先 npm run build）
 *   3. 数据库：本地沙箱 PG（默认 127.0.0.1:5433/libiaolink）
 *   4. 对象存储：deploy/minio 沙箱（默认 127.0.0.1:9000；storage:init 已建桶）
 *   5. 本机装了 Chrome（脚本 headless 起一个调试实例；路径可用 CHROME_PATH 覆盖）
 *
 * 用法：node scripts/m4-07-task-file-upload-e2e.mjs
 *   可覆盖的环境变量：FRONTEND_BASE / API_BASE / DATABASE_URL / CHROME_PATH / CDP_PORT / REPLAY_USER / PG_MODULE / SCREENSHOT_DIR
 *
 * 它做什么：一条临时会话（跑完撤销）+ 一个临时项目（跑完先 purge 文件、再物理删）在真机浏览器里跑一遍：
 *   ① 「文件」列空态 = 与任务表其它行内可编辑单元格同款的「液态玻璃」描边胶囊 + 「—」；点开 = 右侧下拉（顶部「＋ 添加文件」、空清单「暂无文件」、隐藏文件框在下拉内）；
 *   ② 下拉内真实文件选择（CDP DOM.setFileInputFiles）→ 分片直传文件库（带 taskId）→ 下拉清单与单元格同步回流（最新一份 + 「+N」）；
 *   ③ 库面：files.task_id 落行 + file_links(task) 建链 + TaskListItem.fileSummary 1（draft 1）；
 *   ④ 抽屉「文件」行：文件名清单随详情接口下发（**不显示「未定档 / 已定档」** —— 定档是项目级安排）+ 上传入口在位；
 *   ⑤ 抽屉内再传（txt / 真 PNG）→ 清单与「文件」列同步（文件名 + 「+N」；同一条直传链路）；
 *   ⑥ 图片行 40×40 缩略图 → 大图预览浮层（短时签名 URL）；Esc 先关浮层、抽屉仍在；
 *   ⑦ 文件名可改：点名字进编辑，只改主名（后缀保留）；Enter 提交 / Esc 取消 / 空名不写回；
 *   ⑧ 抽屉内「删除」= 二次确认 → 移入回收站（清单 / 计数回落，recycled 不进读面）；
 *   ⑨ PDF：点「预览」→ 浏览器内置查看器浮层（iframe 短时签名 URL，PDF 源直通）；Esc 先关浮层；
 *   ⑩ 下载 = 原文件（抽屉每行「下载」+ 预览浮层「下载原文件」；attachment 签名落盘 + download 审计）；
 *   ⑪ 「文件」列下拉交互（Push 246 · 业务口径 2026-10-08「点击后出现右侧下拉框 / 点文件名预览 / 删除按钮」）：
 *      点文件名 = 预览浮层（Esc 先关浮层）；Esc 先关下拉（任务行 / 详情抽屉不被连带）；行尾「删除」= 红胶囊按钮 → 行内二次确认 → 移入回收站（清单 / 单元格回落）；
 *   ⑫ 收尾：四份文件回收 + purge、临时项目物理删、会话撤销 → 零残留。
 * 证据：docs/m4-07-回放证据(任务文件上传·前端).md
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

const PG_MODULE = process.env.PG_MODULE ?? new URL("../../server/node_modules/pg/lib/index.js", import.meta.url).href;
const { default: pg } = await import(PG_MODULE);
const { Client } = pg;

const FRONTEND = process.env.FRONTEND_BASE ?? "http://localhost:3000";
const API = process.env.API_BASE ?? "http://127.0.0.1:3001";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(process.env.CDP_PORT ?? 9414);
const DB = process.env.DATABASE_URL ?? "postgres://libiaolink_api@127.0.0.1:5433/libiaolink";
const REPLAY_USER = process.env.REPLAY_USER ?? "panxing";
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? tmpdir();
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const Q = String.fromCharCode(34);
const j = (value) => JSON.stringify(value);
const TASK_TITLE = "回放任务·文件上传";

const db = new Client({ connectionString: DB });
await db.connect();
const userRow = (await db.query("select id, username, display_name from users where username = $1", [REPLAY_USER])).rows[0];
if (userRow === undefined) {
  console.error("回放用户不存在：" + REPLAY_USER);
  process.exit(1);
}
const token = "pxm4fu-" + randomBytes(16).toString("hex");
const csrf = randomBytes(16).toString("hex");
await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(mins => 30))", [sha256(token), userRow.id, "px-m4-file-e2e"]);
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

/** 项目清场前把项目内文件先「回收站 → purge」清掉（与 m6 回放同一绕行：files.current_version_id 外键）。 */
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
const stale = (await db.query("select id from projects where code like $1 and deleted_at is null", ["PX-M4FU-%"])).rows;
for (const row of stale) {
  const staleRow = await api("/api/v1/projects/" + row.id);
  if (staleRow.json === null) continue;
  await purgeProjectFiles(row.id);
  const gone = await api("/api/v1/projects/" + row.id, "DELETE", undefined, { "If-Match": String(staleRow.json.version) });
  console.log("清场：删残留临时项目 " + row.id + " → " + String(gone.status));
}

/** 生成一份结构合法的最小 PDF（单页 + 一行 Helvetica 文本；xref 偏移按实际字节算）。 */
function minimalPdf(text) {
  const stream = "BT /F1 12 Tf 20 100 Td (" + text + ") Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length " + String(Buffer.byteLength(stream, "latin1")) + " >>\nstream\n" + stream + "\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += String(index + 1) + " 0 obj\n" + objects[index] + "\nendobj\n";
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += "xref\n0 " + String(objects.length + 1) + "\n0000000000 65535 f \n";
  for (const offset of offsets) {
    pdf += String(offset).padStart(10, "0") + " 00000 n \n";
  }
  pdf += "trailer\n<< /Size " + String(objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + String(xref) + "\n%%EOF\n";
  return Buffer.from(pdf, "latin1");
}

// ---------- 夹具：临时项目 + 一条任务 + 四个真文件 ----------
const fixtureCode = "PX-M4FU-" + randomBytes(3).toString("hex").toUpperCase();
const projRes = await api("/api/v1/projects", "POST", { code: fixtureCode, name: "M4回放·任务文件上传", description: "M4回放·任务文件上传", managerIds: [userRow.id] });
check("夹具：建临时项目（201）", projRes.status === 201, String(projRes.status) + " " + projRes.text.slice(0, 140));
const projectId = projRes.json === null ? "" : projRes.json.id;
const taskRes = await api("/api/v1/projects/" + projectId + "/tasks", "POST", { stageKey: "design", title: TASK_TITLE, ownerIds: [userRow.id] });
check("夹具：建一条任务（201）", taskRes.status === 201, String(taskRes.status) + " " + taskRes.text.slice(0, 140));
const taskId = taskRes.json === null ? "" : taskRes.json.id;

const fileDir = mkdtempSync(join(tmpdir(), "pxm4fu-files-"));
const fileAName = "回放-任务文件-A.txt";
const fileBName = "回放-任务文件-B.txt";
const filePngName = "回放-现场图-A.png";
const fileAPath = join(fileDir, fileAName);
const fileBPath = join(fileDir, fileBName);
const filePngPath = join(fileDir, filePngName);
const filePdfName = "回放-文档-A.pdf";
const filePdfPath = join(fileDir, filePdfName);
writeFileSync(fileAPath, "LibiaoLink 回放 A " + fixtureCode + "\n", "utf8");
writeFileSync(fileBPath, "LibiaoLink 回放 B " + fixtureCode + "\n", "utf8");
// 真图片（1×1 红点 PNG）：验「图片行缩略图 → 大图预览」；预览产物由 worker + converter 生成。
writeFileSync(filePngPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
// 真 PDF（结构合法的最小单页文档）：验「PDF 点预览 → 内置查看器浮层」（PDF 源直通产物）。
writeFileSync(filePdfPath, minimalPdf("LibiaoLink replay pdf " + fixtureCode));

// ---------- 无头 Chrome（CDP） ----------
const profile = mkdtempSync(join(tmpdir(), "pxm4fu-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
async function waitTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
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
async function waitForAsync(fn, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fn()) === true) return true; } catch (error) { /* 重试 */ }
    await sleep(300);
  }
  return false;
}
/** 按行内文本定位抽屉文件行里的某个按钮，返回中心点（预览入口 / 删除按钮共用）。 */
async function fileRowPoint(fileName, selector) {
  return await ev("(function(){var items=document.querySelectorAll(" + j("[data-drawer-file-item]") + ");"
    + "for(var i=0;i<items.length;i++){if(items[i].textContent.indexOf(" + j(fileName) + ")>=0){"
    + "var b=items[i].querySelector(" + j(selector) + ");if(b===null){return null;}"
    + "var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};}}return null;})()");
}

async function clickAt(point) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(500);
}
/** 改名输入：Ctrl+A 全选 → Input.insertText 覆盖（走真实输入事件，React onChange 生效）。 */
async function typeRenameInput(text) {
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await page.send("Input.insertText", { text });
  await sleep(150);
}

/** 发一次按键（改名提交用回车 / 取消用 Esc）。 */
async function pressKey(key, code, keyCode) {
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: key, code: code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: key, code: code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await sleep(350);
}

/** 真选文件：CDP 直接把磁盘文件塞进隐藏输入框（等价原生文件框选完）。 */
async function setFileInput(selector, filePath) {
  const doc = await page.send("DOM.getDocument", {});
  const found = await page.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector });
  if (found === undefined || found.nodeId === 0) throw new Error("找不到文件输入框：" + selector);
  await page.send("DOM.setFileInputFiles", { nodeId: found.nodeId, files: [filePath] });
}
async function bail(message) {
  console.log("中止：" + message);
  checks.push(false);
  try { page.ws.close(); } catch (error) { /* 忽略 */ }
  chrome.kill();
  await db.end();
  process.exit(1);
}

const FILE_CELL_BUTTON = "[data-cell-action=task-files]";
const TASK_FILES_POPOVER = "[data-task-files-popover=true]";
const POPOVER_INPUT = "[data-task-files-input=true]";
const DRAWER = "aside[role=dialog]";
const DRAWER_INPUT = "aside[role=dialog] [data-file-upload-input=true]";
const CELL_TEXT_PROBE = "(function(){var b=document.querySelector(" + j(FILE_CELL_BUTTON) + ");return b===null?null:b.textContent.trim();})()";
async function waitCellHas(parts, timeoutMs) {
  const cond = parts.map((part) => "t.indexOf(" + j(part) + ")<0").join("||");
  return await waitFor("(function(){var b=document.querySelector(" + j(FILE_CELL_BUTTON) + ");if(b===null){return false;}var t=b.textContent.trim();return !(" + cond + ");})()", timeoutMs);
}
const DRAWER_FILES_PROBE = "(function(){var d=document.querySelector(" + j(DRAWER) + ");if(d===null){return {open:false};}"
  + "var items=d.querySelectorAll(" + j("[data-drawer-file-item]") + ");var names=[];for(var i=0;i<items.length;i++){names.push(items[i].innerText.replace(String.fromCharCode(10), " + j(" ") + ").trim());}"
  + "var up=d.querySelector(" + j("[data-drawer-upload]") + ");"
  + "return {open:true,count:items.length,names:names.join(" + j("|") + "),upload:up===null?null:up.textContent.trim(),input:d.querySelector(" + j("[data-file-upload-input]") + ")!==null};})()";
async function waitDrawerFiles(count, timeoutMs) {
  return await waitFor("(function(){var d=document.querySelector(" + j(DRAWER) + ");return d!==null&&d.querySelectorAll(" + j("[data-drawer-file-item]") + ").length===" + String(count) + ";})()", timeoutMs);
}

/** 点「文件」列胶囊 → 打开下拉（Push 246 起上传 / 预览 / 删除都从下拉进；先把单元格滚进可视区）。 */
async function openTaskFilesPopover() {
  await ev("(function(){var b=document.querySelector(" + j(FILE_CELL_BUTTON) + ");if(b!==null){b.scrollIntoView({block:" + j("center") + ",inline:" + j("center") + "});}return true;})()");
  await sleep(400);
  const point = await ev("(function(){var b=document.querySelector(" + j(FILE_CELL_BUTTON) + ");if(b===null){return null;}var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
  if (point === null || point === undefined) await bail("「文件」列胶囊不在（列表没渲染 / 被抽屉挡住）");
  await clickAt(point);
  return await waitFor("document.querySelector(" + j(TASK_FILES_POPOVER) + ")!==null", 6000);
}

// ---------- 打开项目总览 ----------
await page.send("Page.navigate", { url: FRONTEND + "/#/project/" + projectId });
const boardReady = await waitFor("document.querySelector(" + j(FILE_CELL_BUTTON) + ")!==null", 15000);
if (boardReady !== true) await bail("项目总览没渲染出「文件」列上传单元（检查前端 dev / api / 会话）");

// ① 空态胶囊（与行内可编辑单元格同款）+ 点开右侧下拉（Push 246）
const pill = await ev("(function(){var b=document.querySelector(" + j(FILE_CELL_BUTTON) + ");if(b===null){return {exists:false};}"
  + "var s=getComputedStyle(b);var row=b.closest(" + j("[role=button]") + ");var ref=null;var all=document.querySelectorAll(" + j("[data-inline-cell=editor]") + ");"
  + "for(var i=0;i<all.length;i++){if(row!==null&&!row.contains(all[i])){continue;}ref=all[i];break;}"
  + "var f=function(x){return x===null?null:[x.borderRadius,x.backgroundColor,x.borderTopWidth,x.paddingTop,x.paddingLeft,x.fontSize,x.backdropFilter,x.boxShadow].join(" + j("~") + ");};"
  + "return {exists:true,text:b.textContent.trim(),title:b.getAttribute(" + Q + "title" + Q + "),"
  + "mine:f(s),refLabel:ref===null?null:String(ref.getAttribute(" + Q + "aria-label" + Q + ")),ref:f(ref===null?null:getComputedStyle(ref))};})()");
check("①a 「文件」列空态 = 与同一行其它行内可编辑单元格同款的「液态玻璃」胶囊 + 「—」（逐项样式比对）",
  pill.exists === true && pill.text === "—" && pill.ref !== null && pill.ref !== undefined && pill.mine === pill.ref, JSON.stringify(pill));
check("①b 胶囊 title = 点击添加文件（关联到本任务）", typeof pill.title === "string" && pill.title.indexOf("点击添加文件") === 0, String(pill.title));
const popoverOpened = await openTaskFilesPopover();
const popoverInfo = popoverOpened === true ? await ev("(function(){var p=document.querySelector(" + j(TASK_FILES_POPOVER) + ");if(p===null){return null;}var t=document.querySelector(" + j(FILE_CELL_BUTTON) + ");var pr=p.getBoundingClientRect();var tr=t===null?null:t.getBoundingClientRect();var add=p.querySelector(" + j("[data-task-files-add]") + ");return {add:add===null?null:add.textContent.trim(),input:p.querySelector(" + j(POPOVER_INPUT) + ")!==null,right:tr===null?false:pr.left>=tr.right-2,text:p.innerText.replace(String.fromCharCode(10)," + j(" / ") + ").slice(0,140)};})()") : null;
check("①c 点胶囊 → 出下拉（顶部「＋ 添加文件」+ 空清单「暂无文件」+ 隐藏文件框在下拉内）", popoverOpened === true && popoverInfo !== null && popoverInfo.add === "＋ 添加文件" && popoverInfo.input === true && popoverInfo.text.indexOf("暂无文件") >= 0, JSON.stringify(popoverInfo));
check("①d 下拉优先贴触发器右侧展开（placement right 口径）", popoverInfo !== null && popoverInfo.right === true, JSON.stringify({ right: popoverInfo === null ? null : popoverInfo.right }));

// ② 列表上传：真选文件 → 分片直传（带 taskId）
await setFileInput(POPOVER_INPUT, fileAPath);
const firstLanded = await waitForAsync(async () => (await db.query("select count(*)::int as c from files where task_id = $1", [taskId])).rows[0].c === 1, 30000);
const fileRows1 = (await db.query("select f.id, f.name, f.status, v.mime from files f left join file_versions v on v.id = f.current_version_id where f.task_id = $1 order by f.created_at", [taskId])).rows;
check("②a 选文件 → 分片直传落库（files.task_id = 本任务 · draft）", firstLanded === true && fileRows1.length === 1 && fileRows1[0].name === fileAName && fileRows1[0].status === "draft", JSON.stringify(fileRows1));
const links1 = (await db.query("select object_type, object_id from file_links where file_id = $1", [fileRows1[0].id])).rows;
const taskLinks1 = links1.filter((row) => row.object_type === "task" && row.object_id === taskId);
check("②b file_links 建链：任务链 1 条（object_type=task · object_id=本任务）", taskLinks1.length === 1, JSON.stringify(links1));
const cellOne = await waitCellHas([fileAName], 20000);
const cellOneText = String(await ev(CELL_TEXT_PROBE));
check("②c 单元格回流 = 文件名（A · 无「N 份」计数 / 无未定档签 · 口径 2026-09-29 续）", cellOne === true && cellOneText === fileAName, cellOneText);
const popoverListOne = await waitFor("(function(){var p=document.querySelector(" + j(TASK_FILES_POPOVER) + ");return p!==null&&p.querySelectorAll(" + j("[data-task-files-item]") + ").length===1;})()", 15000);
const popoverNamesOne = String(await ev("(function(){var p=document.querySelector(" + j(TASK_FILES_POPOVER) + ");return p===null?" + j("") + ":p.innerText.replace(String.fromCharCode(10)," + j(" / ") + ");})()"));
check("②c2 下拉清单随上传回流 = 1 行 A（上传不关下拉、完成后自动重取）", popoverListOne === true && popoverNamesOne.indexOf(fileAName) >= 0, popoverNamesOne.slice(0, 140));
const list1 = await api("/api/v1/projects/" + projectId + "/tasks");
const item1 = list1.json === null ? undefined : list1.json.items.find((row) => row.id === taskId);
check("②d 列表随行 fileSummary = total 1 / draft 1 / final 0", item1 !== undefined && item1.fileSummary.total === 1 && item1.fileSummary.draft === 1 && item1.fileSummary.final === 0, JSON.stringify(item1 === undefined ? null : item1.fileSummary));

const drawerAfterUpload = await ev("document.querySelector(" + j(DRAWER) + ")===null");
check("②e 上传完成后详情抽屉仍未被连带打开（点击气泡修正）", drawerAfterUpload === true, String(drawerAfterUpload));
// 探针：临时把 type 切成 text，避免无 user activation 的合成 click 去开原生选择框（只验冒泡链路）。
const bubbleProbe = "(function(){var i=document.querySelector(" + j(POPOVER_INPUT) + ");if(i===null){return " + j("no-input") + ";}"
  + "var saved=i.type;i.type=" + j("text") + ";"
  + "i.dispatchEvent(new MouseEvent(" + j("click") + ",{bubbles:true}));"
  + "i.type=saved;"
  + "return document.querySelector(" + j(DRAWER) + ")===null?" + j("ok") + ":" + j("drawer-opened") + ";})()";
const bubbleResult = await ev(bubbleProbe);
check("②f 从 input 冒泡上来的 click 被拦住（回归 Push 226 修正）", bubbleResult === "ok", String(bubbleResult));

// ②g-②i 下拉交互（Push 246）：点文件名 = 预览浮层；Esc 先关浮层、再关下拉（任务行 / 抽屉不被连带）
const namePoint = await ev("(function(){var p=document.querySelector(" + j(TASK_FILES_POPOVER) + ");if(p===null){return null;}var b=p.querySelector(" + j("[data-task-files-preview]") + ");if(b===null){return null;}var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
if (namePoint === null || namePoint === undefined) await bail("下拉里没有文件名按钮（data-task-files-preview）");
await clickAt(namePoint);
const popPreviewShown = await waitFor("document.querySelector(" + j("[data-file-preview]") + ")!==null", 25000);
const popPreviewInfo = popPreviewShown === true ? await ev("(function(){var el=document.querySelector(" + j("[data-file-preview]") + ");return {open:el!==null,kind:el===null?null:el.getAttribute(" + Q + "data-file-preview-kind" + Q + "),popoverClosed:document.querySelector(" + j(TASK_FILES_POPOVER) + ")===null};})()") : { open: false, kind: null, popoverClosed: false };
check("②g 点下拉文件名 = 预览浮层（kind=" + String(popPreviewInfo.kind) + " · 开预览即收下拉）", popPreviewInfo.open === true && popPreviewInfo.kind === "office" && popPreviewInfo.popoverClosed === true, JSON.stringify(popPreviewInfo));
const popPreviewClosed = await waitForAsync(async () => {
  await ev("(function(){if(document.activeElement&&document.activeElement.blur){document.activeElement.blur();}return true;})()");
  await pressKey("Escape", "Escape", 27);
  return (await ev("document.querySelector(" + j("[data-file-preview]") + ")===null&&document.querySelector(" + j(DRAWER) + ")===null")) === true;
}, 20000);
check("②h Esc 关预览浮层（下拉保持收起、详情抽屉不出现 —— 「Esc 先关内层」）", popPreviewClosed === true, String(popPreviewClosed));
const popoverReopenForEsc = await openTaskFilesPopover();
await pressKey("Escape", "Escape", 27);
const escPopover = await waitFor("(function(){return document.querySelector(" + j(TASK_FILES_POPOVER) + ")===null&&document.querySelector(" + j(DRAWER) + ")===null;})()", 6000);
check("②i Esc 先关下拉（任务行 / 详情抽屉不被连带打开）", popoverReopenForEsc === true && escPopover === true, JSON.stringify({ reopened: popoverReopenForEsc, closed: escPopover }));

// ③ 抽屉「文件」行：清单 + 上传入口（先把任务行滚回视口 —— ① 的居中滚动可能把行首推出屏）
await ev("(function(){var rows=document.querySelectorAll(" + j("[role=button]") + ");for(var i=0;i<rows.length;i++){if(rows[i].textContent.indexOf(" + j(TASK_TITLE) + ")>=0){rows[i].scrollIntoView({block:" + j("center") + ",inline:" + j("start") + "});return true;}}return false;})()");
await sleep(400);
const rowPoint = await ev("(function(){var rows=document.querySelectorAll(" + j("[role=button]") + ");for(var i=0;i<rows.length;i++){if(rows[i].textContent.indexOf(" + j(TASK_TITLE) + ")>=0){var b=rows[i].getBoundingClientRect();return {x:Math.round(b.left+60),y:Math.round(b.top+b.height/2)};}}return null;})()");
if (rowPoint === null || rowPoint === undefined) await bail("点不到任务行（行没渲染）");
await clickAt(rowPoint);
const drawerOpen = await waitFor("document.querySelector(" + j(DRAWER) + ")!==null", 8000);
check("③a 点任务行打开详情抽屉", drawerOpen === true, JSON.stringify({ drawerOpen: drawerOpen }));
const drawer1 = await waitDrawerFiles(1, 12000) === true ? await ev(DRAWER_FILES_PROBE) : { open: false, count: 0, names: "", upload: null, input: false };
check("③b 抽屉「文件」清单 = 详情接口下发的 1 行（只出文件名，无「未定档」签）", drawer1.count === 1 && drawer1.names.indexOf(fileAName) >= 0 && drawer1.names.indexOf("未定档") < 0 && drawer1.names.indexOf("已定档") < 0, JSON.stringify(drawer1));
check("③c 抽屉上传入口在位（＋ 上传文件 + 隐藏输入框）", drawer1.upload === "＋ 上传文件" && drawer1.input === true, JSON.stringify({ upload: drawer1.upload, input: drawer1.input }));

// ④ 抽屉内再传一份
await setFileInput(DRAWER_INPUT, fileBPath);
const secondLanded = await waitForAsync(async () => (await db.query("select count(*)::int as c from files where task_id = $1", [taskId])).rows[0].c === 2, 30000);
const fileRows2 = (await db.query("select name, status from files where task_id = $1 order by created_at", [taskId])).rows;
check("④a 抽屉内选文件 → 第二份落库（两条 draft）", secondLanded === true && fileRows2.length === 2 && fileRows2[0].name === fileAName && fileRows2[1].name === fileBName, JSON.stringify(fileRows2));
const drawer2 = await waitDrawerFiles(2, 12000) === true ? await ev(DRAWER_FILES_PROBE) : { count: 0, names: "" };
check("④b 抽屉清单自动重取 = 两行（A / B 都在）", drawer2.count === 2 && drawer2.names.indexOf(fileAName) >= 0 && drawer2.names.indexOf(fileBName) >= 0, JSON.stringify({ count: drawer2.count, names: drawer2.names }));
const drawerIconKinds = await ev("(function(){var d=document.querySelector(" + j(DRAWER) + ");if(d===null){return null;}var icons=d.querySelectorAll(" + j("[data-file-icon]") + ");var out=[];for(var i=0;i<icons.length;i++){out.push(icons[i].getAttribute(" + j("data-file-icon") + "));}return out;})()");
check("④b2 抽屉清单非图片行行首文件类型图标（A / B 两份 txt = text · FA 同族）", Array.isArray(drawerIconKinds) === true && drawerIconKinds.length === 2 && drawerIconKinds[0] === "text" && drawerIconKinds[1] === "text", JSON.stringify(drawerIconKinds));
const cellTwo = await waitCellHas([fileBName, "+1"], 20000);
const cellTwoText = String(await ev(CELL_TEXT_PROBE));
check("④c 任务表「文件」列 = 最新文件名 + 「+1」（两份 · 无未定档签）", cellTwo === true && cellTwoText === fileBName + "+1", cellTwoText);
const list2 = await api("/api/v1/projects/" + projectId + "/tasks");
const item2 = list2.json === null ? undefined : list2.json.items.find((row) => row.id === taskId);
check("④d 列表随行 fileSummary = total 2 / draft 2", item2 !== undefined && item2.fileSummary.total === 2 && item2.fileSummary.draft === 2, JSON.stringify(item2 === undefined ? null : item2.fileSummary));

// ⑤（续）抽屉去定档签 + 图片预览 + 删除（回收站）
const drawerText = String(await ev("(function(){var d=document.querySelector(" + j(DRAWER) + ");return d===null?" + j("") + ":d.innerText;})()"));
check("④e 抽屉里不再出现「未定档 / 已定档」（定档是项目级安排，不在文件上区分）", drawerText.indexOf("未定档") < 0 && drawerText.indexOf("已定档") < 0, drawerText.replace(/\n/g, " / ").slice(0, 100));

await setFileInput(DRAWER_INPUT, filePngPath);
const thirdLanded = await waitForAsync(async () => (await db.query("select count(*)::int as c from files where task_id = $1", [taskId])).rows[0].c === 3, 30000);
const pngRow = (await db.query("select id, name, status from files where task_id = $1 and name = $2", [taskId, filePngName])).rows[0];
check("④f 抽屉内再传一张真 PNG → 第三份落库", thirdLanded === true && pngRow !== undefined && pngRow.name === filePngName, JSON.stringify(pngRow === undefined ? null : pngRow));
const drawer3 = await waitDrawerFiles(3, 15000);
check("④g 抽屉清单 = 三行（A txt / B txt / PNG）", drawer3 === true, String(drawer3));

const thumbReady = await waitFor("(function(){var items=document.querySelectorAll(" + j("[data-drawer-file-item]") + ");"
  + "for(var i=0;i<items.length;i++){if(items[i].textContent.indexOf(" + j(filePngName) + ")>=0){"
  + "var t=items[i].querySelector(" + j("[data-file-thumb=true]") + ");if(t===null){return false;}"
  + "var img=t.querySelector(" + j("img") + ");var src=img===null?null:img.getAttribute(" + j("src") + ");"
  + "return src!==null&&src.indexOf(" + j("http") + ")==0;}}return false;})()", 30000);
check("④g2 图片行内直接出小缩略图（40×40 · img src = 短时签名 http · 同日报附图口径）", thumbReady === true, String(thumbReady));
const txtNoThumb = String(await ev("(function(){var items=document.querySelectorAll(" + j("[data-drawer-file-item]") + ");for(var i=0;i<items.length;i++){if(items[i].textContent.indexOf(" + j(fileAName) + ")>=0){return items[i].querySelector(" + j("[data-file-thumb=true]") + ")===null;}}return false;})()"));
check("④g3 非图片（txt）行不出缩略图", txtNoThumb === "true", txtNoThumb);

const previewPoint = await fileRowPoint(filePngName, "[data-file-thumb=true]");
if (previewPoint === null || previewPoint === undefined) await bail("PNG 行没有预览入口（图片判定 / 渲染没接上）");
await clickAt(previewPoint);
const previewShown = await waitFor("document.querySelector(" + j("[data-file-preview]") + ")!==null", 30000);
const previewInfo = previewShown === true ? await ev("(function(){var el=document.querySelector(" + j("[data-file-preview]") + ");var img=el===null?null:el.querySelector(" + j("img") + ");var src=img===null?null:img.getAttribute(" + j("src") + ");return {open:el!==null,http:src!==null&&src.indexOf(" + j("http") + ")==0,drawer:document.querySelector(" + j(DRAWER) + ")!==null};})()") : { open: false, http: false, drawer: false };
check("④h 点小缩略图 → 大图预览浮层（img src = 短时签名 http 地址）", previewInfo.open === true && previewInfo.http === true && previewInfo.drawer === true, JSON.stringify(previewInfo));

await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
const escInner = await waitFor("(function(){return document.querySelector(" + j("[data-file-preview]") + ")===null&&document.querySelector(" + j(DRAWER) + ")!==null;})()", 8000);
check("④i Esc 先关预览浮层、抽屉仍在（「Esc 先关内层」）", escInner === true, String(escInner));

// ⑤（续二）文件名可修改（业务口径 2026-09-29「名称要可以修改」）：点名字进编辑、只改主名（后缀保留）、回车提交
const pngDbRow = (await db.query("select id, name from files where task_id = $1 and name = $2", [taskId, filePngName])).rows[0];
const renamePoint = await fileRowPoint(filePngName, "[data-file-rename=true]");
if (renamePoint === null || renamePoint === undefined) await bail("PNG 行没有改名入口（data-file-rename）");
await clickAt(renamePoint);
const renameBox = await ev("(function(){var i=document.querySelector(" + j("[data-file-rename-input=true]") + ");return i===null?null:{value:i.value,focused:document.activeElement===i};})()");
check("④n1 点文件名进编辑：输入框只含主名（后缀 .png 原位保留、不参与编辑）", renameBox !== null && renameBox !== undefined && renameBox.value === "回放-现场图-A" && renameBox.focused === true, JSON.stringify(renameBox));
const filePngRenamed = "回放-现场图-A-改名.png";
await typeRenameInput("回放-现场图-A-改名");
await pressKey("Enter", "Enter", 13);
const renamedOk = await waitForAsync(async () => (await db.query("select name from files where id = $1", [pngDbRow.id])).rows[0].name === filePngRenamed, 20000);
check("④n2 回车提交落库：新主名 + 原后缀 = 「" + filePngRenamed + "」", renamedOk === true, String(renamedOk));
const drawerRenamed = await waitDrawerFiles(3, 15000);
const drawerRenamedNames = String(await ev("(function(){return Array.prototype.map.call(document.querySelectorAll(" + j("[data-drawer-file-item]") + "),function(el){return el.innerText;}).join(" + j("|") + ");})()"));
const cellRenamed = await waitCellHas([filePngRenamed, "+2"], 20000);
const cellRenamedText = String(await ev(CELL_TEXT_PROBE));
check("④n3 改名回流：抽屉清单与「文件」列都出新名（列 = 新名 + 「+2」）", drawerRenamed === true && drawerRenamedNames.indexOf(filePngRenamed) >= 0 && cellRenamed === true && cellRenamedText === filePngRenamed + "+2", JSON.stringify({ drawer: drawerRenamedNames.slice(0, 130), cell: cellRenamedText }));
// Esc 取消：不写库、不关抽屉（与预览浮层同一条「Esc 先关内层」口径）
const renamePoint2 = await fileRowPoint(filePngRenamed, "[data-file-rename=true]");
if (renamePoint2 === null || renamePoint2 === undefined) await bail("改名后 PNG 行没有改名入口");
await clickAt(renamePoint2);
await typeRenameInput("不该落库");
await pressKey("Escape", "Escape", 27);
const escNameOk = (await db.query("select name from files where id = $1", [pngDbRow.id])).rows[0].name === filePngRenamed;
const escDrawerOk = await waitFor("(function(){return document.querySelector(" + j(DRAWER) + ")!==null&&document.querySelector(" + j("[data-file-rename-input=true]") + ")==null;})()", 8000);
check("④n4 Esc 取消：不写库、输入框收起、抽屉仍在（「Esc 先关内层」）", escNameOk === true && escDrawerOk === true, JSON.stringify({ name: escNameOk, drawer: escDrawerOk }));
// 空主名不写回：清空后回车 = 保持原名
const renamePoint3 = await fileRowPoint(filePngRenamed, "[data-file-rename=true]");
if (renamePoint3 === null || renamePoint3 === undefined) await bail("空名校验前 PNG 行改名入口不在");
await clickAt(renamePoint3);
await typeRenameInput("");
await pressKey("Enter", "Enter", 13);
await sleep(400);
const emptyKeep = (await db.query("select name from files where id = $1", [pngDbRow.id])).rows[0].name === filePngRenamed;
check("④n5 空主名回车：不写回（保持原名）", emptyKeep === true, String(emptyKeep));

const fileBId = (await db.query("select id from files where task_id = $1 and name = $2", [taskId, fileBName])).rows[0].id;
const deletePoint = await fileRowPoint(fileBName, "[data-file-delete=true] button");
if (deletePoint === null || deletePoint === undefined) await bail("B 行没有删除入口");
await clickAt(deletePoint);
const confirmShown = await waitFor("document.querySelector(" + j("[data-file-delete-confirm]") + ")!==null", 6000);
if (confirmShown !== true) {
  console.log("诊断·抽屉文本：" + String(await ev("(function(){var d=document.querySelector(" + j(DRAWER) + ");return d===null?" + j("(抽屉不在)") + ":d.innerText.replace(/\\n/g," + j(" | ") + ");})()")).slice(0, 400));
  console.log("诊断·B 行 HTML：" + String(await ev("(function(){var items=document.querySelectorAll(" + j("[data-drawer-file-item]") + ");for(var i=0;i<items.length;i++){if(items[i].textContent.indexOf(" + j(fileBName) + ")>=0){return items[i].outerHTML;}}return " + j("(没找到 B 行)") + ";})()")).slice(0, 700));
}
const statusBeforeConfirm = (await db.query("select status from files where id = $1", [fileBId])).rows[0].status;
check("④j 「删除」第一下 = 二次确认条（此时未落库）", confirmShown === true && statusBeforeConfirm === "draft", "confirm=" + String(confirmShown) + " status=" + statusBeforeConfirm);
const confirmPoint = await ev("(function(){var strip=document.querySelector(" + j("[data-file-delete-confirm]") + ");if(strip===null){return null;}var b=strip.querySelector(" + j("button") + ");if(b===null){return null;}var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
if (confirmPoint === null || confirmPoint === undefined) await bail("找不到确认删除按钮");
await clickAt(confirmPoint);
const recycledOk = await waitForAsync(async () => (await db.query("select status from files where id = $1", [fileBId])).rows[0].status === "recycled", 20000);
check("④k 二次确认后落库 = 回收站（status recycled · 30 天内可恢复）", recycledOk === true, String(recycledOk));
const drawerBack2 = await waitDrawerFiles(2, 15000);
check("④l 清单回到 2 行（回收站不进任务详情清单）", drawerBack2 === true, String(drawerBack2));
const cellBack2 = await waitCellHas([filePngRenamed, "+1"], 20000);
const cellBack2Text = String(await ev(CELL_TEXT_PROBE));
check("④m 表格「文件」列 = 改名后的 PNG + 「+1」（recycled 不进列 / 无「N 份」）", cellBack2 === true && cellBack2Text === filePngRenamed + "+1", cellBack2Text);

// ⑤（续三）PDF 点击预览（业务口径 2026-09-29「这个pdf我也打不开啊」）：PDF 源直通 → 内置查看器 iframe
await setFileInput(DRAWER_INPUT, filePdfPath);
const fourthLanded = await waitForAsync(async () => (await db.query("select count(*)::int as c from files where task_id = $1", [taskId])).rows[0].c === 4, 30000);
const pdfRow = (await db.query("select id, name, status from files where task_id = $1 and name = $2", [taskId, filePdfName])).rows[0];
check("④o1 抽屉内再传一份真 PDF → 第四份落库（draft）", fourthLanded === true && pdfRow !== undefined && pdfRow.name === filePdfName && pdfRow.status === "draft", JSON.stringify(pdfRow === undefined ? null : pdfRow));
const drawer4 = await waitDrawerFiles(3, 15000);
const cellPdf = await waitCellHas([filePdfName, "+2"], 20000);
const cellPdfText = String(await ev(CELL_TEXT_PROBE));
check("④o2 清单三行 + 「文件」列 = 最新 PDF 名 + 「+2」", drawer4 === true && cellPdf === true && cellPdfText === filePdfName + "+2", JSON.stringify({ drawer: drawer4, cell: cellPdfText }));
const pdfPoint = await fileRowPoint(filePdfName, "[data-file-preview-open=true]");
if (pdfPoint === null || pdfPoint === undefined) await bail("PDF 行没有预览入口（data-file-preview-open）");
await clickAt(pdfPoint);
const pdfPreviewShown = await waitFor("(function(){return document.querySelector(" + j("[data-file-preview-kind=pdf]") + ")!==null&&document.querySelector(" + j("[data-oo-status=ready]") + ")!==null;})()", 60000);
const pdfPreviewInfo = pdfPreviewShown === true ? await ev("(function(){var el=document.querySelector(" + j("[data-file-preview]") + ");if(el===null){return {open:false};}var v=el.querySelector(" + j("[data-onlyoffice-viewer=true]") + ");var dl=el.querySelector(" + j("[data-file-preview-download=true]") + ");return {open:true,viewer:v!==null,status:v===null?null:v.getAttribute(" + j("data-oo-status") + "),frames:v===null?0:v.querySelectorAll(" + j("iframe") + ").length,download:dl!==null,drawer:document.querySelector(" + j(DRAWER) + ")!==null};})()") : { open: false, viewer: false, status: null, frames: 0, download: false, drawer: false };
check("④o3 点「预览」→ PDF 走 ONLYOFFICE 查看器（data-oo-status=ready + 编辑器 iframe 在位；caption 带「下载原文件」入口）", pdfPreviewInfo.open === true && pdfPreviewInfo.viewer === true && pdfPreviewInfo.status === "ready" && pdfPreviewInfo.frames >= 1 && pdfPreviewInfo.download === true && pdfPreviewInfo.drawer === true, JSON.stringify(pdfPreviewInfo));
const pdfShot = await page.send("Page.captureScreenshot", { format: "png" });
writeFileSync(join(SCREENSHOT_DIR, "m4-07-pdf-preview.png"), Buffer.from(pdfShot.data, "base64"));
console.log("截图：" + join(SCREENSHOT_DIR, "m4-07-pdf-preview.png"));
const escPdf = await waitForAsync(async () => {
  // 编辑器 iframe 会抢焦点：先 blur 回上层文档再发 Esc（与 ④q2 同一对抗手法）
  await ev("(function(){if(document.activeElement&&document.activeElement.blur){document.activeElement.blur();}return true;})()");
  await pressKey("Escape", "Escape", 27);
  return (await ev("(function(){return document.querySelector(" + j("[data-file-preview]") + ")===null&&document.querySelector(" + j(DRAWER) + ")!==null;})()")) === true;
}, 20000);
check("④o4 Esc 先关 PDF 查看器浮层、抽屉仍在（「Esc 先关内层」）", escPdf === true, String(escPdf));

// ⑤（续四）下载 = 原文件（业务口径 2026-09-30「下载为什么都是pdf 你是不是签名调用错了」）
const downloadDir = mkdtempSync(join(tmpdir(), "pxm4fu-dl-"));
try {
  await page.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
} catch (error) {
  await page.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
}
const rowsWithDownload = String(await ev("(function(){var items=document.querySelectorAll(" + j("[data-drawer-file-item]") + ");if(items.length===0){return " + j("no-rows") + ";}for(var i=0;i<items.length;i++){if(items[i].querySelector(" + j("[data-file-download=true]") + ")===null){return " + j("missing") + ";}}return " + j("ok") + ";})()"));
check("④p1 抽屉每行都有「下载」入口（原文件下载）", rowsWithDownload === "ok", rowsWithDownload);
async function waitDownloaded(name) {
  for (let i = 0; i < 40; i += 1) {
    const path = join(downloadDir, name);
    if (existsSync(path)) return path;
    await sleep(300);
  }
  return null;
}
const pdfDownloadPoint = await fileRowPoint(filePdfName, "[data-file-download=true]");
if (pdfDownloadPoint === null || pdfDownloadPoint === undefined) await bail("PDF 行没有下载入口");
await clickAt(pdfDownloadPoint);
const pdfDownloaded = await waitDownloaded(filePdfName);
const pdfBytesOk = pdfDownloaded !== null && readFileSync(pdfDownloaded).equals(readFileSync(filePdfPath));
check("④p2 点「下载」→ 落盘原 PDF（字节与上传件全等；不是预览转换件）", pdfDownloaded !== null && pdfBytesOk, String(pdfDownloaded));
const pdfDownloadAudit = (await db.query("select count(*)::int as c from audit_logs where object_id = $1 and action = $2", [pdfRow.id, "download"])).rows[0].c;
check("④p3 下载写 download 审计（A4-10：一次下载一条）", Number(pdfDownloadAudit) >= 1, "audit=" + String(pdfDownloadAudit));
const pngDownloadPoint = await fileRowPoint(filePngRenamed, "[data-file-download=true]");
if (pngDownloadPoint === null || pngDownloadPoint === undefined) await bail("PNG 行没有下载入口");
await clickAt(pngDownloadPoint);
const pngDownloaded = await waitDownloaded(filePngRenamed);
const pngBytesOk = pngDownloaded !== null && readFileSync(pngDownloaded).equals(readFileSync(filePngPath));
check("④p4 图片行「下载」= 改名后的原名落盘 + 原 PNG 字节（非预览转换件）", pngDownloaded !== null && pngBytesOk, String(pngDownloaded));

// 失败时留一张现场截图（排障用；正常跑不写）。
if (checks.filter((ok) => ok !== true).length > 0) {
  const shotFail = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SCREENSHOT_DIR, "m4-07-fail.png"), Buffer.from(shotFail.data, "base64"));
  console.log("失败现场截图：" + join(SCREENSHOT_DIR, "m4-07-fail.png"));
}

// ---------- 截图（本地目视证据） ----------
const shotDrawer = await page.send("Page.captureScreenshot", { format: "png" });
writeFileSync(join(SCREENSHOT_DIR, "m4-07-drawer.png"), Buffer.from(shotDrawer.data, "base64"));
await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await waitFor("document.querySelector(" + j(DRAWER) + ")===null", 8000);

// ④q（Push 246）「文件」列下拉收口：点文件名 = 预览（开预览即收下拉 / Esc 先关浮层）；行尾「删除」= 红胶囊 + 行内二次确认 → 回收站
const popoverReopened = await openTaskFilesPopover();
check("④q0 关抽屉后点「文件」列胶囊 = 下拉重开（3 行：PDF / 改名 PNG / A 都在）", popoverReopened === true, String(popoverReopened));
const popoverIconPairs = await ev("(function(){var items=document.querySelectorAll(" + j("[data-task-files-item]") + ");var out=[];for(var i=0;i<items.length;i++){var icon=items[i].querySelector(" + j("[data-file-icon]") + ");var name=items[i].querySelector(" + j("[data-task-files-preview]") + ");out.push({icon:icon===null?null:icon.getAttribute(" + j("data-file-icon") + "),name:name===null?null:name.textContent.trim()});}return out;})()");
const popoverIconMap = {};
if (Array.isArray(popoverIconPairs)) { for (const pair of popoverIconPairs) { if (pair !== null && pair.name !== null && pair.name !== undefined) { popoverIconMap[pair.name] = pair.icon; } } }
check("④q0b 下拉清单行首文件类型图标（PDF=pdf / 改名 PNG=image / A=txt · FA 同族）", popoverIconMap[filePdfName] === "pdf" && popoverIconMap[filePngRenamed] === "image" && popoverIconMap[fileAName] === "text", JSON.stringify(popoverIconMap));
const listNamePoint = await ev("(function(){var p=document.querySelector(" + j(TASK_FILES_POPOVER) + ");if(p===null){return null;}var b=p.querySelector(" + j("[data-task-files-preview]") + ");if(b===null){return null;}var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
if (listNamePoint === null || listNamePoint === undefined) await bail("下拉里没有文件名按钮（data-task-files-preview）");
await clickAt(listNamePoint);
const listPreviewShown = await waitFor("document.querySelector(" + j("[data-file-preview]") + ")!==null", 25000);
const listPreviewInfo = listPreviewShown === true ? await ev("(function(){var el=document.querySelector(" + j("[data-file-preview]") + ");return {open:el!==null,kind:el===null?null:el.getAttribute(" + Q + "data-file-preview-kind" + Q + "),popoverClosed:document.querySelector(" + j(TASK_FILES_POPOVER) + ")===null};})()") : { open: false, kind: null, popoverClosed: false };
check("④q1 点下拉里最新一份（PDF）文件名 = 预览浮层（kind=" + String(listPreviewInfo.kind) + " · 开预览即收下拉）", listPreviewInfo.open === true && listPreviewInfo.kind === "pdf" && listPreviewInfo.popoverClosed === true, JSON.stringify(listPreviewInfo));
const listPreviewClosed = await waitForAsync(async () => {
  await ev("(function(){if(document.activeElement&&document.activeElement.blur){document.activeElement.blur();}return true;})()");
  await pressKey("Escape", "Escape", 27);
  return (await ev("document.querySelector(" + j("[data-file-preview]") + ")===null&&document.querySelector(" + j(DRAWER) + ")===null")) === true;
}, 20000);
check("④q2 Esc 关预览浮层（下拉保持收起、详情抽屉不出现 —— 「Esc 先关内层」）", listPreviewClosed === true, String(listPreviewClosed));
const popoverForDelete = await openTaskFilesPopover();
const popRowProbe = await ev("(function(){var items=document.querySelectorAll(" + j("[data-task-files-item]") + ");for(var i=0;i<items.length;i++){if(items[i].textContent.indexOf(" + j(filePdfName) + ")>=0){var b=items[i].querySelector(" + j("[data-task-files-delete] button") + ");var n=items[i].querySelector(" + j("[data-task-files-preview]") + ");if(b===null||n===null){return null;}var rb=b.getBoundingClientRect();var rn=n.getBoundingClientRect();return {bx:Math.round(rb.left+rb.width/2),by:Math.round(rb.top+rb.height/2),nx:Math.round(rn.left+10),ny:Math.round(rn.top+rn.height/2)};}}return null;})()");
if (popoverForDelete !== true || popRowProbe === null || popRowProbe === undefined) await bail("下拉里 PDF 行没有删除入口（data-task-files-delete）");
const capsuleMeasure = "(function(){var items=document.querySelectorAll(" + j("[data-task-files-item]") + ");for(var i=0;i<items.length;i++){if(items[i].textContent.indexOf(" + j(filePdfName) + ")>=0){var b=items[i].querySelector(" + j("[data-task-files-delete] button") + ");if(b===null){return null;}var r=b.getBoundingClientRect();var s=getComputedStyle(b);return {w:Math.round(r.width),h:Math.round(r.height),opacity:s.opacity,bg:s.backgroundColor};}}return null;})()";
const capsuleRest = await ev(capsuleMeasure);
await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: popRowProbe.nx, y: popRowProbe.ny });
await sleep(400);
const capsuleGhost = await ev(capsuleMeasure);
await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: popRowProbe.bx, y: popRowProbe.by });
await sleep(600);
const capsuleHover = await ev(capsuleMeasure);
check("④q3a 行尾删除 = 胶囊同款动效（静止隐 → 随行悬停浮现 24px 幽灵态 → 悬停按钮展开 48px 红胶囊）", capsuleRest !== null && capsuleRest.opacity === "0" && capsuleGhost !== null && capsuleGhost.opacity === "1" && capsuleGhost.w === 24 && capsuleGhost.h === 24 && capsuleHover !== null && capsuleHover.w === 48 && (capsuleHover.bg.indexOf("239, 68, 68") >= 0 || capsuleHover.bg.indexOf("0.637 0.237 25.331") >= 0), JSON.stringify({ rest: capsuleRest, ghost: capsuleGhost, hover: capsuleHover }));
await clickAt({ x: popRowProbe.bx, y: popRowProbe.by });
const popConfirmShown = await waitFor("document.querySelector(" + j("[data-task-files-delete-confirm]") + ")!==null", 6000);
const pdfBeforePopDelete = (await db.query("select status from files where id = $1", [pdfRow.id])).rows[0].status;
check("④q3 下拉「删除」（红胶囊）第一下 = 行内二次确认（此时未落库）", popConfirmShown === true && pdfBeforePopDelete === "draft", "confirm=" + String(popConfirmShown) + " status=" + pdfBeforePopDelete);
const popConfirmPoint = await ev("(function(){var strip=document.querySelector(" + j("[data-task-files-delete-confirm]") + ");if(strip===null){return null;}var b=strip.querySelector(" + j("button") + ");if(b===null){return null;}var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
if (popConfirmPoint === null || popConfirmPoint === undefined) await bail("下拉里找不到确认删除按钮");
await clickAt(popConfirmPoint);
const popRecycled = await waitForAsync(async () => (await db.query("select status from files where id = $1", [pdfRow.id])).rows[0].status === "recycled", 20000);
check("④q4 二次确认后落库 = 回收站（status recycled · 30 天内可恢复）", popRecycled === true, String(popRecycled));
const popListAfterDelete = await waitFor("(function(){var p=document.querySelector(" + j(TASK_FILES_POPOVER) + ");return p!==null&&p.querySelectorAll(" + j("[data-task-files-item]") + ").length===2;})()", 15000);
const cellAfterPopDelete = await waitCellHas([filePngRenamed, "+1"], 20000);
const cellAfterPopDeleteText = String(await ev(CELL_TEXT_PROBE));
check("④q5 下拉清单回落 2 行、「文件」列 = 改名后的 PNG + 「+1」（recycled 不进读面）", popListAfterDelete === true && cellAfterPopDelete === true && cellAfterPopDeleteText === filePngRenamed + "+1", JSON.stringify({ list: popListAfterDelete, cell: cellAfterPopDeleteText }));
const shotHoverPoint = await ev("(function(){var b=document.querySelector(" + j("[data-task-files-delete] button") + ");if(b===null){return null;}var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
if (shotHoverPoint !== null && shotHoverPoint !== undefined) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: shotHoverPoint.x, y: shotHoverPoint.y });
  await sleep(700);
}
const shotPopover = await page.send("Page.captureScreenshot", { format: "png" });
writeFileSync(join(SCREENSHOT_DIR, "m4-07-task-files-popover.png"), Buffer.from(shotPopover.data, "base64"));
await pressKey("Escape", "Escape", 27);
await waitFor("document.querySelector(" + j(TASK_FILES_POPOVER) + ")===null", 6000);
await ev("(function(){var b=document.querySelector(" + j(FILE_CELL_BUTTON) + ");if(b!==null){b.scrollIntoView({block:" + j("center") + ",inline:" + j("center") + "});}return true;})()");
await sleep(700);
const cellBox = await ev("(function(){var b=document.querySelector(" + j(FILE_CELL_BUTTON) + ");if(b===null){return null;}var r=b.getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height};})()");
if (cellBox !== null && cellBox !== undefined) {
  const clip = { x: Math.max(0, cellBox.x - 170), y: Math.max(0, cellBox.y - 26), width: cellBox.width + 340, height: cellBox.height + 52, scale: 2 };
  const shotCell = await page.send("Page.captureScreenshot", { format: "png", clip });
  writeFileSync(join(SCREENSHOT_DIR, "m4-07-file-cell.png"), Buffer.from(shotCell.data, "base64"));
  console.log("截图：" + join(SCREENSHOT_DIR, "m4-07-task-files-popover.png") + " / " + join(SCREENSHOT_DIR, "m4-07-file-cell.png") + " / " + join(SCREENSHOT_DIR, "m4-07-drawer.png"));
}

// ---------- ⑥ 收尾：purge 三份文件 → 物理删临时项目 → 撤销会话 → 零残留 ----------
const purgeResult = await purgeProjectFiles(projectId);
check("⑤a 四份回放文件（含已回收的 B / PDF）全部 purge（对象真删 + 元数据删 + 留痕）", purgeResult.total === 4 && purgeResult.purged === 4, JSON.stringify(purgeResult));
const projRow = await api("/api/v1/projects/" + projectId);
const delProj = await api("/api/v1/projects/" + projectId, "DELETE", undefined, { "If-Match": String(projRow.json.version) });
check("⑤b 临时项目物理删（200 / 204）", delProj.status === 200 || delProj.status === 204, String(delProj.status) + " " + delProj.text.slice(0, 120));
const projGone = await api("/api/v1/projects/" + projectId);
check("⑤c 项目读面 404（物理删、行不存在）", projGone.status === 404, String(projGone.status));
await db.query("update sessions set revoked_at = now() where token_hash = $1", [sha256(token)]);
const residue = (await db.query("select (select count(*)::int from files where project_id = $1) as files, (select count(*)::int from file_links where object_id = $2) as links, (select count(*)::int from tasks where id = $2) as tasks, (select count(*)::int from projects where id = $1) as projects, (select count(*)::int from sessions where token_hash = $3 and revoked_at is null) as sessions", [projectId, taskId, sha256(token)])).rows[0];
check("⑤d 零残留：文件 / 关联 / 任务 / 项目 / 会话全 0 行", Number(residue.files) === 0 && Number(residue.links) === 0 && Number(residue.tasks) === 0 && Number(residue.projects) === 0 && Number(residue.sessions) === 0, JSON.stringify(residue));

rmSync(fileDir, { recursive: true, force: true });
rmSync(downloadDir, { recursive: true, force: true });
const failed = checks.filter((ok) => ok !== true).length;
console.log("—— 合计 " + String(checks.length) + " 项：" + String(checks.length - failed) + " 通过 / " + String(failed) + " 失败 ——");
const pageEvents = page.events.filter((line) => line.indexOf("EVT ") === 0);
console.log("页面控制台 / 异常：" + String(pageEvents.length) + " 条");
for (const line of pageEvents.slice(0, 8)) { console.log("  " + line.slice(0, 240)); }
try { page.ws.close(); } catch (error) { /* 忽略 */ }
chrome.kill();
await db.end();
process.exit(failed === 0 ? 0 : 1);
