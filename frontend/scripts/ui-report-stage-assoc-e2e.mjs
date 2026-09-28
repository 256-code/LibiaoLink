#!/usr/bin/env node
/**
 * LibiaoLink 前端 · 回放：日报「关联任务 → 关联阶段」+「日报记录列收窄」+「导航栏图标 / 吸顶」+「分点提示 / 归类多选 / 记录口径 / 暂存保留」（业务口径 2026-09-28 · Push 198 / 199 / 200 / 201 / 202）
 *
 * 业务口径：「日报这里关联任务改成关联阶段」——「日报填写」表单的「关联任务」多选（原列项目现有任务 + 负责人）
 * 改为「关联阶段」多选：选项 = 九个施工阶段（与项目总览分组 / 两块看板同一份口径、固定顺序 售前规划 → 验收），
 * 不再列具体任务；「日报记录」列头同步 = 「关联阶段」。
 * 本脚本用**真实鼠标 / 真实键盘**（CDP Input，不是合成 click()）在真机浏览器上验五组事：
 *   ① 项目详情「日报及问题 → 日报填写」：字段标题 = 「关联阶段」，说明不再提「关联任务 / 回写」；
 *      页内导航栏「问题看板」项图标 = 业务给的面性圆环感叹号 SVG（16×16，其余三项照旧描边）；
 *   ② 多选项 = 恰好九枚（顺序 = 售前规划 / 设计开发 / 加工采购 / 组装发货 / 硬件实施 / 软件部署 / 试运行 / 生产阶段 / 验收），
 *      **不再列任务名**（对照组：真实项目任务「布局定档」不出现在表单里）；
 *   ③ 真实鼠标勾选「硬件实施」「试运行」→ 填「当日完成工作」→ 点「提交日报」：自动切到「日报记录」；
 *   ④ 「日报记录」表头 = 收窄后的**六列**（时间 / 填写者 / 关联阶段 / 当日完成工作 / 明日计划 / 现场工作附图；
 *      不再含「关联任务 / 今日施工人数 / 现场发现问题 / 解决方案或建议」，行 = 6 个单元格）；
 *      最新一行关联阶段列 = 「硬件实施、试运行」、状态 = 已提交；
 *   ⑤ 回「日报填写」表单已复位（勾选清零 / 完成工作清空）；跑完零残留（撤销临时会话；日报仍是内存态 —— 库内 daily_reports 不增行）。
 *
 * Push 199 追加（业务口径 2026-09-28「日报记录里面不需要体现这两个 以及施工人数」+「只保留 填写者 / 关联任务 /
 *   当日完成工作 / 明日计划 / 现场附图」）：「日报记录」列表收窄为**六列** —— 时间 / 填写者 / 关联阶段 / 当日完成工作 /
 *   明日计划 / 现场工作附图；「今日施工人数 / 现场发现问题 / 解决方案或建议」三列从列表展示去掉（只改列表展示：
 *   表单字段与 A3-09 问题生成口径不变）。④ 组断言随之更新（列数 = 6 + 不含四词 + 行内下标前移 + 问题探针清零）；
 *   同批：「问题看板」项图标换业务给 SVG（① 组新增 3 项断言 —— 新图标就位 / 旧竖列图标下架 / 其余三项仍描边）。
 *
 * Push 200 追加（业务口径 2026-09-28「做吸顶效果」+「问题追溯改成这个 但是不能照搬 应该要修改」（实指「问题追踪」项））：
 *   ① 「问题追踪」项图标换业务给样 —— 「文件 + 警示圈」（原 512×512 实心版首跑后业务反馈「不好看」→ 改浅版：文件描边走
 *      1.8px + 小警示环，与「问题看板」徽章同一套语言）；② 页内导航栏整排**吸顶** —— 滚动时停在顶栏（h-16 = 64px）正下方
 *      （站灰底 + 毛玻璃）。断言：① 组 +2（问题追踪新图标就位 / 旧表格图标下架）并把「其余仍描边」收成 2 项；
 *      ⑥ 组 +1（缩小视口 → 滚动 → 粘在顶栏下方）。
 *
 * Push 201 追加（业务口径 2026-09-28「这个也做吸顶效果吧 图二吸顶后有bug」+「把问题看板的svg给问题追溯 /
 *   问题看板的svg 改成这个（放大镜）」）：① **主标签栏吸顶** —— 项目详情页五视图标签整条横幅粘在顶栏（64px）正下方，
 *   自身 59px（pt-3 12 + 标签 46 + 底边 1），页面里其它吸顶元素一律叠在它下面（top = 64 + 59 = 123px）：
 *   项目总览任务表头（[data-board-head]）与「日报及问题」页内导航栏；② 页内导航栏**修投影外溢** —— 下内衬 8 → 16px
 *   （键帽立体投影最深 ≈ 12px，原来糊到下方「日报记录」标题上、标题还被横幅下沿切一刀），z 20 → 10（不反压主标签栏）；
 *   ③ 图标对调 —— 「问题追踪」改用原「问题看板」的「圆环 + 感叹号」徽章，「问题看板」改业务给样「放大镜」
 *   （24 视框 · fillRule evenodd · fill=currentColor）。断言：① 组三条改写（放大镜就位 / 徽章让位 / 文件 + 警示圈下架）；
 *   ⑥ 组重写为 4 项（主标签栏吸顶 / 页内条叠放 + 内衬兜住投影 / 项目总览任务表头叠放）。
 *
 * Push 201 补（业务口径 2026-09-28「这里的字被吞掉了」，问题看板截图）：页内导航栏上一版用负下边距抵消内衬，
 *   而 Tailwind v4 的 space-y-5 走的是**元素自身 margin-bottom** —— 负 mb 把下面第一块内容拽进横幅里，
 *   区块标题被横幅盖住 16px、只剩几像素的残影。改为 mb-1（4px = 20 space-y − 16 pb）：横幅下沿与下方内容留 4px，
 *   键帽 / 横幅 / 内容三者位置同时回到设计值；⑥ 组补 2 项断言（日报填写 / 问题看板 各一条：未吸顶时下一个兄弟 top ≥ 横幅下沿 +2px）。
 *
 * Push 201 再补（业务口径 2026-09-28「这个中间有条缝可以有办法解决一下吗」，项目总览截图）：吸顶条下边框在带缩放的屏
 *   （Windows 150% 等）被按设备像素吸附成 0.67px —— 栏高 59 → 58.67、下沿实际落在 122.67；下面两层吸顶元素钉 123
 *   会露 0.33px 缝，滚动时白行 / 蓝色徽章从缝里闪过去。两张吸顶表（项目总览任务表头 / 日报及问题页内导航栏）
 *   top 123 → **122px（向上多叠 1px）**，项目总览表头 z 20 → 19（低于主标签栏 z-20：叠压时下边框仍画在表头上）；
 *   ⑥ 组两条叠放断言升级为「缝不变量」：叠层 top ≤ 主标签栏下沿 − 下边框宽（覆盖缩放屏下边框变细的情形）。
 *
 * Push 202 追加（业务口径 2026-09-28「填日报文字提示如图分点」+「问题归类可以多选」+「日报记录英文加上 如图所示」
 *   +「时间格式也要年月日 具体提交时间不需要 已提交状态也不要」+「点击暂存草稿就暂存在日报填写页面吧 … 暂存就保留
 *   表单里面填的内容皆可」）：① 「日报填写」的「当日完成工作Work completed today」「明日计划Tomorrow's plan」
 *   「现场发现问题Problem」三个多行框**补英文表头**（三行分点占位提示先落、随后业务看后撤回：「算了 不要提示文字了」——
 *   最终三框**无占位提示文字**、行数回到原口径）；② 「问题归类」改**多选**（弹层点选不关闭、选中项绿勾、触发器顿号连接），
 *   原型存储口径 = 多值顿号连接；③ 「日报记录」六列表头改**中英拼写**、时间列改**年月日**、撤「提交 HH:MM」小字与状态签；
 *   ④ 「暂存草稿」不写记录、不切子视图、不清表单（只保留表单内容 + 顶部提示）。
 *   另：「现场发现问题」撤琥珀色特殊底 / 字色（「这个也不用搞特殊 样式和别的保持一致」）、表单字段标题统一加粗
 *   （「标题都标标粗」）。
 *   断言：② 组 +3（双语表头 / 三框无占位提示 / 标题加粗）、④ 组 1 条状态断言拆成 2 条（时间列年月日 + 无状态签 · 净 +1）、
 *   ⑤b 组新增 9 项（多选弹层 / 两项绿勾 / 触发器顿号 / Esc 关闭 / 暂存提示 / 悬停背景 / 内容保留 / 不切视图 / 不写记录）；
 *   另：「暂存草稿」悬停反馈加明显（「鼠标放到暂存草稿的ui效果不太明显」——描边 200 → 400、背景 zinc-100、字色转深）；合计 59 项。
 *
 * Push 202 同批续（业务口径 2026-09-28「附图要可以复制粘贴 不能全靠选择文件 我们以复制粘贴为主」）：两个附图区
 *   （现场工作附图 / 当前问题附图）改 AttachmentPicker —— **粘贴为主入口**（点一下虚线区拿到焦点，Ctrl+V 直接粘图；
 *   剪贴板图没有名字时按「剪贴板图片-N.png」命名；附件胶囊可逐个移除）、「选择文件」降为次入口（原生文件框仍在）。
 *   ⑤c 组新增 12 项（两区常驻 + 次入口仍在 / 点一下进就绪态 / 粘贴出胶囊 / × 可移除 / 第二区同套生效 / 缩略图预览 / 点开大图 / Esc 关预览 / 点名字进编辑 / Esc 取消改名 / 回车自定义名 / 记录列表出缩略图）；
 *   同批续二（业务口径「图片要可以预览」+「图片名称可以自定义」）：胶囊出**缩略图**（`URL.createObjectURL`）、点开**大图预览层**（点任意处 / Esc 关）、**点名字可自定义**（回车 / 失焦提交、Esc 取消）；
 *   粘贴优先走**真实剪贴板 + 真实 Ctrl+V**（CDP 授权 clipboardReadWrite + Input.dispatchKeyEvent 走浏览器 paste 加速键），
 *   剪贴板不可用才回落合成 ClipboardEvent（两条路都打在真实 document 监听上）。
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
import { deflateSync } from "node:zlib";
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
const REPORT_HEADERS = ["时间time", "填写者", "关联阶段Related stages", "当日完成工作Work completed today", "明日计划Tomorrow's plan", "现场工作附图On-site photos"];
const STATE_WORDS = ["已提交", "草稿", "补填"];
const DROPPED_HEADERS = ["今日施工人数", "现场发现问题", "解决方案或建议"];
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
// 无头页默认「不聚焦」——浏览器粘贴命令只在聚焦文档里可用（Push 202 同批续：真实 Ctrl+V 回放用）
await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ev = async (expression) => {
  const reply = await page.send("Runtime.evaluate", { expression, returnByValue: true });
  if (reply.exceptionDetails !== undefined) {
    throw new Error("页面表达式抛异常：" + JSON.stringify(reply.exceptionDetails).slice(0, 300) + " | 表达式：" + expression.slice(0, 160));
  }
  return reply.result.value;
};
/** 同 ev，但等页面 Promise 落地（真实剪贴板写入这类异步操作用；userGesture = 给一次瞬时激活）。 */
const evAwait = async (expression, userGesture) => {
  const params = { expression, returnByValue: true, awaitPromise: true };
  if (userGesture === true) {
    params.userGesture = true;
  }
  const reply = await page.send("Runtime.evaluate", params);
  if (reply.exceptionDetails !== undefined) {
    return "THROWN:" + JSON.stringify(reply.exceptionDetails).slice(0, 200);
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
/** 1×1 红色 PNG（真实剪贴板写入用；手搓字节 + 手写 CRC32，避免引入依赖 / 依赖 Node 版本）。 */
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
  const idat = deflateSync(Buffer.from([0, 255, 64, 32]));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
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
const tabIcons = await ev(
  "(function(){var out=[];var bs=document.querySelectorAll(" + j("[data-subnav-item]") + ");" +
  "for(var i=0;i<bs.length;i++){var svg=bs[i].querySelector(" + j("svg") + ");var p=svg===null?null:svg.querySelector(" + j("path") + ");" +
  "out.push({tab:bs[i].getAttribute(" + j("data-subnav-item") + "),viewBox:svg===null?null:svg.getAttribute(" + j("viewBox") + ")," +
  "stroke:svg===null?null:svg.getAttribute(" + j("stroke") + "),paths:svg===null?-1:svg.querySelectorAll(" + j("path") + ").length," +
  "rects:svg===null?-1:svg.querySelectorAll(" + j("rect") + ").length," +
  "fill:p===null?" + j("") + ":(p.getAttribute(" + j("fill") + ")||" + j("") + ")," +
  "fillRule:p===null?null:(p.getAttribute(" + j("fill-rule") + ")||p.getAttribute(" + j("fillRule") + "))," +
  "d:p===null?" + j("") + ":(p.getAttribute(" + j("d") + ")||" + j("") + ")});}return out;})()"
);
const boardIcon = Array.isArray(tabIcons) ? tabIcons.filter((item) => item.tab === "问题看板")[0] : undefined;
check("① 问题看板项图标 = 业务给样「放大镜」（24 视框 · path M9.5 17… · fill=currentColor · fillRule=evenodd · Push 201 换）",
  boardIcon !== undefined && boardIcon.viewBox === "0 0 24 24" && boardIcon.d.indexOf("M9.5 17c1.71") === 0 &&
  boardIcon.fill === "currentColor" && boardIcon.fillRule === "evenodd" && boardIcon.stroke === null,
  boardIcon === undefined ? "-" : boardIcon.viewBox + " · " + boardIcon.d.slice(0, 12) + " · fill=" + String(boardIcon.fill) + " · rule=" + String(boardIcon.fillRule));
check("① 问题看板项原「圆环 + 感叹号」徽章已让位（viewBox 不再 16×16 · d 不再 M7.493 开头）",
  boardIcon !== undefined && boardIcon.viewBox !== "0 0 16 16" && boardIcon.d.indexOf("M7.493") < 0,
  boardIcon === undefined ? "-" : boardIcon.viewBox + " · " + boardIcon.d.slice(0, 10));
const trackIcon = Array.isArray(tabIcons) ? tabIcons.filter((item) => item.tab === "问题追踪")[0] : undefined;
check("① 问题追踪项图标 = 「圆环 + 感叹号」面性徽章（16×16 · path M7.493 0.015… · fill=currentColor · 原「问题看板」样让位）",
  trackIcon !== undefined && trackIcon.viewBox === "0 0 16 16" && trackIcon.d.indexOf("M7.493 0.015") === 0 &&
  trackIcon.fill === "currentColor" && trackIcon.stroke === null,
  trackIcon === undefined ? "-" : trackIcon.viewBox + " · " + trackIcon.d.slice(0, 12) + " · fill=" + String(trackIcon.fill));
check("① 问题追踪项原「文件 + 警示圈」浅版图标已下架（无 24 视框 · 无 M13.5 3H6.75 文件页 · 无 M17.2 12.9 警示环）",
  trackIcon !== undefined && trackIcon.viewBox !== "0 0 24 24" && trackIcon.d.indexOf("M13.5 3H6.75") < 0 && trackIcon.d.indexOf("17.2 12.9") < 0,
  trackIcon === undefined ? "-" : "viewBox=" + String(trackIcon.viewBox));
const strokeTabs = Array.isArray(tabIcons) ? tabIcons.filter((item) => item.tab !== "问题看板" && item.tab !== "问题追踪") : [];
check("① 其余两项导航图标照旧描边（stroke = currentColor · 共 2 项）",
  strokeTabs.length === 2 && strokeTabs.every((item) => item.stroke === "currentColor"),
  strokeTabs.map((item) => item.tab + ":" + String(item.stroke)).join(" / "));
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
const holdProbe = await ev(
  "(function(){var d=document.querySelector(" + j('[data-fill-form] textarea[data-field="doneWork"]') + ");" +
  "var p=document.querySelector(" + j('[data-fill-form] textarea[data-field="plan"]') + ");" +
  "var f=document.querySelector(" + j('[data-fill-form] textarea[data-field="foundIssue"]') + ");" +
  "return {done:d===null?null:d.getAttribute(" + j("placeholder") + "),plan:p===null?null:p.getAttribute(" + j("placeholder") + "),found:f===null?null:f.getAttribute(" + j("placeholder") + ")};})()"
);
check("② 当日完成工作 / 明日计划 / 现场发现问题 三个多行框无占位提示文字（业务口径「算了 不要提示文字了」）",
  holdProbe !== null && holdProbe.done === null && holdProbe.plan === null && holdProbe.found === null,
  holdProbe === null ? "-" : JSON.stringify(holdProbe));
check("② 表头双语：当日完成工作Work completed today / 明日计划Tomorrow's plan / 现场发现问题Problem（图 1 / 图 3 口径）",
  form0 !== null && form0.text.indexOf("当日完成工作Work completed today") >= 0 && form0.text.indexOf("明日计划Tomorrow's plan") >= 0 && form0.text.indexOf("现场发现问题Problem") >= 0,
  form0 === null ? "-" : "ok");
const labelWeight = await ev(
  "(function(){var f=document.querySelector(" + j("[data-fill-form]") + ");if(f===null){return null;}" +
  "var ss=f.querySelectorAll(" + j("span") + ");for(var i=0;i<ss.length;i++){if(ss[i].textContent.trim()===" + j("明日计划Tomorrow's plan") + "){return getComputedStyle(ss[i]).fontWeight;}}return null;})()"
);
check("② 表单字段标题加粗（「明日计划Tomorrow's plan」标签 computed font-weight = 700 · 业务口径「标题都标标粗」）",
  labelWeight === "700", String(labelWeight));

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

// ---------- ④ 日报记录：列头（Push 199 收窄后六列）/ 最新一行 ----------
const headers = await ev(
  "(function(){var ts=document.querySelectorAll(" + j("table") + ");for(var i=0;i<ts.length;i++){" +
  "var hs=ts[i].querySelectorAll(" + j("thead th") + ");var out=[];for(var k=0;k<hs.length;k++){out.push(hs[k].textContent.trim());}" +
  "if(out.indexOf(" + j("关联阶段Related stages") + ")>=0||out.indexOf(" + j("关联任务") + ")>=0){return out;}}return null;})()"
);
check("④ 日报记录表头含「关联阶段Related stages」", Array.isArray(headers) && headers.indexOf("关联阶段Related stages") >= 0, Array.isArray(headers) ? headers.join(" / ") : String(headers));
check("④ 日报记录表头不再有「关联任务」", Array.isArray(headers) && headers.indexOf("关联任务") < 0, Array.isArray(headers) ? "ok" : "-");
check("④ 日报记录表头 = 恰好六列且中英拼写（时间time / 填写者 / 关联阶段Related stages / 当日完成工作Work completed today / 明日计划Tomorrow's plan / 现场工作附图On-site photos · Push 202）",
  Array.isArray(headers) && headers.length === 6 && REPORT_HEADERS.every((name, index) => headers[index] === name),
  Array.isArray(headers) ? headers.join(" / ") : String(headers));
check("④ 日报记录表头不含「今日施工人数 / 现场发现问题 / 解决方案或建议」（Push 199 只保留内容列）",
  Array.isArray(headers) && DROPPED_HEADERS.every((word) => headers.indexOf(word) < 0), Array.isArray(headers) ? "ok" : "-");
const rowProbe = await ev(
  "(function(){var r=document.querySelector(" + j("[data-report-row]") + ");if(r===null){return null;}" +
  "var tds=r.querySelectorAll(" + j("td") + ");return {id:r.getAttribute(" + j("data-report-row") + "),cells:tds.length," +
  "time:tds[0]===undefined?" + j("") + ":tds[0].textContent.trim()," +
  "stage:tds[2]===undefined?" + j("") + ":tds[2].textContent.trim(),done:tds[3]===undefined?" + j("") + ":tds[3].textContent.trim()," +
  "text:(r.textContent||" + j("") + ")};})()"
);
const issueProbes = await ev("document.querySelectorAll(" + j("[data-report-issue-link]") + ").length");
check("④ 最新一行 = 6 个单元格（与收窄后的列头一一对齐）", rowProbe !== null && rowProbe.cells === 6, rowProbe === null ? "-" : String(rowProbe.cells));
check("④ 列表已无问题记录探针 [data-report-issue-link]（该列随 Push 199 移除）", issueProbes === 0, String(issueProbes));
check("④ 最新一行关联阶段列 = 「" + PICK[0] + "、" + PICK[1] + "」", rowProbe !== null && rowProbe.stage === PICK[0] + "、" + PICK[1], rowProbe === null ? "-" : String(rowProbe.stage));
check("④ 最新一行「当日完成工作」= 回放文本", rowProbe !== null && rowProbe.done === DONE_TEXT, rowProbe === null ? "-" : String(rowProbe.done));
const CN_DATE = /^\d{4}年\d{1,2}月\d{1,2}日$/;
check("④ 最新一行时间列 = 年月日（YYYY年M月D日 · 业务口径「时间格式也要年月日」）且不带「提交 HH:MM」小字",
  rowProbe !== null && CN_DATE.test(rowProbe.time) && rowProbe.text.indexOf("提交") < 0, rowProbe === null ? "-" : String(rowProbe.time));
check("④ 最新一行不再有状态签（已提交 / 草稿 / 补填 三词都不在行内 · 业务口径「已提交状态也不要」）",
  rowProbe !== null && STATE_WORDS.every((word) => rowProbe.text.indexOf(word) < 0), rowProbe === null ? "-" : "ok");

// ---------- ⑤ 回「日报填写」表单复位 ----------
await clickSelector('[data-subnav-item="日报填写"]');
const backReady = await waitFor("document.querySelector(" + j("[data-fill-form]") + ")!==null");
const form2 = await ev(formExpr());
check("⑤ 回「日报填写」：表单复位（勾选 0 / 完成工作清空）", backReady === true && form2 !== null && form2.checked === 0 && form2.text.indexOf(DONE_TEXT) < 0, form2 === null ? "-" : "checked=" + String(form2.checked));

// ---------- ⑤b 暂存草稿（Push 202：保留表单内容 / 不写记录 / 不切子视图）+ 问题归类多选（业务口径「问题归类可以多选」） ----------
const STAMP = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
const PLAN_TEXT = "回放·明日计划·" + STAMP;
const ISSUE_TEXT = "回放·现场问题·" + STAMP;
await typeInto('[data-fill-form] textarea[data-field="plan"]', PLAN_TEXT);
await typeInto('[data-fill-form] textarea[data-field="foundIssue"]', ISSUE_TEXT);
await clickStageLabel(PICK[0]);
await clickSelector('[data-field="issueCategory"] button');
const multiOpen = await waitFor("document.querySelector(" + j("[data-multi-popover]") + ")!==null");
check("⑤b 问题归类多选弹层可打开（[data-multi-popover] 就位 · Push 202 该字段由单选改多选）", multiOpen === true, String(multiOpen));
await clickSelector('[data-multi-option="物流原因"]');
await clickSelector('[data-multi-option="供应商原因"]');
const multiProbe = await ev(
  "(function(){var pop=document.querySelector(" + j("[data-multi-popover]") + ");if(pop===null){return null;}" +
  "var sel=pop.querySelectorAll(" + j('[role="option"][aria-selected="true"]') + ");var names=[];for(var i=0;i<sel.length;i++){names.push(sel[i].getAttribute(" + j("data-multi-option") + "));}" +
  "var box=document.querySelector(" + j('[data-field="issueCategory"]') + ");" +
  "return {sel:names,trigger:box===null?" + j("") + ":box.textContent.trim()};})()"
);
check("⑤b 勾选「物流原因」「供应商原因」→ 2 项绿勾（aria-selected · 弹层点选不关闭）",
  multiProbe !== null && multiProbe.sel.length === 2 && multiProbe.sel.indexOf("物流原因") >= 0 && multiProbe.sel.indexOf("供应商原因") >= 0,
  multiProbe === null ? "-" : multiProbe.sel.join(" / "));
check("⑤b 触发器显示已选两项（顿号连接）", multiProbe !== null && multiProbe.trigger.indexOf("物流原因、供应商原因") >= 0, multiProbe === null ? "-" : String(multiProbe.trigger));
await pressKey("Escape", "Escape", 27);
const multiClosed = await waitFor("document.querySelector(" + j("[data-multi-popover]") + ")===null");
check("⑤b Esc 关闭弹层（站点浮层同一套关闭口径）", multiClosed === true, String(multiClosed));
const draftPoint = await clickSelector('[data-fill-form] button[data-action="draft"]');
await sleep(400);
const draftHoverBg = await ev("(function(){var b=document.querySelector(" + j('[data-fill-form] button[data-action="draft"]') + ");return b===null?null:getComputedStyle(b).backgroundColor;})()");
check("⑤b 暂存草稿悬停反馈明显（指针停在按钮上时背景 = zinc-100（oklch(0.967 …) / rgb(244,244,245)）· 业务口径「鼠标放到暂存草稿的ui效果不太明显」）",
  draftHoverBg !== null && (String(draftHoverBg) === "rgb(244, 244, 245)" || String(draftHoverBg).indexOf("oklch(0.967") >= 0),
  String(draftHoverBg) + (draftPoint === null ? " · no point" : ""));
const draftNotice = await ev("(function(){var n=document.querySelector(" + j("[data-subnav-notice]") + ");return n===null?null:n.textContent.trim();})()");
check("⑤b 暂存草稿 → 顶部提示「已暂存」（不写记录 / 不切视图 / 不清表单）", draftNotice !== null && draftNotice.indexOf("已暂存") >= 0, draftNotice === null ? "-" : String(draftNotice));
const keptProbe = await ev(
  "(function(){var f=document.querySelector(" + j("[data-fill-form]") + ");if(f===null){return null;}" +
  "var plan=f.querySelector(" + j('textarea[data-field="plan"]') + ");var issue=f.querySelector(" + j('textarea[data-field="foundIssue"]') + ");" +
  "var box=f.querySelector(" + j('[data-field="stages"]') + ");var inputs=box===null?[]:box.querySelectorAll(" + j("input[type=checkbox]") + ");var checked=0;for(var i=0;i<inputs.length;i++){if(inputs[i].checked){checked++;}}" +
  "var cat=document.querySelector(" + j('[data-field="issueCategory"]') + ");" +
  "return {plan:plan===null?" + j("") + ":plan.value,issue:issue===null?" + j("") + ":issue.value,checked:checked,cat:cat===null?" + j("") + ":cat.textContent.trim()};})()"
);
check("⑤b 暂存后表单内容保留（明日计划 / 现场发现问题 / 勾选 1 阶段 / 归类两项 · 业务口径「暂存就保留表单里面填的内容皆可」）",
  keptProbe !== null && keptProbe.plan === PLAN_TEXT && keptProbe.issue === ISSUE_TEXT && keptProbe.checked === 1 && keptProbe.cat.indexOf("物流原因、供应商原因") >= 0,
  keptProbe === null ? "-" : JSON.stringify(keptProbe));
const stillFill = await ev("(function(){var b=document.querySelector(" + j('[data-subnav-item="日报填写"]') + ");return b!==null && b.getAttribute(" + j("aria-current") + ")===" + j("page") + ";})()");
check("⑤b 暂存后仍停在「日报填写」（不再自动切「日报记录」）", stillFill === true, String(stillFill));
await clickSelector('[data-subnav-item="日报记录"]');
await waitFor("document.querySelector(" + j("[data-report-row]") + ")!==null");
const rowsAfterDraft = await ev("document.querySelectorAll(" + j("[data-report-row]") + ").length");
check("⑤b 暂存不写「日报记录」（行数仍是提交产生的 1 行）", rowsAfterDraft === 1, String(rowsAfterDraft));
await clickSelector('[data-subnav-item="日报填写"]');
await waitFor("document.querySelector(" + j("[data-fill-form]") + ")!==null");

// ---------- ⑤c 附图：以「复制粘贴」为主入口（Push 202 同批续 · 业务口径「附图要可以复制粘贴 不能全靠选择文件 我们以复制粘贴为主」） ----------
const PNG_B64 = pngBytes().toString("base64");
const zonesProbe = await ev(
  "(function(){var f=document.querySelector(" + j("[data-fill-form]") + ");if(f===null){return null;}" +
  "var photo=f.querySelector(" + j("[data-paste-zone=photos]") + ");var issue=f.querySelector(" + j("[data-paste-zone=issuePhotos]") + ");" +
  "var fileInputs=f.querySelectorAll(" + j("input[type=file]") + ");" +
  "var ph=photo===null?null:photo.querySelector(" + j("[data-paste-half]") + ");var fh=photo===null?null:photo.querySelector(" + j("[data-file-half]") + ");" +
  "return {photo:photo!==null,issue:issue!==null,files:fileInputs.length," +
  "pasteSvg:ph===null?0:ph.querySelectorAll(" + j("svg") + ").length,pasteText:ph===null?" + j("") + ":ph.textContent.trim(),pasteAria:ph===null?" + j("") + ":String(ph.getAttribute(" + j("aria-label") + "))," +
  "fileSvg:fh===null?0:fh.querySelectorAll(" + j("svg") + ").length,fileText:fh===null?" + j("") + ":fh.textContent.trim(),fileAria:fh===null?" + j("") + ":String(fh.getAttribute(" + j("aria-label") + "))};})()"
);
check("⑤c 两个附图区（现场工作附图 / 当前问题附图）常驻 = 虚线卡左右分半：左半 `ctrl v` 键帽（Ctrl+V 主入口 · 键帽风底 + 内阴影）+ 右半文件 / 云图标（点击选择文件 · 原生文件框仍 2 个 · 两半无说明文字）",
  zonesProbe !== null && zonesProbe.photo === true && zonesProbe.issue === true && zonesProbe.files === 2 &&
  zonesProbe.pasteText.replace(/\s+/g, " ").trim().toLowerCase() === "ctrl v" && zonesProbe.pasteAria.indexOf("Ctrl+V") >= 0 &&
  zonesProbe.fileSvg === 1 && zonesProbe.fileText === "" && zonesProbe.fileAria.indexOf("选择文件") >= 0,
  zonesProbe === null ? "-" : JSON.stringify(zonesProbe));
await clickSelector("[data-paste-zone=photos] [data-paste-half]");
const armedProbe = await ev(
  "(function(){var p=document.querySelector(" + j("[data-paste-zone=photos]") + ");var q=document.querySelector(" + j("[data-paste-zone=issuePhotos]") + ");" +
  "var h=p===null?null:p.querySelector(" + j("[data-paste-hint]") + ");var h2=q===null?null:q.querySelector(" + j("[data-paste-hint]") + ");" +
  "var sink=p===null?null:p.querySelector(" + j("[data-paste-sink]") + ");var act=document.activeElement;" +
  "return {photo:h===null?null:h.getAttribute(" + j("data-paste-hint") + "),issue:h2===null?null:h2.getAttribute(" + j("data-paste-hint") + ")," +
  "sinkFocused:sink!==null && act===sink,activeTag:act===null?" + j("") + ":act.tagName};})()"
);
check("⑤c 真实鼠标点一下「现场工作附图」左半 → 就绪态（data-paste-hint=armed · 焦点落在不可见粘贴落点 INPUT 上 —— 浏览器只对有可编辑焦点的元素执行 Ctrl+V）· 未点的另一区仍 idle",
  armedProbe !== null && armedProbe.photo === "armed" && armedProbe.issue === "idle" && armedProbe.sinkFocused === true,
  armedProbe === null ? "-" : JSON.stringify(armedProbe));
// 粘贴：优先「真实剪贴板 + 真实 Ctrl+V」（CDP 授权 + Input.dispatchKeyEvent，按键走浏览器 paste 加速键）；
// 剪贴板不可用（无头环境偶发）才回落合成 ClipboardEvent —— 两条路都打在真实 document 监听上。
await page.send("Browser.grantPermissions", { origin: FRONTEND, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
const clipWrite = await evAwait(
  "(async function(){try{var bin=atob(" + j(PNG_B64) + ");var arr=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++){arr[i]=bin.charCodeAt(i);}" +
  "await navigator.clipboard.write([new ClipboardItem({" + j("image/png") + ":new Blob([arr],{type:" + j("image/png") + "})})]);return " + j("ok") + ";}catch(e){return " + j("ERR:") + "+String(e);}})()"
);
let pasteVia = "clipboard+ctrlv";
if (String(clipWrite) !== "ok") {
  pasteVia = "synthetic-event(" + String(clipWrite).slice(0, 60) + ")";
  await ev(
    "(function(){var bin=atob(" + j(PNG_B64) + ");var arr=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++){arr[i]=bin.charCodeAt(i);}" +
    "var dt=new DataTransfer();dt.items.add(new File([new Blob([arr],{type:" + j("image/png") + "})]," + j("") + ",{type:" + j("image/png") + "}));" +
    "var e=new ClipboardEvent(" + j("paste") + ",{clipboardData:dt,bubbles:true,cancelable:true});document.dispatchEvent(e);return true;})()"
  );
} else {
  await page.send("Page.bringToFront");
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2, commands: ["paste"] });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2 });
}
await sleep(500);
const chipsExpr = (zone) =>
  "(function(){var z=document.querySelector(" + j("[data-paste-zone=" + zone + "]") + ");if(z===null){return null;}" +
  "var wrap=z.parentElement;if(wrap===null){return null;}var cs=wrap.querySelectorAll(" + j("[data-attachment]") + ");var names=[];for(var i=0;i<cs.length;i++){names.push(cs[i].getAttribute(" + j("data-attachment") + "));}" +
  "return {names:names};})()";
const chipsAfterPaste = await ev(chipsExpr("photos"));
check("⑤c 粘贴一张图（" + pasteVia + "）→ 「现场工作附图」出现附件胶囊；剪贴板图无文件名 → 按「剪贴板图片-1.png」命名",
  chipsAfterPaste !== null && chipsAfterPaste.names.length === 1 && chipsAfterPaste.names[0] === "剪贴板图片-1.png",
  chipsAfterPaste === null ? "-" : JSON.stringify(chipsAfterPaste.names));
await clickSelector('[data-attachment="剪贴板图片-1.png"] button[data-action="remove-attachment"]');
const chipsAfterRemove = await ev(chipsExpr("photos"));
check("⑤c 附件胶囊可逐个移除（点 × 后「现场工作附图」回到 0 个附件）",
  chipsAfterRemove !== null && chipsAfterRemove.names.length === 0,
  chipsAfterRemove === null ? "-" : JSON.stringify(chipsAfterRemove.names));
await clickSelector("[data-paste-zone=issuePhotos]");
if (String(clipWrite) !== "ok") {
  await ev(
    "(function(){var bin=atob(" + j(PNG_B64) + ");var arr=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++){arr[i]=bin.charCodeAt(i);}" +
    "var dt=new DataTransfer();dt.items.add(new File([new Blob([arr],{type:" + j("image/png") + "})]," + j("") + ",{type:" + j("image/png") + "}));" +
    "var e=new ClipboardEvent(" + j("paste") + ",{clipboardData:dt,bubbles:true,cancelable:true});document.dispatchEvent(e);return true;})()"
  );
} else {
  await page.send("Page.bringToFront");
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2, commands: ["paste"] });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2 });
}
await sleep(500);
const chipsIssueZone = await ev(chipsExpr("issuePhotos"));
check("⑤c 「当前问题附图」同一套粘贴（点一下再 Ctrl+V）→ 该区也收到「剪贴板图片-1.png」",
  chipsIssueZone !== null && chipsIssueZone.names.length === 1 && chipsIssueZone.names[0] === "剪贴板图片-1.png",
  chipsIssueZone === null ? "-" : JSON.stringify(chipsIssueZone.names));

// ⑤c 续：图片可预览（业务口径「图片要可以预览」）—— 胶囊缩略图 / 点开大图 / Esc 关 / 记录列表出缩略图
const thumbExpr = (zone) =>
  "(function(){var z=document.querySelector(" + j("[data-paste-zone=" + zone + "]") + ");if(z===null){return null;}" +
  "var wrap=document.querySelector(" + j("[data-attachment-strip=" + zone + "]") + ");if(wrap===null){return null;}var t=wrap.querySelector(" + j("[data-attachment-thumb] img") + ");" +
  "return t===null?null:{src:String(t.getAttribute(" + j("src") + ")),alt:String(t.getAttribute(" + j("alt") + ")),w:Math.round(t.getBoundingClientRect().width)};})()";
const thumbProbe = await ev(thumbExpr("issuePhotos"));
check("⑤c 粘贴后的图片胶囊带**缩略图**（[data-attachment-thumb] <img> 预览地址 = blob: 同源地址 · 业务口径「图片要可以预览」）",
  thumbProbe !== null && String(thumbProbe.src).indexOf("blob:") === 0 && thumbProbe.w > 0,
  thumbProbe === null ? "-" : JSON.stringify(thumbProbe));
await clickSelector("[data-attachment-strip=issuePhotos] [data-attachment-thumb]");
const previewOpen = await waitFor("document.querySelector(" + j("[data-photo-preview]") + ")!==null");
const previewProbe = await ev("(function(){var p=document.querySelector(" + j("[data-photo-preview]") + ");if(p===null){return null;}var img=p.querySelector(" + j("img") + ");var r=p.getBoundingClientRect();return {src:img===null?" + j("") + ":String(img.getAttribute(" + j("src") + ")),w:Math.round(r.width),h:Math.round(r.height)};})()");
check("⑤c 点缩略图 → 大图预览层（[data-photo-preview]）打开：放大图 = 与缩略图同一 blob 地址、浮层铺满视口",
  previewOpen === true && previewProbe !== null && thumbProbe !== null && String(previewProbe.src) === String(thumbProbe.src) &&
  Number(previewProbe.w) >= 300 && Number(previewProbe.h) >= 300,
  previewProbe === null ? "-" : JSON.stringify(previewProbe));
await pressKey("Escape", "Escape", 27);
const previewClosed = await waitFor("document.querySelector(" + j("[data-photo-preview]") + ")==null");
check("⑤c Esc 关预览层（与站内浮层同一套关闭口径）", previewClosed === true, String(previewClosed));
// 记录列表也出缩略图：给「现场工作附图」再粘一张 → 填当日完成工作 → 提交 → 最新一行的附图列
await clickSelector("[data-paste-zone=photos] [data-paste-half]");
if (String(clipWrite) !== "ok") {
  await ev(
    "(function(){var bin=atob(" + j(PNG_B64) + ");var arr=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++){arr[i]=bin.charCodeAt(i);}" +
    "var dt=new DataTransfer();dt.items.add(new File([new Blob([arr],{type:" + j("image/png") + "})]," + j("") + ",{type:" + j("image/png") + "}));" +
    "var e=new ClipboardEvent(" + j("paste") + ",{clipboardData:dt,bubbles:true,cancelable:true});document.dispatchEvent(e);return true;})()"
  );
} else {
  await page.send("Page.bringToFront");
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2, commands: ["paste"] });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2 });
}
await sleep(500);
// 图片名称可以自定义（业务口径「图片名称可以自定义」）：点名字进编辑 → 改 → Enter；Esc 取消
await clickSelector("[data-attachment-strip=photos] [data-rename-attachment]");
const renameOpen = await waitFor("document.querySelector(" + j("[data-attachment-input]") + ")!==null");
check("⑤c 点附图名字进编辑态（[data-attachment-input] 就位 · 带原名）",
  renameOpen === true, String(renameOpen));
await ev("(function(){var i=document.querySelector(" + j("[data-attachment-input]") + ");if(i===null){return null;}i.select();return true;})()");
await page.send("Input.insertText", { text: "加" });
await pressKey("Escape", "Escape", 27);
await sleep(300);
const nameAfterEsc = await ev("(function(){var s=document.querySelector(" + j("[data-attachment-strip=photos]") + ");if(s===null){return null;}var b=s.querySelector(" + j("[data-rename-attachment]") + ");return b===null?null:b.getAttribute(" + j("aria-label") + ");})()");
check("⑤c Esc 取消改名：名字保持原样（" + "剪贴板图片-2.png" + "）",
  nameAfterEsc !== null && String(nameAfterEsc) === "重命名 剪贴板图片-2.png", String(nameAfterEsc));
await clickSelector("[data-attachment-strip=photos] [data-rename-attachment]");
await waitFor("document.querySelector(" + j("[data-attachment-input]") + ")!==null");
const extProbe = await ev(
  "(function(){var s=document.querySelector(" + j("[data-attachment-strip=photos]") + ");if(s===null){return null;}" +
  "var box=s.querySelector(" + j("[data-attachment]") + ");if(box===null){return null;}var inp=box.querySelector(" + j("[data-attachment-input]") + ");" +
  "return {text:box.textContent.trim(),value:inp===null?" + j("") + ":inp.value};})()"
);
check("⑤c 改名只改**主名**、后缀原位保留（业务口径「自定义把图片png格式删了怎么办」：输入框只装「剪贴板图片-2」、胶囊仍带灰字 .png）",
  extProbe !== null && String(extProbe.value) === "剪贴板图片-2" && String(extProbe.text).indexOf(".png") >= 0,
  extProbe === null ? "-" : JSON.stringify(extProbe));
await ev("(function(){var i=document.querySelector(" + j("[data-attachment-input]") + ");if(i===null){return null;}i.select();return true;})()");
await page.send("Input.insertText", { text: "滑槽磕碰-现场-01" });
await pressKey("Enter", "Enter", 13);
await sleep(300);
const renamedProbe = await ev("(function(){var s=document.querySelector(" + j("[data-attachment-strip=photos]") + ");if(s===null){return null;}var cs=s.querySelectorAll(" + j("[data-attachment]") + ");var names=[];for(var i=0;i<cs.length;i++){names.push(cs[i].getAttribute(" + j("data-attachment") + "));}return {names:names};})()");
check("⑤c 自定义图片名称：主名改成「滑槽磕碰-现场-01」（回车提交）→ 胶囊名 = 「滑槽磕碰-现场-01.png」（**后缀自动保留**）",
  renamedProbe !== null && renamedProbe.names.length === 1 && renamedProbe.names[0] === "滑槽磕碰-现场-01.png",
  renamedProbe === null ? "-" : JSON.stringify(renamedProbe.names));

const DONE_TEXT_2 = "回放·附图预览·" + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
await typeInto("[data-fill-form] textarea[data-field=doneWork]", DONE_TEXT_2);
await clickSelector("[data-fill-form] button[data-action=submit]");
await waitFor("document.querySelector(" + j("[data-report-row]") + ")!==null");
const rowThumb = await ev(
  "(function(){var rows=document.querySelectorAll(" + j("[data-report-row]") + ");if(rows.length===0){return null;}" +
  "var img=rows[0].querySelector(" + j("[data-attachment-thumb] img") + ");var chip=rows[0].querySelector(" + j("[data-attachment]") + ");" +
  "return {rows:rows.length,src:img===null?" + j("") + ":String(img.getAttribute(" + j("src") + ")),name:chip===null?" + j("") + ":String(chip.getAttribute(" + j("data-attachment") + "))};})()"
);
check("⑤c 日报记录：最新一行「现场工作附图」列出缩略图（记录列表也能预览 · blob 地址 · 名字 = 自定义后的「滑槽磕碰-现场-01.png」）",
  rowThumb !== null && String(rowThumb.src).indexOf("blob:") === 0 && String(rowThumb.name).indexOf("滑槽磕碰-现场-01.png") >= 0,
  rowThumb === null ? "-" : JSON.stringify(rowThumb));

// ---------- ⑥ 吸顶（Push 200 起 · Push 201 两层叠放 + 修三处 bug：投影外溢 / 吞字 / 接缝；业务口径「这个也做吸顶效果吧 图二吸顶后有bug」「这里的字被吞掉了」「这个中间有条缝可以有办法解决一下吗」） ----------
// ⑥ 前置：**未吸顶**时的静态几何 —— 横幅下沿不得压住下方内容（Push 201 补：负 mb 把区块标题吞掉 16px）
const GAP_EXPR =
  "(function(){var nav=document.querySelector(" + j("[data-subnav]") + ");if(nav===null){return null;}" +
  "var sib=nav.nextElementSibling;if(sib===null){return null;}var n=nav.getBoundingClientRect();var s=sib.getBoundingClientRect();" +
  "var head=sib.firstElementChild;var h=head===null?null:head.getBoundingClientRect();" +
  "return {scrollY:Math.round(window.scrollY),navTop:Math.round(n.top),navBottom:Math.round(n.bottom),sibTop:Math.round(s.top)," +
  "gap:Math.round(s.top-n.bottom),headTop:h===null?null:Math.round(h.top),stuck:Math.round(n.top)<=123};})()";
await ev("window.scrollTo(0, 0)");
await sleep(300);
const gapDaily = await ev(GAP_EXPR);
check("⑥ 页内导航栏不压住下方内容（未吸顶 · 日报填写：下一个兄弟 top ≥ 横幅下沿 +2px · 修「这里的字被吞掉了」）",
  gapDaily !== null && gapDaily.stuck === false && gapDaily.gap >= 2,
  gapDaily === null ? "-" : JSON.stringify(gapDaily));
await clickSelector('[data-subnav-item="问题看板"]');
await ev("window.scrollTo(0, 0)");
await sleep(400);
const gapBoard = await ev(GAP_EXPR);
check("⑥ 页内导航栏不压住下方内容（未吸顶 · 问题看板：区块标题整行露在横幅下沿之外）",
  gapBoard !== null && gapBoard.stuck === false && gapBoard.headTop !== null && gapBoard.headTop - gapBoard.navBottom >= 2,
  gapBoard === null ? "-" : JSON.stringify(gapBoard));
await clickSelector('[data-subnav-item="日报填写"]');
await sleep(400);
await page.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 520, deviceScaleFactor: 1, mobile: false });
await sleep(400);
await ev("window.scrollTo(0, 400)");
await sleep(350);
const stickProbe = await ev(
  "(function(){var bar=document.querySelector(" + j("[data-maintabs]") + ");var nav=document.querySelector(" + j("[data-subnav]") + ");" +
  "var header=document.querySelector(" + j("header") + ");if(bar===null||nav===null||header===null){return null;}" +
  "var b=bar.getBoundingClientRect();var n=nav.getBoundingClientRect();" +
  "var ks=nav.querySelectorAll(" + j("[data-subnav-item]") + ");var keyBottom=0;" +
  "for(var i=0;i<ks.length;i++){var kb=ks[i].getBoundingClientRect().bottom;if(kb>keyBottom){keyBottom=kb;}}" +
  "return {scrollY:Math.round(window.scrollY),headerBottom:Math.round(header.getBoundingClientRect().bottom)," +
  "barTop:Math.round(b.top),barBottom:Math.round(b.bottom),barPosition:getComputedStyle(bar).position,barZ:getComputedStyle(bar).zIndex," +
  "barBorder:parseFloat(getComputedStyle(bar).borderBottomWidth)," +
  "navTop:Math.round(n.top),navBottom:Math.round(n.bottom),navPosition:getComputedStyle(nav).position,navZ:getComputedStyle(nav).zIndex," +
  "shadowRoom:Math.round(n.bottom-keyBottom),visible:b.bottom>64&&b.top<window.innerHeight&&n.bottom>64&&n.top<window.innerHeight};})()"
);
check("⑥ 主标签栏吸顶：滚动后停在顶栏正下方（top = 64 · position: sticky · z-20 · 横幅仍可见）",
  stickProbe !== null && stickProbe.scrollY >= 300 && stickProbe.barPosition === "sticky" &&
  Math.abs(stickProbe.barTop - 64) <= 2 && Math.abs(stickProbe.barTop - stickProbe.headerBottom) <= 2 &&
  stickProbe.barZ === "20" && stickProbe.visible === true,
  stickProbe === null ? "-" : JSON.stringify(stickProbe));
check("⑥ 页内导航栏叠在主标签栏下面（top = 122 多叠 1px · 缝不变量 navTop ≤ 栏下沿 − 下边框宽 · position: sticky · z 更低不反压）",
  stickProbe !== null && stickProbe.navPosition === "sticky" && Math.abs(stickProbe.navTop - 122) <= 2 &&
  stickProbe.navTop <= stickProbe.barBottom - stickProbe.barBorder + 0.05 && Number(stickProbe.navZ) < Number(stickProbe.barZ),
  stickProbe === null ? "-" : "navTop=" + String(stickProbe.navTop) + " · barBottom=" + String(stickProbe.barBottom) + " − 下边框 " + String(stickProbe.barBorder) + " · z=" + String(stickProbe.navZ) + "/" + String(stickProbe.barZ));
check("⑥ 键帽投影兜进横幅：导航栏下内衬 ≥ 投影（nav 底 - 键帽底 ≥ 12px · Push 201 修「图二吸顶后有bug」）",
  stickProbe !== null && stickProbe.shadowRoom >= 12,
  stickProbe === null ? "-" : "shadowRoom=" + String(stickProbe.shadowRoom) + "px");
// ⑥b 项目总览：任务表头也叠在主标签栏下面（Push 201 重排 —— 原 top-16 会让主标签栏压住表头；
//     Push 201 再补「缝」—— top 122 多叠 1px + z 19 低于主标签栏，缩放屏下边框吸附变细也不露缝）
await clickSelector('[data-maintabs-item="项目总览"]');
const boardReady = await waitFor("document.querySelector(" + j("[data-board-head]") + ")!==null");
await ev("window.scrollTo(0, 600)");
await sleep(350);
const boardProbe = await ev(
  "(function(){var bar=document.querySelector(" + j("[data-maintabs]") + ");var head=document.querySelector(" + j("[data-board-head]") + ");" +
  "if(bar===null||head===null){return null;}var b=bar.getBoundingClientRect();var h=head.getBoundingClientRect();" +
  "return {scrollY:Math.round(window.scrollY),barBottom:Math.round(b.bottom),barBorder:parseFloat(getComputedStyle(bar).borderBottomWidth)," +
  "headTop:Math.round(h.top),headZ:getComputedStyle(head).zIndex,position:getComputedStyle(head).position};})()"
);
check("⑥ 项目总览：任务表头叠在主标签栏下面（表头 top = 122 多叠 1px · 缝不变量 headTop ≤ 栏下沿 − 下边框宽 · position: sticky · z 19）",
  boardReady === true && boardProbe !== null && boardProbe.scrollY >= 300 && boardProbe.position === "sticky" &&
  Math.abs(boardProbe.headTop - 122) <= 2 && boardProbe.headTop <= boardProbe.barBottom - boardProbe.barBorder + 0.05 &&
  Number(boardProbe.headZ) < 20,
  boardProbe === null ? "-" : JSON.stringify(boardProbe));
await page.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("window.scrollTo(0, 0)");
await sleep(250);
await clickSelector('[data-maintabs-item="日报及问题"]');
await waitFor("document.querySelectorAll(" + j("[data-subnav-item]") + ").length===4");
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
