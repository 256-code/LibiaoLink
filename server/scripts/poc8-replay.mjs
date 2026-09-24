#!/usr/bin/env node
/**
 * PoC-8 真机回放（h8 · S6·工作日历 · 团队分工 §6）：工作日历 D5 —— 日历维护（D5-01）/ 顺延规则（D5-02）/ T-1·T+1（D5-03）。
 *
 * 真机（真 PG + 真 api）验到的部分：
 *   日历维护（D5-01）：读 = 登录即可（某年日历 / 单日判定 / 顺延配置）；写 = 仅管理员（calendar.manage）——
 *     受限账号设置例外 403 且落 denied 留痕（对象与写入侧同形：calendar_day + 业务日期）；
 *     管理员 PUT 幂等 upsert（重复设置同一天 200 且不产生重复行），DELETE 回到默认规则，删不存在的例外 404。
 *   顺延（D5-02）：非工作日按方向移动到最近工作日（forward / backward 两向、skipped 逐条返回）；
 *     顺延开关两态 —— settings.reminderShiftEnabled=false 时同一入参保留假期内日期，=true（或 shift=on 覆盖）时顺延到节后工作日。
 *   T-1/T+1（D5-03）：自然日偏移 + 顺延 + 08:00 时刻（UTC 时间戳）；以任务当前日期实时求值（同一基准重复请求结果稳定、无缓存）。
 *   审计（h7 复用）：calendar_day（对象 id = 业务日期）与 calendar_settings（对象 id = default）的字段级留痕可按对象检索。
 *
 * 数据隔离：合成日历落在 2099 年（不与真实业务日历冲突），回放结束硬删（api 角色对 audit_logs 无 DELETE，用 migrator 连接）。
 * 前置：真 PG（DATABASE_URL）+ 真 api（BASE_URL，**须以 PERMISSION_ENFORCED=true 启动** —— 本脚本验的是 ADR-011 判定语义；
 *      一期默认 false = 不判权限时受限账号也是等效管理员，S0 守卫会直接失败并给出重启指引）。
 * 用法：cd server && node scripts/poc8-replay.mjs [--out <报告.md>] [--json <证据.json>] [--actor <userId>] [--keep]
 * 退出码：断言全过 = 0，否则 = 1（可当门禁用）。
 */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { Client } from "pg";

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.baseUrl ?? process.env.POC8_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3011";
const DATABASE_URL = args.databaseUrl ?? process.env.DATABASE_URL ?? "postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink";
const CSRF = randomBytes(16).toString("hex");
const YEAR = 2099;
/** 合成日历（2099 年 10 月与 2026 年 10 月同形）：10-01（周四）~ 10-07（周三）放假 + 10-10（周六）调休上班。 */
const HOLIDAYS = ["2099-10-01", "2099-10-02", "2099-10-03", "2099-10-04", "2099-10-05", "2099-10-06", "2099-10-07"];
const MAKEUP = "2099-10-10";
const HOLIDAY_NAME = "PoC-8 合成假期";
const MAKEUP_NAME = "PoC-8 调休上班";
const report = [];
const evidence = { steps: [] };
let failures = 0;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") out.out = argv[++i];
    else if (item === "--json") out.json = argv[++i];
    else if (item === "--actor") out.actor = argv[++i];
    else if (item === "--base-url") out.baseUrl = argv[++i];
    else if (item === "--database-url") out.databaseUrl = argv[++i];
    else if (item === "--keep") out.keep = true;
  }
  return out;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function truncate(value, max = 300) {
  const text = JSON.stringify(value);
  return text === undefined ? "undefined" : text.length > max ? text.slice(0, max) + "…" : text;
}

function caller(token) {
  return async function call(method, path, body, extraHeaders = {}) {
    const response = await fetch(BASE_URL + path, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: "ll_sid=" + token + "; ll_csrf=" + CSRF,
        "x-csrf-token": CSRF,
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text === "" ? null : JSON.parse(text); } catch { parsed = { raw: text.slice(0, 400) }; }
    return { status: response.status, body: parsed };
  };
}

function check(id, title, expected, actual, ok, note = "", fatal = true) {
  if (!ok) failures += 1;
  const line = (ok ? "| PASS | " : "| FAIL | ") + id + " | " + title + " |";
  report.push(line);
  report.push("  - 期望：" + expected);
  report.push("  - 实际：" + actual);
  if (note !== "") report.push("  - 说明：" + note);
  evidence.steps.push({ id, title, expected, actual, ok, note });
  process.stdout.write(line + "\n");
  if (!ok && fatal) throw new Error("PoC-8 回放失败（" + id + "）：" + title);
}

async function sqlCount(query, params) {
  const rows = (await db.query(query, params)).rows;
  return rows[0] === undefined ? 0 : Number(rows[0].n);
}

async function waitForCount(query, params, atLeast, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let last = await sqlCount(query, params);
  while (last < atLeast && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    last = await sqlCount(query, params);
  }
  return last;
}

const DAY_VIEW_SQL = "select count(*)::int as n from calendar_days where date = any($1::date[])";

const cleanup = { adminId: null, actorId: null, tokens: [], startedAt: new Date(), settingsBefore: null };
let db;
let adminCall;
let actorCall;

try {
  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  const health = await fetch(BASE_URL + "/healthz").then((response) => response.status).catch(() => 0);
  if (health !== 200) throw new Error("api 不可用（" + BASE_URL + "/healthz → " + health + "）；先起 api 再跑本脚本");

  // ---------- 会话：管理员 + 受限账号（跑完删除） ----------
  const adminRow = (await db.query("select u.id, u.display_name from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where r.code = $$admin$$ and u.status = $$active$$ order by u.id limit 1")).rows[0];
  if (adminRow === undefined) throw new Error("找不到可用的管理员账号（roles.code = admin）");
  const actorRow = args.actor !== undefined
    ? (await db.query("select id, username from users where id = $1 and status = $$active$$", [args.actor])).rows[0]
    : (await db.query("select u.id, u.username from users u where u.status = $$active$$ and u.id <> $1 and not exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id and r.code = $$admin$$) order by (select count(*) from user_roles ur2 where ur2.user_id = u.id), u.username limit 1", [adminRow.id])).rows[0];
  if (actorRow === undefined) throw new Error("找不到可用的受限账号（--actor <userId> 可指定）");
  cleanup.adminId = adminRow.id;
  cleanup.actorId = actorRow.id;

  const adminToken = "poc8-admin-" + randomBytes(12).toString("hex");
  const actorToken = "poc8-actor-" + randomBytes(12).toString("hex");
  cleanup.tokens = [adminToken, actorToken];
  for (const pair of [[adminToken, adminRow.id, "poc8-replay-admin"], [actorToken, actorRow.id, "poc8-replay-actor"]]) {
    await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(hours => 2))", [sha256(pair[0]), pair[1], pair[2]]);
  }
  adminCall = caller(adminToken);
  actorCall = caller(actorToken);

  const meAdmin = await adminCall("GET", "/api/v1/permissions/me");
  const adminKeys = meAdmin.body?.permissions?.permissionKeys ?? [];
  check("S1", "管理员会话（calendar.manage 基准账号）", "200 + 键位含 calendar.manage", meAdmin.status + " " + truncate({ roles: meAdmin.body?.permissions?.roleCodes, hasCalendar: adminKeys.includes("calendar.manage") }, 160), meAdmin.status === 200 && adminKeys.includes("calendar.manage"), "账号 " + adminRow.display_name + "（" + adminRow.id + "）");

  const meActor = await actorCall("GET", "/api/v1/permissions/me");
  const actorKeys = meActor.body?.permissions?.permissionKeys ?? [];
  // 前置守卫（Push 178 · PERMISSION_ENFORCED）：本脚本的 403 / 记录级断言验证的是 ADR-011 判定，
  // 目标 api 须以 PERMISSION_ENFORCED=true 启动；一期默认 false = 不判权限（受限账号也是等效管理员）。
  const actorScopes = meActor.body?.permissions?.dataScopes ?? [];
  check("S0", "前置：目标 api 处于「按 ADR-011 判定」模式（PERMISSION_ENFORCED=true）", "受限账号 dataScopes 不含 all", "dataScopes=" + truncate(actorScopes, 80), meActor.status === 200 && !actorScopes.includes("all"), "一期「不判权限」口径下请先以 PERMISSION_ENFORCED=true 重启 api 再跑本脚本");
  check("S2", "受限账号会话（越权拒绝基准账号）", "200 + 不含 calendar.manage", meActor.status + " " + truncate({ roles: meActor.body?.permissions?.roleCodes, keys: actorKeys.length }, 160), meActor.status === 200 && !actorKeys.includes("calendar.manage"), "账号 " + actorRow.username + "（" + actorRow.id + "）；--actor 可指定");

  cleanup.settingsBefore = (await db.query("select reminder_shift_enabled, shift_direction from calendar_settings where id = true")).rows[0] ?? null;
  check("S3", "顺延配置单行存在（迁移 0014 默认行）", "1 行（reminder_shift_enabled / shift_direction）", truncate(cleanup.settingsBefore, 160), cleanup.settingsBefore !== null, "回放结束恢复为回放前的值");

  // ---------- 读路径（登录即可，D5-01 / D5-03） ----------
  const yearBefore = await adminCall("GET", "/api/v1/calendar/days?year=" + YEAR);
  const beforeDates = (yearBefore.body?.days ?? []).map((day) => day.date);
  check("K1", "某年日历（登录即可读）：合成日期尚未登记", "200 + 不含 " + HOLIDAYS[0] + " 等合成日期", yearBefore.status + " days=" + beforeDates.length, yearBefore.status === 200 && !beforeDates.includes(HOLIDAYS[0]), "年度查询：GET /api/v1/calendar/days?year=" + YEAR);

  const actorRead = await actorCall("GET", "/api/v1/calendar/day?date=2099-10-08");
  check("K1b", "单日判定（登录即可读）：周四 = 默认工作日", "200 + kind=workday + isWorkday=true + source=default", actorRead.status + " " + truncate(actorRead.body, 160), actorRead.status === 200 && actorRead.body?.kind === "workday" && actorRead.body?.isWorkday === true && actorRead.body?.source === "default", "受限账号也可读（任务日期提示与规则引擎同口径）");

  const actorSettings = await actorCall("GET", "/api/v1/calendar/settings");
  check("K1c", "顺延配置（登录即可读）", "200 + reminderShiftEnabled / shiftDirection 字段齐全", actorSettings.status + " " + truncate(actorSettings.body, 160), actorSettings.status === 200 && typeof actorSettings.body?.reminderShiftEnabled === "boolean" && (actorSettings.body?.shiftDirection === "forward" || actorSettings.body?.shiftDirection === "backward"));

  // ---------- 写 = 仅管理员（D5-01） ----------
  const actorWrite = await actorCall("PUT", "/api/v1/calendar/days/2099-10-08", { dayType: "holiday", name: "越权设置" });
  check("K2", "写 = 仅管理员：受限账号设置例外 403", "403 FORBIDDEN", actorWrite.status + " " + truncate(actorWrite.body, 140), actorWrite.status === 403 && actorWrite.body?.code === "FORBIDDEN");

  const deniedAfter = await waitForCount("select count(*)::int as n from audit_logs where result = $$denied$$ and actor_id = $1 and object_type = $$calendar_day$$ and object_id = $2 and occurred_at >= $3", [actorRow.id, "2099-10-08", cleanup.startedAt], 1);
  check("K2b", "越权留痕（按对象检索）：calendar_day + 业务日期", "≥1 行（actorId 受限账号 + objectId=2099-10-08）", "实际 " + deniedAfter, deniedAfter >= 1, "路径 → 对象解析：/calendar/days/{date} → calendar_day / {date}（audit-path.ts，异步补写最多等 3s）", false);

  const putStatuses = [];
  for (const date of HOLIDAYS) {
    const response = await adminCall("PUT", "/api/v1/calendar/days/" + date, { dayType: "holiday", name: HOLIDAY_NAME, note: "回放数据" });
    putStatuses.push(response.status);
  }
  const makeupPut = await adminCall("PUT", "/api/v1/calendar/days/" + MAKEUP, { dayType: "makeup_workday", name: MAKEUP_NAME });
  const yearAfter = await adminCall("GET", "/api/v1/calendar/days?year=" + YEAR);
  const afterDates = (yearAfter.body?.days ?? []).map((day) => day.date);
  check("K3", "管理员设置例外（PUT 幂等 upsert）：响应为更新后的整年日历", "全部 200 + 整年日历含 7 个假期日与调休日", truncate({ statuses: putStatuses, makeupStatus: makeupPut.status, days: afterDates }, 220), putStatuses.every((status) => status === 200) && makeupPut.status === 200 && HOLIDAYS.every((date) => afterDates.includes(date)) && afterDates.includes(MAKEUP));

  const holidayView = await adminCall("GET", "/api/v1/calendar/day?date=" + HOLIDAYS[0]);
  check("K4", "单日判定：放假不是工作日（例外优先，带名称）", "kind=holiday + isWorkday=false + name=" + HOLIDAY_NAME, truncate(holidayView.body, 180), holidayView.status === 200 && holidayView.body?.kind === "holiday" && holidayView.body?.isWorkday === false && holidayView.body?.name === HOLIDAY_NAME && holidayView.body?.source === "calendar");

  const makeupView = await adminCall("GET", "/api/v1/calendar/day?date=" + MAKEUP);
  check("K5", "单日判定：调休上班（周六补班）= 工作日", "kind=makeup_workday + isWorkday=true", truncate(makeupView.body, 180), makeupView.status === 200 && makeupView.body?.kind === "makeup_workday" && makeupView.body?.isWorkday === true);

  // ---------- 顺延（D5-02 金标） ----------
  const forward = await adminCall("GET", "/api/v1/calendar/shift?date=2099-10-02&direction=forward");
  check("K6", "顺延到之后最近工作日：假期中跳过后回到 10-08", "date=2099-10-08 + shifted=true + skipped 6 天", truncate(forward.body, 260), forward.status === 200 && forward.body?.date === "2099-10-08" && forward.body?.shifted === true && (forward.body?.skipped ?? []).length === 6 && forward.body?.baseKind === "holiday" && forward.body?.baseIsWorkday === false);

  const backward = await adminCall("GET", "/api/v1/calendar/shift?date=2099-10-02&direction=backward");
  check("K7", "提前到之前最近工作日：假期前移回 09-30", "date=2099-09-30 + shifted=true + skipped=[10-02,10-01]", truncate(backward.body, 240), backward.status === 200 && backward.body?.date === "2099-09-30" && backward.body?.shifted === true && (backward.body?.skipped ?? []).join(",") === "2099-10-02,2099-10-01");

  const stayPut = await adminCall("GET", "/api/v1/calendar/shift?date=2099-10-09");
  check("K8", "已是工作日原样返回（shifted=false，无需顺延）", "date=2099-10-09 + shifted=false + skipped=[]", truncate(stayPut.body, 200), stayPut.status === 200 && stayPut.body?.date === "2099-10-09" && stayPut.body?.shifted === false && (stayPut.body?.skipped ?? []).length === 0 && stayPut.body?.baseIsWorkday === true);

  // ---------- T-1 / T+1（D5-03 金标） ----------
  const tMinusOne = await adminCall("GET", "/api/v1/calendar/offset?date=2099-10-09&days=-1&shift=inherit");
  check("K9", "T-1 命中：10-09 的前一天（10-08）是工作日，不顺延", "rawDate=date=2099-10-08 + kind=workday + at=null", truncate(tMinusOne.body, 220), tMinusOne.status === 200 && tMinusOne.body?.date === "2099-10-08" && tMinusOne.body?.rawDate === "2099-10-08" && tMinusOne.body?.shifted === false && tMinusOne.body?.kind === "workday" && tMinusOne.body?.at === null);

  const shiftedOn = await adminCall("GET", "/api/v1/calendar/offset?date=2099-10-09&days=-7&time=08:00&shift=inherit");
  check("K10", "节假日顺延开：T-7 落到假期 → 顺延到 10-08 08:00（UTC 00:00）", "date=2099-10-08 + shifted=true + at=2099-10-08T00:00:00.000Z", truncate(shiftedOn.body, 240), shiftedOn.status === 200 && shiftedOn.body?.rawDate === "2099-10-02" && shiftedOn.body?.date === "2099-10-08" && shiftedOn.body?.shifted === true && shiftedOn.body?.shiftDirection === "forward" && shiftedOn.body?.at === "2099-10-08T00:00:00.000Z");

  const settingsOff = await adminCall("PUT", "/api/v1/calendar/settings", { reminderShiftEnabled: false });
  const shiftedOff = await adminCall("GET", "/api/v1/calendar/offset?date=2099-10-09&days=-7&time=08:00&shift=inherit");
  check("K11", "节假日顺延关（配置驱动）：同一入参保留假期内日期（两态各一例）", "settings 200（enabled=false）+ date=2099-10-02 + at=2099-10-02T00:00:00.000Z", truncate({ settings: settingsOff.body, offset: shiftedOff.body }, 260), settingsOff.status === 200 && settingsOff.body?.reminderShiftEnabled === false && shiftedOff.status === 200 && shiftedOff.body?.date === "2099-10-02" && shiftedOff.body?.shifted === false && shiftedOff.body?.at === "2099-10-02T00:00:00.000Z");

  const forcedOn = await adminCall("GET", "/api/v1/calendar/offset?date=2099-10-09&days=-7&shift=on");
  check("K12", "shift=on 强制覆盖配置（规则引擎回放与金标用）", "date=2099-10-08（配置仍为关）", truncate(forcedOn.body, 200), forcedOn.status === 200 && forcedOn.body?.date === "2099-10-08" && forcedOn.body?.shifted === true);

  const restoreSettings = await adminCall("PUT", "/api/v1/calendar/settings", { reminderShiftEnabled: cleanup.settingsBefore?.reminder_shift_enabled ?? true, shiftDirection: cleanup.settingsBefore?.shift_direction ?? "forward" });
  check("K12b", "恢复顺延配置（回放不留副作用）", "200 + 与回放前一致", truncate(restoreSettings.body, 180), restoreSettings.status === 200 && restoreSettings.body?.reminderShiftEnabled === (cleanup.settingsBefore?.reminder_shift_enabled ?? true));

  const tPlusOne = await adminCall("GET", "/api/v1/calendar/offset?date=2099-10-10&days=1&shift=inherit");
  check("K13", "T+1 逐级（A03 / A06 时间基准）：10-10（调休上班）后一天是周日 → 顺延到 10-12", "rawDate=2099-10-11 + date=2099-10-12 + shifted=true", truncate(tPlusOne.body, 220), tPlusOne.status === 200 && tPlusOne.body?.rawDate === "2099-10-11" && tPlusOne.body?.date === "2099-10-12" && tPlusOne.body?.shifted === true);

  const repeat = await adminCall("GET", "/api/v1/calendar/offset?date=2099-10-09&days=-1&shift=inherit");
  check("K13b", "实时求值：同一入参重复请求结果稳定（不缓存、不落库）", "两次 date 一致（2099-10-08）", truncate({ first: tMinusOne.body?.date, second: repeat.body?.date }, 120), repeat.status === 200 && repeat.body?.date === tMinusOne.body?.date);

  // ---------- 幂等与审计（h7 复用） ----------
  const idempotent = await adminCall("PUT", "/api/v1/calendar/days/" + HOLIDAYS[1], { dayType: "holiday", name: HOLIDAY_NAME, note: "回放数据" });
  const yearIdem = await adminCall("GET", "/api/v1/calendar/days?year=" + YEAR);
  const duplicateRows = (yearIdem.body?.days ?? []).filter((day) => day.date === HOLIDAYS[1]);
  check("K14", "PUT 幂等：重复设置同一天 200 且整年日历无重复行", "200 + 该日期在 days 中恰好 1 条", idempotent.status + " rows=" + duplicateRows.length, idempotent.status === 200 && duplicateRows.length === 1);

  const createRows = await waitForCount("select count(*)::int as n from audit_logs where object_type = $$calendar_day$$ and object_id = $1 and action = $$create$$", [HOLIDAYS[0]], 1);
  const createRow = (await db.query("select action, actor_id, result, entry, changes from audit_logs where object_type = $$calendar_day$$ and object_id = $1 order by id asc limit 1", [HOLIDAYS[0]])).rows[0];
  check("A1", "按对象检索命中例外设置留痕（谁 / 何时 / 对什么 / 从什么改成什么）", "action=create + actorId=" + adminRow.id + " + result=succeeded + changes 含 dayType", "行数=" + createRows + " " + truncate(createRow, 240), createRows >= 1 && createRow?.action === "create" && createRow?.actor_id === adminRow.id && createRow?.result === "succeeded" && createRow?.entry === "api" && Array.isArray(createRow?.changes) && createRow.changes.some((change) => change.field === "dayType" && change.to === "holiday"), "等价 API：GET /api/v1/audit-logs?objectType=calendar_day&objectId=" + HOLIDAYS[0]);

  const updateRow = (await db.query("select action, actor_id, changes from audit_logs where object_type = $$calendar_settings$$ and object_id = $$default$$ order by id desc limit 1")).rows[0];
  const shiftChange = Array.isArray(updateRow?.changes) ? updateRow.changes.find((change) => change.field === "reminderShiftEnabled") : undefined;
  check("A2", "顺延配置留痕：calendar_settings / default 的字段级 before / after", "action=update + changes 含 {reminderShiftEnabled, …}", truncate({ action: updateRow?.action, actor: updateRow?.actor_id, change: shiftChange }, 220), updateRow?.action === "update" && updateRow?.actor_id === adminRow.id && shiftChange !== undefined, "配置变更与例外维护同为可检索对象");

  const auditByObject = await adminCall("GET", "/api/v1/audit-logs?objectType=calendar_day&objectId=" + HOLIDAYS[0] + "&limit=20");
  check("A3", "审计接口·按对象检索（calendar_day + 业务日期）", "200 + total ≥ 1 且全为 calendar_day", auditByObject.status + " total=" + (auditByObject.body?.total ?? "?") + " " + truncate((auditByObject.body?.items ?? []).map((item) => item.action), 120), auditByObject.status === 200 && (auditByObject.body?.total ?? 0) >= 1 && (auditByObject.body?.items ?? []).every((item) => item.objectType === "calendar_day"));

  const actorAudit = await actorCall("GET", "/api/v1/audit-logs");
  check("A3b", "审计接口仅 audit.view：受限账号 403", "403 FORBIDDEN", actorAudit.status + " " + truncate(actorAudit.body, 140), actorAudit.status === 403 && actorAudit.body?.code === "FORBIDDEN", "", false);

  // ---------- 删除（回落默认规则） ----------
  const missingDelete = await adminCall("DELETE", "/api/v1/calendar/days/2099-11-01");
  check("K15", "删除不存在的例外 → 404 NOT_FOUND（不静默成功）", "404 NOT_FOUND", missingDelete.status + " " + truncate(missingDelete.body, 140), missingDelete.status === 404 && missingDelete.body?.code === "NOT_FOUND");

  const removed = await adminCall("DELETE", "/api/v1/calendar/days/" + MAKEUP);
  const makeupAfter = await adminCall("GET", "/api/v1/calendar/day?date=" + MAKEUP);
  check("K16", "删除例外（仅管理员）：回落默认规则（周六 = 周末）", "200 + 该日不再在整年日历 + kind=weekend", removed.status + " " + truncate(makeupAfter.body, 140), removed.status === 200 && !(removed.body?.days ?? []).some((day) => day.date === MAKEUP) && makeupAfter.status === 200 && makeupAfter.body?.kind === "weekend" && makeupAfter.body?.isWorkday === false);

  const deleteRow = (await db.query("select action, actor_id, changes from audit_logs where object_type = $$calendar_day$$ and object_id = $1 order by id desc limit 1", [MAKEUP])).rows[0];
  check("A4", "删除留痕：action=delete（字段级 from → null）", "action=delete + actorId=" + adminRow.id, truncate(deleteRow, 220), deleteRow?.action === "delete" && deleteRow?.actor_id === adminRow.id && Array.isArray(deleteRow?.changes) && deleteRow.changes.some((change) => change.field === "dayType" && change.to === null));
} catch (error) {
  failures += 1;
  report.push("| FAIL | 中断：" + (error instanceof Error ? error.message : String(error)));
  process.stderr.write("PoC-8 回放失败：" + (error instanceof Error ? error.message : String(error)) + "\n");
} finally {
  if (db !== undefined) {
    try {
      if (args.keep !== true) {
        await db.query("delete from calendar_days where date = any($1::date[])", [[...HOLIDAYS, MAKEUP]]);
        await db.query("delete from audit_logs where object_type in ($$calendar_day$$, $$calendar_settings$$) and occurred_at >= $1 and actor_id = any($2::uuid[])", [cleanup.startedAt, [cleanup.adminId, cleanup.actorId]]);
        await db.query("delete from sessions where token_hash = any($1::text[])", [cleanup.tokens.map((token) => sha256(token))]);
        if (cleanup.settingsBefore !== null) {
          await db.query("update calendar_settings set reminder_shift_enabled = $1, shift_direction = $2, updated_at = now(), updated_by = null where id = true", [cleanup.settingsBefore.reminder_shift_enabled, cleanup.settingsBefore.shift_direction]);
        }
        const residue = {
          calendarDays: await sqlCount(DAY_VIEW_SQL, [[...HOLIDAYS, MAKEUP]]),
          auditRows: await sqlCount("select count(*)::int as n from audit_logs where object_type in ($$calendar_day$$, $$calendar_settings$$) and occurred_at >= $1 and actor_id = any($2::uuid[])", [cleanup.startedAt, [cleanup.adminId, cleanup.actorId]]),
          sessions: await sqlCount("select count(*)::int as n from sessions where token_hash = any($1::text[])", [cleanup.tokens.map((token) => sha256(token))]),
          settings: await sqlCount("select count(*)::int as n from calendar_settings where id = true and reminder_shift_enabled = $1 and shift_direction = $2", [cleanup.settingsBefore?.reminder_shift_enabled ?? true, cleanup.settingsBefore?.shift_direction ?? "forward"]),
        };
        check("C1", "收尾核对：回放数据与临时会话零残留（配置已恢复）", "calendar_days / audit_logs / sessions 全 0 + 配置 1 行等值", truncate(residue, 200), residue.calendarDays === 0 && residue.auditRows === 0 && residue.sessions === 0 && residue.settings === 1, "例外与审计行用 migrator 连接硬删（api 角色对 audit_logs 无 DELETE）", false);
      } else {
        report.push("| SKIP | C1 | 收尾（--keep：保留回放数据与临时会话）");
      }
    } catch (error) {
      report.push("| WARN | 收尾未完全成功：" + (error instanceof Error ? error.message : String(error)));
    }
    await db.end();
  }
}

const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd() }).toString().trim();
const lines = [];
lines.push("# PoC-8 回放证据（工作日历 D5）");
lines.push("");
lines.push("> 卡片：h8 · S6·工作日历（主责 wmj，协办 lan / px）｜验收口径：顺延与 T-1/T+1 有金标用例（配合 PoC-3 规则时间语义 i9）。");
lines.push("");
lines.push("| 项 | 值 |");
lines.push("|---|---|");
lines.push("| 回放时间 | " + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ") + " +08:00 |");
lines.push("| 目标 | " + BASE_URL + " |");
lines.push("| 数据库 | " + DATABASE_URL.replace(/:[^:@/]+@/, ":***@") + " |");
lines.push("| 代码版本 | " + commit + " |");
lines.push("| 管理员账号 | " + (cleanup.adminId ?? "-") + " |");
lines.push("| 受限账号 | " + (cleanup.actorId ?? "-") + " |");
lines.push("| 合成日历 | " + YEAR + "-10-01 ~ 10-07 放假 + " + MAKEUP + " 调休上班（回放后硬删） |");
lines.push("| 脚本 | server/scripts/poc8-replay.mjs |");
lines.push("");
lines.push("## 断言明细");
lines.push("");
lines.push(...report);
lines.push("");
lines.push("## 汇总");
lines.push("");
lines.push(failures === 0 ? "- ✅ 全部断言通过（" + evidence.steps.filter((step) => step.ok).length + " 项）：读 = 登录即可、写 = 仅管理员（越权 403 落 denied）、PUT 幂等、DELETE 回落默认规则与 404 边界、顺延两向、顺延开关两态（配置驱动 + shift=on 覆盖）、T-1/T+1 与 08:00 时刻、审计按对象检索（calendar_day / calendar_settings）、回放零残留。" : "- ❌ 有 " + failures + " 项失败，见上方 FAIL 行。");
lines.push("");
lines.push("## 验收对照（h8 · S6·工作日历）");
lines.push("");
lines.push("- 「日历维护（D5-01）」= K1 ~ K5 / K14 ~ K16：管理员维护节假日与调休安排（PUT 幂等 upsert、DELETE 回落默认规则、删不存在 404）；读路径（某年日历 / 单日判定 / 顺延配置）登录即可，管理面 UI 随 u12（px 线）。");
lines.push("- 「顺延规则可配置（D5-02）」= K6 ~ K12b：非工作日按方向移动到最近工作日（forward / backward，skipped 逐条返回）；提醒日期落在节假日是否顺延由 calendar_settings 驱动（关态保留假期内日期、开态顺延到节后工作日，shift=on / off 供规则引擎回放强制覆盖）。");
lines.push("- 「T-1 / T+1（D5-03）」= K9 ~ K13b：自然日偏移 + 顺延 + 提醒时刻（08:00 → UTC 时间戳）；以任务当前日期实时求值（重复请求结果稳定，改期后按新日期重算；已发送提醒不撤回由 i8 侧保证）。");
lines.push("- 「审计留痕（h7 复用）」= A1 ~ A4：calendar_day（对象 id = 业务日期）与 calendar_settings（对象 id = default）的 create / update / delete 字段级留痕可按对象检索；越权 403 落 denied 且对象与成功写同形（K2b）。");
lines.push("- 「规则时间语义金标（PoC-3 · i9）」= 本脚本的 K6 ~ K13b 即日期语义金标；跨天补跑（worker 重启）按应执行清单补发且不重复属调度面，随 i8 / i9 落地（依赖 lan 线 i5 outbox）。");
lines.push("- 「自动化用例全绿」= server 目录 node node_modules/vitest/vitest.mjs run（新增 test/calendar-rules.test.ts + test/calendar-service.test.ts 29 例）与 node scripts/check-db-schema.mjs / check-permission-matrix.mjs / check-boundaries.mjs。");
lines.push("- 复跑：cd server && node scripts/poc8-replay.mjs --out ../docs/PoC-8-回放证据(工作日历D5).md");
lines.push("");

const markdown = lines.join("\n") + "\n";
if (args.out !== undefined) { writeFileSync(args.out, markdown, "utf8"); process.stdout.write("报告已写入 " + args.out + "\n"); }
if (args.json !== undefined) { writeFileSync(args.json, JSON.stringify({ baseUrl: BASE_URL, commit, ranAt: new Date().toISOString(), failures, steps: evidence.steps }, null, 2), "utf8"); }
process.stdout.write(failures === 0 ? "PoC-8 回放通过（" + evidence.steps.length + " 项断言）\n" : "PoC-8 回放失败（" + failures + " 项）\n");
process.exit(failures === 0 ? 0 : 1);
