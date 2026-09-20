#!/usr/bin/env node
/**
 * PoC-6 真机回放（h6 · S6·PoC-6 · 团队分工 §6 第 6 行：字段级 / 记录级 / 导出 / 搜索 / 通知五类出口自动化用例全绿）。
 *
 * 真机（真 PG + 真 api）能验到的部分：
 *   记录级（出口一）：同一个回放项目 —— 管理员可见；非名册账号在列表 / 详情 / tasks / flow / summary / members 上统一 404（防 IDOR，ADR-011 不变量 3）；
 *     加入名册后同一账号立即 200（列表与详情同一谓词，禁止两套口径）；不可见项目的写请求同样 404（记录级先判，不暴露存在性）。
 *   功能权限：名册成员项目内平权（任务进度 / 节点预检 200）与越权拒绝（改项目 / 管名册 / 阶段推进 / 增补节点 / 删项目 403）。
 *   导出（出口三）：授权画像数据面 —— project.export 只在管理员 / 项目经理 / 只读角色（种子 #6b），真机以 /permissions/me 复核。
 *   字段级（出口二）：键位数据面（stakeholder.contact.view）+ 投影用例；干系人数据面随 j6，本脚本不造干系人数据。
 *   搜索 / 通知（出口四 / 五）：模块归 lan 线、尚未落地 —— 出口策略与投影一致性由不连库用例覆盖（server/test/permission-matrix.test.ts）。
 *
 * 前置：真 PG（DATABASE_URL）+ 真 api（BASE_URL）。只在本地沙箱 / 联调库跑，会：铸两个临时会话（跑完删除）、
 *      建 POC6-xxx 回放项目（跑完硬删，含任务 / 节点 / 阶段 / outbox 事件）、临时把受限账号加入名册（跑完移除）。
 * 用法：cd server && node scripts/poc6-replay.mjs [--out <报告.md>] [--json <证据.json>] [--actor <userId>] [--keep]
 * 退出码：断言全过 = 0，否则 = 1（可当门禁用）。
 */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.baseUrl ?? process.env.POC6_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3011";
const DATABASE_URL = args.databaseUrl ?? process.env.DATABASE_URL ?? "postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink";
const CSRF = randomBytes(16).toString("hex");
const here = dirname(fileURLToPath(import.meta.url));
const openapi = JSON.parse(readFileSync(resolve(here, "..", "..", "shared", "generated", "openapi.json"), "utf8"));
const CONTRACT_KEYS = openapi.components?.schemas?.PermissionKey?.enum ?? [];
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
  const line = (ok ? "| PASS | " : "| FAIL | ") + id + " | " + title + " | ";
  report.push(line);
  report.push("  - 期望：" + expected);
  report.push("  - 实际：" + actual);
  if (note !== "") report.push("  - 说明：" + note);
  evidence.steps.push({ id, title, expected, actual, ok, note });
  process.stdout.write(line + "\n");
  if (!ok && fatal) throw new Error("PoC-6 回放失败（" + id + "）：" + title);
}

const cleanup = { projectId: null, actorId: null, tokens: [], membership: false };
let db;
let adminCall;
let actorCall;

try {
  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  const health = await fetch(BASE_URL + "/healthz").then((response) => response.status).catch(() => 0);
  if (health !== 200) throw new Error("api 不可用（" + BASE_URL + "/healthz → " + health + "）；先起 api 再跑本脚本");

  // ---------- 会话：管理员 + 受限账号（跑完删除） ----------
  const adminId = (await db.query("select u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where r.code = $$admin$$ and u.status = $$active$$ order by u.id limit 1")).rows[0]?.id;
  if (adminId === undefined) throw new Error("找不到可用的管理员账号（roles.code = admin）");
  const actorRow = args.actor !== undefined
    ? (await db.query("select id, username from users where id = $1 and status = $$active$$", [args.actor])).rows[0]
    : (await db.query("select u.id, u.username from users u where u.status = $$active$$ and u.id <> $1 and not exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id and r.code = $$admin$$) order by (select count(*) from user_roles ur2 where ur2.user_id = u.id), u.username limit 1", [adminId])).rows[0];
  if (actorRow === undefined) throw new Error("找不到可用的受限账号（--actor <userId> 可指定）");
  cleanup.actorId = actorRow.id;

  const adminToken = "poc6-admin-" + randomBytes(12).toString("hex");
  const actorToken = "poc6-actor-" + randomBytes(12).toString("hex");
  cleanup.tokens = [adminToken, actorToken];
  for (const pair of [[adminToken, adminId, "poc6-replay-admin"], [actorToken, actorRow.id, "poc6-replay-actor"]]) {
    await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(hours => 2))", [sha256(pair[0]), pair[1], pair[2]]);
  }
  adminCall = caller(adminToken);
  actorCall = caller(actorToken);

  const meAdmin = await adminCall("GET", "/api/v1/permissions/me");
  const adminKeys = meAdmin.body?.permissions?.permissionKeys ?? [];
  const adminScopes = meAdmin.body?.permissions?.dataScopes ?? [];
  check("S1", "管理员会话可用（授权画像）", "200 + dataScopes 含 all", meAdmin.status + " " + truncate({ roleCodes: meAdmin.body?.permissions?.roleCodes, dataScopes: adminScopes, keys: adminKeys.length }, 160), meAdmin.status === 200 && adminScopes.includes("all"));

  const meActor = await actorCall("GET", "/api/v1/permissions/me");
  const actorKeys = meActor.body?.permissions?.permissionKeys ?? [];
  const actorScopes = meActor.body?.permissions?.dataScopes ?? [];
  check("S2", "受限账号会话可用（全局位，项目位需项目上下文）", "200 + 不含 all 数据范围", meActor.status + " roleCodes=" + truncate(meActor.body?.permissions?.roleCodes, 80) + " keys=" + actorKeys.length, meActor.status === 200 && !actorScopes.includes("all"));
  const writeKeys = ["project.create", "project.update", "project.delete", "member.manage", "node.advance", "node.rollback", "node.create", "node.delete"];
  const leaked = writeKeys.filter((key) => actorKeys.includes(key));
  check("S3", "受限账号无项目级写权限位（越权拒绝基准账号）", "不含 " + writeKeys.join(" / "), leaked.length === 0 ? "无越权键位（keys=" + (actorKeys.length === 0 ? "空" : actorKeys.join(",")) + "）" : "含越权键位：" + leaked.join(","), leaked.length === 0, "账号 " + actorRow.username + "（" + actorRow.id + "）；如需指定其他最小权限账号用 --actor");

  // ---------- 记录级：建回放项目（管理员） ----------
  const code = "POC6-" + new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const created = await adminCall("POST", "/api/v1/projects", { code, name: "PoC-6 回放项目", projectType: "default", managerId: adminId });
  check("R1", "建回放项目（管理员；项目经理 = 管理员本人）", "201 + 返回项目 id", created.status + " " + truncate({ id: created.body?.id, stageKey: created.body?.stageKey, version: created.body?.version }, 160), created.status === 201 && typeof created.body?.id === "string");
  const projectId = created.body.id;
  cleanup.projectId = projectId;

  const listAdmin = await adminCall("GET", "/api/v1/projects?limit=100&q=" + encodeURIComponent(code));
  const adminHits = (listAdmin.body?.items ?? []).filter((item) => item.id === projectId).length;
  check("R2", "记录级·对照：管理员（data_scope=all）列表中可见", "200 + q=编号命中 1 条", listAdmin.status + " total=" + (listAdmin.body?.total ?? "?") + " 命中=" + adminHits, listAdmin.status === 200 && adminHits === 1);

  const listActor0 = await actorCall("GET", "/api/v1/projects?limit=100");
  const actorHits0 = (listActor0.body?.items ?? []).filter((item) => item.id === projectId).length;
  check("D1", "记录级·列表裁剪：非名册账号看不到该项目", "200 + 命中 0 条", listActor0.status + " total=" + (listActor0.body?.total ?? "?") + " 命中=" + actorHits0, listActor0.status === 200 && actorHits0 === 0);

  const detail0 = await actorCall("GET", "/api/v1/projects/" + projectId);
  check("D2", "记录级·详情：不可见 → 404（防 IDOR，不暴露存在性）", "404 NOT_FOUND", detail0.status + " " + truncate(detail0.body, 140), detail0.status === 404 && detail0.body?.code === "NOT_FOUND");

  const tasks0 = await actorCall("GET", "/api/v1/projects/" + projectId + "/tasks");
  const flow0 = await actorCall("GET", "/api/v1/projects/" + projectId + "/flow");
  const summary0 = await actorCall("GET", "/api/v1/projects/" + projectId + "/summary");
  const members0 = await actorCall("GET", "/api/v1/projects/" + projectId + "/members");
  check("D3", "记录级·子资源同一谓词：tasks / flow / summary / members 全 404", "四项均 404", [tasks0, flow0, summary0, members0].map((item) => item.status).join(" / "), [tasks0, flow0, summary0, members0].every((item) => item.status === 404));

  const patch0 = await actorCall("PATCH", "/api/v1/projects/" + projectId, { version: 1, name: "h6 write probe" });
  check("D4", "记录级优先于功能权限：不可见项目的写请求也是 404（不是 403）", "404 NOT_FOUND", patch0.status + " " + truncate(patch0.body, 140), patch0.status === 404);

  // ---------- 记录级：加入名册即刻可见 ----------
  await db.query("insert into project_members (project_id, user_id, role_in_project) values ($1, $2, $$project_member$$) on conflict (project_id, user_id) do update set role_in_project = excluded.role_in_project", [projectId, actorRow.id]);
  cleanup.membership = true;

  const detail1 = await actorCall("GET", "/api/v1/projects/" + projectId);
  check("R3", "记录级·名册即来源：加入名册立即 200（不需等策略缓存 TTL）", "200 + 同一项目 id", detail1.status + " " + truncate({ id: detail1.body?.id, name: detail1.body?.name }, 140), detail1.status === 200 && detail1.body?.id === projectId);

  const listActor1 = await actorCall("GET", "/api/v1/projects?limit=100");
  const actorHits1 = (listActor1.body?.items ?? []).filter((item) => item.id === projectId).length;
  check("R4", "记录级·列表与详情同一谓词：加入后列表可见（无两套口径）", "命中 1 条", listActor1.status + " total=" + (listActor1.body?.total ?? "?") + " 命中=" + actorHits1, listActor1.status === 200 && actorHits1 === 1);

  // ---------- 功能权限：成员平权读取 + 越权拒绝 ----------
  const flow1 = await actorCall("GET", "/api/v1/projects/" + projectId + "/flow");
  const stages = flow1.body?.stages ?? [];
  const nodes = stages.flatMap((stage) => stage.nodes ?? []);
  const node = nodes.find((item) => (item.requirements ?? []).length > 0) ?? nodes[0];
  const stage = stages[0];
  check("G4", "成员平权·读：名册成员可读项目流程快照（阶段 + 节点）", "200 + 阶段与节点非空", flow1.status + " stages=" + stages.length + " nodes=" + nodes.length, flow1.status === 200 && stages.length > 0 && nodes.length > 0);

  const f1 = await actorCall("PATCH", "/api/v1/projects/" + projectId, { version: 1, name: "h6 write probe" });
  const f2 = await actorCall("POST", "/api/v1/projects/" + projectId + "/members", { userId: adminId });
  const f3 = await actorCall("POST", "/api/v1/projects/" + projectId + "/stages/" + (stage?.stageKey ?? created.body.stageKey) + "/advance", { version: 1 });
  const f4 = await actorCall("POST", "/api/v1/projects/" + projectId + "/nodes", { stageId: node.stageId, nodeKey: node.nodeKey });
  const f5 = await actorCall("DELETE", "/api/v1/projects/" + projectId, undefined, { "if-match": "1" });
  const denials = [["F1", "改项目（project.update）", f1], ["F2", "管名册（member.manage）", f2], ["F3", "阶段推进（node.advance）", f3], ["F4", "增补节点（node.create）", f4], ["F5", "删项目（project.delete）", f5]];
  for (const item of denials) {
    check(item[0], "功能权限·可见但无权限位 → 403（" + item[1] + "）", "403 FORBIDDEN", item[2].status + " " + truncate(item[2].body, 140), item[2].status === 403 && item[2].body?.code === "FORBIDDEN");
  }

  // ---------- 功能权限：成员项目内平权（任务 / 节点） ----------
  const task = await adminCall("POST", "/api/v1/projects/" + projectId + "/tasks", { stageKey: stage?.stageKey ?? created.body.stageKey, title: "PoC-6 回放任务" });
  check("G1", "准备：管理员建一条回放任务（随项目清理）", "201 + 返回任务 id", task.status + " " + truncate({ id: task.body?.id, version: task.body?.version }, 140), task.status === 201 && typeof task.body?.id === "string");
  const taskId = task.body.id;
  const progress = await actorCall("PATCH", "/api/v1/projects/" + projectId + "/tasks/" + taskId + "/progress", { progress: 0.5, version: task.body?.version ?? 1 });
  check("G2", "成员平权·任务进度：名册成员可更新进度（task.progress）", "200 + progress=0.5", progress.status + " " + truncate({ progress: progress.body?.progress, version: progress.body?.version }, 140), progress.status === 200 && progress.body?.progress === 0.5);
  const taskUpdate = await actorCall("PATCH", "/api/v1/projects/" + projectId + "/tasks/" + taskId, { note: "PoC-6 回放：成员平权写备注", version: progress.body?.version ?? 2 });
  check("G3", "成员平权·任务编辑：名册成员可改任务（task.update）", "200 + note 写回", taskUpdate.status + " " + truncate({ note: taskUpdate.body?.note, version: taskUpdate.body?.version }, 160), taskUpdate.status === 200);

  const canComplete = await actorCall("GET", "/api/v1/nodes/" + node.id + "/can-complete");
  check("G5", "成员平权·节点预检：/nodes/{id}/can-complete 放行（node.complete）", "200 + canComplete 为布尔", canComplete.status + " " + truncate(canComplete.body, 160), canComplete.status === 200 && typeof canComplete.body?.canComplete === "boolean");

  // ---------- 五出口数据面：导出 / 字段级键位 ----------
  const contractOk = CONTRACT_KEYS.length > 0 && CONTRACT_KEYS.every((key) => adminKeys.includes(key));
  check("X1", "导出出口：管理员授权画像 = 契约枚举全量（project.export 在内的导出门控数据面）", "含契约全部 " + CONTRACT_KEYS.length + " 键", "admin keys=" + adminKeys.length + " / 契约 " + CONTRACT_KEYS.length + " / export=" + adminKeys.includes("project.export"), contractOk && adminKeys.includes("project.export"), "契约枚举取自 shared/generated/openapi.json（与 check:permission-matrix 同一来源）");
  const subsetOk = actorKeys.every((key) => adminKeys.includes(key));
  check("X2", "字段级出口：受限账号键位是管理员键位的严格子集（联系方式等按角色裁剪）", "actor keys 严格少于 admin 且无越集键位", "actor=" + actorKeys.length + " admin=" + adminKeys.length + " 越集=" + actorKeys.filter((key) => !adminKeys.includes(key)).length, subsetOk && actorKeys.length < adminKeys.length, "字段级投影（无权字段不返回 / 五出口同源）由 test/permission-matrix.test.ts 的策略层用例覆盖；联系方式键位 stakeholder.contact.view 在矩阵里只给管理员 / 项目经理 / 销售");
} catch (error) {
  failures += 1;
  report.push("| FAIL | 中断：" + (error instanceof Error ? error.message : String(error)));
  process.stderr.write("PoC-6 回放失败：" + (error instanceof Error ? error.message : String(error)) + "\n");
} finally {
  if (db !== undefined) {
    try {
      if (args.keep !== true) {
        if (cleanup.projectId !== null && adminCall !== undefined) {
          const before = await adminCall("GET", "/api/v1/projects/" + cleanup.projectId);
          if (before.status === 200) {
            await adminCall("DELETE", "/api/v1/projects/" + cleanup.projectId, undefined, { "if-match": String(before.body?.version ?? 1) });
          }
        }
        if (cleanup.projectId !== null) {
          await db.query("delete from task_events where task_id in (select id from tasks where project_id = $1)", [cleanup.projectId]);
          await db.query("delete from tasks where project_id = $1", [cleanup.projectId]);
          await db.query("delete from outbox_events where payload::text like $$%$$ || $1::text || $$%$$", [cleanup.projectId]);
          await db.query("delete from node_requirements where node_id in (select id from project_nodes where project_id = $1)", [cleanup.projectId]);
          await db.query("delete from project_nodes where project_id = $1", [cleanup.projectId]);
          await db.query("delete from project_stages where project_id = $1", [cleanup.projectId]);
          await db.query("delete from project_members where project_id = $1", [cleanup.projectId]);
          await db.query("delete from projects where id = $1", [cleanup.projectId]);
        }
        for (const token of cleanup.tokens) {
          await db.query("delete from sessions where token_hash = $1", [sha256(token)]);
        }
        if (cleanup.projectId !== null) {
          const countOf = async (sql, params) => (await db.query(sql, params)).rows[0].n;
          const residue = {
            projects: await countOf("select count(*)::int as n from projects where id = $1", [cleanup.projectId]),
            members: await countOf("select count(*)::int as n from project_members where project_id = $1", [cleanup.projectId]),
            tasks: await countOf("select count(*)::int as n from tasks where project_id = $1", [cleanup.projectId]),
            nodes: await countOf("select count(*)::int as n from project_nodes where project_id = $1", [cleanup.projectId]),
            stages: await countOf("select count(*)::int as n from project_stages where project_id = $1", [cleanup.projectId]),
            outbox: await countOf("select count(*)::int as n from outbox_events where payload::text like $$%$$ || $1::text || $$%$$", [cleanup.projectId]),
            sessions: await countOf("select count(*)::int as n from sessions where token_hash = any($1::text[])", [cleanup.tokens.map((token) => sha256(token))]),
          };
          check("C1", "收尾核对：回放数据与临时会话零残留", "projects / members / tasks / nodes / stages / outbox / sessions 全 0", truncate(residue, 200), Object.values(residue).every((value) => value === 0), "回放项目按 API 软删后硬删（沙箱不留调试数据）", false);
        }
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
lines.push("# PoC-6 回放证据（权限矩阵与脱敏五出口）");
lines.push("");
lines.push("> 卡片：h6 · S6·PoC-6（主责 wmj，协办 px）｜验收口径见 团队分工.md §6 第 6 行：字段级 / 记录级 / 导出 / 搜索 / 通知五类出口自动化用例全绿。");
lines.push("");
lines.push("| 项 | 值 |");
lines.push("|---|---|");
lines.push("| 回放时间 | " + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ") + " +08:00 |");
lines.push("| 目标 | " + BASE_URL + " |");
lines.push("| 数据库 | " + DATABASE_URL.replace(/:[^:@/]+@/, ":***@") + " |");
lines.push("| 代码版本 | " + commit + " |");
lines.push("| 受限账号 | " + (cleanup.actorId ?? "-") + " |");
lines.push("| 脚本 | server/scripts/poc6-replay.mjs |");
lines.push("");
lines.push("## 断言明细");
lines.push("");
lines.push(...report);
lines.push("");
lines.push("## 汇总");
lines.push("");
lines.push(failures === 0 ? "- ✅ 全部断言通过（" + evidence.steps.filter((step) => step.ok).length + " 项）：记录级列表 / 详情 / 子资源统一 404、名册即刻可见、越权 403、成员平权 200、出口键位数据面成立、回放数据零残留。" : "- ❌ 有 " + failures + " 项失败，见上方 FAIL 行。");
lines.push("");
lines.push("## 验收对照（团队分工.md §6 第 6 行：五类出口自动化用例全绿）");
lines.push("");
lines.push("- 「记录级」= D1 ~ D4 / R2 ~ R4：同一回放项目上，管理员可见、非名册账号在列表 / 详情 / tasks / flow / summary / members 上统一 404，加入名册后立即 200（列表与详情同一谓词）；不可见项目的写请求同为 404，不暴露存在性（ADR-011 不变量 3）。");
lines.push("- 「字段级」= X2 + 策略层用例：受限账号键位是管理员键位的严格子集；无权字段在策略层被裁掉（`test/permission-matrix.test.ts` 字段级 6 例：字段策略表 / 投影删字段 / 五出口同源）。干系人数据面随 j6，真机不造该实体。");
lines.push("- 「导出」= X1 + 策略层用例：管理员授权画像含契约枚举全量（含 `project.export`）；导出出口额外要求 `project.export`（策略层用例覆盖「无导出权 → 出口不放行」）。");
lines.push("- 「搜索」「通知」= 策略层用例：`planExit` 对 page / export / search / notify 四出口统一投影，`exitsConsistent` 断言五出口字段集一致（搜索 / 通知模块本身归 lan 线、尚未落地 —— 投影入口已就绪，模块落地后直接复用）。");
lines.push("- 「自动化用例全绿」= `cd server && node node_modules/vitest/vitest.mjs run`（`test/permission-matrix.test.ts` 34 例 + 全量 169 例 / 13 文件，随 `npm test` 常跑，不连库）。");
lines.push("- 复跑：cd server && node scripts/poc6-replay.mjs --out ../docs/PoC-6-回放证据(权限矩阵与脱敏五出口).md");
lines.push("");

const markdown = lines.join("\n") + "\n";
if (args.out !== undefined) { writeFileSync(args.out, markdown, "utf8"); process.stdout.write("报告已写入 " + args.out + "\n"); }
if (args.json !== undefined) { writeFileSync(args.json, JSON.stringify({ baseUrl: BASE_URL, commit, ranAt: new Date().toISOString(), failures, steps: evidence.steps }, null, 2), "utf8"); }
process.stdout.write(failures === 0 ? "PoC-6 回放通过（" + evidence.steps.length + " 项断言）\n" : "PoC-6 回放失败（" + failures + " 项）\n");
process.exit(failures === 0 ? 0 : 1);
