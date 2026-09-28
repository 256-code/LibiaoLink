#!/usr/bin/env node
/**
 * LibiaoLink 前端 · 回放：临时任务「建完直接开详情抽屉 / 名字二次更改 / 常驻新建入口（任务表分组头；阶段卡片那份 Push 207 已撤）」（业务口径 2026-09-28 · Push 196 / Push 197 / Push 207）
 *
 * 业务口径：「临时任务 添加完 应直接跳转到详情页面人后确认时间等细节 并且临时任务的名字应可以二次更改；
 *            设计同步到项目总览的最下方 新增一个分组叫临时任务」（Push 196）；
 *            「这个不是临时任务 不能修改啊 现在可以修改 是bug；项目模板临时任务常驻吧…不要添加后再显示 直接和其它任务一样常驻，
 *             但是没有模板 点击后直接新建即可填写任务名称」（Push 197）。
 * 本脚本用**真实鼠标 / 真实键盘**（CDP Input，不是合成 click()）在真机浏览器上验九组事：
 *   ① 项目总览的**最后一组**是「临时任务」：与九个施工阶段一样常驻（骨架分组）；组名胶囊是**按钮**（data-temp-task-pill）——
 *      点它**不弹**「任务节点 + 模板」卡片（它不是施工阶段），而是直接出「新建临时任务」表单；再点收起；九个阶段标签照旧 9 枚可点（对照组：设计开发能开能关）；
 *   ② 看板「任务进展 → 待开始」列底「添加 → 临时任务」：填名点「创建」后**详情抽屉自动打开**（不用再点一次卡片），
 *      抽屉里能当场确认「开始 / 预计完成」等时间细节；
 *   ③ 抽屉里给临时任务**二次改名**：中文 / 英文失焦即存、英文留空 = 清空（契约 null）、中文留空 = 自动还原不写库；
 *   ④ 节点来源任务（sourceNodeId）的抽屉**没有**改名行；服务端同口径兜底 —— PATCH title / titleEn 均 400 VALIDATION_FAILED；
 *   ⑤ 改完名字项目总览垫底「临时任务」组同步新名字（组头带「已完成 0/1」计数）；
 *   ⑥ 任务表底部「临时任务」分组头常驻入口：点开表单直接新建（没有模板、自己填名称）→ 建完详情抽屉自动打开、落库 stageKey = null；
 *   ⑦ 阶段添加卡片（「XX：任务节点与模板」；总览点阶段标签与看板「添加 → 阶段任务」两条路径同一张卡）里**不再有**
 *      「临时任务」入口（Push 207 · 业务口径「临时任务不应该存在于阶段里面新建」—— Push 197 常驻入口下架）：
 *      卡片内 [data-temp-task-entry] / [data-temp-task-form] 全空、也不出现「没有模板」字样；节点行照常（对照组）；
 *   ⑧ 阶段任务（stageKey 非空）即便没有来源节点也**锁定改名**（Push 197 收窄 · 业务口径「这个不是临时任务 不能修改」）：
 *      抽屉无改名行 + 服务端 PATCH title / titleEn 均 400；
 *   ⑨ 跑完零残留（软删任务 / 硬删项目 / 物理删节点 / 撤销会话）。
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
 *      一条挂在节点上的任务（验「节点来源不可改名」）+ 一条阶段任务（无来源节点，验「阶段任务同样锁定」）+
 *      看板列底 / 任务表分组头**两条入口**各现建一条临时任务（阶段卡片那份入口 Push 207 已下架、改为反向断言），跑完零残留。
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
/** Push 197 夹具：阶段任务（stageKey = design）但**没有来源节点** —— 它归属一个施工阶段，不是「临时任务」，同样锁定改名。 */
const stagedName = "回放·阶段任务·" + stamp;
const stagedRes = await api("/api/v1/projects/" + projectId + "/tasks", "POST", { stageKey: "design", title: stagedName, titleEn: null });
check("夹具：设计阶段一条无来源节点的阶段任务（201，后面验「阶段任务也锁定」）", stagedRes.status === 201 && stagedRes.json !== null, String(stagedRes.status) + " " + stagedRes.text.slice(0, 120));
const stagedTaskId = stagedRes.json === null ? "" : stagedRes.json.id;

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
/** 在容器里按「按钮文字以 text 开头」找一个按钮点它（真实鼠标）：「添加 → 阶段任务」菜单、阶段选择菜单用。 */
async function clickTextIn(containerSelector, text) {
  const point = await ev(
    "(function(){var c=document.querySelector(" + j(containerSelector) + ");if(c===null){return null;}" +
    "var bs=c.querySelectorAll(" + j("button") + ");for(var i=0;i<bs.length;i++){if((bs[i].textContent||" + j("") + ").trim().indexOf(" + j(text) + ")===0){" +
    "bs[i].scrollIntoView({block:" + j("center") + "});var r=bs[i].getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};}}return null;})()"
  );
  if (point === null || point === undefined) { throw new Error("点不到（按文字找不到按钮）：" + containerSelector + " → " + text); }
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
const tempHeaderProbe = await ev("(function(){var h=document.querySelector(" + j(headerSelector(TEMP_STAGE)) + ");if(h===null){return null;}var pill=h.querySelector(" + j("[data-temp-task-pill]") + ");return {role:h.getAttribute(" + j("role") + "),pill:pill===null?null:pill.tagName,stagePill:h.querySelector(" + j("[data-stage-pill]") + ")===null?null:h.querySelector(" + j("[data-stage-pill]") + ").tagName,w:Math.round(h.getBoundingClientRect().width)};})()");
check("「临时任务」组头常驻 + 组名胶囊是按钮（data-temp-task-pill；不是阶段标签 data-stage-pill）", tempHeaderProbe !== null && tempHeaderProbe.role === null && tempHeaderProbe.pill === "BUTTON" && tempHeaderProbe.stagePill === null, JSON.stringify(tempHeaderProbe));
const pillCount = await ev("document.querySelectorAll(" + j("[data-stage-pill]") + ").length");
check("九个施工阶段的标签按钮照旧（9 枚，可点）", Number(pillCount) === 9, "pills=" + String(pillCount));
check("「临时任务」组开局 0 行（骨架分组，还没有临时任务）", Number(await ev(rowsExpr(TEMP_STAGE))) === 0, "rows=" + String(await ev(rowsExpr(TEMP_STAGE))));
check("夹具任务落在「设计开发」组（同一页 2 行：节点来源任务 + 阶段任务）", Number(await ev(rowsExpr(DESIGN))) === 2, "rows=" + String(await ev(rowsExpr(DESIGN))));

// 点「临时任务」组名按钮（Push 197）：不弹「任务节点 + 模板」卡片，直接出「新建临时任务」表单；再点一下收起
const tempPill = await rectOf("[data-temp-task-pill]");
const hitAtPill = tempPill === null ? "—" : String(await ev("(function(){var el=document.elementFromPoint(" + String(tempPill.x) + "," + String(tempPill.y) + ");if(el===null){return " + j("无") + ";}var b=el.closest(" + j("[data-temp-task-pill]") + ");return b===null?" + j("不是按钮") + ":b.getAttribute(" + j("aria-label") + ");})()"));
check("点前命中测试：组名胶囊确实是按钮（aria-label = 添加任务：临时任务）", tempPill !== null && hitAtPill.indexOf("添加任务：临时任务") >= 0, "hit=" + hitAtPill);
if (tempPill !== null) { await clickAt(tempPill); } else { check("「临时任务」胶囊定位失败（回放探针没找到组名按钮）", false, "tempPill=null"); }
const tempFormOpened = await waitFor("document.querySelector(" + j("[data-temp-task-form]") + ")!==null", 5000);
check("点「临时任务」组名 → 直接出「新建临时任务」表单（data-temp-task-form；没有模板、自己填名称）", tempFormOpened === true, String(tempFormOpened));
const cardAtTemp = await ev("document.querySelector(" + j("[aria-label=" + Q + TEMP_STAGE + "：任务节点与模板" + Q + "]") + ")!==null");
check("点「临时任务」组名：不弹「任务节点 + 模板」卡片（它不是施工阶段、没有节点可挑）", cardAtTemp === false, "card=" + String(cardAtTemp));
const rowsAfterTempClick = Number(await ev(rowsExpr(TEMP_STAGE)));
check("点「临时任务」组名：只出表单、分组不折叠（仍 0 行）", rowsAfterTempClick === 0, "rows=" + String(rowsAfterTempClick));
if (tempPill !== null) { await clickAt(tempPill); }
const tempFormClosed = await waitFor("document.querySelector(" + j("[data-temp-task-form]") + ")===null", 5000);
check("再点一下组名 → 表单收起（开 / 关同一枚按钮）", tempFormClosed === true, String(tempFormClosed));

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
check("② 建完「临时任务」→ 详情抽屉**自动打开**（不用再点一次卡片）", drawerOpened === true, String(drawerOpened));
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

// ---------- ⑥ 任务表底部「临时任务」分组头常驻入口：点开表单直接新建 → 建完开详情抽屉 ----------
await waitFor("document.querySelector(" + j("[data-temp-task-pill]") + ")!==null", 8000);
await clickSelector("[data-temp-task-pill]");
const residentDialog = "[role=dialog][aria-label=" + Q + TEMP_STAGE + "：新建" + Q + "]";
const residentFormOpened = await waitFor("document.querySelector(" + j(residentDialog) + ")!==null", 5000);
check("⑥ 底部「临时任务」分组头常驻入口：点开直接出「新建临时任务」表单（没有模板、自己填名称）", residentFormOpened === true, String(residentFormOpened));
const boardTempName = "回放常驻入口·分组头·" + stamp;
const boardTempNameEn = "Temp resident header " + stamp;
await typeInto(residentDialog + " [data-temp-task-form] input[aria-label=" + Q + "临时任务名称（中文）" + Q + "]", boardTempName);
await typeInto(residentDialog + " [data-temp-task-form] input[aria-label=" + Q + "临时任务名称（英文）" + Q + "]", boardTempNameEn);
await clickSelector(residentDialog + " [data-temp-task-form] button[type=submit]");
const residentDrawerOpened = await waitFor("(function(){var d=document.querySelector(" + j("aside[role=dialog]") + ");if(d===null){return false;}var h=d.querySelector(" + j("h2") + ");return h!==null && h.textContent.trim()===" + j(boardTempName) + ";})()", 15000);
check("⑥ 建完 → 详情抽屉**自动打开**、标题 = 刚填的任务名（直接补时间等细节）", residentDrawerOpened === true, String(residentDrawerOpened));
const listAfterResident = await api("/api/v1/projects/" + projectId + "/tasks?limit=200");
const residentRow = listAfterResident.json === null ? undefined : listAfterResident.json.items.find((item) => item.title === boardTempName);
const residentTempId = residentRow === undefined ? "" : residentRow.id;
check("⑥ 服务端：分组头入口建的临时任务已落库（stageKey = null、英文名同步）", residentRow !== undefined && residentRow.stageKey === null && residentRow.titleEn === boardTempNameEn, residentRow === undefined ? "not found" : "id=" + residentTempId);
await clickSelector("aside[role=dialog] [aria-label=" + Q + "关闭任务详情" + Q + "]");
await waitFor("document.querySelector(" + j("aside[role=dialog]") + ")===null");

// ---------- ⑦ 阶段添加卡片（任务节点与模板）里**不再有**「临时任务」入口（Push 207 · 业务口径 2026-09-28
//   「临时任务不应该存在于阶段里面新建」—— Push 197 复落的常驻入口整体下架；节点 / 模板两类来源照常） ----------
await clickSelector(headerSelector(DESIGN) + " [data-stage-pill]");
const designCardOpen2 = await waitFor("document.querySelector(" + j("[aria-label=" + Q + DESIGN + "：任务节点与模板" + Q + "]") + ")!==null", 8000);
const cardTempProbe = await ev("(function(){var c=document.querySelector(" + j("[aria-label=" + Q + DESIGN + "：任务节点与模板" + Q + "]") + ");if(c===null){return null;}var lis=c.querySelectorAll(" + j("ul li") + ");return {entry:c.querySelector(" + j("[data-temp-task-entry]") + ")!==null,form:c.querySelector(" + j("[data-temp-task-form]") + ")!==null,hasWords:(c.textContent||" + j("") + ").indexOf(" + j("没有模板") + ")>=0,rows:lis.length};})()");
check("⑦ 「设计开发：任务节点与模板」卡片里**不再有**「临时任务」入口（业务口径「临时任务不应该存在于阶段里面新建」· Push 197 常驻入口下架）",
  designCardOpen2 === true && cardTempProbe !== null && cardTempProbe.entry === false && cardTempProbe.form === false && cardTempProbe.hasWords === false,
  cardTempProbe === null ? "-" : JSON.stringify({ entry: cardTempProbe.entry, form: cardTempProbe.form, words: cardTempProbe.hasWords }));
check("⑦ 对照组：卡片本体照常（「任务节点」列表仍有节点行 —— 下架入口不误伤节点 / 模板两类来源）",
  cardTempProbe !== null && Number(cardTempProbe.rows) > 0, cardTempProbe === null ? "-" : "rows=" + String(cardTempProbe.rows));
await clickSelector("[aria-label=" + Q + DESIGN + "：任务节点与模板" + Q + "] [aria-label=" + Q + "关闭" + Q + "]");
const designCardClosed2 = await waitFor("document.querySelector(" + j("[aria-label=" + Q + DESIGN + "：任务节点与模板" + Q + "]") + ")===null", 8000);
check("⑦ 卡片右上 × 关卡片照常（入口撤了、卡片本体与关闭链路不变）", designCardClosed2 === true, String(designCardClosed2));

// ---------- ⑦b 看板「添加 → 阶段任务」的同一张「任务节点与模板」卡片里也常驻这条入口（同组件、同收尾口径） ----------
// 切到「任务进展」看板（顺带为 ⑧ 的卡片探针就位）：总览表格行没有 aria-label，卡片的「任务：…」才是回放探针
await openHash("?view=progress");
await waitFor("document.querySelectorAll(" + j("[data-kanban-column]") + ").length>=5");
const addMenu = "[data-kanban-column=" + Q + COLUMN + Q + "] [role=menu][aria-label=" + Q + "添加任务：" + COLUMN + Q + "]";
await clickSelector("[data-kanban-column=" + Q + COLUMN + Q + "] [aria-label=" + Q + "添加任务：" + COLUMN + Q + "]");
await waitFor("document.querySelector(" + j(addMenu) + ")!==null", 5000);
await clickTextIn(addMenu, "阶段任务");
const stagePicker = "[role=menu][aria-label=" + Q + "选择阶段：" + COLUMN + Q + "]";
const pickerOpened = await waitFor("document.querySelector(" + j(stagePicker) + ")!==null", 5000);
check("⑦b 看板「添加 → 阶段任务」→ 先出「选择阶段」菜单（原有口径不变）", pickerOpened === true, String(pickerOpened));
await clickTextIn(stagePicker, DESIGN);
const kanbanCardOpen = await waitFor("document.querySelector(" + j("[aria-label=" + Q + DESIGN + "：任务节点与模板" + Q + "]") + ")!==null", 8000);
const kanbanTempProbe = await ev("(function(){var c=document.querySelector(" + j("[aria-label=" + Q + DESIGN + "：任务节点与模板" + Q + "]") + ");if(c===null){return null;}return {entry:c.querySelector(" + j("[data-temp-task-entry]") + ")!==null,form:c.querySelector(" + j("[data-temp-task-form]") + ")!==null};})()");
check("⑦b 看板这条「阶段任务」路径打开的同一张卡片里同样**没有**「临时任务」入口（看板列底「添加 → 临时任务」不受影响）",
  kanbanCardOpen === true && kanbanTempProbe !== null && kanbanTempProbe.entry === false && kanbanTempProbe.form === false,
  kanbanTempProbe === null ? "-" : JSON.stringify(kanbanTempProbe));
await clickSelector("[aria-label=" + Q + DESIGN + "：任务节点与模板" + Q + "] [aria-label=" + Q + "关闭" + Q + "]");
const kanbanCardClosed = await waitFor("document.querySelector(" + j("[aria-label=" + Q + DESIGN + "：任务节点与模板" + Q + "]") + ")===null", 8000);
check("⑦b 关卡片照常（× 收起，随后 ⑧ 的抽屉探针就位）", kanbanCardClosed === true, String(kanbanCardClosed));

// ---------- ⑧ 阶段任务（stageKey 非空）也锁定改名：抽屉无改名行 + 服务端 400 兜底（Push 197 收窄） ----------
// 夹具那条阶段任务挂在「设计开发」组：就在这块看板上（上面已切过来），点它的卡片开抽屉
await waitFor("document.querySelector(" + j("[aria-label=" + Q + "任务：" + stagedName + Q + "]") + ")!==null", 8000);
await clickSelector("[aria-label=" + Q + "任务：" + stagedName + Q + "]");
const stagedDrawerOpened = await waitFor("document.querySelector(" + j("aside[role=dialog]") + ")!==null", 10000);
const stagedDrawer = await ev(drawerExpr());
check("⑧ 阶段任务的抽屉能正常打开（夹具就位）", stagedDrawerOpened === true && stagedDrawer !== null && stagedDrawer.title === stagedName, stagedDrawer === null ? "no drawer" : String(stagedDrawer.title));
check("⑧ 阶段任务的抽屉里**没有**改名行（它归属施工阶段、不是可改名的「临时任务」）", stagedDrawer !== null && stagedDrawer.cn === null && stagedDrawer.en === null, stagedDrawer === null ? "no drawer" : "cn=" + String(stagedDrawer.cn) + " en=" + String(stagedDrawer.en));
const stagedRow = await api("/api/v1/projects/" + projectId + "/tasks/" + stagedTaskId);
const stagedPatch = await api("/api/v1/projects/" + projectId + "/tasks/" + stagedTaskId, "PATCH", { version: stagedRow.json.version, title: "想改名（阶段任务）" });
check("⑧ 服务端兜底：阶段任务 PATCH title → 400 VALIDATION_FAILED（不再「双空即可改」）", stagedPatch.status === 400 && stagedPatch.json !== null && stagedPatch.json.code === "VALIDATION_FAILED", stagedPatch.status + " " + stagedPatch.text.slice(0, 90));
const stagedPatchEn = await api("/api/v1/projects/" + projectId + "/tasks/" + stagedTaskId, "PATCH", { version: stagedRow.json.version, titleEn: "try rename staged" });
check("⑧ 服务端兜底：同口径 PATCH titleEn 也 400", stagedPatchEn.status === 400 && stagedPatchEn.json !== null && stagedPatchEn.json.code === "VALIDATION_FAILED", stagedPatchEn.status + " " + stagedPatchEn.text.slice(0, 90));
const stagedAfter = await api("/api/v1/projects/" + projectId + "/tasks/" + stagedTaskId);
check("⑧ 两发 400 都没写库（阶段任务 title / titleEn 保持原值）", stagedAfter.json !== null && stagedAfter.json.title === stagedName && stagedAfter.json.titleEn === null, stagedAfter.json === null ? "-" : "title=" + String(stagedAfter.json.title) + " titleEn=" + String(stagedAfter.json.titleEn));
await clickSelector("aside[role=dialog] [aria-label=" + Q + "关闭任务详情" + Q + "]");
await waitFor("document.querySelector(" + j("aside[role=dialog]") + ")===null");

// ---------- 清理 ----------
const leftovers = (await api("/api/v1/projects/" + projectId + "/tasks?limit=200")).json.items;
let deleted = 0;
for (const item of leftovers) {
  const res = await api("/api/v1/projects/" + projectId + "/tasks/" + item.id, "DELETE", undefined, { "If-Match": String(item.version) });
  if (res.status === 200 || res.status === 204) deleted += 1;
}
check("清理：软删本轮全部任务（临时任务 2 条：看板列底 + 分组头；节点来源任务 + 阶段任务 —— 共 4 条 · 阶段卡片那份入口 Push 207 已撤）", deleted === leftovers.length && leftovers.length === 4, String(deleted) + "/" + String(leftovers.length));
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
