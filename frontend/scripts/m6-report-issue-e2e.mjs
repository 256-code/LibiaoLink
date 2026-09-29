#!/usr/bin/env node
/**
 * LibiaoLink 前端 · 回放：日报及问题「接真」（Push 216 · M6-01 ~ M6-03 前端接线）
 *
 * 前置（都在本机跑着）：
 *   1. 前端 dev：cd frontend && npm run dev（默认 3000）
 *   2. api：cd server && npm run start:api（默认 3001）
 *   3. worker：cd server && npm run start:worker（预览 outbox 消费 —— 附图缩略图出图靠它）
 *   4. 对象存储 + 预览转换器：本地沙箱（S3 9000 / 转换器 127.0.0.1:9900）
 *   5. 数据库：本地沙箱 PG（默认 127.0.0.1:5433/libiaolink）
 *   6. 本机装了 Chrome（脚本 headless 起一个调试实例；路径可用 CHROME_PATH 覆盖）
 *
 * 用法：node scripts/m6-report-issue-e2e.mjs
 *   可覆盖的环境变量：FRONTEND_BASE / API_BASE / DATABASE_URL / CHROME_PATH / CDP_PORT / REPLAY_USER / PG_MODULE
 *
 * 它做什么：用一条**临时会话**（跑完撤销）+ 一个**临时项目**（跑完硬删、零残留）在真机浏览器里跑一遍
 * 日报及问题接真后的读写口径 ——
 *   ① 首屏：四块子视图键帽齐 + 「日报填写」表单（日期默认今天 / 提交人 = 当前用户 / 「现场发现问题」前置开关禁用三件）；
 *   ② 附图真粘贴：真实剪贴板 + 真 Ctrl+V → 文件库分片直传 → fileId 回填（现场工作附图 + 当前问题附图两区各自上传完）；
 *   ③ 提交落库：日报 submitted + 服务端按「现场发现问题」自动生成问题（open）+ 问题图**转挂**问题侧（日报侧 issuePhotos 归零）；
 *   ④ 同日多条：同一天第二篇照样落库（无唯一约束），列表两行；
 *   ⑤ 草稿写库：暂存 = state=draft（列表出「草稿」签）；同一表单再点「提交日报」= PATCH 转 submitted（不新增行）；
 *   ⑥ 编辑落库（Push 223 起：文字 / 图片走干系人同款弹窗、下拉保持行内）：日报（完成工作 / 明日计划 / 现场工作附图 / 关联阶段）
 *      与问题（描述 / 解决方案 / 问题附图 / 归类 / 状态三态）PATCH 回包替换该行、version 递增；
 *      Push 224 续：问题详情抽屉里「移除图片」要二次确认（第一下 × 只出确认条、第二下「移除」才落库）；
 *   ⑦ 成对删除：删问题连来源日报、删日报连派生问题（两侧读面同时归零）；
 *   ⑧ 收尾：删临时项目（物理删）→ 读面 404；撤销临时会话；库内零残留。
 * 证据：docs/m6-回放证据(日报及问题接真·前端).md
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
const PG_MODULE = process.env.PG_MODULE ?? new URL("../../server/node_modules/pg/lib/index.js", import.meta.url).href;
const { default: pg } = await import(PG_MODULE);
const { Client } = pg;

const FRONTEND = process.env.FRONTEND_BASE ?? "http://localhost:3000";
const API = process.env.API_BASE ?? "http://127.0.0.1:3001";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(process.env.CDP_PORT ?? 9411);
const DB = process.env.DATABASE_URL ?? "postgres://libiaolink_api@127.0.0.1:5433/libiaolink";
const REPLAY_USER = process.env.REPLAY_USER ?? "panxing";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const LF = String.fromCharCode(10);
const Q = String.fromCharCode(34);
const j = (value) => JSON.stringify(value);

const db = new Client({ connectionString: DB });
await db.connect();
const userRow = (await db.query("select id, username, display_name from users where username = $1", [REPLAY_USER])).rows[0];
if (userRow === undefined) {
  console.error("回放用户不存在：" + REPLAY_USER);
  process.exit(1);
}
const token = "pxm6ri-" + randomBytes(16).toString("hex");
const csrf = randomBytes(16).toString("hex");
await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(mins => 30))", [sha256(token), userRow.id, "px-m6-report-issue-e2e"]);
console.log("临时会话：" + userRow.username + "（" + userRow.display_name + "）");

const COOKIE = "ll_sid=" + token + "; ll_csrf=" + csrf;
async function api(path, method = "GET", body, extra) {
  const headers = Object.assign({ Cookie: COOKIE, "X-CSRF-Token": csrf, Accept: "application/json" }, extra || {});
  const init = { method, headers };
  if (body !== undefined) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  const res = await fetch(API + path, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (error) { json = null; }
  return { status: res.status, json, text };
}

const checks = [];
function check(name, ok, detail) {
  checks.push(ok === true);
  console.log((ok === true ? "PASS  " : "FAIL  ") + name + (detail === undefined ? "" : "   [" + detail + "]"));
}

/** 项目清场前把项目内文件先「回收站 → purge」清掉。
 *  背景（Push 216 回放实测 · **后端待修**）：`ProjectRepository.hardDeleteWithVersion` 先删 file_versions 再删 files，
 *  而 files.current_version_id → file_versions(id) 有外键（fk_files_current_version）—— 项目里有「已完成版本」的文件时
 *  物理删项目会 500（violates foreign key constraint fk_files_current_version）。文件侧 purge 自己处理得干净，
 *  所以回放先走文件回收站把图清掉，再删项目；这条挂 wmj 线修（删除顺序应为 先清 files.current_version_id / 先删 files）。 */
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
const stale = (await db.query("select id from projects where code like $1 and deleted_at is null", ["PX-M6RI-%"])).rows;
for (const row of stale) {
  const staleRow = await api("/api/v1/projects/" + row.id);
  if (staleRow.json === null) continue;
  await purgeProjectFiles(row.id);
  const gone = await api("/api/v1/projects/" + row.id, "DELETE", undefined, { "If-Match": String(staleRow.json.version) });
  console.log("清场：删残留临时项目 " + row.id + " → " + String(gone.status));
}

// ---------- 夹具：临时项目 ----------
const fixtureCode = "PX-M6RI-" + randomBytes(3).toString("hex").toUpperCase();
const projRes = await api("/api/v1/projects", "POST", { code: fixtureCode, name: "M6回放·日报及问题接真", description: "M6回放·日报及问题接真", managerIds: [userRow.id] });
check("夹具：建临时项目（201）", projRes.status === 201, String(projRes.status) + " " + projRes.text.slice(0, 140));
const projectId = projRes.json === null ? "" : projRes.json.id;
const reportsOf = async () => (await api("/api/v1/projects/" + projectId + "/reports?limit=200")).json;
const issuesOf = async () => (await api("/api/v1/projects/" + projectId + "/issues?limit=200")).json;


const profile = mkdtempSync(join(tmpdir(), "pxm6ri-"));
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
await page.send("Log.enable");
await page.send("Network.setCookie", { name: "ll_sid", value: token, url: FRONTEND + "/", path: "/", httpOnly: true, secure: false });
await page.send("Network.setCookie", { name: "ll_csrf", value: csrf, url: FRONTEND + "/", path: "/", httpOnly: false, secure: false });
await page.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
// 无头页默认「不聚焦」—— 浏览器粘贴命令只在聚焦文档里可用（真 Ctrl+V 回放要用）
await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await page.send("Browser.grantPermissions", { origin: FRONTEND, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ev = async (expression) => {
  const reply = await page.send("Runtime.evaluate", { expression, returnByValue: true });
  if (reply.exceptionDetails !== undefined) throw new Error("页面表达式抛异常：" + JSON.stringify(reply.exceptionDetails).slice(0, 300) + " | " + expression.slice(0, 160));
  return reply.result.value;
};
const evAwait = async (expression, userGesture) => {
  const params = { expression, returnByValue: true, awaitPromise: true };
  if (userGesture === true) params.userGesture = true;
  const reply = await page.send("Runtime.evaluate", params);
  if (reply.exceptionDetails !== undefined) return "THROWN:" + JSON.stringify(reply.exceptionDetails).slice(0, 200);
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
async function openDaily(sub) {
  await page.send("Page.navigate", { url: "about:blank" });
  await sleep(400);
  await page.send("Page.navigate", { url: FRONTEND + "/#/project/" + projectId + "?view=daily" + (sub === undefined ? "" : "&sub=" + sub) });
  await sleep(4800);
}
async function rectOf(selector) {
  return await ev("(() => { const node = document.querySelector(" + j(selector) + ");"
    + " if (node === null) { return null; }"
    + " node.scrollIntoView({ block: " + j("center") + ", inline: " + j("nearest") + " });"
    + " const box = node.getBoundingClientRect();"
    + " if (box.width === 0 || box.height === 0) { return null; }"
    + " return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }; })()");
}
async function clickAt(point) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(500);
}
async function clickSelector(selector) {
  const point = await rectOf(selector);
  if (point === null || point === undefined) throw new Error("点不到（元素不存在或不可见）：" + selector);
  await clickAt(point);
  return point;
}
async function pressKey(key, code, vk, modifiers = 0) {
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await sleep(260);
}
async function typeInto(selector, text) {
  await clickSelector(selector);
  await pressKey("a", "KeyA", 65, 2);
  const parts = String(text).split(LF);
  for (let i = 0; i < parts.length; i += 1) {
    if (i > 0) {
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: String.fromCharCode(13), unmodifiedText: String.fromCharCode(13) });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await sleep(160);
    }
    await page.send("Input.insertText", { text: parts[i] });
    await sleep(160);
  }
  await sleep(360);
}
/** 1x1 红色 PNG（真实剪贴板写入用；手搓字节 + 手写 CRC32，不引依赖）。 */
function pngBytes() {
  const crcTable = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  // 像素内容每轮随机（红 + 随机绿蓝）：预览产物缓存键 = 内容哈希，固定字节会与历史轮次撞键
  // （产物被清而 outbox 的 done 行还在时，读面会停在 not_ready —— 见本文件末的已知问题）。
  const idat = deflateSync(Buffer.from([0, 255, randomBytes(1)[0], randomBytes(1)[0]]));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
const PNG_B64 = pngBytes().toString("base64");

/** 点「粘贴」左半 → 就绪态；真剪贴板 + 真 Ctrl+V（剪贴板不可用回落合成事件）。 */
async function pasteInto(zone) {
  await clickSelector("[data-paste-zone=" + zone + "] [data-paste-half]");
  const clipWrite = await evAwait("(async()=>{const bin=atob(" + j(PNG_B64) + ");const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);await navigator.clipboard.write([new ClipboardItem({" + j("image/png") + ":new Blob([arr],{type:" + j("image/png") + "})})]);return " + j("ok") + ";})().catch((e)=>{return " + j("ERR:") + "+String(e);})", true);
  let via = "clipboard+ctrlv";
  if (typeof clipWrite !== "string" || clipWrite.indexOf("ok") !== 0) {
    via = "synthetic(" + String(clipWrite).slice(0, 50) + ")";
    await evAwait("(function(){const bin=atob(" + j(PNG_B64) + ");const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);const dt=new DataTransfer();dt.items.add(new File([arr]," + j("clipboard.png") + ",{type:" + j("image/png") + "}));const e=new ClipboardEvent(" + j("paste") + ",{clipboardData:dt,bubbles:true,cancelable:true});document.dispatchEvent(e);return true;})()");
  } else {
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2, commands: ["paste"] });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2 });
  }
  await sleep(600);
  return via;
}
/** 等某区附件上传完（strip 里不再有「上传中」且至少一条）。 */
async function waitUploadDone(zone, timeoutMs = 30000) {
  return await waitFor("(function(){const s=document.querySelector(" + j("[data-attachment-strip=" + zone + "]") + ");"
    + " if(s===null){return false;} const t=s.textContent||\"\";"
    + " return s.querySelectorAll(" + j("[data-attachment]") + ").length>0 && t.indexOf(" + j("上传中") + ")<0 && t.indexOf(" + j("上传失败") + ")<0;})()", timeoutMs);
}


/** 拿不到关键回包就直接收摊（避免后续断言连坐崩溃）。 */
async function bail(message) {
  console.log("中止：" + message);
  checks.push(false);
  try { page.ws.close(); } catch (error) { /* 忽略 */ }
  chrome.kill();
  await db.end();
  process.exit(1);
}

  + "function v(s){var el=f.querySelector(s);return el===null?null:el.value;}"
  + "var hint=f.querySelector(" + j("[data-fill-hint]") + ");var sub=f.querySelector(" + j("[data-action=submit]") + ");"
  + "var zones={};var zs=f.querySelectorAll(" + j("[data-paste-zone]") + ");for(var i=0;i<zs.length;i++){var z=zs[i];var h=z.querySelector(" + j("[data-paste-hint]") + ");zones[z.getAttribute(\"data-paste-zone\")]=h===null?\"-\":h.getAttribute(\"data-paste-hint\");}"
  + "var box=f.querySelector(" + j("[data-field=stages]") + ");var picked=[];if(box!==null){var cs=box.querySelectorAll(\"input\");for(var k=0;k<cs.length;k++){if(cs[k].checked){picked.push(k);}}}"
const FORM_PROBE = "(function(){var f=document.querySelector(" + j("[data-fill-form]") + ");"
  + "var tabs=document.querySelectorAll(" + j("[data-subnav-item]") + ");var names=[];for(var i=0;i<tabs.length;i++){names.push(tabs[i].textContent.trim());}"
  + "if(f===null){return {hasForm:false,tabs:names.join(\"/\")};}"
  + "var dateBtn=f.querySelector(" + j("[data-field=date] button") + ");var authorEl=f.querySelector(" + j("[data-field=author]") + ");"
  + "var catBtn=f.querySelector(" + j("[data-field=issueCategory] button") + ");var ipp=f.querySelector(" + j("[data-paste-zone=issuePhotos]") + ");"
  + "var sug=f.querySelector(" + j("[data-field=suggestion]") + ");var submit=f.querySelector(" + j("[data-action=submit]") + ");var hint=f.querySelector(" + j("[data-fill-hint]") + ");"
  + "return {hasForm:true,tabs:names.join(\"/\"),date:dateBtn===null?\"\":dateBtn.textContent.trim(),author:authorEl===null?\"\":authorEl.textContent.trim(),"
  + "catDisabled:catBtn===null?null:catBtn.disabled,issuePhotosDisabled:ipp===null?null:ipp.getAttribute(\"data-paste-disabled\"),"
  + "suggestionDisabled:sug===null?null:sug.disabled,submitDisabled:submit===null?null:submit.disabled,hint:hint===null?\"\":hint.textContent.trim()};})()";

/** 表单里某枚阶段 checkbox 的标签中心（真实鼠标点标签 = 勾选）。 */
async function clickStageLabel(text) {
  const point = await ev("(function(){var box=document.querySelector(" + j("[data-field=stages]") + ");if(box===null){return null;}"
    + "var ls=box.querySelectorAll(" + j("label") + ");for(var i=0;i<ls.length;i++){if(ls[i].textContent.trim()===" + j(text) + "){"
    + "ls[i].scrollIntoView({block:" + j("center") + "});var r=ls[i].getBoundingClientRect();"
    + "return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};}}return null;})()");
  if (point === null || point === undefined) throw new Error("点不到阶段：" + text);
  await clickAt(point);
}
/** 打开「问题归类」多选并点选一枚（点选不收浮层）。 */
async function pickIssueCategory(name) {
  const opened = await ev("(function(){var b=document.querySelector(" + j("[data-field=issueCategory] button") + ");if(b===null||b.disabled){return false;}b.click();return true;})()");
  if (opened !== true) throw new Error("问题归类下拉打不开（可能仍被禁用）");
  await sleep(400);
  const picked = await ev("(function(){var os=document.querySelectorAll(" + j("[data-multi-option]") + ");for(var i=0;i<os.length;i++){if(os[i].getAttribute(\"data-multi-option\")===" + j(name) + "){os[i].click();return true;}}return false;})()");
  await sleep(400);
  if (picked !== true) throw new Error("问题归类里找不到：" + name);
  await pressKey("Escape", "Escape", 27);
}

// ---------- ① 首屏：四块子视图 + 表单基线 ----------
await openDaily();
const form0 = await ev(FORM_PROBE);
const todayIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const todayCn = todayIso.slice(0, 4) + "/" + todayIso.slice(5, 7) + "/" + todayIso.slice(8, 10);
check("①a 四块子视图键帽齐（日报填写 / 日报记录 / 问题追踪 / 问题看板）", form0 !== null && form0.tabs === "日报填写/日报记录/问题追踪/问题看板", form0 === null ? "-" : String(form0.tabs));
check("①b 「日报填写」表单在（缺省子视图）+ 时间默认今天（" + todayCn + "，站内日期选择器展示口径）", form0 !== null && form0.hasForm === true && form0.date === todayCn, form0 === null ? "-" : JSON.stringify({ date: form0.date }));
check("①c 提交人 = 当前登录用户（" + userRow.display_name + "）", form0 !== null && form0.author.indexOf(userRow.display_name) >= 0, form0 === null ? "-" : String(form0.author));
check("①d 空表单提交按钮禁用 + 提示「还差：当日完成工作、明日计划」", form0 !== null && form0.submitDisabled === true && form0.hint.indexOf("还差") >= 0 && form0.hint.indexOf("当日完成工作") >= 0 && form0.hint.indexOf("明日计划") >= 0, form0 === null ? "-" : JSON.stringify({ submitDisabled: form0.submitDisabled, hint: form0.hint }));
check("①e 「现场发现问题」为空 → 前置开关禁用三件（问题归类 / 当前问题附图 / 解决方案或建议）", form0 !== null && form0.catDisabled === true && form0.issuePhotosDisabled === "true" && form0.suggestionDisabled === true, form0 === null ? "-" : JSON.stringify({ cat: form0.catDisabled, issuePhotos: form0.issuePhotosDisabled, suggestion: form0.suggestionDisabled }));

// ---------- ② 填表 + 两张图真粘贴上传 ----------
const DONE_TEXT = "回放·完成工作-A1" + LF + "回放·完成工作-A2";
const DONE_EXPECT = "1: 回放·完成工作-A1" + LF + "2: 回放·完成工作-A2";
const PLAN_TEXT = "回放·明日计划-A1";
const PLAN_EXPECT = "1: 回放·明日计划-A1";
const ISSUE_TEXT = "回放·现场问题-钢结构偏差";
const ISSUE_EXPECT = "1: 回放·现场问题-钢结构偏差";
await typeInto("[data-field=headcount]", "12");
await clickStageLabel("硬件实施");
await clickStageLabel("试运行");
await typeInto("[data-field=doneWork]", DONE_TEXT);
await typeInto("[data-field=plan]", PLAN_TEXT);
await typeInto("[data-field=foundIssue]", ISSUE_TEXT);
const gateAfter = await ev(FORM_PROBE);
check("②a 填了「现场发现问题」→ 三项解禁", gateAfter !== null && gateAfter.catDisabled === false && gateAfter.issuePhotosDisabled === "false" && gateAfter.suggestionDisabled === false, gateAfter === null ? "-" : JSON.stringify({ cat: gateAfter.catDisabled, issuePhotos: gateAfter.issuePhotosDisabled, suggestion: gateAfter.suggestionDisabled }));
await pickIssueCategory("规划部");
await pickIssueCategory("客户原因");
const viaIssue = await pasteInto("issuePhotos");
const viaOnsite = await pasteInto("photos");
const okIssueUp = await waitUploadDone("issuePhotos");
const okOnsiteUp = await waitUploadDone("photos");
check("②b 两张图真粘贴 + 文件库直传完成（区 1「当前问题附图」/ 区 2「现场工作附图」各有 1 条、无「上传中 / 上传失败」）", okIssueUp === true && okOnsiteUp === true, JSON.stringify({ viaIssue, viaOnsite, okIssueUp, okOnsiteUp }));
const attachmentNames = await ev("(function(){var a=document.querySelector(" + j("[data-attachment-strip=photos]") + ");var b=document.querySelector(" + j("[data-attachment-strip=issuePhotos]") + ");"
  + "function one(s){if(s===null){return [];}var ns=s.querySelectorAll(" + j("[data-attachment]") + ");var out=[];for(var i=0;i<ns.length;i++){out.push(ns[i].getAttribute(\"data-attachment\"));}return out;}"
  + "return {onsite:one(a),issue:one(b)};})()");
const fileRows0 = (await db.query("select id, name, status from files where project_id = $1 order by created_at", [projectId])).rows;
check("②c 附件清单回填文件库文件名 + 库内真落两行 files（未回收）", attachmentNames !== null && attachmentNames.onsite.length === 1 && attachmentNames.issue.length === 1 && fileRows0.length === 2 && fileRows0.every((row) => row.status !== "recycled"), JSON.stringify({ attachments: attachmentNames, files: fileRows0.map((row) => row.name) }));


// ---------- ③ 提交：日报落库 + 自动生成问题 + 问题图转挂 ----------
await clickSelector("[data-action=submit]");
await sleep(2500);
const switched = await waitFor("document.querySelector(" + j("[data-report-table]") + ")!==null", 20000);
check("③a 提交成功 → 自动切「日报记录」并出表（服务端回包驱动，不是本地假行）", switched === true);
const list1 = await reportsOf();
const rep1 = list1.items[0];
if (rep1 === undefined) { await bail("提交后没取到日报行（③ 提交失败？）"); }
check("③b 日报落库 1 篇、state=submitted、日期 = 表单默认今天", list1.total === 1 && rep1 !== undefined && rep1.state === "submitted" && rep1.date === todayIso, JSON.stringify({ total: list1.total, state: rep1 === undefined ? "-" : rep1.state, date: rep1 === undefined ? "-" : rep1.date }));
check("③c 文字列按自动序号落库（完成工作两行 / 明日计划 / 现场问题各带 1: 2: 前缀）", rep1.doneWork === DONE_EXPECT && rep1.plan === PLAN_EXPECT && rep1.foundIssue === ISSUE_EXPECT, JSON.stringify({ doneWork: rep1.doneWork, plan: rep1.plan, foundIssue: rep1.foundIssue }));
check("③d 关联阶段 / 施工人数 / 问题归类落库", rep1.headcount === 12 && JSON.stringify(rep1.stageKeys) === JSON.stringify(["install", "trial"]) && JSON.stringify(rep1.issueCategories) === JSON.stringify(["规划部", "客户原因"]), JSON.stringify({ headcount: rep1.headcount, stageKeys: rep1.stageKeys, issueCategories: rep1.issueCategories }));
check("③e 现场工作附图挂日报侧（photos 1 张）、问题图已转走（issuePhotos 0 张）", rep1.photos.length === 1 && rep1.issuePhotos.length === 0, JSON.stringify({ photos: rep1.photos, issuePhotos: rep1.issuePhotos }));
const list1Issues = await issuesOf();
const iss1 = list1Issues.items[0];
if (iss1 === undefined) { await bail("提交后没取到自动生成的问题（③ A3-09 没落？）"); }
check("③f 「现场发现问题」自动生成 1 条问题（state=open · 提出人 = 提交人 · 归类两项）", list1Issues.total === 1 && iss1 !== undefined && iss1.state === "open" && iss1.title === ISSUE_EXPECT && iss1.categories.length === 2, iss1 === undefined ? "-" : JSON.stringify({ state: iss1.state, title: iss1.title, categories: iss1.categories }));
check("③g 问题的来源日报 = ③ 那篇（sourceReportId 对得上）、问题附图 1 张（转挂到位）", iss1.sourceReportId === rep1.id && iss1.photos.length === 1, iss1 === undefined ? "-" : JSON.stringify({ sourceReportId: iss1.sourceReportId, photos: iss1.photos }));
const links1 = (await db.query("select fl.object_type, fl.kind, f.name from file_links fl join files f on f.id = fl.file_id where fl.object_id = any($1::uuid[]) order by fl.object_type, fl.kind", [[rep1.id, iss1.id]])).rows;
const linkKey = (row) => row.object_type + ":" + row.kind;
check("③h 库内 file_links：日报侧只有 onsite 一条、问题侧一条（kind 区分 + 转挂，方案一口径）", links1.length === 2 && links1.filter((row) => linkKey(row) === "report:onsite").length === 1 && links1.filter((row) => row.object_type === "issue").length === 1 && links1.filter((row) => row.kind === "issue").length === 0, JSON.stringify(links1.map(linkKey)));
const dbRep1 = (await db.query("select state, headcount, done_work, plan, found_issue, issue_categories, stage_keys, submitted_at, version from daily_reports where id = $1", [rep1.id])).rows[0];
check("③i 库内 daily_reports 行：state / 时间 / 阶段 key / 归类数组 / submitted_at 都对得上", dbRep1.state === "submitted" && dbRep1.headcount === 12 && dbRep1.done_work === DONE_EXPECT && dbRep1.plan === PLAN_EXPECT && dbRep1.found_issue === ISSUE_EXPECT && JSON.stringify(dbRep1.issue_categories) === JSON.stringify(["规划部", "客户原因"]) && JSON.stringify(dbRep1.stage_keys) === JSON.stringify(["install", "trial"]) && dbRep1.submitted_at !== null, JSON.stringify({ state: dbRep1.state, headcount: dbRep1.headcount, stage_keys: dbRep1.stage_keys, submitted_at: String(dbRep1.submitted_at) }));
const row1Ui = await ev("(function(){var r=document.querySelector(" + j("[data-report-row]") + ");if(r===null){return null;}return {hasDraftBadge:r.querySelector(" + j("[data-report-state]") + ")!==null,text:r.innerText.split(String.fromCharCode(10)).join(\" | \")};})()");
check("③j 已提交行不挂状态签（业务口径：已提交不标）、行里有阶段色签与两行完成工作", row1Ui !== null && row1Ui.hasDraftBadge === false && row1Ui.text.indexOf("硬件实施") >= 0 && row1Ui.text.indexOf("回放·完成工作-A2") >= 0, row1Ui === null ? "-" : String(row1Ui.text).slice(0, 260));
const thumb1 = await waitFor("document.querySelector(" + j("[data-report-table] [data-attachment-thumb]") + ")!==null", 40000);
const preview1 = await api("/api/v1/files/" + rep1.photos[0].fileId + "/preview");
check("③k 附图缩略图在列表出图（服务端预览签名，非本地 blob）—— file_links 文件走预览通道", thumb1 === true && preview1.status === 200 && preview1.json !== null && preview1.json.status === "ready" && preview1.json.url !== null, JSON.stringify({ thumb: thumb1, preview: preview1.json === null ? preview1.text.slice(0, 120) : preview1.json.status }));

// ---------- ④ 同日多条（无唯一约束） ----------
await clickSelector("[data-subnav-item=" + Q + "日报填写" + Q + "]");
await sleep(600);
await typeInto("[data-field=doneWork]", "回放·完成工作-B1");
await typeInto("[data-field=plan]", "回放·明日计划-B1");
await clickSelector("[data-action=submit]");
const switched2 = await waitFor("document.querySelector(" + j("[data-report-table]") + ")!==null", 20000);
const list2 = await reportsOf();
check("④a 同一天第二篇照样落库（total 2 · 两篇日期相同 · 都 submitted）", switched2 === true && list2.total === 2 && list2.items.every((row) => row.date === todayIso && row.state === "submitted"), JSON.stringify({ total: list2.total, dates: list2.items.map((row) => row.date), states: list2.items.map((row) => row.state) }));
const dbSameDay = (await db.query("select count(*)::int as n from daily_reports where project_id = $1 and report_date = $2::date", [projectId, todayIso])).rows[0];
check("④b 库内同日两行并存（唯一约束已删）", Number(dbSameDay.n) === 2, JSON.stringify(dbSameDay));

// ---------- ⑤ 草稿写库 + 再提交（不新增行） ----------
await clickSelector("[data-subnav-item=" + Q + "日报填写" + Q + "]");
await sleep(600);
await typeInto("[data-field=doneWork]", "回放·草稿-C1");
await typeInto("[data-field=plan]", "回放·草稿计划-C1");
await clickSelector("[data-action=draft]");
await sleep(2500);
const list3 = await reportsOf();
const draftRow = list3.items.filter((row) => row.state === "draft")[0];
if (draftRow === undefined) { await bail("暂存后没找到 state=draft 的行（⑤ 草稿没写库？）"); }
check("⑤a 暂存草稿 = 真写库（total 3 · 有一条 state=draft · 内容 = 表单值）", list3.total === 3 && draftRow !== undefined && draftRow.doneWork === "1: 回放·草稿-C1" && draftRow.plan === "1: 回放·草稿计划-C1", JSON.stringify({ total: list3.total, draft: draftRow === undefined ? "-" : { state: draftRow.state, doneWork: draftRow.doneWork } }));
const dbDraft = (await db.query("select state, submitted_at, version from daily_reports where id = $1", [draftRow.id])).rows[0];
check("⑤b 库内草稿行 state=draft、submitted_at 仍为空", dbDraft.state === "draft" && dbDraft.submitted_at === null, JSON.stringify({ state: dbDraft.state, submitted_at: String(dbDraft.submitted_at) }));
await clickSelector("[data-subnav-item=" + Q + "日报记录" + Q + "]");
await sleep(900);
const draftBadge = await ev("(function(){var b=document.querySelector(" + j("[data-report-state]") + ");if(b===null){return null;}return {state:b.getAttribute(\"data-report-state\"),text:b.textContent.trim()};})()");
check("⑤c 「日报记录」里草稿行挂「草稿」签", draftBadge !== null && draftBadge.state === "draft" && draftBadge.text === "草稿", JSON.stringify(draftBadge));
await clickSelector("[data-subnav-item=" + Q + "日报填写" + Q + "]");
await sleep(700);
await clickSelector("[data-action=submit]");
await sleep(3000);
const list4 = await reportsOf();
const draftAfter = list4.items.filter((row) => row.id === draftRow.id)[0];
check("⑤d 同一表单再点「提交日报」= PATCH 那条草稿转 submitted（不新增行 · total 仍 3）", list4.total === 3 && draftAfter !== undefined && draftAfter.state === "submitted" && draftAfter.version > draftRow.version, JSON.stringify({ total: list4.total, state: draftAfter === undefined ? "-" : draftAfter.state, version: draftAfter === undefined ? "-" : draftAfter.version }));


// ---------- ⑥ 编辑落库（Push 223：文字 / 图片走干系人同款弹窗，下拉保持行内） ----------
/** 行内多选（下拉口径保留）：点触发按钮 → 浮层里点一枚（点选即落值）→ Esc 收层。 */
async function inlineMultiToggle(rowSelector, ariaLabel, optionName) {
  await clickSelector(rowSelector + " button[aria-label=" + Q + ariaLabel + Q + "]");
  await sleep(600);
  const picked = await ev("(function(){var os=document.querySelectorAll(" + j("[data-multi-option]") + ");for(var i=0;i<os.length;i++){if(os[i].getAttribute(\"data-multi-option\")===" + j(optionName) + "){os[i].click();return true;}}return false;})()");
  await sleep(1800);
  await pressKey("Escape", "Escape", 27);
  if (picked !== true) throw new Error("行内多选里找不到：" + optionName);
}
/** 行内单选（问题状态 · 下拉口径保留）：点触发按钮 → 点一枚 option。 */
async function inlineOptionPick(rowSelector, ariaLabel, labelText) {
  await clickSelector(rowSelector + " button[aria-label=" + Q + ariaLabel + Q + "]");
  await sleep(700);
  const picked = await ev("(function(){var os=document.querySelectorAll(" + j("[role=option]") + ");for(var i=0;i<os.length;i++){if((os[i].textContent||\"\").trim()===" + j(labelText) + "){os[i].click();return true;}}return false;})()");
  await sleep(1800);
  if (picked !== true) throw new Error("行内单选里找不到：" + labelText);
}
/** 弹窗编辑（Push 223 · 与「干系人」同款）：点行尾「编辑」→ 等弹窗 → 依次覆写字段 → 点「保存修改」→ 等窗口消失。 */
async function modalEditSave(triggerSelector, fields) {
  await clickSelector(triggerSelector);
  const opened = await waitFor("document.querySelector(" + j("[data-record-edit-modal]") + ")!==null", 6000);
  if (opened !== true) throw new Error("编辑弹窗没开：" + triggerSelector);
  for (const field of fields) {
    await typeInto("[data-record-field=" + Q + field.key + Q + "]", field.text);
  }
  await clickSelector("[data-record-edit-submit]");
  const closed = await waitFor("document.querySelector(" + j("[data-record-edit-modal]") + ")===null", 8000);
  await sleep(1200);
  if (closed !== true) throw new Error("编辑弹窗没关（保存失败？）：" + triggerSelector);
}
/** 打开的编辑弹窗快照（断言用）：字段钩子 / 贴图区 / 图瓦片 / 行内编辑件计数。 */
const modalScopeExpr = "(function(){var m=document.querySelector(" + j("[data-record-edit-modal]") + ");if(m===null){return null;}var out=[];var fs=m.querySelectorAll(" + j("[data-record-field]") + ");for(var i=0;i<fs.length;i++){out.push(fs[i].getAttribute(\"data-record-field\"));}return {fields:out,pasteZones:m.querySelectorAll(" + j("[data-paste-zone]") + ").length,attachments:m.querySelectorAll(" + j("[data-attachment]") + ").length,inlineSave:m.querySelectorAll(" + j("[data-inline-save]") + ").length,multiOptions:m.querySelectorAll(" + j("[data-multi-option]") + ").length,options:m.querySelectorAll(" + j("[role=option]") + ").length};})()";

await clickSelector("[data-subnav-item=" + Q + "日报记录" + Q + "]");
await sleep(900);
const rowSel1 = "[data-report-row=" + Q + rep1.id + Q + "]";
const rep1AfterIssue = (await reportsOf()).items.filter((row) => row.id === rep1.id)[0];
// Push 223 口径（干系人同款「编辑是点编辑按钮才是编辑」）：表格里点行体（文字 / 图片）不再进入任何编辑。
await clickSelector(rowSel1 + " [data-report-done]");
await sleep(600);
const bodyClickState = await ev("(function(){return {modal:document.querySelector(" + j("[data-record-edit-modal]") + ")!==null,inline:document.querySelector(" + j("[data-inline-popover]") + ")!==null};})()");
check("⑥a 点行体（文字单元格）不进入编辑：无弹窗 · 无行内浮层", bodyClickState !== null && bodyClickState.modal === false && bodyClickState.inline === false, JSON.stringify(bodyClickState));
// 文字：行尾「编辑」→ 弹窗（当日完成工作）
await modalEditSave(rowSel1 + " [data-report-edit-slot] button", [{ key: "doneWork", text: "回放·完成工作-A1改" + LF + "回放·完成工作-A2改" }]);
const rep1Edited = (await reportsOf()).items.filter((row) => row.id === rep1.id)[0];
check("⑥b 日报「当日完成工作」弹窗保存落库（自动序号重排 + version 递增 + 日期不动）", rep1Edited.doneWork === "1: 回放·完成工作-A1改" + LF + "2: 回放·完成工作-A2改" && rep1Edited.version > rep1AfterIssue.version && rep1Edited.date === rep1.date, JSON.stringify({ doneWork: rep1Edited.doneWork, version: rep1Edited.version }));
// 文字：弹窗重开（预填最新值）→ 只改明日计划
await modalEditSave(rowSel1 + " [data-report-edit-slot] button", [{ key: "plan", text: "回放·计划-A1改" }]);
const rep1Edited2 = (await reportsOf()).items.filter((row) => row.id === rep1.id)[0];
check("⑥c 日报「明日计划」弹窗保存落库（只提交改动键：完成工作不被带回覆盖）", rep1Edited2.plan === "1: 回放·计划-A1改" && rep1Edited2.version > rep1Edited.version && rep1Edited2.doneWork === rep1Edited.doneWork, JSON.stringify({ plan: rep1Edited2.plan, version: rep1Edited2.version }));
// 图片：弹窗内 AttachmentPicker 删图 + 保存落库
await clickSelector(rowSel1 + " [data-report-edit-slot] button");
const photoModalOpened = await waitFor("document.querySelector(" + j("[data-record-edit-modal]") + ")!==null", 6000);
const photoModalScope = await ev(modalScopeExpr);
check("⑥d 日报编辑弹窗 = 文字两列 + 图片一区（关联阶段不在弹窗里 —— 下拉保持行内）", photoModalOpened === true && photoModalScope !== null && photoModalScope.fields.join(",") === "doneWork,plan" && photoModalScope.pasteZones === 1 && photoModalScope.attachments === 1 && photoModalScope.inlineSave === 0 && photoModalScope.multiOptions === 0, JSON.stringify(photoModalScope));
await clickSelector("[data-record-edit-modal] [data-action=remove-attachment]");
await clickSelector("[data-record-edit-submit]");
const photoModalClosed = await waitFor("document.querySelector(" + j("[data-record-edit-modal]") + ")===null", 8000);
await sleep(1200);
const rep1Edited3 = (await reportsOf()).items.filter((row) => row.id === rep1.id)[0];
const dbRep1Links = (await db.query("select object_type, kind from file_links where object_id = $1", [rep1.id])).rows;
check("⑥e 日报「现场工作附图」弹窗内删图 + 保存落库（photos 归零 · file_links(report) 清空 · version 递增）", photoModalClosed === true && rep1Edited3.photos.length === 0 && dbRep1Links.length === 0 && rep1Edited3.version > rep1Edited2.version, JSON.stringify({ photos: rep1Edited3.photos.length, links: dbRep1Links.length, version: rep1Edited3.version }));
// 下拉口径保持原来的行内编辑：关联阶段仍是行内多选
await inlineMultiToggle(rowSel1, "修改关联阶段（" + todayIso + "）", "验收");
const rep1Edited4 = (await reportsOf()).items.filter((row) => row.id === rep1.id)[0];
const stageSet = rep1Edited4.stageKeys.slice().sort().join(",");
check("⑥f 日报「关联阶段」保持行内多选落库（加一枚「验收」→ acceptance；不改动原有两枚）", stageSet === "acceptance,install,trial" && rep1Edited4.version > rep1Edited3.version, JSON.stringify({ stageKeys: rep1Edited4.stageKeys, version: rep1Edited4.version }));
const dbRep1b = (await db.query("select done_work, plan, stage_keys, version from daily_reports where id = $1", [rep1.id])).rows[0];
check("⑥g 库内三次 PATCH（完成工作 / 明日计划 / 阶段）都对得上（读面 = 库面）", dbRep1b.done_work === rep1Edited4.doneWork && dbRep1b.plan === rep1Edited4.plan && Number(dbRep1b.version) === rep1Edited4.version, JSON.stringify({ version: dbRep1b.version, done_work: dbRep1b.done_work }));

await clickSelector("[data-subnav-item=" + Q + "问题追踪" + Q + "]");
await sleep(1100);
const issueRowSel = "[data-issue-row=" + Q + iss1.id + Q + "]";
// 文字：行尾「编辑」→ 弹窗（描述 + 解决方案一次保存）
await clickSelector(issueRowSel + " [data-issue-edit-slot] button");
const issueModalOpened = await waitFor("document.querySelector(" + j("[data-record-edit-modal]") + ")!==null", 6000);
const issueModalScope = await ev(modalScopeExpr);
check("⑥h 问题编辑弹窗 = 文字两列 + 图片一区（归类 / 状态不在弹窗里 —— 下拉保持行内）", issueModalOpened === true && issueModalScope !== null && issueModalScope.fields.join(",") === "title,solution" && issueModalScope.pasteZones === 1 && issueModalScope.attachments === 1 && issueModalScope.inlineSave === 0 && issueModalScope.multiOptions === 0 && issueModalScope.options === 0, JSON.stringify(issueModalScope));
await typeInto("[data-record-field=title]", "回放·钢结构偏差（已复测）");
await typeInto("[data-record-field=solution]", "回放·解决方案-复测通过");
await clickSelector("[data-record-edit-submit]");
const issueModalClosed = await waitFor("document.querySelector(" + j("[data-record-edit-modal]") + ")===null", 8000);
await sleep(1200);
const iss1Edited = (await issuesOf()).items.filter((row) => row.id === iss1.id)[0];
check("⑥i 问题「描述 + 解决方案」弹窗一次保存同时落库（version 递增）", issueModalClosed === true && iss1Edited.title === "1: 回放·钢结构偏差（已复测）" && iss1Edited.solution === "1: 回放·解决方案-复测通过" && iss1Edited.version > iss1.version, JSON.stringify({ title: iss1Edited.title, solution: iss1Edited.solution, version: iss1Edited.version }));
// 下拉口径保持原来的行内编辑：归类 / 状态
await inlineMultiToggle(issueRowSel, "修改问题归类（" + todayIso + "）", "机械部");
const iss1Edited2 = (await issuesOf()).items.filter((row) => row.id === iss1.id)[0];
check("⑥j 问题「归类」保持行内多选落库（加一枚「机械部」→ 3 项）", iss1Edited2.categories.length === 3 && iss1Edited2.categories.indexOf("机械部") >= 0 && iss1Edited2.version > iss1Edited.version, JSON.stringify({ categories: iss1Edited2.categories, version: iss1Edited2.version }));
await inlineOptionPick(issueRowSel, "修改问题状态（" + todayIso + "）", "处理中");
const iss1State1 = (await issuesOf()).items.filter((row) => row.id === iss1.id)[0];
check("⑥k 问题状态 open → in_progress（三态·行内下拉落库）", iss1State1.state === "in_progress", JSON.stringify({ state: iss1State1.state, version: iss1State1.version }));
await inlineOptionPick(issueRowSel, "修改问题状态（" + todayIso + "）", "已完成");
const iss1State2 = (await issuesOf()).items.filter((row) => row.id === iss1.id)[0];
const dbClosed = (await db.query("select state, closed_at, closed_by, version from issues where id = $1", [iss1.id])).rows[0];
check("⑥l 问题状态 → done：closed_at / closed_by 成对置位（库侧 ck_issues_closed_pairs 口径）", iss1State2.state === "done" && dbClosed.state === "done" && dbClosed.closed_at !== null && dbClosed.closed_by !== null, JSON.stringify({ state: dbClosed.state, closed_at: String(dbClosed.closed_at), closed_by: dbClosed.closed_by === null ? null : "set" }));
await inlineOptionPick(issueRowSel, "修改问题状态（" + todayIso + "）", "未解决");
const iss1State3 = (await issuesOf()).items.filter((row) => row.id === iss1.id)[0];
const dbReopen = (await db.query("select state, closed_at from issues where id = $1", [iss1.id])).rows[0];
check("⑥m 状态允许回退：done → open（closed_at 归零）", iss1State3.state === "open" && dbReopen.state === "open" && dbReopen.closed_at === null, JSON.stringify({ state: dbReopen.state, closed_at: String(dbReopen.closed_at) }));
const issueUiRow = await ev("(function(){var r=document.querySelector(" + j("[data-issue-row]") + ");if(r===null){return null;}return {columns:r.querySelectorAll(\"td\").length,editButtons:r.querySelectorAll(" + j("[data-issue-edit-slot] button") + ").length,deleteButtons:r.querySelectorAll(" + j("[data-issue-delete-slot] button") + ").length,text:r.innerText.split(String.fromCharCode(10)).join(\" | \")};})()");
check("⑥n 问题追踪表 = 六列口径（+ 行尾动作列 = 7 格）、行尾「编辑 + 删除」两枚在位、三态色签在位", issueUiRow !== null && issueUiRow.columns === 7 && issueUiRow.editButtons === 1 && issueUiRow.deleteButtons === 1 && issueUiRow.text.indexOf("未解决") >= 0 && issueUiRow.text.indexOf("提出人") >= 0, issueUiRow === null ? "-" : String(issueUiRow.text).slice(0, 240));


// 抽屉口径（Push 224 续 · 业务口径「移除图片要加二次确认」——只改抽屉）：点看板卡开抽屉 → × 只出确认条（不落库）→ 确认才摘。
await clickSelector("[data-subnav-item=" + Q + "问题看板" + Q + "]");
await sleep(1100);
await clickSelector("[data-issue-card=" + Q + iss1.id + Q + "]");
const drawerOpened = await waitFor("document.querySelector(" + j("[data-issue-drawer]") + ")!==null", 6000);
const drawerStrip = "[data-issue-drawer] [data-attachment-strip=issuePhotos]";
await waitFor("(function(){var s=document.querySelector(" + j(drawerStrip) + ");return s!==null && s.querySelectorAll(" + j("[data-attachment-thumb]") + ").length===1;})()", 8000);
await clickSelector(drawerStrip + " [data-action=remove-attachment]");
const drawerConfirmShown = await waitFor("document.querySelector(" + j("[data-remove-attachment-confirm-strip]") + ")!==null", 5000);
await sleep(500);
const drawerThumbsBefore = await ev("(function(){var s=document.querySelector(" + j(drawerStrip) + ");return s===null?null:s.querySelectorAll(" + j("[data-attachment-thumb]") + ").length;})()");
await clickSelector("[data-remove-attachment-confirm]");
await sleep(2000);
const iss1Drawer = (await issuesOf()).items.filter((row) => row.id === iss1.id)[0];
const drawerThumbsAfter = await ev("(function(){var s=document.querySelector(" + j(drawerStrip) + ");return s===null?0:s.querySelectorAll(" + j("[data-attachment-thumb]") + ").length;})()");
check("⑥o 抽屉「移除图片」要二次确认（第一下 × 只出确认条 · 图还在；第二下「移除」才真摘并落库）", drawerOpened === true && drawerConfirmShown === true && drawerThumbsBefore === 1 && iss1Drawer.photos.length === 0 && drawerThumbsAfter === 0 && iss1Drawer.version > iss1State3.version, JSON.stringify({ opened: drawerOpened, strip: drawerConfirmShown, before: drawerThumbsBefore, after: drawerThumbsAfter, version: iss1Drawer.version }));
await pressKey("Escape", "Escape", 27);
await waitFor("document.querySelector(" + j("[data-issue-drawer]") + ")==null", 4000);
await sleep(600);

// ---------- ⑦ 成对删除（删日报连问题 / 删问题连日报） ----------
await clickSelector("[data-subnav-item=" + Q + "日报记录" + Q + "]");
await sleep(900);
await clickSelector(rowSel1 + " [data-report-delete-slot] button");
// Push 218「删除要二次提示」：第一下只出底部确认条、不落删除；第二下点确认条上的「删除」才真删。
const repConfirmShown = await waitFor("document.querySelector(" + j("[data-delete-confirm-strip]") + ") !== null", 5000);
await sleep(400);
const repStillThere = await ev("document.querySelector(" + j(rowSel1) + ") !== null");
check("⑦a-1 删日报第一下（行尾垃圾桶）= 只出底部确认条、不真删（二次提示）", repConfirmShown === true && repStillThere === true, JSON.stringify({ strip: repConfirmShown, row: repStillThere }));
await clickSelector("[data-delete-confirm]");
const repGone = await waitFor("(function(){var t=document.querySelector(" + j("[data-report-table]") + ");return t===null || t.querySelector(" + j("[data-report-row=" + Q + rep1.id + Q + "]") + ")===null;})()", 12000);
await sleep(1200);
const afterDelReport = await reportsOf();
const afterDelReportIssues = await issuesOf();
const rep404 = await api("/api/v1/projects/" + projectId + "/reports/" + rep1.id);
const iss404 = await api("/api/v1/projects/" + projectId + "/issues/" + iss1.id);
check("⑦a 删日报（界面行尾垃圾桶）→ 该日报 404 + 它派生的那条问题随日报一起删（成对删除）", repGone === true && afterDelReport.total === 2 && afterDelReportIssues.total === 0 && rep404.status === 404 && iss404.status === 404, JSON.stringify({ gone: repGone, reports: afterDelReport.total, issues: afterDelReportIssues.total, rep404: rep404.status, iss404: iss404.status }));
const dbCascade = (await db.query("select (select count(*)::int from daily_reports where id = $1) as reports, (select count(*)::int from issues where id = $2) as issues", [rep1.id, iss1.id])).rows[0];
check("⑦b 库内两行都物理删了（连 file_links 由 files 级联收走）", Number(dbCascade.reports) === 0 && Number(dbCascade.issues) === 0, JSON.stringify(dbCascade));

// 夹具：再补一篇带问题的日报（走接口，专测「删问题连来源日报」）
const repDRes = await api("/api/v1/projects/" + projectId + "/reports", "POST", { date: todayIso, state: "submitted", doneWork: "回放·完成工作-D1", foundIssue: "回放·现场问题-D1", issueCategories: ["物流原因"] });
check("⑦c 夹具：接口补一篇带问题的日报（201）", repDRes.status === 201, String(repDRes.status) + " " + repDRes.text.slice(0, 140));
const repD = repDRes.json;
const issD = (await issuesOf()).items.filter((row) => row.sourceReportId === repD.id)[0];
if (issD === undefined) { await bail("夹具日报 D 没派生问题"); }
await openDaily("issues");
await sleep(1200);
await clickSelector("[data-issue-row=" + Q + issD.id + Q + "] [data-issue-delete-slot] button");
const issDConfirmShown = await waitFor("document.querySelector(" + j("[data-delete-confirm-strip]") + ") !== null", 5000);
await sleep(400);
const issDStillThere = await ev("document.querySelector(" + j("[data-issue-row=" + Q + issD.id + Q + "]") + ") !== null");
check("⑦d-1 删问题第一下（行尾垃圾桶）= 只出底部确认条、不真删（二次提示）", issDConfirmShown === true && issDStillThere === true, JSON.stringify({ strip: issDConfirmShown, row: issDStillThere }));
await clickSelector("[data-delete-confirm]");
const issDGone = await waitFor("(function(){var t=document.querySelector(" + j("[data-issue-table]") + ");return t===null || t.querySelector(" + j("[data-issue-row=" + Q + issD.id + Q + "]") + ")===null;})()", 12000);
await sleep(1200);
const afterDelIssue = await reportsOf();
const repD404 = await api("/api/v1/projects/" + projectId + "/reports/" + repD.id);
check("⑦d 删问题（界面行尾垃圾桶）→ 来源日报连它一起删（成对删除 · 响应 cascadedReportId）", issDGone === true && afterDelIssue.total === 2 && repD404.status === 404, JSON.stringify({ gone: issDGone, reports: afterDelIssue.total, repD404: repD404.status }));

// ---------- ⑧ 收尾：临时项目物理删 + 会话撤销 + 零残留 ----------
const purgedAtEnd = await purgeProjectFiles(projectId);
console.log("收尾：文件回收站 purge " + String(purgedAtEnd.purged) + "/" + String(purgedAtEnd.total));
const projRow = await api("/api/v1/projects/" + projectId);
const delProj = await api("/api/v1/projects/" + projectId, "DELETE", undefined, { "If-Match": String(projRow.json.version) });
check("⑧a 删临时项目（200 / 204）", delProj.status === 200 || delProj.status === 204, String(delProj.status) + " " + delProj.text.slice(0, 120));
const projGone = await api("/api/v1/projects/" + projectId);
check("⑧b 项目读面 404（物理删、行不存在）", projGone.status === 404, String(projGone.status));
await db.query("update sessions set revoked_at = now() where token_hash = $1", [sha256(token)]);
const residue = (await db.query("select (select count(*)::int from sessions where token_hash = $1 and revoked_at is null) as sessions,"
  + " (select count(*)::int from daily_reports where project_id = $2) as reports,"
  + " (select count(*)::int from issues where project_id = $2) as issues,"
  + " (select count(*)::int from files where project_id = $2) as files,"
  + " (select count(*)::int from projects where id = $2) as projects,"
  + " (select count(*)::int from file_links where not exists (select 1 from files f where f.id = file_links.file_id)) as orphan_links",
  [sha256(token), projectId])).rows[0];
check("⑧c 零残留：会话撤销 + 日报 / 问题 / 文件 / 项目全 0 行、无孤儿 file_links", Number(residue.sessions) === 0 && Number(residue.reports) === 0 && Number(residue.issues) === 0 && Number(residue.files) === 0 && Number(residue.projects) === 0 && Number(residue.orphan_links) === 0, JSON.stringify(residue));

// ---------- 收尾 ----------
const failed = checks.filter((ok) => ok !== true).length;
console.log("—— 合计 " + String(checks.length) + " 项：" + String(checks.length - failed) + " 通过 / " + String(failed) + " 失败 ——");
const pageEvents = page.events.filter((line) => line.indexOf("EVT ") === 0);
console.log("页面控制台 / 异常：" + String(pageEvents.length) + " 条");
for (const line of pageEvents.slice(0, 8)) { console.log("  " + line.slice(0, 240)); }
try { page.ws.close(); } catch (error) { /* 忽略 */ }
chrome.kill();
await db.end();
process.exit(failed === 0 ? 0 : 1);
