#!/usr/bin/env node
/**
 * M4-03 真机回放（S7·file 多态关联与文件库查询 · PR-6）：
 *   证据一（多态关联）：上传完成即写 file_links —— project 必写、node / task 有则写；唯一 (file, object_type, object_id)
 *           保证幂等（重复完成 / 追加版本不产生重复行）。
 *   证据二（文件库查询）：GET /projects/{id}/files —— 状态 / 类型 / 节点 / 任务 / 上传人筛选 + 关键字 + 白名单排序 + 分页。
 *   证据三（默认口径）：不带 filter[status] 排除 recycled；显式 filter[status] 以给出为准（回收站文件可查）。
 *   证据四（非法输入）：排序白名单外 / 非法状态 / 非法类型 / 非 UUID → 400 VALIDATION_FAILED（不静默忽略）。
 *   证据五（权限）：读 = 项目可见即可（非成员 / 不可见 → 404，ProjectAccessGuard 防 IDOR）。
 *
 * 前置：真 PG（DATABASE_URL）+ 真对象存储（S3_*，见 deploy/minio/）+ 已起 api（BASE_URL）。本脚本只在本地沙箱 / 联调库跑：
 *       铸两个临时会话（管理员 + 名册成员，跑完撤销）、建 M4LIB- 回放项目（跑完硬删项目及其文件 / 关联 / 会话 / 任务 / 审计 / outbox 事件 + 清桶内前缀）。
 * 用法：cd server && M4_DATABASE_URL=postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink \
 *       node --env-file-if-exists=.env scripts/m4-library-replay.mjs [--out <报告.md>] [--json <证据.json>] [--keep]
 *      （脚本侧的断言 SQL 与收尾需要迁移器权限：audit_logs 对应用角色只授 SELECT / INSERT，删不动，故 M4_DATABASE_URL 优先于 DATABASE_URL）
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
  const session = { userId, token: "m4lib-" + randomBytes(16).toString("hex"), csrf: randomBytes(16).toString("hex") };
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
  if (!ok) throw new Error("M4-03 回放失败（" + id + "）：" + title);
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
}

let admin;
let member;
let storage;
let rawClient;
let s3Module;
let adminId;
let memberId;
let project;
let projectNode;
let projectTask;
let otherProject;
const createUpload = (body, session) => call("POST", "/api/v1/files/uploads", body, session);
const signParts = (fileId, uploadId, partNumbers, session) =>
  call("POST", "/api/v1/files/" + fileId + "/uploads/" + uploadId + "/parts", { partNumbers }, session);
const completeUpload = (fileId, uploadId, contentHash, session) =>
  call("POST", "/api/v1/files/" + fileId + "/uploads/" + uploadId + "/complete", { contentHash }, session);
const recycleFile = (fileId, version, reason, session) =>
  call("POST", "/api/v1/files/" + fileId + "/recycle", reason === undefined ? { version } : { version, reason }, session);
/** 文件库列表（filter[...] 键按字面传递：真机实测 zod details.path = filter[ownerId]，不被 qs 折叠）。 */
const fileList = (projectId, params, session) => {
  const search = new URLSearchParams(params).toString();
  return call("GET", "/api/v1/projects/" + projectId + "/files" + (search === "" ? "" : "?" + search), undefined, session);
};

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

/** 该键在存储侧的版本与 delete marker（按 Key 精确过滤：Prefix 会带出同前缀的其它键）。 */
async function versionsOfKey(key) {
  const output = await rawClient.send(new s3Module.ListObjectVersionsCommand({ Bucket: storage.bucket, Prefix: key }));
  return {
    versions: (output.Versions ?? []).filter((item) => item.Key === key),
    markers: (output.DeleteMarkers ?? []).filter((item) => item.Key === key),
  };
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
  if (memberId === undefined) throw new Error("找不到第二个账号（名册成员基准账号）");
  admin = await makeSession(adminId, "m4lib-replay-admin");
  member = await makeSession(memberId, "m4lib-replay-member");
  cleanup.sessions.push(admin.token, member.token);

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const created = await call("POST", "/api/v1/projects", {
    code: "M4LIB-" + stamp,
    name: "m4-03 回放项目（文件库查询 + 多态关联）",
    projectType: "default",
    managerIds: [adminId],
  });
  check("P1", "建回放项目（为 file 提供 projectId）", "201 + 项目可见", created.status + " " + short({ id: created.body?.id, code: created.body?.code }, 120), created.status === 201);
  project = created.body.id;
  cleanup.projectIds.push(project);

  const createdOther = await call("POST", "/api/v1/projects", {
    code: "M4LIBX-" + stamp,
    name: "m4-03 回放项目（不可见反例）",
    projectType: "default",
    managerIds: [adminId],
  });
  check("P2", "建第二个项目（非成员 404 反例用）", "201", createdOther.status, createdOther.status === 201);
  otherProject = createdOther.body.id;
  cleanup.projectIds.push(otherProject);

  const flow = await call("GET", "/api/v1/projects/" + project + "/flow");
  projectNode = (flow.body?.stages ?? []).flatMap((stage) => stage.nodes ?? [])[0]?.id;
  check("P3", "快照节点可见（为文件挂接 nodeId 用）", "节点非空", short({ node: projectNode }, 120), projectNode !== undefined);

  const createdTask = await call("POST", "/api/v1/projects/" + project + "/tasks", { title: "M4LIB-挂接任务", stageKey: "design" }, admin);
  projectTask = createdTask.body?.id;
  check("P4", "建回放任务（为文件挂接 taskId 用；管理员手工创建）", "201 + 任务 id", createdTask.status + " " + short({ task: projectTask }, 120), createdTask.status === 201 && projectTask !== undefined);
  const idsOf = (body) => (body?.items ?? []).map((item) => item.id).sort().join(",");

  // ---------- 证据一：多态关联（file_links 写入 + 幂等） ----------
  const fileA = await uploadNewFile({
    projectId: project,
    name: "总装图-M4-03.docx",
    sizeBytes: FILE_A_SIZE,
    docType: "CAD图纸",
    nodeId: projectNode,
    taskId: projectTask,
    session: admin,
  });
  const linksA = await db.query("select object_type, object_id from file_links where file_id = $1", [fileA.fileId]);
  const pairsA = linksA.rows.map((row) => row.object_type + ":" + row.object_id).sort();
  const expectedA = ["project:" + project, "node:" + projectNode, "task:" + projectTask].sort();
  check(
    "L1",
    "上传完成写 file_links：挂节点 + 任务的文件 = project / node / task 三行",
    "3 行，object_id 分别指向项目 / 节点 / 任务",
    short({ status: fileA.completed.status, pairs: pairsA }, 260),
    fileA.completed.status === 200 && pairsA.join("|") === expectedA.join("|"),
  );

  const fileB = await uploadNewFile({
    projectId: project,
    name: "评审单-M4-03.docx",
    sizeBytes: FILE_B_SIZE,
    docType: "评审单",
    session: admin,
  });
  const linksB = await db.query("select object_type, object_id from file_links where file_id = $1", [fileB.fileId]);
  check(
    "L2",
    "无挂接文件只写 project 一行（node / task 为空不写）",
    "1 行 project:" + project,
    short({ status: fileB.completed.status, rows: linksB.rows }, 220),
    fileB.completed.status === 200 && linksB.rows.length === 1 && linksB.rows[0].object_type === "project" && linksB.rows[0].object_id === project,
  );

  const appended = await appendVersion({
    projectId: project,
    fileId: fileA.fileId,
    name: "总装图-M4-03.docx",
    sizeBytes: FILE_B_SIZE,
    session: admin,
  });
  const linksAfterAppend = await db.query("select count(*)::int as total from file_links where file_id = $1", [fileA.fileId]);
  check(
    "L3",
    "重复完成（追加版本 v2）幂等：唯一约束 + on conflict do nothing，关联行数不变",
    "200（seq=2）且 file_links 仍 3 行",
    short({ status: appended.completed.status, seq: appended.completed.body?.version?.seq, links: linksAfterAppend.rows[0]?.total }, 200),
    appended.completed.status === 200 && appended.completed.body?.version?.seq === 2 && linksAfterAppend.rows[0]?.total === 3,
  );

  // ---------- 证据二：文件库查询（筛选 / 关键字 / 排序 / 分页） ----------
  const listAll = await fileList(project, {}, admin);
  check(
    "L4",
    "默认列表 = 项目全量（不带 filter[status] 排除 recycled）：A / B 都在，total=2",
    "200 + total=2 + ids = {A,B}",
    short({ status: listAll.status, total: listAll.body?.total, ids: idsOf(listAll.body) }, 220),
    listAll.status === 200 && listAll.body?.total === 2 && idsOf(listAll.body) === [fileA.fileId, fileB.fileId].sort().join(","),
  );

  const listByNode = await fileList(project, { "filter[nodeId]": projectNode }, admin);
  const listByTask = await fileList(project, { "filter[taskId]": projectTask }, admin);
  check(
    "L5",
    "双向跳转（对象侧）：filter[nodeId] / filter[taskId] 反查只命中挂接文件 A",
    "两条均 total=1 且 ids=[A]",
    short({ node: idsOf(listByNode.body), task: idsOf(listByTask.body) }, 200),
    listByNode.status === 200 && listByNode.body?.total === 1 && idsOf(listByNode.body) === fileA.fileId && listByTask.body?.total === 1 && idsOf(listByTask.body) === fileA.fileId,
  );

  const listDocMulti = await fileList(project, { "filter[docType]": "CAD图纸,评审单" }, admin);
  const listDocSingle = await fileList(project, { "filter[docType]": "评审单" }, admin);
  check(
    "L6",
    "类型筛选：多值逗号 = OR（A+B）；单值只命中 B",
    "多值 total=2；单值 ids=[B]",
    short({ multi: idsOf(listDocMulti.body), single: idsOf(listDocSingle.body) }, 220),
    listDocMulti.body?.total === 2 && idsOf(listDocMulti.body) === [fileA.fileId, fileB.fileId].sort().join(",") && listDocSingle.body?.total === 1 && idsOf(listDocSingle.body) === fileB.fileId,
  );

  const listDraft = await fileList(project, { "filter[status]": "draft" }, admin);
  const listFinal = await fileList(project, { "filter[status]": "final" }, admin);
  check(
    "L7",
    "状态筛选：filter[status]=draft 命中共 2 个；= final 为空（尚未定档）",
    "draft total=2 / final total=0",
    short({ draft: listDraft.body?.total, final: listFinal.body?.total }, 160),
    listDraft.body?.total === 2 && listFinal.body?.total === 0,
  );

  const listByUploader = await fileList(project, { "filter[uploadedBy]": adminId }, admin);
  const listByOtherUploader = await fileList(project, { "filter[uploadedBy]": memberId }, admin);
  check(
    "L8",
    "上传人筛选（files.created_by）：管理员命中 2；无产出的成员命中 0",
    "admin → total=2；member → total=0",
    short({ admin: listByUploader.body?.total, member: listByOtherUploader.body?.total }, 160),
    listByUploader.body?.total === 2 && listByOtherUploader.body?.total === 0,
  );

  const listKeyword = await fileList(project, { q: "总装" }, admin);
  check(
    "L9",
    "关键字（文件名）：q=总装 只命中 A",
    "total=1 且 ids=[A]",
    short({ ids: idsOf(listKeyword.body) }, 160),
    listKeyword.status === 200 && listKeyword.body?.total === 1 && idsOf(listKeyword.body) === fileA.fileId,
  );

  const page1 = await fileList(project, { sort: "name:asc", limit: 1, page: 1 }, admin);
  const page2 = await fileList(project, { sort: "name:asc", limit: 1, page: 2 }, admin);
  check(
    "L10",
    "白名单排序 + 分页：sort=name:asc 升序（总装图 < 评审单），limit=1 逐页取",
    "page1=[A] / page2=[B]，total 均 2",
    short({ page1: idsOf(page1.body), page2: idsOf(page2.body), total: page1.body?.total }, 200),
    idsOf(page1.body) === fileA.fileId && idsOf(page2.body) === fileB.fileId && page1.body?.total === 2 && page2.body?.total === 2,
  );

  // ---------- 证据三：非法输入（400，不静默忽略） ----------
  const badSort = await fileList(project, { sort: "sizeBytes:desc" }, admin);
  const badStatus = await fileList(project, { "filter[status]": "draft,pending" }, admin);
  const badDocType = await fileList(project, { "filter[docType]": "CAD图纸,发票" }, admin);
  const badUuid = await fileList(project, { "filter[nodeId]": "not-a-uuid" }, admin);
  const badDirection = await fileList(project, { sort: "createdAt:up" }, admin);
  check(
    "L11",
    "非法输入一律 400 VALIDATION_FAILED：排序白名单外 / 非法状态 / 非法类型 / 非 UUID / 非法方向",
    "5 条请求全部 400",
    short(
      {
        sort: badSort.status,
        status: badStatus.status,
        docType: badDocType.status,
        uuid: badUuid.status,
        direction: badDirection.status,
      },
      200,
    ),
    badSort.status === 400 &&
      badStatus.status === 400 &&
      badDocType.status === 400 &&
      badUuid.status === 400 &&
      badDirection.status === 400 &&
      badUuid.body?.details?.[0]?.path === "filter[nodeId]",
  );

  // ---------- 证据四：对象侧反查与回收站口径 ----------
  const byTaskRows = await db.query("select file_id from file_links where object_type = 'task' and object_id = $1", [projectTask]);
  const byNodeRows = await db.query("select file_id from file_links where object_type = 'node' and object_id = $1", [projectNode]);
  check(
    "L12",
    "file_links 反查（双向跳转的数据面）：按 (task, id) / (node, id) 查得同一 file_id = A，与列表 filter 一致",
    "两条 SQL 均只返回 A",
    short({ byTask: byTaskRows.rows, byNode: byNodeRows.rows }, 200),
    byTaskRows.rows.length === 1 && byTaskRows.rows[0].file_id === fileA.fileId && byNodeRows.rows.length === 1 && byNodeRows.rows[0].file_id === fileA.fileId,
  );

  // 注意：complete 响应里 body.version 是 FileVersion 对象；乐观锁版本号在 body.file.version。
  const recycledB = await recycleFile(fileB.fileId, fileB.completed.body?.file?.version, "M4-03 回放回收", admin);
  const listDefaultAfter = await fileList(project, {}, admin);
  const listRecycledOnly = await fileList(project, { "filter[status]": "recycled" }, admin);
  const listWithRecycled = await fileList(project, { "filter[status]": "draft,recycled" }, admin);
  check(
    "L13",
    "回收站口径：默认列表排除 recycled；显式 filter[status]=recycled 只看回收站；多值 draft,recycled = A+B",
    "默认=[A]；recycled=[B]；draft,recycled=[A,B]",
    short({ recycled: recycledB.status, default: idsOf(listDefaultAfter.body), only: idsOf(listRecycledOnly.body), both: idsOf(listWithRecycled.body) }, 260),
    recycledB.status === 200 &&
      idsOf(listDefaultAfter.body) === fileA.fileId &&
      listDefaultAfter.body?.total === 1 &&
      idsOf(listRecycledOnly.body) === fileB.fileId &&
      listRecycledOnly.body?.total === 1 &&
      listWithRecycled.body?.total === 2,
  );

  // ---------- 证据五：权限（读 = 项目可见即可） ----------
  const memberList = await fileList(project, {}, member);
  const memberOther = await fileList(otherProject, {}, member);
  const adminOther = await fileList(otherProject, {}, admin);
  check(
    "L14",
    "权限：非成员读文件库 → 404（防 IDOR）；项目可见者才可读（admin 读另一项目 200 对照）",
    "member→404 / member 他项目→404 / admin 他项目→200",
    short({ member: memberList.status, memberOther: memberOther.status, adminOther: adminOther.status }, 180),
    memberList.status === 404 && memberOther.status === 404 && adminOther.status === 200,
  );} catch (error) {
  failures += 1;
  report.push("| FAIL | 中断：" + (error instanceof Error ? error.message : String(error)));
  process.stderr.write("M4-03 回放失败：" + (error instanceof Error ? error.message : String(error)) + "\n");
} finally {
  if (db !== undefined) {
    try {
      if (args.keep !== true) {
        for (const projectId of cleanup.projectIds) {
          await db.query("update files set current_version_id = null where project_id = $1", [projectId]);
          await db.query("delete from file_links where file_id in (select id from files where project_id = $1)", [projectId]);
          await db.query("delete from upload_sessions where file_id in (select id from files where project_id = $1)", [projectId]);
          await db.query("delete from file_versions where file_id in (select id from files where project_id = $1)", [projectId]);
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
lines.push("# M4-03 回放证据（S7·file 多态关联与文件库查询）");
lines.push("");
lines.push("> 卡片：M4-03「多态关联与文件库查询（项目 / 任务 / 日报 / 问题 / 变更双向跳转）」（主责 lan，评审 wmj）｜口径来源：系统功能书 A4-01（项目文件库：按类型 / 阶段 / 任务分组；按上传人 / 时间 / 类型筛选）/ A4-03（上传成功即写入文件库并建立关联）/ A4-09（一处关联多处可见、双向跳转）｜技术设计v0.3 §3.5（M4 新增表 `file_links`：file_id、object_type、object_id）；契约 shared/src/modules/files.ts（FileListQuery / FileListResponse，本卡零改动）。");
lines.push("> 落点说明：`docs/` 属 px 线；本文件由 lan 随 M4-03 卡片代记（回放脚本与断言同 PR，请 px 复核）。");
lines.push("");
lines.push("| 项 | 值 |");
lines.push("|---|---|");
lines.push("| 回放时间 | " + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ") + " +08:00 |");
lines.push("| 目标 | " + BASE_URL + " |");
lines.push("| 数据库 | " + DATABASE_URL.replace(/:[^:@/]+@/, ":***@") + " |");
lines.push("| 对象存储 | " + (storage === undefined ? "-" : storage.bucket) + "（本地 MinIO 沙箱：仅沙箱、不代表生产选型） |");
lines.push("| 代码版本 | " + commit + (dirty ? "（回放时工作区含本卡未提交改动）" : "") + " |");
lines.push("| 执行账号 | 管理员（建项目 / 建任务 / 上传）+ 名册成员（非成员 404 反例） |");
lines.push("| 脚本 | server/scripts/m4-library-replay.mjs |");
lines.push("");
lines.push("## 断言明细");
lines.push("");
lines.push(...report);
lines.push("");
lines.push("## 汇总");
lines.push("");
lines.push(failures === 0 ? "- ✅ 全部断言通过（" + evidence.steps.filter((step) => step.ok).length + " 项）：多态关联写入与幂等 / 文件库筛选（节点 / 任务 / 类型 / 状态 / 上传人 / 关键字）/ 排序与分页 / 回收站口径 / 非法输入 400 / 权限 404。" : "- ❌ 有 " + failures + " 项失败，见上方 FAIL 行。");
lines.push("");
lines.push("## 验收对照（M4-03）");
lines.push("");
lines.push("- 多态关联（file_links）= L1 / L2 / L3：上传完成即写关联（project 必写、node / task 有则写）；唯一（file_id, object_type, object_id）保证幂等（追加版本不重复写）。");
lines.push("- 双向跳转（对象 → 文件）= L5 / L12：列表 filter[nodeId] / filter[taskId] 与 file_links 反查同一结果集（任务 / 节点侧一个文件多处可见）。");
lines.push("- 文件库查询 = L4 / L6 / L7 / L8 / L9 / L10：状态 / 类型 / 上传人筛选 + 文件名关键字 + 白名单排序（createdAt / updatedAt / finalizedAt / name / status）+ 分页；默认排除 recycled（与任务文件摘要同口径）。");
lines.push("- 回收站口径 = L13：默认列表排除 recycled；显式 filter[status]=recycled 只看回收站；多值 draft,recycled 两者都出。");
lines.push("- 非法输入 = L11：排序白名单外 / 非法状态 / 非法类型 / 非 UUID / 非法方向 → 400 VALIDATION_FAILED（details.path = filter[...]，不静默忽略）。");
lines.push("- 权限 = L14：读 = 项目可见即可（非成员 / 不可见项目 404，ProjectAccessGuard 防 IDOR）。");
lines.push("- 单测回归（不连库）：server/test/file-service.test.ts（61 例）随 npm test 常跑：筛选解析（多值 / trim / 分页 offset）/ 非法输入 400 / 关联写入（project+node+task）/ 幂等。");
lines.push("");
lines.push("## 与后续卡片的关系");
lines.push("");
lines.push("- file_links 的 report / issue / change 三类关联随对应模块落地后写入（日报 / 问题在 M6、变更在 M4-04）；读面（关联查询接口）随之扩展，本卡先落表 / 写入 / 反查方法（`listFileLinks` / `listFileIdsByObject`）。");
lines.push("- 复跑：cd server && node --env-file-if-exists=.env scripts/m4-library-replay.mjs --out \"../docs/m4-03-回放证据(多态关联与文件库查询).md\"");
lines.push("");

if (args.json !== undefined) writeFileSync(args.json, JSON.stringify(evidence, null, 2) + "\n", "utf8");
if (args.out !== undefined) writeFileSync(args.out, lines.join("\n"), "utf8");
process.stdout.write(lines.join("\n") + "\n");
process.exit(failures === 0 ? 0 : 1);
