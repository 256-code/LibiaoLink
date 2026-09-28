#!/usr/bin/env node
/**
 * LibiaoLink 前端 · 回放：项目卡片的「项目序号」（右上角圆点里的编号）不被卡片右边缘裁掉
 *
 * 业务口径（2026-09-24）：「这个编号bug」—— 卡片右上角的序号是**三位数**（≥100，演示数据已经到 204）时，
 * 末位越过卡片右缘被裁掉（卡片是 `overflow: hidden`，数字原来用 `left-6` 锚在装饰圆点里，
 * 三位数宽 42px → 右缘 = 卡片右缘 + 6px）。修法：改成 `right-6` 锚在圆点右内侧 + `whitespace-nowrap`。
 *
 * 本脚本用真机浏览器（无头 Chrome + CDP）验：
 *   ① 项目空间渲染出的卡片张数与页头「共 N 个项目」= 库内未删项目数；
 *   ② 逐张对账：卡片 `<h1>` 的编号（code）→ 库内 `seq_no`，卡面序号 = `seq_no` 两位补零，卡面 `title` 也报同一个数；
 *   ③ **回归护栏**：每一张卡片的序号文本框都完整落在卡片框里（右缘 ≤ 卡片右缘 - 1px、左缘 ≥ 卡片左缘），
 *      三位数（≥100）与两位数（<100）两组各自单独断言 —— 复现「三位数被裁」这条 bug 只要把锚点改回 `left-6` 就会红；
 *   ④ 卡片真的是 `overflow-x: hidden`（说明越界就会被裁，护栏不是自娱自乐）；
 *   ⑤ 真实鼠标悬停卡片（`hover:scale-[1.02]`）之后数字仍在卡内；
 *   ⑥ 控制台零报错；跑完会话撤销、库内零残留。
 *
 * 前置（三件都在本机跑着）：
 *   1. 前端 dev：cd frontend && npm run dev（默认 3000）
 *   2. api：cd server && npm run start:api（默认 3001，需先 npm run build）
 *   3. 数据库：本地沙箱 PG（默认 127.0.0.1:5433/libiaolink）
 *   4. 本机装了 Chrome（脚本 headless 起一个调试实例；路径可用 CHROME_PATH 覆盖）
 *
 * 用法：node scripts/ui-card-seqno-e2e.mjs
 *   可覆盖的环境变量：FRONTEND_BASE / DATABASE_URL / CHROME_PATH / CDP_PORT / REPLAY_USER / PG_MODULE / SHOT_DIR
 *
 * 夹具：一条**临时会话**（跑完撤销）。不改任何业务数据，跑完零残留。
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
const PORT = Number(process.env.CDP_PORT ?? 9408);
const DB = process.env.DATABASE_URL ?? "postgres://libiaolink_api@127.0.0.1:5433/libiaolink";
const REPLAY_USER = process.env.REPLAY_USER ?? "panxing";
const SHOTS = process.env.SHOT_DIR ?? join(tmpdir(), "px-card-seqno-shots");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const Q = String.fromCharCode(34);
const j = (value) => JSON.stringify(value);
const checks = [];
const check = (name, ok, detail) => { checks.push({ name: name, ok: ok === true }); console.log((ok === true ? "  PASS  " : "  FAIL  ") + name + (ok === true || detail === undefined ? " " : "  —— " + detail)); };

mkdirSync(SHOTS, { recursive: true });
const db = new Client({ connectionString: DB });
await db.connect();
const userRow = (await db.query("select id, username, display_name from users where username = $1", [REPLAY_USER])).rows[0];
if (userRow === undefined) { console.error("回放用户不存在：" + REPLAY_USER); process.exit(1); }
const token = "pxseq-" + randomBytes(16).toString("hex");
const csrf = randomBytes(16).toString("hex");
await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(mins => 30))", [sha256(token), userRow.id, "px-card-seqno-e2e"]);
console.log("临时会话：" + userRow.username + "（" + userRow.display_name + "）");

const liveRows = (await db.query("select code, seq_no from projects where deleted_at is null")).rows;
const seqByCode = new Map(liveRows.map((row) => [row.code, Number(row.seq_no)]));
const headTotal = Number((await db.query("select count(*)::int as total from projects where deleted_at is null")).rows[0].total);

const profile = mkdtempSync(join(tmpdir(), "pxseq-"));
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

const target = await waitTarget();
const page = new Cdp(target.webSocketDebuggerUrl);
await page.ready;
await page.send("Network.enable");
await page.send("Page.enable");
await page.send("Runtime.enable");
await page.send("Log.enable");
const consoleErrors = [];
page.ws.addEventListener("message", (event) => {
  const msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
  if (msg.method === "Log.entryAdded" && msg.params !== undefined && msg.params.entry !== undefined && msg.params.entry.level === "error") {
    consoleErrors.push(String(msg.params.entry.text));
  }
  if (msg.method === "Runtime.exceptionThrown") { consoleErrors.push("exceptionThrown"); }
  if (msg.method === "Runtime.consoleAPICalled" && msg.params !== undefined && msg.params.type === "error") {
    consoleErrors.push((msg.params.args ?? []).map((item) => String(item.value ?? item.description ?? " ")).join(" "));
  }
});
await page.send("Network.setCookie", { name: "ll_sid", value: token, url: FRONTEND + "/", path: "/", httpOnly: true, secure: false });
await page.send("Network.setCookie", { name: "ll_csrf", value: csrf, url: FRONTEND + "/", path: "/", httpOnly: false, secure: false });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ev = async (expression) => (await page.send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
async function shot(name, clip) {
  const params = { format: "png" };
  if (clip !== undefined && clip !== null) { params.clip = clip; }
  const result = await page.send("Page.captureScreenshot", params);
  const file = join(SHOTS, name + ".png");
  writeFileSync(file, Buffer.from(result.data, "base64"));
  return file;
}

await page.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
await page.send("Page.navigate", { url: "about:blank" });
await sleep(400);
await page.send("Page.navigate", { url: FRONTEND + "/#/projects" });
for (let i = 0; i < 40; i += 1) {
  const n = await ev("document.querySelectorAll(" + j(".project-card") + ").length");
  if (Number(n) > 0) break;
  await sleep(500);
}
await sleep(1500);

/** 逐张卡片读数：卡片框、序号文本框、卡片编号（code）、序号文本与 title */
const cardsExpr = () => "(function(){var cards=document.querySelectorAll(" + j(".project-card") + ");var out=[];for(var i=0;i<cards.length;i+=1){var c=cards[i];var p=c.querySelector(" + j("p[title]") + ");var h=c.querySelector(" + j("h1") + ");var r=c.getBoundingClientRect();var pr=p===null?null:p.getBoundingClientRect();var st=getComputedStyle(c);out.push({code:h===null?" + j(" ") + ":String(h.textContent||" + j(" ") + ").trim(),seq:p===null?" + j(" ") + ":String(p.textContent||" + j(" ") + ").trim(),title:p===null?" + j(" ") + ":String(p.getAttribute(" + j("title") + ")||" + j(" ") + "),cardLeft:r.left,cardRight:r.right,numLeft:pr===null?null:pr.left,numRight:pr===null?null:pr.right,overflowX:st.overflowX});}return out;})()";
const cards = await ev(cardsExpr());
const pageTotalText = String(await ev("(function(){var nodes=document.querySelectorAll(" + j("span") + ");for(var i=0;i<nodes.length;i+=1){var t=String(nodes[i].innerText||" + j(" ") + ").trim();if(/(共|找到)\\s*\\d+\\s*个项目/.test(t)){return t;}}return " + j(" ") + ";})()"));

const baseShot = await shot("card-seqno");
const zoomShot = cards.length === 0 ? "" : await shot("card-seqno-zoom", { x: 0, y: 140, width: 380, height: 250, scale: 3 });
console.log("截图：" + baseShot + " / " + zoomShot);

const three = cards.filter((item) => item.seq.length >= 3);
const two = cards.filter((item) => item.seq.length === 2);
const padBad = cards.filter((item) => seqByCode.has(item.code) !== true || item.seq !== String(seqByCode.get(item.code)).padStart(2, "0") || item.title !== "项目序号 " + item.seq);
const outRight = cards.filter((item) => item.numRight === null || item.numRight > item.cardRight - 1);
const outLeft = cards.filter((item) => item.numLeft === null || item.numLeft < item.cardLeft);
const notHidden = cards.filter((item) => item.overflowX !== "hidden");

check("项目空间渲染出 " + String(cards.length) + " 张卡片（库内未删项目 " + String(headTotal) + " 个）", cards.length > 0 && cards.length === headTotal, "页头：" + pageTotalText + " / 卡片：" + String(cards.length) + " / 库内：" + String(headTotal));
check("卡面序号 = 库内 seq_no 两位补零（编号 code 对得上）、title 报同一个数", padBad.length === 0, padBad.slice(0, 3).map((item) => item.code + "=" + item.seq + "(" + item.title + ")").join(" ;; "));
check("样本护栏：三位数序号（≥100）与两位数序号各至少一张", three.length > 0 && two.length > 0, "三位 " + String(three.length) + " 张 / 两位 " + String(two.length) + " 张");
check("**编号 bug 回归护栏**：三位数序号完整落在卡片里（右缘 ≤ 卡片右缘 - 1px）", three.length > 0 && outRight.filter((item) => item.seq.length >= 3).length === 0, outRight.slice(0, 3).map((item) => item.seq + " 越界 " + String(Math.round(item.numRight - item.cardRight)) + "px").join(" ;; "));
check("两位数序号同样不越界（对照组）", two.length > 0 && outRight.filter((item) => item.seq.length === 2).length === 0, outRight.slice(0, 3).map((item) => item.seq).join(" ;; "));
check("全部 " + String(cards.length) + " 张：序号左右都在卡片内、且卡片确实是 overflow-x: hidden（越界就会被裁）", outLeft.length === 0 && outRight.length === 0 && notHidden.length === 0, "左越界 " + String(outLeft.length) + " 张 / 右越界 " + String(outRight.length) + " 张 / overflow 不是 hidden 的 " + String(notHidden.length) + " 张");

let hoverInfo = null;
if (cards.length > 0) {
  const point = await ev("(function(){var c=document.querySelector(" + j(".project-card") + ");if(c===null){return null;}var r=c.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+40)};})()");
  if (point !== null) {
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
    await sleep(600);
    const hovered = await ev(cardsExpr());
    hoverInfo = hovered.length === 0 ? null : hovered[0];
  }
}
check("真实鼠标悬停卡片（hover:scale-[1.02]）之后序号仍在卡内", hoverInfo !== null && hoverInfo.numRight !== null && hoverInfo.numRight <= hoverInfo.cardRight - 1 && hoverInfo.seq.length >= 2, hoverInfo === null ? "null" : JSON.stringify([hoverInfo.seq, Math.round(hoverInfo.numRight), Math.round(hoverInfo.cardRight)]));

check("控制台零报错 / 零警告", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" ;; "));

await db.query("update sessions set revoked_at = now() where token_hash = $1", [sha256(token)]);
const residue = (await db.query("select count(*)::int as n from sessions where token_hash = $1 and revoked_at is null", [sha256(token)])).rows[0];
check("清理：临时会话已撤销、零残留", Number(residue.n) === 0, JSON.stringify(residue));

const failed = checks.filter((item) => item.ok !== true).length;
console.log("—— 合计 " + String(checks.length) + " 项：" + String(checks.length - failed) + " 通过 / " + String(failed) + " 失败 ——");
try { page.ws.close(); } catch (error) { /* 忽略 */ }
chrome.kill();
await db.end();
process.exit(failed === 0 ? 0 : 1);