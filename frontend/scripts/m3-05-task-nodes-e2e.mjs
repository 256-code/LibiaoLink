/**
 * LibiaoLink 前端 · M3-05 余（第一段）回放：任务节点库落库 + 前端可增删改（Push 181）
 *
 * 前置（都在本机跑着）：
 *   1. 前端 dev：cd frontend && npm run dev（默认 3000）
 *   2. api：cd server && npm run start:api（默认 3001，需先 npm run build）
 *   3. 数据库：本地沙箱 PG（默认 127.0.0.1:5433/libiaolink）
 *   4. 本机装了 Chrome（脚本 headless 起一个调试实例；路径可用 CHROME_PATH 覆盖）
 *
 * 用法：node scripts/m3-05-task-nodes-e2e.mjs
 *
 * 它做什么：用一条**临时会话**（跑完撤销）+ 一个**临时节点**（跑完删掉）+ 一个**临时项目**（跑完硬删）在真机浏览器里跑一遍：
 *   ① 任务模板页左列 = 节点库接口（计数 / 卡片与 GET /api/v1/task-nodes 一致）；
 *   ② 列头「＋ 添加节点」→ 落库（DB 有行、seq = 该阶段末位 + 10）；
 *   ③ 同阶段同名 → 就地提示（409 NODE_ALREADY_EXISTS，不重复落库）；
 *   ④ 「项目总览 → 添加任务」卡片的「任务节点」标签同源（能看到刚建的节点）→ 点一条 → 任务落库；
 *   ⑤ 卡片上的红胶囊删除 → 底部确认条 → 物理删行 + 审计留痕，且**已生成的项目任务不受影响**；
 *   ⑥ 卡片上的铅笔编辑 → 表单预填 → PATCH 改名（乐观锁 version 0→1 + 审计 action=update）。
 * 证据：docs/m3-05-回放证据(节点库增删改·前端).md
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
// pg 只用来核对两处落库口径（task_nodes 行 / audit_logs 留痕）—— 前端不新装依赖，复用 server 的依赖解析。
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
/** 探针里的引号一律用 String.fromCharCode 生成（这个脚本自己也是被这样写出来的）。 */
const Q = String.fromCharCode(34);
const q = (text) => Q + text + Q;

const db = new Client({ connectionString: DB });
await db.connect();
const userRow = (await db.query("select id, username, display_name from users where username = $1", [REPLAY_USER])).rows[0];
if (userRow === undefined) {
  console.error("回放用户不存在：" + REPLAY_USER);
  process.exit(1);
}
const token = "pxnodelib-" + randomBytes(16).toString("hex");
const csrf = randomBytes(16).toString("hex");
await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(mins => 30))", [sha256(token), userRow.id, "px-node-e2e"]);
console.log("临时会话：" + userRow.username + "（" + userRow.display_name + "）");

const profile = mkdtempSync(join(tmpdir(), "pxnodes-"));
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
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const item = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) item.reject(new Error(JSON.stringify(msg.error))); else item.resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.exceptionThrown" || msg.method === "Log.entryAdded" || msg.method === "Runtime.consoleAPICalled") {
        this.events.push("EVT " + msg.method + " " + JSON.stringify(msg.params).slice(0, 400));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("cdp timeout: " + method)); }, 20000);
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
  checks.push(ok === true);
  console.log((ok === true ? "PASS  " : "FAIL  ") + name + (detail === undefined ? "" : "   [" + detail + "]"));
}

// 探针：左列 = 第一个 innerText 以「任务节点」开头的 section；引号一律用 q() / String.fromCharCode 生成
const LEFT_SECTION = "(function(){var ss=document.querySelectorAll(" + q("section") + ");for(var i=0;i<ss.length;i++){if((ss[i].innerText||" + q("") + ").indexOf(" + q("任务节点") + ")===0){return ss[i];}}return null;})()";
const LEFT_HEADER = "(function(){var s=" + LEFT_SECTION + ";if(s===null){return null;}return (s.innerText||" + q("") + ").split(String.fromCharCode(10)).slice(0,3);})()";
const LEFT_TITLES = "(function(){var s=" + LEFT_SECTION + ";if(s===null){return null;}var es=s.querySelectorAll(" + q("article") + ");var out=[];for(var i=0;i<es.length;i++){out.push(es[i].getAttribute(" + q("title") + ")||" + q("") + ");}return out;})()";
const LEFT_DELETE_BUTTONS = "(function(){var s=" + LEFT_SECTION + ";if(s===null){return -1;}var bs=s.querySelectorAll(" + q("button") + ");var n=0;for(var i=0;i<bs.length;i++){var a=bs[i].getAttribute(" + q("aria-label") + ")||" + q("") + ";if(a.indexOf(" + q("删除节点 ") + ")===0){n++;}}return n;})()";
const CLICK_ADD_BUTTON = "(function(){var s=" + LEFT_SECTION + ";if(s===null){return false;}var bs=s.querySelectorAll(" + q("button") + ");for(var i=0;i<bs.length;i++){if((bs[i].textContent||" + q("") + ").indexOf(" + q("添加节点") + ")>=0){bs[i].click();return true;}}return false;})()";
const FORM_TEXT = "(function(){var f=document.querySelector(" + q("form") + ");return f===null?null:(f.innerText||" + q("") + ");})()";
const INPUT_SELECTOR = (label) => "[aria-label=" + Q + label + Q + "]";
// 选择器要按 JS 字面量嵌进探针源码（JSON.stringify 转义内层引号）—— 直接拼 q(...) 会拼出非法选择器。
const INPUT_QUERY = (label) => "document.querySelector(" + JSON.stringify(INPUT_SELECTOR(label)) + ")";
const FILL_INPUT = (label, value) => "(function(){var el=" + INPUT_QUERY(label) + ";if(el===null){return false;}var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype," + q("value") + ").set;setter.call(el," + JSON.stringify(value) + ");el.dispatchEvent(new Event(" + q("input") + ",{bubbles:true}));return true;})()";
const CLICK_FORM_BUTTON = (label) => "(function(){var f=document.querySelector(" + q("form") + ");if(f===null){return false;}var bs=f.querySelectorAll(" + q("button") + ");for(var i=0;i<bs.length;i++){if((bs[i].textContent||" + q("") + ").trim()===" + q(label) + "){bs[i].click();return true;}}return false;})()";
const LEFT_EDIT_BUTTONS = "(function(){var s=" + LEFT_SECTION + ";if(s===null){return -1;}var bs=s.querySelectorAll(" + q("button") + ");var n=0;for(var i=0;i<bs.length;i++){var a=bs[i].getAttribute(" + q("aria-label") + ")||" + q("") + ";if(a.indexOf(" + q("编辑节点 ") + ")===0){n++;}}return n;})()";
const CLICK_EDIT_NODE = (title) => "(function(){var bs=document.querySelectorAll(" + q("button") + ");for(var i=0;i<bs.length;i++){var a=bs[i].getAttribute(" + q("aria-label") + ")||" + q("") + ";if(a===" + JSON.stringify("编辑节点 " + title) + "){bs[i].click();return true;}}return false;})()";
const CLICK_DELETE_NODE = (title) => "(function(){var bs=document.querySelectorAll(" + q("button") + ");for(var i=0;i<bs.length;i++){var a=bs[i].getAttribute(" + q("aria-label") + ")||" + q("") + ";if(a===" + JSON.stringify("删除节点 " + title) + "){bs[i].click();return true;}}return false;})()";
const INPUT_VALUE = (label) => "(function(){var el=" + INPUT_QUERY(label) + ";return el===null?null:el.value;})()";
/** 某个 aria-label 的输入框在不在（返回布尔；别把 DOM 元素本身交给 CDP）。 */
const HAS_INPUT = (label) => "(function(){return " + INPUT_QUERY(label) + " !== null;})()";
const CONFIRM_BAR_TEXT = "(function(){var ds=document.querySelectorAll(" + q("[role=dialog]") + ");for(var i=0;i<ds.length;i++){var t=ds[i].innerText||" + q("") + ";if(t.indexOf(" + q("节点库里的这一条会被删掉") + ")>=0){return t;}}return null;})()";
const CLICK_CONFIRM_DELETE = "(function(){var ds=document.querySelectorAll(" + q("[role=dialog]") + ");for(var i=0;i<ds.length;i++){var t=ds[i].innerText||" + q("") + ";if(t.indexOf(" + q("节点库里的这一条会被删掉") + ")>=0){var bs=ds[i].querySelectorAll(" + q("button") + ");for(var j=0;j<bs.length;j++){if((bs[j].textContent||" + q("") + ").trim()===" + q("删除") + "){bs[j].click();return true;}}}}return false;})()";
const CARD_ROWS = "(function(){var out=[];var bs=document.querySelectorAll(" + q("button") + ");for(var i=0;i<bs.length;i++){var t=(bs[i].textContent||" + q("") + ").split(String.fromCharCode(10)).join(String.fromCharCode(32)).trim();if(t.indexOf(" + q("＋ 添加") + ")>=0||t.indexOf(" + q("已添加") + ")>=0){out.push(t.slice(0,48));}}return out;})()";
const CARD_ADD_ROW = (title) => "(function(){var bs=document.querySelectorAll(" + q("button") + ");for(var i=0;i<bs.length;i++){var t=(bs[i].textContent||" + q("") + ").split(String.fromCharCode(10)).join(String.fromCharCode(32));if(t.indexOf(" + JSON.stringify(title) + ")>=0&&t.indexOf(" + q("＋ 添加") + ")>=0){bs[i].click();return true;}}return false;})()";
const CLICK_STAGE_PILL = (stage) => "(function(){var ps=document.querySelectorAll(" + q("[data-stage-pill]") + ");for(var i=0;i<ps.length;i++){if((ps[i].textContent||" + q("") + ").indexOf(" + JSON.stringify(stage) + ")>=0){ps[i].click();return true;}}return false;})()";

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ev = async (expression) => (await page.send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
const flat = (text) => String(text).split(String.fromCharCode(10)).join(" | ");

const TEMPLATES_URL = FRONTEND + "/#/templates?section=presale";
const nodeTitle = "回放节点·售前-" + randomBytes(3).toString("hex");
const nodeTitleEn = "Replay node presale";
/** 编辑段改成的名字（Push 181 后半：任务节点编辑）—— 改名之后 ⑤ 删除 / 清理都按这个名字找。 */
const nodeEditedTitle = "回放节点·售前改-" + randomBytes(3).toString("hex");
const nodeEditedTitleEn = "Replay node presale edited";
let baselineTotal = -1;
let projectId = "";
let createdTaskId = "";

try {
  // ---------- 权限画像（决定「＋ 添加节点」是否渲染）----------
  const me = await api("/api/v1/permissions/me");
  const keys = me.json === null ? [] : me.json.permissions.permissionKeys;
  check("夹具：回放账号持有 blueprint.manage（节点库维护入口才渲染）", keys.indexOf("blueprint.manage") >= 0, keys.length + " 个权限位");

  const baseline = await api("/api/v1/task-nodes?stage=presale");
  check("夹具：GET /api/v1/task-nodes?stage=presale 可用", baseline.status === 200, String(baseline.status) + " " + baseline.text.slice(0, 120));
  baselineTotal = baseline.json === null ? -1 : baseline.json.total;

  // ---------- ① 左列 = 节点库接口 ----------
  await page.send("Page.navigate", { url: TEMPLATES_URL });
  await sleep(4500);
  const header = await ev(LEFT_HEADER);
  const titles = await ev(LEFT_TITLES);
  console.log("左列列头：" + flat(header === null ? "" : header.join(" / ")));
  check("左列计数 = 服务端 total（" + String(baselineTotal) + "）", header !== null && header.join(" ").indexOf(String(baselineTotal) + " 个节点") >= 0, flat(header === null ? "" : header.join(" / ")));
  check("左列卡片数 = 服务端 total", titles !== null && titles.length === baselineTotal, "页面 " + String(titles === null ? -1 : titles.length) + " / 服务端 " + String(baselineTotal));
  const firstTitle = baseline.json === null || baseline.json.items.length === 0 ? "" : baseline.json.items[0].title;
  check("左列第一张卡片 = 服务端第一条（" + firstTitle + "）", titles !== null && firstTitle !== "" && String(titles[0]).indexOf(firstTitle) === 0, flat(String(titles === null ? "" : titles[0])));
  check("左列卡片带同款删除按钮（aria-label = 删除节点 …）", (await ev(LEFT_DELETE_BUTTONS)) === baselineTotal, String(await ev(LEFT_DELETE_BUTTONS)) + " / " + String(baselineTotal));
  check("左列卡片带铅笔编辑按钮（aria-label = 编辑节点 …）", (await ev(LEFT_EDIT_BUTTONS)) === baselineTotal, String(await ev(LEFT_EDIT_BUTTONS)) + " / " + String(baselineTotal));

  // ---------- ② 新增节点 ----------
  check("点列头「＋ 添加节点」→ 表单出现", (await ev(CLICK_ADD_BUTTON)) === true);
  await sleep(600);

  check("表单里能读到输入框（探针自检）", (await ev(HAS_INPUT("节点名称"))) === true && (await ev(HAS_INPUT("节点英文名"))) === true && (await ev("document.querySelectorAll(" + q("form") + ").length")) === 1, "表单数 1 · 两个输入框在");
  check("填中文名 / 英文名", (await ev(FILL_INPUT("节点名称", nodeTitle))) === true && (await ev(FILL_INPUT("节点英文名", nodeTitleEn))) === true);
  check("点「保存」提交", (await ev(CLICK_FORM_BUTTON("保存"))) === true);
  await sleep(2600);
  const afterAdd = await api("/api/v1/task-nodes?stage=presale");
  const addedNode = afterAdd.json === null ? undefined : afterAdd.json.items.filter((item) => item.title === nodeTitle)[0];
  check("新增落库：total +1 且能查到该节点", afterAdd.json !== null && afterAdd.json.total === baselineTotal + 1 && addedNode !== undefined, String(baselineTotal) + " -> " + String(afterAdd.json === null ? -1 : afterAdd.json.total));
  check("新增归一：英文名落库、id 是 UUID", addedNode !== undefined && addedNode.titleEn === nodeTitleEn && /^[0-9a-f-]{36}$/.test(addedNode.id), addedNode === undefined ? "" : JSON.stringify({ id: addedNode.id, titleEn: addedNode.titleEn }));
  const maxSeqBefore = baseline.json === null ? 0 : Math.max.apply(null, baseline.json.items.map((item) => item.seq).concat([0]));
  check("缺省 seq = 该阶段末位 + 10（" + String(maxSeqBefore + 10) + "）", addedNode !== undefined && addedNode.seq === maxSeqBefore + 10, addedNode === undefined ? "" : String(addedNode.seq));
  const dbNode = await db.query("select stage_key, seq, title, title_en from task_nodes where title = $1", [nodeTitle]);
  check("DB 落行：task_nodes 有该节点（stage_key = presale）", dbNode.rows.length === 1 && dbNode.rows[0].stage_key === "presale", JSON.stringify(dbNode.rows[0]));
  const afterAddTitles = await ev(LEFT_TITLES);
  check("左列刷新出这张新卡片", afterAddTitles !== null && afterAddTitles.some((item) => String(item).indexOf(nodeTitle) === 0), "页面 " + String(afterAddTitles === null ? -1 : afterAddTitles.length) + " 张");

  // ---------- ③ 同阶段同名 409 ----------
  check("再点「＋ 添加节点」→ 表单出现", (await ev(CLICK_ADD_BUTTON)) === true);
  await sleep(600);
  await ev(FILL_INPUT("节点名称", nodeTitle));
  check("同名再提交", (await ev(CLICK_FORM_BUTTON("保存"))) === true);
  await sleep(2600);
  const formText = flat(await ev(FORM_TEXT));
  check("同名就地提示（409 NODE_ALREADY_EXISTS）", formText.indexOf("该阶段已有同名节点") >= 0, formText.slice(0, 160));
  const afterDup = await api("/api/v1/task-nodes?stage=presale");
  check("同名不重复落库（total 不变）", afterDup.json !== null && afterDup.json.total === baselineTotal + 1, String(afterDup.json === null ? -1 : afterDup.json.total));
  await ev(CLICK_FORM_BUTTON("取消"));
  await sleep(400);

  // ---------- ④ 添加任务卡片同源 ----------
  const projectCode = "PX-NODE-" + randomBytes(3).toString("hex").toUpperCase();
  const project = await api("/api/v1/projects", "POST", { code: projectCode, name: "节点库回放", managerIds: [userRow.id] });
  check("夹具：建临时项目（201）", project.status === 201, String(project.status) + " " + project.text.slice(0, 140));
  projectId = project.json === null ? "" : project.json.id;
  await page.send("Page.navigate", { url: FRONTEND + "/#/project/" + projectId });
  await sleep(4500);
  check("点「售前规划」阶段标签打开添加卡片", (await ev(CLICK_STAGE_PILL("售前规划"))) === true);
  await sleep(1800);
  const rows = await ev(CARD_ROWS);
  const rowList = rows === null ? [] : rows;
  check("添加卡片「任务节点」= 同一份节点库（能看到刚建的节点）", rowList.some((row) => String(row).indexOf(nodeTitle) >= 0), rowList.join(" ／ ").slice(0, 260));
  check("新节点在卡片里是「＋ 添加」（项目里还没有）", rowList.some((row) => String(row).indexOf(nodeTitle) >= 0 && String(row).indexOf("＋ 添加") >= 0), rowList.length + " 行");
  check("点这一行「＋ 添加」", (await ev(CARD_ADD_ROW(nodeTitle))) === true);
  await sleep(4200);
  const taskList = await api("/api/v1/projects/" + projectId + "/tasks?limit=200");
  const createdTask = taskList.json === null ? undefined : taskList.json.items.filter((item) => item.title === nodeTitle)[0];
  check("任务落库（阶段 = 售前规划）", createdTask !== undefined && createdTask.stageKey === "presale", createdTask === undefined ? "未找到" : JSON.stringify({ title: createdTask.title, stageKey: createdTask.stageKey }));
  createdTaskId = createdTask === undefined ? "" : createdTask.id;

  // ---------- ④b 编辑节点（铅笔 → 表单预填 → PATCH 改名；乐观锁 version 递增）----------
  await page.send("Page.navigate", { url: TEMPLATES_URL });
  await sleep(4200);
  check("点节点卡片上的铅笔编辑按钮", (await ev(CLICK_EDIT_NODE(nodeTitle))) === true);
  await sleep(600);
  const editFormText = flat(await ev(FORM_TEXT));
  check("编辑表单出现且标题是「编辑节点」（当前板块）", editFormText.indexOf("编辑节点") >= 0 && editFormText.indexOf("售前规划") >= 0, editFormText.slice(0, 140));
  check("表单预填当前中 / 英文名", (await ev(INPUT_VALUE("节点名称"))) === nodeTitle && (await ev(INPUT_VALUE("节点英文名"))) === nodeTitleEn, JSON.stringify(await ev(INPUT_VALUE("节点名称"))));
  check("填新中文名 / 新英文名", (await ev(FILL_INPUT("节点名称", nodeEditedTitle))) === true && (await ev(FILL_INPUT("节点英文名", nodeEditedTitleEn))) === true);
  check("点「保存」提交编辑", (await ev(CLICK_FORM_BUTTON("保存"))) === true);
  await sleep(2600);
  const afterEdit = await api("/api/v1/task-nodes?stage=presale");
  const editedNode = afterEdit.json === null ? undefined : afterEdit.json.items.filter((item) => item.id === (addedNode === undefined ? "" : addedNode.id))[0];
  check("编辑落库：还是同一行（id 不变、total 不变、名字已换）", afterEdit.json !== null && afterEdit.json.total === baselineTotal + 1 && editedNode !== undefined && editedNode.title === nodeEditedTitle, editedNode === undefined ? "未找到" : JSON.stringify({ id: editedNode.id, title: editedNode.title }));
  check("英文名同步更新（" + nodeEditedTitleEn + "）", editedNode !== undefined && editedNode.titleEn === nodeEditedTitleEn, editedNode === undefined ? "" : String(editedNode.titleEn));
  check("乐观锁 version 递增（" + String(addedNode === undefined ? -1 : addedNode.version) + " -> " + String(editedNode === undefined ? -1 : editedNode.version) + "）", addedNode !== undefined && editedNode !== undefined && editedNode.version === addedNode.version + 1);
  const dbEdited = await db.query("select title, title_en, version from task_nodes where id = $1", [addedNode === undefined ? "" : addedNode.id]);
  check("DB 落行：task_nodes 该行已改名（title / title_en / version）", dbEdited.rows.length === 1 && dbEdited.rows[0].title === nodeEditedTitle && dbEdited.rows[0].title_en === nodeEditedTitleEn, JSON.stringify(dbEdited.rows[0]));
  const dbEditAudit = await db.query("select action, changes from audit_logs where object_type = $1 and object_id = $2 order by id desc limit 3", ["task_node", addedNode === undefined ? "" : addedNode.id]);
  const editChanges = dbEditAudit.rows.length === 0 ? [] : dbEditAudit.rows[0].changes;
  check("审计留痕：action=update 且 changes 含 title 改名", dbEditAudit.rows.length >= 2 && dbEditAudit.rows[0].action === "update" && Array.isArray(editChanges) && editChanges.some((entry) => entry.field === "title" && entry.to === nodeEditedTitle), dbEditAudit.rows.map((row) => row.action).join(" / "));
  const editedTitles = await ev(LEFT_TITLES);
  check("左列卡片换成新名字", editedTitles !== null && editedTitles.some((item) => String(item).indexOf(nodeEditedTitle) === 0), "页面 " + String(editedTitles === null ? -1 : editedTitles.length) + " 张");

  // ---------- ⑤ 删除节点（红胶囊 → 确认条）----------
  await page.send("Page.navigate", { url: TEMPLATES_URL });
  await sleep(4200);
  check("点节点卡片上的红胶囊删除", (await ev(CLICK_DELETE_NODE(nodeEditedTitle))) === true);
  await sleep(700);
  const barText = flat(await ev(CONFIRM_BAR_TEXT));
  check("底部出现确认条（含节点名与「不受影响」口径）", barText.indexOf(nodeEditedTitle) >= 0 && barText.indexOf("已经生成的项目任务不受影响") >= 0, barText.slice(0, 200));
  check("点确认条上的「删除」", (await ev(CLICK_CONFIRM_DELETE)) === true);
  await sleep(2800);
  const afterDelete = await api("/api/v1/task-nodes?stage=presale");
  check("删除生效：读面回到基线（total " + String(baselineTotal) + "）", afterDelete.json !== null && afterDelete.json.total === baselineTotal && (afterDelete.json.items || []).every((item) => item.title !== nodeEditedTitle), String(afterDelete.json === null ? -1 : afterDelete.json.total));
  const dbGone = await db.query("select count(*)::int as c from task_nodes where title = $1", [nodeEditedTitle]);
  check("DB 物理删行（task_nodes 里已无该行）", dbGone.rows[0].c === 0, JSON.stringify(dbGone.rows[0]));
  const dbAudit = await db.query("select action, object_type, object_id, summary from audit_logs where object_type = $1 and object_id = $2 order by id desc limit 3", ["task_node", addedNode === undefined ? "" : addedNode.id]);
  check("审计留痕：action=delete / object_type=task_node / object_id=节点 id", dbAudit.rows.length >= 2 && dbAudit.rows[0].action === "delete" && dbAudit.rows[0].object_id === addedNode.id, dbAudit.rows.map((row) => row.action + ":" + row.object_type).join(" / "));
  check("审计里也留了新增那一条（action=create）", dbAudit.rows.some((row) => row.action === "create"), dbAudit.rows.map((row) => row.action).join(" / "));
  const afterDeleteTitles = await ev(LEFT_TITLES);
  check("左列卡片消失（回到基线张数）", afterDeleteTitles !== null && afterDeleteTitles.length === baselineTotal && afterDeleteTitles.every((item) => String(item).indexOf(nodeEditedTitle) < 0), "页面 " + String(afterDeleteTitles === null ? -1 : afterDeleteTitles.length) + " 张");
  const survivor = await api("/api/v1/projects/" + projectId + "/tasks?limit=200");
  check("已生成的项目任务不受影响（那条任务还在）", survivor.json !== null && (survivor.json.items || []).some((item) => item.id === createdTaskId), String(survivor.json === null ? -1 : survivor.json.total) + " 条");
} catch (error) {
  console.log("回放中断：" + String(error && error.message ? error.message : error));
  checks.push(false);
} finally {
  // ---------- 清理（零残留）----------
  try {
    const leftovers = await api("/api/v1/task-nodes?stage=presale");
    let removed = 0;
    for (const item of leftovers.json === null ? [] : leftovers.json.items) {
      if (item.title === nodeEditedTitle || item.title === nodeTitle) {
        const res = await api("/api/v1/task-nodes/" + item.id, "DELETE");
        if (res.status === 200 || res.status === 204) removed += 1;
      }
    }
    const finalNodes = await api("/api/v1/task-nodes?stage=presale");
    check("清理：临时节点零残留", finalNodes.json !== null && finalNodes.json.total === baselineTotal, "删了 " + String(removed) + " 条 · 现值 " + String(finalNodes.json === null ? -1 : finalNodes.json.total));
    if (projectId !== "") {
      const tasks = await api("/api/v1/projects/" + projectId + "/tasks?limit=200");
      let deletedTasks = 0;
      for (const item of tasks.json === null ? [] : tasks.json.items) {
        const res = await api("/api/v1/projects/" + projectId + "/tasks/" + item.id, "DELETE", undefined, { "If-Match": String(item.version) });
        if (res.status === 200 || res.status === 204) deletedTasks += 1;
      }
      const projectRow = await api("/api/v1/projects/" + projectId);
      const delProject = await api("/api/v1/projects/" + projectId, "DELETE", undefined, { "If-Match": String(projectRow.json === null ? 0 : projectRow.json.version) });
      check("清理：临时任务逐条软删 + 临时项目硬删", (delProject.status === 200 || delProject.status === 204) && deletedTasks >= 1, String(deletedTasks) + " 条任务 / 项目 " + String(delProject.status));
      const projectGoneRow = await db.query("select count(*)::int as n from projects where id = $1", [projectId]);
      check("清理：临时项目物理删（projects 行不存在）", Number(projectGoneRow.rows[0].n) === 0, JSON.stringify(projectGoneRow.rows[0]));
    }
  } catch (error) {
    console.log("清理异常：" + String(error && error.message ? error.message : error));
    checks.push(false);
  }
  await db.query("update sessions set revoked_at = now() where token_hash = $1", [sha256(token)]);
  console.log("已撤销临时会话：" + userRow.username);
}

// ---------- 收尾 ----------
const failed = checks.filter((ok) => ok !== true).length;
console.log("—— 合计 " + String(checks.length) + " 项：" + String(checks.length - failed) + " 通过 / " + String(failed) + " 失败 ——");
const pageEvents = page.events.filter((line) => line.indexOf("EVT ") === 0);
console.log("页面控制台 / 异常：" + String(pageEvents.length) + " 条");
for (const line of pageEvents.slice(0, 8)) {
  console.log("  " + line.slice(0, 240));
}
try { page.ws.close(); } catch (error) { /* 忽略 */ }
chrome.kill();
await db.end();
process.exit(failed === 0 ? 0 : 1);
