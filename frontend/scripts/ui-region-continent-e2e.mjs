#!/usr/bin/env node
/**
 * LibiaoLink 前端 · 回放：地区按洲分组（首页筛选侧栏可展开 + 新建 / 编辑项目的地区改「分洲 + 可搜索」选择器）
 *
 * 业务口径（2026-09-28）：「我觉得这里太乱了 要根据各个州分类 可以展开 这边要改那新建项目选择地区应该也要改
 *   是不是要加一个国家地区选择器可搜索的那种」。
 *
 * 本脚本用真机浏览器（无头 Chrome + CDP，真实鼠标坐标 / 真实键盘输入）验：
 *   ① 侧栏「地区」段 = 按洲分组（亚洲 / 欧洲 / 非洲 / 北美洲 / 南美洲 / 大洋洲 / 其他），不再是几十枚胶囊一片平铺；
 *   ② 分组可展开 / 收起：默认只展开「有勾选的洲」（面板打开是干净几行），「全部展开 / 全部收起」一键切换，
 *      组头带「N 个地区」与「已选 N」；分洲后一枚不多一枚不少（与库内 facets 对账）；
 *   ③ 点胶囊照旧按地区筛选（URL 写 filter[region]、卡片计数同步）；
 *   ④ 新建项目弹窗的地区下拉 = 分洲 + 顶部搜索框（打开即聚焦）：中文名与英文名都能搜（英 → 英国；Brazil → 巴西），
 *      搜不到给提示行、回车选第一条、「＋ 添加地区」分支里搜索框收起；
 *   ⑤ 洲口径 = 中国口径（与地图同一套国界 / 国名口径）：中国 / 日本 / 新加坡 在亚洲，英国 / 德国 / 俄罗斯 在欧洲，
 *      南非 / 埃及 在非洲，美国 / 加拿大 在北美洲，巴西 / 秘鲁 在南美洲，澳大利亚 / 新西兰 在大洋洲；
 *      台湾 / 科索沃 / 北塞浦路斯 / 索马里兰 一个都不许出现（中国口径硬护栏）；
 *   ⑥ 整洲筛选（Push 193）：「某一个洲点击可以直接筛选整个洲」—— 勾洲行最右侧的复选框 = 把该洲全部地区
 *      一起勾上（并展开），再点一次取消；URL / 工具条计数 / 复选框状态与库内对账；
 *   ⑦ 「＋ 添加地区」= 标准国家 / 地区搜索选择器（Push 193，不手打）：候选 = 地图同一份国家 / 微国列表（中英文可搜、
 *      分洲、已收录的不再列出）；点一行即新增（真 PG 落行），跑完把这一行物理删掉、零残留；
 *   ⑧ 控制台零报错；跑完会话撤销、库内零残留（除「⑦ 新增后即删」外只读：不建项目、不改其余字典）。
 *
 * 前置（三件都在本机跑着）：
 *   1. 前端 dev：cd frontend && npm run dev（默认 3000）
 *   2. api：cd server && npm run start:api（默认 3001，需先 npm run build）
 *   3. 数据库：本地沙箱 PG（默认 127.0.0.1:5433/libiaolink）
 *   4. 本机装了 Chrome（脚本 headless 起一个调试实例；路径可用 CHROME_PATH 覆盖）
 *
 * 用法：node scripts/ui-region-continent-e2e.mjs
 *   可覆盖的环境变量：FRONTEND_BASE / DATABASE_URL / CHROME_PATH / CDP_PORT / REPLAY_USER / PG_MODULE / SHOT_DIR
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
const PG_MODULE = process.env.PG_MODULE ?? new URL("../../server/node_modules/pg/lib/index.js", import.meta.url).href;
const { default: pg } = await import(PG_MODULE);
const { Client } = pg;
const FRONTEND = process.env.FRONTEND_BASE ?? "http://localhost:3000";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(process.env.CDP_PORT ?? 9403);
const DB = process.env.DATABASE_URL ?? "postgres://libiaolink_api@127.0.0.1:5433/libiaolink";
const REPLAY_USER = process.env.REPLAY_USER ?? "panxing";
const SHOTS = process.env.SHOT_DIR ?? join(tmpdir(), "px-region-continent-shots");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const j = (value) => JSON.stringify(value);
/** 洲名白名单（中国口径）与兜底组 */
const CONTINENTS = ["亚洲", "欧洲", "非洲", "北美洲", "南美洲", "大洋洲"];
const OTHER_GROUP = "其他";
/** 中国口径硬护栏：不许作为国家出现在任何候选里（与地图 e2e 同一份清单） */
const FORBIDDEN = ["台湾", "科索沃", "北塞浦路斯", "索马里兰"];
/** 洲归属抽查（拿库内在用的地区对账；口径 = 中国口径，与地图同一套） */
const CONTINENT_SPOT = [
  ["亚洲", ["中国", "日本", "新加坡"]],
  ["欧洲", ["英国", "德国", "俄罗斯"]],
  ["非洲", ["南非"]],
  ["北美洲", ["美国", "加拿大"]],
  ["南美洲", ["巴西", "秘鲁"]],
  ["大洋洲", ["澳大利亚", "新西兰"]]
];
/**
 * 下拉候选里的洲归属抽查：挑几个「侧栏看不到 / 非欧洲」的字典条目（埃及 现在不在字典里了 —— 沙箱库会变，
 * 表里哪条不在当前字典里就跳过，只要求至少查到 2 条，别静默全跳过）。
 */
const DROPDOWN_SPOT = [["非洲", "埃及"], ["欧洲", "丹麦"], ["亚洲", "土耳其"], ["北美洲", "美国"]];

/** 搜索框关键词与预期候选（中文名 / 英文名各一条；库内没有第二条含这个词的条目） */
const SEARCH_ZH = "英";
const SEARCH_EN = "Brazil";
const SEARCH_MISS = "zzzz";

mkdirSync(SHOTS, { recursive: true });
const db = new Client({ connectionString: DB });
await db.connect();
const userRow = (await db.query("select id, username, display_name from users where username = $1", [REPLAY_USER])).rows[0];
if (userRow === undefined) {
  console.error("回放用户不存在：" + REPLAY_USER);
  process.exit(1);
}
const dictRegionRows = (await db.query("select code, name from dict_items where type_code = $1 and enabled order by sort", ["region"])).rows;
/* Push 193 回放要新增「冰岛」来验「添加地区」——先清掉上次意外残留的同一行（正常情况一行都没有）。 */
const staleAdd = await db.query("delete from dict_items where type_code = $1 and code = $2", ["region", "冰岛"]);
if (Number(staleAdd.rowCount) > 0) {
  console.log("预清理：上次回放残留的「冰岛」条目已删除（" + String(staleAdd.rowCount) + " 行）");
}
const maxDictSort = Number((await db.query("select coalesce(max(sort), 0)::int as n from dict_items where type_code = $1 and enabled", ["region"])).rows[0].n);
const dictRegionCount = dictRegionRows.length;
const projectRows = (await db.query("select region, count(*)::int as n from projects where deleted_at is null group by region")).rows;
const projectTotal = projectRows.reduce((sum, row) => sum + Number(row.n), 0);
const labelOfRegion = new Map(dictRegionRows.map((row) => [row.code, row.name]));
const regionLabel = (region) => (labelOfRegion.get(region) ?? region);
/** 侧栏里该出现的地区胶囊（= 有项目的地区，按字典名归拢） */
const facetLabels = Array.from(new Set(projectRows.map((row) => regionLabel(row.region)))).sort();
console.log("临时会话：" + userRow.username + "（" + userRow.display_name + "）");
console.log("库内：项目 " + String(projectTotal) + " 个 / 用到地区 " + String(facetLabels.length) + " 个 / 地区字典 " + String(dictRegionCount) + " 条");

const token = "pxregion-" + randomBytes(16).toString("hex");
const csrf = randomBytes(16).toString("hex");
await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(mins => 30))", [sha256(token), userRow.id, "px-region-continent-e2e"]);

const profile = mkdtempSync(join(tmpdir(), "pxregion-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });

async function waitTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
      const target = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (target) {
        return target;
      }
    } catch (error) {
      // 未就绪
    }
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
        if (msg.error) {
          item.reject(new Error(JSON.stringify(msg.error)));
        } else {
          item.resolve(msg.result);
        }
        return;
      }
      if (msg.method === "Runtime.exceptionThrown") {
        consoleErrors.push("exception: " + String(msg.params.exceptionDetails.text));
      }
      if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "warning")) {
        consoleErrors.push(msg.params.type + ": " + msg.params.args.map((arg) => String(arg.value === undefined ? arg.description : arg.value)).join(" "));
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

const consoleErrors = [];
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: ok === true, detail });
  console.log((ok === true ? "  PASS  " : "  FAIL  ") + name + (ok === true ? "" : "  —— " + String(detail)));
}

const target = await waitTarget();
const page = new Cdp(target.webSocketDebuggerUrl);
await page.ready;
await page.send("Network.enable");
await page.send("Page.enable");
await page.send("Runtime.enable");
await page.send("Network.setCookie", { name: "ll_sid", value: token, url: FRONTEND + "/", path: "/", httpOnly: true, secure: false });
await page.send("Network.setCookie", { name: "ll_csrf", value: csrf, url: FRONTEND + "/", path: "/", httpOnly: false, secure: false });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ev = async (expression) => (await page.send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
/** 页面里跑一个无闭包的探针函数（toString 送进浏览器，省去手写转义） */
const probe = async (fn) => await ev("(" + fn.toString() + ")()");
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

async function clickAt(point) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(600);
}

async function rectOf(selector) {
  return await ev(
    "(() => { const node = document.querySelector(" + j(selector) + ");" +
    " if (node === null) { return null; }" +
    " node.scrollIntoView({ block: " + j("nearest") + ", inline: " + j("nearest") + " });" +
    " const box = node.getBoundingClientRect();" +
    " if (box.width === 0 || box.height === 0) { return null; }" +
    " return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()"
  );
}

async function clickSelector(selector) {
  const point = await rectOf(selector);
  if (point === null) {
    throw new Error("点不到（元素不存在或不可见）：" + selector);
  }
  await clickAt(point);
}

/** 首屏导航：打开列表页并等侧栏地区分组就绪 */
const SIDEBAR_SECTION = "[data-region-section=true]";
const SIDEBAR_SWITCH = "label:has(input[aria-controls=category-filter-panel])";
const CONTINENT_GROUP_SELECTOR = "[data-continent-group]";
const CONTINENT_ALL_SELECTOR = "[data-continent-all]";
const POPOVER_SELECTOR = "[data-select-popover=true]";
const REGION_TRIGGER = "[aria-label=" + j("选择项目地区") + "]";
const CREATE_BUTTON = "button:has(svg path[d=" + j("M12 5v14M5 12h14") + "])";

async function openList(hash, width = 1440, height = 900) {
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await page.send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await page.send("Page.navigate", { url: FRONTEND + "/" + hash });
  await waitFor("document.querySelector(" + j(SIDEBAR_SECTION) + ")!==null");
  await waitFor("document.querySelectorAll(" + j(CONTINENT_GROUP_SELECTOR) + ").length>0");
  await sleep(500);
}

async function openSidebar() {
  // 幂等：侧栏开合会记进 localStorage（saveSidebarPref），新页面可能**自带打开状态** ——
  // 已打开就不要再去点开关（否则会把它关掉，后面的真实点击全部落空）。
  await sleep(400);
  const opened = await ev(
    "(() => { const panel = document.querySelector(" + j("#category-filter-panel") + ");" +
    " return panel !== null && panel.getBoundingClientRect().left >= 0; })()"
  );
  if (opened !== true) {
    await clickSelector(SIDEBAR_SWITCH);
    await sleep(600);
  }
  await waitFor("document.querySelector(" + j("#category-filter-panel") + ").getBoundingClientRect().left>=0");
}

async function typeText(text) {
  await page.send("Input.insertText", { text });
  await sleep(500);
}

async function pressKey(key, code, vk, modifiers = 0) {
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await sleep(350);
}

async function pressEnter() {
  await pressKey("Enter", "Enter", 13);
  await sleep(400);
}

/** 清空搜索框：Ctrl+A 全选 + Backspace（走真实键盘，React 的 onChange 照常触发） */
async function clearSearch() {
  await pressKey("a", "KeyA", 65, 2);
  await pressKey("Backspace", "Backspace", 8);
  await sleep(400);
}

async function shot(name) {
  const result = await page.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const file = join(SHOTS, name + ".png");
  writeFileSync(file, Buffer.from(result.data, "base64"));
  console.log("截图：" + file);
}

/** 页面探针：读侧栏地区分组（分洲标题 / 展开态 / 组内胶囊） */
const readSidebar = () => {
  const section = document.querySelector("[data-region-section=true]");
  if (section === null) {
    return null;
  }
  const groups = Array.from(section.querySelectorAll("[data-continent-group]")).map((node) => {
    const toggle = node.querySelector("[data-continent-toggle]");
    const check = node.querySelector("input[data-continent-check]");
    const chips = [];
    const chipPressed = {};
    for (const button of Array.from(node.querySelectorAll("button[data-chip]"))) {
      const first = button.childNodes.length > 0 ? button.childNodes[0].nodeValue : null;
      const label = String(first === null ? button.textContent : first).trim();
      chips.push(label);
      chipPressed[label] = button.getAttribute("aria-pressed") === "true";
    }
    return {
      continent: node.getAttribute("data-continent-group"),
      expanded: toggle !== null && toggle.getAttribute("aria-expanded") === "true",
      header: node.textContent.replace(/\s+/g, " ").trim(),
      checked: check !== null && check.checked === true,
      chips: chips,
      chipPressed: chipPressed
    };
  });
  const all = section.querySelector("[data-continent-all]");
  return {
    groups: groups,
    allAction: all === null ? null : all.getAttribute("data-continent-all"),
    allText: all === null ? null : all.textContent.trim(),
    text: section.textContent
  };
};

/** 页面探针：读地区下拉浮层（搜索框 / 分组小标题 / 候选行） */
const readPopover = () => {
  const popover = document.querySelector("[data-select-popover=true]");
  if (popover === null) {
    return null;
  }
  const input = popover.querySelector("input");
  const list = popover.querySelector("[role=listbox]");
  const rows = [];
  const groups = [];
  let group = null;
  if (list !== null) {
    for (const child of Array.from(list.children)) {
      const header = child.getAttribute("data-option-group");
      if (header !== null) {
        group = header;
        if (groups.indexOf(header) < 0) {
          groups.push(header);
        }
        continue;
      }
      const option = child.getAttribute("role") === "option" ? child : child.querySelector("[role=option]");
      if (option === null) {
        continue;
      }
      rows.push({ group: group, text: option.textContent.trim() });
    }
  }
  const selected = popover.querySelector("[aria-selected=true]");
  const scroller = list === null ? null : list.parentElement;
  let selectedVisible = null;
  if (selected !== null && scroller !== null) {
    const rowBox = selected.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    selectedVisible = rowBox.top >= box.top - 1 && rowBox.bottom <= box.bottom + 1;
  }
  return {
    hasInput: input !== null,
    inputLabel: input === null ? null : input.getAttribute("aria-label"),
    inputValue: input === null ? null : input.value,
    focused: input !== null && document.activeElement === input,
    rows: rows,
    selectedText: selected === null ? null : selected.textContent.trim(),
    selectedVisible: selectedVisible,
    groups: groups,
    hasAddRow: popover.textContent.indexOf("添加地区") >= 0,
    hasEmptyText: popover.textContent.indexOf("没有匹配的地区") >= 0,
    hasAddEmpty: popover.textContent.indexOf("没有匹配的国家") >= 0
  };
};
/** 点某个按钮（按文本精确匹配；rootSelector 缺省 = 整页） */
async function clickByText(rootSelector, text) {
  const point = await ev(
    "(() => { const root = document.querySelector(" + j(rootSelector) + ") ?? document.body;" +
    " const node = Array.from(root.querySelectorAll(" + j("button") + ")).find((item) => item.textContent.trim() === " + j(text) + ");" +
    " if (node === undefined) { return null; }" +
    " node.scrollIntoView({ block: " + j("nearest") + " });" +
    " const box = node.getBoundingClientRect();" +
    " return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()"
  );
  if (point === null) {
    throw new Error("找不到按钮：" + text);
  }
  await clickAt(point);
}

/** 点侧栏某洲的展开箭头（展开 / 收起那一组） */
async function clickContinent(name) {
  await clickSelector("[data-continent-toggle=" + j(name) + "]");
  await sleep(400);
}

/** 点侧栏某洲行最右侧的整洲复选框（Push 193：勾上 = 选中该洲全部地区，再点 = 全部取消） */
async function clickContinentFilter(name) {
  await clickSelector("label:has(input[data-continent-check=" + j(name) + "])");
  await sleep(600);
}

/** 从 hash 里解析 filter[region] 的码列表（多值 = 英文逗号分隔，逐段 decodeURIComponent） */
function regionCodesInHash(hash) {
  const marker = "filter[region]=";
  const chunk = hash.split("&").find((piece) => piece.indexOf(marker) >= 0);
  if (chunk === undefined) {
    return [];
  }
  return chunk
    .slice(chunk.indexOf(marker) + marker.length)
    .split(",")
    .filter((piece) => piece !== "")
    .map((piece) => decodeURIComponent(piece));
}

/** 地区码 → 字典名（库内没有的码就当它本身是名字） */
const labelByCode = new Map(dictRegionRows.map((row) => [row.code, row.name]));
const labelOfCode = (code) => labelByCode.get(code) ?? code;
/** 地区名 → 码（侧栏胶囊显示字典名；码 = 筛选值） */
const codeByName = new Map(dictRegionRows.map((row) => [row.name, row.code]));
const codeOfLabel = (label) => codeByName.get(label) ?? label;

/** 点侧栏某枚地区胶囊（按地区名找，不看计数） */
async function clickChip(label) {
  const point = await ev(
    "(() => { const section = document.querySelector(" + j(SIDEBAR_SECTION) + ");" +
    " if (section === null) { return null; }" +
    " const node = Array.from(section.querySelectorAll(" + j("button[data-chip]") + ")).find((button) =>" +
    " String(button.firstChild === null ? " + j("") + " : button.firstChild.nodeValue).trim() === " + j(label) + ");" +
    " if (node === undefined) { return null; }" +
    " node.scrollIntoView({ block: " + j("nearest") + " });" +
    " const box = node.getBoundingClientRect();" +
    " return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()"
  );
  if (point === null) {
    throw new Error("找不到地区胶囊：" + label);
  }
  await clickAt(point);
}

const totalByLabel = new Map();
for (const row of projectRows) {
  const label = regionLabel(row.region);
  totalByLabel.set(label, (totalByLabel.get(label) ?? 0) + Number(row.n));
}
/** 分组成块检查：同一个洲的候选必须连在一起（第二次出现 = 被别的洲打断了） */
const contiguityFailures = (rows) => {
  const seen = [];
  const bad = [];
  for (let index = 0; index < rows.length; index += 1) {
    const group = rows[index].group;
    if (index === 0 || rows[index - 1].group !== group) {
      if (seen.indexOf(group) >= 0) {
        bad.push(group);
      } else {
        seen.push(group);
      }
    }
  }
  return bad;
};

/** 打开浮层后点一下搜索框（真实鼠标）—— 保证后面 insertText 有落点 */
async function focusSearch() {
  await clickSelector(POPOVER_SELECTOR + " input");
  await sleep(300);
}

const chipsOf = (state) => (state === null ? [] : state.groups.flatMap((group) => group.chips));
const groupOf = (state, name) => (state === null ? undefined : state.groups.find((group) => group.continent === name));
const groupOfChip = (state, chip) => (state === null ? undefined : state.groups.find((group) => group.chips.indexOf(chip) >= 0));

// ── ① 侧栏「地区」：默认按洲分组、无选区时先全部收起 ──
await openList("#/projects");
await openSidebar();
let sidebar = await probe(readSidebar);
const groupNames = sidebar === null ? [] : sidebar.groups.map((group) => group.continent);
const allowed = CONTINENTS.concat([OTHER_GROUP]);
check("侧栏地区段按洲分组：分组 " + String(groupNames.length) + " 个（" + groupNames.join(" / ") + "）", groupNames.length >= 6 && groupNames.every((name) => allowed.indexOf(name) >= 0), JSON.stringify(groupNames));
check("分洲标题覆盖六大洲（亚洲在最前，字典首条「华东」在亚洲）", CONTINENTS.every((name) => groupNames.indexOf(name) >= 0) && groupNames[0] === "亚洲", JSON.stringify(groupNames));
check("默认收起：没勾选任何地区时每一组都是收起的（面板打开是干净几行）", sidebar !== null && sidebar.groups.every((group) => !group.expanded), JSON.stringify(sidebar === null ? null : sidebar.groups.map((group) => group.expanded)));
check("收起时组头报「N 个地区」、组内胶囊不渲染", sidebar !== null && sidebar.groups.every((group) => group.header.indexOf("个地区") >= 0 && group.chips.length === 0), JSON.stringify(sidebar === null ? null : sidebar.groups.map((group) => group.header)));
check("中国口径护栏：洲分组里不出现台湾 / 科索沃 / 北塞浦路斯 / 索马里兰", sidebar !== null && FORBIDDEN.every((name) => String(sidebar.text).indexOf(name) < 0), FORBIDDEN.filter((name) => sidebar !== null && String(sidebar.text).indexOf(name) >= 0).join(","));
await shot("01-sidebar-collapsed");

// ── ② 展开 / 收起：全部展开后能数全每一枚胶囊（与库内 facets 对账） ──
await clickSelector(CONTINENT_ALL_SELECTOR);
await sleep(600);
sidebar = await probe(readSidebar);
const chipList = chipsOf(sidebar).slice().sort();
const missingChips = facetLabels.filter((label) => chipList.indexOf(label) < 0);
const extraChips = chipList.filter((label) => facetLabels.indexOf(label) < 0);
check("「全部展开」：每一组都展开、胶囊一枚不多一枚不少（库内 " + String(facetLabels.length) + " 个在用地区）", sidebar !== null && sidebar.groups.every((group) => group.expanded) && missingChips.length === 0 && extraChips.length === 0, JSON.stringify({ missing: missingChips, extra: extraChips }));
check("组头的「N 个地区」= 组内胶囊数", sidebar !== null && sidebar.groups.every((group) => group.header.indexOf(String(group.chips.length) + " 个地区") >= 0), JSON.stringify(sidebar === null ? null : sidebar.groups.map((group) => group.header)));
const spotFailures = [];
for (const entry of CONTINENT_SPOT) {
  for (const name of entry[1]) {
    const host = groupOfChip(sidebar, name);
    if (host === undefined || host.continent !== entry[0]) {
      spotFailures.push(name + " 应在 " + entry[0] + "，实际 " + String(host === undefined ? "（没找到）" : host.continent));
    }
  }
}
check("洲归属抽查（中国口径，与地图同一套）：" + String(CONTINENT_SPOT.length) + " 洲 / " + String(CONTINENT_SPOT.reduce((sum, entry) => sum + entry[1].length, 0)) + " 个国家", spotFailures.length === 0, spotFailures.join("；"));
await shot("02-sidebar-expanded");
await clickSelector(CONTINENT_ALL_SELECTOR);
await sleep(600);
sidebar = await probe(readSidebar);
check("「全部收起」：全部收起、胶囊全部不渲染（组头仍报数）", sidebar !== null && sidebar.groups.every((group) => !group.expanded && group.chips.length === 0) && sidebar.allText === "全部展开", sidebar === null ? "null" : sidebar.allText);

// ── ③ 单组展开 + 点胶囊筛选（URL 与卡片计数同步） ──
await clickContinent("亚洲");
sidebar = await probe(readSidebar);
check("点「亚洲」展开箭头：只展开这一组，其余仍收起", sidebar !== null && groupOf(sidebar, "亚洲").expanded && sidebar.groups.filter((group) => group.expanded).length === 1, JSON.stringify(sidebar === null ? null : sidebar.groups.map((group) => group.continent + ":" + String(group.expanded))));
await clickChip("日本");
await sleep(1400);
sidebar = await probe(readSidebar);
const hashJapan = String(await ev("window.location.hash"));
const japanTotal = totalByLabel.get("日本") ?? 0;
const bodyText = String(await ev("document.body.textContent"));
check("点胶囊「日本」：按地区筛选（URL 写 filter[region]=日本）", decodeURIComponent(hashJapan).indexOf("filter[region]=日本") >= 0, hashJapan);
check("筛选后工具条计数 = 库里「日本」的项目数（" + String(japanTotal) + " 个）", bodyText.indexOf("找到 " + String(japanTotal) + " 个项目") >= 0, "没找到计数文案");
check("勾选后组头出「已选 1」（收起也能看见勾了哪一洲）", sidebar !== null && groupOf(sidebar, "亚洲") !== undefined && groupOf(sidebar, "亚洲").header.indexOf("已选 1") >= 0, JSON.stringify(sidebar === null ? null : sidebar.groups.map((group) => group.header)));
await shot("03-sidebar-filtered");

// ── ④ 带选区进页面：有勾选的洲默认展开、其余收起 ──
await openList("#/projects?filter[region]=" + encodeURIComponent("中国"));
await openSidebar();
sidebar = await probe(readSidebar);
check("带勾选进页面：有勾选的洲默认展开（亚洲），其余洲收起", sidebar !== null && groupOf(sidebar, "亚洲").expanded && sidebar.groups.filter((group) => group.expanded).length === 1, JSON.stringify(sidebar === null ? null : sidebar.groups.map((group) => group.continent + ":" + String(group.expanded))));
check("默认展开的洲里能看到勾中的那枚胶囊（中国）", sidebar !== null && groupOf(sidebar, "亚洲").chips.indexOf("中国") >= 0, JSON.stringify(sidebar === null ? null : groupOf(sidebar, "亚洲").chips));

// ── ④b 整洲筛选（Push 193）：点洲名 = 选中该洲全部地区（并展开），再点一次取消 ──
await clickByText("#category-filter-panel", "重置");
await sleep(800);
await clickContinentFilter("欧洲");
await sleep(1600);
sidebar = await probe(readSidebar);
const hashEurope = String(await ev("window.location.hash"));
const europeGroup = groupOf(sidebar, "欧洲");
const europeLabels = europeGroup === undefined ? [] : europeGroup.chips;
const europeCodes = europeLabels.map(codeOfLabel);
const codesInUrl = regionCodesInHash(hashEurope);
const europeTotal = europeLabels.reduce((sum, label) => sum + (totalByLabel.get(label) ?? 0), 0);
const europeAllPressed =
  europeGroup !== undefined && europeGroup.chips.length > 0 && europeGroup.chips.every((label) => europeGroup.chipPressed[label] === true);
check(
  "勾上「欧洲」右侧复选框 = 整洲筛选：复选框已勾、组自动展开、URL 写齐欧洲全部 " + String(europeCodes.length) + " 个地区",
  europeGroup !== undefined && europeGroup.checked === true && europeGroup.expanded && europeCodes.length > 1 && codesInUrl.length === europeCodes.length && europeCodes.every((code) => codesInUrl.indexOf(code) >= 0),
  JSON.stringify({ checked: europeGroup === undefined ? null : europeGroup.checked, url: codesInUrl.length, expected: europeCodes.length, missing: europeCodes.filter((code) => codesInUrl.indexOf(code) < 0) })
);
check(
  "整洲筛选后：组头「已选 " + String(europeLabels.length) + "」、洲内胶囊全部选中（aria-pressed）",
  europeGroup !== undefined && europeGroup.header.indexOf("已选 " + String(europeLabels.length)) >= 0 && europeAllPressed,
  JSON.stringify({ header: europeGroup === undefined ? null : europeGroup.header, pressed: europeGroup === undefined ? null : europeGroup.chipPressed })
);
const bodyTextEurope = String(await ev("document.body.textContent"));
check(
  "整洲筛选的工具条计数 = 库里欧洲这些地区的项目数（" + String(europeTotal) + " 个）",
  bodyTextEurope.indexOf("找到 " + String(europeTotal) + " 个项目") >= 0,
  "没找到计数文案"
);
const foreignCodes = codesInUrl.filter((code) => {
  const host = groupOfChip(sidebar, labelOfCode(code));
  return host === undefined || host.continent !== "欧洲";
});
check(
  "URL 里的地区全部属于欧洲（与侧栏分组对账，码 " + String(codesInUrl.length) + " 个）",
  foreignCodes.length === 0,
  JSON.stringify(foreignCodes)
);
await shot("06-sidebar-continent-filter");
await clickContinentFilter("欧洲");
await sleep(1600);
sidebar = await probe(readSidebar);
const europeGroupOff = groupOf(sidebar, "欧洲");
const hashAfterOff = String(await ev("window.location.hash"));
const bodyTextAfterOff = String(await ev("document.body.textContent"));
check(
  "再点一次复选框：取消整洲（复选框复位、URL 不再写 filter[region]、计数回到全量 " + String(projectTotal) + "）",
  europeGroupOff !== undefined && europeGroupOff.checked === false && regionCodesInHash(hashAfterOff).length === 0 && bodyTextAfterOff.indexOf("共 " + String(projectTotal) + " 个项目") >= 0,
  JSON.stringify({ checked: europeGroupOff === undefined ? null : europeGroupOff.checked, hash: hashAfterOff })
);

// ── ⑤ 新建项目弹窗：地区下拉 = 分洲 + 可搜索（打开即聚焦） ──
const DIALOG = "[role=dialog]";
const projectsAllBefore = Number((await db.query("select count(*)::int as n from projects")).rows[0].n);
await clickByText("body", "新建项目");
await waitFor("document.querySelector(" + j(DIALOG) + ")!==null");
await waitFor("document.querySelector(" + j(REGION_TRIGGER) + ")!==null");
await clickSelector(REGION_TRIGGER);
await sleep(600);
let popover = await probe(readPopover);
check("新建项目：点「选择项目地区」弹浮层，顶部搜索框在且打开即聚焦", popover !== null && popover.hasInput && popover.focused, JSON.stringify(popover === null ? null : { hasInput: popover.hasInput, focused: popover.focused, label: popover.inputLabel }));
check("候选 = 地区字典 " + String(dictRegionCount) + " 条（一条不多一条不少）＋ 顶部「＋ 添加地区」入口", popover !== null && popover.rows.length === dictRegionCount && popover.hasAddRow, JSON.stringify(popover === null ? null : { rows: popover.rows.length, add: popover.hasAddRow }));
const triggerAtOpen = String(await ev("document.querySelector(" + j(REGION_TRIGGER) + ").textContent"));
check("打开浮层就把当前选中项带进可视区（选中 " + String(popover === null ? "" : popover.selectedText) + " / 触发器 " + triggerAtOpen + "）", popover !== null && popover.selectedVisible === true && popover.selectedText === triggerAtOpen, JSON.stringify(popover === null ? null : { visible: popover.selectedVisible, selected: popover.selectedText, trigger: triggerAtOpen }));
const popoverGroups = popover === null ? [] : popover.groups;
const expectedGroupOrder = allowed.filter((name) => popoverGroups.indexOf(name) >= 0);
check("候选按洲分组：小标题 " + String(popoverGroups.length) + " 个（" + popoverGroups.join(" / ") + "），按洲序排列、每条候选都归到某一洲、同洲成块不交叉", popover !== null && popoverGroups.length >= 6 && popoverGroups.every((name, index) => name === expectedGroupOrder[index]) && contiguityFailures(popover.rows).length === 0 && popover.rows.every((row) => row.group !== null), JSON.stringify(popover === null ? null : { groups: popoverGroups, expected: expectedGroupOrder, bad: contiguityFailures(popover.rows), ungrouped: popover.rows.filter((row) => row.group === null).length }));
const dropdownSpotFailures = [];
const dictNames = new Set(dictRegionRows.map((row) => row.name));
const dropdownSpotChecked = DROPDOWN_SPOT.filter((entry) => dictNames.has(entry[1]));
for (const entry of dropdownSpotChecked) {
  const row = popover === null ? undefined : popover.rows.find((item) => item.text === entry[1]);
  if (row === undefined || row.group !== entry[0]) {
    dropdownSpotFailures.push(entry[1] + " 应在 " + entry[0] + "，实际 " + String(row === undefined ? "（没找到）" : row.group));
  }
}
check("下拉洲归属抽查（" + String(dropdownSpotChecked.length) + " 条）：" + dropdownSpotChecked.map((entry) => entry[1] + "→" + entry[0]).join("、"), dropdownSpotChecked.length >= 2 && dropdownSpotFailures.length === 0, dropdownSpotFailures.join("；"));
await shot("04-modal-region-groups");

await focusSearch();
await typeText(SEARCH_ZH);
popover = await probe(readPopover);
check("搜中文「" + SEARCH_ZH + "」：候选收敛到 1 条 = 英国（所属洲 = 欧洲）", popover !== null && popover.rows.length === 1 && popover.rows[0].text === "英国" && popover.rows[0].group === "欧洲", JSON.stringify(popover === null ? null : popover.rows));
await clearSearch();
await focusSearch();
await typeText(SEARCH_EN);
popover = await probe(readPopover);
check("搜英文「" + SEARCH_EN + "」：候选收敛到 1 条 = 巴西（南美洲）—— 英文国名也能搜", popover !== null && popover.rows.length === 1 && popover.rows[0].text === "巴西" && popover.rows[0].group === "南美洲", JSON.stringify(popover === null ? null : popover.rows));
await shot("05-modal-region-search");
await clearSearch();
await focusSearch();
await typeText(SEARCH_MISS);
popover = await probe(readPopover);
check("搜不到时：候选 0 条 + 提示行「没有匹配的地区。」", popover !== null && popover.rows.length === 0 && popover.hasEmptyText, JSON.stringify(popover === null ? null : { rows: popover.rows.length, empty: popover.hasEmptyText }));
await clearSearch();
await focusSearch();
await typeText(SEARCH_EN);
await pressEnter();
await sleep(700);
popover = await probe(readPopover);
const triggerAfterEnter = String(await ev("document.querySelector(" + j(REGION_TRIGGER) + ").textContent"));
check("搜索框回车 = 选第一条（巴西）：浮层关掉、触发器显示巴西", popover === null && triggerAfterEnter === "巴西", JSON.stringify({ popover: popover === null, trigger: triggerAfterEnter }));

await clickSelector(REGION_TRIGGER);
await sleep(600);
popover = await probe(readPopover);
check("重开浮层：关键词复位（空）、候选回到全量 " + String(dictRegionCount) + " 条", popover !== null && popover.inputValue === "" && popover.rows.length === dictRegionCount, JSON.stringify(popover === null ? null : { value: popover.inputValue, rows: popover.rows.length }));
await focusSearch();
await typeText(SEARCH_ZH);
await clickSelector(POPOVER_SELECTOR + " [role=listbox] [role=option]");
await sleep(700);
popover = await probe(readPopover);
const triggerAfterClick = String(await ev("document.querySelector(" + j(REGION_TRIGGER) + ").textContent"));
check("鼠标点候选（搜「英」后第一行 = 英国）：触发器显示英国", popover === null && triggerAfterClick === "英国", JSON.stringify({ popover: popover === null, trigger: triggerAfterClick }));

await clickSelector(REGION_TRIGGER);
await sleep(600);
await clickByText(POPOVER_SELECTOR, "添加地区");
await sleep(600);
// —— ⑤b 「＋ 添加地区」= 标准国家 / 地区搜索选择器（Push 193，不手打） ——
const ADD_PLACEHOLDER = "搜索国家 / 地区（中英文都行）";
popover = await probe(readPopover);
const addTexts = popover === null ? [] : popover.rows.map((row) => row.text);
check(
  "「＋ 添加地区」：换成搜索选择器（输入框 = " + ADD_PLACEHOLDER + "、打开即聚焦、候选 > 100）",
  popover !== null && popover.inputLabel === ADD_PLACEHOLDER && popover.focused === true && popover.rows.length > 100,
  JSON.stringify(popover === null ? null : { label: popover.inputLabel, focused: popover.focused, rows: popover.rows.length })
);
check(
  "添加器候选 = 标准国家 / 地区库：分洲小标题 " + String(popover === null ? 0 : popover.groups.length) + " 个、同洲成块；不含已收录的 日本 / 中国，含 冰岛",
  popover !== null && popover.groups.length >= 6 && contiguityFailures(popover.rows).length === 0 && addTexts.indexOf("日本 Japan") < 0 && addTexts.indexOf("中国 China") < 0 && addTexts.indexOf("冰岛 Iceland") >= 0,
  JSON.stringify({ groups: popover === null ? null : popover.groups, japan: addTexts.indexOf("日本 Japan"), china: addTexts.indexOf("中国 China"), iceland: addTexts.indexOf("冰岛 Iceland") })
);
await focusSearch();
await typeText("冰岛");
popover = await probe(readPopover);
check("添加器搜中文「冰岛」：候选收敛到 1 条 = 冰岛 Iceland（欧洲）", popover !== null && popover.rows.length === 1 && popover.rows[0].text === "冰岛 Iceland" && popover.rows[0].group === "欧洲", JSON.stringify(popover === null ? null : popover.rows));
await clearSearch();
await focusSearch();
await typeText("Iceland");
popover = await probe(readPopover);
check("添加器搜英文「Iceland」：同样收敛到 冰岛（英文国名也能搜）", popover !== null && popover.rows.length === 1 && popover.rows[0].text === "冰岛 Iceland", JSON.stringify(popover === null ? null : popover.rows));
await clearSearch();
await focusSearch();
await typeText(SEARCH_MISS);
popover = await probe(readPopover);
check("添加器搜不到：候选 0 条 + 提示行「没有匹配的国家 / 地区（已收录的不再列出）。」", popover !== null && popover.rows.length === 0 && popover.hasAddEmpty === true, JSON.stringify(popover === null ? null : { rows: popover.rows.length, empty: popover.hasAddEmpty }));
await shot("07-modal-add-picker");
await clickByText(POPOVER_SELECTOR, "取消");
await sleep(500);
popover = await probe(readPopover);
check("点「取消」回到候选列表（一个字都没写进字典）", popover !== null && popover.rows.length === dictRegionCount, JSON.stringify(popover === null ? null : popover.rows.length));

// —— ⑤c 点一行即新增（真 PG 落行）→ 断言后物理删掉、零残留 ——
await clickByText(POPOVER_SELECTOR, "添加地区");
await sleep(600);
await focusSearch();
await typeText("冰岛");
popover = await probe(readPopover);
check("添加器再搜「冰岛」：候选仍在（还没写进字典）", popover !== null && popover.rows.length === 1, JSON.stringify(popover === null ? null : popover.rows));
await clickSelector(POPOVER_SELECTOR + " [role=listbox] [role=option]");
await sleep(1000);
const popoverAfterAdd = await probe(readPopover);
const triggerAfterAdd = String(await ev("document.querySelector(" + j(REGION_TRIGGER) + ").textContent"));
try {
  const addedRow = (await db.query("select code, name, enabled, sort from dict_items where type_code = $1 and code = $2", ["region", "冰岛"])).rows[0];
  check("点一行「冰岛」= 直接新增并选中：浮层关闭、触发器显示冰岛", popoverAfterAdd === null && triggerAfterAdd === "冰岛", JSON.stringify({ popover: popoverAfterAdd === null, trigger: triggerAfterAdd }));
  check(
    "新条目落进真 PG：code = name = 冰岛、enabled、sort 排到最后（>" + String(maxDictSort) + "）",
    addedRow !== undefined && addedRow.name === "冰岛" && addedRow.enabled === true && Number(addedRow.sort) > maxDictSort,
    JSON.stringify(addedRow === undefined ? null : addedRow)
  );
} finally {
  await db.query("delete from dict_items where type_code = $1 and code = $2", ["region", "冰岛"]);
}
const addResidue = (await db.query("select count(*)::int as n from dict_items where type_code = $1 and code = $2", ["region", "冰岛"])).rows[0];
check("清理：回放新增的「冰岛」已物理删掉、库内零残留", Number(addResidue.n) === 0, JSON.stringify(addResidue));

await clickByText(DIALOG, "取消");
await sleep(700);
const dialogClosed = (await ev("document.querySelector(" + j(DIALOG) + ")===null")) === true;
const projectsAllAfter = Number((await db.query("select count(*)::int as n from projects")).rows[0].n);
check("关掉弹窗：库里项目数不变（回放只读，不建项目 / 不改字典，" + String(projectsAllBefore) + " 行）", dialogClosed && projectsAllAfter === projectsAllBefore, JSON.stringify({ dialogClosed, projectsAllBefore, projectsAllAfter }));

// ── ⑥ 收尾：控制台零报错 + 会话零残留 ──
check("控制台零报错（error / warning 都没有）", consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" | "));
await db.query("update sessions set revoked_at = now() where token_hash = $1", [sha256(token)]);
const residue = (await db.query("select count(*)::int as n from sessions where token_hash = $1 and revoked_at is null", [sha256(token)])).rows[0];
check("清理：临时会话已撤销、零残留", Number(residue.n) === 0, JSON.stringify(residue));

const failed = checks.filter((item) => item.ok !== true);
console.log("");
console.log("=== 汇总：" + String(checks.length) + " 项，通过 " + String(checks.length - failed.length) + "，失败 " + String(failed.length) + " ===");
for (const item of failed) {
  console.log("  FAIL  " + item.name + "  —— " + String(item.detail));
}
console.log("截图目录：" + SHOTS);
await db.end();
chrome.kill();
process.exit(failed.length === 0 ? 0 : 1);
