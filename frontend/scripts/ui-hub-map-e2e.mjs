#!/usr/bin/env node
/**
 * LibiaoLink 前端 · 回放：入口页改版（左侧竖排三胶囊 + 右侧平面世界地图 + 鼠标触碰动画）
 *
 * 业务口径（2026-09-24）：「在首页做一个地图 把首页三个胶囊放到最左侧上下排列 右侧部分则建一个平面地图 如图所示
 *   但是鼠标触碰有动画效果」；追订：「参考图的蓝点不需要」「我想要各个国家都可以展现」。
 *
 * 本脚本用真机浏览器（无头 Chrome + CDP，真实鼠标坐标）验：
 *   ① 三个入口胶囊在最左侧竖排（x 中心对齐、y 递增、整体落在视口左侧）；
 *   ② 右侧是地图面板（面板在胶囊右边，内含 .hub-map，viewBox 与生成物一致）；
 *   ③ 底图 = 172 个国家路径（逐国带国名）＋ 29 个微国符号（110m 精度画不出的主权小国，含新加坡）；装饰性点位 / 文字 / 图片仍然没有；
 *   ④ 鼠标触碰某国：只有该国命中 hover、填充变深、左上角徽标报出国名；换一国则随之切换；
 *   ⑤ 鼠标触碰面板空白处：hover 归零、徽标收起、面板投影加深（不再整图缩放）；
 *   ⑥ 窄屏回落：胶囊改横排在上、地图在下；
 *   ⑦ 项目联动（方案 E：静止不上柱、触碰才出柱）：有项目的国家 / 微国按项目数上蓝色底色
 *      （七追订「这个颜色深浅不能按照固定的数据来 到时候所有地区大于3个不就是同一个颜色了吗」→ 档位随数据
 *      自适应、最多 5 档，项目越多颜色越深 —— 脚本复刻同一个分档算法再逐国对账）；
 *      鼠标触碰才长出立柱（柱顶报项目数、右上角出「项目梳理」清单），移开收回；点柱进「项目空间」按地区筛选；
 *   ⑨ 九追订（业务改口「不要改成4s了 改成点击国家区域即可」）：点一下有项目的国家区域 → 立柱停留
 *      （鼠标走开也不收回）、右上角「项目梳理」接通鼠标（列表可滑动 / 点「展开全部」看全量）；
 *      再点一次同一国 / 按 Esc / 点海面空白处 / 点「×」解除，点别国就把钉子挪过去；
 *   ⑧ 控制台零报错；跑完会话撤销、库内零残留。
 *
 * 前置（三件都在本机跑着）：
 *   1. 前端 dev：cd frontend && npm run dev（默认 3000）
 *   2. api：cd server && npm run start:api（默认 3001，需先 npm run build）
 *   3. 数据库：本地沙箱 PG（默认 127.0.0.1:5433/libiaolink）
 *   4. 本机装了 Chrome（脚本 headless 起一个调试实例；路径可用 CHROME_PATH 覆盖）
 *
 * 用法：node scripts/ui-hub-map-e2e.mjs
 *   可覆盖的环境变量：FRONTEND_BASE / API_BASE / DATABASE_URL / CHROME_PATH / CDP_PORT / REPLAY_USER / PG_MODULE / SHOT_DIR
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
const PORT = Number(process.env.CDP_PORT ?? 9402);
const DB = process.env.DATABASE_URL ?? "postgres://libiaolink_api@127.0.0.1:5433/libiaolink";
const REPLAY_USER = process.env.REPLAY_USER ?? "panxing";
const SHOTS = process.env.SHOT_DIR ?? join(tmpdir(), "px-hub-map-shots");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const Q = String.fromCharCode(34);
const j = (value) => JSON.stringify(value);
const EXPECTED_VIEWBOX = "0 0 1000 394.4";
const EXPECTED_COUNTRIES = 172;
/** 微国符号：110m 国界精度画不出的主权国家（新加坡、巴林、马耳他……），一张圆点一个国 */
const EXPECTED_MICRO_STATES = 29;
const MICRO_REST_FILL = "rgb(182, 190, 204)";
const MICRO_HOVER_FILL = "rgb(124, 134, 152)";
/** 微国符号抽查点位（覆盖欧亚 / 欧洲 / 地中海几处最容易画丢的） */
const MICRO_SPOT_CHECKS = ["新加坡", "巴林", "马耳他", "摩纳哥", "梵蒂冈"];
/** 南海诸岛符号：视口里岛礁本体不足 1px，按中国标准地图习惯点出来 —— 只点群岛、一个群岛一个点（东沙 / 西沙 / 中沙 / 南沙 / 南沙南部·曾母暗沙一带） */
const EXPECTED_NANHAI_ISLANDS = 5;
const NANHAI_REST_FILL = "rgb(182, 190, 204)";
const NANHAI_HOVER_FILL = "rgb(124, 134, 152)";
const COUNTRY_REST_FILL = "rgb(231, 233, 238)";
const COUNTRY_HOVER_FILL = "rgb(199, 206, 218)";
/** 有项目的国家 / 微国：整块国土按项目数上蓝色底色 + 深蓝轮廓（方案 E；七追订「这个颜色深浅不能按照固定的
    数据来 到时候所有地区大于3个不就是同一个颜色了吗」→ 档位从写死的三档改成随数据自适应），
    触碰 / 立柱联动时一律压到最深的触碰色（#1a73e8）换白轮廓。 */
const PROJECT_BLUE_DEEP = "rgb(26, 115, 232)";
/** 色阶 5 档由浅到深（与 app.css 的 [data-tier="1"]..[data-tier="5"] 同值）；档数少于 5 时按槽位「拉开」用 */
const TIER_MAX = 5;
const TIER_FILL = {
  1: "rgb(200, 220, 252)",
  2: "rgb(163, 198, 250)",
  3: "rgb(127, 172, 247)",
  4: "rgb(82, 144, 244)",
  5: "rgb(47, 111, 224)"
};
/** 立柱分段四色（与 app.css 的 .hub-map__pillar-seg[data-status] 同值；柱顶椭圆跟最上段同色） */
const PILLAR_STATUS_FILL = {
  active: "rgb(26, 115, 232)",
  paused: "rgb(242, 153, 0)",
  done: "rgb(30, 142, 62)",
  archived: "rgb(154, 160, 166)"
};
/** 中国口径硬护栏：这几个都不允许作为独立国家出现在图上（台湾是中国的省；后三个中国不承认） */
const FORBIDDEN_ENTITIES = ["台湾", "科索沃", "北塞浦路斯", "索马里兰"];
/** 台译 / 繁体 / 旧译名：中文名按大陆口径修正后，这些都不该再出现 */
const FORBIDDEN_NAMES = ["多明尼加", "北馬其頓", "法国南部和南极土地", "福克兰群岛", "民主刚果"];
/** 中国国界必须覆盖到的点位（中国标准地图口径），新德里做反向对照 */
const CHINA_MUST_COVER = [["台北", 121.0, 23.7], ["藏南", 94.6, 27.9], ["阿克赛钦", 79.5, 35.0], ["钓鱼岛", 123.48, 25.75]];
const CHINA_MUST_NOT_COVER = [["新德里", 77.2, 28.6]];
const EXPECTED_DASHLINE = 10;

/** 触碰验证的候选国家：疆域大、无跨经线切分；**实际用哪些要看库里有项目没有** ——
 * 「静止灰底 + 触碰变深」这一套只对没有项目的国家成立（有项目的是三档蓝底 + 触碰才出柱那一套）。 */
const HOVER_CANDIDATES = ["墨西哥", "阿尔及利亚", "伊朗", "蒙古", "埃及", "斐济"];

mkdirSync(SHOTS, { recursive: true });
const db = new Client({ connectionString: DB });
await db.connect();
const userRow = (await db.query("select id, username, display_name from users where username = $1", [REPLAY_USER])).rows[0];
if (userRow === undefined) {
  console.error("回放用户不存在：" + REPLAY_USER);
  process.exit(1);
}
const dictRegionRows = (await db.query("select code, name from dict_items where type_code = $1", ["region"])).rows;
/** 地区码 → 图上国家名（与前端 dictLabel 同一套口径：字典没配就退回码本身） */
const dictRegions = new Map(dictRegionRows.map((row) => [row.code, row.name]));
const regionLabel = (region) => (dictRegions.get(region) ?? region);
const projectLabels = new Set((await db.query("select region from projects where deleted_at is null group by region")).rows.map((row) => regionLabel(row.region)));
const HOVER_TARGETS = HOVER_CANDIDATES.filter((name) => !projectLabels.has(name));
/** 图上国家名 → 库内项目数（按字典标签归拢，与前端 matchRegion 同一套口径）＋ 分档函数
    （与 HubMap.tsx 的 buildTierBounds / tierIndex / tierSlot / tierText 同一套算法，逐行照抄） */
const dbTotalByName = new Map();
for (const row of (await db.query("select region, count(*)::int as n from projects where deleted_at is null group by region")).rows) {
  const label = regionLabel(row.region);
  dbTotalByName.set(label, (dbTotalByName.get(label) ?? 0) + row.n);
}
function buildTierBounds(totals) {
  if (totals.length === 0) {
    return [];
  }
  const counted = new Map();
  for (const total of totals) {
    counted.set(total, (counted.get(total) ?? 0) + 1);
  }
  const values = [...counted.keys()].sort((a, b) => a - b);
  const max = values[values.length - 1];
  const scale = Math.min(TIER_MAX, Math.max(1, Math.ceil(Math.log2(max + 1))), values.length);
  const perTier = totals.length / scale;
  const bounds = [];
  let acc = 0;
  for (let index = 0; index < values.length; index += 1) {
    acc += counted.get(values[index]) ?? 0;
    if (bounds.length < scale - 1 && acc >= perTier && index < values.length - 1) {
      bounds.push(values[index]);
      acc = 0;
    }
  }
  if (bounds[bounds.length - 1] !== max) {
    bounds.push(max);
  }
  return bounds;
}
const tierBounds = buildTierBounds([...dbTotalByName.values()]);
const tierIndex = (total) => {
  for (let index = 0; index < tierBounds.length; index += 1) {
    if (total <= tierBounds[index]) {
      return index + 1;
    }
  }
  return tierBounds.length;
};
const tierSlotOf = (total) => (tierBounds.length <= 1 ? Math.ceil(TIER_MAX / 2) : Math.round(1 + ((tierIndex(total) - 1) * (TIER_MAX - 1)) / (tierBounds.length - 1)));
const tierFillOf = (name) => {
  const total = dbTotalByName.get(name);
  return total === undefined ? null : TIER_FILL[tierSlotOf(total)];
};
const tierTextOf = (index) => {
  const upper = tierBounds[index];
  const lower = index === 0 ? 1 : tierBounds[index - 1] + 1;
  if (lower === upper) {
    return String(upper) + " 个项目";
  }
  return index === tierBounds.length - 1 ? String(lower) + " 个及以上" : String(lower) + "–" + String(upper) + " 个项目";
};
const token = "pxhubmap-" + randomBytes(16).toString("hex");

// 档位名（与 HubMap.tsx 的 TIER_NAMES / tierName 同源）：图例只报「一档 / 二档 / …」，条数范围在悬停说明里
const TIER_NAMES = ["一档", "二档", "三档", "四档", "五档"];
const tierNameOf = (index) => TIER_NAMES[index] ?? String(index + 1) + " 档";
const csrf = randomBytes(16).toString("hex");
await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(mins => 30))", [sha256(token), userRow.id, "px-hub-map-e2e"]);
console.log("临时会话：" + userRow.username + "（" + userRow.display_name + "）");

const profile = mkdtempSync(join(tmpdir(), "pxhubmap-"));
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
        return;
      }
      if (msg.method === "Runtime.exceptionThrown") {
        consoleErrors.push("exception: " + String(msg.params.exceptionDetails.text) + " " + String(msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description));
      }
      if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "warning")) {
        const text = msg.params.args.map((arg) => String(arg.value === undefined ? arg.description : arg.value)).join(" ");
        consoleErrors.push(msg.params.type + ": " + text);
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
await page.send("DOM.enable");
await page.send("CSS.enable");
await page.send("Network.setCookie", { name: "ll_sid", value: token, url: FRONTEND + "/", path: "/", httpOnly: true, secure: false });
await page.send("Network.setCookie", { name: "ll_csrf", value: csrf, url: FRONTEND + "/", path: "/", httpOnly: false, secure: false });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ev = async (expression) => (await page.send("Runtime.evaluate", { expression, returnByValue: true })).result.value;

async function openHub(width, height) {
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await page.send("Page.navigate", { url: "about:blank" });
  await sleep(400);
  await page.send("Page.navigate", { url: FRONTEND + "/#/" });
  for (let i = 0; i < 30; i += 1) {
    const ready = await ev("document.querySelector(" + j("svg.hub-map") + ")===null?0:1");
    if (Number(ready) === 1) break;
    await sleep(500);
  }
  await sleep(1200);
}

async function moveMouse(x, y) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await sleep(450);
}

/** 九追订用：按一下 Esc（解除钉住） */
async function pressEscape() {
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(700);
}

/** 九追订用：按真实鼠标坐标点一下（清单上的「展开全部」/「×」走这条） */
async function clickAt(point) {
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(700);
}

async function shot(name, clip) {
  const params = { format: "png" };
  if (clip !== undefined && clip !== null) {
    params.clip = clip;
  }
  const result = await page.send("Page.captureScreenshot", params);
  const file = join(SHOTS, name + ".png");
  writeFileSync(file, Buffer.from(result.data, "base64"));
  return file;
}

const NAV = "[aria-label=" + Q + "业务入口" + Q + "]";
const pillsExpr = () => "(function(){var out=[];var as=document.querySelectorAll(" + j(NAV + " a") + ");for(var i=0;i<as.length;i++){var r=as[i].getBoundingClientRect();out.push({text:(as[i].innerText||" + j("") + ").trim(),href:as[i].getAttribute(" + j("href") + "),x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)});}return out;})()";
const panelExpr = () => "(function(){var el=document.querySelector(" + j("section.hub-map-panel") + ");if(el===null){return null;}var r=el.getBoundingClientRect();var svg=el.querySelector(" + j("svg.hub-map") + ");var s=svg===null?null:svg.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),svgW:s===null?0:Math.round(s.width),svgH:s===null?0:Math.round(s.height),viewBox:svg===null?" + j("") + ":svg.getAttribute(" + j("viewBox") + "),role:svg===null?" + j("") + ":svg.getAttribute(" + j("role") + "),label:svg===null?" + j("") + ":svg.getAttribute(" + j("aria-label") + ")};})()";
const mapExpr = () => "(function(){var svg=document.querySelector(" + j("svg.hub-map") + ");if(svg===null){return null;}var ps=svg.querySelectorAll(" + j("path.hub-map__country") + ");var seen={};var dup=0;var empty=0;for(var i=0;i<ps.length;i+=1){var n=String(ps[i].getAttribute(" + j("data-country") + ")||" + j("") + ");if(n===" + j("") + "){empty+=1;}if(seen[n]===1){dup+=1;}seen[n]=1;}var forbidden=0;var want=" + j(FORBIDDEN_ENTITIES) + ";for(var k=0;k<want.length;k+=1){if(seen[want[k]]===1){forbidden+=1;}}var stale=0;var badNames=" + j(FORBIDDEN_NAMES) + ";for(var m=0;m<badNames.length;m+=1){if(seen[badNames[m]]===1){stale+=1;}}return {countries:ps.length,dup:dup,empty:empty,forbidden:forbidden,staleName:stale,hasChina:seen[" + j("中国") + "]===1,hasBrazil:seen[" + j("巴西") + "]===1,hasUnitedStates:seen[" + j("美国") + "]===1,dash:svg.querySelectorAll(" + j("g.hub-map__dashline path") + ").length,circles:svg.querySelectorAll(" + j("circle:not(.hub-map__micro-hit):not(.hub-map__micro-dot):not(.hub-map__nanhai-hit):not(.hub-map__nanhai-island)") + ").length,texts:svg.querySelectorAll(" + j("text:not(.hub-map__pillar-count)") + ").length,images:svg.querySelectorAll(" + j("image") + ").length,markers:svg.querySelectorAll(" + j("marker") + ").length};})()";
const badgeExpr = () => "(function(){var b=document.querySelector(" + j("div.hub-map-badge") + ");if(b===null){return null;}var zh=b.querySelector(" + j("span.hub-map-badge__zh") + ");var en=b.querySelector(" + j("span.hub-map-badge__en") + ");return {active:String(b.getAttribute(" + j("data-active") + ")),zh:zh===null?" + j("") + ":String(zh.textContent),en:en===null?" + j("") + ":String(en.textContent),opacity:Number(getComputedStyle(b).opacity)};})()";
const styleExpr = (x, y) => "(function(){var el=document.elementFromPoint(" + String(x) + "," + String(y) + ");var svg=document.querySelector(" + j("svg.hub-map") + ");var first=document.querySelector(" + j("path.hub-map__country[data-tier=" + Q + "0" + Q + "]") + ");var hovering=document.querySelector(" + j("path.hub-map__country:hover") + ");var panel=document.querySelector(" + j("section.hub-map-panel") + ");return {hitTag:el===null?" + j("null") + ":el.tagName.toLowerCase(),hitCountry:el===null?" + j("") + ":String(el.getAttribute(" + j("data-country") + ")||" + j("") + "),hovered:document.querySelectorAll(" + j("path.hub-map__country:hover") + ").length,hoveredName:hovering===null?" + j("") + ":String(hovering.getAttribute(" + j("data-country") + ")||" + j("") + "),restFill:first===null?" + j("") + ":getComputedStyle(first).fill,hitFill:el===null?" + j("") + ":getComputedStyle(el).fill,transition:first===null?" + j("") + ":getComputedStyle(first).transitionProperty,mapTransform:svg===null?" + j("") + ":getComputedStyle(svg).transform,panelShadow:panel===null?" + j("") + ":getComputedStyle(panel).boxShadow};})()";

/** 在指定国家的包围盒里找一个真落在该国上的点（包围盒中心可能压在别国或海上） */
const findCountryPointExpr = (name) => "(function(){var svg=document.querySelector(" + j("svg.hub-map") + ");if(svg===null){return null;}var ps=svg.querySelectorAll(" + j("path.hub-map__country") + ");var target=null;for(var i=0;i<ps.length;i+=1){if(String(ps[i].getAttribute(" + j("data-country") + "))===" + j(name) + "){target=ps[i];break;}}if(target===null){return null;}var r=target.getBoundingClientRect();for(var gy=0.05;gy<=0.95;gy+=0.045){for(var gx=0.05;gx<=0.95;gx+=0.045){var x=r.left+r.width*gx;var y=r.top+r.height*gy;if(document.elementFromPoint(x,y)===target){return {x:Math.round(x),y:Math.round(y),bx:Math.round(r.left),by:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};}}}return null;})()";
const findOceanPointExpr = () => "(function(){var svg=document.querySelector(" + j("svg.hub-map") + ");if(svg===null){return null;}var r=svg.getBoundingClientRect();for(var gy=0.06;gy<=0.94;gy+=0.03){for(var gx=0.04;gx<=0.96;gx+=0.015){var x=r.left+r.width*gx;var y=r.top+r.height*gy;var el=document.elementFromPoint(x,y);if(el!==null&&el.tagName.toLowerCase()===" + j("svg") + "){return {x:Math.round(x),y:Math.round(y)};}}}return null;})()";

/** 用 SVG 自带的点在面内判定验中国国界口径（台北 / 藏南 / 阿克赛钦 / 钓鱼岛应在，新德里应不在） */
const chinaGeoExpr = () => "(function(){var svg=document.querySelector(" + j("svg.hub-map") + ");if(svg===null){return null;}var china=null;var ps=svg.querySelectorAll(" + j("path.hub-map__country") + ");for(var i=0;i<ps.length;i+=1){if(String(ps[i].getAttribute(" + j("data-country") + "))===" + j("中国") + "){china=ps[i];break;}}if(china===null){return null;}var unit=svg.viewBox.baseVal.width/360;var at=function(lon,lat){var p=svg.createSVGPoint();p.x=(lon+180)*unit;p.y=(84-lat)*unit;return p;};var cover=" + j(CHINA_MUST_COVER) + ";var covered=[];for(var a=0;a<cover.length;a+=1){covered.push(china.isPointInFill(at(cover[a][1],cover[a][2])));}var notCover=" + j(CHINA_MUST_NOT_COVER) + ";var outside=[];for(var b=0;b<notCover.length;b+=1){outside.push(!china.isPointInFill(at(notCover[b][1],notCover[b][2])));}return {covered:covered,outside:outside};})()";
/** 经纬度 → 屏幕坐标，并回验这个像素命中的就是指定那条路径 */
const findGeoPointExpr = (lon, lat, name) => "(function(){var svg=document.querySelector(" + j("svg.hub-map") + ");if(svg===null){return null;}var target=null;var ps=svg.querySelectorAll(" + j("path.hub-map__country") + ");for(var i=0;i<ps.length;i+=1){if(String(ps[i].getAttribute(" + j("data-country") + "))===" + j(name) + "){target=ps[i];break;}}if(target===null){return null;}var unit=svg.viewBox.baseVal.width/360;var p=svg.createSVGPoint();p.x=(" + String(lon) + "+180)*unit;p.y=(84-(" + String(lat) + "))*unit;var m=target.getScreenCTM();if(m===null){return null;}var screen=p.matrixTransform(m);var el=document.elementFromPoint(screen.x,screen.y);return {x:Math.round(screen.x),y:Math.round(screen.y),hit:el===target,hitCountry:el===null?" + j("") + ":String(el.getAttribute(" + j("data-country") + ")||" + j("") + ")};})()";
/** 中国 + 台湾 + 南海这一片的屏幕裁切框（按经纬度换算，给证据图用） */
const chinaBoxExpr = (box) => "(function(){var svg=document.querySelector(" + j("svg.hub-map") + ");if(svg===null){return null;}var box=(" + j(box) + ").split(\",\");var unit=svg.viewBox.baseVal.width/360;var m=svg.getScreenCTM();if(m===null){return null;}var at=function(lon,lat){var p=svg.createSVGPoint();p.x=(lon+180)*unit;p.y=(84-lat)*unit;return p.matrixTransform(m);};var a=at(Number(box[0]),Number(box[1]));var b=at(Number(box[2]),Number(box[3]));return {x:Math.round(Math.min(a.x,b.x)),y:Math.round(Math.min(a.y,b.y)),width:Math.round(Math.abs(b.x-a.x)),height:Math.round(Math.abs(a.y-b.y)),scale:3};})()";

const microExpr = () => "(function(){var svg=document.querySelector(" + j("svg.hub-map") + ");if(svg===null){return null;}var gs=svg.querySelectorAll(" + j("g.hub-map__micro") + ");var names=[];var seen={};var dup=0;var empty=0;var forbidden=0;var countries={};var ps=svg.querySelectorAll(" + j("path.hub-map__country") + ");for(var p=0;p<ps.length;p+=1){countries[String(ps[p].getAttribute(" + j("data-country") + ")||" + j("") + ")]=1;}var overlap=0;for(var i=0;i<gs.length;i+=1){var n=String(gs[i].getAttribute(" + j("data-country") + ")||" + j("") + ");if(n===" + j("") + "){empty+=1;}if(seen[n]===1){dup+=1;}if(countries[n]===1){overlap+=1;}seen[n]=1;names.push(n);}var want=" + j(FORBIDDEN_ENTITIES) + ";for(var k=0;k<want.length;k+=1){if(seen[want[k]]===1){forbidden+=1;}}var vx=svg.viewBox.baseVal.width;var vy=svg.viewBox.baseVal.height;var dots=svg.querySelectorAll(" + j("circle.hub-map__micro-dot") + ");var outOfView=0;for(var m=0;m<dots.length;m+=1){var cx=Number(dots[m].getAttribute(" + j("cx") + "));var cy=Number(dots[m].getAttribute(" + j("cy") + "));if(!(cx>=0&&cx<=vx&&cy>=0&&cy<=vy)){outOfView+=1;}}return {micro:gs.length,dots:dots.length,dup:dup,empty:empty,overlap:overlap,forbidden:forbidden,outOfView:outOfView,names:names};})()";
/** 微国符号的屏幕落点：按圆心换算，并回验这个像素命中的就是这个符号（不是盖在它上面的国家） */
const microPointExpr = (name) => "(function(){var svg=document.querySelector(" + j("svg.hub-map") + ");if(svg===null){return null;}var gs=svg.querySelectorAll(" + j("g.hub-map__micro") + ");var target=null;for(var i=0;i<gs.length;i+=1){if(String(gs[i].getAttribute(" + j("data-country") + "))===" + j(name) + "){target=gs[i];break;}}if(target===null){return null;}var dot=target.querySelector(" + j("circle.hub-map__micro-dot") + ");var m=dot.getScreenCTM();if(m===null){return null;}var p=svg.createSVGPoint();p.x=Number(dot.getAttribute(" + j("cx") + "));p.y=Number(dot.getAttribute(" + j("cy") + "));var s=p.matrixTransform(m);var el=document.elementFromPoint(s.x,s.y);var hit=el===null?null:el.closest(" + j("g.hub-map__micro") + ");return {x:Math.round(s.x),y:Math.round(s.y),hitTag:el===null?" + j("") + ":el.tagName.toLowerCase(),hitName:hit===null?" + j("") + ":String(hit.getAttribute(" + j("data-country") + ")||" + j("") + "),hitIsTarget:hit===target,hitCountry:String(target.getAttribute(" + j("data-country") + ")||" + j("") + "),dotFill:getComputedStyle(dot).fill};})()";
/** 微国符号的触碰态：命中 :hover 的符号数、是哪一个、圆点实际填充色 */
const microStyleExpr = () => "(function(){var hovered=document.querySelectorAll(" + j("g.hub-map__micro:hover") + ");var g=hovered.length>0?hovered[0]:null;var dot=g===null?null:g.querySelector(" + j("circle.hub-map__micro-dot") + ");return {hoveredMicro:hovered.length,hoveredMicroName:g===null?" + j("") + ":String(g.getAttribute(" + j("data-country") + ")||" + j("") + "),dotFill:dot===null?" + j("") + ":getComputedStyle(dot).fill};})()";

/** 南海诸岛符号层：点数、是否都在视口里、静止态填充 */
const nanhaiExpr = () => "(function(){var svg=document.querySelector(" + j("svg.hub-map") + ");if(svg===null){return null;}var gs=svg.querySelectorAll(" + j("g.hub-map__nanhai") + ");var dots=svg.querySelectorAll(" + j("circle.hub-map__nanhai-island") + ");var vx=svg.viewBox.baseVal.width;var vy=svg.viewBox.baseVal.height;var outOfView=0;var box=[1e9,1e9,-1e9,-1e9];for(var i=0;i<dots.length;i+=1){var cx=Number(dots[i].getAttribute(" + j("cx") + "));var cy=Number(dots[i].getAttribute(" + j("cy") + "));if(!(cx>=0&&cx<=vx&&cy>=0&&cy<=vy)){outOfView+=1;}if(cx<box[0]){box[0]=cx;}if(cy<box[1]){box[1]=cy;}if(cx>box[2]){box[2]=cx;}if(cy>box[3]){box[3]=cy;}}return {groups:gs.length,dots:dots.length,hits:svg.querySelectorAll(" + j("circle.hub-map__nanhai-hit") + ").length,outOfView:outOfView,box:box,fill:dots.length===0?" + j("") + ":getComputedStyle(dots[0]).fill,name:gs.length===0?" + j("") + ":String(gs[0].getAttribute(" + j("data-country") + ")||" + j("") + ")};})()";
/** 南海诸岛符号的屏幕落点：取最南那一点（曾母暗沙一带），并回验命中的就是这个符号 */
const nanhaiPointExpr = () => "(function(){var svg=document.querySelector(" + j("svg.hub-map") + ");if(svg===null){return null;}var gs=svg.querySelectorAll(" + j("g.hub-map__nanhai") + ");if(gs.length===0){return null;}var target=null;var bestY=-1;for(var i=0;i<gs.length;i+=1){var d=gs[i].querySelector(" + j("circle.hub-map__nanhai-island") + ");var cy=Number(d.getAttribute(" + j("cy") + "));if(cy>bestY){bestY=cy;target=gs[i];}}var dot=target.querySelector(" + j("circle.hub-map__nanhai-island") + ");var m=target.getScreenCTM();if(m===null){return null;}var p=svg.createSVGPoint();p.x=Number(dot.getAttribute(" + j("cx") + "));p.y=Number(dot.getAttribute(" + j("cy") + "));var s=p.matrixTransform(m);var el=document.elementFromPoint(s.x,s.y);var hit=el===null?null:el.closest(" + j("g.hub-map__nanhai") + ");return {x:Math.round(s.x),y:Math.round(s.y),cx:Number(dot.getAttribute(" + j("cx") + ")),cy:Number(dot.getAttribute(" + j("cy") + ")),hitIsTarget:hit===target,dotFill:getComputedStyle(dot).fill,name:String(target.getAttribute(" + j("data-country") + ")||" + j("") + ")};})()";
/** 南海诸岛符号的触碰态：命中 :hover 的符号数、圆点实际填充色 */
const nanhaiStyleExpr = () => "(function(){var hovered=document.querySelectorAll(" + j("g.hub-map__nanhai:hover") + ");var g=hovered.length>0?hovered[0]:null;var dot=g===null?null:g.querySelector(" + j("circle.hub-map__nanhai-island") + ");return {hoveredNanhai:hovered.length,dotFill:dot===null?" + j("") + ":getComputedStyle(dot).fill};})()";
/** 立柱层（Push 188 追订）：选择器与属性名集中一处，表达式里用 j() 拼，免得引号打架 */
const PILLAR_SEL = "g.hub-map__pillar";
const PILLAR_HIT_SEL = "rect.hub-map__pillar-hit";
const PILLAR_SEG_SEL = "rect.hub-map__pillar-seg";
const PILLAR_ATTR = "data-pillar";
const LINKED_COUNTRY_SEL = "path.hub-map__country[data-linked=" + Q + "true" + Q + "]";
/** 立柱层状态：每根柱的国名 / 项目数 / 高度 / 锚点 / 分段 + 左右浮层 + 联动态 */
const pillarsExpr = () => "(function(){var svg=document.querySelector(" + j("svg.hub-map") + ");if(svg===null){return null;}var gs=svg.querySelectorAll(" + j(PILLAR_SEL) + ");var out=[];var linkedPillar=" + j("") + ";for(var i=0;i<gs.length;i+=1){var g=gs[i];var segs=g.querySelectorAll(" + j(PILLAR_SEG_SEL) + ");var statuses=[];for(var k=0;k<segs.length;k+=1){statuses.push(String(segs[k].getAttribute(" + j("data-status") + ")));}var name=String(g.getAttribute(" + j(PILLAR_ATTR) + ")||" + j("") + ");if(g.getAttribute(" + j("data-linked") + ")===" + j("true") + "){linkedPillar=name;}var labelNode=g.querySelector(" + j("text.hub-map__pillar-count") + ");var body=g.querySelector(" + j("g.hub-map__pillar-body") + ");var hit=body===null?null:g.querySelector(" + j(PILLAR_HIT_SEL) + ");out.push({name:name,shown:String(g.getAttribute(" + j("data-shown") + ")||" + j("") + "),bodyOpacity:body===null?-1:Number(getComputedStyle(body).opacity),hitPointer:hit===null?" + j("") + ":getComputedStyle(hit).pointerEvents,countOpacity:labelNode===null?-1:Number(getComputedStyle(labelNode).opacity),label:labelNode===null?" + j("") + ":(labelNode.textContent||" + j("") + ").trim(),kind:String(g.getAttribute(" + j("data-kind") + ")||" + j("") + "),count:Number(g.getAttribute(" + j("data-count") + ")||0),height:Number(g.getAttribute(" + j("data-height") + ")||0),x:Number(g.getAttribute(" + j("data-x") + ")||0),y:Number(g.getAttribute(" + j("data-y") + ")||0),segments:statuses});}var lcs=svg.querySelectorAll(" + j(LINKED_COUNTRY_SEL) + ");var linkedCountry=lcs.length===0?" + j("") + ":(lcs.length===1?String(lcs[0].getAttribute(" + j("data-country") + ")||" + j("") + "):" + j("*") + "+String(lcs.length));var badge=document.querySelector(" + j("span.hub-map-badge__count") + ");var panel=document.querySelector(" + j("div.hub-map-projects") + ");var rows=[];if(panel!==null){var lis=panel.querySelectorAll(" + j("li.hub-map-projects__row") + ");for(var r=0;r<lis.length;r+=1){var nm=lis[r].querySelector(" + j("span.hub-map-projects__name") + ");var st=lis[r].querySelector(" + j("span.hub-map-projects__status") + ");rows.push({name:nm===null?" + j("") + ":(nm.innerText||" + j("") + ").trim(),status:st===null?" + j("") + ":(st.innerText||" + j("") + ").trim()});}}var more=panel===null?null:panel.querySelector(" + j("div.hub-map-projects__more") + ");var legend=document.querySelector(" + j(".hub-map-legend") + ");return {pillars:out,linkedPillar:linkedPillar,linkedCountry:linkedCountry,badgeCount:badge===null?" + j("") + ":(badge.innerText||" + j("") + ").trim(),panelActive:panel!==null&&panel.getAttribute(" + j("data-active") + ")===" + j("true") + ",panelCountry:panel===null?" + j("") + ":String(panel.getAttribute(" + j("data-country") + ")||" + j("") + "),panelRows:rows,panelMore:more===null?" + j("") + ":(more.innerText||" + j("") + ").trim(),legendText:legend===null?" + j("") + ":(legend.innerText||" + j("") + ").trim()};})()";
/** 立柱的屏幕落点（命中矩形中心）+ 命中验证 */
const pillarPointExpr = (name) => "(function(){var svg=document.querySelector(" + j("svg.hub-map") + ");if(svg===null){return null;}var gs=svg.querySelectorAll(" + j(PILLAR_SEL) + ");var target=null;for(var i=0;i<gs.length;i+=1){if(String(gs[i].getAttribute(" + j(PILLAR_ATTR) + "))===" + j(name) + "){target=gs[i];break;}}if(target===null){return null;}var hit=target.querySelector(" + j(PILLAR_HIT_SEL) + ");var m=hit.getScreenCTM();if(m===null){return null;}var p=svg.createSVGPoint();p.x=Number(hit.getAttribute(" + j("x") + "))+Number(hit.getAttribute(" + j("width") + "))/2;p.y=Number(hit.getAttribute(" + j("y") + "))+Number(hit.getAttribute(" + j("height") + "))/2;var s=p.matrixTransform(m);var el=document.elementFromPoint(s.x,s.y);var owner=el===null?null:el.closest(" + j(PILLAR_SEL) + ");return {x:Math.round(s.x),y:Math.round(s.y),hitTag:el===null?" + j("") + ":el.tagName.toLowerCase(),hitName:owner===null?" + j("") + ":String(owner.getAttribute(" + j(PILLAR_ATTR) + ")||" + j("") + "),hitIsTarget:owner===target};})()";
/** 立柱锚点是否落在该国国界里（用国界路径自带的 isPointInFill 判） */
const anchorInsideExpr = (name) => "(function(){var svg=document.querySelector(" + j("svg.hub-map") + ");if(svg===null){return null;}var gs=svg.querySelectorAll(" + j(PILLAR_SEL) + ");var target=null;for(var i=0;i<gs.length;i+=1){if(String(gs[i].getAttribute(" + j(PILLAR_ATTR) + "))===" + j(name) + "){target=gs[i];break;}}if(target===null){return null;}var x=Number(target.getAttribute(" + j("data-x") + "));var y=Number(target.getAttribute(" + j("data-y") + "));var ps=svg.querySelectorAll(" + j("path.hub-map__country") + ");for(var k=0;k<ps.length;k+=1){if(String(ps[k].getAttribute(" + j("data-country") + "))===" + j(name) + "){return ps[k].isPointInFill(new DOMPoint(x,y));}}return null;})()";
/** 国家路径的填色 / 轮廓（判「有项目的国家是不是蓝底 + 有轮廓」） */
const countryPaintExpr = (name) => "(function(){var ps=document.querySelectorAll(" + j("path.hub-map__country") + ");for(var i=0;i<ps.length;i+=1){if(String(ps[i].getAttribute(" + j("data-country") + "))===" + j(name) + "){var st=getComputedStyle(ps[i]);return {name:String(ps[i].getAttribute(" + j("data-country") + ")),fill:st.fill,stroke:st.stroke,strokeWidth:st.strokeWidth,tier:String(ps[i].getAttribute(" + j("data-tier") + ")||" + j("") + ")};}}return null;})()";

/** 九追订：钉住态读数（哪些柱钉住、清单能不能滑 / 展没展开、面板接不接鼠标事件） */
const pinStateExpr = () => "(function(){var gs=document.querySelectorAll(" + j(PILLAR_SEL) + ");var pinned=[];var shown=[];for(var i=0;i<gs.length;i+=1){var n=String(gs[i].getAttribute(" + j(PILLAR_ATTR) + ")||" + j("") + ");if(gs[i].getAttribute(" + j("data-pinned") + ")===" + j("true") + "){pinned.push(n);}if(gs[i].getAttribute(" + j("data-shown") + ")===" + j("true") + "){shown.push(n);}}var panel=document.querySelector(" + j(".hub-map-projects") + ");var list=document.querySelector(" + j(".hub-map-projects__list") + ");var badge=document.querySelector(" + j(".hub-map-badge__pin") + ");var hint=document.querySelector(" + j(".hub-map-badge__hint") + ");return {pinned:pinned,shown:shown,panelActive:panel!==null&&panel.getAttribute(" + j("data-active") + ")===" + j("true") + ",panelPinned:panel!==null&&panel.getAttribute(" + j("data-pinned") + ")===" + j("true") + ",panelExpanded:panel!==null&&panel.getAttribute(" + j("data-expanded") + ")===" + j("true") + ",panelCountry:panel===null?" + j("") + ":String(panel.getAttribute(" + j("data-country") + ")||" + j("") + "),panelPointer:panel===null?" + j("") + ":getComputedStyle(panel).pointerEvents,panelText:panel===null?" + j("") + ":String(panel.innerText||" + j("") + "),rows:list===null?0:list.querySelectorAll(" + j("li") + ").length,scrollTop:list===null?0:Math.round(list.scrollTop),scrollHeight:list===null?0:Math.round(list.scrollHeight),clientHeight:list===null?0:Math.round(list.clientHeight),overflowY:list===null?" + j("") + ":getComputedStyle(list).overflowY,hasExpand:panel!==null&&panel.querySelector(" + j(".hub-map-projects__expand") + ")!==null,hasClose:panel!==null&&panel.querySelector(" + j(".hub-map-projects__close") + ")!==null,pinBadge:badge!==null,badgeText:badge===null?" + j("") + ":String(badge.innerText||" + j("") + "),badgeHint:hint===null?" + j("") + ":String(hint.innerText||" + j("") + ")};})()";

/** 某个元素中心的屏幕坐标（真实鼠标点击用） */
const elementCenterExpr = (selector) => "(function(){var el=document.querySelector(" + j(selector) + ");if(el===null){return null;}var r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),h:Math.round(r.height)};})()";

/** 图例第一组（项目数）的逐项文本与悬停说明：判「一档 / 二档 / …」这一组档位名 + 条数范围 */
const legendTierExpr = () => "(function(){var groups=document.querySelectorAll('.hub-map-legend__group');if(groups.length===0){return {items:[],titles:[]};}var items=groups[0].querySelectorAll('.hub-map-legend__item');var out=[];var titles=[];for(var i=0;i<items.length;i+=1){out.push((items[i].innerText||'').trim());titles.push(String(items[i].getAttribute('title')||''));}return {items:out,titles:titles};})()";
/** 微国符号的圆点填色（判「有项目的微国是不是蓝点」） */
const pillarColorExpr = (name) => "(function(){var gs=document.querySelectorAll(" + j("g.hub-map__pillar") + ");for(var i=0;i<gs.length;i+=1){var g=gs[i];if(String(g.getAttribute(" + j("data-pillar") + "))!==" + j(name) + "){continue;}var segs=g.querySelectorAll(" + j("rect.hub-map__pillar-seg") + ");var cuts=[];for(var k=0;k<segs.length;k+=1){cuts.push({status:String(segs[k].getAttribute(" + j("data-status") + ")),fill:getComputedStyle(segs[k]).fill});}var top=g.querySelector(" + j("ellipse.hub-map__pillar-top") + ");return {topStatus:String(g.getAttribute(" + j("data-top-status") + ")||" + j("") + "),topFill:top===null?" + j("") + ":getComputedStyle(top).fill,cuts:cuts};}return null;})()";
const microPaintExpr = (name) => "(function(){var gs=document.querySelectorAll(" + j("g.hub-map__micro") + ");for(var i=0;i<gs.length;i+=1){if(String(gs[i].getAttribute(" + j("data-country") + "))===" + j(name) + "){var dot=gs[i].querySelector(" + j("circle.hub-map__micro-dot") + ");return dot===null?null:{name:" + j(name) + ",fill:getComputedStyle(dot).fill,stroke:getComputedStyle(dot).stroke,tier:String(gs[i].getAttribute(" + j("data-tier") + ")||" + j("") + ")};}}return null;})()";

/** 国家内部的一点（屏幕坐标）：按国界路径包围盒网格采样，取第一个落在国界里、且 elementFromPoint 命中国界路径的点 */
const countryInsidePointExpr = (name, avoidX) => { const avoid = avoidX === undefined ? "" : "if(Math.abs(x-(" + String(avoidX) + "))<=9){continue;}"; return "(function(){var svg=document.querySelector(" + j("svg.hub-map") + ");if(svg===null){return null;}var ps=svg.querySelectorAll(" + j("path.hub-map__country") + ");var target=null;for(var i=0;i<ps.length;i+=1){if(String(ps[i].getAttribute(" + j("data-country") + "))===" + j(name) + "){target=ps[i];break;}}if(target===null){return null;}var box=target.getBBox();for(var row=1;row<8;row+=1){for(var col=1;col<8;col+=1){var x=box.x+(box.width*col)/8;var y=box.y+(box.height*row)/8;" + avoid + "if(target.isPointInFill(new DOMPoint(x,y))!==true){continue;}var m=target.getScreenCTM();if(m===null){continue;}var p=svg.createSVGPoint();p.x=x;p.y=y;var s=p.matrixTransform(m);var el=document.elementFromPoint(s.x,s.y);var owner=el===null?null:el.closest(" + j("path.hub-map__country") + ");if(owner===target){return {x:Math.round(s.x),y:Math.round(s.y),hitIsTarget:true};}}}return null;})()"; };

const vw = 1500;
const vh = 1000;
await openHub(vw, vh);
const pills = await ev(pillsExpr());
const panel = await ev(panelExpr());
const map = await ev(mapExpr());
const badgeRest = await ev(badgeExpr());
const restPanelShadow = String(await ev("getComputedStyle(document.querySelector(" + j("section.hub-map-panel") + ")).boxShadow"));
const pageInfo = await ev("(function(){return {scroll:document.documentElement.scrollHeight,inner:window.innerHeight};})()");
const baseShot = await shot("hub-base");

check("入口页渲染出三个入口胶囊（项目空间 / 任务模板 / 文件库）", Array.isArray(pills) && pills.length === 3 && pills.map((item) => item.text).join("|") === "项目空间|任务模板|文件库", JSON.stringify(pills));
check("三个胶囊的落点分别是 项目空间 / 任务模板 / 文件库", Array.isArray(pills) && pills.length === 3 && pills[0].href.indexOf("#/projects") === 0 && pills[1].href === "#/templates" && pills[2].href === "#/files", Array.isArray(pills) ? pills.map((item) => item.href).join(" | ") : "null");
const stacked = Array.isArray(pills) && pills.length === 3 ? (Math.abs((pills[0].x + pills[0].w / 2) - (pills[1].x + pills[1].w / 2)) <= 2 && Math.abs((pills[1].x + pills[1].w / 2) - (pills[2].x + pills[2].w / 2)) <= 2 && pills[0].y < pills[1].y && pills[1].y < pills[2].y && pills[1].y - pills[0].y > 8) : false;
check("三个胶囊是竖排（x 中心对齐、y 依次递增）", stacked, Array.isArray(pills) ? JSON.stringify(pills.map((item) => [item.x, item.y])) : "null");
check("胶囊整体落在最左侧（右缘 < 视口宽 40%）", Array.isArray(pills) && pills.length === 3 && pills[0].x + pills[0].w < vw * 0.4, Array.isArray(pills) ? "右缘 " + String(pills[0].x + pills[0].w) + " / " + String(Math.round(vw * 0.4)) : "null");
check("右侧是地图面板（面板在胶囊右边、有宽度）", panel !== null && Array.isArray(pills) && panel.x > pills[0].x + pills[0].w && panel.w > vw * 0.4, JSON.stringify(panel));
check("面板里的地图 viewBox 与生成物一致（" + EXPECTED_VIEWBOX + "）", panel !== null && panel.viewBox === EXPECTED_VIEWBOX, panel === null ? "null" : String(panel.viewBox));
check("地图是 img 语义（role=img + aria-label）", panel !== null && panel.role === "img" && panel.label.length > 0, panel === null ? "null" : String(panel.role) + " / " + String(panel.label));
check("底图 = " + String(EXPECTED_COUNTRIES) + " 个国家路径（逐国可交互）", map !== null && map.countries === EXPECTED_COUNTRIES, JSON.stringify(map));
check("每个国家都带国名、且不重名（逐国可辨认）", map !== null && map.empty === 0 && map.dup === 0, JSON.stringify(map));
check("中国口径护栏：图上没有「台湾 / 科索沃 / 北塞浦路斯 / 索马里兰」这些独立实体", map !== null && map.forbidden === 0, JSON.stringify(map) + " / 护栏 = " + FORBIDDEN_ENTITIES.join("、"));
check("中文国名映射到位（中国 / 美国 / 巴西）", map !== null && map.hasChina === true && map.hasUnitedStates === true && map.hasBrazil === true, JSON.stringify(map));
check("南海断续线（十段，中国标准地图口径）在图上", map !== null && map.dash === EXPECTED_DASHLINE, JSON.stringify(map));
check("中文名按大陆口径：没有台译 / 繁体 / 旧译名（多明尼加 · 北馬其頓 · 法国南部和南极土地 · 福克兰群岛）", map !== null && map.staleName === 0, JSON.stringify(map) + " / 护栏 = " + FORBIDDEN_NAMES.join("、"));
check("底图上没有点位 / 文字 / 图片（参考图的蓝点不需要；立柱顶上的项目数不算底图文字）", map !== null && map.circles === 0 && map.texts === 0 && map.images === 0 && map.markers === 0, JSON.stringify(map));
const micro = await ev(microExpr());
check("微国符号层：110m 国界精度画不出的主权国家补了符号（" + String(EXPECTED_MICRO_STATES) + " 国）", micro !== null && micro.micro === EXPECTED_MICRO_STATES && micro.dots === EXPECTED_MICRO_STATES, JSON.stringify(micro === null ? null : { micro: micro.micro, dots: micro.dots, names: micro.names }));
check("微国符号抽查：新加坡 / 巴林 / 马耳他 / 摩纳哥 / 梵蒂冈 都在（都带国名，能报出来）", micro !== null && MICRO_SPOT_CHECKS.every((name) => micro.names.indexOf(name) >= 0), micro === null ? "null" : micro.names.join("、"));
check("微国符号不重名、也不跟国家路径重名（不会出现两个新加坡）", micro !== null && micro.empty === 0 && micro.dup === 0 && micro.overlap === 0, JSON.stringify(micro === null ? null : { empty: micro.empty, dup: micro.dup, overlap: micro.overlap }));
check("微国符号都落在视口里（不会跑到图外）", micro !== null && micro.outOfView === 0, micro === null ? "null" : String(micro.outOfView));
check("中国口径护栏：微国符号里也没有「台湾 / 科索沃 / 北塞浦路斯 / 索马里兰」", micro !== null && micro.forbidden === 0, micro === null ? "null" : String(micro.forbidden));
const singaporePoint = await ev(microPointExpr("新加坡"));
check("新加坡符号能被真实鼠标命中（不是被马来西亚那块盖住）", singaporePoint !== null && singaporePoint.hitIsTarget === true && singaporePoint.hitName === "新加坡", JSON.stringify(singaporePoint));
const singaporeRestFill = tierFillOf("新加坡") ?? TIER_FILL[1];
check("有项目的微国（新加坡）：圆点按档上蓝（" + singaporeRestFill + "；没项目的微国仍是灰点）", singaporePoint !== null && singaporePoint.dotFill === singaporeRestFill, singaporePoint === null ? "null" : String(singaporePoint.dotFill));
if (singaporePoint !== null) {
  await moveMouse(singaporePoint.x, singaporePoint.y);
}
const singaporeStyle = singaporePoint === null ? null : await ev(microStyleExpr());
const singaporeBadge = await ev(badgeExpr());
const singaporeClip = singaporePoint === null ? null : { x: Math.max(0, Math.round(singaporePoint.x - 150)), y: Math.max(0, Math.round(singaporePoint.y - 80)), width: 300, height: 160, scale: 4 };
const singaporeShot = singaporeClip === null ? "" : await shot("hub-micro-singapore", singaporeClip);
check("鼠标触碰新加坡：只有它命中 :hover、圆点压深为 " + PROJECT_BLUE_DEEP, singaporeStyle !== null && singaporeStyle.hoveredMicro === 1 && singaporeStyle.hoveredMicroName === "新加坡" && singaporeStyle.dotFill === PROJECT_BLUE_DEEP, JSON.stringify(singaporeStyle));
check("鼠标触碰新加坡：左上角徽标报「新加坡 Singapore」", singaporeBadge !== null && singaporeBadge.active === "true" && singaporeBadge.zh === "新加坡" && singaporeBadge.en === "Singapore", JSON.stringify(singaporeBadge));
const nanhai = await ev(nanhaiExpr());
check("南海诸岛符号层：只点群岛、一个群岛一个点（" + String(EXPECTED_NANHAI_ISLANDS) + " 点：东沙 / 西沙 / 中沙 / 南沙 / 南沙南部·曾母暗沙一带）", nanhai !== null && nanhai.groups === EXPECTED_NANHAI_ISLANDS && nanhai.dots === EXPECTED_NANHAI_ISLANDS && nanhai.hits === EXPECTED_NANHAI_ISLANDS, JSON.stringify(nanhai === null ? null : { groups: nanhai.groups, dots: nanhai.dots, hits: nanhai.hits }));
check("南海诸岛符号都在南海这一片、且都在视口里", nanhai !== null && nanhai.outOfView === 0 && nanhai.box[0] > 780 && nanhai.box[2] < 860 && nanhai.box[1] > 165 && nanhai.box[3] < 240, nanhai === null ? "null" : JSON.stringify(nanhai.box));
check("南海诸岛符号静止态：填充为 " + NANHAI_REST_FILL + "（灰点，不是参考图那种蓝点）", nanhai !== null && nanhai.fill === NANHAI_REST_FILL, nanhai === null ? "null" : String(nanhai.fill));
check("南海诸岛符号报的是「中国」（不另造实体词条）", nanhai !== null && nanhai.name === "中国", nanhai === null ? "null" : String(nanhai.name));
const nanhaiPoint = await ev(nanhaiPointExpr());
check("南海诸岛最南那一点（曾母暗沙一带）能被真实鼠标命中", nanhaiPoint !== null && nanhaiPoint.hitIsTarget === true, JSON.stringify(nanhaiPoint));
if (nanhaiPoint !== null) {
  await moveMouse(nanhaiPoint.x, nanhaiPoint.y);
}
const nanhaiStyle = nanhaiPoint === null ? null : await ev(nanhaiStyleExpr());
const nanhaiBadge = await ev(badgeExpr());
const nanhaiClip = nanhaiPoint === null ? null : { x: Math.max(0, Math.round(nanhaiPoint.x - 90)), y: Math.max(0, Math.round(nanhaiPoint.y - 90)), width: 240, height: 200, scale: 4 };
const nanhaiShot = nanhaiClip === null ? "" : await shot("hub-nanhai", nanhaiClip);
check("鼠标触碰南海诸岛：只有它命中 :hover、点变深为 " + NANHAI_HOVER_FILL, nanhaiStyle !== null && nanhaiStyle.hoveredNanhai === 1 && nanhaiStyle.dotFill === NANHAI_HOVER_FILL, JSON.stringify(nanhaiStyle));
check("鼠标触碰南海诸岛：左上角徽标报「中国 China」（与台湾同口径）", nanhaiBadge !== null && nanhaiBadge.active === "true" && nanhaiBadge.zh === "中国" && nanhaiBadge.en === "China", JSON.stringify(nanhaiBadge));
const chinaGeo = await ev(chinaGeoExpr());
check("中国国界按中国标准地图口径：台北 / 藏南 / 阿克赛钦 / 钓鱼岛 都落在中国这一条路径里（钓鱼岛小到看不见，但数据在）", chinaGeo !== null && chinaGeo.covered.join("|") === "true|true|true|true", JSON.stringify(chinaGeo));
check("反向对照：新德里确认不在中国路径里（没有把邻国吃进来）", chinaGeo !== null && chinaGeo.outside.join("|") === "true", JSON.stringify(chinaGeo));
const chinaBox = await ev(chinaBoxExpr());
const chinaShot = chinaBox === null ? "" : await shot("hub-china-sea", chinaBox);
// 台湾 + 海峡这一小片单独出一张：肉眼要能看出「台湾和大陆同色、同属中国这一条路径」
const taiwanBox = await ev(chinaBoxExpr("116,28,126,19"));
const taiwanShot = taiwanBox === null ? "" : await shot("hub-taiwan", taiwanBox);
check("静止态：国名徽标不显示", badgeRest !== null && badgeRest.active === "false" && badgeRest.opacity === 0, JSON.stringify(badgeRest));
check("整页不出现纵向滚动条（内容不超一屏）", Number(pageInfo.scroll) <= Number(pageInfo.inner) + 1, "scrollHeight=" + String(pageInfo.scroll) + " innerHeight=" + String(pageInfo.inner));


let targetName = "";
let countryPoint = null;
for (const candidate of HOVER_TARGETS) {
  const found = await ev(findCountryPointExpr(candidate));
  if (found !== null) {
    targetName = candidate;
    countryPoint = found;
    break;
  }
}
console.log("  触碰目标国家：" + targetName + " " + JSON.stringify(countryPoint));
const clipBox = countryPoint === null ? null : {
  x: Math.max(0, Math.round(countryPoint.bx + countryPoint.w / 2 - Math.min(vw, Math.max(240, countryPoint.w + 60)) / 2)),
  y: Math.max(0, Math.round(countryPoint.by + countryPoint.h / 2 - Math.min(vh, Math.max(160, countryPoint.h + 60)) / 2)),
  width: Math.min(vw, Math.max(240, countryPoint.w + 60)),
  height: Math.min(vh, Math.max(160, countryPoint.h + 60)),
  scale: 2
};
const countryRestShot = clipBox === null ? "" : await shot("hub-country-rest", clipBox);
const restStyle = countryPoint === null ? null : await ev(styleExpr(countryPoint.x, countryPoint.y));
check("静止态：国家填充为浅灰 " + COUNTRY_REST_FILL + "、带 fill 过渡", restStyle !== null && restStyle.restFill === COUNTRY_REST_FILL && restStyle.transition.indexOf("fill") >= 0, JSON.stringify(restStyle));
if (countryPoint !== null) {
  await moveMouse(countryPoint.x, countryPoint.y);
}
const hoverStyle = countryPoint === null ? null : await ev(styleExpr(countryPoint.x, countryPoint.y));
const badgeHover = await ev(badgeExpr());
/** 合成鼠标的 :hover 不会被无头截图渲染 —— 用 CDP 强制伪类再截一张，作为视觉证据（真实浏览器里就是这张的样子）。 */
let forcedShot = "";
if (clipBox !== null) {
  await page.send("DOM.getDocument", { depth: 0 });
  const hit = await page.send("DOM.getNodeForLocation", { x: countryPoint.x, y: countryPoint.y, includeUserAgentShadowDOM: false });
  const resolved = await page.send("DOM.pushNodesByBackendIdsToFrontend", { backendNodeIds: [hit.backendNodeId] });
  await page.send("CSS.forcePseudoState", { nodeId: resolved.nodeIds[0], forcedPseudoClasses: ["hover"] });
  await sleep(400);
  forcedShot = await shot("hub-country-forced-hover", clipBox);
  await page.send("CSS.forcePseudoState", { nodeId: resolved.nodeIds[0], forcedPseudoClasses: [] });
  await sleep(300);
}
const hoverShot = clipBox === null ? "" : await shot("hub-country-hover", clipBox);
const hoveredShot = await shot("hub-hover-country");
check("鼠标触碰某国：只有该国命中 :hover（恰好 1 国）", hoverStyle !== null && hoverStyle.hovered === 1, hoverStyle === null ? "null" : String(hoverStyle.hovered));
check("鼠标触碰某国：命中的就是该国（" + targetName + "）", hoverStyle !== null && hoverStyle.hoveredName === targetName, hoverStyle === null ? "null" : String(hoverStyle.hoveredName));
check("鼠标触碰某国：该国填充变深为 " + COUNTRY_HOVER_FILL, hoverStyle !== null && hoverStyle.hitFill === COUNTRY_HOVER_FILL, hoverStyle === null ? "null" : String(hoverStyle.hitFill));
check("鼠标触碰某国：左上角徽标报出国名（" + targetName + "）", badgeHover !== null && badgeHover.active === "true" && badgeHover.zh === targetName && badgeHover.en.length > 0 && badgeHover.opacity === 1, JSON.stringify(badgeHover));

/** 换到另一个国家：验证是「逐国」而不是「一整块大陆」 */
let secondName = "";
let secondPoint = null;
for (const candidate of HOVER_TARGETS) {
  if (candidate === targetName) {
    continue;
  }
  const found = await ev(findCountryPointExpr(candidate));
  if (found !== null) {
    secondName = candidate;
    secondPoint = found;
    break;
  }
}
if (secondPoint !== null) {
  await moveMouse(secondPoint.x, secondPoint.y);
}
const secondStyle = secondPoint === null ? null : await ev(styleExpr(secondPoint.x, secondPoint.y));
const secondBadge = secondPoint === null ? null : await ev(badgeExpr());
check("换到另一国（" + secondName + "）：命中随之切换、徽标同步", secondStyle !== null && secondStyle.hovered === 1 && secondStyle.hoveredName === secondName && secondBadge !== null && secondBadge.zh === secondName, JSON.stringify(secondStyle) + " / " + JSON.stringify(secondBadge));

/** 台北：这个点必须命中中国（图上没有「台湾」这个国家） */
const taipeiPoint = await ev(findGeoPointExpr(121.0, 23.7, "中国"));
check("页面上的台北这一点命中中国这条路径", taipeiPoint !== null && taipeiPoint.hit === true && taipeiPoint.hitCountry === "中国", JSON.stringify(taipeiPoint));
if (taipeiPoint !== null) {
  await moveMouse(taipeiPoint.x, taipeiPoint.y);
}
const taipeiStyle = taipeiPoint === null ? null : await ev(styleExpr(taipeiPoint.x, taipeiPoint.y));
const taipeiBadge = taipeiPoint === null ? null : await ev(badgeExpr());
check("鼠标停在台北：只有中国命中 :hover、徽标报「中国」", taipeiStyle !== null && taipeiStyle.hovered === 1 && taipeiStyle.hoveredName === "中国" && taipeiBadge !== null && taipeiBadge.zh === "中国", JSON.stringify(taipeiStyle) + " / " + JSON.stringify(taipeiBadge));

const oceanPoint = await ev(findOceanPointExpr());
if (oceanPoint !== null) {
  await moveMouse(oceanPoint.x, oceanPoint.y);
}
const oceanStyle = oceanPoint === null ? null : await ev(styleExpr(oceanPoint.x, oceanPoint.y));
const oceanBadge = await ev(badgeExpr());
check("鼠标触碰面板空白处：国家 hover 归零", oceanStyle !== null && oceanStyle.hovered === 0, oceanStyle === null ? "null" : String(oceanStyle.hovered));
check("鼠标触碰面板空白处：徽标收起", oceanBadge !== null && oceanBadge.active === "false" && oceanBadge.opacity === 0, JSON.stringify(oceanBadge));
check("鼠标触碰面板空白处：面板投影加深", oceanStyle !== null && oceanStyle.panelShadow !== restPanelShadow, oceanStyle === null ? "null" : String(restPanelShadow) + " -> " + String(oceanStyle.panelShadow));
check("整图不跟着缩放（触碰的那国不会被顶跑）：svg transform 恒为 none", oceanStyle !== null && oceanStyle.mapTransform === "none", oceanStyle === null ? "null" : String(oceanStyle.mapTransform));
const panelShot = await shot("hub-hover-panel");

await moveMouse(6, vh - 8);
const awayStyle = await ev(styleExpr(6, vh - 8));
check("鼠标移开：国家 hover 归零、面板投影还原", awayStyle !== null && awayStyle.hovered === 0 && awayStyle.panelShadow === restPanelShadow, JSON.stringify(awayStyle));

/** —— 项目立柱层（Push 188 追订：地图与项目地区联动 + 立柱展示项目梳理）—— */
const STATUS_TEXT = { active: "进行中", paused: "已暂停", done: "已完成", archived: "已归档" };
const projectRows = (await db.query("select region, status, count(*)::int as n from projects where deleted_at is null group by region, status")).rows;
const dbRegionTotal = new Map();
for (const row of projectRows) {
  dbRegionTotal.set(row.region, (dbRegionTotal.get(row.region) ?? 0) + row.n);
}
/** 图上国家名 → { 状态: 条数 }（立柱分段对账用） */
const regionStatus = new Map();
for (const row of projectRows) {
  const label = regionLabel(row.region);
  const cur = regionStatus.get(label) ?? {};
  cur[row.status] = row.n;
  regionStatus.set(label, cur);
}
const dbStatusSet = new Set(projectRows.map((row) => row.status));
const dbProjects = projectRows.reduce((sum, row) => sum + row.n, 0);
await sleep(420);
const pillarsInfo = await ev(pillarsExpr());
const pillarList = pillarsInfo === null ? [] : pillarsInfo.pillars;
const restShownList = pillarList.filter((item) => item.shown === "true");
const restBadList = pillarList.filter((item) => item.bodyOpacity !== 0 || item.hitPointer !== "none");
check("静止态：一根立柱都不露面（全部 data-shown=false、柱身 opacity 0、命中区不吃事件）", pillarList.length > 0 && restShownList.length === 0 && restBadList.length === 0, "露面 " + String(restShownList.length) + " 根 / 异常 " + restBadList.slice(0, 3).map((item) => item.name + JSON.stringify([item.bodyOpacity, item.hitPointer])).join(" ;; "));
const pillarByName = new Map(pillarList.map((item) => [item.name, item]));
const countMismatch = [];
const pillarNameFor = (region) => {
  const label = regionLabel(region);
  if (pillarByName.has(label)) {
    return label;
  }
  const loose = pillarList.filter((item) => item.name.indexOf(label) >= 0 || label.indexOf(item.name) >= 0);
  return loose.length === 1 ? loose[0].name : null;
};
let placedProjects = 0;
for (const [region, total] of dbRegionTotal) {
  const name = pillarNameFor(region);
  if (name === null) {
    continue;
  }
  const hit = pillarByName.get(name);
  if (hit === undefined) {
    continue;
  }
  placedProjects += hit.count;
  if (hit.count !== total) {
    countMismatch.push(region + " 库内 " + String(total) + " / 图上 " + String(hit.count));
  }
}
const missingPillars = [...dbRegionTotal.keys()].filter((region) => pillarNameFor(region) === null);
check("立柱层：有项目的国家一根柱（库内 " + String(dbRegionTotal.size) + " 个地区 / 图上 " + String(pillarList.length) + " 根）", pillarList.length === dbRegionTotal.size && missingPillars.length === 0, "对不上：" + missingPillars.join(","));
check("立柱层：每根柱的项目数与库内逐条一致", countMismatch.length === 0, countMismatch.join(" ;; "));
check("立柱层：立柱项目数合计 = 库内未删项目总数（" + String(dbProjects) + "）", placedProjects === dbProjects, "图上合计 " + String(placedProjects));
const labelBad = pillarList.filter((item) => item.label !== String(item.count)).map((item) => item.name + " 标签 " + item.label + " / 项目数 " + String(item.count));
check("立柱层：每根柱顶上的计数标签 = 该项目数（图上直接读得出条数）", pillarList.length > 0 && labelBad.length === 0, labelBad.join(" ;; "));

const tierBad = [];
const tierSeen = new Set();
for (const item of pillarList) {
  const total = dbTotalByName.get(item.name);
  if (total === undefined) {
    tierBad.push(item.name + " -> 库里没有对应的地区条目");
    continue;
  }
  const want = tierSlotOf(total);
  tierSeen.add(tierIndex(total));
  if (item.kind === "micro") {
    const microPaint = await ev(microPaintExpr(item.name));
    if (microPaint === null || microPaint.fill !== TIER_FILL[want] || microPaint.tier !== String(want) || microPaint.stroke !== PROJECT_BLUE_DEEP) {
      tierBad.push(item.name + "（库内 " + String(total) + " 个）-> " + JSON.stringify(microPaint));
    }
    continue;
  }
  const paint = await ev(countryPaintExpr(item.name));
  if (paint === null || paint.fill !== TIER_FILL[want] || paint.stroke !== PROJECT_BLUE_DEEP || paint.strokeWidth === "0px" || paint.tier !== String(want)) {
    tierBad.push(item.name + "（库内 " + String(total) + " 个）-> " + JSON.stringify(paint));
  }
}
check("有项目的国家 / 微国：国土按项目数上蓝底（档位随数据算 —— 库里最多 " + String(Math.max(...dbTotalByName.values())) + " 个 → 分 " + String(tierBounds.length) + " 档：" + tierBounds.map((bound, index) => tierTextOf(index)).join(" / ") + "；色阶槽位 " + TIER_FILL[1] + " → " + TIER_FILL[5] + "）+ 深蓝轮廓（" + PROJECT_BLUE_DEEP + "）", pillarList.length > 0 && tierBad.length === 0, tierBad.join(" ;; "));
check("档位都落到了图上（库里 " + tierBounds.map((bound, index) => tierTextOf(index)).join(" / ") + " 都有）", tierSeen.size === tierBounds.length, "出现过的档位：" + [...tierSeen].join("、"));

const grayBad = [];
for (const name of HOVER_TARGETS.slice(0, 2)) {
  const paint = await ev(countryPaintExpr(name));
  if (paint === null || paint.fill !== COUNTRY_REST_FILL || paint.stroke !== "rgba(0, 0, 0, 0)" || paint.tier !== "0") {
    grayBad.push(name + " -> " + JSON.stringify(paint));
  }
}
check("没有项目的国家：仍是浅灰底、无色轮廓、data-tier=0（不跟着变蓝）", grayBad.length === 0, grayBad.join(" ;; "));

const microBlue = await ev(microPaintExpr("新加坡"));
const microGray = await ev(microPaintExpr("安道尔"));
const singaporeTier = tierSlotOf(dbTotalByName.get("新加坡") ?? 1);
check("微国同理：有项目的新加坡按档上蓝、没项目的安道尔是灰点", microBlue !== null && microBlue.fill === TIER_FILL[singaporeTier] && microGray !== null && microGray.fill === MICRO_REST_FILL, JSON.stringify(microBlue) + " / " + JSON.stringify(microGray));
check("微国分档：data-tier 与库内项目数同档（新加坡 " + String(dbTotalByName.get("新加坡") ?? 0) + " 个 -> 色阶槽位 " + String(singaporeTier) + "、安道尔 0 个 -> 第 0 档）", microBlue !== null && microBlue.tier === String(singaporeTier) && microGray !== null && microGray.tier === "0", JSON.stringify(microBlue) + " / " + JSON.stringify(microGray));

const anchorOutside = [];
for (const item of pillarList) {
  if (item.kind !== "country") {
    continue;
  }
  const inside = await ev(anchorInsideExpr(item.name));
  if (inside !== true) {
    anchorOutside.push(item.name + " -> " + String(inside));
  }
}
check("立柱落点：国家立柱的锚点都落在该国国界里（不站海里）", pillarList.length > 0 && anchorOutside.length === 0, anchorOutside.join(" ;; "));

const maxCount = pillarList.length === 0 ? 0 : Math.max(...pillarList.map((item) => item.count));
const minCount = pillarList.length === 0 ? 0 : Math.min(...pillarList.map((item) => item.count));
const tallHeights = pillarList.filter((item) => item.count === maxCount).map((item) => item.height);
const shortHeights = pillarList.filter((item) => item.count === minCount).map((item) => item.height);
check("立柱高度：项目数多的柱不矮于项目数少的（高度随项目数走）", pillarList.length > 0 && Math.min(...tallHeights) >= Math.max(...shortHeights), "多：" + tallHeights.join(",") + " / 少：" + shortHeights.join(","));

const legendMissing = [...dbStatusSet].map((status) => STATUS_TEXT[status]).filter((text) => text !== undefined && String(pillarsInfo.legendText).indexOf(text) < 0);
check("图例与脚注：报出「共 N 个项目 · 覆盖 M 个国家/地区」与状态文案", pillarsInfo !== null && String(pillarsInfo.legendText).indexOf("共 " + String(dbProjects) + " 个项目") >= 0 && String(pillarsInfo.legendText).indexOf("覆盖 " + String(pillarList.length) + " 个国家/地区") >= 0 && legendMissing.length === 0, JSON.stringify(pillarsInfo === null ? null : pillarsInfo.legendText));
const legendTierMissing = [...tierBounds.map((bound, index) => tierNameOf(index)), "项目数", "立柱分段"].filter((item) => String(pillarsInfo.legendText).indexOf(item) < 0);
check("图例：档位名逐档都在（" + tierBounds.map((bound, index) => tierNameOf(index)).join(" / ") + " +「项目数」「立柱分段」两个字头）", pillarsInfo !== null && legendTierMissing.length === 0, "缺：" + legendTierMissing.join("、"));
const legendHint = "按当前数据自动分档 · 共 " + String(tierBounds.length) + " 档";
check("图例：分档提示跟着数据算（当前 " + String(tierBounds.length) + " 档）", pillarsInfo !== null && String(pillarsInfo.legendText).indexOf(legendHint) >= 0, "图例文本：" + String(pillarsInfo === null ? "" : pillarsInfo.legendText));
const legendTierInfo = await ev(legendTierExpr());
const legendTierWanted = tierBounds.map((bound, index) => tierNameOf(index));
const legendTierGot = legendTierInfo === null || !Array.isArray(legendTierInfo.items) ? [] : legendTierInfo.items;
check("图例：档位名是一档 / 二档 / …（读 DOM 逐项对，条数文案不再写进图例）", legendTierGot.length === legendTierWanted.length && legendTierWanted.every((name, index) => legendTierGot[index] === name), "实到：" + legendTierGot.join(" / "));
const legendTierTitleBad = tierBounds.map((bound, index) => index).filter((index) => String((legendTierInfo === null || !Array.isArray(legendTierInfo.titles) ? [] : legendTierInfo.titles)[index]).indexOf(tierNameOf(index) + "：" + tierTextOf(index)) < 0);
check("图例：每档的条数范围挪到悬停说明里（title = 「一档：1 个项目」这种）", legendTierTitleBad.length === 0, "缺：" + legendTierTitleBad.join("、"));

const panelClip = panel === null ? null : { x: panel.x, y: panel.y, width: panel.w, height: panel.h, scale: 1 };
const pillarShot = panelClip === null ? "" : await shot("hub-pillars", panelClip);
const focusPillar = pillarByName.get("英国") ?? pillarList[0];
const focusCount = focusPillar === undefined ? 0 : focusPillar.count;
const focusRestFill = focusPillar === undefined ? "" : (tierFillOf(focusPillar.name) ?? "");
let focusPoint = null;
let pillarHover = null;
let pillarHoverShot = "";
let grownInfo = null;
let grownShot = "";
let focusNames = [];
if (focusPillar !== undefined) {
  focusNames = (await db.query("select name from projects where deleted_at is null and region = $1 order by name", [focusPillar.name])).rows.map((row) => row.name);
  /* 方案 E 的触碰顺序：先落在该国国境内（避开立柱命中带）—— 柱才长出来，回读一次，再移到柱上 */
  const grownPoint = await ev(countryInsidePointExpr(focusPillar.name, focusPillar.x));
  if (grownPoint !== null) {
    await moveMouse(grownPoint.x, grownPoint.y);
    await sleep(780);
    grownInfo = await ev(pillarsExpr());
    grownShot = panelClip === null ? "" : await shot("hub-pillar-grow", panelClip);
    const grownPaint = await ev(countryPaintExpr(focusPillar.name));
    const grownNames = grownInfo === null ? [] : grownInfo.pillars.filter((item) => item.shown === "true").map((item) => item.name);
    const grownSelf = grownInfo === null ? null : grownInfo.pillars.find((item) => item.name === focusPillar.name) ?? null;
    check("触碰有项目的国家（" + focusPillar.name + "）：该国的柱才长出来（只有这一根露面、柱身与柱顶计数都展开了）", grownNames.length === 1 && grownNames[0] === focusPillar.name && grownSelf !== null && grownSelf.bodyOpacity === 1 && grownSelf.hitPointer === "all" && grownSelf.countOpacity === 1, grownInfo === null ? "null" : JSON.stringify([grownNames, grownSelf === null ? null : [grownSelf.bodyOpacity, grownSelf.hitPointer, grownSelf.countOpacity]]));
    check("触碰有项目的国家（" + focusPillar.name + "）：该国压深一档（" + PROJECT_BLUE_DEEP + "）+ 白轮廓", grownPaint !== null && grownPaint.fill === PROJECT_BLUE_DEEP && grownPaint.stroke === "rgb(255, 255, 255)", JSON.stringify(grownPaint));
    check("鼠标触碰有项目的国家（" + focusPillar.name + "）：徽标加报项目数、该柱同步高亮（联动）", grownInfo !== null && grownInfo.badgeCount === String(focusCount) + " 个项目" && grownInfo.linkedPillar === focusPillar.name && grownInfo.linkedCountry === focusPillar.name, grownInfo === null ? "null" : JSON.stringify([grownInfo.badgeCount, grownInfo.linkedPillar, grownInfo.linkedCountry]));
    /* 立柱分段四色（Push 188 七追订）：柱身每段的填充 = 四色表、段数与库内状态分布一致；柱顶椭圆跟最上段同色 */
    const focusColor = focusPillar === undefined ? null : await ev(pillarColorExpr(focusPillar.name));
    const wantStatusCounts = focusPillar === undefined ? {} : (regionStatus.get(focusPillar.name) ?? {});
    const wantCuts = Object.keys(wantStatusCounts).filter((key) => wantStatusCounts[key] > 0).sort();
    const gotCuts = focusColor === null ? [] : focusColor.cuts.map((item) => item.status).sort();
    const cutFillBad = focusColor === null ? ["null"] : focusColor.cuts.filter((item) => item.fill !== PILLAR_STATUS_FILL[item.status]).map((item) => item.status + "=" + item.fill);
    check("立柱分段：柱身按项目状态分段、每段填充 = 四色表（进行中 " + PILLAR_STATUS_FILL.active + " / 已暂停 " + PILLAR_STATUS_FILL.paused + " / 已完成 " + PILLAR_STATUS_FILL.done + " / 已归档 " + PILLAR_STATUS_FILL.archived + "）", focusColor !== null && cutFillBad.length === 0 && gotCuts.join("|") === wantCuts.join("|"), focusColor === null ? "null" : JSON.stringify([focusColor.cuts, wantCuts]));
    const topWant = focusColor === null ? "" : (PILLAR_STATUS_FILL[focusColor.topStatus] ?? "");
    check("立柱分段：柱顶椭圆跟最上面那一段的状态上色（data-top-status=" + (focusColor === null ? "" : focusColor.topStatus) + " -> " + topWant + "）", focusColor !== null && focusColor.topStatus !== "" && focusColor.topFill === topWant, focusColor === null ? "null" : JSON.stringify([focusColor.topStatus, focusColor.topFill]));
    focusPoint = await ev(pillarPointExpr(focusPillar.name));
    if (focusPoint !== null) {
      await moveMouse(focusPoint.x, focusPoint.y);
      await sleep(260);
      pillarHover = await ev(pillarsExpr());
      pillarHoverShot = panelClip === null ? "" : await shot("hub-pillar-hover", panelClip);
    }
  }
}
check("鼠标触碰立柱（" + String(focusPillar === undefined ? "—" : focusPillar.name) + "）：命中的就是这根柱", focusPoint !== null && focusPoint.hitIsTarget === true, JSON.stringify(focusPoint));
check("鼠标触碰立柱：徽标加报「N 个项目」", pillarHover !== null && pillarHover.badgeCount === String(focusCount) + " 个项目", pillarHover === null ? "null" : JSON.stringify(pillarHover.badgeCount));
const shownNames = (pillarHover === null ? [] : pillarHover.panelRows.map((row) => row.name)).sort();
const expectNames = focusNames.slice(0, Math.min(6, focusNames.length)).sort();
check("鼠标触碰立柱：右上角出「项目梳理」清单（项目名与库内一致）", pillarHover !== null && pillarHover.panelActive === true && pillarHover.panelCountry === focusPillar.name && shownNames.join("|") === expectNames.join("|"), pillarHover === null ? "null" : JSON.stringify(pillarHover.panelRows));
const pillarHoverPaint = focusPillar === undefined ? null : await ev(countryPaintExpr(focusPillar.name));
check("触碰立柱：该国同步压深一档（" + PROJECT_BLUE_DEEP + "）+ 白轮廓", pillarHoverPaint !== null && pillarHoverPaint.fill === PROJECT_BLUE_DEEP && pillarHoverPaint.stroke === "rgb(255, 255, 255)", JSON.stringify(pillarHoverPaint));
check("鼠标触碰立柱：立柱本身与对应的国家路径同步高亮（联动）", pillarHover !== null && pillarHover.linkedPillar === focusPillar.name && pillarHover.linkedCountry === focusPillar.name, pillarHover === null ? "null" : JSON.stringify([pillarHover.linkedPillar, pillarHover.linkedCountry]));

/* 触碰国家那一套（压深 / 徽标 / 联动态）已经在上面「长柱」那一步一起验过了 —— 方案 E 里这两件事本来就是同一次触碰 */


/* 九追订（业务改口「不要改成4s了 改成点击国家区域即可」）：点一下有项目的国家 → 立柱停留（鼠标走开也不收回）、
   右上角「项目梳理」接通鼠标（列表可滑动 / 点「展开全部」看全量）；再点一次同一国、按 Esc、点「×」解除，
   点别国就把钉子挪过去（只碰不点不会钉）。 */
await pressEscape();
if (oceanPoint !== null) {
  await moveMouse(oceanPoint.x, oceanPoint.y);
}
const pinClear = await ev(pinStateExpr());
check("九追订：没点国家时右上角清单不吃鼠标事件（pointer-events: none）、一根钉子都没有", pinClear !== null && pinClear.pinned.length === 0 && pinClear.panelPinned === false && pinClear.panelExpanded === false && pinClear.panelPointer === "none", pinClear === null ? "null" : JSON.stringify([pinClear.pinned, pinClear.shown, pinClear.panelPinned, pinClear.panelExpanded, pinClear.panelPointer]));
const pinPillar = pillarList.filter((item) => item.kind === "country").reduce((best, item) => (best === null || item.count > best.count ? item : best), null);
const pinName = pinPillar === null ? "" : pinPillar.name;
const pinTotalDb = dbTotalByName.get(pinName) ?? 0;
const pinPoint = pinPillar === null ? null : await ev(countryInsidePointExpr(pinName, pinPillar.x));
let pinHover = null;
let pinState = null;
let pinAway = null;
let pinAwayInfo = null;
let pinScrollTop = 0;
let pinExpanded = null;
let pinSecondName = "";
let pinSecondCount = 0;
let pinMoved = null;
let pinToggled = null;
let pinRepinned = null;
let pinAfterEscape = null;
let pinBeforeBlank = null;
let pinAfterBlank = null;
let pinClickShot = "";
let pinAwayShot = "";
let pinScrollShot = "";
let pinExpandShot = "";
if (pinPoint !== null) {
  /* ① 只碰不点：柱长出来，钉子不落、清单也不给碰 */
  await moveMouse(pinPoint.x, pinPoint.y);
  await sleep(600);
  pinHover = await ev(pinStateExpr());
  /* ② 点一下国家区域 → 钉住（立柱停留 + 清单接通鼠标） */
  await clickAt(pinPoint);
  pinState = await ev(pinStateExpr());
  pinClickShot = panelClip === null ? "" : await shot("hub-pin-click", panelClip);
  /* ③ 鼠标走开（移到清单上）：钉子不松，柱 / 徽标 / 高亮都留在钉住的那国 */
  const pinAwayPoint = await ev(elementCenterExpr(".hub-map-projects__head"));
  if (pinAwayPoint !== null) {
    await moveMouse(pinAwayPoint.x, pinAwayPoint.y);
  }
  pinAway = await ev(pinStateExpr());
  pinAwayInfo = await ev(pillarsExpr());
  pinAwayShot = panelClip === null ? "" : await shot("hub-pin-away", panelClip);
  /* ④ 清单可滑动：把列表滚到底，scrollTop 必须动 */
  pinScrollTop = Number(await ev("(function(){var l=document.querySelector(" + j(".hub-map-projects__list") + ");if(l===null){return 0;}l.scrollTop=9999;return Math.round(l.scrollTop);})()"));
  pinScrollShot = panelClip === null ? "" : await shot("hub-pin-scroll", panelClip);
  /* ⑤ 点「展开全部」→ 清单从最多 6 条放到全量 */
  const pinExpandPoint = await ev(elementCenterExpr(".hub-map-projects__expand"));
  if (pinExpandPoint !== null) {
    await moveMouse(pinExpandPoint.x, pinExpandPoint.y);
    await clickAt(pinExpandPoint);
  }
  pinExpanded = await ev(pinStateExpr());
  pinExpandShot = panelClip === null ? "" : await shot("hub-pin-expanded", panelClip);
  /* ⑥ 点别国 → 钉子挪过去（展开态复位） */
  const pinSecond = pillarList.filter((item) => item.kind === "country" && item.name !== pinName).reduce((best, item) => (best === null || item.count > best.count ? item : best), null);
  const pinSecondPoint = pinSecond === null ? null : await ev(countryInsidePointExpr(pinSecond.name, pinSecond.x));
  if (pinSecondPoint !== null) {
    pinSecondName = pinSecond.name;
    pinSecondCount = pinSecond.count;
    await moveMouse(pinSecondPoint.x, pinSecondPoint.y);
    await sleep(600);
    await clickAt(pinSecondPoint);
    pinMoved = await ev(pinStateExpr());
    /* ⑦ 再点一次同一国 → 解除（与「×」同一个动作） */
    await sleep(400);
    await clickAt(pinSecondPoint);
    pinToggled = await ev(pinStateExpr());
    /* ⑧ 再点一次把它钉回来，然后按 Esc 解除 */
    await sleep(300);
    await clickAt(pinSecondPoint);
    pinRepinned = await ev(pinStateExpr());
    await pressEscape();
    pinAfterEscape = await ev(pinStateExpr());
    /* ⑨ 再钉一次，然后点海面空白处也能取消 */
    await sleep(300);
    await clickAt(pinSecondPoint);
    pinBeforeBlank = await ev(pinStateExpr());
    const pinBlankHit = oceanPoint === null ? null : await ev(styleExpr(oceanPoint.x, oceanPoint.y));
    if (oceanPoint !== null && pinBlankHit !== null && pinBlankHit.hitTag === "svg") {
      await moveMouse(oceanPoint.x, oceanPoint.y);
      await clickAt(oceanPoint);
    }
    pinAfterBlank = await ev(pinStateExpr());
  }
}
check("九追订：只碰不点不钉（柱长出来了、清单还不吃鼠标事件、徽标挂着「点一下钉住」）", pinHover !== null && pinHover.pinned.length === 0 && pinHover.panelPinned === false && pinHover.panelPointer === "none" && pinHover.shown.length === 1 && pinHover.shown[0] === pinName && pinHover.badgeHint === "点一下钉住", pinHover === null ? "null" : JSON.stringify([pinHover.pinned, pinHover.shown, pinHover.panelPointer, pinHover.badgeHint]));
check("九追订：点一下国家区域（" + pinName + "）→ 立柱钉住（data-pinned）、清单接通鼠标并挂「已钉住」「展开全部」「×」", pinState !== null && pinState.pinned.length === 1 && pinState.pinned[0] === pinName && pinState.panelPinned === true && pinState.panelActive === true && pinState.panelPointer === "auto" && pinState.hasExpand === true && pinState.hasClose === true && pinState.pinBadge === true && pinState.badgeText.indexOf("已钉住") >= 0 && pinState.badgeHint === "", pinState === null ? "null" : JSON.stringify([pinState.pinned, pinState.panelPinned, pinState.panelPointer, pinState.hasExpand, pinState.hasClose, pinState.badgeText, pinState.badgeHint]));
check("九追订：钉住后鼠标走开（移到清单上）：钉子不松、柱 / 国名徽标 / 高亮都留在该国", pinAway !== null && pinAway.pinned.length === 1 && pinAway.pinned[0] === pinName && pinAway.shown.length === 1 && pinAway.shown[0] === pinName && pinAway.panelActive === true && pinAwayInfo !== null && pinAwayInfo.linkedCountry === pinName && pinAwayInfo.linkedPillar === pinName && pinAwayInfo.badgeCount === String(pinPillar.count) + " 个项目", pinAwayInfo === null ? "null" : JSON.stringify([pinAway.pinned, pinAway.panelActive, pinAwayInfo.linkedCountry, pinAwayInfo.badgeCount]));
check("九追订：钉住后清单可滑动（overflow-y: auto、库内 " + String(pinTotalDb) + " 条比可视区高、滚到底 scrollTop = " + String(pinScrollTop) + "）", pinAway !== null && pinAway.overflowY === "auto" && pinAway.scrollHeight > pinAway.clientHeight && pinScrollTop > 0 && pinTotalDb > 6, pinAway === null ? "null" : JSON.stringify([pinAway.overflowY, pinAway.scrollHeight, pinAway.clientHeight, pinScrollTop]));
check("九追订：点「展开全部」→ 清单放开高度上限（可视区 " + String(pinAway === null ? 0 : pinAway.clientHeight) + "px → " + String(pinExpanded === null ? 0 : pinExpanded.clientHeight) + "px、" + String(pinTotalDb) + " 条全装下不再滚）、按钮转「收起」", pinExpanded !== null && pinExpanded.panelExpanded === true && pinExpanded.rows === pinTotalDb && pinExpanded.panelText.indexOf("收起") >= 0 && pinExpanded.scrollHeight <= pinExpanded.clientHeight && pinAway !== null && pinAway.scrollHeight > pinAway.clientHeight, pinExpanded === null ? "null" : JSON.stringify([pinExpanded.panelExpanded, pinExpanded.rows, pinExpanded.panelText]));
check("九追订：点别国（" + pinSecondName + "）→ 钉子挪过去、展开态复位（钉住时该国 " + String(pinSecondCount) + " 条全列出来，不展开就靠列表自己滚）", pinMoved !== null && pinSecondName !== "" && pinMoved.pinned.length === 1 && pinMoved.pinned[0] === pinSecondName && pinMoved.panelCountry === pinSecondName && pinMoved.panelExpanded === false && pinMoved.rows === pinSecondCount && pinMoved.scrollHeight > pinMoved.clientHeight, pinMoved === null ? "null" : JSON.stringify([pinMoved.pinned, pinMoved.panelCountry, pinMoved.panelExpanded, pinMoved.rows]));
check("九追订：再点一次同一国解除（" + pinSecondName + " 清空）、钉回来后按 Esc 也能解除", pinToggled !== null && pinToggled.pinned.length === 0 && pinToggled.panelPointer === "none" && pinToggled.panelExpanded === false && pinRepinned !== null && pinRepinned.pinned.length === 1 && pinRepinned.pinned[0] === pinSecondName && pinAfterEscape !== null && pinAfterEscape.pinned.length === 0 && pinAfterEscape.panelPinned === false && pinAfterEscape.panelExpanded === false && pinAfterEscape.panelPointer === "none", pinAfterEscape === null ? "null" : JSON.stringify([pinToggled === null ? null : pinToggled.pinned, pinRepinned === null ? null : pinRepinned.pinned, pinAfterEscape.pinned, pinAfterEscape.panelPointer]));

check("九追订：点海面空白处也能取消钉住（钉子清空、清单收起、恢复不吃鼠标事件）", pinBeforeBlank !== null && pinBeforeBlank.pinned.length === 1 && pinBeforeBlank.pinned[0] === pinSecondName && pinAfterBlank !== null && pinAfterBlank.pinned.length === 0 && pinAfterBlank.panelPinned === false && pinAfterBlank.panelExpanded === false && pinAfterBlank.panelPointer === "none", pinAfterBlank === null ? "null" : JSON.stringify([pinBeforeBlank === null ? null : pinBeforeBlank.pinned, pinAfterBlank.pinned, pinAfterBlank.panelPointer]));

const plainName = HOVER_TARGETS[0] ?? "斐济";
const plainPoint = await ev(findCountryPointExpr(plainName));
let plainInfo = null;
if (plainPoint !== null) {
  await moveMouse(plainPoint.x, plainPoint.y);
  plainInfo = await ev(pillarsExpr());
}
const plainShown = plainInfo === null ? [] : plainInfo.pillars.filter((item) => item.shown === "true").map((item) => item.name);
check("鼠标触碰没有项目的国家（" + plainName + "）：地图保持原效果（没有柱露面、不出项目清单）", plainInfo !== null && plainInfo.panelActive === false && plainInfo.linkedPillar === "" && plainInfo.badgeCount === "" && plainShown.length === 0, plainInfo === null ? "null" : JSON.stringify([plainInfo.panelActive, plainInfo.linkedPillar, plainInfo.badgeCount, plainShown]));
await sleep(340);
const focusRestPaint = focusPillar === undefined ? null : await ev(countryPaintExpr(focusPillar.name));
check("鼠标移开有项目的国家：立柱收回、还原成本档蓝底（" + focusRestFill + "）+ 蓝轮廓（" + PROJECT_BLUE_DEEP + "）", focusRestPaint !== null && focusRestPaint.fill === focusRestFill && focusRestPaint.stroke === PROJECT_BLUE_DEEP, JSON.stringify(focusRestPaint));

let filterHash = "";
if (focusPillar !== undefined && focusPoint !== null) {
  /* 方案 E 里柱子是触碰才出来的：点之前要再碰一次国家把它叫出来 */
  const againPoint = await ev(countryInsidePointExpr(focusPillar.name, focusPillar.x));
  if (againPoint !== null) {
    await moveMouse(againPoint.x, againPoint.y);
    await sleep(780);
  }
  const clickPoint = await ev(pillarPointExpr(focusPillar.name));
  if (clickPoint !== null) {
    await moveMouse(clickPoint.x, clickPoint.y);
    await sleep(220);
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: clickPoint.x, y: clickPoint.y, button: "left", clickCount: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: clickPoint.x, y: clickPoint.y, button: "left", clickCount: 1 });
    await sleep(700);
    filterHash = String(await ev("window.location.hash"));
  }
}
check("点立柱（先触碰国家把柱叫出来、再点柱）：进「项目空间」并按该地区筛选（filter[region]）", filterHash.indexOf("filter[region]=") >= 0 && decodeURIComponent(filterHash).indexOf(focusPillar.name) >= 0, filterHash);
const narrowW = 760;
const narrowH = 900;
await openHub(narrowW, narrowH);
const narrowPills = await ev(pillsExpr());
const narrowPanel = await ev(panelExpr());
const narrowShot = await shot("hub-narrow");
check("窄屏：三个胶囊改成横排（同一行）", Array.isArray(narrowPills) && narrowPills.length === 3 && Math.abs(narrowPills[0].y - narrowPills[2].y) <= 2 && narrowPills[2].x > narrowPills[0].x, Array.isArray(narrowPills) ? JSON.stringify(narrowPills.map((item) => [item.x, item.y])) : "null");
check("窄屏：地图面板落在胶囊下方、占满宽度", narrowPanel !== null && Array.isArray(narrowPills) && narrowPanel.y > narrowPills[0].y + narrowPills[0].h && narrowPanel.w > narrowW * 0.8, JSON.stringify(narrowPanel));

check("控制台零报错 / 零警告", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" ;; "));

await db.query("update sessions set revoked_at = now() where token_hash = $1", [sha256(token)]);
const residue = (await db.query("select (select count(*)::int from sessions where token_hash = $1 and revoked_at is null) as sessions", [sha256(token)])).rows[0];
check("清理：临时会话已撤销、零残留", Number(residue.sessions) === 0, JSON.stringify(residue));

console.log("截图：");
for (const file of [baseShot, chinaShot, taiwanShot, singaporeShot, countryRestShot, forcedShot, hoverShot, hoveredShot, panelShot, pillarShot, grownShot, pillarHoverShot, pinClickShot, pinAwayShot, pinScrollShot, pinExpandShot, narrowShot]) {
  if (file === "") { continue; }
  console.log("  " + file);
}
const failed = checks.filter((item) => item.ok !== true).length;
console.log("—— 合计 " + String(checks.length) + " 项：" + String(checks.length - failed) + " 通过 / " + String(failed) + " 失败 ——");
try { page.ws.close(); } catch (error) { /* 忽略 */ }
chrome.kill();
await db.end();
process.exit(failed === 0 ? 0 : 1);

