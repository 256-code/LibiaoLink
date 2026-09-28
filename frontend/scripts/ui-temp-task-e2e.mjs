#!/usr/bin/env node
/**
 * LibiaoLink 前端 · 回放：临时任务「建完直接开详情抽屉 / 名字二次更改 / 项目总览垫底「临时任务」分组」（业务口径 2026-09-28 · Push 196）
 *
 * 业务口径：「临时任务 添加完 应直接跳转到详情页面人后确认时间等细节 并且临时任务的名字应可以二次更改；
 *            设计同步到项目总览的最下方 新增一个分组叫临时任务」。
 * 本脚本用**真实鼠标 / 真实键盘**（CDP Input，不是合成 click()）在真机浏览器上验六组事：
 *   ① 项目总览的**最后一组**是「临时任务」：组头只有「折叠箭头 + 组名胶囊」，标签是普通 span（不是按钮）——
 *      点标签 / 点组头空白都不弹「任务节点 + 模板」卡片；九个施工阶段的标签照旧可点（对照组：设计开发能开能关）；
 *   ② 看板「任务进展 → 待开始」列底「添加 → 临时任务」：填名点「创建」后**详情抽屉自动打开**（不用再点一次卡片），
 *      抽屉里能当场确认「开始 / 预计完成」等时间细节；
 *   ③ 抽屉里给临时任务**二次改名**：中文 / 英文失焦即存、英文留空 = 清空（契约 null）、中文留空 = 自动还原不写库；
 *   ④ 节点来源任务（sourceNodeId）的抽屉**没有**改名行；服务端同口径兜底 —— PATCH title / titleEn 均 400 VALIDATION_FAILED；
 *   ⑤ 改完名字项目总览垫底「临时任务」组同步新名字（组头带「已完成 0/1」计数）；
 *   ⑥ 跑完零残留（软删任务 / 硬删项目 / 物理删节点 / 撤销会话）。
 *
 * 前置（四件都在本机跑着）：
 *   1. 前端 dev：cd frontend && npm run dev（默认 3000）
 *   2. api：cd server && npm run start:api（默认 3001，需先 npm run build）
 *   3. 数据库：本地沙箱 PG（默认 127.0.0.1:5433/libiaolink）
 *   4. 本机装了 Chrome（脚本 headless 起一个调试实例；路径可用 CHROME_PATH 覆盖）
 *
 * 用法：node scripts/ui-temp-task-e2e.mjs
 *   可覆盖的环境变量：FRONTEND_BASE / API_BASE / DATABASE_URL / CHROME_PATH / CDP_PORT / REPLAY_USER / PG_MODULE
 *
 * 夹具：一条**临时会话**（跑完撤销）+ 一条**临时节点**（跑完物理删）+ 一个**临时项目**（跑完硬删）+
 *      一条挂在节点上的任务（验「节点来源不可改名」）+ 一条看板里现建现改的临时任务，跑完零残留。
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
const PORT = Number(process.env.CDP_PORT ?? 9402);
const DB = process.env.DATABASE_URL ?? "postgres://libiaolink_api@127.0.0.1:5433/libiaolink";
const REPLAY_USER = process.env.REPLAY_USER ?? "panxing";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const Q = String.fromCharCode(34);
const j = (value) => JSON.stringify(value);
const TEMP_STAGE = "临时任务";
const COLUMN = "待开始";
const DESIGN = "设计开发";
const CONFIRM = "开始 / 预计完成";

const db = new Client({ connectionString: DB });
await db.connect();
const userRow = (await db.query("select id, username, display_name from users where username = $1", [REPLAY_USER])).rows[0];
if (userRow === undefined) {
  console.error("回放用户不存在：" + REPLAY_USER);
  process.exit(1);
}
const token = "pxtemp-" + randomBytes(16).toString("hex");
const csrf = randomBytes(16).toString("hex");
await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(mins => 30))", [sha256(token), userRow.id, "px-temp-task-e2e"]);
console.log("临时会话：" + userRow.username + "（" + userRow.display_name + "）");

const profile = mkdtempSync(join(tmpdir(), "pxtemp-"));
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

// ---------- 夹具：临时节点（design）+ 临时项目 + 一条节点来源任务（验锁定） ----------
const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace(/[-:T]/g, "");
const nodeTitle = "回放·临时改名·" + stamp;
const nodeRes = await api("/api/v1/task-nodes", "POST", { stageKey: "design", title: nodeTitle, titleEn: "Temp rename" });
check("夹具：临时节点（阶段 design）", nodeRes.status === 201 && nodeRes.json !== null, String(nodeRes.status) + " " + nodeRes.text.slice(0, 120));
const nodeId = nodeRes.json === null ? "" : nodeRes.json.id;
const projRes = await api("/api/v1/projects", "POST", { code: "PX-TEMP-" + randomBytes(2).toString("hex").toUpperCase(), name: "临时任务回放", managerIds: [userRow.id] });
check("夹具：临时项目（201）", projRes.status === 201 && projRes.json !== null, String(projRes.status) + " " + projRes.text.slice(0, 120));
const projectId = projRes.json === null ? "" : projRes.json.id;
const lockedRes = await api("/api/v1/projects/" + projectId + "/tasks", "POST", { stageKey: "design", title: nodeTitle, titleEn: "Temp rename", sourceNodeId: nodeId });
check("夹具：设计阶段一条节点来源任务（201，后面验「锁定不可改名」）", lockedRes.status === 201 && lockedRes.json !== null, String(lockedRes.status) + " " + lockedRes.text.slice(0, 120));
const lockedTaskId = lockedRes.json === null ? "" : lockedRes.json.id;

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
/** 页面里跑一段表达式（页面抛异常时把页面侧的报错原样抛出，别让上层拿到 undefined 猜谜）。 */
const ev = async (expression) => {
  const reply = await page.send("Runtime.evaluate", { expression, returnByValue: true });
  if (reply.exceptionDetails !== undefined) {
    throw new Error("页面表达式抛异常：" + JSON.stringify(reply.exceptionDetails).slice(0, 300) + " | 表达式：" + expression.slice(0, 160));
  }
  return reply.result.value;
};
/** 等到页面里某个布尔表达式为真（默认 20 秒） */
async function waitFor(expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await ev(expression)) === true) {
      return true;
    }
    await sleep(250);
  }
  return false;
}
/** 硬刷新：先回 about:blank 再进目标 URL —— 同一个 hash 的二次导航浏览器会当同文档、SPA 不重挂（踩过）。 */
async function openHash(hashPath) {
  await page.send("Page.navigate", { url: "about:blank" });
  await sleep(500);
  await page.send("Page.navigate", { url: FRONTEND + "/#/project/" + projectId + hashPath });
  await sleep(5200);
}
/** 真实鼠标点一下（CDP Input，不是合成 click()）：走浏览器命中测试，落在哪个元素上就点哪个元素。 */
async function clickAt(point) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(700);
}
async function rectOf(selector) {
  return await ev(
    "(() => { const node = document.querySelector(" + j(selector) + ");" +
    " if (node === null) { return null; }" +
    " node.scrollIntoView({ block: " + j("nearest") + ", inline: " + j("nearest") + " });" +
    " const box = node.getBoundingClientRect();" +
    " if (box.width === 0 || box.height === 0) { return null; }" +
    " return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2), w: Math.round(box.width), h: Math.round(box.height) }; })()"
  );
}
async function clickSelector(selector) {
  const point = await rectOf(selector);
  if (point === null || point === undefined) {
    throw new Error("点不到（元素不存在或不可见）：" + selector);
  }
  await clickAt(point);
  return point;
}
/** 真实键盘按一下（modifiers：1=Alt、2=Ctrl、4=Meta、8=Shift）。 */
async function pressKey(key, code, vk, modifiers = 0) {
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await sleep(350);
}
/** 点进输入框 → Ctrl+A 全选 → 真实文本输入（React 的 onChange 照常触发）。 */
async function typeInto(selector, text) {
  await clickSelector(selector);
  await pressKey("a", "KeyA", 65, 2);
  await page.send("Input.insertText", { text });
  await sleep(500);
}
/** 点进输入框 → Ctrl+A → Backspace（清空，走真实键盘）。 */
async function clearByKeyboard(selector) {
  await clickSelector(selector);
  await pressKey("a", "KeyA", 65, 2);
  await pressKey("Backspace", "Backspace", 8);
  await sleep(400);
}
/** 失焦（点抽屉标题这种非交互区）：触发「失焦即存」。 */
async function blurDrawer() {
  await clickAt(await rectOf("aside[role=dialog] h2"));
  await sleep(1200);
}

const headerSelector = (stage) => "[data-stage-header=" + Q + stage + Q + "]";
function headersExpr() {
  return "(function(){var hs=document.querySelectorAll(" + j("[data-stage-header]") + ");var out=[];for(var i=0;i<hs.length;i++){out.push(hs[i].getAttribute(" + j("data-stage-header") + "));}return out;})()";
}
/** 某分组里的任务行数（行 = 整行「点击查看任务详情」的 div）。 */
function rowsExpr(stage) {
  return "(function(){var h=document.querySelector(" + j(headerSelector(stage)) + ");if(h===null){return null;}var sec=h.closest(" + j("section") + ");return sec.querySelectorAll(" + j('[title="点击查看任务详情"]') + ").length;})()";
}
/** 分组头里「展开 / 折叠」箭头按钮的位置。 */
function arrowExpr(stage) {
  return "(function(){var h=document.querySelector(" + j(headerSelector(stage)) + ");if(h===null){return null;}var bs=h.querySelectorAll(" + j("button") + ");if(bs.length===0){return null;}bs[0].scrollIntoView({block:" + j("center") + "});var r=bs[0].getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()";
}
/** 「临时任务」组头里那枚组名胶囊（span）的位置与标签名。 */
function tempPillExpr() {
  return "(function(){var h=document.querySelector(" + j(headerSelector(TEMP_STAGE)) + ");if(h===null){return null;}var els=h.querySelectorAll(" + j("span") + ");for(var i=0;i<els.length;i++){if(els[i].textContent.trim()===" + j(TEMP_STAGE) + "&&els[i].querySelector(" + j("span") + ")===null){els[i].scrollIntoView({block:" + j("center") + "});var r=els[i].getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),tag:els[i].tagName};}}return null;})()";
}
/** 抽屉探针：标题 / 两个改名输入的当前值 / 阶段签 / 「开始 / 预计完成」行。 */
function drawerExpr() {
  return "(function(){var d=document.querySelector(" + j("aside[role=dialog]") + ");if(d===null){return null;}var h=d.querySelector(" + j("h2") + ");var cn=d.querySelector(" + j('input[aria-label="任务描述（中文）"]') + ");var en=d.querySelector(" + j('input[aria-label="任务描述（英文）"]') + ");var text=d.textContent||" + j("") + ";return {title:h===null?" + j("") + ":h.textContent.trim(),cn:cn===null?null:cn.value,en:en===null?null:en.value,temp:text.indexOf(" + j(TEMP_STAGE) + ")>=0,time:text.indexOf(" + j(CONFIRM) + ")>=0};})()";
}

// ---------- ① 项目总览：垫底「临时任务」分组 ----------
await openHash("");
await waitFor("document.querySelectorAll(" + j("[data-stage-header]") + ").length>=10");
const names0 = await ev(headersExpr());
check("项目总览：固定 10 组（九个施工阶段 + 垫底「临时任务」）", Array.isArray(names0) && names0.length === 10, Array.isArray(names0) ? names0.join(" / ") : String(names0));
check("项目总览：**最后一组**是「临时任务」（原「未分组」改名）", Array.isArray(names0) && names0[names0.length - 1] === TEMP_STAGE, Array.isArray(names0) ? String(names0[names0.length - 1]) : "—");
const tempHeaderProbe = await ev("(function(){var h=document.querySelector(" + j(headerSelector(TEMP_STAGE)) + ");if(h===null){return null;}return {role:h.getAttribute(" + j("role") + "),pill:h.querySelector(" + j("[data-stage-pill]") + ")===null?null:h.querySelector(" + j("[data-stage-pill]") + ").tagName,w:Math.round(h.getBoundingClientRect().width)};})()");
check("「临时任务」组头不是点击区（无 role=button，标签是普通胶囊不是阶段按钮）", tempHeaderProbe !== null && tempHeaderProbe.role === null && tempHeaderProbe.pill === null, JSON.stringify(tempHeaderProbe));
const pillCount = await ev("document.querySelectorAll(" + j("[data-stage-pill]") + ").length");
check("九个施工阶段的标签按钮照旧（9 枚，可点）", Number(pillCount) === 9, "pills=" + String(pillCount));
check("「临时任务」组开局 0 行（骨架分组，还没有临时任务）", Number(await ev(rowsExpr(TEMP_STAGE))) === 0, "rows=" + String(await ev(rowsExpr(TEMP_STAGE))));
check("夹具节点任务落在「设计开发」组（同一页 1 行）", Number(await ev(rowsExpr(DESIGN))) === 1, "rows=" + String(await ev(rowsExpr(DESIGN))));

// 点「临时任务」组名胶囊：什么都不发生（不弹卡片、不折叠、行数不变）
const tempPill = await ev(tempPillExpr());
const hitAtPill = tempPill === null ? "—" : String(await ev("(function(){var el=document.elementFromPoint(" + String(tempPill.x) + "," + String(tempPill.y) + ");if(el===null){return " + j("无") + ";}var b=el.closest(" + j("button") + ");return b===null?" + j("无按钮") + ":b.textContent;})()"));
check("「临时任务」胶囊不是按钮（真实坐标命中测试 → 无按钮）", tempPill !== null && tempPill.tag === "SPAN" && hitAtPill.indexOf("无按钮") >= 0, "hit=" + hitAtPill);
if (tempPill !== null) { await clickAt(tempPill); } else { check("「临时任务」胶囊定位失败（回放探针没找到组名胶囊）", false, "tempPill=null"); }
const cardAtTemp = await ev("document.querySelector(" + j("[aria-label=" + Q + TEMP_STAGE + "：任务节点与模板" + Q + "]") + ")!==null");
check("点「临时任务」胶囊：不弹「任务节点 + 模板」卡片（它不是施工阶段、没有节点可挑）", cardAtTemp === false, "card=" + String(cardAtTemp));
const rowsAfterTempClick = Number(await ev(rowsExpr(TEMP_STAGE)));
check("点「临时任务」胶囊：分组不折叠（仍 0 行但不报错、页面稳）", rowsAfterTempClick === 0, "rows=" + String(rowsAfterTempClick));

// 对照组：九个施工阶段的标签照旧能开 / 能关卡片
await clickSelector(headerSelector(DESIGN) + " [data-stage-pill]");
const cardOpen = await ev("document.querySelector(" + j("[aria-label=" + Q + DESIGN + "：任务节点与模板" + Q + "]") + ")!==null");
check("对照组：点「设计开发」标签 → 「任务节点 + 模板」卡片打开（原有口径不变）", cardOpen === true, "card=" + String(cardOpen));
await clickSelector(headerSelector(DESIGN) + " [data-stage-pill]");
const cardClosed = await ev("document.querySelector(" + j("[aria-label=" + Q + DESIGN + "：任务节点与模板" + Q + "]") + ")!==null");
check("对照组：再点一下 → 卡片关掉", cardClosed === false, "card=" + String(cardClosed));

// ---------- ② 看板「添加 → 临时任务」：建完直接开详情抽屉 ----------
await openHash("?view=progress");
await waitFor("document.querySelectorAll(" + j("[data-kanban-column]") + ").length>=5");
const columnCount = await ev("document.querySelectorAll(" + j("[data-kanban-column]") + ").length");
check("看板「任务进展」：5 列状态列（空列照样在）", Number(columnCount) === 5, "columns=" + String(columnCount));
const addSelector = "[data-kanban-column=" + Q + COLUMN + Q + "] " + "[aria-label=" + Q + "添加任务：" + COLUMN + Q + "]";
check("「" + COLUMN + "」列底有「添加」按钮", (await rectOf(addSelector)) !== null, addSelector);
await clickSelector(addSelector);
await waitFor("document.querySelector(" + j("[data-kanban-column=" + Q + COLUMN + Q + "] [role=menu]") + ")!==null");
const menuItems = await ev("(function(){var m=document.querySelector(" + j("[data-kanban-column=" + Q + COLUMN + Q + "] [role=menu]") + ");return m===null?null:m.textContent;})()");
check("点「添加」→ 菜单弹出（临时任务 / 阶段任务两个入口）", menuItems !== null && menuItems.indexOf("临时任务") >= 0 && menuItems.indexOf("阶段任务") >= 0, String(menuItems).slice(0, 60));
await clickSelector("[data-kanban-column=" + Q + COLUMN + Q + "] [role=menu] button");
await waitFor("document.querySelector(" + j("[data-kanban-column=" + Q + COLUMN + Q + "] form input") + ")!==null");
const formInputs = await ev("(function(){var f=document.querySelector(" + j("[data-kanban-column=" + Q + COLUMN + Q + "] form") + ");return f===null?null:f.querySelectorAll(" + j("input") + ").length;})()");
check("点「临时任务」→ 建任务表单弹出（中文必填 + 英文可留空两个输入）", Number(formInputs) === 2, "inputs=" + String(formInputs));
const tempName = "回放临时任务·" + stamp;
const tempNameEn = "Temp board task " + stamp;
const formCn = "[data-kanban-column=" + Q + COLUMN + Q + "] form input[placeholder=" + Q + "任务名称（必填）" + Q + "]";
const formEn = "[data-kanban-column=" + Q + COLUMN + Q + "] form input[placeholder=" + Q + "英文名（可留空）" + Q + "]";
await typeInto(formCn, tempName);
await typeInto(formEn, tempNameEn);
await clickSelector("[data-kanban-column=" + Q + COLUMN + Q + "] form button[type=submit]");
const drawerOpened = await waitFor("document.querySelector(" + j("aside[role=dialog]") + ")!==null", 15000);
check("③ 建完「临时任务」→ 详情抽屉**自动打开**（不用再点一次卡片）", drawerOpened === true, String(drawerOpened));
const drawer0 = await ev(drawerExpr());
check("抽屉标题 = 刚填的任务名（所见即所建）", drawer0 !== null && drawer0.title === tempName, drawer0 === null ? "no drawer" : String(drawer0.title));
check("抽屉里有「任务描述」两个改名输入（中文 / 英文）", drawer0 !== null && drawer0.cn === tempName && drawer0.en === tempNameEn, drawer0 === null ? "no drawer" : "cn=" + String(drawer0.cn) + " en=" + String(drawer0.en));
check("抽屉里能当场确认时间等细节（「" + CONFIRM + "」行在）", drawer0 !== null && drawer0.time === true, drawer0 === null ? "no drawer" : "time=" + String(drawer0.time));
check("抽屉阶段签显示「临时任务」（空阶段任务的展示名）", drawer0 !== null && drawer0.temp === true, drawer0 === null ? "no drawer" : "temp=" + String(drawer0.temp));

const listAfterCreate = await api("/api/v1/projects/" + projectId + "/tasks?limit=200");
const createdRow = listAfterCreate.json === null ? undefined : listAfterCreate.json.items.find((item) => item.title === tempName);
const tempTaskId = createdRow === undefined ? "" : createdRow.id;
check("服务端：临时任务已落库（stageKey = null → 归垫底「临时任务」组）", createdRow !== undefined && createdRow.stageKey === null, createdRow === undefined ? "not found" : "id=" + tempTaskId);

// ---------- ③ 抽屉里二次改名（失焦即存 / 留空还原 / 清空英文） ----------
const renamedCn = "回放临时任务改名·" + stamp;
await typeInto("aside[role=dialog] input[aria-label=" + Q + "任务描述（中文）" + Q + "]", renamedCn);
await blurDrawer();
const afterCn = await api("/api/v1/projects/" + projectId + "/tasks/" + tempTaskId);
check("改名（中文）失焦即存：服务端 title = 新名字", afterCn.status === 200 && afterCn.json !== null && afterCn.json.title === renamedCn, afterCn.status + " title=" + (afterCn.json === null ? "-" : String(afterCn.json.title)));
const drawerAfterCn = await ev(drawerExpr());
check("改名（中文）后抽屉标题同步（列表已刷新）", drawerAfterCn !== null && drawerAfterCn.title === renamedCn, drawerAfterCn === null ? "no drawer" : String(drawerAfterCn.title));

const renamedEn = "Temp renamed " + stamp;
await typeInto("aside[role=dialog] input[aria-label=" + Q + "任务描述（英文）" + Q + "]", renamedEn);
await blurDrawer();
const afterEn = await api("/api/v1/projects/" + projectId + "/tasks/" + tempTaskId);
check("改名（英文）失焦即存：服务端 titleEn = 新英文名", afterEn.status === 200 && afterEn.json !== null && afterEn.json.titleEn === renamedEn, afterEn.status + " titleEn=" + (afterEn.json === null ? "-" : String(afterEn.json.titleEn)));

await clearByKeyboard("aside[role=dialog] input[aria-label=" + Q + "任务描述（英文）" + Q + "]");
await blurDrawer();
const afterClearEn = await api("/api/v1/projects/" + projectId + "/tasks/" + tempTaskId);
check("英文名留空失焦：服务端 titleEn = null（清空）", afterClearEn.status === 200 && afterClearEn.json !== null && afterClearEn.json.titleEn === null, afterClearEn.status + " titleEn=" + (afterClearEn.json === null ? "-" : String(afterClearEn.json.titleEn)));

await clearByKeyboard("aside[role=dialog] input[aria-label=" + Q + "任务描述（中文）" + Q + "]");
await blurDrawer();
const afterClearCn = await api("/api/v1/projects/" + projectId + "/tasks/" + tempTaskId);
check("中文名留空失焦：不写库（服务端 title 仍是上一次改的名字）", afterClearCn.status === 200 && afterClearCn.json !== null && afterClearCn.json.title === renamedCn, afterClearCn.status + " title=" + (afterClearCn.json === null ? "-" : String(afterClearCn.json.title)));
const drawerRestored = await ev(drawerExpr());
check("中文名留空失焦：输入框自动还原成原值（红字提示不落库）", drawerRestored !== null && drawerRestored.cn === renamedCn, drawerRestored === null ? "no drawer" : String(drawerRestored.cn));

// ---------- ④ 节点来源任务：抽屉无改名行 + 服务端 400 兜底 ----------
await clickSelector("aside[role=dialog] [aria-label=" + Q + "关闭任务详情" + Q + "]");
await waitFor("document.querySelector(" + j("aside[role=dialog]") + ")===null");
await clickSelector("[aria-label=" + Q + "任务：" + nodeTitle + Q + "]");
const lockedDrawerOpened = await waitFor("document.querySelector(" + j("aside[role=dialog]") + ")!==null", 10000);
const lockedDrawer = await ev(drawerExpr());
check("节点来源任务的抽屉能正常打开（夹具就位）", lockedDrawerOpened === true && lockedDrawer !== null && lockedDrawer.title === nodeTitle, lockedDrawer === null ? "no drawer" : String(lockedDrawer.title));
check("节点来源任务的抽屉里**没有**改名行（cn / en 输入都不在）", lockedDrawer !== null && lockedDrawer.cn === null && lockedDrawer.en === null, lockedDrawer === null ? "no drawer" : "cn=" + String(lockedDrawer.cn) + " en=" + String(lockedDrawer.en));
const lockRow = await api("/api/v1/projects/" + projectId + "/tasks/" + lockedTaskId);
const lockedPatch = await api("/api/v1/projects/" + projectId + "/tasks/" + lockedTaskId, "PATCH", { version: lockRow.json.version, title: "想直接改名" });
check("服务端兜底：节点来源任务 PATCH title → 400 VALIDATION_FAILED（A1-17 锁定）", lockedPatch.status === 400 && lockedPatch.json !== null && lockedPatch.json.code === "VALIDATION_FAILED", lockedPatch.status + " " + lockedPatch.text.slice(0, 90));
const lockedPatchEn = await api("/api/v1/projects/" + projectId + "/tasks/" + lockedTaskId, "PATCH", { version: lockRow.json.version, titleEn: "try rename" });
check("服务端兜底：同口径 PATCH titleEn 也 400", lockedPatchEn.status === 400 && lockedPatchEn.json !== null && lockedPatchEn.json.code === "VALIDATION_FAILED", lockedPatchEn.status + " " + lockedPatchEn.text.slice(0, 90));
await clickSelector("aside[role=dialog] [aria-label=" + Q + "关闭任务详情" + Q + "]");
await waitFor("document.querySelector(" + j("aside[role=dialog]") + ")===null");

// ---------- ⑤ 项目总览垫底组同步改名后的名字 ----------
await openHash("");
await waitFor("document.querySelectorAll(" + j("[data-stage-header]") + ").length>=10");
const tempGroup = await ev("(function(){var h=document.querySelector(" + j(headerSelector(TEMP_STAGE)) + ");if(h===null){return null;}var sec=h.closest(" + j("section") + ");var rows=sec.querySelectorAll(" + j('[title="点击查看任务详情"]') + ");var text=" + j("") + ";for(var i=0;i<rows.length;i++){text+=(rows[i].textContent||" + j("") + ")+" + j(" | ") + ";}return {head:h.textContent,rows:rows.length,text:text};})()");
check("项目总览：垫底「临时任务」组出现 1 行、且是**改名后**的名字", tempGroup !== null && tempGroup.rows === 1 && tempGroup.text.indexOf(renamedCn) >= 0, tempGroup === null ? "no group" : "rows=" + String(tempGroup.rows) + " text=" + String(tempGroup.text).slice(0, 80));
check("项目总览：「临时任务」组头带「已完成 0/1」计数（有任务才显示）", tempGroup !== null && String(tempGroup.head).indexOf("已完成 0/1") >= 0, tempGroup === null ? "no group" : String(tempGroup.head));
check("项目总览：垫底组仍是最后一组（改名不会改变分组顺序）", Array.isArray(await ev(headersExpr())) && (await ev(headersExpr())).slice(-1)[0] === TEMP_STAGE, String((await ev(headersExpr())).slice(-1)[0]));

// ---------- 清理 ----------
const leftovers = (await api("/api/v1/projects/" + projectId + "/tasks?limit=200")).json.items;
let deleted = 0;
for (const item of leftovers) {
  const res = await api("/api/v1/projects/" + projectId + "/tasks/" + item.id, "DELETE", undefined, { "If-Match": String(item.version) });
  if (res.status === 200 || res.status === 204) deleted += 1;
}
check("清理：软删临时任务（临时任务 + 节点来源任务共 2 条）", deleted === leftovers.length && leftovers.length === 2, String(deleted) + "/" + String(leftovers.length));
const projNow = await api("/api/v1/projects/" + projectId);
const delProj = await api("/api/v1/projects/" + projectId, "DELETE", undefined, { "If-Match": String(projNow.json.version) });
check("清理：硬删临时项目（200 / 204）", delProj.status === 200 || delProj.status === 204, String(delProj.status));
const delNode = await api("/api/v1/task-nodes/" + nodeId, "DELETE");
check("清理：临时节点物理删（200 / 204）", delNode.status === 200 || delNode.status === 204, String(delNode.status));
await db.query("update sessions set revoked_at = now() where token_hash = $1", [sha256(token)]);
const residue = (await db.query("select (select count(*)::int from tasks where project_id = $1 and deleted_at is null) as tasks, (select count(*)::int from projects where id = $1) as projects, (select count(*)::int from task_nodes where id = $2) as nodes, (select count(*)::int from sessions where token_hash = $3 and revoked_at is null) as sessions", [projectId, nodeId, sha256(token)])).rows[0];
check("清理：任务 / 项目 / 节点 / 会话零残留", Number(residue.tasks) === 0 && Number(residue.projects) === 0 && Number(residue.nodes) === 0 && Number(residue.sessions) === 0, JSON.stringify(residue));

// ---------- 收尾 ----------
const failed = checks.filter((item) => item.ok !== true).length;
console.log("—— 合计 " + String(checks.length) + " 项：" + String(checks.length - failed) + " 通过 / " + String(failed) + " 失败 ——");
try { page.ws.close(); } catch (error) { /* 忽略 */ }
chrome.kill();
await db.end();
process.exit(failed === 0 ? 0 : 1);
