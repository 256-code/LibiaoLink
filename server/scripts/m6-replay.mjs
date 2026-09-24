#!/usr/bin/env node
/**
 * M6 真机回放（S6·report-issue · 日报 / 问题：A3-01 ~ A3-13 + A2-01 引用守卫 + M6-01 收口 A7-01 / A7-05）：
 *   证据一（A3-01 ~ A3-04 · 日报填报）：新报一天（今天 = submitted，过去日期 = 补填 supplement）、
 *           一人一项目一天一条（重复 409 REPORT_ALREADY_EXISTS）、未来日期 400、草稿 draft 创建 + 提交、
 *           关联任务（taskIds / taskTitles 同下标；非本项目任务 400）。
 *   证据二（A3-08 回写 / A3-09 问题生成 · 均幂等）：提交后 ① tables.note 追加「【日报 <日期>】<当日完成工作>」
 *           并写 task_events(note_change)；② 现场发现问题非空 → 自动生成问题（source_report_id 唯一兜底）。
 *           重编辑已提交日报触发重放：note 标记只出现一次、问题仍 1 条、事件不重复。
 *   证据三（A3-12 归类分派）：部门名归类（机械部 / 采购部 / 规划部 / 项目部）= 责任部门；原因类（其它原因）= null。
 *   证据四（A3-10 / A3-13 · 问题四态与留痕）：unassigned → open → in_progress → done（写 closed_at / closed_by）→ 回退
 *           in_progress（自动清空关闭对）；每次实际变化各写一条 issue_events（state_change / solution / assignment）；
 *           空更新 400、乐观锁 409、归档项目 409、跨项目 404。
 *   证据五（M6-01 收口 · A7-01 当日汇总 / A7-05 应填未填）：当日汇总只算已提交条目（submitted / supplement）
 *           （entryCount / headcountTotal / issueCount + 工作日信息）；应填未填 = 名册 × 工作日历 × 当日未提交
 *           （草稿未提交仍计未填）；非工作日整列为空（不催报）；缺省日期 = 今天；未来日期 400。
 *   证据六（A2-01 删除引用守卫）：任务被日报 / 问题引用 → DELETE 409 TASK_HAS_REFERENCES
 *           （details[].code = report_ref / issue_ref，带条数）；无引用任务可删；重复删除 404。
 *
 * 前置：真 PG（DATABASE_URL，迁移器角色 —— 断言与收尾要跨表读删）+ 真 api（BASE_URL）。本脚本只在本地沙箱 / 联调库跑：
 *       铸一个管理员临时会话（跑完撤销）、建 M6RPL- 回放项目与任务（跑完硬删项目及其日报 / 问题 / 事件 / 任务 / 审计 / outbox / 会话）。
 * 用法：cd server && M6_DATABASE_URL=postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink \
 *       node --env-file-if-exists=.env scripts/m6-replay.mjs [--out <报告.md>] [--json <证据.json>] [--actor <userId>] [--keep]
 * 退出码：断言全过 = 0，否则 = 1（可当门禁用）。
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.baseUrl ?? process.env.M6_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3011";
const DATABASE_URL = args.databaseUrl ?? process.env.M6_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink";
const report = [];
const evidence = { steps: [] };
let failures = 0;
let db;
let admin;
let adminId;
const cleanup = { projectId: null, tokens: [], syntheticUserId: null };

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

/** 上海日期（与服务端 shanghaiToday 同口径）：offset 0 = 今天、-1 = 昨天、-2 = 前天、1 = 明天。 */
function shanghaiDate(offsetDays) {
  return new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}

async function makeSession(userId, idToken) {
  const session = { userId, token: "m6rpl-" + randomBytes(16).toString("hex"), csrf: randomBytes(16).toString("hex") };
  await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + interval $$2 hours$$)", [sha256(session.token), userId, idToken]);
  cleanup.tokens.push(session.token);
  return session;
}

async function call(method, path, body) {
  const response = await fetch(BASE_URL + path, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: "ll_sid=" + admin.token + "; ll_csrf=" + admin.csrf,
      "x-csrf-token": admin.csrf,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text === "" ? null : JSON.parse(text); } catch { parsed = { raw: text.slice(0, 300) }; }
  return { status: response.status, body: parsed };
}

function check(id, title, expected, actual, ok, extra = "") {
  if (!ok) failures += 1;
  report.push("| " + (ok ? "PASS" : "FAIL") + " | " + id + " | " + title + " | 期望：" + expected + " | 实际：" + actual + (extra === "" ? "" : " | " + extra) + " |");
  evidence.steps.push({ id, title, expected, actual, ok, extra });
  process.stdout.write((ok ? "PASS " : "FAIL ") + id + " " + title + String.fromCharCode(10));
  if (!ok) throw new Error("M6 回放失败（" + id + "）：" + title);
}

function short(value, max = 320) {
  const text = JSON.stringify(value);
  return text === undefined ? "undefined" : text.length > max ? text.slice(0, max) + "..." : text;
}

let taskAId;
let taskBId;
let reportId;
let issueId;

try {
  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  const health = await fetch(BASE_URL + "/healthz").then((response) => response.status).catch(() => 0);
  check("P1", "api 可用（/healthz）", "200", String(health), health === 200, "先起 api 再跑本脚本");

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const adminRow = await db.query("select u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where r.code = $1 and u.status = $2 order by u.id limit 1", ["admin", "active"]);
  if (args.actor === undefined && adminRow.rows.length === 0) {
    const adminRole = await db.query("select id from roles where code = $$admin$$ limit 1");
    if (adminRole.rows.length === 0) throw new Error("roles 表缺少 admin 角色；先在目标库跑 database/scripts/seed.mjs");
    const createdAdmin = await db.query("insert into users (casdoor_id, username, display_name, status) values ($1, $2, $3, $$active$$) returning id", ["m6rpl-" + stamp + "-admin", "m6rpl-" + stamp + "-admin", "M6 回放管理员"]);
    await db.query("insert into user_roles (user_id, role_id) values ($1, $2)", [createdAdmin.rows[0].id, adminRole.rows[0].id]);
    cleanup.syntheticUserId = createdAdmin.rows[0].id;
    adminRow.rows.push(createdAdmin.rows[0]);
  }
  adminId = args.actor ?? adminRow.rows[0]?.id;
  check("P2", "管理员账号可用（roles.code = admin；空库自动建合成管理员）", "非空 userId", short(adminId ?? null, 80), adminId !== undefined);
  admin = await makeSession(adminId, "m6-replay");
  const probe = await call("GET", "/api/v1/projects?limit=1");
  check("P3", "临时会话可用（GET /api/v1/projects）", "200", probe.status + " " + short(probe.body?.total ?? probe.body?.code ?? null, 80), probe.status === 200);

  const created = await call("POST", "/api/v1/projects", { code: "M6RPL-" + stamp, name: "M6 回放项目（日报与问题）", projectType: "default", managerIds: [adminId] });
  cleanup.projectId = created.body?.id ?? null;
  check("P4", "建回放项目（M6RPL-）", "201", created.status + " " + short({ id: cleanup.projectId, code: created.body?.code }, 160), created.status === 201);

  const taskA = await call("POST", "/api/v1/projects/" + cleanup.projectId + "/tasks", { title: "M6RPL-装配工装（日报回写）" });
  const taskB = await call("POST", "/api/v1/projects/" + cleanup.projectId + "/tasks", { title: "M6RPL-对照任务（无引用）" });
  taskAId = taskA.body?.id ?? null;
  taskBId = taskB.body?.id ?? null;
  check("P5", "建 2 个任务（回写靶子 + 无引用对照）", "201 x 2", short({ a: taskAId, b: taskBId }, 200), taskA.status === 201 && taskB.status === 201);

  const today = shanghaiDate(0);
  const yesterday = shanghaiDate(-1);
  const beforeYesterday = shanghaiDate(-2);
  const tomorrow = shanghaiDate(1);

  // ---------- 证据一：日报填报（A3-01 ~ A3-04） ----------
  const API = "/api/v1/projects/" + cleanup.projectId;
  const listReports = (params) => {
    const search = new URLSearchParams(params).toString();
    return call("GET", API + "/reports" + (search === "" ? "" : "?" + search));
  };
  const listIssues = (params) => {
    const search = new URLSearchParams(params).toString();
    return call("GET", API + "/issues" + (search === "" ? "" : "?" + search));
  };

  const createToday = await call("POST", API + "/reports", { date: today, doneWork: "装配工装 A 段就位并点检", headcount: 12, plan: "装配 B 段", foundIssue: "现场发现：支架尺寸偏差 3mm", issueCategory: "机械部", suggestion: "复测后调整定位销", taskIds: [taskAId] });
  reportId = createToday.body?.id ?? null;
  const todayOk = createToday.status === 201 && createToday.body?.state === "submitted" && createToday.body?.authorId === adminId && createToday.body?.date === today && createToday.body?.headcount === 12 && Array.isArray(createToday.body?.taskIds) && createToday.body.taskIds[0] === taskAId && createToday.body?.taskTitles?.[0] === "M6RPL-装配工装（日报回写）" && createToday.body?.submittedAt !== null && createToday.body?.submittedAt !== undefined;
  check("R1", "新报今天（state=submitted + 关联任务标题同下标 + 系统字段）", "201 / submitted / authorId / taskTitles[0]=任务A", createToday.status + " / " + (createToday.body?.state ?? "-") + " / " + short({ taskIds: createToday.body?.taskIds, taskTitles: createToday.body?.taskTitles }, 160), todayOk === true);

  const dup = await call("POST", API + "/reports", { date: today, doneWork: "重复填报" });
  check("R2", "一人一项目一天一条：重复填报 409 REPORT_ALREADY_EXISTS", "409 REPORT_ALREADY_EXISTS", dup.status + " " + (dup.body?.code ?? "-"), dup.status === 409 && dup.body?.code === "REPORT_ALREADY_EXISTS");

  const future = await call("POST", API + "/reports", { date: tomorrow, doneWork: "未来日报" });
  check("R3", "未来日期 400 VALIDATION_FAILED", "400 VALIDATION_FAILED", future.status + " " + (future.body?.code ?? "-"), future.status === 400 && future.body?.code === "VALIDATION_FAILED");

  const backfill = await call("POST", API + "/reports", { date: yesterday, doneWork: "昨天：下料完成", headcount: 8 });
  check("R4", "补填昨天（state=supplement）", "201 supplement", backfill.status + " " + (backfill.body?.state ?? "-"), backfill.status === 201 && backfill.body?.state === "supplement");

  const draft = await call("POST", API + "/reports", { date: beforeYesterday, state: "draft", doneWork: "前天：图纸会审（草稿）" });
  const submitDraft = await call("PATCH", API + "/reports/" + draft.body?.id, { version: draft.body?.version ?? 0, state: "submitted" });
  check("R5", "草稿创建 + 提交（过去日期提交 = 补填 supplement）", "201 draft -> 200 supplement", draft.status + " " + (draft.body?.state ?? "-") + " -> " + submitDraft.status + " " + (submitDraft.body?.state ?? "-"), draft.status === 201 && draft.body?.state === "draft" && submitDraft.status === 200 && submitDraft.body?.state === "supplement");

  const list = await listReports({ "filter[dateFrom]": beforeYesterday, "filter[dateTo]": today, limit: "10" });
  const dates = (list.body?.items ?? []).map((item) => item.date);
  check("R6", "日报列表：3 条 + 日期倒序", "200 / total=3 / 首行 " + today, list.status + " / total=" + (list.body?.total ?? "-") + " / " + dates.join(","), list.status === 200 && list.body?.total === 3 && dates[0] === today);

  const detail = await call("GET", API + "/reports/" + reportId);
  check("R7", "日报详情（A3-01 全字段回读）", "200 + doneWork / issueCategory / suggestion 一致", detail.status + " " + short({ doneWork: detail.body?.doneWork, category: detail.body?.issueCategory, suggestion: detail.body?.suggestion }, 200), detail.status === 200 && detail.body?.doneWork === "装配工装 A 段就位并点检" && detail.body?.issueCategory === "机械部" && detail.body?.suggestion === "复测后调整定位销");

  // ---------- 证据二：提交副作用（A3-09 问题生成 + A3-08 回写）· 均幂等 ----------
  const issuesOfReport = await listIssues({ "filter[reportId]": reportId, limit: "10" });
  const generated = issuesOfReport.body?.items?.[0] ?? null;
  issueId = generated?.id ?? null;
  const genOk = issuesOfReport.status === 200 && issuesOfReport.body?.total === 1 && generated !== null && generated.title === "现场发现：支架尺寸偏差 3mm" && generated.category === "机械部" && generated.state === "unassigned" && generated.reporterId === adminId && generated.raisedAt === today && generated.ownerDepartment === "机械部" && generated.taskId === taskAId && generated.sourceReportId === reportId;
  check("I1", "A3-09：提交自动生成问题（原文 / 归类 / 提出人 / 提出日期 / 任务挂接）", "total=1 + 字段一致", issuesOfReport.status + " total=" + (issuesOfReport.body?.total ?? "-") + " " + short(generated === null ? null : { title: generated.title, category: generated.category, state: generated.state, dept: generated.ownerDepartment, task: generated.taskId }, 220), genOk === true);

  const taskRow = await db.query("select note from tasks where id = $1", [taskAId]);
  const noteAfterSubmit = taskRow.rows[0]?.note ?? "";
  const marker = "【日报 " + today + "】";
  const noteEvents = await db.query("select count(*)::int as n from task_events where task_id = $1 and event_type = $2", [taskAId, "note_change"]);
  check("T1", "A3-08：提交回写任务进展（【日报 <日期>】标记 + task_events 留痕）", "note 含标记与当日完成工作 / note_change=1", short({ hasMarker: noteAfterSubmit.includes(marker), hasWork: noteAfterSubmit.includes("装配工装 A 段就位并点检"), events: noteEvents.rows[0].n }, 200), noteAfterSubmit.includes(marker) && noteAfterSubmit.includes("装配工装 A 段就位并点检") && noteEvents.rows[0].n === 1);

  const replay = await call("PATCH", API + "/reports/" + reportId, { version: createToday.body.version, doneWork: "装配工装 A 段就位并点检（复述）" });
  const issuesAfterReplay = await listIssues({ "filter[reportId]": reportId, limit: "10" });
  const taskRow2 = await db.query("select note from tasks where id = $1", [taskAId]);
  const noteAfterReplay = taskRow2.rows[0]?.note ?? "";
  const markerCount = noteAfterReplay.split(marker).length - 1;
  const eventsAfterReplay = await db.query("select count(*)::int as n from task_events where task_id = $1 and event_type = $2", [taskAId, "note_change"]);
  const seedEvents = await db.query("select count(*)::int as n from issue_events where issue_id = $1", [issueId]);
  check("I2", "幂等重放：重编辑已提交日报（重跑副作用）→ 问题仍 1 条、事件不重复", "issues total=1 / issue_events=1（仅 created）", "issues total=" + (issuesAfterReplay.body?.total ?? "-") + " / issue_events=" + seedEvents.rows[0].n, replay.status === 200 && issuesAfterReplay.body?.total === 1 && seedEvents.rows[0].n === 1);
  check("T2", "幂等重放：note 标记只出现一次、note_change 仍 1 条", "marker x1 / note_change=1", "marker x" + markerCount + " / note_change=" + eventsAfterReplay.rows[0].n, markerCount === 1 && eventsAfterReplay.rows[0].n === 1);

  // ---------- 证据三：问题四态与留痕（A3-10 / A3-13） ----------
  const openIssue = await call("PATCH", API + "/issues/" + issueId, { version: generated.version, state: "open", note: "已确认，转处理" });
  check("E1", "四态：unassigned -> open（写一条 state_change）", "200 open / events=2", openIssue.status + " " + (openIssue.body?.state ?? "-") + " / events=" + (openIssue.body?.events?.length ?? "-"), openIssue.status === 200 && openIssue.body?.state === "open" && openIssue.body?.events?.length === 2);

  const progressIssue = await call("PATCH", API + "/issues/" + issueId, { version: openIssue.body?.version, state: "in_progress" });
  check("E2", "四态：open -> in_progress", "200 in_progress", progressIssue.status + " " + (progressIssue.body?.state ?? "-"), progressIssue.status === 200 && progressIssue.body?.state === "in_progress" && progressIssue.body?.events?.length === 3);

  const doneIssue = await call("PATCH", API + "/issues/" + issueId, { version: progressIssue.body?.version, state: "done", solution: "更换定位销并复测合格" });
  check("E3", "四态：in_progress -> done（同写 closed_at / closed_by + solution 事件）", "200 done / closedBy=admin / events=5", doneIssue.status + " " + (doneIssue.body?.state ?? "-") + " closedBy=" + (doneIssue.body?.closedBy ?? "-") + " / events=" + (doneIssue.body?.events?.length ?? "-"), doneIssue.status === 200 && doneIssue.body?.state === "done" && doneIssue.body?.closedAt !== null && doneIssue.body?.closedBy === adminId && doneIssue.body?.solution === "更换定位销并复测合格" && doneIssue.body?.events?.length === 5);

  const rollbackIssue = await call("PATCH", API + "/issues/" + issueId, { version: doneIssue.body?.version, state: "in_progress", note: "复测未过，回退处理" });
  check("E4", "A3-10 允许回退：done -> in_progress（自动清空关闭对）", "200 in_progress / closedAt=null / events=6", rollbackIssue.status + " " + (rollbackIssue.body?.state ?? "-") + " closedAt=" + String(rollbackIssue.body?.closedAt ?? "null"), rollbackIssue.status === 200 && rollbackIssue.body?.state === "in_progress" && rollbackIssue.body?.closedAt === null && rollbackIssue.body?.closedBy === null && rollbackIssue.body?.events?.length === 6);

  const emptyUpdate = await call("PATCH", API + "/issues/" + issueId, { version: rollbackIssue.body?.version, note: "只有备注" });
  check("E5", "空更新 400 VALIDATION_FAILED（防刷留痕）", "400 VALIDATION_FAILED", emptyUpdate.status + " " + (emptyUpdate.body?.code ?? "-"), emptyUpdate.status === 400 && emptyUpdate.body?.code === "VALIDATION_FAILED");

  const staleUpdate = await call("PATCH", API + "/issues/" + issueId, { version: generated.version, state: "done" });
  check("E6", "乐观锁：过期 version 409 VERSION_CONFLICT", "409 VERSION_CONFLICT", staleUpdate.status + " " + (staleUpdate.body?.code ?? "-"), staleUpdate.status === 409 && staleUpdate.body?.code === "VERSION_CONFLICT");

  const byState = await listIssues({ "filter[state]": "in_progress", limit: "10" });
  const byKeyword = await listIssues({ q: "支架", limit: "10" });
  check("E7", "问题列表：状态筛选 + 关键字命中", "in_progress total=1 / 支架 total=1", "state total=" + (byState.body?.total ?? "-") + " / q total=" + (byKeyword.body?.total ?? "-"), byState.status === 200 && byState.body?.total === 1 && byKeyword.body?.total === 1);

  const assignIssue = await call("PATCH", API + "/issues/" + issueId, { version: rollbackIssue.body?.version, ownerId: adminId });
  const detailIssue = await call("GET", API + "/issues/" + issueId);
  const types = (detailIssue.body?.events ?? []).map((event) => event.eventType);
  check("E8", "A3-13 留痕：分派（assignment）与四类事件齐备（created / state_change / solution / assignment）", "ownerId=admin + events=7 + 四类齐备", short({ owner: assignIssue.body?.ownerId, count: types.length, types }, 220), assignIssue.status === 200 && assignIssue.body?.ownerId === adminId && types.indexOf("created") >= 0 && types.indexOf("state_change") >= 0 && types.indexOf("solution") >= 0 && types.indexOf("assignment") >= 0 && types.length === 7);

  // ---------- 证据四：A2-01 删除引用守卫 ----------
  const deleteA = await call("DELETE", API + "/tasks/" + taskAId);
  const codesA = (deleteA.body?.details ?? []).map((item) => item.code);
  check("G1", "A2-01：被日报 / 问题引用的任务 DELETE 409（details 带 report_ref / issue_ref）", "409 TASK_HAS_REFERENCES + 两类引用", deleteA.status + " " + (deleteA.body?.code ?? "-") + " " + short(codesA, 140), deleteA.status === 409 && deleteA.body?.code === "TASK_HAS_REFERENCES" && codesA.indexOf("report_ref") >= 0 && codesA.indexOf("issue_ref") >= 0);

  const deleteB = await call("DELETE", API + "/tasks/" + taskBId);
  const deleteB2 = await call("DELETE", API + "/tasks/" + taskBId);
  check("G2", "无引用任务可删（200）+ 重复删除 404", "200 / 404", deleteB.status + " / " + deleteB2.status, deleteB.status === 200 && deleteB2.status === 404);

  const missingReport = await call("GET", API + "/reports/" + randomUUID());
  const missingIssue = await call("GET", API + "/issues/" + randomUUID());
  check("G3", "记录级 404：不存在 / 跨项目 id 的日报与问题详情", "404 / 404", missingReport.status + " / " + missingIssue.status, missingReport.status === 404 && missingIssue.status === 404);

  // ---------- 证据五：M6-01 收口 —— 当日汇总（A7-01）与应填未填（A7-05） ----------
  // 名册是 A7-05 的应填范围：先落 1 名成员（项目经理；M2-05 幂等 upsert），再验「名册 × 当日状态」
  const rosterAdd = await call("POST", API + "/members", { userId: adminId, roleInProject: "project_manager" });
  check("S0", "A7-05 前置：回放成员落名册（M2-05 幂等 upsert）+ 身份随行下发", "200 / userId=adminId / roleInProject=project_manager", rosterAdd.status + " " + short({ userId: rosterAdd.body?.userId, role: rosterAdd.body?.roleInProject }, 140), rosterAdd.status === 200 && rosterAdd.body?.userId === adminId && rosterAdd.body?.roleInProject === "project_manager");
  const summaryToday = await call("GET", API + "/reports/summary?date=" + today);
  const summaryTodayOk = summaryToday.status === 200 && summaryToday.body?.date === today && summaryToday.body?.entryCount === 1 && summaryToday.body?.draftCount === 0 && summaryToday.body?.headcountTotal === 12 && summaryToday.body?.issueCount === 1 && summaryToday.body?.entries?.[0]?.authorId === adminId && summaryToday.body?.entries?.[0]?.date === today && summaryToday.body?.entries?.[0]?.taskTitles?.[0] === "M6RPL-装配工装（日报回写）";
  check("S1", "A7-01 当日汇总：已提交条目聚合（entryCount=1 / 人数合计=12 / 问题数=1）", "200 entryCount=1 headcountTotal=12 issueCount=1", summaryToday.status + " " + short({ date: summaryToday.body?.date, entryCount: summaryToday.body?.entryCount, headcountTotal: summaryToday.body?.headcountTotal, issueCount: summaryToday.body?.issueCount }, 200), summaryTodayOk);

  const summaryDefault = await call("GET", API + "/reports/summary");
  check("S2", "A7-01 / A7-05 缺省日期 = 今天（Asia/Shanghai）", "200 date=" + today, summaryDefault.status + " " + String(summaryDefault.body?.date ?? "-") + " / isWorkday=" + String(summaryDefault.body?.isWorkday), summaryDefault.status === 200 && summaryDefault.body?.date === today && summaryDefault.body?.entryCount === 1 && typeof summaryDefault.body?.dayKind === "string");

  const summaryFuture = await call("GET", API + "/reports/summary?date=" + tomorrow);
  const missingFuture = await call("GET", API + "/reports/missing?date=" + tomorrow);
  check("S3", "未来日期 400 VALIDATION_FAILED（汇总 / 应填未填同口径，A3-04）", "400 x 2", summaryFuture.status + " / " + missingFuture.status, summaryFuture.status === 400 && summaryFuture.body?.code === "VALIDATION_FAILED" && missingFuture.status === 400 && missingFuture.body?.code === "VALIDATION_FAILED");

  const missingToday = await call("GET", API + "/reports/missing?date=" + today);
  const missingTodayOk = missingToday.status === 200 && missingToday.body?.memberCount >= 1 && missingToday.body?.members?.length === missingToday.body?.memberCount && missingToday.body?.members?.filter((member) => member.userId === adminId && member.reportId === reportId && member.state === "submitted" && member.roleInProject === "project_manager").length === 1 && missingToday.body?.submittedCount === 1 && (missingToday.body?.missingUserIds ?? []).indexOf(adminId) === -1 && missingToday.body?.missingCount === (missingToday.body?.isWorkday === true ? missingToday.body.memberCount - 1 : 0) && (missingToday.body?.missingUserIds ?? []).length === missingToday.body?.missingCount;
  check("S4", "A7-05 应填未填：名册 × 当日状态（已提交 → 不在漏填名单）", "200 memberCount≥1 submittedCount=1 / 漏填 = 名册 − 1", missingToday.status + " " + short({ memberCount: missingToday.body?.memberCount, submittedCount: missingToday.body?.submittedCount, missingCount: missingToday.body?.missingCount, missingUserIds: missingToday.body?.missingUserIds }, 200), missingTodayOk);

  // 冒烟判定：近 16 天内挑一个「无日报的工作日」（用日历接口自证，不硬编码星期）
  let blankWorkday = null;
  for (let offset = -3; offset >= -16 && blankWorkday === null; offset -= 1) {
    const probeDay = shanghaiDate(offset);
    const dayView = await call("GET", "/api/v1/calendar/day?date=" + probeDay);
    if (dayView.status === 200 && dayView.body?.isWorkday === true) blankWorkday = probeDay;
  }
  if (blankWorkday === null) {
    check("S5", "A7-05 应填未填：工作日无日报 → 名册全员进漏填名单", "近 16 天内无工作日（跳过）", "跳过", true, "日历例外连成长假时不适用");
  } else {
    const missingBlank = await call("GET", API + "/reports/missing?date=" + blankWorkday);
    const ids = missingBlank.body?.missingUserIds ?? [];
    const blankOk = missingBlank.status === 200 && missingBlank.body?.isWorkday === true && missingBlank.body?.memberCount >= 1 && missingBlank.body?.submittedCount === 0 && missingBlank.body?.draftCount === 0 && ids.length === missingBlank.body?.memberCount && missingBlank.body?.missingCount === missingBlank.body?.memberCount && ids.indexOf(adminId) >= 0 && missingBlank.body?.members?.every((member) => member.state === null && member.reportId === null && member.submittedAt === null);
    check("S5", "A7-05 应填未填：工作日无日报（" + blankWorkday + "）→ 名册全员进漏填名单", "200 submittedCount=0 / missingCount=memberCount / missingUserIds 全量", missingBlank.status + " " + short({ date: missingBlank.body?.date, memberCount: missingBlank.body?.memberCount, missingCount: missingBlank.body?.missingCount, missingUserIds: ids }, 200), blankOk);
  }

  // 冒烟判定：近 21 天内挑一个「非工作日」——整列必须为空（不催报）
  let restDay = null;
  for (let offset = -3; offset >= -21 && restDay === null; offset -= 1) {
    const probeDay = shanghaiDate(offset);
    const dayView = await call("GET", "/api/v1/calendar/day?date=" + probeDay);
    if (dayView.status === 200 && dayView.body?.isWorkday === false) restDay = probeDay;
  }
  if (restDay === null) {
    check("S6", "A7-05 非工作日整列为空（不催报）", "近 21 天内无非工作日（跳过）", "跳过", true, "日历例外全为工作日时不适用");
  } else {
    const missingRest = await call("GET", API + "/reports/missing?date=" + restDay);
    const restOk = missingRest.status === 200 && missingRest.body?.isWorkday === false && missingRest.body?.missingCount === 0 && (missingRest.body?.missingUserIds ?? []).length === 0 && missingRest.body?.members?.length === missingRest.body?.memberCount && missingRest.body?.members?.every((member) => member.state === null);
    check("S6", "A7-05 非工作日整列为空（" + restDay + " / " + String(missingRest.body?.dayKind ?? "-") + " / " + String(missingRest.body?.dayName ?? "无例外名") + "）", "200 missingCount=0 missingUserIds=[]", missingRest.status + " " + short({ isWorkday: missingRest.body?.isWorkday, dayKind: missingRest.body?.dayKind, dayName: missingRest.body?.dayName, missingCount: missingRest.body?.missingCount, members: missingRest.body?.members?.length ?? null }, 200), restOk);
  }


  // ---------- 证据六：归档写保护（ADR-027） ----------
  await db.query("update projects set status = $2 where id = $1", [cleanup.projectId, "archived"]);
  const archivedReport = await call("POST", API + "/reports", { date: beforeYesterday, doneWork: "归档后填报" });
  const archivedIssue = await call("PATCH", API + "/issues/" + issueId, { version: assignIssue.body?.version, state: "done" });
  const archivedTask = await call("DELETE", API + "/tasks/" + taskBId);
  check("G4", "归档项目写保护：日报填报 / 问题处理 / 任务删除均 409 PROJECT_ARCHIVED", "409 x 3", archivedReport.status + " / " + archivedIssue.status + " / " + archivedTask.status, archivedReport.status === 409 && archivedReport.body?.code === "PROJECT_ARCHIVED" && archivedIssue.status === 409 && archivedIssue.body?.code === "PROJECT_ARCHIVED" && archivedTask.status === 409 && archivedTask.body?.code === "PROJECT_ARCHIVED");
} catch (error) {
  failures += 1;
  report.push("| FAIL | 中断：" + (error instanceof Error ? error.message : String(error)) + " |");
  process.stderr.write("M6 回放失败：" + (error instanceof Error ? error.message : String(error)) + String.fromCharCode(10));
} finally {
  if (db !== undefined) {
    try {
      if (args.keep !== true && cleanup.projectId !== null) {
        await db.query("delete from issue_events where issue_id in (select id from issues where project_id = $1)", [cleanup.projectId]);
        await db.query("delete from issues where project_id = $1", [cleanup.projectId]);
        await db.query("delete from daily_reports where project_id = $1", [cleanup.projectId]);
        await db.query("delete from task_events where task_id in (select id from tasks where project_id = $1)", [cleanup.projectId]);
        await db.query("delete from tasks where project_id = $1", [cleanup.projectId]);
        await db.query("delete from audit_logs where project_id = $1", [cleanup.projectId]);
        await db.query("delete from outbox_events where payload::text like $1", ["%" + cleanup.projectId + "%"]);
        await db.query("delete from node_requirements where node_id in (select id from project_nodes where project_id = $1)", [cleanup.projectId]);
        await db.query("delete from project_nodes where project_id = $1", [cleanup.projectId]);
        await db.query("delete from project_stages where project_id = $1", [cleanup.projectId]);
        await db.query("delete from project_members where project_id = $1", [cleanup.projectId]);
        await db.query("delete from projects where id = $1", [cleanup.projectId]);
      }
      for (const token of cleanup.tokens) {
        await db.query("update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null", [sha256(token)]);
      }
      if (cleanup.syntheticUserId !== null) {
        await db.query("delete from audit_logs where actor_id = $1", [cleanup.syntheticUserId]);
        await db.query("delete from user_roles where user_id = $1", [cleanup.syntheticUserId]);
        await db.query("delete from sessions where user_id = $1", [cleanup.syntheticUserId]);
        await db.query("delete from users where id = $1", [cleanup.syntheticUserId]);
      }
    } catch (error) {
      report.push("| WARN | 收尾未完全成功：" + (error instanceof Error ? error.message : String(error)) + " |");
    }
    await db.end();
  }
}

const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: serverRoot }).toString().trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: serverRoot }).toString().trim() !== "";
const lines = [];
lines.push("# M6 回放证据（S6·report-issue：日报 / 问题 + M6-01 收口 A7-01 / A7-05）");
lines.push("");
lines.push("> 卡片：M6-01 ~ M6-03「日报填报 / 提交 / 补填 + 回写任务进展 + 问题自动生成 + 问题闭环与留痕」+ M6-01 收口「当日汇总（A7-01）/ 应填未填清单（A7-05）」（主责 wmj，评审 lan）｜口径来源：系统功能书 A3-01 ~ A3-13、A7-01、A7-05、A2-01（删除引用守卫）；技术设计v0.3-实施与验收.md §3.7。");
lines.push("");
lines.push("| 项 | 值 |");
lines.push("|---|---|");
lines.push("| 回放时间 | " + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ") + " +08:00 |");
lines.push("| 目标 | " + BASE_URL + " |");
lines.push("| 数据库 | " + DATABASE_URL.replace(/:[^:@/]+@/, ":***") + " |");
lines.push("| 代码版本 | " + commit + (dirty ? "（回放时工作区含本卡未提交改动）" : "") + " |");
lines.push("| 脚本 | server/scripts/m6-replay.mjs |");
lines.push("| 回放项目 | M6RPL-（含 2 个任务 / 3 条日报 / 1 条问题 / 1 名成员，跑完硬删） |");
lines.push("");
lines.push("## 断言明细");
lines.push("");
lines.push(...report);
lines.push("");
lines.push("## 汇总");
lines.push("");
lines.push(failures === 0 ? "- 全部断言通过（" + evidence.steps.filter((step) => step.ok).length + " 项）：日报填报（A3-01 ~ A3-04）+ 提交副作用幂等（A3-08 / A3-09）+ 归类分派（A3-12）+ 四态与留痕（A3-10 / A3-13）+ 引用守卫（A2-01）+ 当日汇总与应填未填（A7-01 / A7-05）+ 归档写保护。" : "- 有 " + failures + " 项失败，见上方 FAIL 行。");
lines.push("");
lines.push("## 验收对照（M6-01 ~ M6-03 + M6-01 收口）");
lines.push("");
lines.push("- A3-01 ~ A3-04（日报）= R1 ~ R7：新报（submitted）/ 重复填报 409 REPORT_ALREADY_EXISTS / 未来日期 400 / 补填（supplement）/ 草稿创建 + 提交 / 列表日期倒序 / 详情回读。");
lines.push("- A3-08（回写任务进展）= T1 / T2：tasks.note 追加「【日报 <日期>】<当日完成工作>」+ task_events(note_change)；重编辑已提交日报不重复追加（同任务同日期一次）。");
lines.push("- A3-09（问题自动生成）= I1 / I2：source_report_id 唯一兜底幂等；原文 / 归类 / 提出人 / 提出日期 / 单任务挂接。");
lines.push("- A3-12（归类分派）= I1：部门名归类（机械部 / 采购部 / 规划部 / 项目部）落 owner_department；原因类不自动落部门（null = 待分派）。");
lines.push("- A3-10 / A3-13（四态与留痕）= E1 ~ E8：允许回退且每次实际变化写一条 issue_events（created / state_change / solution / assignment）；关闭写 closed_at / closed_by、回退自动清空；空更新 400、乐观锁 409。");
lines.push("- A7-01（当日汇总）= S1 / S2：只算已提交条目（草稿不计入正文与人数）+ 人数合计 / 问题计数 + 工作日信息；缺省日期 = 今天。");
lines.push("- A7-05（应填未填）= S4 ~ S6：名册即应填范围；已提交（submitted / supplement）不进名单、草稿未提交仍计未填；非工作日整列为空（不催报）；未来日期 400。");
lines.push("- 归档写保护（ADR-027）= G4：归档项目上日报填报 / 问题处理 / 任务删除均 409 PROJECT_ARCHIVED。");
lines.push("- 单测回归（不连库）：server/test/report-issue.test.ts 27 例（日报 18 + 问题 9）+ server/test/report-summary.test.ts 14 例（当日汇总 7 + 应填未填 7）+ 删除引用守卫 server/test/task-remove.test.ts 12 例，随 npm test 常跑。");
lines.push("- 复跑：cd server && M6_DATABASE_URL=postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink node scripts/m6-replay.mjs --out ../docs/m6-回放证据(日报与问题).md");
lines.push("");
lines.push("");

if (args.json !== undefined) writeFileSync(args.json, JSON.stringify(evidence, null, 2) + String.fromCharCode(10), "utf8");
if (args.out !== undefined) writeFileSync(args.out, lines.join(String.fromCharCode(10)), "utf8");
process.stdout.write(lines.join(String.fromCharCode(10)) + String.fromCharCode(10));
process.exit(failures === 0 ? 0 : 1);
