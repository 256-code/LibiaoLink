#!/usr/bin/env node
/**
 * LibiaoLink 前端 · 回放：任务表阶段分组头的点击区域收敛（业务口径 2026-09-24）
 *
 * 业务口径：「不要把阶段这一栏全部作为点击区域，只有到（左侧箭头 + 阶段标签）这块位置即可，其余一行就不做点击」。
 * 本脚本用**真实鼠标坐标**（CDP Input.dispatchMouseEvent，不是合成 click()）在真机浏览器上验四件事：
 *   ① 分组头右侧那段空白：点下去**什么都不发生**（不折叠、不开卡片，落点上也没有按钮）；
 *   ② 左侧箭头：点一下折叠（该阶段任务行消失）、再点展开；
 *   ③ 阶段标签：点一下开右侧「任务节点 + 模板」卡片、再点关掉（原有口径不变）；
 *   ④ 分组头容器已经不是 role=button（整行不再可点）。
 *
 * 前置（四件都在本机跑着）：
 *   1. 前端 dev：cd frontend && npm run dev（默认 3000）
 *   2. api：cd server && npm run start:api（默认 3001，需先 npm run build）
 *   3. 数据库：本地沙箱 PG（默认 127.0.0.1:5433/libiaolink）
 *   4. 本机装了 Chrome（脚本 headless 起一个调试实例；路径可用 CHROME_PATH 覆盖）
 *
 * 用法：node scripts/ui-stage-header-e2e.mjs
 *   可覆盖的环境变量：FRONTEND_BASE / API_BASE / DATABASE_URL / CHROME_PATH / CDP_PORT / REPLAY_USER / PG_MODULE
 *
 * 夹具：一条**临时会话**（跑完撤销）+ 一条**临时节点**（跑完物理删）+ 一个**临时项目**（跑完软删）+ 一条**临时任务**
 *      （挂在该节点上，落在「设计开发」阶段分组里），跑完零残留。
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
const PG_MODULE = process.env.PG_MODULE ?? new URL("../../server/node_modules/pg/lib/index.js", import.meta.url).href;
const { default: pg } = await import(PG_MODULE);

const { Client } = pg;
const FRONTEND = process.env.FRONTEND_BASE ?? "http://localhost:3000";
const API = process.env.API_BASE ?? "http://127.0.0.1:3001";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(process.env.CDP_PORT ?? 9401);
const DB = process.env.DATABASE_URL ?? "postgres://libiaolink_api@127.0.0.1:5433/libiaolink";
const REPLAY_USER = process.env.REPLAY_USER ?? "panxing";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const Q = String.fromCharCode(34);
const j = (value) => JSON.stringify(value);
const STAGE = "设计开发";

const db = new Client({ connectionString: DB });
await db.connect();
const userRow = (await db.query("select id, username, display_name from users where username = $1", [REPLAY_USER])).rows[0];
if (userRow === undefined) {
  console.error("回放用户不存在：" + REPLAY_USER);
  process.exit(1);
}
const token = "pxstage-" + randomBytes(16).toString("hex");
const csrf = randomBytes(16).toString("hex");
await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(mins => 30))", [sha256(token), userRow.id, "px-stage-header-e2e"]);
console.log("临时会话：" + userRow.username + "（" + userRow.display_name + "）");

const profile = mkdtempSync(join(tmpdir(), "pxstage-"));
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
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("cdp timeout: " + method)); }, 15000);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

const COOKIE = "ll_sid=" + token + "; ll_csrf=" + csrf;
async function api(path, method = "GET", body, extra) {
  const headers = Object.assign({ Cookie: COOKIE, "X-CSRF-Token": csrf, Accept: "application/json" }, extra || {});
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(API + path, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (error) { json = null; }
  return { status: res.status, json, text };
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: ok === true, detail: detail === undefined ? "" : String(detail) });
  console.log((ok === true ? "PASS  " : "FAIL  ") + name + (detail === undefined ? "" : "   [" + detail + "]"));
}

// ---------- 夹具：临时节点（design）+ 临时项目 + 一条挂在节点上的任务 ----------
const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace(/[-:T]/g, "");
const nodeTitle = "回放·点击区域·" + stamp;
const nodeRes = await api("/api/v1/task-nodes", "POST", { stageKey: "design", title: nodeTitle, titleEn: "Hit area" });
check("夹具：临时节点（阶段 design）", nodeRes.status === 201 && nodeRes.json !== null, String(nodeRes.status) + " " + nodeRes.text.slice(0, 120));
const nodeId = nodeRes.json === null ? "" : nodeRes.json.id;
const projRes = await api("/api/v1/projects", "POST", { code: "PX-STAGE-" + randomBytes(2).toString("hex").toUpperCase(), name: "分组头点击区域回放", managerIds: [userRow.id] });
check("夹具：临时项目（201）", projRes.status === 201, String(projRes.status) + " " + projRes.text.slice(0, 120));
const projectId = projRes.json === null ? "" : projRes.json.id;
const taskRes = await api("/api/v1/projects/" + projectId + "/tasks", "POST", { stageKey: "design", title: nodeTitle, titleEn: "Hit area", sourceNodeId: nodeId });
check("夹具：设计阶段一条任务（201，分组头下有 1 行）", taskRes.status === 201, String(taskRes.status) + " " + taskRes.text.slice(0, 120));

// ---------- 浏览器 ----------
const target = await waitTarget();
const page = new Cdp(target.webSocketDebuggerUrl);
await page.ready;
await page.send("Network.enable");
await page.send("Page.enable");
await page.send("Runtime.enable");
await page.send("Network.setCookie", { name: "ll_sid", value: token, url: FRONTEND + "/", path: "/", httpOnly: true, secure: false });
await page.send("Network.setCookie", { name: "ll_csrf", value: csrf, url: FRONTEND + "/", path: "/", httpOnly: false, secure: false });
await page.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ev = async (expression) => (await page.send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
/** 硬刷新：先回 about:blank 再进目标 URL —— 同一个 hash 的二次导航浏览器会当同文档、SPA 不重挂（踩过）。 */
async function openView(view) {
  await page.send("Page.navigate", { url: "about:blank" });
  await sleep(500);
  await page.send("Page.navigate", { url: FRONTEND + "/#/project/" + projectId + "?view=" + view });
  await sleep(5200);
}
/** 真实鼠标点一下（CDP Input，不是合成 click()）：走浏览器命中测试，落在哪个元素上就点哪个元素。 */
async function clickAt(point) {
  const x = point.x + Math.round(point.w / 2);
  const y = point.y + Math.round(point.h / 2);
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(700);
  return { x, y };
}
const STAGE_HEADER = "[data-stage-header=" + Q + STAGE + Q + "]";
const CARD = "[aria-label=" + Q + STAGE + "：任务节点与模板" + Q + "]";
/** 分组头本身：位置 + role 属性 + 类名（证明整行不再是 role=button、也不再是 pointer 光标）。 */
function headerExpr() {
  return "(function(){var el=document.querySelector(" + j(STAGE_HEADER) + ");if(el===null){return null;}el.scrollIntoView({block:" + j("center") + "});var r=el.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),role:el.getAttribute(" + j("role") + "),tabindex:el.getAttribute(" + j("tabindex") + "),cursor:el.className.indexOf(" + j("cursor-pointer") + ")>=0};})()";
}
/** 分组头里的一枚按钮（箭头 / 阶段标签）。 */
function buttonExpr(inner) {
  return "(function(){var h=document.querySelector(" + j(STAGE_HEADER) + ");if(h===null){return null;}var el=" + inner + ";if(el===null){return null;}el.scrollIntoView({block:" + j("center") + "});var r=el.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),label:el.getAttribute(" + j("aria-label") + ")||" + j("") + "};})()";
}
const arrowExpr = () => buttonExpr("(function(){var bs=h.querySelectorAll(" + j("button") + ");for(var i=0;i<bs.length;i++){var a=(bs[i].getAttribute(" + j("aria-label") + ")||" + j("") + ");if(a.indexOf(" + j("折叠这个阶段") + ")>=0||a.indexOf(" + j("展开这个阶段") + ")>=0){return bs[i];}}return null;})()");
const pillExpr = () => buttonExpr("h.querySelector(" + j("[data-stage-pill]") + ")");
/** 空白处落点上是什么（tagName + 最近的按钮）：证明那一整段没有可点的东西。 */
function hitExpr(x, y) {
  return "(function(){var el=document.elementFromPoint(" + String(x) + "," + String(y) + ");if(el===null){return " + j("null") + ";}var btn=el.closest(" + j("button") + ");return el.tagName + (btn===null?" + j(" / 无按钮") + ":" + j(" / 按钮[") + " + (btn.getAttribute(" + j("aria-label") + ")||" + j("无名") + ") + " + j("]") + ");})()";
}
const cardOpenExpr = () => "(function(){return document.querySelector(" + j(CARD) + ")===null?0:1;})()";
/** 该阶段任务行的条数：分组折叠时整组行会卸掉，行数从 1 变 0。 */
const rowCountExpr = () => "(function(){var n=0;var els=document.querySelectorAll(" + j("[role=button]") + ");for(var i=0;i<els.length;i++){if((els[i].innerText||" + j("") + ").indexOf(" + j(nodeTitle) + ")>=0){n+=1;}}return n;})()";

// ---------- ① 分组头不再是整行可点 ----------
await openView("overview");
const header0 = await ev(headerExpr());
check("分组头定位到「设计开发」组（夹具任务在组内）", header0 !== null && Number(header0.h) > 0, JSON.stringify(header0));
check("分组头已不是整行按钮：无 role=button、无 tabindex、无 cursor-pointer 样式", header0 !== null && header0.role === null && header0.tabindex === null && header0.cursor === false, header0 === null ? "null" : "role=" + String(header0.role) + " tabindex=" + String(header0.tabindex) + " cursor-pointer=" + String(header0.cursor));
const rows0 = Number(await ev(rowCountExpr()));
check("夹具任务在「设计开发」组里可见（1 行）", rows0 === 1, "rows=" + String(rows0));

// ---------- ② 右侧空白：点下去什么都不发生 ----------
const blankX = header0.x + header0.w - 60;
const blankY = header0.y + Math.round(header0.h / 2);
const hit = String(await ev(hitExpr(blankX, blankY)));
check("空白处的落点上没有按钮（elementFromPoint → 无按钮）", hit.indexOf("无按钮") >= 0, hit);
const blankPoint = { x: blankX, y: blankY, w: 0, h: 0 };
await clickAt(blankPoint);
const rowsAfterBlank = Number(await ev(rowCountExpr()));
const cardAfterBlank = Number(await ev(cardOpenExpr()));
check("点空白处：不折叠（行还在 1 行）", rowsAfterBlank === 1, "rows=" + String(rowsAfterBlank));
check("点空白处：不开卡片（右侧「任务节点 + 模板」卡片没出现）", cardAfterBlank === 0, "card=" + String(cardAfterBlank));

// ---------- ③ 左侧箭头：折叠 / 展开 ----------
const arrow0 = await ev(arrowExpr());
check("分组头左侧箭头是一枚带 aria-label 的按钮（折叠 / 展开这个阶段）", arrow0 !== null && arrow0.label.length > 0, JSON.stringify(arrow0));
await clickAt(arrow0);
const rowsFolded = Number(await ev(rowCountExpr()));
check("点箭头：该阶段折叠（组内行卸掉 → 0 行）", rowsFolded === 0, "rows=" + String(rowsFolded));
const arrow1 = await ev(arrowExpr());
check("折叠后箭头换成「展开这个阶段」", arrow1 !== null && arrow1.label.indexOf("展开") >= 0, JSON.stringify(arrow1));
await clickAt(arrow1);
const rowsExpanded = Number(await ev(rowCountExpr()));
check("再点箭头：展开回来（1 行）", rowsExpanded === 1, "rows=" + String(rowsExpanded));

// ---------- ④ 阶段标签：开 / 关卡片（原有口径不变） ----------
const pill = await ev(pillExpr());
const pillClick = await clickAt(pill);
const cardOpen = Number(await ev(cardOpenExpr()));
check("点阶段标签：右侧「任务节点 + 模板」卡片打开", pill !== null && cardOpen === 1, "card=" + String(cardOpen) + " @ " + String(pillClick.x) + "," + String(pillClick.y));
const pill2 = await ev(pillExpr());
await clickAt(pill2);
const cardClosed = Number(await ev(cardOpenExpr()));
check("再点同一个标签：卡片关掉", cardClosed === 0, "card=" + String(cardClosed));

// ---------- ⑤ 卡片关着时再点一次空白：仍然什么都不发生 ----------
const header1 = await ev(headerExpr());
const blankPoint2 = { x: header1.x + header1.w - 60, y: header1.y + Math.round(header1.h / 2), w: 0, h: 0 };
await clickAt(blankPoint2);
const rowsFinal = Number(await ev(rowCountExpr()));
const cardFinal = Number(await ev(cardOpenExpr()));
check("再点一次空白：行仍 1 行、卡片仍关着（那一整段真的点不动）", rowsFinal === 1 && cardFinal === 0, "rows=" + String(rowsFinal) + " card=" + String(cardFinal));

// ---------- 清理 ----------
const leftovers = (await api("/api/v1/projects/" + projectId + "/tasks?limit=200")).json.items;
let deleted = 0;
for (const item of leftovers) {
  const res = await api("/api/v1/projects/" + projectId + "/tasks/" + item.id, "DELETE", undefined, { "If-Match": String(item.version) });
  if (res.status === 200 || res.status === 204) deleted += 1;
}
check("清理：软删临时任务", deleted === leftovers.length && leftovers.length === 1, String(deleted) + "/" + String(leftovers.length));
const projNow = await api("/api/v1/projects/" + projectId);
const delProj = await api("/api/v1/projects/" + projectId, "DELETE", undefined, { "If-Match": String(projNow.json.version) });
check("清理：软删临时项目", delProj.status === 200 || delProj.status === 204, String(delProj.status));
const delNode = await api("/api/v1/task-nodes/" + nodeId, "DELETE");
check("清理：临时节点物理删", delNode.status === 200 || delNode.status === 204, String(delNode.status));
await db.query("update sessions set revoked_at = now() where token_hash = $1", [sha256(token)]);
const residue = (await db.query("select (select count(*)::int from tasks where project_id = $1 and deleted_at is null) as tasks, (select count(*)::int from projects where id = $1 and deleted_at is null) as projects, (select count(*)::int from task_nodes where id = $2) as nodes, (select count(*)::int from sessions where token_hash = $3 and revoked_at is null) as sessions", [projectId, nodeId, sha256(token)])).rows[0];
check("清理：任务 / 项目 / 节点 / 会话零残留", Number(residue.tasks) === 0 && Number(residue.projects) === 0 && Number(residue.nodes) === 0 && Number(residue.sessions) === 0, JSON.stringify(residue));

// ---------- 收尾 ----------
const failed = checks.filter((item) => item.ok !== true).length;
console.log("—— 合计 " + String(checks.length) + " 项：" + String(checks.length - failed) + " 通过 / " + String(failed) + " 失败 ——");
try { page.ws.close(); } catch (error) { /* 忽略 */ }
chrome.kill();
await db.end();
process.exit(failed === 0 ? 0 : 1);
