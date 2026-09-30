#!/usr/bin/env node
/**
 * LibiaoLink 前端 · 回放：工作台「我的任务」页（Push 230 · M6-06 前端接线 · A6-01 / A6-03）
 *
 * 业务口径（2026-09-30）：「改成 我提出的问题」「同样做标签导航栏 我的任务 我提出的问题先做这两个」
 *   「我的任务 是折叠面板 未展开是项目名称和编号 下拉是具体我的任务」「我提出的问题就参考日报的问题追踪即可
 *   也是折叠面板」「开始做前端」「表格内容要全」「直接把这个搬到我的任务不就好了」（任务表行口径照项目页任务表搬）。
 *
 * 前置（三件都在本机跑着）：
 *   1. 前端 dev：cd frontend && npm run dev（默认 3000）
 *   2. api：cd server && npm run start:api（默认 3001）
 *   3. 数据库：本地沙箱 PG（默认 127.0.0.1:5433/libiaolink）
 *   4. 本机装了 Chrome（脚本 headless 起一个调试实例；路径可用 CHROME_PATH 覆盖）
 *
 * 用法：node scripts/m6-06-workspace-e2e.mjs
 *   可覆盖的环境变量：FRONTEND_BASE / API_BASE / DATABASE_URL / CHROME_PATH / CDP_PORT / REPLAY_USER / PG_MODULE
 *
 * 它做什么：用**两条临时会话**（panxing = 我；wmj = 反例提出人；跑完撤销）+ **两个临时项目**
 * （PX-M6WS-*；跑完物理删、零残留）在真机浏览器里跑一遍工作台接线后的读写口径 ——
 *   ① 接口先行对账（夹具落库后 GET /api/v1/workspace）：跨项目三组任务 + 「我提出的」不含他人提的问题；
 *   ② 页面骨架：两枚下划线标签（我的任务 / 我提出的问题；文字 + 选中下划线）+ 默认选中「我的任务」+ 地址不带 `?tab=`；
 *   ③ 「我的任务」折叠面板：收起 = 项目名称 + 编号（最急的项目在最上）+ 摘要签；展开 = 该项目下的任务表；
 *   ④ 任务表口径（行口径照项目页任务表搬 ——「直接把这个搬到我的任务不就好了」）：任务描述 + 四格进度点 /
 *      负责人 / 状态 / 紧急重要度 / 逾期未交付 / 开始·预计·实际日期；
 *      他人任务、已完成、7 天外、未排期都不进；
 *   ⑤ 切标签：真实鼠标点「我提出的问题」→ 地址写回 `?tab=raised`、aria-current 转移；
 *   ⑥ 「我提出的问题」折叠面板：照「问题追踪」的完整六列（日期 / 问题描述 / 问题归类 /
 *      解决方案或建议 / 问题附图 / 问题是否处理；后两列按项目向源接口回填，真 PNG 直传夹具保证有值）+
 *      行尾「在项目中查看」；未关闭在前、不是我提的不进；
 *   ⑦ 深链：`#/my-tasks?tab=raised` 直接打开仍停在该标签；`?tab=` 不认识的值落回「我的任务」；
 *   ⑧ 收尾：删两个临时项目（物理删）→ 读面 404；撤销两条临时会话；库内零残留；控制台 0 异常。
 * 证据：docs/m6-回放证据(工作台我的任务·前端).md
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
/** 反例提出人（「我提出的问题」不认他提的问题）。 */
const OTHER_USER = process.env.OTHER_USER ?? "wmj";
const TZ = "Asia/Shanghai";
const Q = String.fromCharCode(34);
const j = (value) => JSON.stringify(value);

const db = new Client({ connectionString: DB });
await db.connect();
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
async function makeSession(username) {
  const row = (await db.query("select id, username, display_name from users where username = $1", [username])).rows[0];
  if (row === undefined) {
    console.error("回放用户不存在：" + username);
    process.exit(1);
  }
  const token = "pxm6ws-" + randomBytes(16).toString("hex");
  const csrf = randomBytes(16).toString("hex");
  await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(mins => 30))", [sha256(token), row.id, "px-m6-workspace-replay"]);
  return { id: row.id, username: row.username, displayName: row.display_name, token, csrf };
}
const me = await makeSession(REPLAY_USER);
const other = await makeSession(OTHER_USER);
console.log("临时会话：" + me.username + "（" + me.displayName + "）+ " + other.username + "（" + other.displayName + "）");

function sessionApi(session) {
  return async function api(path, method = "GET", body, extra) {
    const headers = Object.assign({ Cookie: "ll_sid=" + session.token + "; ll_csrf=" + session.csrf, "X-CSRF-Token": session.csrf, Accept: "application/json" }, extra || {});
    const init = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await fetch(API + path, init);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (error) {
      json = null;
    }
    return { status: res.status, json, text };
  };
}
const api = sessionApi(me);
const apiOther = sessionApi(other);

const checks = [];
function check(name, ok, detail) {
  checks.push(ok === true);
  console.log((ok === true ? "PASS  " : "FAIL  ") + name + (detail === undefined ? "" : "   [" + detail + "]"));
}
const isoOf = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const shiftIso = (iso, days) => new Date(Date.parse(iso + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
/** ISO（YYYY-MM-DD）→「YYYY年M月D日」（与页面日期列同口径，用来对账展示文案）。 */
const cnDate = (iso) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match === null ? iso : String(Number(match[1])) + "年" + String(Number(match[2])) + "月" + String(Number(match[3])) + "日";
};
/** ISO（YYYY-MM-DD）→「M月D日」（与项目页任务表日期格同口径，用来对账展示文案）。 */
const mdDate = (iso) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match === null ? iso : String(Number(match[2])) + "月" + String(Number(match[3])) + "日";
};
const TODAY = isoOf(new Date());
const DUE_OVERDUE = shiftIso(TODAY, -2);
const DUE_UPCOMING = shiftIso(TODAY, 3);
const DUE_FAR = shiftIso(TODAY, 20);

// ---------- 清场：上一轮崩在中途留下的同名临时项目 ----------
/** 清项目里的文件（回收 → 彻底删除）：项目物理删的顺序里没有先清 files.current_version_id，
 *  带版本的文件会让 DELETE /projects/{id} 500 —— 收尾先清文件再删项目（证据文档「已知边界」有记）。 */
async function purgeProjectFiles(projectId) {
  const rows = (await db.query("select id, name, status, version from files where project_id = $1", [projectId])).rows;
  for (const file of rows) {
    let version = file.version;
    if (file.status !== "recycled") {
      const recycled = await api("/api/v1/files/" + file.id + "/recycle", "POST", { version });
      if (recycled.status !== 200 || recycled.json === null) {
        console.log("清文件·回收失败：" + file.name + " → " + String(recycled.status));
        continue;
      }
      version = recycled.json.version;
    }
    const purged = await api("/api/v1/files/" + file.id + "/purge", "POST", { version });
    console.log("清文件：" + file.name + " → " + String(purged.status));
  }
}
const staleProjects = (await db.query("select id, version from projects where code like $1 and deleted_at is null", ["PX-M6WS-%"])).rows;
for (const row of staleProjects) {
  await purgeProjectFiles(row.id);
  const gone = await api("/api/v1/projects/" + row.id, "DELETE", undefined, { "If-Match": String(row.version) });
  console.log("清场：删残留临时项目 " + row.id + " → " + String(gone.status));
}

// ---------- 夹具：两个临时项目 ----------
const suffix = randomBytes(3).toString("hex").toUpperCase();
const codeA = "PX-M6WS-A" + suffix;
const codeB = "PX-M6WS-B" + suffix;
const projA = await api("/api/v1/projects", "POST", { code: codeA, name: "回放·工作台A", description: "回放·工作台A", managerIds: [me.id] });
check("夹具：建临时项目 A（201）", projA.status === 201, String(projA.status) + " " + projA.text.slice(0, 140));
const projectA = projA.json === null ? "" : projA.json.id;
const projB = await api("/api/v1/projects", "POST", { code: codeB, name: "回放·工作台B", description: "回放·工作台B", managerIds: [me.id, other.id] });
check("夹具：建临时项目 B（201；成员 = 我 + 反例提出人）", projB.status === 201, String(projB.status) + " " + projB.text.slice(0, 140));
const projectB = projB.json === null ? "" : projB.json.id;

async function addTask(projectId, body) {
  const res = await api("/api/v1/projects/" + projectId + "/tasks", "POST", body);
  if (res.status !== 201 || res.json === null) {
    console.error("建任务失败：" + res.status + " " + res.text.slice(0, 200));
    process.exit(1);
  }
  return res.json;
}
// A：逾期 / 今日 / 即将 三条（我的）+ 四条反例（他人 / 已完成 / 7 天外 / 未排期）
const tOverdue = await addTask(projectA, { stageKey: "design", title: "回放·逾期任务", titleEn: "Replay overdue", ownerIds: [me.id], plannedEnd: DUE_OVERDUE, priority: "高" });
const tToday = await addTask(projectA, { stageKey: "design", title: "回放·今日任务", ownerIds: [me.id], plannedEnd: TODAY, priority: "中" });
const tUpcoming = await addTask(projectA, { stageKey: null, title: "回放·即将任务", ownerIds: [me.id], plannedEnd: DUE_UPCOMING, priority: "低" });
const tOtherOwner = await addTask(projectA, { stageKey: "design", title: "回放·他人任务", ownerIds: [other.id], plannedEnd: TODAY });
const tDone = await addTask(projectA, { stageKey: "design", title: "回放·已完成任务", ownerIds: [me.id], plannedEnd: TODAY });
const tFar = await addTask(projectA, { stageKey: "design", title: "回放·7天外任务", ownerIds: [me.id], plannedEnd: DUE_FAR });
const tUnscheduled = await addTask(projectA, { stageKey: "design", title: "回放·未排期任务", ownerIds: [me.id], plannedEnd: null });
// B：今日一条（我的）—— 跨项目聚合的第二块面板
const tB = await addTask(projectB, { stageKey: "presale", title: "回放·B项目今日任务", ownerIds: [me.id], plannedEnd: TODAY });
const progressRes = await api("/api/v1/projects/" + projectA + "/tasks/" + tUpcoming.id + "/progress", "PATCH", { progress: 0.5, version: tUpcoming.version });
check("夹具：即将任务改进度到 50%（PATCH progress）", progressRes.status === 200, String(progressRes.status));
const doneRes = await api("/api/v1/projects/" + projectA + "/tasks/" + tDone.id, "PATCH", { status: "done", version: tDone.version });
check("夹具：反例任务置「已完成」（PATCH status=done）", doneRes.status === 200, String(doneRes.status) + " " + doneRes.text.slice(0, 140));

async function addIssue(projectId, session, title, categories, dueLabel) {
  const report = await sessionApi(session)("/api/v1/projects/" + projectId + "/reports", "POST", {
    date: TODAY,
    state: "submitted",
    doneWork: "回放·" + dueLabel + "的日报",
    foundIssue: title,
    issueCategories: categories,
  });
  if (report.status !== 201 || report.json === null) {
    console.error("建日报 / 问题失败：" + report.status + " " + report.text.slice(0, 200));
    process.exit(1);
  }
  const issues = await sessionApi(session)("/api/v1/projects/" + projectId + "/issues?limit=200");
  const issueItems = issues.json === null || issues.json.items === undefined ? [] : issues.json.items;
  const found = issueItems.find((item) => item.title === title);
  if (found === undefined) {
    console.error("日报没有派生问题：" + title);
    process.exit(1);
  }
  return { reportId: report.json.id, issue: found };
}
// A：我提出的两条（一条未解决、一条已完成）
const issueA1 = await addIssue(projectA, me, "回放问题·我提出的未解决", ["机械部"], "A 未解决");
const issueA2 = await addIssue(projectA, me, "回放问题·我提出的已完成", ["采购部", "项目部"], "A 已完成");
const closeRes = await api("/api/v1/projects/" + projectA + "/issues/" + issueA2.issue.id, "PATCH", { state: "done", version: issueA2.issue.version });
check("夹具：A 的第二条问题置「已完成」（PATCH state=done）", closeRes.status === 200, String(closeRes.status) + " " + closeRes.text.slice(0, 140));
// A1：补「解决方案或建议 + 问题附图」两列（工作台聚合读面不带这两列 —— 页面按项目向
// GET /projects/{id}/issues 回填）。附图走真直传链路：发起 → 签名分片 → PUT → 完成。
const issueSolution = "回放·解决方案：先抽水，复测后再装货架";
const pngName = "回放-问题附图.png";
const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const pngHash = sha256(pngBytes);
const upInit = await api("/api/v1/files/uploads", "POST", { projectId: projectA, name: pngName, sizeBytes: pngBytes.length, mime: "image/png", contentHash: pngHash, intent: "version" });
const pngFileId = upInit.json === null ? "" : upInit.json.file.id;
const pngSession = upInit.json === null ? "" : upInit.json.upload.id;
check("夹具：问题附图发起直传（201）", upInit.status === 201 && pngFileId !== "" && pngSession !== "", String(upInit.status) + " " + upInit.text.slice(0, 140));
const pngSigned = await api("/api/v1/files/" + pngFileId + "/uploads/" + pngSession + "/parts", "POST", { partNumbers: [1] });
const pngPartUrl = pngSigned.json === null ? "" : pngSigned.json.parts[0].url;
const pngPut = pngPartUrl === "" ? { ok: false, status: 0 } : await fetch(pngPartUrl, { method: "PUT", body: pngBytes });
const pngDone = pngPut.ok ? await api("/api/v1/files/" + pngFileId + "/uploads/" + pngSession + "/complete", "POST", { contentHash: pngHash }) : { status: 0, json: null, text: "PUT 失败 " + String(pngPut.status) };
check("夹具：问题附图直传完成（PUT 200 → complete 200 落版本）", pngPut.status === 200 && pngDone.status === 200 && pngDone.json !== null && pngDone.json.version !== undefined, String(pngPut.status) + " / " + String(pngDone.status) + " " + pngDone.text.slice(0, 140));
const issuePatchRes = await api("/api/v1/projects/" + projectA + "/issues/" + issueA1.issue.id, "PATCH", { solution: issueSolution, photoFileIds: [pngFileId], version: issueA1.issue.version });
check("夹具：A1 问题补「解决方案或建议 + 问题附图」（PATCH solution + photoFileIds）", issuePatchRes.status === 200, String(issuePatchRes.status) + " " + issuePatchRes.text.slice(0, 140));
// B：我提出的一条 + 反例（wmj 提出、但处理人 = 我）
const issueB = await addIssue(projectB, me, "回放问题·B项目我提出的", ["客观原因"], "B 我提出的");
const issueOther = await addIssue(projectB, other, "回放问题·他人提出的", ["物流原因"], "B 他人提出的");
const otherRead = await api("/api/v1/projects/" + projectB + "/issues/" + issueOther.issue.id);
check("夹具：B 的反例问题可读（wmj 提出；本刀只做「我提出的」栏，不作断言依据）", otherRead.status === 200, String(otherRead.status));

// ---------- ① 接口先行对账（页面口径的服务端真相） ----------
const wsRes = await api("/api/v1/workspace");
check("①a GET /api/v1/workspace 200（仅会话、跨项目）", wsRes.status === 200 && wsRes.json !== null, String(wsRes.status));
const ws = wsRes.json === null ? { myTasks: { today: [], upcoming: [], overdue: [] }, myIssues: { handling: [], raised: [] } } : wsRes.json;
const idsOf = (list) => (list === undefined ? [] : list).map((item) => item.id);
check("①b 基准日 = Asia/Shanghai 今天（" + TODAY + "）", ws.today === TODAY, String(ws.today));
check("①c 我的任务三组：今日 2 条（A 的今日 + B 的今日）", idsOf(ws.myTasks.today).length === 2 && idsOf(ws.myTasks.today).indexOf(tToday.id) >= 0 && idsOf(ws.myTasks.today).indexOf(tB.id) >= 0, JSON.stringify(idsOf(ws.myTasks.today)));
check("①d 我的任务三组：即将 1 条（A 的 +3 天）、已逾期 1 条（A 的 -2 天）", idsOf(ws.myTasks.upcoming).join(",") === tUpcoming.id && idsOf(ws.myTasks.overdue).join(",") === tOverdue.id, JSON.stringify([idsOf(ws.myTasks.upcoming), idsOf(ws.myTasks.overdue)]));
const myTaskIds = idsOf(ws.myTasks.today).concat(idsOf(ws.myTasks.upcoming), idsOf(ws.myTasks.overdue));
check("①e 他人任务 / 已完成 / 7 天外 / 未排期都不进工作台", [tOtherOwner.id, tDone.id, tFar.id, tUnscheduled.id].every((id) => myTaskIds.indexOf(id) === -1), JSON.stringify(myTaskIds));
check("①f 「我提出的」= 3 条（A 两条 + B 一条），不含 wmj 提出的那条", idsOf(ws.myIssues.raised).length === 3 && idsOf(ws.myIssues.raised).indexOf(issueOther.issue.id) === -1, JSON.stringify(idsOf(ws.myIssues.raised)));
check("①g 「我提出的」未关闭在前：A 的未解决排在已完成那条之前", idsOf(ws.myIssues.raised).indexOf(issueA1.issue.id) < idsOf(ws.myIssues.raised).indexOf(issueA2.issue.id), JSON.stringify(idsOf(ws.myIssues.raised)));

// ---------- 真机浏览器 ----------
const profile = mkdtempSync(join(tmpdir(), "pxm6ws-"));
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
await page.send("Network.setCookie", { name: "ll_sid", value: me.token, url: FRONTEND + "/", path: "/", httpOnly: true, secure: false });
await page.send("Network.setCookie", { name: "ll_csrf", value: me.csrf, url: FRONTEND + "/", path: "/", httpOnly: false, secure: false });
await page.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ev = async (expression) => {
  const reply = await page.send("Runtime.evaluate", { expression, returnByValue: true });
  if (reply.exceptionDetails !== undefined) throw new Error("页面表达式抛异常：" + JSON.stringify(reply.exceptionDetails).slice(0, 300) + " | " + expression.slice(0, 160));
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
async function open(path, waitSelector) {
  await page.send("Page.navigate", { url: "about:blank" });
  await sleep(400);
  await page.send("Page.navigate", { url: FRONTEND + "/" + path });
  const ok = await waitFor("document.querySelector(" + j(waitSelector) + ") !== null", 20000);
  if (!ok) throw new Error("页面没等到元素：" + waitSelector + "（" + path + "）");
  await sleep(600);
}
async function rectOf(selector) {
  return await ev("(function(){var node=document.querySelector(" + j(selector) + ");if(node===null){return null;}var box=node.getBoundingClientRect();if(box.width<=0||box.height<=0){return null;}return {x:Math.round(box.left+box.width/2),y:Math.round(box.top+box.height/2)};})()");
}
async function clickSelector(selector) {
  const point = await rectOf(selector);
  if (point === null || point === undefined) throw new Error("点不到（元素不存在或不可见）：" + selector);
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(700);
}

/** 页头 + 标签栏读数。 */
const headExpr = () => "(function(){var tabs=document.querySelectorAll(" + j("[data-workspace-tab]") + ");var out=[];for(var i=0;i<tabs.length;i+=1){out.push({key:String(tabs[i].getAttribute(" + j("data-workspace-tab") + ")),text:tabs[i].textContent.trim(),current:tabs[i].getAttribute(" + j("aria-current") + ")});}var headerNode=document.querySelector(" + j("header") + ");return {page:document.querySelector(" + j("[data-workspace-page]") + ")!==null,tabs:out,hash:window.location.hash,header:headerNode===null?" + j("") + ":headerNode.textContent.trim()};})()";
/** 折叠面板读数（顺序即 DOM 顺序）。 */
const panelsExpr = () => "(function(){var root=document.querySelector(" + j("[data-workspace-page]") + ");if(root===null){return null;}var ps=root.querySelectorAll(" + j("[data-workspace-panel]") + ");var out=[];for(var i=0;i<ps.length;i+=1){var p=ps[i];var t=p.querySelector(" + j("[data-workspace-panel-toggle]") + ");out.push({id:String(p.getAttribute(" + j("data-workspace-panel") + ")),open:String(p.getAttribute(" + j("data-open") + ")),expanded:t===null?null:t.getAttribute(" + j("aria-expanded") + "),text:t===null?String(" + j("") + ") :t.textContent.trim(),rows:p.querySelectorAll(" + j("[data-workspace-task],[data-workspace-issue]") + ").length});}return out;})()";
/** 任务表读数（按项目面板）。 */
const taskRowsExpr = (projectId) => "(function(){var panel=document.querySelector(" + j('[data-workspace-panel="' + projectId + '"]') + ");if(panel===null){return null;}var table=panel.querySelector(" + j("[data-workspace-task-table]") + ");if(table===null){return {table:false};}var rows=table.querySelectorAll(" + j("tbody tr") + ");var out=[];for(var i=0;i<rows.length;i+=1){var cells=rows[i].querySelectorAll(" + j("td") + ");var dotsNode=rows[i].querySelector(" + j("[data-workspace-task-dots]") + ");out.push({id:String(rows[i].getAttribute(" + j("data-workspace-task") + ")),title:cells[0].textContent.trim(),group:cells[1].textContent.trim(),owners:cells[2].textContent.trim(),status:cells[3].textContent.trim(),statusKey:String((rows[i].querySelector(" + j("[data-workspace-task-status]") + ")||{getAttribute:function(){return " + j("") + ";}}).getAttribute(" + j("data-workspace-task-status") + ")),priority:cells[4].textContent.trim(),onTime:cells[5].textContent.trim(),start:cells[6].textContent.trim(),due:cells[7].textContent.trim(),actual:cells[8].textContent.trim(),dots:dotsNode===null?" + j("") + ":String(dotsNode.getAttribute(" + j("data-workspace-task-dots") + "))});}return {table:true,rows:out};})()";
/** 问题表读数（按项目面板）。 */
const issueRowsExpr = (projectId) => "(function(){var panel=document.querySelector(" + j('[data-workspace-panel="' + projectId + '"]') + ");if(panel===null){return null;}var table=panel.querySelector(" + j("[data-workspace-issue-table]") + ");if(table===null){return {table:false};}var heads=table.querySelectorAll(" + j("thead th") + ");var headTexts=[];for(var h=0;h<heads.length;h+=1){headTexts.push(heads[h].textContent.trim());}var rows=table.querySelectorAll(" + j("tbody tr") + ");var out=[];for(var i=0;i<rows.length;i+=1){var cells=rows[i].querySelectorAll(" + j("td") + ");var link=rows[i].querySelector(" + j("a") + ");var photoNodes=rows[i].querySelectorAll(" + j("[data-issue-photo]") + ");var photoNames=[];for(var p=0;p<photoNodes.length;p+=1){photoNames.push(String(photoNodes[p].getAttribute(" + j("data-issue-photo") + ")));}out.push({id:String(rows[i].getAttribute(" + j("data-workspace-issue") + ")),date:cells[0].textContent.trim(),title:cells[1].textContent.trim(),categories:cells[2].textContent.trim(),solution:cells[3].textContent.trim(),photosText:cells[4].textContent.trim(),photos:photoNodes.length,photoNames:photoNames,state:cells[5].textContent.trim(),href:link===null?" + j("") + ":link.getAttribute(" + j("href") + ")});}return {table:true,heads:headTexts,rows:out};})()";
/** 空态 / 汇总行读数。 */
const totalExpr = () => "(function(){var node=document.querySelector(" + j("[data-workspace-task-total]") + ");return node===null?null:node.textContent.trim();})()";

// ---------- ② 页面骨架 ----------
await open("#/my-tasks", "[data-workspace-page]");
const head0 = await ev(headExpr());
check("②a 页面渲染出「我的任务」页（data-workspace-page）+ 顶栏页名", head0 !== null && head0.page === true && head0.header.indexOf("我的任务") >= 0, head0 === null ? "null" : JSON.stringify(head0.header.slice(0, 60)));
check("②b 标签导航栏 = 两枚下划线标签（我的任务 / 我提出的问题；文字，无图标）", head0 !== null && head0.tabs.length === 2 && head0.tabs.map((item) => item.text).join("|") === "我的任务|我提出的问题", head0 === null ? "null" : JSON.stringify(head0.tabs.map((item) => item.text)));
check("②c 缺省选中「我的任务」、地址不带 ?tab=", head0 !== null && head0.tabs[0].current === "page" && head0.tabs[1].current === null && head0.hash === "#/my-tasks", head0 === null ? "null" : JSON.stringify([head0.tabs.map((item) => item.current), head0.hash]));
const total0 = await ev(totalExpr());
check("②d 汇总行「共 4 项 · 跨 2 个项目 · 基准日 …」（三组 3 + B 1，跨项目）", typeof total0 === "string" && total0.indexOf("共 4 项") >= 0 && total0.indexOf("跨 2 个项目") >= 0 && total0.indexOf(cnDate(TODAY)) >= 0, String(total0));

// ---------- ③ 「我的任务」折叠面板 ----------
const panels0 = await ev(panelsExpr());
check("③a 折叠面板 = 2 块（每个项目一块）", panels0 !== null && panels0.length === 2, JSON.stringify(panels0));
check("③b 最急的项目在最上（A 有逾期任务 → 排第一；B 第二）", panels0 !== null && panels0[0].id === projectA && panels0[1].id === projectB, panels0 === null ? "null" : JSON.stringify(panels0.map((item) => item.id)));
check("③c 收起态 = 项目名称 + 编号（+ 摘要），且未展开时表体不在 DOM", panels0 !== null && panels0[0].open === "false" && panels0[0].expanded === "false" && panels0[0].rows === 0 && panels0[0].text.indexOf("回放·工作台A") >= 0 && panels0[0].text.indexOf(codeA) >= 0 && panels0[0].text.indexOf("共 3 项") >= 0 && panels0[0].text.indexOf("已逾期 1") >= 0 && panels0[0].text.indexOf("今日 1") >= 0, panels0 === null ? "null" : JSON.stringify(panels0[0]));
check("③d B 面板收起态：项目名 + 编号 + 共 1 项", panels0 !== null && panels0[1].text.indexOf("回放·工作台B") >= 0 && panels0[1].text.indexOf(codeB) >= 0 && panels0[1].text.indexOf("共 1 项") >= 0, panels0 === null ? "null" : JSON.stringify(panels0[1]));

// ---------- ④ 展开 A：任务表口径 ----------
await clickSelector('[data-workspace-panel="' + projectA + '"] [data-workspace-panel-toggle]');
const expanded = await ev(panelsExpr());
check("④a 点一下面板头 = 展开（data-open=true / aria-expanded=true / 表体出现）", expanded !== null && expanded[0].open === "true" && expanded[0].expanded === "true" && expanded[0].rows === 3, expanded === null ? "null" : JSON.stringify(expanded[0]));
const rowsA = await ev(taskRowsExpr(projectA));
const expectedOrder = [tOverdue.id, tToday.id, tUpcoming.id].join(",");
check("④b 任务表 3 行、顺序 = 已逾期 → 今日 → 即将（最急在前）", rowsA !== null && rowsA.table === true && rowsA.rows.map((item) => item.id).join(",") === expectedOrder, rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.id)));
check("④c 分组签 = 已逾期 / 今日待办 / 即将到期", rowsA !== null && rowsA.rows.map((item) => item.group).join("|") === "已逾期|今日待办|即将到期", rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.group)));
check("④d 状态签 = 项目页同款胶囊（服务端展示态：已延期 / 待开始 / 进行中）", rowsA !== null && rowsA.rows[0].status === "已延期" && rowsA.rows[0].statusKey === "overdue" && rowsA.rows[1].status === "待开始" && rowsA.rows[1].statusKey === "pending" && rowsA.rows[2].status === "进行中" && rowsA.rows[2].statusKey === "active", rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => [item.status, item.statusKey])));
check("④e 日期三列 = 项目页同款短日期胶囊（逾期 -2 天 / 今天 / +3 天；开始 / 实际为空落「—」）", rowsA !== null && rowsA.rows.map((item) => item.due).join("|") === [DUE_OVERDUE, TODAY, DUE_UPCOMING].map(mdDate).join("|") && rowsA.rows.every((item) => item.start === "—" && item.actual === "—"), rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => [item.start, item.due, item.actual])));
check("④f 四格进度点 = 项目页同款（0 / 0 / 0.5 —— 即将任务 50% 档）", rowsA !== null && rowsA.rows[0].dots === "0" && rowsA.rows[1].dots === "0" && rowsA.rows[2].dots === "0.5", rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.dots)));
check("④g 紧急重要度列 = 高 / 中 / 低", rowsA !== null && rowsA.rows.map((item) => item.priority).join("|") === "高|中|低", rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.priority)));
check("④h 任务主列 = 名称 + 阶段 / 英文名小行（B 项目面板块段落不串行）", rowsA !== null && rowsA.rows[0].title.indexOf("回放·逾期任务") >= 0 && rowsA.rows[0].title.indexOf("设计开发") >= 0 && rowsA.rows[2].title.indexOf("临时任务") >= 0, rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.title.slice(0, 40))));
check("④j 任务负责人列 = 「潘兴」（项目页同款玻璃小胶囊）", rowsA !== null && rowsA.rows.every((item) => item.owners === "潘兴"), rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.owners)));
check("④k 「是否按时交付」列 = 逾期未交付 / — / —（displayStatus=overdue 的红签）", rowsA !== null && rowsA.rows.map((item) => item.onTime).join("|") === "逾期未交付|—|—", rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.onTime)));
check("④i 反例不出现：他人任务 / 已完成 / 7 天外 / 未排期（服务端已过滤，页面直接照单渲染）", rowsA !== null && [tOtherOwner.id, tDone.id, tFar.id, tUnscheduled.id].every((id) => rowsA.rows.every((item) => item.id !== id)), rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.id)));

// ---------- ⑤ 切标签 ----------
await clickSelector('[data-workspace-tab="raised"]');
const head1 = await ev(headExpr());
check("⑤a 点「我提出的问题」→ 地址写回 ?tab=raised（replace，可刷新 / 可分享）", head1 !== null && head1.hash === "#/my-tasks?tab=raised", head1 === null ? "null" : String(head1.hash));
check("⑤b 选中态转移（aria-current=page 只在「我提出的问题」上）", head1 !== null && head1.tabs[0].current === null && head1.tabs[1].current === "page", head1 === null ? "null" : JSON.stringify(head1.tabs.map((item) => item.current)));
const panels1 = await ev(panelsExpr());
check("⑤c 折回「我提出的问题」：面板按项目分组（A 共 2 条 / B 共 1 条，都在收起态；同日并列的项目序不作断言）", panels1 !== null && panels1.length === 2 && panels1.every((item) => item.open === "false") && panels1.map((item) => item.id).sort().join(",") === [projectA, projectB].sort().join(",") && panels1.some((item) => item.id === projectA && item.text.indexOf("共 2 条") >= 0) && panels1.some((item) => item.id === projectB && item.text.indexOf("共 1 条") >= 0), JSON.stringify(panels1));
const issueTotal = await ev("(function(){var node=document.querySelector(" + j("[data-workspace-issue-total]") + ");return node===null?null:node.textContent.trim();})()");
check("⑤d 汇总行「共 3 条 · 跨 2 个项目 · 未关闭在前」", typeof issueTotal === "string" && issueTotal.indexOf("共 3 条") >= 0 && issueTotal.indexOf("跨 2 个项目") >= 0, String(issueTotal));

// ---------- ⑥ 问题表口径（参考「问题追踪」） ----------
await clickSelector('[data-workspace-panel="' + projectA + '"] [data-workspace-panel-toggle]');
const photoTileOk = await waitFor("document.querySelector(" + j('[data-workspace-panel="' + projectA + '"] [data-issue-photo]') + ") !== null", 25000);
check("⑥a0 问题附图瓦片懒取预览签名后出现（真 PNG 直传 → 预览就绪）", photoTileOk === true, String(photoTileOk));
const rowsIssueA = await ev(issueRowsExpr(projectA));
check("⑥a 表头 = 「问题追踪」完整六列（日期 / 问题描述 / 问题归类 / 解决方案或建议 / 问题附图 / 问题是否处理；+ 行尾动作列）", rowsIssueA !== null && rowsIssueA.heads.slice(0, 6).join("|") === "日期|问题描述|问题归类|解决方案或建议|问题附图|问题是否处理", rowsIssueA === null ? "null" : JSON.stringify(rowsIssueA.heads));
check("⑥b A 项目 2 条（我提出的），未关闭在前：未解决 → 已完成", rowsIssueA !== null && rowsIssueA.rows.length === 2 && rowsIssueA.rows[0].id === issueA1.issue.id && rowsIssueA.rows[1].id === issueA2.issue.id, rowsIssueA === null ? "null" : JSON.stringify(rowsIssueA.rows.map((item) => item.id)));
check("⑥c 日期列 = 提出日（年月日）", rowsIssueA !== null && rowsIssueA.rows.every((item) => item.date === cnDate(TODAY)), rowsIssueA === null ? "null" : JSON.stringify(rowsIssueA.rows.map((item) => item.date)));
check("⑥d 问题描述列 = 问题原文；归类列 = 多值色签（机械部 / 采购部 · 项目部）", rowsIssueA !== null && rowsIssueA.rows[0].title.indexOf("回放问题·我提出的未解决") >= 0 && rowsIssueA.rows[0].categories.indexOf("机械部") >= 0 && rowsIssueA.rows[1].categories.indexOf("采购部") >= 0 && rowsIssueA.rows[1].categories.indexOf("项目部") >= 0, rowsIssueA === null ? "null" : JSON.stringify(rowsIssueA.rows.map((item) => item.categories)));
check("⑥e 状态列 = 未解决 / 已完成（三态中文）", rowsIssueA !== null && rowsIssueA.rows[0].state === "未解决" && rowsIssueA.rows[1].state === "已完成", rowsIssueA === null ? "null" : JSON.stringify(rowsIssueA.rows.map((item) => item.state)));
check("⑥e1 「解决方案或建议」列 = 回填的解决方案原文 / 无值落「—」", rowsIssueA !== null && rowsIssueA.rows[0].solution.indexOf("回放·解决方案") >= 0 && rowsIssueA.rows[1].solution === "—", rowsIssueA === null ? "null" : JSON.stringify(rowsIssueA.rows.map((item) => item.solution)));
check("⑥e2 「问题附图」列 = A1 一枚真图瓦片（文件名对齐）/ 无图落「—」", rowsIssueA !== null && rowsIssueA.rows[0].photos === 1 && rowsIssueA.rows[0].photoNames[0] === pngName && rowsIssueA.rows[1].photos === 0 && rowsIssueA.rows[1].photosText === "—", rowsIssueA === null ? "null" : JSON.stringify(rowsIssueA.rows.map((item) => [item.photos, item.photoNames, item.photosText])));
const partialBanner = await ev("document.querySelector(" + j("[data-workspace-issue-partial]") + ") !== null");
check("⑥e3 六列回填没有 partial 降级横幅（两个项目的问题源接口都取到）", partialBanner === false, String(partialBanner));
check("⑥f 行尾「在项目中查看」→ 该项目「日报及问题 → 问题追踪」深链", rowsIssueA !== null && rowsIssueA.rows[0].href === "#/project/" + projectA + "?view=daily&sub=issues", rowsIssueA === null ? "null" : String(rowsIssueA.rows[0].href));
check("⑥g 不是我提出的（wmj 提的）不进这张表", rowsIssueA !== null && rowsIssueA.rows.every((item) => item.id !== issueOther.issue.id), rowsIssueA === null ? "null" : JSON.stringify(rowsIssueA.rows.map((item) => item.id)));
await clickSelector('[data-workspace-panel="' + projectB + '"] [data-workspace-panel-toggle]');
const rowsIssueB = await ev(issueRowsExpr(projectB));
check("⑥h 跨项目：B 面板 1 条（我提出的；无解决方案 / 无附图落「—」）", rowsIssueB !== null && rowsIssueB.rows.length === 1 && rowsIssueB.rows[0].id === issueB.issue.id && rowsIssueB.rows[0].categories.indexOf("客观原因") >= 0 && rowsIssueB.rows[0].solution === "—" && rowsIssueB.rows[0].photos === 0 && rowsIssueB.rows[0].photosText === "—", rowsIssueB === null ? "null" : JSON.stringify(rowsIssueB.rows));

// ---------- ⑦ 深链 / 未知参数 ----------
await open("#/my-tasks?tab=raised", "[data-workspace-page]");
const head2 = await ev(headExpr());
check("⑦a 深链 #/my-tasks?tab=raised 直接打开 = 「我提出的问题」选中（刷新 / 收藏 / 分享同款）", head2 !== null && head2.tabs[1].current === "page" && head2.hash === "#/my-tasks?tab=raised", head2 === null ? "null" : JSON.stringify([head2.tabs.map((item) => item.current), head2.hash]));
await open("#/my-tasks?tab=zzz", "[data-workspace-page]");
const head3 = await ev(headExpr());
check("⑦b ?tab= 不认识的值落回缺省「我的任务」（地址不纠正，与 ?view= 同口径）", head3 !== null && head3.tabs[0].current === "page" && head3.tabs[1].current === null, head3 === null ? "null" : JSON.stringify(head3.tabs.map((item) => item.current)));
await open("#/my-tasks", "[data-workspace-page]");
await clickSelector('[data-workspace-tab="tasks"]');
const head4 = await ev(headExpr());
check("⑦c 从「我提出的问题」点回「我的任务」→ 地址回到不带参数的 #/my-tasks", head4 !== null && head4.hash === "#/my-tasks" && head4.tabs[0].current === "page", head4 === null ? "null" : String(head4.hash));

// ---------- ⑧ 收尾：清理 + 控制台 ----------
const consoleLines = page.events.filter((line) => line.indexOf("EVT Runtime.exceptionThrown") >= 0 || line.indexOf("EVT Log.entryAdded") >= 0);
check("⑧a 页面控制台 / 未捕获异常 0 条", consoleLines.length === 0, consoleLines.length === 0 ? "0" : JSON.stringify(consoleLines.slice(0, 3)));

page.ws.close();
chrome.kill();
await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch (error) { /* 收尾不阻塞 */ }

await purgeProjectFiles(projectA);
const delA = (await db.query("select version from projects where id = $1", [projectA])).rows[0];
const goneA = delA === undefined ? { status: 0 } : await api("/api/v1/projects/" + projectA, "DELETE", undefined, { "If-Match": String(delA.version) });
check("⑧b 删临时项目 A（物理删 200）", goneA.status === 200, String(goneA.status));
await purgeProjectFiles(projectB);
const delB = (await db.query("select version from projects where id = $1", [projectB])).rows[0];
const goneB = delB === undefined ? { status: 0 } : await api("/api/v1/projects/" + projectB, "DELETE", undefined, { "If-Match": String(delB.version) });
check("⑧c 删临时项目 B（物理删 200）", goneB.status === 200, String(goneB.status));
const goneRead = await api("/api/v1/projects/" + projectA);
check("⑧d 删完读面 404（真删，不是软删留档）", goneRead.status === 404, String(goneRead.status));
await db.query("update sessions set revoked_at = now() where token_hash = any($1) or id_token = $2", [[sha256(me.token), sha256(other.token)], "px-m6-workspace-replay"]);
const residue = (await db.query(
  "select (select count(*) from projects where code like $1) as projects, (select count(*) from tasks where project_id = any($2)) as tasks, (select count(*) from daily_reports where project_id = any($2)) as reports, (select count(*) from issues where project_id = any($2)) as issues, (select count(*) from sessions where id_token = $3 and revoked_at is null) as sessions",
  ["PX-M6WS-%", [projectA, projectB], "px-m6-workspace-replay"],
)).rows[0];
check("⑧e 库内零残留（项目 / 任务 / 日报 / 问题 / 未撤销会话 全 0）", Number(residue.projects) === 0 && Number(residue.tasks) === 0 && Number(residue.reports) === 0 && Number(residue.issues) === 0 && Number(residue.sessions) === 0, JSON.stringify(residue));
await db.end();

const failed = checks.filter((ok) => ok !== true).length;
console.log("");
console.log("—— 汇总：" + String(checks.length - failed) + " / " + String(checks.length) + " 通过" + (failed === 0 ? "（全过）" : "（" + String(failed) + " 项失败）"));
process.exitCode = failed === 0 ? 0 : 1;
