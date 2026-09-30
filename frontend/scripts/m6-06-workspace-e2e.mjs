#!/usr/bin/env node
/**
 * LibiaoLink 前端 · 回放：工作台「我的任务」页（Push 230 · M6-06 前端接线 · A6-01 / A6-03）
 *
 * 业务口径（2026-09-30）：「改成 我提出的问题」「同样做标签导航栏 我的任务 我提出的问题先做这两个」
 *   「我的任务 是折叠面板 未展开是项目名称和编号 下拉是具体我的任务」「我提出的问题就参考日报的问题追踪即可
 *   也是折叠面板」「开始做前端」「表格内容要全」「直接把这个搬到我的任务不就好了」（任务表行口径照项目页任务表搬）→
 *   「这些字段一个不能少懂吗」（Push 231：任务表列补齐项目页任务表全 15 列，「预计所需天数」窄列也在）→
 *   「增加进入项目按钮」（Push 232：折叠面板头常驻「进入项目」深链 → 项目详情缺省标签「项目总览」）→
 *   「这个下拉要有记忆」（Push 233：折叠面板展开态按账号存偏好 workspaceOpenProjects，刷新 / 换标签保持）→
 *   「增加一个我的计划页面」+「你只要把导航栏设计好 后续详细设计再说」（Push 234：导航栏第三枚标签「我的计划」+
 *   路由 `?tab=plan` 就位；页面内容待详细设计，暂落登记卡 —— 数据面 / 契约本刀不动）。
 *
 * 口径复评（2026-09-30 · 业务：「明明有四个 为什么只显示了两个」→「不能有 7 天内时间限制」→「时间不限制 另外
 *   项目经理是我也要算在我的任务」）：我的任务 = 任务负责人含我 或 项目项目经理含我 + 未完成、不限完成日期窗口；
 *   未排期（无预计完成日期）单列一组 —— 本脚本 ① 对账 / ②④ 任务表 / ⑩ 记忆段的行数断言随新口径重算（四组 / 6 项）。
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
 * 它做什么：用**两条临时会话**（panxing = 我；wmj = 反例提出人；跑完撤销）+ **三个临时项目**
 * （PX-M6WS-*；跑完物理删、零残留）在真机浏览器里跑一遍工作台接线后的读写口径 ——
 *   ① 接口先行对账（夹具落库后 GET /api/v1/workspace）：跨项目四组任务 + 「我提出的」不含他人提的问题；
 *   ② 页面骨架：两枚下划线标签（我的任务 / 我提出的问题；文字 + 选中下划线）+ 默认选中「我的任务」+ 地址不带 `?tab=`；
 *   ③ 「我的任务」折叠面板：收起 = 项目名称 + 编号（最急的项目在最上）+ 摘要签 + 「进入项目」按钮；展开 = 该项目下的任务表；
 *   ④ 任务表口径（Push 231 扩列：列口径照项目页任务表全 15 列 ——「直接把这个搬到我的任务不就好了」+
 *      「这些字段一个不能少懂吗」）：任务描述 + 四格进度点（不含分组签 —— 业务口径「这个不要展示」，
 *      组序由行序体现）/ 项目经理 / 负责人 / 状态 / 紧急重要度 /
 *      逾期未交付 / 输出成果文件 / 文件 / 进展描述 / 开始·实际日期 / 天数 / 人数 / 变更关联；
 *      命中口径 = 负责人含我 或 项目经理含我、不限完成日期（远期照收 + 未排期单列）；他人项目（我既非负责人也非项目经理）与已完成不进；
 *   ⑤ 切标签：真实鼠标点「我提出的问题」→ 地址写回 `?tab=raised`、aria-current 转移；
 *   ⑥ 「我提出的问题」折叠面板：照「问题追踪」的完整六列（日期 / 问题描述 / 问题归类 /
 *      解决方案或建议 / 问题附图 / 问题是否处理；后两列按项目向源接口回填，真 PNG 直传夹具保证有值）+
 *      行尾「在项目中查看」；未关闭在前、不是我提的不进；
 *   ⑦ 深链：`#/my-tasks?tab=raised` 直接打开仍停在该标签；`?tab=` 不认识的值落回「我的任务」；
 *      「进入项目」按钮点开 = 项目详情总览、浏览器后退回工作台（Push 232）；
 *   ⑨ 醒目模式（Push 232 ·「同样增加醒目模式」）：开关在标签导航栏最右侧、值 = 账号偏好；开 = 任务 / 问题整行铺
 *      状态底色 + 状态签收口成深色字，关 = 恢复白底（跑完把账号偏好恢复原值，不留痕）；
 *   ⑩ 折叠面板展开态记忆（Push 233 ·「这个下拉要有记忆」）：偏好归零 = 全收起 → 展开 A → 刷新仍展开 / B 仍收起 →
 *      切「我提出的问题」两面板全收起（两标签各自独立记忆）→ raised 展开 B → 切回 tasks 的 A 不受影响 →
 *      收起 A → 刷新仍全收起 → GET preferences 逐段落库核对 → 收尾恢复账号偏好原值（不留痕）；
 *   ⑪ 「我的计划」标签（Push 234）：第三枚标签在导航栏 → 点击写回 `?tab=plan` + 选中态转移 → 页内 = 登记卡
 *      （导航栏 / 路由已就位、内容待详细设计；无任务 / 问题表）→ 深链 `#/my-tasks?tab=plan` 直接打开仍停在该标签 →
 *      点回「我的任务」地址回到不带参数的原口径；
 *   ⑧ 收尾：删三个临时项目（A / B / C，物理删）→ 读面 404；撤销两条临时会话；库内零残留；控制台 0 异常。
 * 证据：docs/m6-回放证据(工作台我的任务·前端).md（Push 231 扩列 + Push 232「进入项目」/ 醒目模式 + Push 233 展开态记忆小节）
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
/** Push 231 扩列夹具：开始日期（逾期任务 -4 天 → 与预计完成日含首尾 5 天；今日任务 -2 天 → 推算 3 天）。 */
const START_OVERDUE = shiftIso(DUE_OVERDUE, -4);
const START_TODAY = shiftIso(TODAY, -2);

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
const codeC = "PX-M6WS-C" + suffix;
const projC = await api("/api/v1/projects", "POST", { code: codeC, name: "回放·工作台C（非我管理）", description: "回放·工作台C", managerIds: [other.id] });
check("夹具：建临时项目 C（201；经理 = 反例提出人 —— 我既非负责人也非项目经理，反例面）", projC.status === 201, String(projC.status) + " " + projC.text.slice(0, 140));
const projectC = projC.json === null ? "" : projC.json.id;

async function addTask(projectId, body, request = api) {
  const res = await request("/api/v1/projects/" + projectId + "/tasks", "POST", body);
  if (res.status !== 201 || res.json === null) {
    console.error("建任务失败：" + res.status + " " + res.text.slice(0, 200));
    process.exit(1);
  }
  return res.json;
}
// A：逾期 / 今日 / 即将 三条（我的）+ 远期（负责人是别人 —— 新口径经「项目经理含我」命中）+ 未排期（新组）+ 已完成反例；
// C：他人项目他人任务（我既非负责人也非项目经理 —— 反例面）；B：跨项目今日一条。
// Push 231 扩列：逾期 / 今日两条在创建时补齐任务表扩展列（成果文件只能建时给；开始日期 / 天数 / 人数 / 进展描述随行落库）
const tOverdue = await addTask(projectA, { stageKey: "design", title: "回放·逾期任务", titleEn: "Replay overdue", ownerIds: [me.id], plannedStart: START_OVERDUE, plannedEnd: DUE_OVERDUE, priority: "高", estimatedDays: 5, headcount: 6, deliverableTypes: ["CAD图纸", "合同"], note: "回放·进展描述：图纸已出，等待评审" });
const tToday = await addTask(projectA, { stageKey: "design", title: "回放·今日任务", ownerIds: [me.id], plannedStart: START_TODAY, plannedEnd: TODAY, priority: "中", headcount: 3, deliverableTypes: ["验收单"] });
const tUpcoming = await addTask(projectA, { stageKey: null, title: "回放·即将任务", ownerIds: [me.id], plannedEnd: DUE_UPCOMING, priority: "低" });
const tDone = await addTask(projectA, { stageKey: "design", title: "回放·已完成任务", ownerIds: [me.id], plannedEnd: TODAY });
const tFar = await addTask(projectA, { stageKey: "design", title: "回放·远期任务", ownerIds: [other.id], plannedEnd: DUE_FAR });
const tUnscheduled = await addTask(projectA, { stageKey: "design", title: "回放·未排期任务", ownerIds: [me.id], plannedEnd: null });
const tStranger = await addTask(projectC, { stageKey: "presale", title: "回放·他人项目任务", ownerIds: [other.id], plannedEnd: TODAY }, apiOther);
// B：今日一条（我的）—— 跨项目聚合的第二块面板
const tB = await addTask(projectB, { stageKey: "presale", title: "回放·B项目今日任务", ownerIds: [me.id], plannedEnd: TODAY });
const progressRes = await api("/api/v1/projects/" + projectA + "/tasks/" + tUpcoming.id + "/progress", "PATCH", { progress: 0.5, version: tUpcoming.version });
check("夹具：即将任务改进度到 50%（PATCH progress）", progressRes.status === 200, String(progressRes.status));
const doneRes = await api("/api/v1/projects/" + projectA + "/tasks/" + tDone.id, "PATCH", { status: "done", version: tDone.version });
check("夹具：反例任务置「已完成」（PATCH status=done）", doneRes.status === 200, String(doneRes.status) + " " + doneRes.text.slice(0, 140));
// Push 231 扩列夹具 ①：「变更关联」列 —— change_requests 只追加 + 任务 change_refs 回写（页面读面走真实任务列表接口；
// 这里落库等价于「变更生效 R01 回写」后的状态，收尾时随项目物理删一起清）
const changeRow = (await db.query(
  "insert into change_requests (project_id, stage_key, reason, status, applied_by) values ($1, $2, $3, 'applied', $4) returning id",
  [projectA, "design", "回放·变更原因：设计调整", me.id],
)).rows[0];
const changeId = changeRow === undefined ? "" : changeRow.id;
const changeRefsRes = changeId === "" ? { rowCount: 0 } : await db.query("update tasks set change_refs = array[$2]::uuid[] where id = $1", [tToday.id, changeId]);
check("夹具：今日任务挂 1 条变更关联（change_requests + tasks.change_refs）", changeId !== "" && changeRefsRes.rowCount === 1, changeId);
// Push 231 扩列夹具 ②：「文件」列 —— 任务文件走真实直传链路（draft 关联本任务 → fileSummary 1 份 / 未定档 1）
const taskFileName = "回放-任务文件.txt";
const taskFileBytes = Buffer.from("LibiaoLink 回放任务文件（Push 231 扩列）", "utf8");
const taskFileHash = sha256(taskFileBytes);
const tfInit = await api("/api/v1/files/uploads", "POST", { projectId: projectA, taskId: tOverdue.id, name: taskFileName, sizeBytes: taskFileBytes.length, mime: "text/plain", contentHash: taskFileHash, intent: "version" });
const tfFileId = tfInit.json === null ? "" : tfInit.json.file.id;
const tfSession = tfInit.json === null ? "" : tfInit.json.upload.id;
check("夹具：任务文件发起直传（201，taskId 挂到逾期任务）", tfInit.status === 201 && tfFileId !== "" && tfSession !== "", String(tfInit.status) + " " + tfInit.text.slice(0, 140));
const tfSigned = await api("/api/v1/files/" + tfFileId + "/uploads/" + tfSession + "/parts", "POST", { partNumbers: [1] });
const tfUrl = tfSigned.json === null ? "" : tfSigned.json.parts[0].url;
const tfPut = tfUrl === "" ? { ok: false, status: 0 } : await fetch(tfUrl, { method: "PUT", body: taskFileBytes });
const tfDone = tfPut.ok ? await api("/api/v1/files/" + tfFileId + "/uploads/" + tfSession + "/complete", "POST", { contentHash: taskFileHash }) : { status: 0 };
check("夹具：任务文件直传完成（PUT 200 → complete 200 落 draft 版本）", tfPut.status === 200 && tfDone.status === 200, String(tfPut.status) + " / " + String(tfDone.status));

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

// ---------- ⓪b 展开态偏好（A31 · Push 233）：先记原值 → 归零 ----------
// Push 233 起折叠面板展开态按账号存服务端（「这个下拉要有记忆」）—— 本脚本的「页面打开 = 全收起 / 点一下 = 展开」口径
// 依赖起点归零；跑完由 ⑩ 恢复原值（不留痕）。原值先记，早于任何页面交互。
const prefBeforeMemory = await api("/api/v1/users/me/preferences");
const memoryOriginal = prefBeforeMemory.status === 200 && prefBeforeMemory.json !== null && typeof prefBeforeMemory.json.workspaceOpenProjects === "object" && prefBeforeMemory.json.workspaceOpenProjects !== null
  ? prefBeforeMemory.json.workspaceOpenProjects
  : { tasks: [], raised: [] };
/** 等展开态落库回读（服务端收敛后与期望值一致才算落库；最多 ~6s）。 */
async function waitOpenProjects(value) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const now = await api("/api/v1/users/me/preferences");
    if (now.status === 200 && now.json !== null && JSON.stringify(now.json.workspaceOpenProjects) === JSON.stringify(value)) {
      return now;
    }
    await sleep(300);
  }
  return null;
}
async function patchOpenProjects(value) {
  await api("/api/v1/users/me/preferences", "PATCH", { workspaceOpenProjects: value });
  return await waitOpenProjects(value);
}
/** 面板读数：data-open（字符串 "true" / "false"）+ 面板内表格行数（展开才 > 0）。 */
const panelOpenOf = (projectId) => "(function(){var p=document.querySelector(" + j('[data-workspace-panel="' + projectId + '"]') + ");return p===null?null:{open:String(p.getAttribute(" + j("data-open") + ")),rows:p.querySelectorAll(" + j("[data-workspace-task],[data-workspace-issue]") + ").length};})()";
/** 确保某面板为指定展开态（展开态按账号记忆后，点面板头前必须先对齐状态，回放才与运行顺序无关）。 */
async function ensurePanelOpen(projectId, wantOpen) {
  const current = await ev(panelOpenOf(projectId));
  if (current === null) throw new Error("面板不存在：" + projectId);
  if (current.open === String(wantOpen)) return;
  await clickSelector('[data-workspace-panel="' + projectId + '"] [data-workspace-panel-toggle]');
  await waitFor(panelOpenOf(projectId) + ".open === " + j(String(wantOpen)), 25000);
}

// ---------- ① 接口先行对账（页面口径的服务端真相） ----------
const wsRes = await api("/api/v1/workspace");
check("①a GET /api/v1/workspace 200（仅会话、跨项目）", wsRes.status === 200 && wsRes.json !== null, String(wsRes.status));
const ws = wsRes.json === null ? { myTasks: { today: [], upcoming: [], overdue: [], unscheduled: [] }, myIssues: { handling: [], raised: [] } } : wsRes.json;
const idsOf = (list) => (list === undefined ? [] : list).map((item) => item.id);
/** 我是项目经理的既有项目（本机库里就有）在办任务也会进读面 —— 夹具断言按测试项目 id 收窄，
 *  页面级计数（②d / ③a / ⑫a）一律与接口读面逐项对账，别被历史数据带偏。 */
const TEST_PROJECTS = [projectA, projectB, projectC];
const inTest = (list) => (list === undefined ? [] : list).filter((item) => TEST_PROJECTS.indexOf(item.projectId) >= 0);
const todayTest = idsOf(inTest(ws.myTasks.today));
const upcomingTest = idsOf(inTest(ws.myTasks.upcoming));
const overdueTest = idsOf(inTest(ws.myTasks.overdue));
const unscheduledTest = idsOf(inTest(ws.myTasks.unscheduled));
const ambientTotal = idsOf(ws.myTasks.today).length + idsOf(ws.myTasks.upcoming).length + idsOf(ws.myTasks.overdue).length + idsOf(ws.myTasks.unscheduled).length;
const expectPanelOrder = [];
for (const group of ["overdue", "today", "upcoming", "unscheduled"]) {
  for (const task of ws.myTasks[group]) {
    if (expectPanelOrder.indexOf(task.projectId) === -1) expectPanelOrder.push(task.projectId);
  }
}
console.log("读面：全量 " + String(ambientTotal) + " 项 / " + String(expectPanelOrder.length) + " 个项目；测试项目收窄后 " + String(todayTest.length + upcomingTest.length + overdueTest.length + unscheduledTest.length) + " 项");
check("①b 基准日 = Asia/Shanghai 今天（" + TODAY + "）", ws.today === TODAY, String(ws.today));
check("①c 我的任务四组：今日 2 条（A 的今日 + B 的今日；按测试项目收窄）", todayTest.length === 2 && todayTest.indexOf(tToday.id) >= 0 && todayTest.indexOf(tB.id) >= 0, JSON.stringify(todayTest));
check("①d 我的任务四组：即将 2 条（A 的 +3 天与 +20 天 —— 原 7 天窗口已取消）、已逾期 1 条（A 的 -2 天）", upcomingTest.join(",") === [tUpcoming.id, tFar.id].join(",") && overdueTest.join(",") === tOverdue.id, JSON.stringify([upcomingTest, overdueTest]));
check("①d1 未排期单列一组：无预计完成日期照收（不再丢弃）", unscheduledTest.join(",") === tUnscheduled.id, JSON.stringify(unscheduledTest));
check("①d2 项目经理口径：远期那条负责人不是我（" + other.displayName + "）—— 因我是 A 项目项目经理而命中 upcoming", (ws.myTasks.upcoming.find((item) => item.id === tFar.id)?.ownerIds ?? []).indexOf(other.id) >= 0, JSON.stringify(ws.myTasks.upcoming.find((item) => item.id === tFar.id)?.ownerIds ?? null));
const myTaskIds = idsOf(ws.myTasks.today).concat(idsOf(ws.myTasks.upcoming), idsOf(ws.myTasks.overdue), idsOf(ws.myTasks.unscheduled));
check("①e 反例不进：他人项目任务（C —— 我既非负责人也非项目经理）与已完成任务都不进工作台", [tStranger.id, tDone.id].every((id) => myTaskIds.indexOf(id) === -1), JSON.stringify(myTaskIds));
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

/** Push 235 吸顶断言：元素几何 / 样式读数（不存在 = null）。 */
const stickyRect = (selector) => "(function(){var el=document.querySelector(" + j(selector) + ");if(el===null){return null;}var r=el.getBoundingClientRect();var cs=getComputedStyle(el);return {top:Math.round(r.top*100)/100,left:Math.round(r.left*100)/100,right:Math.round(r.right*100)/100,height:Math.round(r.height*100)/100,position:cs.position,zIndex:cs.zIndex,bg:String(cs.backgroundColor),blur:String(cs.backdropFilter||cs.webkitBackdropFilter)};})()";
/** 页头 + 标签栏读数。 */
const headExpr = () => "(function(){var tabs=document.querySelectorAll(" + j("[data-workspace-tab]") + ");var out=[];for(var i=0;i<tabs.length;i+=1){out.push({key:String(tabs[i].getAttribute(" + j("data-workspace-tab") + ")),text:tabs[i].textContent.trim(),current:tabs[i].getAttribute(" + j("aria-current") + ")});}var headerNode=document.querySelector(" + j("header") + ");return {page:document.querySelector(" + j("[data-workspace-page]") + ")!==null,tabs:out,hash:window.location.hash,header:headerNode===null?" + j("") + ":headerNode.textContent.trim()};})()";
/** 折叠面板读数（顺序即 DOM 顺序）。 */
const panelsExpr = () => "(function(){var root=document.querySelector(" + j("[data-workspace-page]") + ");if(root===null){return null;}var ps=root.querySelectorAll(" + j("[data-workspace-panel]") + ");var out=[];for(var i=0;i<ps.length;i+=1){var p=ps[i];var t=p.querySelector(" + j("[data-workspace-panel-toggle]") + ");out.push({id:String(p.getAttribute(" + j("data-workspace-panel") + ")),open:String(p.getAttribute(" + j("data-open") + ")),expanded:t===null?null:t.getAttribute(" + j("aria-expanded") + "),text:t===null?String(" + j("") + ") :t.textContent.trim(),rows:p.querySelectorAll(" + j("[data-workspace-task],[data-workspace-issue]") + ").length,link:(function(){var a=p.querySelector(" + j("[data-workspace-project-link]") + ");return a===null?null:String(a.getAttribute(" + j("href") + "));})(),linkText:(function(){var a=p.querySelector(" + j("[data-workspace-project-link]") + ");return a===null?String(" + j("") + ") :a.textContent.trim();})(),linkInToggle:p.querySelector(" + j("[data-workspace-panel-toggle] [data-workspace-project-link]") + ")!==null});}return out;})()";
/** 项目页任务表 15 列（TaskBoard.TABLE_COLUMNS 同序；「预计所需天数」窄列表头为空）——Push 231 扩列对账口径。 */
const TASK_HEAD_EXPECTED = ["任务描述", "项目经理", "任务负责人", "任务状态", "紧急重要度", "是否按时交付", "输出成果文件", "文件", "项目进展描述", "开始日期", "", "预计完成日期", "预计所需施工人数", "实际完成日期", "变更关联"];
/** 任务表读数（按项目面板）：表头（15 列）+ 每行按 data-column 列名取数（不按下标，列序调整不再连坐）。 */
const taskRowsExpr = (projectId) =>
  "(function(){var panel=document.querySelector(" + j('[data-workspace-panel="' + projectId + '"]') + ");if(panel===null){return null;}var table=panel.querySelector(" + j("[data-workspace-task-table]") + ");if(table===null){return {table:false};}var heads=table.querySelectorAll(" + j("[data-workspace-task-head] [data-column]") + ");var headTexts=[];for(var h=0;h<heads.length;h+=1){headTexts.push(heads[h].textContent.trim());}var rows=table.querySelectorAll(" + j("[data-workspace-task]") + ");var out=[];for(var i=0;i<rows.length;i+=1){var row=rows[i];var cell=function(key){var node=row.querySelector('[data-column=' + JSON.stringify(key) + ']');return node===null?'':node.textContent.trim();};var attr=function(name){var node=row.querySelector('[' + name + ']');return node===null?'':String(node.getAttribute(name));};var titleNode=row.querySelector(" + j("[data-workspace-task-title]") + ");var groupNode=row.querySelector(" + j("[data-workspace-task-group]") + ");out.push({id:String(row.getAttribute(" + j("data-workspace-task") + ")),title:cell(" + j("title") + "),titleText:titleNode===null?'':titleNode.textContent.trim(),group:attr(" + j("data-workspace-task-group") + "),groupText:groupNode===null?'':groupNode.textContent.trim(),manager:cell(" + j("manager") + "),owners:cell(" + j("owner") + "),status:cell(" + j("status") + "),statusKey:attr(" + j("data-workspace-task-status") + "),priority:cell(" + j("priority") + "),onTime:cell(" + j("onTime") + "),deliverable:cell(" + j("deliverable") + "),files:cell(" + j("files") + "),note:cell(" + j("note") + "),start:cell(" + j("start") + "),days:cell(" + j("days") + "),due:cell(" + j("due") + "),headcount:cell(" + j("headcount") + "),doneDate:cell(" + j("doneDate") + "),change:cell(" + j("change") + "),changeCount:attr(" + j("data-workspace-task-change") + "),dots:attr(" + j("data-workspace-task-dots") + "),rowClass:String(row.getAttribute(" + j("class") + ")),statusClass:(function(){var n=row.querySelector(" + j("[data-workspace-task-status]") + ");return n===null?String(" + j("") + "):String(n.getAttribute(" + j("class") + "));})()});}return {table:true,heads:headTexts,rows:out};})()";
/** 问题表读数（按项目面板）。 */
const issueRowsExpr = (projectId) => "(function(){var panel=document.querySelector(" + j('[data-workspace-panel="' + projectId + '"]') + ");if(panel===null){return null;}var table=panel.querySelector(" + j("[data-workspace-issue-table]") + ");if(table===null){return {table:false};}var heads=table.querySelectorAll(" + j("thead th") + ");var headTexts=[];for(var h=0;h<heads.length;h+=1){headTexts.push(heads[h].textContent.trim());}var rows=table.querySelectorAll(" + j("tbody tr") + ");var out=[];for(var i=0;i<rows.length;i+=1){var cells=rows[i].querySelectorAll(" + j("td") + ");var link=rows[i].querySelector(" + j("a") + ");var photoNodes=rows[i].querySelectorAll(" + j("[data-issue-photo]") + ");var photoNames=[];for(var p=0;p<photoNodes.length;p+=1){photoNames.push(String(photoNodes[p].getAttribute(" + j("data-issue-photo") + ")));}out.push({id:String(rows[i].getAttribute(" + j("data-workspace-issue") + ")),date:cells[0].textContent.trim(),title:cells[1].textContent.trim(),categories:cells[2].textContent.trim(),solution:cells[3].textContent.trim(),photosText:cells[4].textContent.trim(),photos:photoNodes.length,photoNames:photoNames,state:cells[5].textContent.trim(),href:link===null?" + j("") + ":link.getAttribute(" + j("href") + "),rowClass:String(rows[i].getAttribute(" + j("class") + ")),stateClass:(function(){var n=rows[i].querySelector(" + j("[data-issue-state]") + ");return n===null?String(" + j("") + "):String(n.getAttribute(" + j("class") + "));})()});}return {table:true,heads:headTexts,rows:out};})()";
/** 空态 / 汇总行读数。 */
const totalExpr = () => "(function(){var node=document.querySelector(" + j("[data-workspace-task-total]") + ");return node===null?null:node.textContent.trim();})()";

// 浏览器辅助函数就绪后、首次开页前：把展开态偏好归零（保证 ③ 的「页面打开 = 全收起」口径成立）
const memoryResetAtStart = await patchOpenProjects({ tasks: [], raised: [] });
console.log("前置：展开态偏好归零 → " + (memoryResetAtStart === null ? "失败（后续断言会暴露）" : JSON.stringify(memoryResetAtStart.json.workspaceOpenProjects)));
// ---------- ② 页面骨架 ----------
await open("#/my-tasks", "[data-workspace-page]");
const head0 = await ev(headExpr());
check("②a 页面渲染出「我的任务」页（data-workspace-page）+ 顶栏页名", head0 !== null && head0.page === true && head0.header.indexOf("我的任务") >= 0, head0 === null ? "null" : JSON.stringify(head0.header.slice(0, 60)));
check("②b 标签导航栏 = 三枚下划线标签（我的任务 / 我提出的问题 / 我的计划；文字，无图标）", head0 !== null && head0.tabs.length === 3 && head0.tabs.map((item) => item.text).join("|") === "我的任务|我提出的问题|我的计划" && head0.tabs.map((item) => item.key).join("|") === "tasks|raised|plan", head0 === null ? "null" : JSON.stringify([head0.tabs.map((item) => item.text), head0.tabs.map((item) => item.key)]));
check("②c 缺省选中「我的任务」、地址不带 ?tab=", head0 !== null && head0.tabs[0].current === "page" && head0.tabs[1].current === null && head0.tabs[2].current === null && head0.hash === "#/my-tasks", head0 === null ? "null" : JSON.stringify([head0.tabs.map((item) => item.current), head0.hash]));
const total0 = await ev(totalExpr());
check("②d 汇总行「共 " + String(ambientTotal) + " 项 · 跨 " + String(expectPanelOrder.length) + " 个项目 · 基准日 …」（N / M 与接口读面逐项对账）", typeof total0 === "string" && total0.indexOf("共 " + String(ambientTotal) + " 项") >= 0 && total0.indexOf("跨 " + String(expectPanelOrder.length) + " 个项目") >= 0 && total0.indexOf(cnDate(TODAY)) >= 0, String(total0));

// ---------- ③ 「我的任务」折叠面板 ----------
const panels0 = await ev(panelsExpr());
const panelsTest = panels0 === null ? null : panels0.filter((item) => TEST_PROJECTS.indexOf(item.id) >= 0);
const panelA0 = panels0 === null ? null : panels0.find((item) => item.id === projectA);
const panelB0 = panels0 === null ? null : panels0.find((item) => item.id === projectB);
check("③a 折叠面板 = 接口读面命中的项目、顺序 = 组序首次出现顺序（全量 " + String(expectPanelOrder.length) + " 块）", panels0 !== null && panels0.map((item) => item.id).join(",") === expectPanelOrder.join(","), panels0 === null ? "null" : JSON.stringify(panels0.map((item) => item.id)));
check("③b 测试项目 A / B 成块、C 无命中任务不成块", panelsTest !== null && panelsTest.length === 2 && panelsTest.map((item) => item.id).sort().join(",") === [projectA, projectB].sort().join(",") && panels0.every((item) => item.id !== projectC), panelsTest === null ? "null" : JSON.stringify(panelsTest.map((item) => item.id)));
check("③c 收起态 = 项目名称 + 编号（+ 摘要），且未展开时表体不在 DOM", panelA0 !== null && panelA0.open === "false" && panelA0.expanded === "false" && panelA0.rows === 0 && panelA0.text.indexOf("回放·工作台A") >= 0 && panelA0.text.indexOf(codeA) >= 0 && panelA0.text.indexOf("共 5 项") >= 0 && panelA0.text.indexOf("已逾期 1") >= 0 && panelA0.text.indexOf("今日 1") >= 0 && panelA0.text.indexOf("未排期 1") >= 0, panelA0 === null ? "null" : JSON.stringify(panelA0));
check("③d B 面板收起态：项目名 + 编号 + 共 1 项", panelB0 !== null && panelB0.text.indexOf("回放·工作台B") >= 0 && panelB0.text.indexOf(codeB) >= 0 && panelB0.text.indexOf("共 1 项") >= 0, panelB0 === null ? "null" : JSON.stringify(panelB0));

check("③e 面板头常驻「进入项目」按钮（Push 232 · 业务口径「增加进入项目按钮」）：A / B 各一枚、href = #/project/{id}、不在展开收起的子节点里", panelA0 !== null && panelB0 !== null && panelA0.link === "#/project/" + projectA && panelB0.link === "#/project/" + projectB && panelA0.linkText === "进入项目" && panelB0.linkText === "进入项目" && panelA0.linkInToggle === false && panelB0.linkInToggle === false, panelA0 === null || panelB0 === null ? "null" : JSON.stringify([panelA0, panelB0].map((item) => [item.link, item.linkText, item.linkInToggle])));

// ---------- ④ 展开 A：任务表口径（Push 231：项目页任务表全 15 列） ----------
await clickSelector('[data-workspace-panel="' + projectA + '"] [data-workspace-panel-toggle]');
const expanded = await ev(panelsExpr());
const expandedA = expanded === null ? null : expanded.find((item) => item.id === projectA);
check("④a 点一下面板头 = 展开（data-open=true / aria-expanded=true / 表体出现）", expandedA !== null && expandedA.open === "true" && expandedA.expanded === "true" && expandedA.rows === 5, expandedA === null ? "null" : JSON.stringify(expandedA));
const fullReady = await waitFor("(function(){var node=document.querySelector(" + j('[data-workspace-task-table][data-workspace-task-full="true"]') + ");return node!==null;})()", 25000);
check("④a1 扩列回填完成（data-workspace-task-full=true；15 列数据源全部就绪）", fullReady === true, String(fullReady));
const rowsA = await ev(taskRowsExpr(projectA));
const expectedOrder = [tOverdue.id, tToday.id, tUpcoming.id, tFar.id, tUnscheduled.id].join(",");
check("④b 任务表 5 行、顺序 = 已逾期 → 今日 → 即将（+3 → +20 远期）→ 未排期（最急在前、未排期收尾）", rowsA !== null && rowsA.table === true && rowsA.rows.map((item) => item.id).join(",") === expectedOrder, rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.id)));
check("④c 分组签不展示（业务口径「这个不要展示」：行里不再挂已逾期 / 今日待办 / 即将到期色签；组序改由行序体现）", rowsA !== null && rowsA.rows.every((item) => item.group === "" && item.groupText === "" && item.title.indexOf("已逾期") < 0 && item.title.indexOf("今日待办") < 0 && item.title.indexOf("即将到期") < 0), rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => [item.group, item.groupText])));
check("④d 状态签 = 项目页同款胶囊（服务端展示态：已延期 / 待开始 / 进行中；远期与未排期 = 待开始）", rowsA !== null && rowsA.rows.map((item) => item.status).join("|") === "已延期|待开始|进行中|待开始|待开始" && rowsA.rows.map((item) => item.statusKey).join("|") === "overdue|pending|active|pending|pending", rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => [item.status, item.statusKey])));
check("④e 日期三列 = 项目页同款短日期胶囊（开始 / 预计 / 实际；空值落「—」）", rowsA !== null && rowsA.rows.map((item) => item.start).join("|") === [mdDate(START_OVERDUE), mdDate(START_TODAY), "—", "—", "—"].join("|") && rowsA.rows.map((item) => item.due).join("|") === [DUE_OVERDUE, TODAY, DUE_UPCOMING, DUE_FAR].map(mdDate).concat("—").join("|") && rowsA.rows.every((item) => item.doneDate === "—"), rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => [item.start, item.due, item.doneDate])));
check("④f 四格进度点 = 项目页同款（0 / 0 / 0.5 —— 即将任务 50% 档）", rowsA !== null && rowsA.rows.map((item) => item.dots).join("|") === "0|0|0.5|0|0", rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.dots)));
check("④g 紧急重要度列 = 高 / 中 / 低", rowsA !== null && rowsA.rows.map((item) => item.priority).join("|") === "高|中|低|—|—", rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.priority)));
check("④h 任务主列 = 名称 + 阶段 / 英文名小行（B 项目面板块段落不串行）", rowsA !== null && rowsA.rows[0].titleText === "回放·逾期任务" && rowsA.rows[0].title.indexOf("设计开发") >= 0 && rowsA.rows[2].title.indexOf("临时任务") >= 0 && rowsA.rows[3].titleText === "回放·远期任务" && rowsA.rows[3].title.indexOf("设计开发") >= 0 && rowsA.rows[4].titleText === "回放·未排期任务", rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.titleText)));
check("④j 任务负责人列 = 潘兴（远期那条为项目经理口径带入的 " + other.displayName + "）", rowsA !== null && rowsA.rows.map((item) => item.owners).join("|") === ["潘兴", "潘兴", "潘兴", other.displayName, "潘兴"].join("|"), rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.owners)));
check("④k 「是否按时交付」列 = 逾期未交付 / — / —（displayStatus=overdue 的红签）", rowsA !== null && rowsA.rows.map((item) => item.onTime).join("|") === "逾期未交付|—|—|—|—", rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.onTime)));
check("④i 反例不出现：他人项目任务（C）与已完成任务不进；远期 / 未排期按新口径照进（服务端裁决，页面照单渲染）", rowsA !== null && [tStranger.id, tDone.id].every((id) => rowsA.rows.every((item) => item.id !== id)) && rowsA.rows.some((item) => item.id === tFar.id) && rowsA.rows.some((item) => item.id === tUnscheduled.id), rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.id)));
// —— Push 231 扩列（业务口径「这些字段一个不能少」）：表头 15 列与项目页 TABLE_COLUMNS 全对齐 + 新列逐列对账
check("④l 表头 = 项目页任务表全 15 列（同序；「预计所需天数」窄列表头为空）", rowsA !== null && rowsA.heads.join("|") === TASK_HEAD_EXPECTED.join("|"), rowsA === null ? "null" : JSON.stringify(rowsA.heads));
check("④m 项目经理列 = 项目主数据责任人（A 项目 = 潘兴）", rowsA !== null && rowsA.rows.every((item) => item.manager === "潘兴"), rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.manager)));
check("④n 输出成果文件列 = 首枚名 + 「+N」（CAD图纸+1 / 验收单 / —）", rowsA !== null && rowsA.rows.map((item) => item.deliverable).join("|") === "CAD图纸+1|验收单|—|—|—", rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.deliverable)));
check("④o 文件列 = 「N 份 + 未定档 N」（逾期任务直传 1 份 draft；无文件落「—」）", rowsA !== null && rowsA.rows[0].files.indexOf("1 份") >= 0 && rowsA.rows[0].files.indexOf("未定档 1") >= 0 && rowsA.rows.slice(1).every((item) => item.files === "—"), rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.files)));
check("④p 项目进展描述列 = note 原文 / 「—」", rowsA !== null && rowsA.rows[0].note === "回放·进展描述：图纸已出，等待评审" && rowsA.rows.slice(1).every((item) => item.note === "—"), rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.note)));
check("④q 预计所需天数窄列 = 显式 5 / 推算 3（含首尾）/ 无开始日期落 0（项目页同口径）", rowsA !== null && rowsA.rows.map((item) => item.days).join("|") === "5|3|0|0|0", rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.days)));
check("④r 预计所需施工人数列 = 6 人 / 3 人 / —", rowsA !== null && rowsA.rows.map((item) => item.headcount).join("|") === "6 人|3 人|—|—|—", rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => item.headcount)));
check("④s 变更关联列 = 空单元格 / 「变更」琥珀签（今日任务挂 1 条）/ 空", rowsA !== null && rowsA.rows.map((item) => item.change).join("|") === "|变更|||" && rowsA.rows.map((item) => item.changeCount).join("|") === "0|1|0|0|0", rowsA === null ? "null" : JSON.stringify(rowsA.rows.map((item) => [item.change, item.changeCount])));
check("④t 扩列降级横幅不出现（两个项目的源接口都取到）", (await ev("document.querySelector(" + j("[data-workspace-task-partial]") + ") !== null")) === false, "partial=false");
await clickSelector('[data-workspace-panel="' + projectB + '"] [data-workspace-panel-toggle]');
const rowsB = await ev(taskRowsExpr(projectB));
check("④u 跨项目 B：1 行、项目经理 = 潘兴、吴孟杰（多值「、」连接）、其余扩列落「—」", rowsB !== null && rowsB.table === true && rowsB.rows.length === 1 && rowsB.rows[0].id === tB.id && rowsB.rows[0].manager === "潘兴、吴孟杰" && rowsB.rows[0].deliverable === "—" && rowsB.rows[0].files === "—" && rowsB.rows[0].note === "—" && rowsB.rows[0].headcount === "—" && rowsB.rows[0].changeCount === "0", rowsB === null ? "null" : JSON.stringify(rowsB.rows));
await clickSelector('[data-workspace-panel="' + projectB + '"] [data-workspace-panel-toggle]');

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
check("⑦b ?tab= 不认识的值落回缺省「我的任务」（地址不纠正，与 ?view= 同口径）", head3 !== null && head3.tabs[0].current === "page" && head3.tabs[1].current === null && head3.tabs[2].current === null, head3 === null ? "null" : JSON.stringify(head3.tabs.map((item) => item.current)));
await open("#/my-tasks", "[data-workspace-page]");
await clickSelector('[data-workspace-tab="tasks"]');
const head4 = await ev(headExpr());
check("⑦c 从「我提出的问题」点回「我的任务」→ 地址回到不带参数的 #/my-tasks", head4 !== null && head4.hash === "#/my-tasks" && head4.tabs[0].current === "page", head4 === null ? "null" : String(head4.hash));

// —— Push 232：「进入项目」按钮（面板头深链 → 项目详情「项目总览」）
const linkHref = await ev("(function(){var a=document.querySelector(" + j('[data-workspace-panel="' + projectA + '"] [data-workspace-project-link]') + ");return a===null?null:String(a.getAttribute(" + j("href") + "));})()");
check("⑦d 「进入项目」href = 该项目详情「项目总览」深链（#/project/{id}，缺省标签不落参数）", linkHref === "#/project/" + projectA, String(linkHref));
await clickSelector('[data-workspace-panel="' + projectA + '"] [data-workspace-project-link]');
const enteredDetail = await waitFor("window.location.hash === " + j("#/project/" + projectA) + " && document.querySelector(" + j("[data-maintabs]") + ") !== null", 25000);
check("⑦e 点「进入项目」= 打开项目详情（地址 #/project/{id}、顶部标签栏出现）", enteredDetail === true, String(enteredDetail));
await ev("window.history.back()");
const backToWorkspace = await waitFor("document.querySelector(" + j("[data-workspace-page]") + ") !== null && window.location.hash === " + j("#/my-tasks"), 25000);
check("⑦f 浏览器后退回工作台（#/my-tasks 原样恢复、页面还在）", backToWorkspace === true, String(backToWorkspace));

// ---------- ⑨ 醒目模式（Push 232 · 业务口径「同样增加醒目模式」） ----------
const focusCheckedExpr = "(function(){var wrap=document.querySelector(" + j("[data-workspace-focus-toggle]") + ");if(wrap===null){return null;}var box=wrap.querySelector(" + j("input") + ");return box===null?null:box.checked;})()";
const focusWrapExpr = "(function(){var wrap=document.querySelector(" + j("[data-workspace-focus-toggle]") + ");if(wrap===null){return null;}return {inNav:wrap.closest(" + j("[data-workspace-tabs]") + ")!==null,checked:(function(){var box=wrap.querySelector(" + j("input") + ");return box===null?null:box.checked;})()};})()";
const prefStartRes = await api("/api/v1/users/me/preferences");
const prefStart = prefStartRes.status === 200 && prefStartRes.json !== null && typeof prefStartRes.json.focusMode === "boolean" ? prefStartRes.json.focusMode : null;
const focus0 = await ev(focusWrapExpr);
check("⑨a 标签导航栏最右侧有「醒目模式」开关（同项目总览 / 问题追踪一枚；初值 = 账号偏好 focusMode）", focus0 !== null && focus0.inNav === true && prefStart !== null && focus0.checked === prefStart, focus0 === null ? "null" : JSON.stringify([focus0, prefStart]));
// 归一化到「关」（原值为开先点掉；本节最后恢复原值）
if (prefStart === true) {
  await clickSelector("[data-workspace-focus-toggle]");
  await waitFor(focusCheckedExpr + " === false", 15000);
}
await waitFor("document.querySelector(" + j('[data-workspace-panel="' + projectA + '"] [data-workspace-panel-toggle]') + ") !== null", 25000);
await ensurePanelOpen(projectA, true);
await waitFor("document.querySelector(" + j('[data-workspace-panel="' + projectA + '"] [data-workspace-task]') + ") !== null", 25000);
const focusOffRows = await ev(taskRowsExpr(projectA));
check("⑨b 关：任务表 = 白底行（hover 档）+ 状态胶囊照旧", focusOffRows !== null && focusOffRows.rows[0].rowClass.indexOf("hover:bg-zinc-50/80") >= 0 && focusOffRows.rows[0].statusClass.indexOf("bg-rose-100") >= 0, focusOffRows === null ? "null" : JSON.stringify([focusOffRows.rows[0].rowClass, focusOffRows.rows[0].statusClass]));
await clickSelector("[data-workspace-focus-toggle]");
const focusOnAttr = await waitFor("(function(){var t=document.querySelector(" + j('[data-workspace-panel="' + projectA + '"] [data-workspace-task-table]') + ");return t!==null&&t.getAttribute(" + j("data-workspace-task-focus") + ")===" + j("true") + ";})()", 20000);
const focusOnRows = await ev(taskRowsExpr(projectA));
check("⑨c 开：任务表整行铺状态底色（逾期 rose / 今日 sky / 即将 amber · 6% 档）+ 状态胶囊收口成深色字", focusOnAttr === true && focusOnRows !== null && focusOnRows.rows[0].rowClass.indexOf("bg-rose-500/[0.06]") >= 0 && focusOnRows.rows[1].rowClass.indexOf("bg-sky-500/[0.06]") >= 0 && focusOnRows.rows[2].rowClass.indexOf("bg-amber-500/[0.06]") >= 0 && focusOnRows.rows[0].statusClass.indexOf("text-rose-700") >= 0 && focusOnRows.rows[0].statusClass.indexOf("bg-rose-100") < 0, focusOnRows === null ? "null" : JSON.stringify([focusOnRows.rows.map((item) => item.rowClass), focusOnRows.rows.map((item) => item.statusClass)]));
let prefOn = null;
for (let attempt = 0; attempt < 20; attempt += 1) {
  prefOn = await api("/api/v1/users/me/preferences");
  if (prefOn.status === 200 && prefOn.json !== null && prefOn.json.focusMode === true) break;
  await sleep(300);
}
check("⑨d 偏好落库：单键 PATCH 后 GET /users/me/preferences 的 focusMode = true（按账号跨设备记忆）", prefOn !== null && prefOn.status === 200 && prefOn.json !== null && prefOn.json.focusMode === true, prefOn === null ? "null" : JSON.stringify(prefOn.json === null ? prefOn.status : prefOn.json.focusMode));
await clickSelector('[data-workspace-tab="raised"]');
await waitFor("document.querySelector(" + j('[data-workspace-panel="' + projectA + '"] [data-workspace-panel-toggle]') + ") !== null", 25000);
await ensurePanelOpen(projectA, true);
await waitFor("document.querySelector(" + j('[data-workspace-panel="' + projectA + '"] [data-workspace-issue]') + ") !== null", 25000);
const focusIssueRows = await ev(issueRowsExpr(projectA));
check("⑨e 切「我提出的问题」同款：未解决行 sky / 已完成行 emerald（6% 档）+ 状态签收口成深色字", focusIssueRows !== null && focusIssueRows.rows[0].rowClass.indexOf("bg-sky-500/[0.06]") >= 0 && focusIssueRows.rows[1].rowClass.indexOf("bg-emerald-500/[0.06]") >= 0 && focusIssueRows.rows[0].stateClass.indexOf("text-sky-700") >= 0 && focusIssueRows.rows[0].stateClass.indexOf("bg-sky-100") < 0, focusIssueRows === null ? "null" : JSON.stringify([focusIssueRows.rows.map((item) => item.rowClass), focusIssueRows.rows.map((item) => item.stateClass)]));
await clickSelector("[data-workspace-focus-toggle]");
const focusOffAttr = await waitFor("(function(){var t=document.querySelector(" + j('[data-workspace-panel="' + projectA + '"] [data-workspace-issue-table]') + ");return t!==null&&t.getAttribute(" + j("data-workspace-issue-focus") + ")===" + j("false") + ";})()", 20000);
const focusOffRows2 = await ev(issueRowsExpr(projectA));
check("⑨f 关：问题表回到白底行 + 状态签原样", focusOffAttr === true && focusOffRows2 !== null && focusOffRows2.rows[0].rowClass.indexOf("hover:bg-zinc-50/80") >= 0 && focusOffRows2.rows[0].stateClass.indexOf("bg-sky-100") >= 0, focusOffRows2 === null ? "null" : JSON.stringify([focusOffRows2.rows[0].rowClass, focusOffRows2.rows[0].stateClass]));
// 恢复账号偏好原值（回放不留痕）
if (prefStart === true) {
  await clickSelector("[data-workspace-focus-toggle]");
  await waitFor(focusCheckedExpr + " === true", 15000);
  let prefBack = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    prefBack = await api("/api/v1/users/me/preferences");
    if (prefBack.status === 200 && prefBack.json !== null && prefBack.json.focusMode === true) break;
    await sleep(300);
  }
  check("⑨g 回放收尾：账号偏好 focusMode 恢复原值 true（不留痕）", prefBack !== null && prefBack.status === 200 && prefBack.json !== null && prefBack.json.focusMode === true, prefBack === null ? "null" : JSON.stringify(prefBack.json === null ? prefBack.status : prefBack.json.focusMode));
} else {
  check("⑨g 回放收尾：账号偏好 focusMode 原值即 false，无需恢复", true, "false");
}

// ---------- ⑩ 折叠面板展开态记忆（Push 233 · 业务口径「这个下拉要有记忆」） ----------
const resetMemory = await patchOpenProjects({ tasks: [], raised: [] });
check("⑩a 前置：展开态偏好归零（GET 回读两个空数组）", resetMemory !== null && resetMemory.json.workspaceOpenProjects.tasks.length === 0 && resetMemory.json.workspaceOpenProjects.raised.length === 0, resetMemory === null ? "null" : JSON.stringify(resetMemory.json.workspaceOpenProjects));
await open("#/my-tasks", "[data-workspace-page]");
await waitFor("document.querySelector(" + j('[data-workspace-panel="' + projectA + '"]') + ") !== null", 25000);
const memory0A = await ev(panelOpenOf(projectA));
const memory0B = await ev(panelOpenOf(projectB));
check("⑩b 偏好为空：两个折叠面板默认全收起（data-open=false、无表格行）", memory0A !== null && memory0A.open === "false" && memory0A.rows === 0 && memory0B !== null && memory0B.open === "false" && memory0B.rows === 0, JSON.stringify([memory0A, memory0B]));
await clickSelector('[data-workspace-panel="' + projectA + '"] [data-workspace-panel-toggle]');
await waitFor("document.querySelector(" + j('[data-workspace-panel="' + projectA + '"] [data-workspace-task]') + ") !== null", 25000);
const memory1A = await ev(panelOpenOf(projectA));
const memory1B = await ev(panelOpenOf(projectB));
check("⑩c 点开 A：A 展开（任务行出现）、B 仍收起", memory1A !== null && memory1A.open === "true" && memory1A.rows === 5 && memory1B !== null && memory1B.open === "false" && memory1B.rows === 0, JSON.stringify([memory1A, memory1B]));
const savedTasks = await waitOpenProjects({ tasks: [projectA], raised: [] });
check("⑩d 展开即单键 PATCH 落库：workspaceOpenProjects.tasks = [A]、raised 仍空（按账号跨设备记忆）", savedTasks !== null && savedTasks.json.workspaceOpenProjects.tasks.length === 1 && savedTasks.json.workspaceOpenProjects.tasks[0] === projectA && savedTasks.json.workspaceOpenProjects.raised.length === 0, savedTasks === null ? "null" : JSON.stringify(savedTasks.json.workspaceOpenProjects));
await open("#/my-tasks", "[data-workspace-page]");
await waitFor("document.querySelector(" + j('[data-workspace-panel="' + projectA + '"] [data-workspace-task]') + ") !== null", 25000);
const memory2A = await ev(panelOpenOf(projectA));
const memory2B = await ev(panelOpenOf(projectB));
check("⑩e 刷新（about:blank 后整页重开）后记忆生效：A 仍展开、B 仍收起", memory2A !== null && memory2A.open === "true" && memory2A.rows === 5 && memory2B !== null && memory2B.open === "false" && memory2B.rows === 0, JSON.stringify([memory2A, memory2B]));
await clickSelector('[data-workspace-tab="raised"]');
await waitFor("document.querySelector(" + j("[data-workspace-issues]") + ") !== null", 25000);
const memory3A = await ev(panelOpenOf(projectA));
const memory3B = await ev(panelOpenOf(projectB));
check("⑩f 切「我提出的问题」：两面板全收起（tasks 的展开不串到 raised —— 两标签各自独立记忆）", memory3A !== null && memory3A.open === "false" && memory3A.rows === 0 && memory3B !== null && memory3B.open === "false" && memory3B.rows === 0, JSON.stringify([memory3A, memory3B]));
await clickSelector('[data-workspace-panel="' + projectB + '"] [data-workspace-panel-toggle]');
await waitFor("document.querySelector(" + j('[data-workspace-panel="' + projectB + '"] [data-workspace-issue]') + ") !== null", 25000);
const savedRaised = await waitOpenProjects({ tasks: [projectA], raised: [projectB] });
check("⑩g 展开 raised 的 B：落库 tasks 仍 [A]、raised = [B]（同一对象两键互不覆盖）", savedRaised !== null && JSON.stringify(savedRaised.json.workspaceOpenProjects) === JSON.stringify({ tasks: [projectA], raised: [projectB] }), savedRaised === null ? "null" : JSON.stringify(savedRaised.json.workspaceOpenProjects));
await clickSelector('[data-workspace-tab="tasks"]');
await waitFor("document.querySelector(" + j('[data-workspace-panel="' + projectA + '"] [data-workspace-task]') + ") !== null", 25000);
const memory4B = await ev(panelOpenOf(projectB));
check("⑩h 切回「我的任务」：A 仍展开（记忆未丢）、B 仍收起（raised 的展开不串台）", memory4B !== null && memory4B.open === "false" && memory4B.rows === 0, JSON.stringify(memory4B));
await clickSelector('[data-workspace-panel="' + projectA + '"] [data-workspace-panel-toggle]');
await waitFor(panelOpenOf(projectA) + ".open === " + j("false"), 20000);
const memory5A = await ev(panelOpenOf(projectA));
const collapsedSaved = await waitOpenProjects({ tasks: [], raised: [projectB] });
check("⑩i 收起 A：界面立即收起 + 落库 tasks 清空、raised 仍保留 [B]（「收起」也被记住）", memory5A !== null && memory5A.open === "false" && memory5A.rows === 0 && collapsedSaved !== null && JSON.stringify(collapsedSaved.json.workspaceOpenProjects) === JSON.stringify({ tasks: [], raised: [projectB] }), JSON.stringify([memory5A, collapsedSaved === null ? "null" : collapsedSaved.json.workspaceOpenProjects]));
await open("#/my-tasks", "[data-workspace-page]");
await waitFor("document.querySelector(" + j('[data-workspace-panel="' + projectA + '"]') + ") !== null", 25000);
const memory6A = await ev(panelOpenOf(projectA));
const memory6B = await ev(panelOpenOf(projectB));
check("⑩j 收起后刷新：两面板保持全收起（空数组 = 全收起，不是「无记录 = 默认展开」）", memory6A !== null && memory6A.open === "false" && memory6A.rows === 0 && memory6B !== null && memory6B.open === "false" && memory6B.rows === 0, JSON.stringify([memory6A, memory6B]));
const memoryRestored = await patchOpenProjects(memoryOriginal);
check("⑩k 回放收尾：账号偏好 workspaceOpenProjects 恢复原值（不留痕）", memoryRestored !== null && JSON.stringify(memoryRestored.json.workspaceOpenProjects) === JSON.stringify(memoryOriginal), memoryRestored === null ? "null" : JSON.stringify([memoryRestored.json.workspaceOpenProjects, memoryOriginal]));

// ---------- ⑪ 「我的计划」标签：导航栏 + 路由就位（Push 234 · 业务口径「增加一个我的计划页面」→「你只要把导航栏设计好 后续详细设计再说」） ----------
// 本刀只验三件：第三枚标签在导航栏、点击 / 深链走 `?tab=plan`、页内 = 登记卡（内容待详细设计，数据面 / 契约本刀不动）。
await open("#/my-tasks", "[data-workspace-page]");
await waitFor("document.querySelector(" + j('[data-workspace-panel="' + projectA + '"]') + ") !== null", 25000);
const headPlan0 = await ev(headExpr());
check("⑪a 「我的计划」是第三枚标签（三枚都在：我的任务 / 我提出的问题 / 我的计划；无图标）", headPlan0 !== null && headPlan0.tabs.length === 3 && headPlan0.tabs[2].key === "plan" && headPlan0.tabs[2].text === "我的计划", headPlan0 === null ? "null" : JSON.stringify([headPlan0.tabs.length, headPlan0.tabs[2]?.text ?? null]));
await clickSelector('[data-workspace-tab="plan"]');
const headPlan1 = await ev(headExpr());
check("⑪b 点「我的计划」→ 地址写回 ?tab=plan + 选中态转移（replace、可刷新 / 可分享）", headPlan1 !== null && headPlan1.hash === "#/my-tasks?tab=plan" && headPlan1.tabs[2].current === "page" && headPlan1.tabs[0].current === null && headPlan1.tabs[1].current === null, headPlan1 === null ? "null" : JSON.stringify([headPlan1.hash, headPlan1.tabs.map((item) => item.current)]));
const planCard = await ev("(function(){var n=document.querySelector(" + j("[data-workspace-plan]") + ");if(n===null){return null;}return {text:n.textContent.trim(),tables:n.querySelectorAll(" + j("[data-workspace-task-table],[data-workspace-issue-table]") + ").length};})()");
check("⑪c 「我的计划」页 = 登记卡（「还没开工 / 待详细设计」；无任务 / 问题表 —— 详细设计后放）", planCard !== null && planCard.text.indexOf("还没开工") >= 0 && planCard.text.indexOf("详细设计") >= 0 && planCard.tables === 0, planCard === null ? "null" : JSON.stringify(planCard));
await open("#/my-tasks?tab=plan", "[data-workspace-plan]");
const headPlan2 = await ev(headExpr());
check("⑪d 深链 #/my-tasks?tab=plan 直接打开 = 「我的计划」选中（刷新 / 收藏 / 分享同款）", headPlan2 !== null && headPlan2.tabs[2].current === "page" && headPlan2.hash === "#/my-tasks?tab=plan", headPlan2 === null ? "null" : JSON.stringify([headPlan2.tabs.map((item) => item.current), headPlan2.hash]));
await clickSelector('[data-workspace-tab="tasks"]');
const headPlan3 = await ev(headExpr());
check("⑪e 点回「我的任务」→ 地址回到不带参数的 #/my-tasks（原两标签口径不变）", headPlan3 !== null && headPlan3.hash === "#/my-tasks" && headPlan3.tabs[0].current === "page", headPlan3 === null ? "null" : JSON.stringify([headPlan3.hash, headPlan3.tabs.map((item) => item.current)]));

// ---------- ⑫ 标签导航栏吸顶（Push 235 · 业务口径「任务模版和我的任务都要做吸顶效果」） ----------
// 工作台默认内容不足一屏、吸顶滚不起来 —— 先补 16 条「今日」任务把 A 面板撑高，再把视口压到 560 当滚动空间；
// 收尾 ⑧ 照旧逐条软删任务、随项目物理删清零（本段不留痕：展开态偏好跑完再恢复原值）。
for (let index = 1; index <= 16; index += 1) {
  await addTask(projectA, { stageKey: "design", title: "回放·吸顶撑高-" + String(index), ownerIds: [me.id], plannedEnd: TODAY, priority: "低" });
}
const wsSticky = await api("/api/v1/workspace");
const stickyTodayTest = wsSticky.json === null ? -1 : inTest(wsSticky.json.myTasks.today).length;
const stickyTodayAll = wsSticky.json === null ? -1 : wsSticky.json.myTasks.today.length;
check("⑫a 夹具：16 条「今日」任务进工作台读面（测试项目今日组 2 + 16 = 18）", stickyTodayTest === 18, String(stickyTodayTest) + "（全读面今日 " + String(stickyTodayAll) + " 条）");
await page.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 560, deviceScaleFactor: 1, mobile: false });
await open("#/my-tasks", "[data-workspace-page]");
await waitFor("document.querySelector(" + j('[data-workspace-panel="' + projectA + '"]') + ") !== null", 25000);
await ensurePanelOpen(projectA, true);
const navSlot0 = await ev(stickyRect("[data-workspace-tabs]"));
check("⑫b 标签导航栏 = sticky / z 20 / 站灰底（α 0.95）+ 毛玻璃 / 自然位在顶栏下沿（top 64~65.5，滚动后钉到 64）", navSlot0 !== null && navSlot0.position === "sticky" && navSlot0.top >= 64 && navSlot0.top <= 65.5 && navSlot0.zIndex === "20" && navSlot0.bg.indexOf("0.95") >= 0 && navSlot0.blur.indexOf("blur") >= 0, navSlot0 === null ? "null" : JSON.stringify(navSlot0));
const room235 = await ev("(function(){return Math.round((document.documentElement.scrollHeight - window.innerHeight)*100)/100;})()");
check("⑫c 页面可滚动量足够（≥ 400px —— 吸顶要真滚起来才验得到）", typeof room235 === "number" && room235 >= 400, String(room235));
await ev("window.scrollTo(0, 420)");
await sleep(400);
const scrolled235 = await ev("window.scrollY");
check("⑫d 滚动实际发生（scrollY ≥ 400）", scrolled235 >= 400, String(scrolled235));
const navSlot1 = await ev(stickyRect("[data-workspace-tabs]"));
check("⑫e 滚动后导航栏钉在顶栏正下方（top = 64；栏高 = 59 = pt-3 12 + 标签 46 + 底边 1）", navSlot1 !== null && Math.abs(navSlot1.top - 64) <= 0.5 && Math.abs(navSlot1.height - 59) <= 1, navSlot1 === null ? "null" : JSON.stringify([navSlot1.top, navSlot1.height]));
const clientW235 = await ev("document.documentElement.clientWidth");
check("⑫f 横幅铺满行宽（-mx-6 抵消后 left = 0 / right = 视口可用宽 clientWidth，扣纵向滚动条；页面不因此横向滚动）", navSlot1 !== null && Math.abs(navSlot1.left) <= 0.5 && Math.abs(navSlot1.right - clientW235) <= 0.5 && (await ev("document.documentElement.scrollWidth")) <= clientW235 + 1, navSlot1 === null ? "null" : JSON.stringify([navSlot1.left, navSlot1.right, clientW235]));
const inBar = await ev("(function(){var nav=document.querySelector(" + j("[data-workspace-tabs]") + ");if(nav===null){return null;}var r=nav.getBoundingClientRect();var tabs=nav.querySelectorAll(" + j("[data-workspace-tab]") + ");var focus=nav.querySelector(" + j("[data-workspace-focus-toggle]") + ");var ok=true;for(var i=0;i<tabs.length;i+=1){var b=tabs[i].getBoundingClientRect();if(b.height<=0||b.top<r.top-0.5||b.bottom>r.bottom+0.5){ok=false;}}var fb=focus===null?null:focus.getBoundingClientRect();return {ok:ok,tabs:tabs.length,focusIn:fb!==null&&fb.height>0&&fb.top>=r.top-0.5&&fb.bottom<=r.bottom+0.5};})()");
check("⑫g 滚动后三枚标签 + 醒目模式开关都还在栏内（栏高兜得住、不吞字）", inBar !== null && inBar.ok === true && inBar.tabs === 3 && inBar.focusIn === true, JSON.stringify(inBar));
const hit235 = await ev("(function(){var tabs=document.querySelectorAll(" + j("[data-workspace-tab]") + ");for(var i=0;i<tabs.length;i+=1){if(tabs[i].getAttribute(" + j("aria-current") + ")===" + j("page") + "){var r=tabs[i].getBoundingClientRect();var el=document.elementFromPoint(Math.round(r.left+r.width/2),Math.round(r.top+r.height/2));return el!==null&&(el===tabs[i]||tabs[i].contains(el));}}return null;})()");
check("⑫h 吸顶状态下选中标签仍是命中元素（可点、不被浮层盖住）", hit235 === true, String(hit235));
await clickSelector('[data-workspace-tab="raised"]');
await waitFor("window.location.hash === " + j("#/my-tasks?tab=raised"), 15000);
check("⑫i 吸顶状态下点「我提出的问题」→ 路由照常写回（点击穿透到按钮本体）", (await ev("window.location.hash")) === "#/my-tasks?tab=raised", String(await ev("window.location.hash")));
await clickSelector('[data-workspace-tab="tasks"]');
await waitFor("window.location.hash === " + j("#/my-tasks"), 15000);
await waitFor("(function(){return document.documentElement.scrollHeight - window.innerHeight >= 400;})()", 20000);
await ev("window.scrollTo(0, 420)");
await sleep(400);
const scrolledBack = await ev("window.scrollY");
const navSlot3 = await ev(stickyRect("[data-workspace-tabs]"));
check("⑫j 切回「我的任务」再滚动：导航栏重新钉在 64（切标签不破坏吸顶）", scrolledBack >= 300 && navSlot3 !== null && Math.abs(navSlot3.top - 64) <= 0.5, JSON.stringify([scrolledBack, navSlot3 === null ? null : navSlot3.top]));
await ev("window.scrollTo(0, 0)");
await sleep(300);
const navSlot4 = await ev(stickyRect("[data-workspace-tabs]"));
check("⑫k 滚回顶部：导航栏回到自然位（top 64~65.5，滚动全程零跳变 / 零接缝）", navSlot4 !== null && navSlot4.top >= 64 && navSlot4.top <= 65.5, navSlot4 === null ? "null" : JSON.stringify(navSlot4.top));
await page.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
const restored235 = await patchOpenProjects(memoryOriginal);
check("⑫l 回放收尾：账号偏好 workspaceOpenProjects 恢复原值（⑫ 的展开操作不留痕）", restored235 !== null && JSON.stringify(restored235.json.workspaceOpenProjects) === JSON.stringify(memoryOriginal), restored235 === null ? "null" : JSON.stringify(restored235.json.workspaceOpenProjects));
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
await purgeProjectFiles(projectC);
const delC = (await db.query("select version from projects where id = $1", [projectC])).rows[0];
const goneC = delC === undefined ? { status: 0 } : await api("/api/v1/projects/" + projectC, "DELETE", undefined, { "If-Match": String(delC.version) });
check("⑧c2 删临时项目 C（物理删 200）", goneC.status === 200, String(goneC.status));
const goneRead = await api("/api/v1/projects/" + projectA);
check("⑧d 删完读面 404（真删，不是软删留档）", goneRead.status === 404, String(goneRead.status));
await db.query("update sessions set revoked_at = now() where token_hash = any($1) or id_token = $2", [[sha256(me.token), sha256(other.token)], "px-m6-workspace-replay"]);
const residue = (await db.query(
  "select (select count(*) from projects where code like $1) as projects, (select count(*) from tasks where project_id = any($2)) as tasks, (select count(*) from daily_reports where project_id = any($2)) as reports, (select count(*) from issues where project_id = any($2)) as issues, (select count(*) from sessions where id_token = $3 and revoked_at is null) as sessions",
  ["PX-M6WS-%", [projectA, projectB, projectC], "px-m6-workspace-replay"],
)).rows[0];
check("⑧e 库内零残留（项目 / 任务 / 日报 / 问题 / 未撤销会话 全 0）", Number(residue.projects) === 0 && Number(residue.tasks) === 0 && Number(residue.reports) === 0 && Number(residue.issues) === 0 && Number(residue.sessions) === 0, JSON.stringify(residue));
await db.end();

const failed = checks.filter((ok) => ok !== true).length;
console.log("");
console.log("—— 汇总：" + String(checks.length - failed) + " / " + String(checks.length) + " 通过" + (failed === 0 ? "（全过）" : "（" + String(failed) + " 项失败）"));
process.exitCode = failed === 0 ? 0 : 1;
