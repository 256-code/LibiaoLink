#!/usr/bin/env node
/**
 * LibiaoLink 前端 · M3-07 刀 3 回放：添加任务模板化（节点库来源 + 整套添加走模板实例化接口）
 *
 * 前置（三件都在本机跑着）：
 *   1. 前端 dev：cd frontend && npm run dev（默认 3000）
 *   2. api：cd server && npm run start:api（默认 3001，需先 npm run build）
 *   3. 数据库：本地沙箱 PG（默认 127.0.0.1:5433/libiaolink）
 *   4. 本机装了 Chrome（脚本 headless 起一个调试实例；路径可用 CHROME_PATH 覆盖）
 *
 * 用法：node scripts/m3-07-from-template-e2e.mjs
 *   可覆盖的环境变量：FRONTEND_BASE / API_BASE / DATABASE_URL / CHROME_PATH / CDP_PORT / REPLAY_USER / PG_MODULE
 *
 * 它做什么：用一条**临时会话**（跑完撤销）+ 一份**临时模板**（跑完软删）+ 四条**临时节点**（跑完物理删）+
 *   一个**临时项目**（跑完硬删、读面零残留）在真机浏览器里跑一遍「添加任务」卡片的两条新口径：
 *   ① 「模板」标签点「整套添加」→ 走 POST /projects/{id}/tasks/from-template（整批同事务、带来源节点 id）；
 *   ② 「已添加」判重来自服务端 sourceNodeId（刷新后仍在、节点库标签同样认），不再只靠「同阶段同名」；
 *   ③ 节点库标签逐条加 → 同样带 sourceNodeId 落库（任务描述取节点现值）。
 * 证据：docs/m3-07-回放证据(添加任务模板化·前端).md
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
// pg 只用来核对一处库内口径（tasks.task_node_id，契约里叫 sourceNodeId）—— 前端不新装依赖，复用 server 的依赖解析。
const PG_MODULE = process.env.PG_MODULE ?? new URL("../../server/node_modules/pg/lib/index.js", import.meta.url).href;
const { default: pg } = await import(PG_MODULE);

const { Client } = pg;
const FRONTEND = process.env.FRONTEND_BASE ?? "http://localhost:3000";
const API = process.env.API_BASE ?? "http://127.0.0.1:3001";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(process.env.CDP_PORT ?? 9397);
const DB = process.env.DATABASE_URL ?? "postgres://libiaolink_api@127.0.0.1:5433/libiaolink";
const REPLAY_USER = process.env.REPLAY_USER ?? "panxing";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const Q = String.fromCharCode(34);
const q = (text) => Q + text + Q;
const NL = String.fromCharCode(10);

const db = new Client({ connectionString: DB });
await db.connect();
const userRow = (await db.query("select id, username, display_name from users where username = $1", [REPLAY_USER])).rows[0];
if (userRow === undefined) {
  console.error("回放用户不存在：" + REPLAY_USER);
  process.exit(1);
}
const token = "pxtpl3-" + randomBytes(16).toString("hex");
const csrf = randomBytes(16).toString("hex");
await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(mins => 30))", [sha256(token), userRow.id, "px-from-template-e2e"]);
console.log("临时会话：" + userRow.username + "（" + userRow.display_name + "）");

const profile = mkdtempSync(join(tmpdir(), "pxtpl3-"));
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

// ---------- 夹具：临时节点 x4 + 临时模板 + 临时项目 ----------
const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace(/[-:T]/g, "");
const nodeTitles = ["回放·整套A·" + stamp, "回放·整套B·" + stamp, "回放·整套C·" + stamp];
const node4Title = "回放·单条D·" + stamp;
const nodeIds = [];
for (let index = 0; index < nodeTitles.length; index += 1) {
  const res = await api("/api/v1/task-nodes", "POST", { stageKey: "design", title: nodeTitles[index], titleEn: "Batch " + String(index + 1) });
  if (res.status !== 201) throw new Error("临时节点创建失败：" + res.status + " " + res.text.slice(0, 200));
  nodeIds.push(res.json.id);
}
const node4 = await api("/api/v1/task-nodes", "POST", { stageKey: "design", title: node4Title, titleEn: "Single D" });
check("夹具：临时节点 4 条（阶段 design）", node4.status === 201, "3 + " + String(node4.status));
const tplName = "回放模板·整套·" + stamp;
const tplRes = await api("/api/v1/task-templates", "POST", { name: tplName, stageKey: "design", nodeIds });
check("夹具：临时模板（3 个节点）", tplRes.status === 201 && tplRes.json !== null && tplRes.json.nodes.length === 3, String(tplRes.status) + " " + tplRes.text.slice(0, 160));
const templateId = tplRes.json === null ? "" : tplRes.json.id;
const projRes = await api("/api/v1/projects", "POST", { code: "PX-M307T3-" + randomBytes(2).toString("hex").toUpperCase(), name: "M3-07刀3回放", managerIds: [userRow.id] });
check("夹具：临时项目（201）", projRes.status === 201, String(projRes.status) + " " + projRes.text.slice(0, 140));
const projectId = projRes.json === null ? "" : projRes.json.id;

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
/** 点一个按钮：按 innerText 前缀命中（不含参数里给的子串就跳过）。 */
function clickButton(label, contains) {
  return "(function(){var bs=document.querySelectorAll(\"button\");for(var i=0;i<bs.length;i++){var t=(bs[i].innerText||\"\").trim();if(t.indexOf(" + JSON.stringify(label) + ")===0" + (contains === undefined ? "" : " && t.indexOf(" + JSON.stringify(contains) + ")>=0") + "){bs[i].click();return t.slice(0,40);}}return \"\";})()";
}
/** 某条节点行现在长什么样（按钮禁用 + 尾巴文案）。 */
function rowState(title) {
  return "(function(){var bs=document.querySelectorAll(\"button\");for(var i=0;i<bs.length;i++){var t=(bs[i].innerText||\"\").trim();if(t.indexOf(" + JSON.stringify(title) + ")>=0 && (t.slice(-3)===\"已添加\" || t.slice(-4)===\"＋ 添加\")){return (bs[i].disabled===true?\"disabled\":\"enabled\") + \":\" + t.slice(-3);}}return \"missing\";})()";
}
/** 点某条节点行的「＋ 添加」（只在没添加过时点得动）。 */
function clickRow(title) {
  return "(function(){var bs=document.querySelectorAll(\"button\");for(var i=0;i<bs.length;i++){var t=(bs[i].innerText||\"\").trim();if(t.indexOf(" + JSON.stringify(title) + ")>=0 && t.slice(-4)===\"＋ 添加\" && bs[i].disabled!==true){bs[i].click();return true;}}return false;})()";
}
function cardText() {
  return "(function(){var els=document.querySelectorAll(" + Q + "[aria-label]" + Q + ");for(var i=0;i<els.length;i++){var a=els[i].getAttribute(" + Q + "aria-label" + Q + ")||" + Q + Q + ";if(a.indexOf(" + Q + "设计开发：任务节点与模板" + Q + ")>=0){return els[i].innerText;}}return " + Q + Q + ";})()";
}

await openView("overview");
const pill = await ev("(function(){var ps=document.querySelectorAll(\"[data-stage-pill]\");for(var i=0;i<ps.length;i++){if((ps[i].textContent||\"\").indexOf(\"设计开发\")>=0){ps[i].click();return true;}}return false;})()");
await sleep(1600);
check("点阶段标签「设计开发」打开「添加任务」卡片", pill === true && String(await ev(cardText())).length > 0, flat(await ev(cardText())).slice(0, 160));
const openTpl = await ev(clickButton(tplName));
await sleep(1200);
const cardAfterTab = flat(await ev(cardText()));
check("切到模板标签（面板 = 这块模板：标题 + 3 条 + 已添加 0）", openTpl !== "" && cardAfterTab.indexOf("模板预览 · 已添加 0") >= 0 && cardAfterTab.indexOf("整套添加（3）") >= 0, cardAfterTab.slice(0, 220));

const node4Id = node4.json === null ? "" : node4.json.id;
const batch = await ev(clickButton("整套添加"));
await sleep(6500);
check("点「整套添加（3）」", batch !== "", String(batch));
const items1 = await tasksOf();
const sourced1 = items1.filter((item) => item.sourceNodeId !== null && item.sourceNodeId !== undefined);
check("整套添加 → 走模板实例化接口落库 3 条（逐条带来源节点 id）", sourced1.length === 3 && nodeIds.every((id) => sourced1.some((item) => item.sourceNodeId === id)), String(sourced1.length) + " 条：" + JSON.stringify(sourced1.map((item) => item.sourceNodeId)));
check("落库顺序 = 模板内顺序、阶段取模板阶段（design）", sourced1.map((item) => item.title).join(",") === nodeTitles.join(",") && sourced1.every((item) => item.stageKey === "design"), JSON.stringify({ titles: sourced1.map((item) => item.title), stages: sourced1.map((item) => item.stageKey) }));
const cardAfterBatch = flat(await ev(cardText()));
check("卡片随即变「模板预览 · 已添加 3」+「整套添加（0）」置灰", cardAfterBatch.indexOf("模板预览 · 已添加 3") >= 0 && cardAfterBatch.indexOf("整套添加（0）") >= 0, cardAfterBatch.slice(0, 220));
const rows1 = [];
for (const title of nodeTitles) rows1.push(String(await ev(rowState(title))));
check("模板面板三行都显示「已添加」且点不动", rows1.every((item) => item === "disabled:已添加"), JSON.stringify(rows1));

await openView("overview");
const pill2 = await ev("(function(){var ps=document.querySelectorAll(\"[data-stage-pill]\");for(var i=0;i<ps.length;i++){if((ps[i].textContent||\"\").indexOf(\"设计开发\")>=0){ps[i].click();return true;}}return false;})()");
await sleep(1600);
await ev(clickButton(tplName));
await sleep(1400);
const cardReload = flat(await ev(cardText()));
check("刷新页面后仍「已添加 3」+「整套添加（0）」（判重来自服务端 sourceNodeId，不是内存态）", pill2 === true && cardReload.indexOf("模板预览 · 已添加 3") >= 0 && cardReload.indexOf("整套添加（0）") >= 0, cardReload.slice(0, 220));

const nodesTab = await ev(clickButton("任务节点"));
await sleep(1400);
const nodeRows = [];
for (const title of nodeTitles) nodeRows.push(String(await ev(rowState(title))));
check("切到「任务节点」标签：同三条也「已添加」（按来源节点 id 判重，不再只靠同阶段同名）", nodesTab !== "" && nodeRows.every((item) => item === "disabled:已添加"), JSON.stringify(nodeRows));

const clicked = await ev(clickRow(node4Title));
await sleep(6000);
check("节点库标签逐条加（模板外节点，默认顺序添加）→ 点得动", clicked === true, String(clicked));
const items2 = await tasksOf();
const n4Task = items2.filter((item) => item.sourceNodeId === node4Id)[0];
check("逐条添加落库：带 sourceNodeId + 描述取节点现值 + 阶段 = design", n4Task !== undefined && n4Task.title === node4Title && n4Task.stageKey === "design", JSON.stringify(n4Task === undefined ? null : { title: n4Task.title, stage: n4Task.stageKey, sourceNodeId: n4Task.sourceNodeId }));
const rowAfter = String(await ev(rowState(node4Title)));
check("该行随后显示「已添加」", rowAfter === "disabled:已添加", rowAfter);

const dbRows = (await db.query("select id, title, stage_key, task_node_id, node_id, sort_index from tasks where project_id = $1 and deleted_at is null order by sort_index, id", [projectId])).rows;
check("库内：4 行 task_node_id 全对齐（node_id 全 null）、位次 0 起稠密", dbRows.length === 4 && dbRows.every((row) => row.node_id === null) && dbRows.every((row) => row.task_node_id !== null) && dbRows.map((row) => String(row.sort_index)).join(",") === "0,1,2,3", dbRows.length + " 行 / sort_index=" + dbRows.map((row) => String(row.sort_index)).join(","));

// ---------- 清理 ----------
const leftovers = (await api("/api/v1/projects/" + projectId + "/tasks?limit=200")).json.items;
let deleted = 0;
for (const item of leftovers) {
  const res = await api("/api/v1/projects/" + projectId + "/tasks/" + item.id, "DELETE", undefined, { "If-Match": String(item.version) });
  if (res.status === 200 || res.status === 204) deleted += 1;
}
check("清理：逐条软删任务", deleted === leftovers.length && leftovers.length === 4, String(deleted) + "/" + String(leftovers.length));
const projRow = await api("/api/v1/projects/" + projectId);
const delProj = await api("/api/v1/projects/" + projectId, "DELETE", undefined, { "If-Match": String(projRow.json.version) });
check("清理：硬删临时项目（200 / 204）", delProj.status === 200 || delProj.status === 204, String(delProj.status) + " " + delProj.text.slice(0, 120));
const allNodeIds = nodeIds.concat([node4Id]);
let nodeGone = 0;
for (const id of allNodeIds) {
  const res = await api("/api/v1/task-nodes/" + id, "DELETE");
  if (res.status === 200 || res.status === 204) nodeGone += 1;
}
check("清理：临时节点物理删", nodeGone === allNodeIds.length, String(nodeGone) + "/" + String(allNodeIds.length));
const tplNow = await api("/api/v1/task-templates/" + templateId);
const delTpl = await api("/api/v1/task-templates/" + templateId, "DELETE", { version: tplNow.json === null ? 0 : tplNow.json.version });
check("清理：软删临时模板", delTpl.status === 200 || delTpl.status === 204, String(delTpl.status) + " " + delTpl.text.slice(0, 120));
await db.query("update sessions set revoked_at = now() where token_hash = $1", [sha256(token)]);
const residue = (await db.query("select (select count(*)::int from tasks where project_id = $1 and deleted_at is null) as tasks, (select count(*)::int from projects where id = $1) as projects, (select count(*)::int from task_nodes where id = any($2::uuid[])) as nodes, (select count(*)::int from task_templates where id = $3 and deleted_at is null) as templates, (select count(*)::int from sessions where token_hash = $4 and revoked_at is null) as sessions", [projectId, allNodeIds, templateId, sha256(token)])).rows[0];
check("清理：任务 / 项目 / 节点 / 模板 / 会话零残留", Number(residue.tasks) === 0 && Number(residue.projects) === 0 && Number(residue.nodes) === 0 && Number(residue.templates) === 0 && Number(residue.sessions) === 0, JSON.stringify(residue));

// ---------- 收尾 ----------
const failed = checks.filter((item) => item.ok !== true).length;
console.log("—— 合计 " + String(checks.length) + " 项：" + String(checks.length - failed) + " 通过 / " + String(failed) + " 失败 ——");
try { page.ws.close(); } catch (error) { /* 忽略 */ }
chrome.kill();
await db.end();
process.exit(failed === 0 ? 0 : 1);
