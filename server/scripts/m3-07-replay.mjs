#!/usr/bin/env node
/**
 * M3-07 刀 1 真机回放（2026-09-24 业务定案）：状态下拉五态可写（显式覆盖）+ 汇总卡「最慢 / 最新阶段」+ 紧急重要度三档。
 *
 * 真机（真 PG + 真 api）验到的部分：
 *   ① 五态写入：pending / active / done 走基础态联动；overdue（已延期）保持当前格数与完成日期、只落 tasks.status_override；
 *      early_done（提前完成）四格全亮 + 完成日期缺省当天 + 落覆盖；写进度 / 写基础三态一律清覆盖（回到读时派生）。
 *   ② 覆盖生效边界与筛选同口径：overdue 仅未完成生效、early_done 仅已完成生效 —— filter[status] 按「覆盖生效 + 读时派生」命中。
 *   ③ 汇总卡：slowestStage（第一个存在未完成任务的阶段）/ latestStage（已动工任务里阶段序最靠后）；
 *      「未分组」任务不参与阶段判定、只进三个计数；全部完成 → slowestStage=null；尚无任务动工 → latestStage=null。
 *   ④ 紧急重要度三档：高 / 中 / 低 可写；四象限值 → 400 VALIDATION_FAILED（存量由迁移 0031 折算）。
 *   ⑤ 留痕：只改覆盖（基础态不变）同样写 task_events status_change（after_value 含 statusOverride）。
 *   ⑥ 批量改状态同样支持五态。
 *
 * 前置：真 PG（DATABASE_URL）+ 真 api（--base-url，默认 http://127.0.0.1:3001）；脚本自建临时项目 / 任务，跑完软删（零残留）。
 * 用法：cd server && node scripts/m3-07-replay.mjs [--out <报告.md>] [--json <证据.json>] [--base-url <url>] [--keep]
 * 退出码：断言全过 = 0，否则 = 1（可当门禁用）。
 */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { Client } from "pg";

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.baseUrl ?? process.env.M307_BASE_URL ?? "http://127.0.0.1:3001";
const DATABASE_URL = args.databaseUrl ?? process.env.DATABASE_URL ?? "postgresql://libiaolink_migrator@127.0.0.1:5433/libiaolink";
const CSRF = randomBytes(16).toString("hex");
const TODAY = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const DRAFT_END = "2026-12-31";
const report = [];
const evidence = { checks: [], residue: {} };
let failures = 0;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") out.out = argv[++i];
    else if (item === "--json") out.json = argv[++i];
    else if (item === "--base-url") out.baseUrl = argv[++i];
    else if (item === "--database-url") out.databaseUrl = argv[++i];
    else if (item === "--keep") out.keep = true;
  }
  return out;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function truncate(value, max = 260) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return "undefined";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function caller(token) {
  return async function call(method, path, body, headers) {
    const finalHeaders = {
      "content-type": "application/json",
      cookie: "ll_sid=" + token + "; ll_csrf=" + CSRF,
      "x-csrf-token": CSRF,
    };
    if (headers !== undefined) Object.assign(finalHeaders, headers);
    const response = await fetch(BASE_URL + path, {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text === "" ? null : JSON.parse(text); } catch { parsed = { raw: text.slice(0, 400) }; }
    return { status: response.status, body: parsed };
  };
}

function check(id, title, expected, actual, ok, note = "") {
  if (!ok) failures += 1;
  report.push("| " + (ok ? "PASS" : "FAIL") + " | " + id + " | " + title + " |");
  report.push("  - 期望：" + expected);
  report.push("  - 实际：" + actual);
  if (note !== "") report.push("  - 说明：" + note);
  evidence.checks.push({ id, title, expected, actual, ok, note });
  process.stdout.write((ok ? "PASS " : "FAIL ") + id + " " + title + "\n");
}

const cleanup = { actorId: null, sessionToken: null, projectIds: [], taskRefs: [] };
const db = new Client({ connectionString: DATABASE_URL });

let call = null;
try {
  await db.connect();

  const health = await fetch(BASE_URL + "/healthz").then((response) => response.status).catch(() => 0);
  check("S1", "真机 api 在跑", "200", String(health), health === 200, BASE_URL);

  const admin = (await db.query("select u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where r.code = $$admin$$ and u.status = $$active$$ order by u.id limit 1")).rows[0];
  if (admin === undefined) throw new Error("找不到管理员账号（roles.code = admin）");
  cleanup.actorId = admin.id;
  const token = "m307-" + randomBytes(12).toString("hex");
  cleanup.sessionToken = token;
  await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(hours => 2))", [sha256(token), admin.id, "m3-07-replay"]);
  call = caller(token);

  const me = await call("GET", "/auth/me");
  check("S2", "临时管理员会话可用", "200", me.status + " " + truncate(me.body, 160), me.status === 200);

  const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace(/[-:T]/g, "");

  async function newTask(projectId, body) {
    const res = await call("POST", "/api/v1/projects/" + projectId + "/tasks", body);
    if (res.status !== 201) throw new Error("临时任务创建失败：" + res.status + " " + truncate(res.body, 200));
    cleanup.taskRefs.push({ projectId, taskId: res.body.id });
    return res.body;
  }

  function patchTask(projectId, taskId, body) {
    return call("PATCH", "/api/v1/projects/" + projectId + "/tasks/" + taskId, body);
  }

  function taskPath(projectId, taskId) {
    return "/api/v1/projects/" + projectId + "/tasks/" + taskId;
  }

  const projectA = await call("POST", "/api/v1/projects", { code: "M307A-" + stamp, name: "M3-07 回放 A（临时）", region: "未分类", projectType: "未分类", managerIds: [admin.id], stageKey: "presale" });
  if (projectA.status !== 201) throw new Error("临时项目 A 创建失败：" + projectA.status + " " + truncate(projectA.body, 200));
  const A = projectA.body.id;
  cleanup.projectIds.push(A);

  const tPresale = await newTask(A, { stageKey: "presale", title: "回放·售前任务", plannedEnd: DRAFT_END });
  const tDesign = await newTask(A, { stageKey: "design", title: "回放·设计任务", plannedEnd: DRAFT_END });
  const tAccept = await newTask(A, { stageKey: "acceptance", title: "回放·验收任务", plannedEnd: DRAFT_END });
  const tLoose = await newTask(A, { title: "回放·未分组任务", plannedEnd: DRAFT_END });
  check("S3", "临时项目 A + 4 条夹具任务（售前 / 设计 / 验收 / 未分组）", "项目 201 + 任务 4 × 201", "项目 " + projectA.status + " / 任务 4 条", true);

  const donePresale = await patchTask(A, tPresale.id, { status: "done", version: tPresale.version });
  check("A1", "售前任务置完成（基础三态联动：满格 + 完成日期缺省当天）", "200 + status=done + progress=1 + actualEnd=" + TODAY, donePresale.status + " " + truncate({ status: donePresale.body?.status, progress: donePresale.body?.progress, actualEnd: donePresale.body?.actualEnd }), donePresale.status === 200 && donePresale.body?.status === "done" && donePresale.body?.progress === 1 && donePresale.body?.actualEnd === TODAY);

  const startedAccept = await patchTask(A, tAccept.id, { status: "active", version: tAccept.version });
  check("A2", "验收任务置进行中（0 → 0.25 格）", "200 + active + progress=0.25", startedAccept.status + " " + truncate({ status: startedAccept.body?.status, progress: startedAccept.body?.progress }), startedAccept.status === 200 && startedAccept.body?.status === "active" && startedAccept.body?.progress === 0.25);

  const summary1 = await call("GET", "/api/v1/projects/" + A + "/summary");
  check("A3", "汇总卡：最慢 = 第一个存在未完成任务的阶段；最新 = 已动工里阶段序最靠后", "slowestStage=design / latestStage=acceptance / done=1 / total=4", summary1.status + " " + truncate({ slowestStage: summary1.body?.slowestStage, latestStage: summary1.body?.latestStage, overdue: summary1.body?.overdue, done: summary1.body?.done, total: summary1.body?.total }), summary1.status === 200 && summary1.body?.slowestStage === "design" && summary1.body?.latestStage === "acceptance" && summary1.body?.done === 1 && summary1.body?.total === 4, "「未分组」任务（pending）不参与阶段判定、只进 total");

  const overdueWrite = await patchTask(A, tDesign.id, { status: "overdue", version: tDesign.version });
  check("B1", "status=overdue（已延期）→ 保持格数与完成日期、只落覆盖；展示态 = 已延期", "200 + displayStatus=overdue + status=pending + progress=0 + actualEnd=null", overdueWrite.status + " " + truncate({ status: overdueWrite.body?.status, progress: overdueWrite.body?.progress, actualEnd: overdueWrite.body?.actualEnd, displayStatus: overdueWrite.body?.displayStatus }), overdueWrite.status === 200 && overdueWrite.body?.displayStatus === "overdue" && overdueWrite.body?.status === "pending" && overdueWrite.body?.progress === 0 && overdueWrite.body?.actualEnd === null, "存储基础态不变，展示态 = 读时派生 + 显式覆盖");

  const rowDesign = (await db.query("select status, progress, status_override from tasks where id = $1", [tDesign.id])).rows[0];
  check("B2", "落库口径：基础态 / 进度不变，仅 status_override=overdue", "pending / 0 / overdue", rowDesign.status + " / " + String(rowDesign.progress) + " / " + String(rowDesign.status_override), rowDesign.status === "pending" && Number(rowDesign.progress) === 0 && rowDesign.status_override === "overdue");

  const byOverdue = await call("GET", "/api/v1/projects/" + A + "/tasks?filter[status]=overdue&limit=50");
  const overdueIds = (byOverdue.body?.items ?? []).map((item) => item.id);
  check("B3", "filter[status]=overdue 命中「覆盖生效」的任务（筛选与读时派生同口径）", "含设计任务（覆盖来源）", byOverdue.status + " 命中 " + overdueIds.length + " 条", byOverdue.status === 200 && overdueIds.includes(tDesign.id));

  const byPending = await call("GET", "/api/v1/projects/" + A + "/tasks?filter[status]=pending&limit=50");
  const pendingIds = (byPending.body?.items ?? []).map((item) => item.id);
  check("B4", "同一任务不再命中 filter[status]=pending（归类唯一，不重复计数）", "不含设计任务", byPending.status + " 命中 " + pendingIds.length + " 条", byPending.status === 200 && !pendingIds.includes(tDesign.id));

  const progressWrite = await call("PATCH", taskPath(A, tDesign.id) + "/progress", { progress: 0.25, version: overdueWrite.body?.version });
  check("B5", "点进度条一律清覆盖（回到读时派生：进行中）", "200 + displayStatus=active + status=active + progress=0.25", progressWrite.status + " " + truncate({ status: progressWrite.body?.status, progress: progressWrite.body?.progress, displayStatus: progressWrite.body?.displayStatus }), progressWrite.status === 200 && progressWrite.body?.displayStatus === "active" && progressWrite.body?.status === "active" && progressWrite.body?.progress === 0.25);

  const rowCleared = (await db.query("select status_override from tasks where id = $1", [tDesign.id])).rows[0];
  check("B6", "落库：写进度后 status_override 已清空", "null", String(rowCleared.status_override), rowCleared.status_override === null);

  const earlyWrite = await patchTask(A, tDesign.id, { status: "early_done", version: progressWrite.body?.version });
  check("B7", "status=early_done（提前完成）→ 四格全亮 + 完成日期缺省当天 + 落覆盖", "200 + done + progress=1 + actualEnd=" + TODAY + " + displayStatus=early_done", earlyWrite.status + " " + truncate({ status: earlyWrite.body?.status, progress: earlyWrite.body?.progress, actualEnd: earlyWrite.body?.actualEnd, displayStatus: earlyWrite.body?.displayStatus }), earlyWrite.status === 200 && earlyWrite.body?.status === "done" && earlyWrite.body?.progress === 1 && earlyWrite.body?.actualEnd === TODAY && earlyWrite.body?.displayStatus === "early_done");

  const byEarly = await call("GET", "/api/v1/projects/" + A + "/tasks?filter[status]=early_done&limit=50");
  check("B8", "filter[status]=early_done 同样命中覆盖来源", "含设计任务", byEarly.status + " 命中 " + (byEarly.body?.items ?? []).length + " 条", byEarly.status === 200 && (byEarly.body?.items ?? []).some((item) => item.id === tDesign.id));

  const pendingWrite = await patchTask(A, tDesign.id, { status: "pending", version: earlyWrite.body?.version });
  check("B9", "写基础三态清覆盖：pending 后展示态回派生（未到期 → 待开始）", "200 + displayStatus=pending + progress=0", pendingWrite.status + " " + truncate({ status: pendingWrite.body?.status, progress: pendingWrite.body?.progress, displayStatus: pendingWrite.body?.displayStatus }), pendingWrite.status === 200 && pendingWrite.body?.displayStatus === "pending" && pendingWrite.body?.progress === 0);

  const priOk = await patchTask(A, tPresale.id, { priority: "高", version: donePresale.body?.version });
  check("C1", "紧急重要度三档可写（高）", "200 + priority=高", priOk.status + " " + truncate({ priority: priOk.body?.priority }), priOk.status === 200 && priOk.body?.priority === "高");

  const priBad = await patchTask(A, tPresale.id, { priority: "重要且紧急", version: priOk.body?.version });
  check("C2", "四象限值 → 400 VALIDATION_FAILED（旧口径已作废）", "400 + VALIDATION_FAILED", priBad.status + " " + truncate(priBad.body, 200), priBad.status === 400 && priBad.body?.code === "VALIDATION_FAILED");

  const events = (await db.query("select event_type, before_value, after_value from task_events where task_id = $1 order by created_at, id", [tDesign.id])).rows;
  const overrideOnly = events.find((row) => row.event_type === "status_change" && String(row.before_value) === "{\"statusOverride\":null}" && String(row.after_value) === "{\"statusOverride\":\"overdue\"}");
  check("D1", "只改覆盖（基础态 / 进度都不变）也写 status_change 留痕", "存在 before={\"statusOverride\":null} → after={\"statusOverride\":\"overdue\"}", events.length + " 条事件；命中 " + (overrideOnly === undefined ? 0 : 1), overrideOnly !== undefined);

  const earlyEvent = events.find((row) => row.event_type === "status_change" && String(row.after_value).includes("\"status\":\"done\"") && String(row.after_value).includes("\"statusOverride\":\"early_done\""));
  check("D2", "五态写入的事件负载同时带 status 与 statusOverride", "存在 after 含 done + early_done 的 status_change", "命中 " + (earlyEvent === undefined ? 0 : 1), earlyEvent !== undefined);

  const batch = await call("PATCH", "/api/v1/projects/" + A + "/tasks/batch", { ids: [tLoose.id], changes: { status: "overdue" } });
  check("E1", "批量改状态支持五态（overdue = 显式覆盖）", "200 + succeededCount=1 + failedCount=0 + displayStatus=overdue", batch.status + " " + truncate({ total: batch.body?.total, succeededCount: batch.body?.succeededCount, failedCount: batch.body?.failedCount, displayStatus: batch.body?.succeeded?.[0]?.displayStatus }), batch.status === 200 && batch.body?.succeededCount === 1 && batch.body?.failedCount === 0 && batch.body?.succeeded?.[0]?.displayStatus === "overdue");

  await patchTask(A, tDesign.id, { status: "done", version: pendingWrite.body?.version });
  await patchTask(A, tAccept.id, { status: "done", version: startedAccept.body?.version });
  await patchTask(A, tLoose.id, { status: "done", version: batch.body?.succeeded?.[0]?.version });
  const summaryAllDone = await call("GET", "/api/v1/projects/" + A + "/summary");
  check("E2", "全部完成 → slowestStage=null；latestStage 仍取已动工里最靠后（acceptance）", "slowestStage=null / latestStage=acceptance / done=4 / total=4", summaryAllDone.status + " " + truncate({ slowestStage: summaryAllDone.body?.slowestStage, latestStage: summaryAllDone.body?.latestStage, done: summaryAllDone.body?.done, total: summaryAllDone.body?.total }), summaryAllDone.status === 200 && summaryAllDone.body?.slowestStage === null && summaryAllDone.body?.latestStage === "acceptance" && summaryAllDone.body?.done === 4 && summaryAllDone.body?.total === 4);

  const projectB = await call("POST", "/api/v1/projects", { code: "M307B-" + stamp, name: "M3-07 回放 B（临时）", region: "未分类", projectType: "未分类", managerIds: [admin.id], stageKey: "presale" });
  if (projectB.status !== 201) throw new Error("临时项目 B 创建失败：" + projectB.status + " " + truncate(projectB.body, 200));
  const B = projectB.body.id;
  cleanup.projectIds.push(B);
  await newTask(B, { stageKey: "install", title: "回放·安装任务", plannedEnd: DRAFT_END });
  const summaryB = await call("GET", "/api/v1/projects/" + B + "/summary");
  check("F1", "尚无任务动工 → latestStage=null；最慢 = 唯一未完成阶段 install", "slowestStage=install / latestStage=null / done=0 / total=1", summaryB.status + " " + truncate({ slowestStage: summaryB.body?.slowestStage, latestStage: summaryB.body?.latestStage, done: summaryB.body?.done, total: summaryB.body?.total }), summaryB.status === 200 && summaryB.body?.slowestStage === "install" && summaryB.body?.latestStage === null && summaryB.body?.done === 0 && summaryB.body?.total === 1);
} catch (error) {
  failures += 1;
  report.push("| FAIL | X0 | 回放中止 |");
  report.push("  - 实际：" + (error instanceof Error ? error.message : String(error)));
  evidence.checks.push({ id: "X0", title: "回放中止", expected: "无异常", actual: String(error), ok: false });
  process.stdout.write("FAIL X0 " + String(error) + "\n");
} finally {
  try {
    if (call !== null && args.keep !== true) {
      for (const ref of cleanup.taskRefs) {
        await call("DELETE", "/api/v1/projects/" + ref.projectId + "/tasks/" + ref.taskId);
      }
      for (const projectId of cleanup.projectIds) {
        const detail = await call("GET", "/api/v1/projects/" + projectId);
        await call("DELETE", "/api/v1/projects/" + projectId, undefined, { "if-match": String(detail.body?.version) });
      }
      const residueProjects = Number((await db.query("select count(*)::int as n from projects where id = any($1::uuid[]) and deleted_at is null", [cleanup.projectIds])).rows[0]?.n ?? -1);
      const taskIds = cleanup.taskRefs.map((ref) => ref.taskId);
      const residueTasks = taskIds.length === 0 ? 0 : Number((await db.query("select count(*)::int as n from tasks where id = any($1::uuid[]) and deleted_at is null", [taskIds])).rows[0]?.n ?? -1);
      evidence.residue = { projects: residueProjects, tasks: residueTasks };
      check("Z1", "临时项目 / 任务软删（读面零残留）", "项目 0 行 / 任务 0 行可见", residueProjects + " / " + residueTasks, residueProjects === 0 && residueTasks === 0);
    } else {
      evidence.residue = { kept: true };
      report.push("| PASS | Z1 | --keep：保留回放数据 |");
    }
    if (cleanup.sessionToken !== null && args.keep !== true) {
      await db.query("delete from sessions where token_hash = $1", [sha256(cleanup.sessionToken)]);
    }
    const leftover = cleanup.sessionToken === null ? 0 : Number((await db.query("select count(*)::int as n from sessions where token_hash = $1", [sha256(cleanup.sessionToken)])).rows[0]?.n ?? -1);
    evidence.residue.sessions = args.keep === true ? "kept" : leftover;
    check("Z2", "临时会话清理（零残留）", "0 行", args.keep === true ? "kept" : String(leftover), args.keep === true || leftover === 0);
  } catch (error) {
    process.stdout.write("清理阶段异常：" + String(error) + "\n");
  } finally {
    await db.end().catch(() => undefined);
  }
}

const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd() }).toString().trim();
const ranAt = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ") + " +08:00";
const lines = [];
lines.push("# M3-07 刀 1 回放证据（五态可写 + 汇总卡两阶段 + 紧急重要度三档）");
lines.push("");
lines.push("> 口径：业务 2026-09-24 定案 —— 「状态下拉都要有 要5态 但是他们的逻辑要和之前的一样」/「紧急重要度 和前端一致只有三档」/ 汇总卡「当前阶段」下线、改「最慢阶段 / 最新阶段」。");
lines.push("");
lines.push("| 项 | 值 |");
lines.push("|---|---|");
lines.push("| 回放时间 | " + ranAt + " |");
lines.push("| api | " + BASE_URL + " |");
lines.push("| 数据库 | " + DATABASE_URL.replace(/:[^:@/]+@/, ":***@") + " |");
lines.push("| 代码版本 | " + commit + " |");
lines.push("| 回放账号（临时会话，用完删除） | " + (cleanup.actorId ?? "-") + " |");
lines.push("| 脚本 | server/scripts/m3-07-replay.mjs |");
lines.push("");
lines.push("## 断言明细");
lines.push("");
lines.push(...report);
lines.push("");
lines.push("## 汇总");
lines.push("");
lines.push(failures === 0 ? "- 全部断言通过（" + evidence.checks.filter((item) => item.ok).length + " 项）：五态写入与覆盖边界、筛选同口径、汇总卡两阶段、三档优先级、事件留痕、批量五态全部成立；临时项目 / 任务 / 会话零残留。" : "- 有 " + failures + " 项失败，见上方 FAIL 行。");
lines.push("");
lines.push("## 复跑");
lines.push("");
lines.push("- api：cd server && PORT=3001 node --env-file-if-exists=.env dist/entry/api.js（需先 npm run build）");
lines.push("- 迁移：cd database && DATABASE_URL=postgres://libiaolink_migrator@127.0.0.1:5433/libiaolink npm run migrate（0031 必须先于本回放执行）");
lines.push("- 回放：cd server && node scripts/m3-07-replay.mjs --out ../docs/m3-07-回放证据(五态与汇总卡).md");
lines.push("");

const markdown = lines.join("\n") + "\n";
if (args.out !== undefined) { writeFileSync(args.out, markdown, "utf8"); process.stdout.write("报告已写入 " + args.out + "\n"); }
if (args.json !== undefined) { writeFileSync(args.json, JSON.stringify({ baseUrl: BASE_URL, commit, ranAt, failures, residue: evidence.residue, checks: evidence.checks }, null, 2), "utf8"); }
process.stdout.write(failures === 0 ? "M3-07 刀 1 回放通过（" + evidence.checks.length + " 项断言）\n" : "M3-07 刀 1 回放失败（" + failures + " 项）\n");
process.exit(failures === 0 ? 0 : 1);
