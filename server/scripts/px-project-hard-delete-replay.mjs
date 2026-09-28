#!/usr/bin/env node
/**
 * Push 190 真机回放（业务定案 2026-09-24「删除要硬删不要软删；同一个编号删了要能再建」）：
 * 项目删除 = 物理删行（连同项目聚合子表），编号随行释放。
 *
 * 真机（真 PG + 真 api）验到的部分：
 *   ① 删除主路径：DELETE /api/v1/projects/{id}（If-Match = version）→ 200 返回删除前快照；
 *      库内 projects 行不存在；聚合子表（tasks / project_nodes / project_stages / project_members …）零残留。
 *   ② 审计留痕：action=project.delete、metadata.hardDelete=true、metadata.children = 删除前子表行数（行没了、留痕在）。
 *   ③ 编号释放：同编号可再建（Push 190 前是 409 PROJECT_CODE_EXISTS）；seq_no 不回收（再建拿新序号）。
 *   ④ 边界：版本不匹配 409 VERSION_CONFLICT（整事务回滚、项目还在）、已删项目详情 404、归档项目 409 PROJECT_ARCHIVED。
 *   ⑤ 零残留：临时项目 / 会话清干净（审计行按设计保留为历史）。
 *
 * 前置：真 PG（DATABASE_URL）+ 真 api（--base-url，默认 http://127.0.0.1:3001）；脚本自建临时项目，跑完清理。
 * 用法：cd server && node scripts/px-project-hard-delete-replay.mjs [--out <报告.md>] [--json <证据.json>] [--base-url <url>] [--keep]
 * 退出码：断言全过 = 0，否则 = 1（可当门禁用）。
 */
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Client } from "pg";

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.baseUrl ?? process.env.PXHD_BASE_URL ?? "http://127.0.0.1:3001";
const DATABASE_URL = args.databaseUrl ?? process.env.DATABASE_URL ?? "postgresql://libiaolink_migrator@127.0.0.1:5433/libiaolink";
const CSRF = randomBytes(16).toString("hex");
const report = ["# Push 190 回放证据（项目硬删 · 同编号可再建）", "", "| 结果 | 编号 | 断言 |", "|---|---|---|"];
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

function truncate(value, max = 300) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return "undefined";
  return text.length > max ? text.slice(0, max) + "..." : text;
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

const cleanup = { sessionToken: null, projectIds: [], codes: [] };
const db = new Client({ connectionString: DATABASE_URL });
let call = null;

/** 回放专用清理（migrator 连接）：与 hardDeleteWithVersion 同序，保证任何失败路径都不留残渣。 */
async function purgeProjects(ids) {
  if (ids.length === 0) return;
  const stmts = [
    "delete from issue_events where issue_id in (select id from issues where project_id = any($1::uuid[]))",
    "delete from task_events where task_id in (select id from tasks where project_id = any($1::uuid[]))",
    "delete from file_versions where file_id in (select id from files where project_id = any($1::uuid[]))",
    "delete from files where project_id = any($1::uuid[])",
    "delete from change_requests where project_id = any($1::uuid[])",
    "delete from issues where project_id = any($1::uuid[])",
    "delete from daily_reports where project_id = any($1::uuid[])",
    "delete from tasks where project_id = any($1::uuid[])",
    "delete from node_requirements where node_id in (select id from project_nodes where project_id = any($1::uuid[]))",
    "delete from project_nodes where project_id = any($1::uuid[])",
    "delete from project_stages where project_id = any($1::uuid[])",
    "delete from project_members where project_id = any($1::uuid[])",
    "delete from project_stakeholders where project_id = any($1::uuid[])",
    "delete from projects where id = any($1::uuid[])",
  ];
  for (const stmt of stmts) await db.query(stmt, [ids]);
}

try {
  await db.connect();

  const health = await fetch(BASE_URL + "/healthz").then((response) => response.status).catch(() => 0);
  check("S1", "真机 api 在跑", "200", String(health), health === 200, BASE_URL);

  const admin = (await db.query("select u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where r.code = $$admin$$ and u.status = $$active$$ order by u.id limit 1")).rows[0];
  if (admin === undefined) throw new Error("找不到管理员账号（roles.code = admin）");
  const member = (await db.query("select id from users where status = $$active$$ and id <> $1 order by id limit 1", [admin.id])).rows[0];
  if (member === undefined) throw new Error("找不到第二个可当项目成员的账号");
  const token = "pxhd-" + randomBytes(12).toString("hex");
  cleanup.sessionToken = token;
  await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(hours => 2))", [sha256(token), admin.id, "pxhd-replay"]);
  call = caller(token);

  const me = await call("GET", "/auth/me");
  check("S2", "临时管理员会话可用", "200", me.status + " " + truncate(me.body, 120), me.status === 200);

  const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const codeA = "PXHD-A-" + stamp;
  cleanup.codes.push(codeA);

  const createdA = await call("POST", "/api/v1/projects", { code: codeA, name: "Push190 硬删回放 A（临时）", region: "未分类", projectType: "未分类", managerIds: [admin.id], stageKey: "presale" });
  const projectA = createdA.body;
  if (createdA.status !== 201 || typeof projectA?.id !== "string") throw new Error("临时项目 A 创建失败：" + createdA.status + " " + truncate(createdA.body, 200));
  cleanup.projectIds.push(projectA.id);
  check("A1", "建临时项目 A（蓝图导入同事务）", "201 + code 一致 + version=0 + seqNo 为正整数", createdA.status + " " + truncate({ code: projectA.code, version: projectA.version, seqNo: projectA.seqNo }), createdA.status === 201 && projectA.code === codeA && projectA.version === 0 && Number.isInteger(projectA.seqNo));

  const countsA = (await db.query("select (select count(*)::int from project_stages where project_id = $1) stages, (select count(*)::int from project_nodes where project_id = $1) nodes", [projectA.id])).rows[0];
  check("A2", "蓝图快照落库：项目阶段 / 流程节点", "stages >= 1 且 nodes >= 1", truncate(countsA), countsA.stages >= 1 && countsA.nodes >= 1);

  const memberRes = await call("POST", "/api/v1/projects/" + projectA.id + "/members", { userId: member.id, roleInProject: "project_member" });
  const taskRes = await call("POST", "/api/v1/projects/" + projectA.id + "/tasks", { title: "硬删回放任务 " + stamp, stageKey: "presale" });
  const countsA2 = (await db.query("select (select count(*)::int from tasks where project_id = $1 and deleted_at is null) tasks, (select count(*)::int from project_members where project_id = $1) members", [projectA.id])).rows[0];
  check("A3", "聚合子表写入：加成员 200 + 加任务 201 → 库内各 1 行", "200 / 201 / tasks=1 / members=1", memberRes.status + " / " + taskRes.status + " / " + truncate(countsA2), memberRes.status === 200 && taskRes.status === 201 && countsA2.tasks === 1 && countsA2.members === 1);

  const delA = await call("DELETE", "/api/v1/projects/" + projectA.id, undefined, { "If-Match": String(projectA.version) });
  check("A4", "DELETE（If-Match = version）→ 200 + 返回删除前快照", "200 + code 一致 + version = 删除前 version", delA.status + " " + truncate({ code: delA.body?.code, version: delA.body?.version }), delA.status === 200 && delA.body?.code === codeA && delA.body?.version === projectA.version);

  const goneA = (await db.query("select count(*)::int n from projects where id = $1", [projectA.id])).rows[0].n;
  check("A5", "物理删行：库内 projects 该行不存在", "0", String(goneA), goneA === 0);

  const residueA = (await db.query("select (select count(*)::int from tasks where project_id = $1) tasks, (select count(*)::int from project_nodes where project_id = $1) nodes, (select count(*)::int from project_stages where project_id = $1) stages, (select count(*)::int from project_members where project_id = $1) members, (select count(*)::int from project_stakeholders where project_id = $1) stakeholders, (select count(*)::int from daily_reports where project_id = $1) reports, (select count(*)::int from issues where project_id = $1) issues, (select count(*)::int from change_requests where project_id = $1) changes, (select count(*)::int from files where project_id = $1) files", [projectA.id])).rows[0];
  check("A6", "聚合子表零残留（9 张表按 project_id）", "全 0", truncate(residueA), Object.values(residueA).every((value) => value === 0));

  const auditA = (await db.query("select action, metadata, changes from audit_logs where project_id = $1 and object_type = $$project$$ and action = $$delete$$ order by id", [projectA.id])).rows;
  const metaA = auditA[0]?.metadata ?? {};
  check("A7", "审计留痕：project.delete + metadata.hardDelete + children 计数", "1 行 + hardDelete=true + children.tasks=1 / members=1 / nodes>=1 / stages>=1", auditA.length + " 行 / " + truncate(metaA), auditA.length === 1 && metaA.hardDelete === true && metaA.children?.tasks === 1 && metaA.children?.members === 1 && metaA.children?.nodes >= 1 && metaA.children?.stages >= 1);
  const changesA = auditA[0]?.changes ?? [];
  check("A8", "审计字段级快照：changes 每条 to=null（行已删、快照留痕）", ">= 7 条且 to 全 null", changesA.length + " 条", Array.isArray(changesA) && changesA.length >= 7 && changesA.every((item) => item.to === null));

  const createdB = await call("POST", "/api/v1/projects", { code: codeA, name: "Push190 硬删回放 A2（同编号再建·临时）", region: "未分类", projectType: "未分类", managerIds: [admin.id], stageKey: "presale" });
  const projectB = createdB.body;
  if (createdB.status === 201 && typeof projectB?.id === "string") cleanup.projectIds.push(projectB.id);
  check("A9", "同编号可再建（Push 190 前 409 PROJECT_CODE_EXISTS）+ seq_no 不回收", "201 + code 相同 + seqNo > 被删项目 seqNo", createdB.status + " " + truncate({ code: projectB?.code, seqNo: projectB?.seqNo }), createdB.status === 201 && projectB?.code === codeA && projectB?.seqNo > projectA.seqNo);

  const detailA = await call("GET", "/api/v1/projects/" + projectA.id);
  const listQ = await call("GET", "/api/v1/projects?q=" + encodeURIComponent(codeA) + "&page=1&limit=20");
  const listedIds = (listQ.body?.items ?? []).map((item) => item.id);
  check("A10", "已删项目：详情 404 + 按编号查列表只含再建那条", "404 + 列表不含已被删 id", detailA.status + " / " + truncate(listedIds), detailA.status === 404 && listedIds.includes(projectB.id) && !listedIds.includes(projectA.id));

  const conflict = await call("DELETE", "/api/v1/projects/" + projectB.id, undefined, { "If-Match": String(projectB.version + 5) });
  const stillThere = (await db.query("select count(*)::int n from projects where id = $1", [projectB.id])).rows[0].n;
  check("B1", "版本不匹配 → 409 VERSION_CONFLICT 且整事务回滚（项目仍在）", "409 + code=VERSION_CONFLICT + 库内 1 行", conflict.status + " / " + String(conflict.body?.code) + " / " + String(stillThere), conflict.status === 409 && conflict.body?.code === "VERSION_CONFLICT" && stillThere === 1);

  const missing = await call("DELETE", "/api/v1/projects/00000000-0000-4000-8000-000000000000", undefined, { "If-Match": "0" });
  check("B2", "删除不存在的项目 → 404 NOT_FOUND", "404", missing.status + " " + truncate(missing.body, 120), missing.status === 404);

  const archived = await call("PATCH", "/api/v1/projects/" + projectB.id, { status: "archived", version: projectB.version });
  const versionAfterArchive = archived.body?.version ?? projectB.version;
  const delArchived = await call("DELETE", "/api/v1/projects/" + projectB.id, undefined, { "If-Match": String(versionAfterArchive) });
  check("B3", "归档项目禁删（ADR-027）", "PATCH 200 + DELETE 409 PROJECT_ARCHIVED", archived.status + " / " + delArchived.status + " " + truncate(delArchived.body, 120), archived.status === 200 && delArchived.status === 409 && delArchived.body?.code === "PROJECT_ARCHIVED");

  await db.query("update projects set status = $$active$$ where id = $1", [projectB.id]);
  const delB = await call("DELETE", "/api/v1/projects/" + projectB.id, undefined, { "If-Match": String(versionAfterArchive) });
  check("C1", "复位归档后删除 → 200（清理临时项目）", "200", delB.status + " " + truncate(delB.body, 120), delB.status === 200);

  const residue = (await db.query("select (select count(*)::int from projects where id = any($2::uuid[]) or code = $1::text) projects, (select count(*)::int from tasks where project_id = any($2::uuid[])) tasks, (select count(*)::int from project_nodes where project_id = any($2::uuid[])) nodes, (select count(*)::int from project_stages where project_id = any($2::uuid[])) stages, (select count(*)::int from project_members where project_id = any($2::uuid[])) members", [codeA, cleanup.projectIds])).rows[0];
  evidence.residue = residue;
  check("C2", "零残留：临时项目 id / 编号在全链路无行", "全 0", truncate(residue), Object.values(residue).every((value) => value === 0));

  const auditHistory = (await db.query("select count(*)::int n from audit_logs where project_id = any($1::uuid[])", [cleanup.projectIds])).rows[0].n;
  check("C3", "审计历史保留（行删了、留痕在）", ">= 2", String(auditHistory), auditHistory >= 2);
} catch (error) {
  failures += 1;
  report.push("", "## 异常", "", String(error?.stack ?? error));
  process.stdout.write("EXCEPTION " + String(error?.message ?? error) + "\n");
} finally {
  try { if (cleanup.sessionToken !== null) await db.query("delete from sessions where token_hash = $1", [sha256(cleanup.sessionToken)]); } catch { /* 会话清理失败不掩盖断言结果 */ }
  if (args.keep !== true) {
    try { await purgeProjects(cleanup.projectIds); } catch (error) { process.stdout.write("purge failed: " + String(error) + "\n"); }
  }
  try { await db.end(); } catch { /* 连接已断 */ }
  const summary = failures === 0 ? "全部通过" : failures + " 项失败";
  report.push("", "## 小结", "", "- 断言：" + evidence.checks.length + " 项，" + summary + "。");
  evidence.failures = failures;
  if (args.out !== undefined) writeFileSync(args.out, report.join("\n"), "utf8");
  if (args.json !== undefined) writeFileSync(args.json, JSON.stringify(evidence, null, 2), "utf8");
  process.stdout.write("结果：" + summary + "（" + evidence.checks.length + " 项）\n");
  process.exit(failures === 0 ? 0 : 1);
}
