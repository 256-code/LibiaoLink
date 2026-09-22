#!/usr/bin/env node
/**
 * M4-04 真机回放（S7·file 变更 · 申请即通过 · PR-7）：
 *   证据一（变更入口）：POST /files/uploads intent=change —— 目标须已定档（final / changed），change_payload 随会话落库
 *           （upload_sessions.change_payload）；不新建文件行。
 *   证据二（目标门禁）：非定档（draft）409 FILE_STATE_INVALID / 不存在 404 / 跨项目 400 / 非成员 404（防 IDOR）。
 *   证据三（变更生效 · 完成上传）：同一事务写 change_requests(status=applied) + 版本挂 change_request_id +
 *           files.status=changed + file_links(change) + 审计(object_type=change) + outbox change.applied。
 *   证据四（R01 自动关联 · A1-07 多条）：按「变更文件成果类型 ∈ 任务输出成果文件（deliverable_types 多值）」匹配任务，
 *           全部**追加 + 去重**回写 tasks.change_refs（一条任务可关联多条变更，业务要求「变更关联」列展示多条）；无匹配只记日志、不阻断生效。
 *   证据五（定档后回溯 = 变更）：POST /files/{id}/rollback 对 final 文件生成变更（changeRequest 非空）+ 新版本挂 change_request_id。
 *   证据六（定档后管控）：intent=version 对 changed 文件 409（修改须走变更）。
 *
 * 前置：真 PG（DATABASE_URL）+ 真对象存储（S3_*，见 deploy/minio/）+ 已起 api（BASE_URL）。本脚本只在本地沙箱 / 联调库跑：
 *       铸两个临时会话（管理员 + 非成员反例，跑完撤销）、建 M4CHG- 回放项目（跑完硬删项目及其文件 / 版本 / 变更 / 关联 / 会话 / 任务 / 审计 / outbox + 清桶内前缀）。
 * 用法：cd server && M4_DATABASE_URL=postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink \
 *       node --env-file-if-exists=.env scripts/m4-change-replay.mjs [--out <报告.md>] [--json <证据.json>] [--keep]
 *      （脚本侧的断言 SQL 与收尾需要迁移器权限：audit_logs 对应用角色只授 SELECT / INSERT，故 M4_DATABASE_URL 优先于 DATABASE_URL）
 * 退出码：断言全过 = 0，否则 = 1（可当门禁用）。
 */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "pg";

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.baseUrl ?? process.env.M4_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3011";
const DATABASE_URL =
  args.databaseUrl ?? process.env.M4_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink";
const MI_B = 1024 * 1024;
const FILE_A_SIZE = 12 * MI_B;
const FILE_B_SIZE = 8 * MI_B;
const report = [];
const evidence = { steps: [] };
let failures = 0;
let db;

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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 会话（两个账号各自一套 Cookie + CSRF）。 */
async function makeSession(userId, idToken) {
  const session = { userId, token: "m4chg-" + randomBytes(16).toString("hex"), csrf: randomBytes(16).toString("hex") };
  await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + interval '2 hours')", [
    sha256(session.token),
    userId,
    idToken,
  ]);
  return session;
}

async function call(method, path, body, session, extraHeaders = {}) {
  const actor = session ?? admin;
  const response = await fetch(BASE_URL + path, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: "ll_sid=" + actor.token + "; ll_csrf=" + actor.csrf,
      "x-csrf-token": actor.csrf,
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text === "" ? null : JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 400) };
  }
  return { status: response.status, body: parsed };
}

function check(id, title, expected, actual, ok, note = "") {
  if (!ok) failures += 1;
  report.push((ok ? "| PASS | " : "| FAIL | ") + id + " | " + title + " | ");
  report.push("  - 期望：" + expected);
  report.push("  - 实际：" + actual);
  if (note !== "") report.push("  - 说明：" + note);
  evidence.steps.push({ id, title, expected, actual, ok, note });
  process.stdout.write((ok ? "PASS " : "FAIL ") + id + " " + title + "\n");
  if (!ok) throw new Error("M4-04 回放失败（" + id + "）：" + title);
}

function short(value, max = 320) {
  const text = JSON.stringify(value);
  return text === undefined ? "undefined" : text.length > max ? text.slice(0, max) + "…" : text;
}

/** 浏览器同口径直传：对预签名 URL 原样 PUT，不额外带任何头。 */
async function putPart(url, body) {
  const response = await fetch(url, { method: "PUT", body });
  const payload = Buffer.from(await response.arrayBuffer());
  return { status: response.status, etag: response.headers.get("etag"), text: response.ok ? "" : payload.toString("utf8").slice(0, 300) };
}let admin;
let member;
let storage;
let rawClient;
let s3Module;
let adminId;
let memberId;
let project;
let otherProject;
let projectNode;
let projectStageKey;
let taskMatchedA;
let taskMatchedB;
let taskOther;
const createUpload = (body, session) => call("POST", "/api/v1/files/uploads", body, session);
const signParts = (fileId, uploadId, partNumbers, session) =>
  call("POST", "/api/v1/files/" + fileId + "/uploads/" + uploadId + "/parts", { partNumbers }, session);
const completeUpload = (fileId, uploadId, contentHash, session) =>
  call("POST", "/api/v1/files/" + fileId + "/uploads/" + uploadId + "/complete", { contentHash }, session);
const finalizeFile = (fileId, version, session) => call("POST", "/api/v1/files/" + fileId + "/finalize", { version }, session);
const rollbackFile = (fileId, toVersionId, reason, version, session) =>
  call("POST", "/api/v1/files/" + fileId + "/rollback", { toVersionId, reason, version }, session);
const fileDetail = (fileId, session) => call("GET", "/api/v1/files/" + fileId, undefined, session);

/** 造分片（除末片外 8 MiB，同上传管道口径）。 */
function makeParts(sizeBytes) {
  const parts = [];
  for (let offset = 0; offset < sizeBytes; offset += 8 * MI_B) {
    parts.push(Buffer.alloc(Math.min(8 * MI_B, sizeBytes - offset), parts.length + 1));
  }
  return parts;
}

/** 完整上传一个新文件（可选 nodeId / taskId 挂接），返回 fileId / contentHash / 完成响应。 */
async function uploadNewFile({ projectId, name, sizeBytes, docType, nodeId, taskId, session }) {
  const parts = makeParts(sizeBytes);
  const contentHash = sha256(Buffer.concat(parts));
  const init = await createUpload(
    { projectId, name, sizeBytes, contentHash, docType, nodeId, taskId, intent: "version" },
    session,
  );
  const fileId = init.body?.file?.id;
  const uploadId = init.body?.upload?.id;
  const signed = await signParts(fileId, uploadId, parts.map((_unused, index) => index + 1), session);
  for (let index = 0; index < parts.length; index += 1) {
    await putPart(signed.body.parts[index].url, parts[index]);
  }
  const completed = await completeUpload(fileId, uploadId, contentHash, session);
  return { init, fileId, uploadId, contentHash, completed, parts };
}

/** 对既有 draft 文件追加一版（Push 130 定案：intent=version + fileId）。 */
async function appendVersion({ projectId, fileId, name, sizeBytes, session }) {
  const parts = makeParts(sizeBytes);
  const contentHash = sha256(Buffer.concat(parts));
  const init = await createUpload({ projectId, name, sizeBytes, contentHash, fileId, intent: "version" }, session);
  const uploadId = init.body?.upload?.id;
  const signed = await signParts(fileId, uploadId, parts.map((_unused, index) => index + 1), session);
  for (let index = 0; index < parts.length; index += 1) {
    await putPart(signed.body.parts[index].url, parts[index]);
  }
  const completed = await completeUpload(fileId, uploadId, contentHash, session);
  return { init, uploadId, contentHash, completed };
}

/** 变更上传（M4-04）：intent=change + fileId（目标须定档），返回会话 / 完成响应。 */
async function changeUploadFile({ projectId, fileId, name, sizeBytes, change, session }) {
  const parts = makeParts(sizeBytes);
  const contentHash = sha256(Buffer.concat(parts));
  const init = await createUpload({ projectId, name, sizeBytes, contentHash, fileId, intent: "change", change }, session);
  const uploadId = init.body?.upload?.id;
  const signed = await signParts(fileId, uploadId, parts.map((_unused, index) => index + 1), session);
  for (let index = 0; index < parts.length; index += 1) {
    await putPart(signed.body.parts[index].url, parts[index]);
  }
  const completed = await completeUpload(fileId, uploadId, contentHash, session);
  return { init, uploadId, contentHash, completed };
}

/** 清桶内前缀下的全部版本（收尾用；版本化桶必须带 VersionId 删）。 */
async function purgePrefix(prefix) {
  let keyMarker;
  let versionIdMarker;
  do {
    const listed = await rawClient.send(
      new s3Module.ListObjectVersionsCommand({ Bucket: storage.bucket, Prefix: prefix, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker }),
    );
    const targets = [
      ...(listed.Versions ?? []).map((item) => ({ Key: item.Key, VersionId: item.VersionId })),
      ...(listed.DeleteMarkers ?? []).map((item) => ({ Key: item.Key, VersionId: item.VersionId })),
    ].filter((item) => item.Key !== undefined && item.Key.startsWith(prefix));
    for (let index = 0; index < targets.length; index += 500) {
      await rawClient.send(new s3Module.DeleteObjectsCommand({ Bucket: storage.bucket, Delete: { Objects: targets.slice(index, index + 500) } }));
    }
    keyMarker = listed.IsTruncated === true ? listed.NextKeyMarker : undefined;
    versionIdMarker = listed.IsTruncated === true ? listed.NextVersionIdMarker : undefined;
  } while (keyMarker !== undefined);
}

const cleanup = { projectIds: [], sessions: [] };
try {
  try {
    const envModule = await import(pathToFileURL(join(serverRoot, "dist", "config", "env.js")).href);
    const storageModule = await import(pathToFileURL(join(serverRoot, "dist", "storage", "index.js")).href);
    s3Module = await import("@aws-sdk/client-s3");
    const env = envModule.loadEnv(process.env);
    storage = storageModule.createS3ObjectStorage(env);
    rawClient = storageModule.createS3Client(env);
  } catch (error) {
    throw new Error("无法加载 dist / S3 环境（先 npm run build，并用 --env-file-if-exists=.env 带上 S3_*）：" + String(error));
  }

  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  const health = await fetch(BASE_URL + "/healthz").then((response) => response.status).catch(() => 0);
  if (health !== 200) throw new Error("api 不可用（" + BASE_URL + "/healthz → " + health + "）；先起 api 再跑本脚本");
  const ready = await fetch(BASE_URL + "/readyz").then((response) => response.status).catch(() => 0);
  check("S0", "api 可用（/healthz + /readyz：含存储探针）", "200 / 200", health + " / " + ready, health === 200 && ready === 200);

  const adminRow = await db.query(
    "select u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where r.code = $1 and u.status = $2 order by u.id limit 1",
    ["admin", "active"],
  );
  adminId = adminRow.rows[0]?.id;
  if (adminId === undefined) throw new Error("找不到可用的管理员账号（roles.code = admin）");
  const otherUsers = await db.query("select id from users where id <> $1 and status = 'active' order by id limit 1", [adminId]);
  memberId = args.actor ?? otherUsers.rows[0]?.id;
  if (memberId === undefined) throw new Error("找不到第二个账号（非成员反例基准账号）");
  admin = await makeSession(adminId, "m4chg-replay-admin");
  member = await makeSession(memberId, "m4chg-replay-member");
  cleanup.sessions.push(admin.token, member.token);

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const created = await call("POST", "/api/v1/projects", {
    code: "M4CHG-" + stamp,
    name: "m4-04 回放项目（变更申请即通过）",
    projectType: "default",
    managerIds: [adminId],
  });
  check("P1", "建回放项目（为 file / change 提供 projectId）", "201 + 项目可见", created.status + " " + short({ id: created.body?.id, code: created.body?.code }, 120), created.status === 201);
  project = created.body.id;
  cleanup.projectIds.push(project);

  const createdOther = await call("POST", "/api/v1/projects", {
    code: "M4CHGX-" + stamp,
    name: "m4-04 回放项目（跨项目反例）",
    projectType: "default",
    managerIds: [adminId],
  });
  check("P2", "建第二个项目（跨项目 400 / 非成员 404 反例用）", "201", createdOther.status, createdOther.status === 201);
  otherProject = createdOther.body.id;
  cleanup.projectIds.push(otherProject);

  const flow = await call("GET", "/api/v1/projects/" + project + "/flow");
  const firstStage = (flow.body?.stages ?? [])[0];
  projectNode = (firstStage?.nodes ?? [])[0]?.id;
  projectStageKey = firstStage?.stageKey;
  check(
    "P3",
    "快照节点可见（文件挂 nodeId 用；变更阶段默认取节点所属阶段）",
    "节点与阶段 key 非空",
    short({ node: projectNode, stageKey: projectStageKey }, 120),
    projectNode !== undefined && projectStageKey !== undefined,
  );

  const createdTaskA = await call("POST", "/api/v1/projects/" + project + "/tasks", { title: "M4CHG-出图A（成果文件命中）", stageKey: projectStageKey, deliverableTypes: ["CAD图纸"] }, admin);
  taskMatchedA = createdTaskA.body?.id;
  const createdTaskB = await call("POST", "/api/v1/projects/" + project + "/tasks", { title: "M4CHG-出图B（成果文件命中）", stageKey: projectStageKey, deliverableTypes: ["CAD图纸"] }, admin);
  taskMatchedB = createdTaskB.body?.id;
  const createdTaskOther = await call("POST", "/api/v1/projects/" + project + "/tasks", { title: "M4CHG-合同（成果文件不命中）", stageKey: projectStageKey, deliverableTypes: ["合同"] }, admin);
  taskOther = createdTaskOther.body?.id;
  check(
    "P4",
    "建 3 个任务：两个输出成果文件 = CAD图纸（R01 多值命中）、一个 = 合同（对照）",
    "201 × 3",
    short({ a: taskMatchedA, b: taskMatchedB, other: taskOther }, 200),
    createdTaskA.status === 201 && createdTaskB.status === 201 && createdTaskOther.status === 201,
  );  // ---------- 证据一：变更入口（intent=change + fileId；会话落 change_payload） ----------
  const fileA = await uploadNewFile({
    projectId: project,
    name: "总装图-M4-04.docx",
    sizeBytes: FILE_A_SIZE,
    docType: "CAD图纸",
    nodeId: projectNode,
    session: admin,
  });
  const finalizedA = await finalizeFile(fileA.fileId, fileA.completed.body?.file?.version, admin);
  check(
    "U1",
    "上传文件 A（docType=CAD图纸、挂节点）+ 定档 → 变更目标就绪",
    "200（v1）+ 200（status=final）",
    short({ upload: fileA.completed.status, seq: fileA.completed.body?.version?.seq, finalize: finalizedA.status, status: finalizedA.body?.status }, 200),
    fileA.completed.status === 200 && finalizedA.status === 200 && finalizedA.body?.status === "final",
  );

  const filesBefore = await db.query("select count(*)::int as total from files where project_id = $1", [project]);
  const changeA = await changeUploadFile({
    projectId: project,
    fileId: fileA.fileId,
    name: "总装图-M4-04.docx",
    sizeBytes: FILE_B_SIZE,
    change: { reason: "设计变更（回放）：孔位按变更单 CR-2026-0918 调整", beforeSummary: "v1 按初版施工", afterSummary: "按变更单调整孔位" },
    session: admin,
  });
  const sessionRow = await db.query("select intent, change_payload from upload_sessions where id = $1", [changeA.uploadId]);
  const filesAfter = await db.query("select count(*)::int as total from files where project_id = $1", [project]);
  check(
    "C1",
    "变更入口放开：intent=change + fileId（目标 final）→ 201 会话 + change_payload 落库 + 不新建文件行",
    "201（intent=change、change_payload 带 reason/摘要）+ files 行数不变",
    short(
      {
        status: changeA.init.status,
        intent: changeA.init.body?.upload?.intent,
        payload: sessionRow.rows[0]?.change_payload,
        filesDelta: filesAfter.rows[0]?.total - filesBefore.rows[0]?.total,
      },
      320,
    ),
    changeA.init.status === 201 &&
      changeA.init.body?.upload?.intent === "change" &&
      sessionRow.rows[0]?.intent === "change" &&
      sessionRow.rows[0]?.change_payload?.reason === "设计变更（回放）：孔位按变更单 CR-2026-0918 调整" &&
      sessionRow.rows[0]?.change_payload?.afterSummary === "按变更单调整孔位" &&
      filesAfter.rows[0]?.total === filesBefore.rows[0]?.total,
  );

  // ---------- 证据二：目标门禁（非定档 / 不存在 / 跨项目 / 非成员） ----------
  const draftTarget = await uploadNewFile({ projectId: project, name: "草稿目标-M4-04.docx", sizeBytes: MI_B, docType: "CAD图纸", session: admin });
  const changeDraft = await createUpload(
    { projectId: project, name: "草稿目标-M4-04.docx", sizeBytes: MI_B, intent: "change", fileId: draftTarget.fileId, change: { reason: "未定档变更" } },
    admin,
  );
  const changeMissing = await createUpload(
    { projectId: project, name: "不存在.docx", sizeBytes: MI_B, intent: "change", fileId: "00000000-0000-4000-8000-000000000000", change: { reason: "目标不存在" } },
    admin,
  );
  const changeCrossProject = await createUpload(
    { projectId: otherProject, name: "总装图-M4-04.docx", sizeBytes: MI_B, intent: "change", fileId: fileA.fileId, change: { reason: "跨项目" } },
    admin,
  );
  const changeByMember = await createUpload(
    { projectId: project, name: "总装图-M4-04.docx", sizeBytes: MI_B, intent: "change", fileId: fileA.fileId, change: { reason: "非成员尝试" } },
    member,
  );
  check(
    "C2",
    "变更目标门禁：非定档 409 FILE_STATE_INVALID / 不存在 404 / 跨项目 400 invalid_file / 非成员 404（防 IDOR）",
    "409 FILE_STATE_INVALID / 404 NOT_FOUND / 400 VALIDATION_FAILED（invalid_file）/ 404",
    short(
      {
        draft: { status: changeDraft.status, code: changeDraft.body?.code },
        missing: { status: changeMissing.status, code: changeMissing.body?.code },
        cross: { status: changeCrossProject.status, code: changeCrossProject.body?.code, detail: changeCrossProject.body?.details?.[0]?.code },
        member: { status: changeByMember.status, code: changeByMember.body?.code },
      },
      360,
    ),
    changeDraft.status === 409 &&
      changeDraft.body?.code === "FILE_STATE_INVALID" &&
      changeMissing.status === 404 &&
      changeMissing.body?.code === "NOT_FOUND" &&
      changeCrossProject.status === 400 &&
      changeCrossProject.body?.details?.[0]?.code === "invalid_file" &&
      changeByMember.status === 404,
  );

  // ---------- 证据三：变更生效（完成上传：同事务写 change_requests / 版本 / 状态 / 关联 / 审计 / outbox） ----------
  const changeRequestId = changeA.completed.body?.changeRequest?.id;
  const changeRow = await db.query(
    "select id, project_id, node_id, stage_key, reason, before_summary, after_summary, status, applied_by, applied_at from change_requests where id = $1",
    [changeRequestId],
  );
  const versionRow = await db.query("select seq, change_request_id from file_versions where file_id = $1 order by seq desc limit 1", [fileA.fileId]);
  const fileRow = await db.query("select status, current_version_id, version from files where id = $1", [fileA.fileId]);
  check(
    "C3",
    "完成变更上传：200 + changeRequest 视图（applied / 同事务版本）+ 版本挂 change_request_id + 文件 final → changed",
    "200 + status=applied + 版本 change_request_id = 变更 id + files.status=changed",
    short(
      {
        status: changeA.completed.status,
        seq: changeA.completed.body?.version?.seq,
        changeRequest: changeA.completed.body?.changeRequest,
        versionRow: versionRow.rows[0],
        fileRow: fileRow.rows[0],
      },
      420,
    ),
    changeA.completed.status === 200 &&
      changeA.completed.body?.changeRequest?.status === "applied" &&
      changeA.completed.body?.changeRequest?.versionSeq === versionRow.rows[0]?.seq &&
      changeRow.rows[0]?.id === changeRequestId &&
      fileRow.rows[0]?.status === "changed" &&
      versionRow.rows[0]?.change_request_id === changeRequestId,
  );

  check(
    "C4",
    "change_requests 落库：reason / 摘要 / 申请人 / 变更阶段默认取文件节点所属阶段（stageKey 缺省）",
    "status=applied、stage_key=" + projectStageKey + "、applied_by=管理员、reason / 摘要与请求一致",
    short(changeRow.rows[0], 320),
    changeRow.rows[0]?.status === "applied" &&
      changeRow.rows[0]?.stage_key === projectStageKey &&
      changeRow.rows[0]?.node_id === projectNode &&
      changeRow.rows[0]?.applied_by === adminId &&
      changeRow.rows[0]?.reason === "设计变更（回放）：孔位按变更单 CR-2026-0918 调整" &&
      changeRow.rows[0]?.before_summary === "v1 按初版施工" &&
      changeRow.rows[0]?.after_summary === "按变更单调整孔位" &&
      changeRow.rows[0]?.applied_at !== null,
  );  const changeLink = await db.query("select object_type, object_id from file_links where file_id = $1 and object_type = 'change'", [fileA.fileId]);
  check(
    "C5",
    "多态关联写入 change 行（object_type=change，object_id=变更 id）",
    "1 行 change:" + changeRequestId,
    short(changeLink.rows, 200),
    changeLink.rows.length === 1 && changeLink.rows[0]?.object_id === changeRequestId,
  );

  const taskRows = await db.query("select id, deliverable_types, change_refs from tasks where project_id = $1 order by id", [project]);
  const byId = (id) => taskRows.rows.find((row) => row.id === id);
  check(
    "C6",
    "R01 自动关联（ADR-024 多值命中）：变更文件 doc_type ∈ 任务输出成果文件（CAD图纸）的任务全部追加 change_refs = [本次变更]；不命中任务保持空数组",
    "两个 CAD图纸 任务 change_refs = [变更 id]；合同任务 change_refs = []",
    short({ a: byId(taskMatchedA)?.change_refs, b: byId(taskMatchedB)?.change_refs, other: byId(taskOther)?.change_refs }, 260),
    JSON.stringify(byId(taskMatchedA)?.change_refs) === JSON.stringify([changeRequestId]) &&
      JSON.stringify(byId(taskMatchedB)?.change_refs) === JSON.stringify([changeRequestId]) &&
      Array.isArray(byId(taskOther)?.change_refs) &&
      byId(taskOther).change_refs.length === 0,
  );

  const outboxRow = await db.query("select topic, dedupe_key, status, payload from outbox_events where payload->>'changeRequestId' = $1", [changeRequestId]);
  const auditRow = await db.query(
    "select actor_id, action, object_type, object_id, changes, metadata from audit_logs where object_type = 'change' and object_id = $1",
    [changeRequestId],
  );
  check(
    "C7",
    "变更审计（object_type=change / action=create）+ outbox change.applied（同事务）",
    "审计 1 条（changes: final → changed、metadata.linkedTasks=2）+ outbox 1 条（dedupeKey=change.applied:{id}）",
    short(
      {
        outbox: { topic: outboxRow.rows[0]?.topic, dedupeKey: outboxRow.rows[0]?.dedupe_key, matchedTasks: outboxRow.rows[0]?.payload?.matchedTasks?.length },
        audit: { action: auditRow.rows[0]?.action, changes: auditRow.rows[0]?.changes, linkedTasks: auditRow.rows[0]?.metadata?.linkedTasks, stageKey: auditRow.rows[0]?.metadata?.stageKey },
      },
      380,
    ),
    outboxRow.rows.length === 1 &&
      outboxRow.rows[0]?.topic === "change.applied" &&
      outboxRow.rows[0]?.dedupe_key === "change.applied:" + changeRequestId &&
      outboxRow.rows[0]?.status === "pending" &&
      auditRow.rows.length === 1 &&
      auditRow.rows[0]?.action === "create" &&
      auditRow.rows[0]?.actor_id === adminId &&
      auditRow.rows[0]?.changes?.some((entry) => entry.field === "status" && entry.from === "final" && entry.to === "changed") === true &&
      auditRow.rows[0]?.metadata?.linkedTasks === 2,
  );

  // ---------- 证据四-a：变更关联多条（A1-07 追加 + 去重） ----------
  const changeA2 = await changeUploadFile({
    projectId: project,
    fileId: fileA.fileId,
    name: "总装图-M4-04.docx",
    sizeBytes: MI_B,
    change: { reason: "第二次变更（回放）：孔径按现场复测调整" },
    session: admin,
  });
  const changeRequestId2 = changeA2.completed.body?.changeRequest?.id;
  const taskRowsAfter2 = await db.query("select id, change_refs from tasks where project_id = $1 order by id", [project]);
  const byTaskId = (id) => taskRowsAfter2.rows.find((row) => row.id === id);
  check(
    "C6b",
    "变更关联多条（业务要求「变更关联」列展示多条）：同一成果类型的第二次变更追加到数组末位（= 追加序 [首次, 本次]），数组不覆盖",
    "[变更1, 变更2]（两个 CAD图纸 任务）；合同任务仍为空数组",
    short({ a: byTaskId(taskMatchedA)?.change_refs, b: byTaskId(taskMatchedB)?.change_refs, other: byTaskId(taskOther)?.change_refs, change2: changeRequestId2 }, 320),
    changeA2.completed.status === 200 &&
      typeof changeRequestId2 === "string" &&
      JSON.stringify(byTaskId(taskMatchedA)?.change_refs) === JSON.stringify([changeRequestId, changeRequestId2]) &&
      JSON.stringify(byTaskId(taskMatchedB)?.change_refs) === JSON.stringify([changeRequestId, changeRequestId2]) &&
      Array.isArray(byTaskId(taskOther)?.change_refs) &&
      byTaskId(taskOther).change_refs.length === 0,
  );

  // 去重（幂等）：同一变更重复回写不产生重复项 —— SQL 与 file.repository.appendTasksChangeRefs 的 case-when 同形
  await db.query(
    "update tasks set change_refs = case when $2::uuid = any(change_refs) then change_refs else array_append(change_refs, $2::uuid) end where id = $1",
    [taskMatchedA, changeRequestId2],
  );
  const dedupeRow = await db.query("select change_refs from tasks where id = $1", [taskMatchedA]);
  check(
    "C6c",
    "追加 + 去重（幂等）：同一变更重复回写不产生重复项（数组仍两项、无重复）",
    "长度 2、去重后仍 2",
    short({ refs: dedupeRow.rows[0]?.change_refs }, 220),
    Array.isArray(dedupeRow.rows[0]?.change_refs) &&
      dedupeRow.rows[0].change_refs.length === 2 &&
      new Set(dedupeRow.rows[0].change_refs).size === 2,
  );

  // ---------- 证据四：R01 无匹配（只记日志、不阻断变更生效） ----------
  const fileB = await uploadNewFile({ projectId: project, name: "评审单-M4-04.docx", sizeBytes: FILE_B_SIZE, docType: "评审单", nodeId: projectNode, session: admin });
  await finalizeFile(fileB.fileId, fileB.completed.body?.file?.version, admin);
  const refsBeforeB = (await db.query("select change_refs from tasks where project_id = $1 order by id", [project])).rows.map(
    (row) => row.change_refs,
  );
  const changeB = await changeUploadFile({
    projectId: project,
    fileId: fileB.fileId,
    name: "评审单-M4-04.docx",
    sizeBytes: MI_B,
    change: { reason: "评审意见修订（无对应成果任务）" },
    session: admin,
  });
  const taskRowsAfterB = await db.query("select id, change_refs from tasks where project_id = $1 order by id", [project]);
  const refsAfterB = taskRowsAfterB.rows.map((row) => row.change_refs);
  check(
    "C8",
    "R01 无匹配（成果类型 = 评审单，无对应任务）→ 变更仍生效、change_refs 不回写（提示申请人随 M5）",
    "200 + changeRequest 非空 + 既有任务 change_refs 与变更前逐条一致",
    short({ status: changeB.completed.status, changeRequest: changeB.completed.body?.changeRequest?.id, refs: refsAfterB }, 260),
    changeB.completed.status === 200 &&
      typeof changeB.completed.body?.changeRequest?.id === "string" &&
      JSON.stringify(refsAfterB) === JSON.stringify(refsBeforeB),
  );

  // ---------- 证据五：定档后回溯 = 变更（A4-13 申请即通过） ----------
  const fileC = await uploadNewFile({ projectId: project, name: "合同扫描件-M4-04.pdf", sizeBytes: FILE_B_SIZE, docType: "合同", nodeId: projectNode, session: admin });
  const versionC1 = fileC.completed.body?.version;
  await appendVersion({ projectId: project, fileId: fileC.fileId, name: "合同扫描件-M4-04.pdf", sizeBytes: MI_B, session: admin });
  const finalizedC = await finalizeFile(fileC.fileId, (await fileDetail(fileC.fileId, admin)).body?.version, admin);
  const rolledBackC = await rollbackFile(fileC.fileId, versionC1.id, "定档后回退到 v1（走变更）", finalizedC.body?.version, admin);
  const rollbackChange = rolledBackC.body?.changeRequest;
  const versionC = await db.query("select seq, change_request_id from file_versions where file_id = $1 order by seq desc limit 1", [fileC.fileId]);
  const fileCRow = await db.query("select status, version from files where id = $1", [fileC.fileId]);
  const taskOtherAfter = await db.query("select change_refs from tasks where id = $1", [taskOther]);
  check(
    "C9",
    "定档后回溯 = 变更（不再 400）：changeRequest 非空 + 新版本挂 change_request_id + 状态 final → changed + 合同任务 change_refs = [本次变更]",
    "200 + changeRequest.status=applied + 版本 change_request_id 一致 + files.status=changed + 合同任务 change_refs=[本次变更]",
    short({ status: rolledBackC.status, changeRequest: rollbackChange, version: versionC.rows[0], file: fileCRow.rows[0], taskOther: taskOtherAfter.rows[0]?.change_refs }, 420),
    rolledBackC.status === 200 &&
      rollbackChange?.status === "applied" &&
      rollbackChange?.reason === "定档后回退到 v1（走变更）" &&
      versionC.rows[0]?.change_request_id === rollbackChange.id &&
      fileCRow.rows[0]?.status === "changed" &&
      JSON.stringify(taskOtherAfter.rows[0]?.change_refs) === JSON.stringify([rollbackChange.id]),
  );

  // ---------- 证据六：定档后管控（changed 文件不再接受 version 追加） ----------
  const appendAfterChange = await createUpload(
    { projectId: project, name: "总装图-M4-04.docx", sizeBytes: MI_B, intent: "version", fileId: fileA.fileId },
    admin,
  );
  check(
    "C10",
    "定档后管控：intent=version 对 changed 文件 → 409 FILE_STATE_INVALID（修改须走变更）",
    "409 FILE_STATE_INVALID",
    appendAfterChange.status + " " + short({ code: appendAfterChange.body?.code }, 80),
    appendAfterChange.status === 409 && appendAfterChange.body?.code === "FILE_STATE_INVALID",
  );} catch (error) {
  failures += 1;
  report.push("| FAIL | 中断：" + (error instanceof Error ? error.message : String(error)));
  process.stderr.write("M4-04 回放失败：" + (error instanceof Error ? error.message : String(error)) + "\n");
} finally {
  if (db !== undefined) {
    try {
      if (args.keep !== true) {
        for (const projectId of cleanup.projectIds) {
          await db.query("update files set current_version_id = null where project_id = $1", [projectId]);
          await db.query("delete from file_links where file_id in (select id from files where project_id = $1)", [projectId]);
          await db.query("delete from upload_sessions where file_id in (select id from files where project_id = $1)", [projectId]);
          await db.query("delete from file_versions where file_id in (select id from files where project_id = $1)", [projectId]);
          await db.query("delete from change_requests where project_id = $1", [projectId]);
          await db.query("delete from files where project_id = $1", [projectId]);
          await db.query("delete from task_events where task_id in (select id from tasks where project_id = $1)", [projectId]);
          await db.query("delete from tasks where project_id = $1", [projectId]);
          await db.query("delete from audit_logs where project_id = $1", [projectId]);
          await db.query("delete from outbox_events where payload::text like $$%$$ || $1::text || $$%$$", [projectId]);
          await db.query("delete from node_requirements where node_id in (select id from project_nodes where project_id = $1)", [projectId]);
          await db.query("delete from project_nodes where project_id = $1", [projectId]);
          await db.query("delete from project_stages where project_id = $1", [projectId]);
          await db.query("delete from project_members where project_id = $1", [projectId]);
          await db.query("delete from projects where id = $1", [projectId]);
        }
        if (storage !== undefined) {
          for (const projectId of cleanup.projectIds) {
            await purgePrefix("projects/" + projectId + "/").catch(() => undefined);
          }
        }
      }
      for (const token of cleanup.sessions) {
        await db.query("update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null", [sha256(token)]);
      }
    } catch (error) {
      report.push("| WARN | 收尾未完全成功：" + (error instanceof Error ? error.message : String(error)));
    }
    await db.end();
  }
}
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: serverRoot }).toString().trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: serverRoot }).toString().trim() !== "";
const lines = [];
lines.push("# M4-04 回放证据（S7·file 变更 · 申请即通过）");
lines.push("");
lines.push("> 卡片：M4-04「变更（申请即通过）」一期写入切片（主责 lan，评审 wmj）｜口径来源：系统功能书 A4-13（定档后变更须走变更流程，申请即通过、平权）/ A4-14（变更 = 新版本 + 变更记录）/ A4-17（变更统计，读面随后续切片）｜技术设计v0.2 §2.3（`change_requests`）与 §5.1-5.3｜ADR-024 §R01（输出成果文件 = 变更文件 → 自动关联任务）｜契约 shared/src/modules/files.ts（`ChangeIntentBody` / `ChangeRequest`，本卡零改动）。");
lines.push("> 落点说明：`docs/` 属 px 线；本文件由 lan 随 M4-04 写入切片代记（回放脚本与断言同 PR，请 px 复核）。");
lines.push("");
lines.push("| 项 | 值 |");
lines.push("|---|---|");
lines.push("| 回放时间 | " + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ") + " +08:00 |");
lines.push("| 目标 | " + BASE_URL + " |");
lines.push("| 数据库 | " + DATABASE_URL.replace(/:[^:@/]+@/, ":***@") + " |");
lines.push("| 对象存储 | " + (storage === undefined ? "-" : storage.bucket) + "（本地 MinIO 沙箱：仅沙箱、不代表生产选型） |");
lines.push("| 代码版本 | " + commit + (dirty ? "（回放时工作区含本卡未提交改动）" : "") + " |");
lines.push("| 执行账号 | 管理员（建项目 / 建任务 / 上传 / 变更）+ 非成员（404 反例） |");
lines.push("| 脚本 | server/scripts/m4-change-replay.mjs |");
lines.push("");
lines.push("## 断言明细");
lines.push("");
lines.push(...report);
lines.push("");
lines.push("## 汇总");
lines.push("");
lines.push(failures === 0 ? "- ✅ 全部断言通过（" + evidence.steps.filter((step) => step.ok).length + " 项）：变更入口与载荷落库 / 目标门禁 / 生效链路（变更记录 + 版本 + 状态 + 关联 + 审计 + outbox）/ R01 多值命中与多条追加 + 去重 / 无匹配 / 定档后回溯 = 变更 / 定档后管控。" : "- ❌ 有 " + failures + " 项失败，见上方 FAIL 行。");
lines.push("");
lines.push("## 验收对照（M4-04 写入切片）");
lines.push("");
lines.push("- 变更入口 = C1 / C2：`intent=change` 随上传管道提交（技术设计v0.3 §3.5 口径），`ChangeIntentBody` 落 `upload_sessions.change_payload`；目标须 final / changed，其余状态 409 / 不存在 404 / 跨项目 400 / 无可见性 404。");
lines.push("- 变更生效 = C3 / C4 / C5 / C7：完成上传同一事务写 `change_requests`（status=applied、stage_key 缺省取节点阶段）+ 版本挂 `change_request_id` + `files.status=changed` + `file_links`(change) + 审计（object_type=change）+ outbox `change.applied`。");
lines.push("- R01 自动关联 = C6 / C6b / C6c / C8 / C9：按「变更文件成果类型 ∈ 任务输出成果文件（`deliverable_types` 多值）」命中全部**追加 + 去重**回写 `tasks.change_refs`（A1-07「一条任务可关联多条变更」，数组顺序 = 追加序；迁移 0020）；无匹配只记日志、不阻断（提示申请人随 M5 通知）。");
lines.push("- 定档后回溯 = C9（A4-13）：`POST /files/{id}/rollback` 对 final 文件即变更（生成新版本 + 变更记录 + 状态 changed），不再 400。");
lines.push("- 定档后管控 = C10：`intent=version` 对非 draft 文件 409 `FILE_STATE_INVALID`（修改须走变更）。");
lines.push("- 单测回归（不连库）：server/test/file-service.test.ts 随 npm test 常跑：change 入口（载荷规范化 / 目标门禁 / 不新建文件）、change 完成链路（变更记录 / 版本挂接 / 状态 / 关联 / R01 / 审计 / outbox）、R01 无匹配只告警、定档后回溯 = 变更。");
lines.push("");
lines.push("## 与后续卡片的关系");
lines.push("");
lines.push("- 本切片只落**写入面**（变更申请即通过 + 生效链路）；**读面**（`GET /projects/{id}/change-requests` / `GET /change-requests/{id}`）与**统计**（A4-17）随 M4-04 后续切片，通知（A4-18）随 M5（outbox `change.applied` 已埋点）。");
lines.push("- 既有回放同步切换：`scripts/m4-lifecycle-replay.mjs` 的 L5（定档后回溯）与 `scripts/m4-upload-replay.mjs` 的 U22（change 入口）随本卡改动同步更新，避免旧断言把新行为判失败。");
lines.push("- `server/scripts/m4-lifecycle-replay.mjs` 收尾新增 `change_requests` 清理（定档后回溯会产变更记录）。");
lines.push("- 复跑：cd server && node --env-file-if-exists=.env scripts/m4-change-replay.mjs --out \"../docs/m4-04-回放证据(变更申请即通过).md\"");
lines.push("");

if (args.json !== undefined) writeFileSync(args.json, JSON.stringify(evidence, null, 2) + "\n", "utf8");
if (args.out !== undefined) writeFileSync(args.out, lines.join("\n"), "utf8");
process.stdout.write(lines.join("\n") + "\n");
process.exit(failures === 0 ? 0 : 1);