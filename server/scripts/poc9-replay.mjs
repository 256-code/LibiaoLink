#!/usr/bin/env node
/**
 * PoC-9 真机回放（h5 · S6·PoC-9 · 团队分工 §6 第 9 行）：
 *   证据一：蓝图导出 → 导入 → 再导出 round-trip 无损（键序归一化后逐字相等；导入后发布幂等 = 版本不递增）。
 *   证据二：节点声明必交成果文件时 —— can-complete 预检 canComplete=false（UI 置灰依据）、完成请求 422 NODE_REQUIRED_DOC_MISSING（服务端强校验）、
 *           outbox node.gate_rejected 留痕（事务回滚后补写、节点不变 = 不部分生效）；补齐定档成果文件后完成 200（拒绝只因缺件）。
 *
 * 前置：真 PG（DATABASE_URL）+ 真 api（BASE_URL）。本脚本只在本地沙箱 / 联调库跑，会：新建临时会话（跑完撤销）、
 *      建一个 POC9-xxx 回放项目（跑完软删）、在项目内节点上补一行定档文件（跑完硬删）。
 * 用法：cd server && node scripts/poc9-replay.mjs [--out <报告.md>] [--json <证据.json>] [--actor <userId>] [--keep]
 * 退出码：断言全过 = 0，否则 = 1（可当门禁用）。
 */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { Client } from "pg";

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.baseUrl ?? process.env.POC9_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3011";
const DATABASE_URL = args.databaseUrl ?? process.env.DATABASE_URL ?? "postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink";
const CSRF = randomBytes(16).toString("hex");
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

/** 键序归一化：对象键排序后比较（PG jsonb 会重排键，逐字比较前先归一）。 */
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  return value;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function call(method, path, body, extraHeaders = {}) {
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
}

function check(id, title, expected, actual, ok, note = "") {
  if (!ok) failures += 1;
  const line = (ok ? "| PASS | " : "| FAIL | ") + id + " | " + title + " | ";
  report.push(line);
  report.push("  - 期望：" + expected);
  report.push("  - 实际：" + actual);
  if (note !== "") report.push("  - 说明：" + note);
  evidence.steps.push({ id, title, expected, actual, ok, note });
  process.stdout.write(line + "\n");
  if (!ok) throw new Error("PoC-9 回放失败（" + id + "）：" + title);
}

function short(value, max = 320) {
  const text = JSON.stringify(value);
  return text === undefined ? "undefined" : text.length > max ? text.slice(0, max) + "…" : text;
}

let token = "";
let db;
const cleanup = { projectId: null, fileIds: [], actorId: null };

try {
  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  const health = await fetch(BASE_URL + "/healthz").then((response) => response.status).catch(() => 0);
  if (health !== 200) throw new Error("api 不可用（" + BASE_URL + "/healthz → " + health + "）；先起 api 再跑本脚本");

  // ---------- 角色与会话（管理员；跑完撤销） ----------
  const actorId = args.actor ?? (await db.query("select u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where r.code = 'admin' and u.status = 'active' order by u.id limit 1")).rows[0]?.id;
  if (actorId === undefined) throw new Error("找不到可用的管理员账号（roles.code = admin）");
  cleanup.actorId = actorId;
  token = "poc9-" + randomBytes(16).toString("hex");
  await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + interval '2 hours') returning id", [sha256(token), actorId, "poc9-replay"]);
  const me = await call("GET", "/api/v1/users?limit=1");
  check("S0", "会话可用（管理员会话已铸）", "GET /api/v1/users 200", me.status + " " + short(me.body, 80), me.status === 200);

  // ---------- 证据一：蓝图 round-trip 无损 ----------
  const export1 = await call("GET", "/api/v1/blueprint/export?projectType=default");
  const nodeCount1 = (export1.body?.stages ?? []).reduce((n, s) => n + (s.nodes?.length ?? 0), 0);
  check("B1", "导出正本（已发布蓝图 payload）", "200 + 阶段 / 节点非空", export1.status + " stages=" + (export1.body?.stages?.length ?? 0) + " nodes=" + nodeCount1, export1.status === 200 && (export1.body?.stages?.length ?? 0) > 0);
  const golden = export1.body;

  const imported = await call("POST", "/api/v1/blueprint/import?projectType=default", { blueprint: golden });
  check("B2", "导入同一份正本（校验通过）", "200", imported.status + " " + short({ status: imported.body?.status, publishedVersion: imported.body?.publishedVersion }, 120), imported.status === 200);

  const export2 = await call("GET", "/api/v1/blueprint/export?projectType=default");
  const nodeCount2 = (export2.body?.stages ?? []).reduce((n, s) => n + (s.nodes?.length ?? 0), 0);
  const roundTrip = JSON.stringify(normalize(export2.body)) === JSON.stringify(normalize(golden));
  check("B3", "再导出与正本逐字相等（round-trip 无损）", "键序归一化后完全一致（阶段 " + (golden?.stages?.length ?? 0) + " / 节点 " + nodeCount1 + "）", "stages=" + (export2.body?.stages?.length ?? 0) + " nodes=" + nodeCount2 + (roundTrip ? "（一致）" : "（不一致）"), roundTrip);

  const publishedBefore = imported.body?.publishedVersion ?? 0;
  const publish = await call("POST", "/api/v1/blueprint/publish?projectType=default");
  check("B4", "导入后发布幂等（无变更不递增版本）", "publishedVersion 保持 " + publishedBefore, "publishedVersion=" + (publish.body?.publishedVersion ?? "?") + " " + short({ status: publish.body?.status }, 80), publish.status === 200 && publish.body?.publishedVersion === publishedBefore);

  // ---------- 证据二：建项目快照 + 完成门禁 ----------
  const code = "POC9-" + new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const created = await call("POST", "/api/v1/projects", { code, name: "PoC-9 回放项目", projectType: "default", managerId: actorId });
  check("P1", "建项目（导入即快照）", "201 + 项目可见", created.status + " " + short({ id: created.body?.id, stageKey: created.body?.stageKey, version: created.body?.version }, 140), created.status === 201);
  const projectId = created.body.id;
  cleanup.projectId = projectId;

  const flow = await call("GET", "/api/v1/projects/" + projectId + "/flow");
  const stages = flow.body?.stages ?? [];
  const withRequirement = [];
  for (const stage of stages) {
    for (const node of stage.nodes ?? []) {
      const docs = (node.requirements ?? []).filter((item) => item.requirementType === "required_doc" && item.docType !== null);
      if (docs.length > 0) withRequirement.push({ stage, node, docs });
    }
  }
  check("P2", "快照含「必交成果文件」节点", "blueprintVersion >= 1 且存在 required_doc 节点", "blueprintVersion=" + flow.body?.blueprintVersion + " stages=" + stages.length + " 必交节点=" + withRequirement.length, flow.status === 200 && (flow.body?.blueprintVersion ?? 0) >= 1 && withRequirement.length > 0);
  const target = withRequirement[0];
  const targetNode = target.node;
  const targetDoc = target.docs[0].docType;

  const precheck1 = await call("GET", "/api/v1/nodes/" + targetNode.id + "/can-complete");
  check("G1", "预检（UI 置灰依据）：缺件时 canComplete=false + missing 明细", "canComplete=false / missing[].docType=" + targetDoc, short(precheck1.body, 220), precheck1.status === 200 && precheck1.body?.canComplete === false && (precheck1.body?.missing ?? []).some((item) => item.docType === targetDoc));

  const rejected = await call("POST", "/api/v1/nodes/" + targetNode.id + "/complete", { version: targetNode.version });
  const rejectedDetail = (rejected.body?.details ?? []).find((item) => item.code === "required_doc");
  check("G2", "服务端强校验：缺必交成果文件时完成被拒", "422 NODE_REQUIRED_DOC_MISSING + details[].code=required_doc", rejected.status + " " + short({ code: rejected.body?.code, detail: rejectedDetail?.meta }, 220), rejected.status === 422 && rejected.body?.code === "NODE_REQUIRED_DOC_MISSING" && rejectedDetail !== undefined);

  const trail = await db.query("select id, payload, created_at from outbox_events where topic = 'node.gate_rejected' and payload->>'nodeId' = $1 order by id desc limit 1", [targetNode.id]);
  const trailRow = trail.rows[0];
  check("G3", "拒绝留痕：outbox node.gate_rejected（事务回滚后补写）", "存在一条留痕且 payload.missing 非空", trailRow === undefined ? "未找到留痕行" : "id=" + trailRow.id + " missing=" + short(trailRow.payload?.missing, 160) + " actor=" + trailRow.payload?.actorId, trailRow !== undefined && Array.isArray(trailRow.payload?.missing) && trailRow.payload.missing.length > 0 && trailRow.payload?.actorId === actorId);

  const nodeAfterReject = await db.query("select status, done_at, version from project_nodes where id = $1", [targetNode.id]);
  const nodeRow = nodeAfterReject.rows[0];
  check("G4", "不部分生效：拒绝后节点未完成（status 未变 done、无完成时间、version 未推进）", "status != done / done_at is null / version 未变", short(nodeRow, 120) + " 期望 version=" + targetNode.version, nodeRow?.status !== "done" && nodeRow?.done_at === null && nodeRow?.version === targetNode.version);

  // 补齐该节点全部必交成果文件（模拟业务上传 + 定档；file / preview 模块随 i1）
  const seeded = [];
  for (const requirement of target.docs) {
    const insertedFile = await db.query("insert into files (project_id, node_id, doc_type, name, status, created_by) values ($1, $2, $3, $4, 'draft', $5) returning id", [projectId, targetNode.id, requirement.docType, "PoC-9 回放-" + requirement.docType + ".pdf", actorId]);
    const fileId = insertedFile.rows[0].id;
    cleanup.fileIds.push(fileId);
    const fileVersion = await db.query("insert into file_versions (file_id, seq, object_key, size_bytes, content_hash, mime, uploaded_by) values ($1, 1, $2, $3, $4, $5, $6) returning id", [fileId, "poc9/" + fileId, 1024, "sha256:poc9-replay", "application/pdf", actorId]);
    await db.query("update files set status = 'final', current_version_id = $2, finalized_at = now(), finalized_by = $3, updated_at = now() where id = $1", [fileId, fileVersion.rows[0].id, actorId]);
    seeded.push(requirement.docType);
  }
  report.push("| SEED | 已补定档成果文件：" + seeded.join(" / ") + " |");

  const precheck2 = await call("GET", "/api/v1/nodes/" + targetNode.id + "/can-complete");
  check("G5", "补齐定档成果文件后预检放行", "canComplete=true", short(precheck2.body, 160), precheck2.status === 200 && precheck2.body?.canComplete === true);

  const completed = await call("POST", "/api/v1/nodes/" + targetNode.id + "/complete", { version: targetNode.version });
  const completedNode = completed.body?.node ?? completed.body;
  check("G6", "补齐后完成 200（拒绝只因缺件）", "200 + 节点 done + doneAt 非空", completed.status + " " + short({ status: completedNode?.status, doneAt: completedNode?.doneAt }, 160), completed.status === 200 && completedNode?.status === "done" && completedNode?.doneAt !== null);

  const completedTrail = await db.query("select count(*)::int as n from outbox_events where topic = 'node.completed' and payload->>'nodeId' = $1", [targetNode.id]);
  check("G7", "完成事件入 outbox（node.completed）", "存在 >= 1 条", "count=" + completedTrail.rows[0].n, completedTrail.rows[0].n >= 1);
} catch (error) {
  failures += 1;
  report.push("| FAIL | 中断：" + (error instanceof Error ? error.message : String(error)));
  process.stderr.write("PoC-9 回放失败：" + (error instanceof Error ? error.message : String(error)) + "\n");
} finally {
  if (db !== undefined) {
    try {
      if (args.keep !== true) {
        for (const fileId of cleanup.fileIds) {
          await db.query("update files set current_version_id = null where id = $1", [fileId]);
          await db.query("delete from file_versions where file_id = $1", [fileId]);
          await db.query("delete from files where id = $1", [fileId]);
        }
        if (cleanup.projectId !== null) {
          const row = await db.query("select version from projects where id = $1", [cleanup.projectId]);
          if (row.rows[0] !== undefined) {
            await call("DELETE", "/api/v1/projects/" + cleanup.projectId, undefined, { "if-match": String(row.rows[0].version) });
          }
        }
      }
      if (token !== "") await db.query("update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null", [sha256(token)]);
    } catch (error) {
      report.push("| WARN | 收尾未完全成功：" + (error instanceof Error ? error.message : String(error)));
    }
    await db.end();
  }
}

const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd() }).toString().trim();
const lines = [];
lines.push("# PoC-9 回放证据（蓝图 round-trip 与门禁拒绝）");
lines.push("");
lines.push("> 卡片：" + "h5 · S6·PoC-9" + "（主责 wmj，协办 px）｜验收口径见 " + "团队分工.md" + " §6 第 9 行：蓝图导出 → 导入 round-trip 无损；缺必交成果文件时完成被拒（UI 置灰 + 服务端强校验 + 留痕）。");
lines.push("");
lines.push("| 项 | 值 |");
lines.push("|---|---|");
lines.push("| 回放时间 | " + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ") + " +08:00 |");
lines.push("| 目标 | " + BASE_URL + " | ");
lines.push("| 数据库 | " + DATABASE_URL.replace(/:[^:@/]+@/, ":***") + " |");
lines.push("| 代码版本 | " + commit + " |");
lines.push("| 执行账号 | " + (cleanup.actorId ?? "-") + "（管理员） |");
lines.push("| 脚本 | " + "server/scripts/poc9-replay.mjs" + " |");
lines.push("");
lines.push("## 断言明细");
lines.push("");
lines.push(...report);
lines.push("");
lines.push("## 汇总");
lines.push("");
lines.push(failures === 0 ? "- ✅ 全部断言通过（" + evidence.steps.filter((step) => step.ok).length + " 项）：round-trip 无损、门禁拒绝 422 + 留痕 + 不部分生效、补齐定档文件后放行。" : "- ❌ 有 " + failures + " 项失败，见上方 FAIL 行。");
lines.push("");
lines.push("## 验收对照（团队分工.md §6 第 9 行）");
lines.push("");
lines.push("- 「蓝图导出 → 导入 round-trip 无损」= B1 ~ B4：导出正本 → 导入同一份 → 再导出逐字相等（键序归一化）+ 发布幂等（无变更不递增版本）。");
lines.push("- 「缺必交成果文件时完成被拒 · UI 置灰」= G1 / G5：`can-complete` 预检缺件 false、补齐后 true（前端置灰只作展示依据，不替代服务端判定）。");
lines.push("- 「缺必交成果文件时完成被拒 · 服务端强校验」= G2：422 `NODE_REQUIRED_DOC_MISSING` + `details[].code=required_doc`（事务内判定，不经前端）。");
lines.push("- 「缺必交成果文件时完成被拒 · 留痕」= G3 / G4 / G7：`node.gate_rejected`（含 missing 明细与操作人、事务回滚后补写）且节点未部分生效；补齐后 `node.completed`。");
lines.push("- CI 回归（不连库）：`server/test/flow-gate-rejection.test.ts`（5 例）随 `npm test` 常跑；真机闭环用本脚本复跑。");
lines.push("- 复跑：" + "cd server && node scripts/poc9-replay.mjs");
lines.push("");

const markdown = lines.join("\n") + "\n";
if (args.out !== undefined) { writeFileSync(args.out, markdown, "utf8"); process.stdout.write("报告已写入 " + args.out + "\n"); }
if (args.json !== undefined) { writeFileSync(args.json, JSON.stringify({ baseUrl: BASE_URL, commit, ranAt: new Date().toISOString(), failures, steps: evidence.steps }, null, 2), "utf8"); }
process.stdout.write(failures === 0 ? "PoC-9 回放通过（" + evidence.steps.length + " 项断言）\n" : "PoC-9 回放失败（" + failures + " 项）\n");
process.exit(failures === 0 ? 0 : 1);
