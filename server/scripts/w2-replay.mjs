#!/usr/bin/env node
/**
 * w2 真机回放（任务落库口径 A15 / A18 / A19 / A20 · Push 124）：
 *   证据一（A15 · 阶段可空）：不传 / 显式 null 建「临时任务」→ stageKey=null（未分组）；默认读序里未分组落在九阶段之后；
 *           未分组任务不计入阶段完成度（GET /projects/{id}/stages 的 tasks 计数只算带阶段任务）。
 *   证据二（A18 / A23 · 负责人可空 + 可多位）：显式 ownerIds=[] 建任务 = 「待分配」（不兜底项目经理）；
 *           编辑支持显式置空（ownerIds=[]，卡片拖进「待分配」列 = 清空负责人）；不传 ownerIds = 不改（不误清）。
 *   证据三（A19 / A20 · 顺序持久化）：插入位次 / 拖动重排写 tasks.sort_index（一组 = 同一项目 + 同一阶段，组内 0 起、密集）；
 *           刷新 / 重新拉列表顺序不变（落库不是内存态）；越界 = 组尾；旧 version 重放 409 且不部分生效；组之间互不影响。
 *   另有节点来源口径（带 taskNodeId 缺省取节点阶段、显式不一致 400、同节点重复 409）与字段级留痕（audit_logs 的 from / to）。
 *
 * 前置：真 PG（DATABASE_URL）+ 真 api（BASE_URL）。本脚本只在本地沙箱 / 联调库跑，会：新建临时会话（跑完撤销）、
 *      建一个 W2-xxx 回放项目与若干任务（跑完硬删回放项目及其节点 / 阶段 / 任务 / outbox 事件，对齐 poc6 收尾口径）。
 * 用法：cd server && node scripts/w2-replay.mjs [--out <报告.md>] [--json <证据.json>] [--actor <userId>] [--keep]
 * 退出码：断言全过 = 0，否则 = 1（可当门禁用）。
 */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { Client } from "pg";

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.baseUrl ?? process.env.W2_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3011";
const DATABASE_URL = args.databaseUrl ?? process.env.DATABASE_URL ?? "postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink";
const CSRF = randomBytes(16).toString("hex");
const report = [];
const evidence = { steps: [] };
let failures = 0;
let token = "";
let db;

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
  if (!ok) throw new Error("w2 回放失败（" + id + "）：" + title);
}

function short(value, max = 320) {
  const text = JSON.stringify(value);
  return text === undefined ? "undefined" : text.length > max ? text.slice(0, max) + "…" : text;
}

async function createTask(projectId, body) {
  return call("POST", "/api/v1/projects/" + projectId + "/tasks", body);
}

async function patchTask(projectId, taskId, body) {
  return call("PATCH", "/api/v1/projects/" + projectId + "/tasks/" + taskId, body);
}

async function listTasks(projectId) {
  return call("GET", "/api/v1/projects/" + projectId + "/tasks?page=1&limit=100");
}

function groupItems(items, stageKey) {
  return items
    .filter((item) => item.stageKey === stageKey)
    .sort((a, b) => (a.sortIndex !== b.sortIndex ? a.sortIndex - b.sortIndex : a.id < b.id ? -1 : 1));
}

function indexList(items) {
  return items.map((item) => item.sortIndex).join(",");
}

const cleanup = { projectId: null, actorId: null };

try {
  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  const health = await fetch(BASE_URL + "/healthz").then((response) => response.status).catch(() => 0);
  if (health !== 200) throw new Error("api 不可用（" + BASE_URL + "/healthz → " + health + "）；先起 api 再跑本脚本");

  // ---------- 会话（管理员；跑完撤销） ----------
  const actorId = args.actor ?? (await db.query("select u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where r.code = $1 and u.status = $2 order by u.id limit 1", ["admin", "active"])).rows[0]?.id;
  if (actorId === undefined) throw new Error("找不到可用的管理员账号（roles.code = admin）");
  cleanup.actorId = actorId;
  token = "w2-" + randomBytes(16).toString("hex");
  await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + interval '2 hours')", [sha256(token), actorId, "w2-replay"]);
  const me = await call("GET", "/api/v1/users?limit=1");
  check("S1", "会话可用（管理员会话已铸）", "GET /api/v1/users 200", me.status + " " + short(me.body, 80), me.status === 200);

  // ---------- 回放项目（导入即快照） ----------
  const code = "W2-" + new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const created = await call("POST", "/api/v1/projects", { code, name: "w2 回放项目（任务落库口径）", projectType: "default", managerIds: [actorId] });
  check("P1", "建项目（导入即快照）", "201 + 项目可见", created.status + " " + short({ id: created.body?.id, stageKey: created.body?.stageKey, version: created.body?.version }, 140), created.status === 201);
  const projectId = created.body.id;
  cleanup.projectId = projectId;

  const flow = await call("GET", "/api/v1/projects/" + projectId + "/flow");
  const stages = flow.body?.stages ?? [];
  const nodes = [];
  for (const stage of stages) {
    for (const node of stage.nodes ?? []) nodes.push({ stageKey: stage.stageKey, nodeId: node.id, version: node.version });
  }
  const nodeStage = stages.find((stage) => (stage.nodes ?? []).length >= 2);
  const otherStage = stages.find((stage) => stage.stageKey !== nodeStage?.stageKey);
  const nodeA = nodeStage?.nodes?.[0];
  const nodeB = nodeStage?.nodes?.[1];
  check("P2", "快照含同一阶段的可建任务节点（供节点来源口径用）", "同一阶段 >= 2 个节点 + 另有其他阶段", "stages=" + stages.length + " nodes=" + nodes.length + " 同阶段节点=" + (nodeStage?.nodes ?? []).length, flow.status === 200 && stages.length >= 2 && nodes.length >= 2 && nodeA !== undefined && nodeB !== undefined && otherStage !== undefined);

  // ---------- A15 · 阶段可空（未分组） ----------
  const t1 = await createTask(projectId, { title: "临时任务·未分组甲" });
  const task1 = t1.body;
  check("A1", "临时任务不传 stageKey = 「未分组」，落组首位次 0", "201 + stageKey=null + sortIndex=0", t1.status + " " + short({ stageKey: task1?.stageKey, sortIndex: task1?.sortIndex }, 140), t1.status === 201 && task1?.stageKey === null && task1?.sortIndex === 0);
  check("A2", "创建不传 ownerIds = 项目全部项目经理兜底（A23 · Push 136：数组，与 A18 的显式 [] 区分）", "ownerIds=[" + actorId + "]", JSON.stringify(task1?.ownerIds), Array.isArray(task1?.ownerIds) && task1.ownerIds.length === 1 && task1.ownerIds[0] === actorId);

  const t2 = await createTask(projectId, { title: "临时任务·未分组乙", stageKey: null });
  const task2 = t2.body;
  check("A3", "显式 stageKey=null 同样落「未分组」；缺省位次 = 组尾 1", "201 + stageKey=null + sortIndex=1", t2.status + " " + short({ stageKey: task2?.stageKey, sortIndex: task2?.sortIndex }, 140), t2.status === 201 && task2?.stageKey === null && task2?.sortIndex === 1);

  const t3 = await createTask(projectId, { title: "临时任务·未分组丙（插队）", sortIndex: 0 });
  const task3 = t3.body;
  check("A4", "插入位次 0：新任务占组首（A20「插入位置」）", "201 + sortIndex=0", t3.status + " " + short({ stageKey: task3?.stageKey, sortIndex: task3?.sortIndex }, 140), t3.status === 201 && task3?.sortIndex === 0);

  const list1 = await listTasks(projectId);
  const group1 = groupItems(list1.body?.items ?? [], null);
  const order1 = group1.map((item) => item.title).join(" → ");
  check("A5", "同组其余位次顺延：丙(0) → 甲(1) → 乙(2)", "丙 → 甲 → 乙（0,1,2）", order1 + "（" + indexList(group1) + "）", list1.status === 200 && order1 === "临时任务·未分组丙（插队） → 临时任务·未分组甲 → 临时任务·未分组乙" && indexList(group1) === "0,1,2");

  const stagesView1 = await call("GET", "/api/v1/projects/" + projectId + "/stages");
  const stageTotal1 = (stagesView1.body?.stages ?? []).reduce((sum, stage) => sum + (stage.tasks?.total ?? 0), 0);
  check("A6", "未分组任务不计入九阶段完成度（此时阶段任务数应为 0）", "sum(tasks.total)=0（未分组 3 条）", "sum=" + stageTotal1 + " ungrouped=" + group1.length, stagesView1.status === 200 && stageTotal1 === 0 && group1.length === 3);

  // ---------- A18 · 负责人可空（待分配） ----------
  const t4 = await createTask(projectId, { title: "临时任务·待分配丁", ownerIds: [] });
  const task4 = t4.body;
  check("B1", "显式 ownerIds=[] = 「待分配」（不兜底项目经理）", "201 + ownerIds=[]", t4.status + " " + short({ ownerIds: task4?.ownerIds, sortIndex: task4?.sortIndex }, 140), t4.status === 201 && Array.isArray(task4?.ownerIds) && task4.ownerIds.length === 0);

  const detail4a = await call("GET", "/api/v1/projects/" + projectId + "/tasks/" + task4.id);
  check("B2", "详情 ownerNames = []（待分配随行下发）", "200 + ownerNames=[]", detail4a.status + " " + short({ ownerIds: detail4a.body?.ownerIds, ownerNames: detail4a.body?.ownerNames, sortIndex: detail4a.body?.sortIndex }, 160), detail4a.status === 200 && Array.isArray(detail4a.body?.ownerNames) && detail4a.body.ownerNames.length === 0);

  const assigned = await patchTask(projectId, task4.id, { version: task4.version, ownerIds: [actorId] });
  check("B3", "分配负责人（ownerIds 传数组）", "200 + ownerIds=[" + actorId + "]", assigned.status + " " + short({ ownerIds: assigned.body?.ownerIds, version: assigned.body?.version }, 140), assigned.status === 200 && Array.isArray(assigned.body?.ownerIds) && assigned.body.ownerIds.length === 1 && assigned.body.ownerIds[0] === actorId);

  const list2 = await listTasks(projectId);
  const item4 = (list2.body?.items ?? []).find((item) => item.id === task4.id);
  check("B4", "列表 ownerNames 随行下发（分配后非空数组）", "ownerNames 非空", "ownerNames=" + JSON.stringify(item4?.ownerNames), item4 !== undefined && Array.isArray(item4.ownerNames) && item4.ownerNames.length === 1 && item4.ownerNames[0] !== null);

  const noteOnly = await patchTask(projectId, task4.id, { version: assigned.body.version, note: "只改备注，不动负责人" });
  check("B5", "不传 ownerIds = 不改（只改备注不误清负责人）", "200 + ownerIds 保持 [" + actorId + "]", noteOnly.status + " " + short({ ownerIds: noteOnly.body?.ownerIds, note: noteOnly.body?.note }, 140), noteOnly.status === 200 && Array.isArray(noteOnly.body?.ownerIds) && noteOnly.body.ownerIds.length === 1 && noteOnly.body.ownerIds[0] === actorId && noteOnly.body?.note === "只改备注，不动负责人");

  const cleared = await patchTask(projectId, task4.id, { version: noteOnly.body.version, ownerIds: [] });
  check("B6", "显式 ownerIds=[] = 置空为「待分配」（拖进「待分配」列）", "200 + ownerIds=[]", cleared.status + " " + short({ ownerIds: cleared.body?.ownerIds, version: cleared.body?.version }, 140), cleared.status === 200 && Array.isArray(cleared.body?.ownerIds) && cleared.body.ownerIds.length === 0);

  const dbOwner = await db.query("select owner_ids from tasks where id = $1", [task4.id]);
  check("B7", "落库为空数组（tasks.owner_ids 多位口径生效）", "owner_ids = []", JSON.stringify(dbOwner.rows[0]?.owner_ids), Array.isArray(dbOwner.rows[0]?.owner_ids) && dbOwner.rows[0].owner_ids.length === 0);

  // ---------- A19 / A20 · 顺序持久化 ----------
  const moved = await patchTask(projectId, task4.id, { version: cleared.body.version, sortIndex: 0 });
  check("C1", "拖动到组首：sortIndex=0（被顶下去的顺延）", "200 + sortIndex=0", moved.status + " " + short({ sortIndex: moved.body?.sortIndex, version: moved.body?.version }, 140), moved.status === 200 && moved.body?.sortIndex === 0);

  const list3 = await listTasks(projectId);
  const group3 = groupItems(list3.body?.items ?? [], null);
  const order3 = group3.map((item) => item.title).join(" → ");
  check("C2", "刷新（重新拉列表）顺序保持 —— 持久化，不是内存态", "丁 → 丙 → 甲 → 乙（0,1,2,3）", order3 + "（" + indexList(group3) + "）", order3 === "临时任务·待分配丁 → 临时任务·未分组丙（插队） → 临时任务·未分组甲 → 临时任务·未分组乙" && indexList(group3) === "0,1,2,3");

  const dbGroup = await db.query("select title, sort_index from tasks where project_id = $1 and stage_key is null order by sort_index, id", [projectId]);
  check("C3", "库内位次 0 起密集（无空洞、无重复）", "sort_index = 0,1,2,3", dbGroup.rows.map((row) => row.sort_index).join(","), dbGroup.rows.map((row) => row.sort_index).join(",") === "0,1,2,3");

  const current4 = await call("GET", "/api/v1/projects/" + projectId + "/tasks/" + task4.id);
  const beyond = await patchTask(projectId, task4.id, { version: current4.body.version, sortIndex: 999 });
  check("C4", "越界位次 = 落到组尾（不报错、不产生空洞）", "200 + sortIndex=3", beyond.status + " " + short({ sortIndex: beyond.body?.sortIndex, version: beyond.body?.version }, 140), beyond.status === 200 && beyond.body?.sortIndex === 3);

  const stale = await patchTask(projectId, task4.id, { version: moved.body.version, sortIndex: 1 });
  const dbAfterStale = await db.query("select sort_index from tasks where id = $1", [task4.id]);
  check("C5", "乐观锁：旧 version 重放 409，位次不变（不部分生效）", "409 VERSION_CONFLICT + sort_index 仍为 3", stale.status + " " + short(stale.body, 120) + " sort_index=" + String(dbAfterStale.rows[0]?.sort_index), stale.status === 409 && stale.body?.code === "VERSION_CONFLICT" && dbAfterStale.rows[0]?.sort_index === 3);

  // ---------- 节点来源口径 + 组隔离 ----------
  const nodeTaskA = await createTask(projectId, { title: "节点任务·甲", taskNodeId: nodeA.id });
  check("D1", "节点任务缺省取节点阶段（stageKey 不传 = 节点所属阶段）", "201 + stageKey=" + nodeStage.stageKey, nodeTaskA.status + " " + short({ stageKey: nodeTaskA.body?.stageKey, sortIndex: nodeTaskA.body?.sortIndex }, 140), nodeTaskA.status === 201 && nodeTaskA.body?.stageKey === nodeStage.stageKey);
  check("D2", "节点任务落该阶段组尾（新组位次从 0 起）", "sortIndex=0", String(nodeTaskA.body?.sortIndex), nodeTaskA.body?.sortIndex === 0);

  const dup = await createTask(projectId, { title: "节点任务·甲（重复）", taskNodeId: nodeA.id });
  check("D3", "同节点重复创建 409 TASK_ALREADY_EXISTS（按节点判重）", "409 TASK_ALREADY_EXISTS", dup.status + " " + short(dup.body, 120), dup.status === 409 && dup.body?.code === "TASK_ALREADY_EXISTS");

  const mismatch = await createTask(projectId, { title: "节点任务·乙（阶段不一致）", taskNodeId: nodeB.id, stageKey: otherStage.stageKey });
  check("D4", "显式 stageKey 与来源节点不一致 400（不静默改写）", "400 VALIDATION_FAILED", mismatch.status + " " + short(mismatch.body, 140), mismatch.status === 400 && mismatch.body?.code === "VALIDATION_FAILED");

  const nodeTaskB = await createTask(projectId, { title: "节点任务·乙", taskNodeId: nodeB.id, stageKey: nodeStage.stageKey });
  check("D5", "显式 stageKey 与节点一致：放行并落同组组尾", "201 + stageKey=" + nodeStage.stageKey + " + sortIndex=1", nodeTaskB.status + " " + short({ stageKey: nodeTaskB.body?.stageKey, sortIndex: nodeTaskB.body?.sortIndex }, 150), nodeTaskB.status === 201 && nodeTaskB.body?.stageKey === nodeStage.stageKey && nodeTaskB.body?.sortIndex === 1);

  const list4 = await listTasks(projectId);
  const items4 = list4.body?.items ?? [];
  const stageGroup4 = groupItems(items4, nodeStage.stageKey);
  const movedToHead = await patchTask(projectId, nodeTaskB.body.id, { version: nodeTaskB.body.version, sortIndex: 0 });
  const list5 = await listTasks(projectId);
  const stageGroup5 = groupItems(list5.body?.items ?? [], nodeStage.stageKey);
  const ungrouped5 = groupItems(list5.body?.items ?? [], null);
  check("C6", "阶段组重排：组内位次重写为 0 起（乙 拖到组首 = 甲 × 乙 互换）", "阶段组 = 乙(0) → 甲(1)", "阶段组=" + stageGroup5.map((item) => item.title).join(" → ") + "（" + indexList(stageGroup5) + "）", movedToHead.status === 200 && movedToHead.body?.sortIndex === 0 && stageGroup5.map((item) => item.title).join(" → ") === "节点任务·乙 → 节点任务·甲" && indexList(stageGroup5) === "0,1");
  check("C7", "组隔离：未分组组位次不受阶段组重排影响（仍 0,1,2,3）", "未分组 = 0,1,2,3", "未分组=" + indexList(ungrouped5), indexList(ungrouped5) === "0,1,2,3" && ungrouped5.length === 4);
  const stageCount4 = items4.filter((item) => item.stageKey !== null).length;
  const stageBlock4 = items4.slice(0, stageCount4);
  const tailBlock4 = items4.slice(stageCount4);
  check("C8", "默认读序：带阶段任务成块在前、未分组落最后（总览「未分组」在最后一组）", "2 条带阶段在前 + 其后全为未分组（共 6 条）", "带阶段=" + stageCount4 + " 未分组=" + tailBlock4.length + " 尾块全为未分组=" + tailBlock4.every((item) => item.stageKey === null), list4.status === 200 && items4.length === 6 && stageCount4 === 2 && stageBlock4.every((item) => item.stageKey !== null) && tailBlock4.every((item) => item.stageKey === null) && stageGroup4.length === 2);

  const stagesView2 = await call("GET", "/api/v1/projects/" + projectId + "/stages");
  const stageTotal2 = (stagesView2.body?.stages ?? []).reduce((sum, stage) => sum + (stage.tasks?.total ?? 0), 0);
  check("A7", "阶段完成度只算带阶段任务：sum(tasks.total)=2（未分组 4 条不计）", "sum=2", "sum=" + stageTotal2, stagesView2.status === 200 && stageTotal2 === 2);

  // ---------- 留痕（C7-02 字段级） ----------
  const auditRows = await db.query("select changes from audit_logs where object_type = $1 and object_id = $2 and action = $3 order by id desc limit 20", ["task", task4.id, "update"]);
  const changes = auditRows.rows.flatMap((row) => row.changes ?? []);
  const sortChange = changes.find((change) => change.field === "sortIndex");
  const ownerChange = changes.find((change) => change.field === "ownerIds" && Array.isArray(change.to) && change.to.length === 0);
  check("E1", "C7-02 字段级留痕：sortIndex 变更记 from / to", "存在 field=sortIndex 的 from / to", short(sortChange ?? null, 160), sortChange !== undefined && typeof sortChange.from === "number" && typeof sortChange.to === "number");
  check("E2", "A18 / A23 留痕：ownerIds 置空记 from=已分配 → to=[]", "存在 field=ownerIds 且 to=[]", short(ownerChange ?? null, 160), ownerChange !== undefined && Array.isArray(ownerChange.from) && ownerChange.from[0] === actorId && Array.isArray(ownerChange.to) && ownerChange.to.length === 0);

  const outbox = await db.query("select count(*)::int as n from outbox_events where topic = $1 and payload->>$2 = $3", ["task.created", "projectId", projectId]);
  check("E3", "写路径不变：task.created 入 outbox（topic / 载荷口径未变）", ">= 6 条", "count=" + outbox.rows[0].n, outbox.rows[0].n >= 6);
} catch (error) {
  failures += 1;
  report.push("| FAIL | 中断：" + (error instanceof Error ? error.message : String(error)));
  process.stderr.write("w2 回放失败：" + (error instanceof Error ? error.message : String(error)) + "\n");
} finally {
  if (db !== undefined) {
    try {
      if (args.keep !== true && cleanup.projectId !== null) {
        await db.query("delete from task_events where task_id in (select id from tasks where project_id = $1)", [cleanup.projectId]);
        await db.query("delete from tasks where project_id = $1", [cleanup.projectId]);
        await db.query("delete from outbox_events where payload::text like $$%$$ || $1::text || $$%$$", [cleanup.projectId]);
        await db.query("delete from node_requirements where node_id in (select id from project_nodes where project_id = $1)", [cleanup.projectId]);
        await db.query("delete from project_nodes where project_id = $1", [cleanup.projectId]);
        await db.query("delete from project_stages where project_id = $1", [cleanup.projectId]);
        await db.query("delete from project_members where project_id = $1", [cleanup.projectId]);
        await db.query("delete from projects where id = $1", [cleanup.projectId]);
      }
      if (token !== "") await db.query("update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null", [sha256(token)]);
    } catch (error) {
      report.push("| WARN | 收尾未完全成功：" + (error instanceof Error ? error.message : String(error)));
    }
    await db.end();
  }
}

const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd() }).toString().trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: process.cwd() }).toString().trim() !== "";
const lines = [];
lines.push("# w2 回放证据（任务落库口径：阶段可空 / 负责人可空 / 顺序持久化）");
lines.push("");
lines.push("> 卡片：w2 · 「A15 / A18 / A19 / A20 任务落库口径落地：顺序持久化 + 阶段可空 + 负责人可空」（主责 wmj，评审 px）｜口径来源：前端功能需求.md 附录 A15 / A18 / A19 / A20（Push 119 / 120 定案）、字段对照清单.md §七。");
lines.push("");
lines.push("| 项 | 值 |");
lines.push("|---|---|");
lines.push("| 回放时间 | " + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ") + " +08:00 |");
lines.push("| 目标 | " + BASE_URL + " |");
lines.push("| 数据库 | " + DATABASE_URL.replace(/:[^:@/]+@/, ":***") + " |");
lines.push("| 代码版本 | " + commit + (dirty ? "（回放时工作区含本卡未提交改动）" : "") + " |");
lines.push("| 执行账号 | " + (cleanup.actorId ?? "-") + "（管理员） |");
lines.push("| 脚本 | server/scripts/w2-replay.mjs |");
lines.push("");
lines.push("## 断言明细");
lines.push("");
lines.push(...report);
lines.push("");
lines.push("## 汇总");
lines.push("");
lines.push(failures === 0 ? "- ✅ 全部断言通过（" + evidence.steps.filter((step) => step.ok).length + " 项）：未分组落库 + 待分配可空 + 组内位次持久化（含越界 / 乐观锁 / 组隔离）+ 节点来源口径 + 字段级留痕。" : "- ❌ 有 " + failures + " 项失败，见上方 FAIL 行。");
lines.push("");
lines.push("## 验收对照（A15 / A18 / A19 / A20）");
lines.push("");
lines.push("- A15「阶段允许为空（临时任务）」= A1 ~ A7 / C8：不传或显式 null 都落 stageKey=null；默认读序未分组在九阶段之后；阶段完成度（GET /projects/{id}/stages）只算带阶段任务，未分组不计入。");
lines.push("- A18 / A23「负责人允许为空（待分配）+ 可多位」= B1 ~ B7：显式 ownerIds=[] = 待分配（不兜底项目经理）；传数组 = 分配（原顺序即展示顺序）；不传 = 不改；再置 [] = 清空（卡片拖进「待分配」列）。");
lines.push("- A19 / A20「顺序持久化」= C1 ~ C7：插入位次与拖动重排写 tasks.sort_index（组内 0 起、密集），刷新后不变；越界 = 组尾；旧 version 409 且不部分生效；组之间互不影响。");
lines.push("- 契约与落库一致性：tasks.sort_index 由迁移 0015 落库（回填按迁移前默认读序，迁移前后读序一致）；shared 的 Task / TaskCreateBody / TaskUpdateBody 与 Drizzle schema 同步（check:db-schema：27 表 · 265 列 · 77 索引 · 75 CHECK 一致）。");
lines.push("- CI 回归（不连库）：server/test/task-order.test.ts（纯函数 4 例）+ server/test/task-service.test.ts（口径 5 例）随 npm test 常跑；真机闭环用本脚本复跑。");
lines.push("- 复跑：cd server && node scripts/w2-replay.mjs --out ../docs/w2-回放证据(任务落库口径A15A18A19).md");
lines.push("");

if (args.json !== undefined) writeFileSync(args.json, JSON.stringify(evidence, null, 2) + "\n", "utf8");
if (args.out !== undefined) writeFileSync(args.out, lines.join("\n"), "utf8");
process.stdout.write(lines.join("\n") + "\n");
process.exit(failures === 0 ? 0 : 1);
