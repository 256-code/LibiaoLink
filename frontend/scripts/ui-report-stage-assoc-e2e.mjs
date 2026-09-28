#!/usr/bin/env node
/**
 * LibiaoLink 前端 · 回放：日报「关联任务 → 关联阶段」（业务口径 2026-09-28 · Push 198）
 *
 * 业务口径：「日报这里关联任务改成关联阶段」——「日报填写」表单的「关联任务」多选（原列项目现有任务 + 负责人）
 * 改为「关联阶段」多选：选项 = 九个施工阶段（与项目总览分组 / 两块看板同一份口径、固定顺序 售前规划 → 验收），
 * 不再列具体任务；「日报记录」列头同步 = 「关联阶段」。
 * 本脚本用**真实鼠标 / 真实键盘**（CDP Input，不是合成 click()）在真机浏览器上验五组事：
 *   ① 项目详情「日报及问题 → 日报填写」：字段标题 = 「关联阶段」，说明不再提「关联任务 / 回写」；
 *   ② 多选项 = 恰好九枚（顺序 = 售前规划 / 设计开发 / 加工采购 / 组装发货 / 硬件实施 / 软件部署 / 试运行 / 生产阶段 / 验收），
 *      **不再列任务名**（对照组：真实项目任务「布局定档」不出现在表单里）；
 *   ③ 真实鼠标勾选「硬件实施」「试运行」→ 填「当日完成工作」→ 点「提交日报」：自动切到「日报记录」；
 *   ④ 「日报记录」表头 = 「关联阶段」（不再「关联任务」）；最新一行关联阶段列 = 「硬件实施、试运行」、状态 = 已提交；
 *   ⑤ 回「日报填写」表单已复位（勾选清零 / 完成工作清空）；跑完零残留（撤销临时会话；日报仍是内存态 —— 库内 daily_reports 不增行）。
 *
 * 前置（四件都在本机跑着）：
 *   1. 前端 dev：cd frontend && npm run dev（默认 3000）
 *   2. api：cd server && npm run start:api（默认 3001）
 *   3. 数据库：本地沙箱 PG（默认 127.0.0.1:5433/libiaolink）
 *   4. 本机装了 Chrome（脚本 headless 起一个调试实例；路径可用 CHROME_PATH 覆盖）
 *
 * 用法：node scripts/ui-report-stage-assoc-e2e.mjs
 *   可覆盖的环境变量：FRONTEND_BASE / API_BASE / DATABASE_URL / CHROME_PATH / CDP_PORT / REPLAY_USER / REPLAY_PROJECT / PG_MODULE
 *
 * 夹具：一条**临时会话**（跑完撤销）+ 真实英国项目（回放用户 = 项目经理，**只读**打开；日报提交是内存态、不落库）。
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
const PORT = Number(process.env.CDP_PORT ?? 9403);
const DB = process.env.DATABASE_URL ?? "postgres://libiaolink_api@127.0.0.1:5433/libiaolink";
const REPLAY_USER = process.env.REPLAY_USER ?? "panxing";
const PROJECT_ID = process.env.REPLAY_PROJECT ?? "5a127946-526e-43be-8ff6-3b8d356ba70a";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const Q = String.fromCharCode(34);
const j = (value) => JSON.stringify(value);
const STAGES = ["售前规划", "设计开发", "加工采购", "组装发货", "硬件实施", "软件部署", "试运行", "生产阶段", "验收"];
const PICK = ["硬件实施", "试运行"];
const NOT_A_STAGE = "布局定档";
const DONE_TEXT = "回放·关联阶段·" + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");

const db = new Client({ connectionString: DB });
await db.connect();
const userRow = (await db.query("select id, username, display_name from users where username = $1", [REPLAY_USER])).rows[0];
if (userRow === undefined) {
  console.error("回放用户不存在：" + REPLAY_USER);
  process.exit(1);
}
const token = "pxstage-" + randomBytes(16).toString("hex");
const csrf = randomBytes(16).toString("hex");
await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(mins => 30))", [sha256(token), userRow.id, "px-report-stage-e2e"]);
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
const ev = async (expression) => {
  const reply = await page.send("Runtime.evaluate", { expression, returnByValue: true });
  if (reply.exceptionDetails !== undefined) {
    throw new Error("页面表达式抛异常：" + JSON.stringify(reply.exceptionDetails).slice(0, 300) + " | 表达式：" + expression.slice(0, 160));
  }
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
async function openHash(hashPath) {
  await page.send("Page.navigate", { url: "about:blank" });
  await sleep(500);
  await page.send("Page.navigate", { url: FRONTEND + "/#/project/" + PROJECT_ID + hashPath });
  await sleep(5200);
}
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
    " return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }; })()"
  );
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
  await sleep(350);
}
async function typeInto(selector, text) {
  await clickSelector(selector);
  await pressKey("a", "KeyA", 65, 2);
  await page.send("Input.insertText", { text });
  await sleep(500);
}
/** 表单内某枚阶段 checkbox 的标签中心（真实鼠标点标签 = 勾选）。 */
async function clickStageLabel(text) {
  const point = await ev(
    "(function(){var box=document.querySelector(" + j('[data-field="stages"]') + ");if(box===null){return null;}" +
    "var ls=box.querySelectorAll(" + j("label") + ");for(var i=0;i<ls.length;i++){if(ls[i].textContent.trim()===" + j(text) + "){" +
    "ls[i].scrollIntoView({block:" + j("center") + "});var r=ls[i].getBoundingClientRect();" +
    "return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};}}return null;})()"
  );
  if (point === null || point === undefined) throw new Error("点不到阶段标签：" + text);
  await clickAt(point);
}
/** 表单探针：字段标题 / 说明 / 选项清单 / 勾选数。 */
function formExpr() {
  return "(function(){var f=document.querySelector(" + j("[data-fill-form]") + ");if(f===null){return null;}" +
    "var box=f.querySelector(" + j('[data-field="stages"]') + ");var inputs=box===null?[]:box.querySelectorAll(" + j('input[type=checkbox]') + ");" +
    "var labels=[];var checked=0;for(var i=0;i<inputs.length;i++){if(inputs[i].checked){checked++;}" +
    "var row=inputs[i].closest(" + j("label") + ");labels.push(row===null?" + j("") + ":row.textContent.trim());}" +
    "return {text:(f.textContent||" + j("") + "),hasBox:box!==null,count:inputs.length,labels:labels,checked:checked};})()";
}

// ---------- ① 打开「日报及问题 → 日报填写」 ----------
await openHash("?view=daily");
const subnavReady = await waitFor("document.querySelectorAll(" + j("[data-subnav-item]") + ").length===4");
check("① 项目详情「日报及问题」打开：页内四键帽导航（日报填写 / 日报记录 / 问题追踪 / 问题看板）", subnavReady === true, String(subnavReady));
const formReady = await waitFor("document.querySelector(" + j("[data-fill-form]") + ")!==null");
const form0 = await ev(formExpr());
check("① 「日报填写」表单就位（默认停在第一块）", formReady === true && form0 !== null, form0 === null ? "no form" : "ok");

// ---------- ② 字段标题 / 说明 / 选项口径 ----------
check("② 字段标题 = 「关联阶段」", form0 !== null && form0.text.indexOf("关联阶段") >= 0, form0 === null ? "-" : String(form0.text.indexOf("关联阶段")));
check("② 表单不再出现「关联任务」（词已随口径移除）", form0 !== null && form0.text.indexOf("关联任务") < 0, form0 === null ? "-" : "index=" + String(form0.text.indexOf("关联任务")));
check("② 说明不再提「回写任务「项目进展描述」」", form0 !== null && form0.text.indexOf("回写") < 0, form0 === null ? "-" : "index=" + String(form0.text.indexOf("回写")));
check("② 多选项容器 [data-field=stages] 就位", form0 !== null && form0.hasBox === true, form0 === null ? "-" : String(form0.hasBox));
const labels0 = form0 === null ? [] : form0.labels;
check("② 选项 = 恰好九枚、顺序 = 售前规划 → 验收（九阶段口径）", labels0.length === 9 && STAGES.every((name, index) => labels0[index] === name), labels0.join(" / "));
check("② 选项**不再列任务名**（对照组：真实任务「" + NOT_A_STAGE + "」不在表单里）", form0 !== null && form0.labels.indexOf(NOT_A_STAGE) < 0 && form0.text.indexOf(NOT_A_STAGE) < 0, "labels=" + String(labels0.length));
check("② 开局 0 勾选", form0 !== null && form0.checked === 0, form0 === null ? "-" : "checked=" + String(form0.checked));

// ---------- ③ 真实鼠标勾选 + 填完成工作 + 提交 ----------
await clickStageLabel(PICK[0]);
await clickStageLabel(PICK[1]);
const form1 = await ev(formExpr());
check("③ 真实鼠标勾选「" + PICK[0] + "」「" + PICK[1] + "」→ 2 勾选", form1 !== null && form1.checked === 2, form1 === null ? "-" : "checked=" + String(form1.checked));
await typeInto('[data-fill-form] textarea[data-field="doneWork"]', DONE_TEXT);
const submitEnabled = await ev("(function(){var b=document.querySelector(" + j('[data-fill-form] button[data-action="submit"]') + ");return b===null?null:b.disabled===false;})()");
check("③ 填「当日完成工作」后「提交日报」可点（必填齐）", submitEnabled === true, String(submitEnabled));
await clickSelector('[data-fill-form] button[data-action="submit"]');
const switched = await waitFor("(function(){var b=document.querySelector(" + j('[data-subnav-item="日报记录"]') + ");return b!==null && b.getAttribute(" + j("aria-current") + ")===" + j("page") + ";})()");
check("③ 提交后自动切到「日报记录」子视图", switched === true, String(switched));

// ---------- ④ 日报记录：列头 / 最新一行 ----------
const headers = await ev(
  "(function(){var ts=document.querySelectorAll(" + j("table") + ");for(var i=0;i<ts.length;i++){" +
  "var hs=ts[i].querySelectorAll(" + j("thead th") + ");var out=[];for(var k=0;k<hs.length;k++){out.push(hs[k].textContent.trim());}" +
  "if(out.indexOf(" + j("关联阶段") + ")>=0||out.indexOf(" + j("关联任务") + ")>=0){return out;}}return null;})()"
);
check("④ 日报记录表头含「关联阶段」", Array.isArray(headers) && headers.indexOf("关联阶段") >= 0, Array.isArray(headers) ? headers.join(" / ") : String(headers));
check("④ 日报记录表头不再有「关联任务」", Array.isArray(headers) && headers.indexOf("关联任务") < 0, Array.isArray(headers) ? "ok" : "-");
const rowProbe = await ev(
  "(function(){var r=document.querySelector(" + j("[data-report-row]") + ");if(r===null){return null;}" +
  "var tds=r.querySelectorAll(" + j("td") + ");return {id:r.getAttribute(" + j("data-report-row") + ")," +
  "stage:tds[3]===undefined?" + j("") + ":tds[3].textContent.trim(),done:tds[4]===undefined?" + j("") + ":tds[4].textContent.trim(),state:(r.textContent||" + j("") + ")};})()"
);
check("④ 最新一行关联阶段列 = 「" + PICK[0] + "、" + PICK[1] + "」", rowProbe !== null && rowProbe.stage === PICK[0] + "、" + PICK[1], rowProbe === null ? "-" : String(rowProbe.stage));
check("④ 最新一行「当日完成工作」= 回放文本", rowProbe !== null && rowProbe.done === DONE_TEXT, rowProbe === null ? "-" : String(rowProbe.done));
check("④ 最新一行状态 = 已提交", rowProbe !== null && rowProbe.state.indexOf("已提交") >= 0, rowProbe === null ? "-" : "ok");

// ---------- ⑤ 回「日报填写」表单复位 ----------
await clickSelector('[data-subnav-item="日报填写"]');
const backReady = await waitFor("document.querySelector(" + j("[data-fill-form]") + ")!==null");
const form2 = await ev(formExpr());
check("⑤ 回「日报填写」：表单复位（勾选 0 / 完成工作清空）", backReady === true && form2 !== null && form2.checked === 0 && form2.text.indexOf(DONE_TEXT) < 0, form2 === null ? "-" : "checked=" + String(form2.checked));

// ---------- 清理 ----------
await db.query("update sessions set revoked_at = now() where token_hash = $1", [sha256(token)]);
const residue = (await db.query(
  "select (select count(*)::int from sessions where token_hash = $1 and revoked_at is null) as sessions," +
  " (select count(*)::int from daily_reports where project_id = $2) as reports," +
  " (select count(*)::int from projects where id = $2) as projects",
  [sha256(token), PROJECT_ID]
)).rows[0];
check("清理：临时会话撤销 + 零残留（日报仍是内存态：daily_reports 0 行、项目 1 行照旧）",
  Number(residue.sessions) === 0 && Number(residue.reports) === 0 && Number(residue.projects) === 1, JSON.stringify(residue));

// ---------- 收尾 ----------
const failed = checks.filter((item) => item.ok !== true).length;
console.log("—— 合计 " + String(checks.length) + " 项：" + String(checks.length - failed) + " 通过 / " + String(failed) + " 失败 ——");
try { page.ws.close(); } catch (error) { /* 忽略 */ }
chrome.kill();
await db.end();
process.exit(failed === 0 ? 0 : 1);
