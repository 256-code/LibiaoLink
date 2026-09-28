#!/usr/bin/env node
/**
 * M3-07 刀 3 真机回放（业务定案 2026-09-24）：添加任务模板化 —— 节点库来源（sourceNodeId）+ 模板实例化（from-template）。
 *
 * 真机（真 PG + 真 api）验到的部分：
 *   ① 逐条来源：POST /projects/{id}/tasks 带 sourceNodeId —— 任务描述 / 英文名 / 阶段取节点库现值（A1-17 锁定字段）、
 *      落 tasks.task_node_id；同项目同一节点重复 409 TASK_ALREADY_EXISTS；taskNodeId（项目流程节点）与 sourceNodeId 二选一 400；
 *      节点不存在 400；阶段与节点不一致 400。
 *   ② 模板实例化：POST /projects/{id}/tasks/from-template —— 整批同事务、按模板内顺序落位；
 *      已存在节点缺省跳过（skipped）、skipExisting=false 时 409 且整批回滚（撞到后面的冲突也不落半批）；
 *      nodeIds 子集 / 空数组 / 空模板 / 模板不存在（404）。
 *   ③ 判重粒度 =（项目 x 节点库节点）且只看未删行：软删该任务后同一节点回到「可添加」。
 *   ④ 来源节点物理删（节点库 DELETE）→ tasks.task_node_id 置 null（on delete set null），任务保留。
 *   ⑤ 锁定字段：任务描述只在生成时取节点现值 —— 之后改节点名不影响已生成任务；新任务取改名后的现值。
 *   ⑥ 位次（A19 / A20）：模板整批按 sortIndex 起依次落位、同组其余任务顺延。
 *   ⑦ 留痕：审计（source=task_node / kind=from_template + templateId）与 outbox task.created 逐条。
 *
 * 前置：真 PG（DATABASE_URL）+ 真 api（--base-url，默认 http://127.0.0.1:3001）；脚本自建临时节点 / 模板 / 项目 / 任务，跑完清理（零残留）。
 * 用法：cd server && node scripts/m3-07-replay-from-template.mjs [--out <报告.md>] [--json <证据.json>] [--base-url <url>] [--keep]
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
const NODE_STAGE = "design";
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

const cleanup = { actorId: null, sessionToken: null, projectIds: [], taskRefs: [], nodeIds: [], templateIds: [] };
const db = new Client({ connectionString: DATABASE_URL });

let call = null;
try {
  await db.connect();

  const health = await fetch(BASE_URL + "/healthz").then((response) => response.status).catch(() => 0);
  check("S1", "真机 api 在跑", "200", String(health), health === 200, BASE_URL);

  const admin = (await db.query("select u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where r.code = $$admin$$ and u.status = $$active$$ order by u.id limit 1")).rows[0];
  if (admin === undefined) throw new Error("找不到管理员账号（roles.code = admin）");
  cleanup.actorId = admin.id;
  const token = "m307tpl-" + randomBytes(12).toString("hex");
  cleanup.sessionToken = token;
  await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + make_interval(hours => 2))", [sha256(token), admin.id, "m3-07-from-template"]);
  call = caller(token);

  const me = await call("GET", "/auth/me");
  check("S2", "临时管理员会话可用", "200", me.status + " " + truncate(me.body, 160), me.status === 200);

  const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace(/[-:T]/g, "");

  async function newProject(tag) {
    const res = await call("POST", "/api/v1/projects", { code: "M307T" + tag + "-" + stamp, name: "M3-07 刀 3 回放 " + tag + "（临时）", region: "未分类", projectType: "未分类", managerIds: [admin.id], stageKey: "presale" });
    if (res.status !== 201) throw new Error("临时项目创建失败：" + res.status + " " + truncate(res.body, 200));
    cleanup.projectIds.push(res.body.id);
    return res.body;
  }

  async function newTask(projectId, body) {
    const res = await call("POST", "/api/v1/projects/" + projectId + "/tasks", body);
    if (res.status !== 201) throw new Error("临时任务创建失败：" + res.status + " " + truncate(res.body, 200));
    cleanup.taskRefs.push({ projectId, taskId: res.body.id });
    return res.body;
  }

  function trackTask(projectId, task) {
    if (task !== undefined && task !== null) cleanup.taskRefs.push({ projectId, taskId: task.id });
    return task;
  }

  function trackCreated(projectId, created) {
    for (const item of created ?? []) cleanup.taskRefs.push({ projectId, taskId: item.id });
    return created;
  }

  async function newNode(title, titleEn) {
    const res = await call("POST", "/api/v1/task-nodes", { stageKey: NODE_STAGE, title, titleEn });
    if (res.status !== 201) throw new Error("临时节点创建失败：" + res.status + " " + truncate(res.body, 200));
    cleanup.nodeIds.push(res.body.id);
    return res.body;
  }

  async function newTemplate(name, nodeIds) {
    const res = await call("POST", "/api/v1/task-templates", { name, stageKey: NODE_STAGE, nodeIds });
    if (res.status !== 201) throw new Error("临时模板创建失败：" + res.status + " " + truncate(res.body, 200));
    cleanup.templateIds.push(res.body.id);
    return res.body;
  }

  async function tasksOf(projectId) {
    return (await db.query("select id, title, title_en, stage_key, status, progress, sort_index, task_node_id, node_id, priority, deleted_at from tasks where project_id = $1 order by sort_index, id", [projectId])).rows;
  }

  async function liveTasksOf(projectId) {
    return (await db.query("select id, title, title_en, stage_key, status, progress, sort_index, task_node_id, node_id, priority from tasks where project_id = $1 and deleted_at is null order by sort_index, id", [projectId])).rows;
  }

  async function projectStampOf(projectId) {
    return (await db.query("select to_char(updated_at, $$YYYY-MM-DD HH24:MI:SS.US$$) as at from projects where id = $1", [projectId])).rows[0].at;
  }

  async function nodeRow(id) {
    return (await db.query("select id, title, title_en, stage_key from task_nodes where id = $1", [id])).rows[0];
  }

  const projectA = await newProject("A");
  const A = projectA.id;
  check("S3", "临时项目 A（模板整套专场）", "201 + 有 id", String(A), typeof A === "string" && A.length === 36);

  const nodeTitle1 = "回放·布局定档·" + stamp;
  const nodeTitle2 = "回放·技术协议定档·" + stamp;
  const nodeTitle3 = "回放·合同签署·" + stamp;
  const nodeTitle4 = "回放·待删节点·" + stamp;
  const nodeTitle5 = "回放·非模板节点·" + stamp;
  const n1 = await newNode(nodeTitle1, "Layout scheduling");
  const n2 = await newNode(nodeTitle2, null);
  const n3 = await newNode(nodeTitle3, "Contract signing");
  const n4 = await newNode(nodeTitle4, null);
  const n5 = await newNode(nodeTitle5, null);
  check("S4", "节点库临时节点 5 条（阶段 design）", "5 x 201 + title / titleEn 回读一致", "n1=" + n1.title + " / " + String(n1.titleEn) + " / n2.titleEn=" + String(n2.titleEn), typeof n1.id === "string" && typeof n5.id === "string" && n1.title === nodeTitle1 && n1.titleEn === "Layout scheduling" && n2.titleEn === null && n1.stageKey === NODE_STAGE);

  const tplName = "回放模板·整套·" + stamp;
  const tpl = await newTemplate(tplName, [n1.id, n2.id, n3.id]);
  check("S5", "模板 T1（3 个节点，顺序 = 传入顺序）", "201 + nodes 顺序 [n1, n2, n3] 且 title 随行", truncate({ name: tpl.name, nodes: tpl.nodes?.map((node) => node.nodeId) }), tpl.stageKey === NODE_STAGE && (tpl.nodes ?? []).length === 3 && (tpl.nodes ?? []).map((node) => node.nodeId).join(",") === [n1.id, n2.id, n3.id].join(",") && (tpl.nodes ?? [])[0].title === nodeTitle1);
  const tplEmpty = await newTemplate("回放模板·空·" + stamp, []);
  check("S6", "模板 T0（空模板）", "201 + nodes = []", String((tplEmpty.nodes ?? []).length), (tplEmpty.nodes ?? []).length === 0);

  // ---------- A 段：模板实例化（整批）----------
  const batch1 = await call("POST", "/api/v1/projects/" + A + "/tasks/from-template", { templateId: tpl.id, priority: "中" });
  const created1 = batch1.body?.created ?? [];
  trackCreated(A, created1);
  check("A1", "整套添加：整批 201 + created 3 条 / skipped 空", "201 + created=3 + skipped=0", batch1.status + " " + truncate({ created: created1.length, skipped: (batch1.body?.skipped ?? []).length }), batch1.status === 201 && created1.length === 3 && (batch1.body?.skipped ?? []).length === 0);
  check("A2", "整批顺序 = 模板内顺序（n1 → n2 → n3），逐条带 sourceNodeId", nodeTitle1 + " → " + nodeTitle2 + " → " + nodeTitle3, truncate({ titles: created1.map((item) => item.title), sourceNodeIds: created1.map((item) => item.sourceNodeId) }), created1.map((item) => item.title).join(",") === [nodeTitle1, nodeTitle2, nodeTitle3].join(",") && created1.map((item) => item.sourceNodeId).join(",") === [n1.id, n2.id, n3.id].join(","));
  check("A3", "created 字段：阶段取模板阶段 / 状态 pending / 进度 0 / 负责人缺省 = 「待分配」空数组 / 重要度 = 调用方给", "design / pending / 0 / [] / 中", truncate({ stageKey: created1[0]?.stageKey, status: created1[0]?.status, progress: created1[0]?.progress, ownerIds: created1[0]?.ownerIds, priority: created1[0]?.priority }), created1.every((item) => item.stageKey === NODE_STAGE && item.status === "pending" && item.progress === 0 && item.priority === "中") && (created1[0]?.ownerIds ?? ["x"]).length === 0);
  check("A4", "描述 / 英文名取节点库现值（n2 英文名为空 → null）", nodeTitle2 + " / null", String(created1[1]?.title) + " / " + String(created1[1]?.titleEn), created1[1]?.title === nodeTitle2 && created1[1]?.titleEn === null && created1[2]?.titleEn === "Contract signing");
  const aRows = await liveTasksOf(A);
  check("A5", "库内：task_node_id 逐条正确、node_id 全 null（两种来源并存不互替）、sort_index = 0/1/2", "3 行 + node_id 全 null + 0/1/2", aRows.length + " 行 / node_id=" + aRows.map((row) => String(row.node_id)).join(",") + " / sort_index=" + aRows.map((row) => row.sort_index).join(","), aRows.length === 3 && aRows.every((row) => row.node_id === null) && aRows.map((row) => row.task_node_id).join(",") === [n1.id, n2.id, n3.id].join(",") && aRows.map((row) => row.sort_index).join(",") === "0,1,2");
  const aAudit = (await db.query("select object_id, metadata from audit_logs where project_id = $1 and object_type = $$task$$ and action = $$create$$ and metadata->>$$kind$$ = $$from_template$$ order by id", [A])).rows;
  check("A6", "审计：逐条 create + metadata.kind=from_template + templateId / templateName / sourceNodeId", "3 行 + templateId = T1 + sourceNodeId 逐条", aAudit.length + " 行 / " + truncate(aAudit.map((row) => row.metadata)), aAudit.length === 3 && aAudit.every((row) => row.metadata.templateId === tpl.id && row.metadata.templateName === tplName) && aAudit.map((row) => row.metadata.sourceNodeId).join(",") === [n1.id, n2.id, n3.id].join(","));
  const aOutbox = (await db.query("select dedupe_key, payload from outbox_events where dedupe_key = any($1::text[])", [created1.map((item) => "task.created:" + item.id)])).rows;
  check("A7", "outbox：逐条 task.created（dedupe_key = task.created:<id>）", "3 行 + payload.taskId 对齐", aOutbox.length + " 行 / " + truncate(aOutbox.map((row) => row.payload.taskId)), aOutbox.length === 3 && aOutbox.every((row) => created1.some((item) => item.id === row.payload.taskId) && row.payload.stageKey === NODE_STAGE));

  const batch2 = await call("POST", "/api/v1/projects/" + A + "/tasks/from-template", { templateId: tpl.id });
  check("A8", "再整套加同一模板（skipExisting 缺省 true）→ created 空 + skipped 3（顺序 = 模板顺序、taskId 指回原任务）", "201 + created=0 + skipped=3", batch2.status + " " + truncate({ created: (batch2.body?.created ?? []).length, skipped: batch2.body?.skipped }), batch2.status === 201 && (batch2.body?.created ?? []).length === 0 && (batch2.body?.skipped ?? []).length === 3 && (batch2.body?.skipped ?? []).map((item) => item.nodeId).join(",") === [n1.id, n2.id, n3.id].join(",") && (batch2.body?.skipped ?? []).map((item) => item.taskId).join(",") === created1.map((item) => item.id).join(","));
  const batch3 = await call("POST", "/api/v1/projects/" + A + "/tasks/from-template", { templateId: tpl.id, skipExisting: false });
  check("A9", "skipExisting=false 遇重复 → 409 TASK_ALREADY_EXISTS", "409 + TASK_ALREADY_EXISTS", batch3.status + " " + truncate(batch3.body, 160), batch3.status === 409 && batch3.body?.code === "TASK_ALREADY_EXISTS");

  const n2TaskId = created1[1].id;
  const removedN2 = await call("DELETE", "/api/v1/projects/" + A + "/tasks/" + n2TaskId);
  const n2Soft = (await db.query("select deleted_at from tasks where id = $1", [n2TaskId])).rows[0];
  check("A10", "软删 n2 生成的任务（判重只看未删行）", "200 + 库内 deleted_at 非空", removedN2.status + " / deleted_at=" + String(n2Soft?.deleted_at), (removedN2.status === 200 || removedN2.status === 204) && n2Soft !== undefined && n2Soft.deleted_at !== null);
  const batch4 = await call("POST", "/api/v1/projects/" + A + "/tasks/from-template", { templateId: tpl.id });
  const created4 = batch4.body?.created ?? [];
  trackCreated(A, created4);
  check("A11", "软删后该节点回到「可添加」：只补 n2 一条（新 id），n1 / n3 仍跳过", "201 + created = [n2] + skipped = 2", batch4.status + " " + truncate({ created: created4.map((item) => item.title), skipped: (batch4.body?.skipped ?? []).map((item) => item.nodeId) }), batch4.status === 201 && created4.length === 1 && created4[0].sourceNodeId === n2.id && created4[0].id !== n2TaskId && (batch4.body?.skipped ?? []).length === 2);

  const batch5 = await call("POST", "/api/v1/projects/" + A + "/tasks/from-template", { templateId: tpl.id, nodeIds: [n3.id] });
  check("A12", "nodeIds 子集（只 n3）：该条已存在 → created 空 + skipped 1", "201 + 0 / 1", batch5.status + " " + truncate({ created: (batch5.body?.created ?? []).length, skipped: (batch5.body?.skipped ?? []).map((item) => item.nodeId) }), batch5.status === 201 && (batch5.body?.created ?? []).length === 0 && (batch5.body?.skipped ?? []).map((item) => item.nodeId).join(",") === n3.id);
  const batch6 = await call("POST", "/api/v1/projects/" + A + "/tasks/from-template", { templateId: tpl.id, nodeIds: [n5.id] });
  check("A13", "nodeIds 含模板外节点 → 400 VALIDATION_FAILED", "400 + VALIDATION_FAILED", batch6.status + " " + truncate(batch6.body, 160), batch6.status === 400 && batch6.body?.code === "VALIDATION_FAILED");
  const stampBefore = await projectStampOf(A);
  const outboxBefore = Number((await db.query("select count(*)::int as n from outbox_events")).rows[0].n);
  const batch7 = await call("POST", "/api/v1/projects/" + A + "/tasks/from-template", { templateId: tpl.id, nodeIds: [] });
  const stampAfter = await projectStampOf(A);
  const outboxAfter = Number((await db.query("select count(*)::int as n from outbox_events")).rows[0].n);
  check("A14", "nodeIds 空数组 → 201 created / skipped 全空，且不 touch 项目、不写 outbox", "201 + 0 / 0 + updated_at 不变 + outbox 不变", batch7.status + " " + truncate(batch7.body) + " / " + stampBefore + " → " + stampAfter + " / outbox " + outboxBefore + " → " + outboxAfter, batch7.status === 201 && (batch7.body?.created ?? []).length === 0 && (batch7.body?.skipped ?? []).length === 0 && stampBefore === stampAfter && outboxBefore === outboxAfter);
  const batch8 = await call("POST", "/api/v1/projects/" + A + "/tasks/from-template", { templateId: tplEmpty.id });
  const stampAfter2 = await projectStampOf(A);
  check("A15", "空模板 → 201 created / skipped 全空（不 touch 项目）", "201 + 0 / 0 + updated_at 不变", batch8.status + " " + truncate(batch8.body) + " / " + stampBefore + " → " + stampAfter2, batch8.status === 201 && (batch8.body?.created ?? []).length === 0 && (batch8.body?.skipped ?? []).length === 0 && stampBefore === stampAfter2);
  const batch9 = await call("POST", "/api/v1/projects/" + A + "/tasks/from-template", { templateId: "00000000-0000-4000-8000-000000000000" });
  check("A16", "模板不存在 → 404 NOT_FOUND", "404 + NOT_FOUND", batch9.status + " " + truncate(batch9.body, 160), batch9.status === 404 && batch9.body?.code === "NOT_FOUND");
  const listA = await call("GET", "/api/v1/projects/" + A + "/tasks?limit=50");
  const sourcedA = (listA.body?.items ?? []).filter((item) => item.sourceNodeId !== null && item.sourceNodeId !== undefined);
  check("A17", "读面：列表下发 sourceNodeId（来源节点任务 3 条 = n1 / n2 / n3）", "命中 3 条", sourcedA.length + " 条：" + truncate(sourcedA.map((item) => item.sourceNodeId)), listA.status === 200 && sourcedA.length === 3 && [n1.id, n2.id, n3.id].every((id) => sourcedA.some((item) => item.sourceNodeId === id)));
  const detailA = await call("GET", "/api/v1/projects/" + A + "/tasks/" + created1[0].id);
  check("A18", "详情同样下发 sourceNodeId", n1.id, String(detailA.body?.sourceNodeId), detailA.status === 200 && detailA.body?.sourceNodeId === n1.id);

  // ---------- B 段：节点库逐条来源 + 判重 + 400 系列 + 整批回滚 ----------
  const projectB = await newProject("B");
  const B = projectB.id;
  const bAdd = await call("POST", "/api/v1/projects/" + B + "/tasks", { sourceNodeId: n2.id, title: "客户端标题·B1·" + stamp });
  trackTask(B, bAdd.body);
  check("B1", "逐条来源：带 sourceNodeId 建任务（成员可建路径）", "201", bAdd.status + " " + truncate(bAdd.body, 200), bAdd.status === 201 && typeof bAdd.body?.id === "string");
  check("B2", "描述 / 英文名 / 阶段取节点库现值（客户端带的标题被覆盖）+ sourceNodeId 回传 + 负责人缺省 = 「待分配」", nodeTitle2 + " / null / design", truncate({ title: bAdd.body?.title, titleEn: bAdd.body?.titleEn, stageKey: bAdd.body?.stageKey, sourceNodeId: bAdd.body?.sourceNodeId, ownerIds: bAdd.body?.ownerIds }), bAdd.body?.title === nodeTitle2 && bAdd.body?.titleEn === null && bAdd.body?.stageKey === NODE_STAGE && bAdd.body?.sourceNodeId === n2.id && (bAdd.body?.ownerIds ?? ["x"]).length === 0);
  const bRows = await liveTasksOf(B);
  check("B3", "库内 tasks.task_node_id = n2（与 node_id 并存）", n2.id + " / node_id=null", String(bRows[0]?.task_node_id) + " / " + String(bRows[0]?.node_id), bRows.length === 1 && bRows[0].task_node_id === n2.id && bRows[0].node_id === null);
  const bDup = await call("POST", "/api/v1/projects/" + B + "/tasks", { sourceNodeId: n2.id, title: "客户端标题·B4·" + stamp });
  check("B4", "同项目同一节点重复 → 409 TASK_ALREADY_EXISTS", "409 + TASK_ALREADY_EXISTS", bDup.status + " " + truncate(bDup.body, 160), bDup.status === 409 && bDup.body?.code === "TASK_ALREADY_EXISTS");
  const bBoth = await call("POST", "/api/v1/projects/" + B + "/tasks", { sourceNodeId: n1.id, taskNodeId: bAdd.body.id, title: "客户端标题·B5·" + stamp });
  check("B5", "taskNodeId（项目流程节点）与 sourceNodeId 二选一 → 400 VALIDATION_FAILED", "400 + VALIDATION_FAILED", bBoth.status + " " + truncate(bBoth.body, 160), bBoth.status === 400 && bBoth.body?.code === "VALIDATION_FAILED" && String(bBoth.body?.message).indexOf("二选一") >= 0);
  const bGhost = await call("POST", "/api/v1/projects/" + B + "/tasks", { sourceNodeId: "00000000-0000-4000-8000-000000000000", title: "客户端标题·B6·" + stamp });
  check("B6", "节点库没有该节点 → 400 VALIDATION_FAILED", "400 + VALIDATION_FAILED", bGhost.status + " " + truncate(bGhost.body, 160), bGhost.status === 400 && bGhost.body?.code === "VALIDATION_FAILED" && String(bGhost.body?.message).indexOf("不存在") >= 0);
  const bStage = await call("POST", "/api/v1/projects/" + B + "/tasks", { sourceNodeId: n1.id, stageKey: "acceptance", title: "客户端标题·B7·" + stamp });
  check("B7", "stageKey 与来源节点阶段不一致 → 400", "400 + VALIDATION_FAILED", bStage.status + " " + truncate(bStage.body, 160), bStage.status === 400 && bStage.body?.code === "VALIDATION_FAILED" && String(bStage.body?.message).indexOf("阶段不一致") >= 0);
  const bAudit = (await db.query("select metadata from audit_logs where project_id = $1 and object_type = $$task$$ and action = $$create$$ order by id", [B])).rows;
  check("B8", "审计：逐条来源 metadata.source=task_node + sourceNodeId", "source=task_node / sourceNodeId=" + n2.id, truncate(bAudit.map((row) => row.metadata)), bAudit.length === 1 && bAudit[0].metadata.source === "task_node" && bAudit[0].metadata.sourceNodeId === n2.id);
  const bAtomic = await call("POST", "/api/v1/projects/" + B + "/tasks/from-template", { templateId: tpl.id, skipExisting: false });
  const bRowsAfter = await liveTasksOf(B);
  check("B9", "整批同事务：撞到 n2 冲突（n1 在前）时整批回滚 → 409 且 B 内来源节点任务仍 1 行（n1 未落半批）", "409 + 仍 1 行", bAtomic.status + " / " + bRowsAfter.length + " 行 / " + truncate(bRowsAfter.map((row) => row.task_node_id)), bAtomic.status === 409 && bAtomic.body?.code === "TASK_ALREADY_EXISTS" && bRowsAfter.length === 1 && bRowsAfter[0].task_node_id === n2.id);

  // ---------- C 段：子集 / 节点物理删 / 锁定字段 ----------
  const projectC = await newProject("C");
  const C = projectC.id;
  const cSubset = await call("POST", "/api/v1/projects/" + C + "/tasks/from-template", { templateId: tpl.id, nodeIds: [n3.id] });
  const createdC = cSubset.body?.created ?? [];
  trackCreated(C, createdC);
  check("C1", "子集实例化：只 n3 一条落库（其余不建）", "201 + created=1（n3）+ skipped=0", cSubset.status + " " + truncate({ created: createdC.map((item) => item.title), skipped: (cSubset.body?.skipped ?? []).length }), cSubset.status === 201 && createdC.length === 1 && createdC[0].title === nodeTitle3 && createdC[0].sourceNodeId === n3.id);
  const cN4 = await call("POST", "/api/v1/projects/" + C + "/tasks", { sourceNodeId: n4.id, title: "客户端标题·C2·" + stamp });
  trackTask(C, cN4.body);
  check("C2", "逐条加 n4（给「节点物理删」做夹具）", "201 + title = n4", cN4.status + " " + truncate({ title: cN4.body?.title }), cN4.status === 201 && cN4.body?.title === nodeTitle4);
  const cNodeDel = await call("DELETE", "/api/v1/task-nodes/" + n4.id);
  const n4Left = (await db.query("select count(*)::int as n from task_nodes where id = $1", [n4.id])).rows[0].n;
  check("C3", "节点库物理删节点 → 200 deleted=true、节点表零行", "200 + deleted=true + 0 行", cNodeDel.status + " " + truncate(cNodeDel.body) + " / " + n4Left + " 行", cNodeDel.status === 200 && cNodeDel.body?.deleted === true && Number(n4Left) === 0);
  const cN4Row = (await db.query("select title, task_node_id, deleted_at from tasks where id = $1", [cN4.body.id])).rows[0];
  check("C4", "on delete set null：任务保留、task_node_id 置 null、描述不变、未软删", "title 不变 / task_node_id=null / deleted_at=null", JSON.stringify(cN4Row), cN4Row !== undefined && cN4Row.title === nodeTitle4 && cN4Row.task_node_id === null && cN4Row.deleted_at === null);
  const cDetail = await call("GET", "/api/v1/projects/" + C + "/tasks/" + cN4.body.id);
  check("C5", "读面：该任务仍可见，sourceNodeId = null", "200 + sourceNodeId=null", cDetail.status + " " + truncate({ sourceNodeId: cDetail.body?.sourceNodeId, title: cDetail.body?.title }), cDetail.status === 200 && cDetail.body?.sourceNodeId === null && cDetail.body?.title === nodeTitle4);
  const renamedTitle = "回放·布局定档（改名）·" + stamp;
  const rename = await call("PATCH", "/api/v1/task-nodes/" + n1.id, { title: renamedTitle, titleEn: "Layout scheduling v2", version: n1.version });
  check("C6", "改节点名 + 英文名（乐观锁 version 0 → 1）", "200 + titleEn = Layout scheduling v2", rename.status + " " + truncate({ title: rename.body?.title, titleEn: rename.body?.titleEn, version: rename.body?.version }), rename.status === 200 && rename.body?.title === renamedTitle && rename.body?.titleEn === "Layout scheduling v2");
  const aN1Row = (await db.query("select title, title_en from tasks where id = $1", [created1[0].id])).rows[0];
  check("C7", "锁定字段（A1-17）：已生成任务不跟随节点改名", nodeTitle1 + " / Layout scheduling", truncate(aN1Row), aN1Row !== undefined && aN1Row.title === nodeTitle1 && aN1Row.title_en === "Layout scheduling");
  const cN1 = await call("POST", "/api/v1/projects/" + C + "/tasks", { sourceNodeId: n1.id, title: "客户端标题·C8·" + stamp });
  trackTask(C, cN1.body);
  check("C8", "新任务取节点现值（改名后的标题 + 英文名）", renamedTitle + " / Layout scheduling v2", truncate({ title: cN1.body?.title, titleEn: cN1.body?.titleEn }), cN1.status === 201 && cN1.body?.title === renamedTitle && cN1.body?.titleEn === "Layout scheduling v2");

  // ---------- E 段：位次（A19 / A20）----------
  const projectE = await newProject("E");
  const E = projectE.id;
  const manualTitle = "回放·手工任务·" + stamp;
  const manual = await call("POST", "/api/v1/projects/" + E + "/tasks", { stageKey: NODE_STAGE, title: manualTitle });
  trackTask(E, manual.body);
  check("E1", "夹具：手工任务（管理员手建、无来源节点）落在 design 组第 1 位", "201 + sortIndex 0", manual.status + " " + truncate({ sortIndex: manual.body?.sortIndex, stageKey: manual.body?.stageKey }), manual.status === 201 && manual.body?.sortIndex === 0 && manual.body?.stageKey === NODE_STAGE);
  const eBatch = await call("POST", "/api/v1/projects/" + E + "/tasks/from-template", { templateId: tpl.id, sortIndex: 0 });
  const createdE = eBatch.body?.created ?? [];
  trackCreated(E, createdE);
  const eRows = await liveTasksOf(E);
  check("E2", "整批按 sortIndex 起依次落位（0/1/2），存量手工任务顺延到 3", "201 + created=3 + 位次 0,1,2,3", eBatch.status + " " + truncate(eRows.map((row) => row.sort_index + ":" + row.title)), eBatch.status === 201 && createdE.length === 3 && eRows.map((row) => row.sort_index).join(",") === "0,1,2,3" && eRows[3].title === manualTitle && eRows[3].task_node_id === null && eRows.slice(0, 3).every((row) => row.task_node_id !== null));
  const listE = await call("GET", "/api/v1/projects/" + E + "/tasks?limit=50");
  check("E3", "读面顺序 = 库内位次（前三条 = 模板顺序、末条 = 顺延后的手工任务）", renamedTitle + " / " + nodeTitle2 + " / " + nodeTitle3 + " / " + manualTitle, truncate((listE.body?.items ?? []).map((item) => item.title)), listE.status === 200 && (listE.body?.items ?? []).slice(0, 3).map((item) => item.title).join(",") === [renamedTitle, nodeTitle2, nodeTitle3].join(",") && (listE.body?.items ?? [])[3]?.title === manualTitle, "E 段在 C6 改名之后跑 —— 整批用的是改名后的现值（= 新任务取现值）");

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
      check("Z1", "临时项目 / 任务软删（读面零残留）", "项目 0 行 / 任务 0 行可见", residueProjects + " / " + residueTasks, residueProjects === 0 && residueTasks === 0, "任务 " + taskIds.length + " 条 / 项目 " + cleanup.projectIds.length + " 个");

      for (const nodeId of cleanup.nodeIds) {
        await call("DELETE", "/api/v1/task-nodes/" + nodeId);
      }
      const nodesLeft = cleanup.nodeIds.length === 0 ? 0 : Number((await db.query("select count(*)::int as n from task_nodes where id = any($1::uuid[])", [cleanup.nodeIds])).rows[0]?.n ?? -1);
      for (const templateId of cleanup.templateIds) {
        const detail = await call("GET", "/api/v1/task-templates/" + templateId);
        await call("DELETE", "/api/v1/task-templates/" + templateId, { version: detail.body?.version });
      }
      const templatesLeft = cleanup.templateIds.length === 0 ? 0 : Number((await db.query("select count(*)::int as n from task_templates where id = any($1::uuid[]) and deleted_at is null", [cleanup.templateIds])).rows[0]?.n ?? -1);
      const templateRead = cleanup.templateIds.length === 0 ? 404 : (await call("GET", "/api/v1/task-templates/" + cleanup.templateIds[0])).status;
      evidence.residue.nodes = nodesLeft;
      evidence.residue.templates = templatesLeft;
      check("Z2", "临时节点物理删 + 临时模板软删（读面 404）", "节点 0 行 / 模板未删 0 行 / 读面 404", nodesLeft + " / " + templatesLeft + " / " + templateRead, Number(nodesLeft) === 0 && Number(templatesLeft) === 0 && templateRead === 404);
    } else {
      evidence.residue = { kept: true };
      report.push("| PASS | Z1 | --keep：保留回放数据 |");
      report.push("| PASS | Z2 | --keep：保留节点 / 模板 |");
    }
    if (cleanup.sessionToken !== null && args.keep !== true) {
      await db.query("delete from sessions where token_hash = $1", [sha256(cleanup.sessionToken)]);
    }
    const leftover = cleanup.sessionToken === null ? 0 : Number((await db.query("select count(*)::int as n from sessions where token_hash = $1", [sha256(cleanup.sessionToken)])).rows[0]?.n ?? -1);
    evidence.residue.sessions = args.keep === true ? "kept" : leftover;
    check("Z3", "临时会话清理（零残留）", "0 行", args.keep === true ? "kept" : String(leftover), args.keep === true || leftover === 0);
  } catch (error) {
    process.stdout.write("清理阶段异常：" + String(error) + "\n");
  } finally {
    await db.end().catch(() => undefined);
  }
}

const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd() }).toString().trim();
const ranAt = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ") + " +08:00";
const lines = [];
lines.push("# M3-07 刀 3 回放证据（添加任务模板化：节点库来源 + 模板实例化）");
lines.push("");
lines.push("> 口径：业务定案 2026-09-24 —— 「节点库 / 模板接口 这个要做的」；同一节点在同一项目默认不重复生成（重加 = 跳过，可显式要求 409）。");
lines.push("> 「添加任务」卡片：节点库标签逐条加（带来源节点 id 判重）、模板标签「整套添加」走模板实例化接口（整批同事务）。");
lines.push("");
lines.push("| 项 | 值 |");
lines.push("|---|---|");
lines.push("| 回放时间 | " + ranAt + " |");
lines.push("| api | " + BASE_URL + " |");
lines.push("| 数据库 | " + DATABASE_URL.replace(/:[^:@/]+@/, ":***@") + " |");
lines.push("| 代码版本 | " + commit + " |");
lines.push("| 回放账号（临时会话，用完删除） | " + (cleanup.actorId ?? "-") + " |");
lines.push("| 脚本 | server/scripts/m3-07-replay-from-template.mjs |");
lines.push("");
lines.push("## 断言明细");
lines.push("");
lines.push(...report);
lines.push("");
lines.push("## 汇总");
lines.push("");
lines.push(failures === 0 ? "- 全部断言通过（" + evidence.checks.filter((item) => item.ok).length + " 项）：节点库来源逐条建任务（字段取现值 + 判重 409 + 二选一 / 未知节点 / 阶段不一致 400）、模板实例化（整批同事务 + 模板内顺序 + 位次与顺延 + skipExisting 缺省跳过 / 显式 409 且整批回滚）、判重只约束未删行（软删后可重加）、来源节点物理删后 task_node_id 置 null（任务保留）、锁定字段（改名不影响已生成任务、新任务取现值）、审计与 outbox 逐条、读面 sourceNodeId 下发；临时项目 / 任务 / 节点 / 模板 / 会话零残留。" : "- 有 " + failures + " 项失败，见上方 FAIL 行。");
lines.push("");
lines.push("## 复跑");
lines.push("");
lines.push("- api：cd server && npm run build && npm run start:api（缺省 3001）");
lines.push("- 迁移：cd database && DATABASE_URL=postgres://libiaolink_migrator@127.0.0.1:5433/libiaolink npm run migrate（0034_task_source_node.sql 必须先于本回放执行）");
lines.push("- 回放：cd server && node scripts/m3-07-replay-from-template.mjs --out ../docs/m3-07-回放证据(添加任务模板化).md");
lines.push("");

const markdown = lines.join("\n") + "\n";
if (args.out !== undefined) { writeFileSync(args.out, markdown, "utf8"); process.stdout.write("报告已写入 " + args.out + "\n"); }
if (args.json !== undefined) { writeFileSync(args.json, JSON.stringify({ baseUrl: BASE_URL, commit, ranAt, failures, residue: evidence.residue, checks: evidence.checks }, null, 2), "utf8"); }
process.stdout.write(failures === 0 ? "M3-07 刀 3 回放通过（" + evidence.checks.length + " 项断言）\n" : "M3-07 刀 3 回放失败（" + failures + " 项）\n");
process.exit(failures === 0 ? 0 : 1);
