#!/usr/bin/env node
/**
 * LibiaoLink 前端 · Push 184 回放：任务负责人「缺省 = 待分配」+ 改负责人即时可见（不刷新页面）
 *
 * 前置（四件都在本机跑着）：
 *   1. 前端 dev：cd frontend && npm run dev（默认 3000）
 *   2. api：cd server && npm run start:api（默认 3001，需先 npm run build）
 *   3. 数据库：本地沙箱 PG（默认 127.0.0.1:5433/libiaolink）
 *   4. 本机装了 Chrome（脚本 headless 起一个调试实例；路径可用 CHROME_PATH 覆盖）
 *
 * 用法：node scripts/m3-07-owner-e2e.mjs
 *   可覆盖的环境变量：FRONTEND_BASE / API_BASE / DATABASE_URL / CHROME_PATH / CDP_PORT / REPLAY_USER / PG_MODULE
 *
 * 它做什么：用一条**临时会话**（跑完撤销）+ 一个**临时项目**（跑完软删）+ 一条**临时节点**（跑完物理删）在真机浏览器里跑：
 *   ① 缺省口径（2026-09-24 修订，回到 ADR-021）：添加任务的请求不带 ownerIds —— 服务端落库 ownerIds=[]（「待分配」），
 *      不再兜底项目经理。夹具特意把项目经理设成回放用户本人：兜底若还在，这条任务的负责人就会变成他；
 *   ② 即时可见（Push 184 修的 bug）：行内「修改任务负责人」勾一位 / 再勾一位 / 取消一位 —— **不刷新页面**，
 *      单元格当次就变（写回响应不带 ownerNames，改走用户目录补名）；
 *   ③ 硬刷新后仍成立：改动落库，不是内存态。
 * 证据：docs/m3-07-回放证据(负责人缺省与即时显示·前端).md
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
// pg 只用来核对库内口径（tasks.owner_ids）与夹具成员 —— 前端不新装依赖，复用 server 的依赖解析。
const PG_MODULE = process.env.PG_MODULE ?? new URL("../../server/node_modules/pg/lib/index.js", import.meta.url).href;
const { default: pg } = await import(PG_MODULE);

const { Client } = pg;
const FRONTEND = process.env.FRONTEND_BASE ?? "http://localhost:3000";
const API = process.env.API_BASE ?? "http://127.0.0.1:3001";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(process.env.CDP_PORT ?? 9399);
const DB = process.env.DATABASE_URL ?? "postgres://libiaolink_api@127.0.0.1:5433/libiaolink";
const REPLAY_USER = process.env.REPLAY_USER ?? "panxing";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const Q = String.fromCharCode(34);
const NL = String.fromCharCode(10);
const j = (value) => JSON.stringify(value);

const db = new Client({ connectionString: DB });
await db.connect();
const userRow = (await db.query("select id, username, display_name from users where username = $1", [REPLAY_USER])).rows[0];
if (userRow === undefined) {
  console.error("回放用户不存在：" + REPLAY_USER);
  process.exit(1);
}
const assignRows = (await db.query("select id, username, display_name from users where username in ($1, $2) order by username", ["lan", "wmj"])).rows;
if (assignRows.length !== 2) {
  console.error("指派成员夹具缺失（lan / wmj）");
  process.exit(1);
}
const memberA = assignRows[0];
const memberB = assignRows[1];
const token = "pxowner-" + randomBytes(16).toString("hex");
const csrf = randomBytes(16).toString("hex");
await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(mins => 30))", [sha256(token), userRow.id, "px-owner-e2e"]);
console.log("临时会话：" + userRow.username + "（" + userRow.display_name + "）· 指派候选：" + memberA.display_name + " / " + memberB.display_name);

const profile = mkdtempSync(join(tmpdir(), "pxowner-"));
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

// ---------- 夹具：临时节点（design）+ 临时项目（项目经理 = 回放用户本人） ----------
const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace(/[-:T]/g, "");
const nodeTitle = "回放·负责人缺省·" + stamp;
const nodeRes = await api("/api/v1/task-nodes", "POST", { stageKey: "design", title: nodeTitle, titleEn: "Owner default" });
check("夹具：临时节点（阶段 design）", nodeRes.status === 201 && nodeRes.json !== null, String(nodeRes.status) + " " + nodeRes.text.slice(0, 140));
const nodeId = nodeRes.json === null ? "" : nodeRes.json.id;
const projRes = await api("/api/v1/projects", "POST", { code: "PX-OWNER-" + randomBytes(2).toString("hex").toUpperCase(), name: "负责人缺省回放", managerIds: [userRow.id] });
check("夹具：临时项目（项目经理 = 回放用户本人 —— 兜底若还在，缺省负责人就会变成他）", projRes.status === 201, String(projRes.status) + " " + projRes.text.slice(0, 140));
const projectId = projRes.json === null ? "" : projRes.json.id;
const projDetail = await api("/api/v1/projects/" + projectId);
check("夹具：项目 managerIds = [回放用户]（兜底落点明确，不是「项目没经理所以为空」）", projDetail.json !== null && Array.isArray(projDetail.json.managerIds) && projDetail.json.managerIds.length === 1 && projDetail.json.managerIds[0] === userRow.id, JSON.stringify(projDetail.json === null ? null : projDetail.json.managerIds));

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
const flat = (text) => String(text).split(NL).join(" | ");
/** 硬刷新：先回 about:blank 再进目标 URL —— 同一个 hash 的二次导航浏览器会当同文档、SPA 不重挂（踩过）。 */
async function openView(view) {
  await page.send("Page.navigate", { url: "about:blank" });
  await sleep(500);
  await page.send("Page.navigate", { url: FRONTEND + "/#/project/" + projectId + "?view=" + view });
  await sleep(5200);
}
async function tasksOf() {
  const res = await api("/api/v1/projects/" + projectId + "/tasks?limit=200");
  return res.json === null ? [] : res.json.items;
}
function taskOf(items, title) {
  return items.filter((item) => item.title === title)[0];
}
/** 点一个按钮：按 innerText 前缀命中。 */
function clickButton(label, contains) {
  return "(function(){var bs=document.querySelectorAll(" + j("button") + ");for(var i=0;i<bs.length;i++){var t=(bs[i].innerText||" + j("") + ").trim();if(t.indexOf(" + j(label) + ")===0" + (contains === undefined ? "" : " && t.indexOf(" + j(contains) + ")>=0") + "){bs[i].click();return t.slice(0,40);}}return " + j("") + ";})()";
}
/** 点某条节点行的「＋ 添加」（只在没添加过时点得动）。 */
function clickRow(title) {
  return "(function(){var bs=document.querySelectorAll(" + j("button") + ");for(var i=0;i<bs.length;i++){var t=(bs[i].innerText||" + j("") + ").trim();if(t.indexOf(" + j(title) + ")>=0 && t.slice(-4)===" + j("＋ 添加") + " && bs[i].disabled!==true){bs[i].click();return true;}}return false;})()";
}
/** 项目总览任务表：某人任务那一行的「负责人」单元格（aria-label=修改任务负责人，行 = 最近的 role=button 祖先）。 */
const OWNER_SELECTOR = "[aria-label=" + Q + "修改任务负责人" + Q + "]";
const OPTION_SELECTOR = "[data-inline-popover=" + Q + "true" + Q + "] [role=" + Q + "option" + Q + "]";
function ownerCellExpr(title, action) {
  return "(function(){var els=document.querySelectorAll(" + j(OWNER_SELECTOR) + ");for(var i=0;i<els.length;i++){var cell=els[i];var row=cell.closest(" + j("[role=button]") + ");if(row!==null&&(row.innerText||" + j("") + ").indexOf(" + j(title) + ")>=0){" + action + "}}return " + j("missing") + ";})()";
}
const readOwnerCell = (title) => ownerCellExpr(title, "return (cell.innerText||" + j("") + ").trim();");
const clickOwnerCell = (title) => ownerCellExpr(title, "cell.click();return " + j("clicked") + ";");
const optionsExpr = () => "(function(){return document.querySelectorAll(" + j(OPTION_SELECTOR) + ").length;})()";
function clickOptionExpr(name) {
  return "(function(){var os=document.querySelectorAll(" + j(OPTION_SELECTOR) + ");for(var i=0;i<os.length;i++){if((os[i].innerText||" + j("") + ").indexOf(" + j(name) + ")>=0){os[i].click();return true;}}return false;})()";
}
function selectedOptionExpr(name) {
  return "(function(){var os=document.querySelectorAll(" + j(OPTION_SELECTOR) + ");for(var i=0;i<os.length;i++){if((os[i].innerText||" + j("") + ").indexOf(" + j(name) + ")>=0){return String(os[i].getAttribute(" + j("aria-selected") + "));}}return " + j("missing") + ";})()";
}
/** 点浮层外（body 上派发 mousedown：usePopover 的关闭监听就在 document 的 mousedown 上）收起浮层。 */
const closePopoverExpr = () => "(function(){document.body.dispatchEvent(new MouseEvent(" + j("mousedown") + ",{bubbles:true}));return true;})()";
/** Esc 关掉「添加任务」卡片（StageAddCard 的 window keydown 监听；document 上派发会冒泡到 window）。 */
const closeCardExpr = () => "(function(){document.dispatchEvent(new KeyboardEvent(" + j("keydown") + ",{key:" + j("Escape") + ",bubbles:true}));return true;})()";

// ---------- ① 缺省口径：添加卡片「任务节点」加一条（前端请求不带 ownerIds） ----------
await openView("overview");
const pill = await ev("(function(){var ps=document.querySelectorAll(" + j("[data-stage-pill]") + ");for(var i=0;i<ps.length;i++){if((ps[i].textContent||" + j("") + ").indexOf(" + j("设计开发") + ")>=0){ps[i].click();return true;}}return false;})()");
await sleep(1600);
const nodeTab = await ev(clickButton("任务节点"));
await sleep(1400);
check("点阶段「设计开发」打开添加卡片 + 切到「任务节点」标签", pill === true && nodeTab !== "", String(nodeTab));
const clicked = await ev(clickRow(nodeTitle));
await sleep(6000);
check("点该节点「＋ 添加」（请求不带 ownerIds）", clicked === true, String(clicked));
const items1 = await tasksOf();
const created = taskOf(items1, nodeTitle);
check("服务端落库：ownerIds = []（缺省 = 「待分配」，不再兜底项目经理）", created !== undefined && Array.isArray(created.ownerIds) && created.ownerIds.length === 0, JSON.stringify(created === undefined ? null : { ownerIds: created.ownerIds, ownerNames: created.ownerNames }));
const dbOwners1 = (await db.query("select owner_ids from tasks where id = $1", [created === undefined ? null : created.id])).rows[0];
check("库内 tasks.owner_ids = 空数组（真落库）", dbOwners1 !== undefined && Array.isArray(dbOwners1.owner_ids) && dbOwners1.owner_ids.length === 0, JSON.stringify(dbOwners1 === undefined ? null : dbOwners1.owner_ids));

await ev(closeCardExpr());
await sleep(900);
const cell0 = String(await ev(readOwnerCell(nodeTitle)));
check("行内「负责人」单元格当次就显示「待分配」（未刷新页面）", cell0.indexOf("待分配") >= 0, cell0);

// ---------- ② 即时可见：勾一位 / 再勾一位 / 取消（全程不刷新页面） ----------
const open1 = await ev(clickOwnerCell(nodeTitle));
await sleep(600);
const optCount1 = Number(await ev(optionsExpr()));
check("点「修改任务负责人」→ 浮层打开（成员选项列表）", open1 === "clicked" && optCount1 > 0, "options=" + String(optCount1));
const pick1 = await ev(clickOptionExpr(memberA.display_name));
await sleep(1400);
const cell1 = String(await ev(readOwnerCell(nodeTitle)));
check("勾选「" + memberA.display_name + "」→ 不刷新，单元格当次变成他（Push 184 修的就是这个）", pick1 === true && cell1.indexOf(memberA.display_name) >= 0 && cell1.indexOf(userRow.display_name) < 0, cell1);
const afterA = taskOf(await tasksOf(), nodeTitle);
check("服务端 ownerIds = [勾选的那位]", afterA !== undefined && afterA.ownerIds.join(",") === memberA.id, JSON.stringify(afterA === undefined ? null : afterA.ownerIds));

const pick2 = await ev(clickOptionExpr(memberB.display_name));
await sleep(1400);
const cell2 = String(await ev(readOwnerCell(nodeTitle)));
check("再勾一位「" + memberB.display_name + "」（浮层不自动关）→ 不刷新，单元格 = 两位「、」连接", pick2 === true && cell2.indexOf(memberA.display_name + "、" + memberB.display_name) >= 0, cell2);
const afterB = taskOf(await tasksOf(), nodeTitle);
check("服务端 ownerIds = [A, B]（顺序 = 勾选顺序）", afterB !== undefined && afterB.ownerIds.join(",") === [memberA.id, memberB.id].join(","), JSON.stringify(afterB === undefined ? null : afterB.ownerIds));
const selectedB = String(await ev(selectedOptionExpr(memberB.display_name)));
check("浮层里该项 aria-selected = true（勾选态跟着服务端回值）", selectedB === "true", selectedB);

await ev(closePopoverExpr());
await sleep(700);
const optAfterClose = Number(await ev(optionsExpr()));
check("点浮层外 → 浮层收起", optAfterClose === 0, "options=" + String(optAfterClose));

const open2 = await ev(clickOwnerCell(nodeTitle));
await sleep(600);
const pick3 = await ev(clickOptionExpr(memberA.display_name));
await sleep(1400);
const cell3 = String(await ev(readOwnerCell(nodeTitle)));
check("再点「" + memberA.display_name + "」取消勾选 → 不刷新，单元格只剩 " + memberB.display_name, open2 === "clicked" && pick3 === true && cell3.indexOf(memberB.display_name) >= 0 && cell3.indexOf(memberA.display_name) < 0, cell3);
const afterC = taskOf(await tasksOf(), nodeTitle);
check("服务端 ownerIds = [B]（移除那一位即时生效）", afterC !== undefined && afterC.ownerIds.join(",") === memberB.id, JSON.stringify(afterC === undefined ? null : afterC.ownerIds));

const pick4 = await ev(clickOptionExpr(memberB.display_name));
await sleep(1400);
const cell4 = String(await ev(readOwnerCell(nodeTitle)));
check("再取消最后一位 → 不刷新，单元格回到「待分配」（A18 合法中间状态）", pick4 === true && cell4.indexOf("待分配") >= 0, cell4);
const afterD = taskOf(await tasksOf(), nodeTitle);
check("服务端 ownerIds = []（落库置空）", afterD !== undefined && Array.isArray(afterD.ownerIds) && afterD.ownerIds.length === 0, JSON.stringify(afterD === undefined ? null : afterD.ownerIds));
const dbOwners2 = (await db.query("select owner_ids from tasks where id = $1", [afterD === undefined ? null : afterD.id])).rows[0];
check("库内 tasks.owner_ids = 空数组（真落库）", dbOwners2 !== undefined && Array.isArray(dbOwners2.owner_ids) && dbOwners2.owner_ids.length === 0, JSON.stringify(dbOwners2 === undefined ? null : dbOwners2.owner_ids));

// ---------- ③ 硬刷新后仍成立 ----------
await openView("overview");
const cell5 = String(await ev(readOwnerCell(nodeTitle)));
check("硬刷新后仍「待分配」（落库不是内存态）", cell5.indexOf("待分配") >= 0, cell5);

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
check("清理：软删临时项目", delProj.status === 200 || delProj.status === 204, String(delProj.status) + " " + delProj.text.slice(0, 120));
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
