#!/usr/bin/env node
/**
 * M4-05c 真机回放（S7·file 预览转换队列 · PR-10）：
 *   证据一（定档预生成投递）：定档锁版 → outbox 落 `preview.job`，去重键 = 三元组（内容哈希 + 管线版本 + 渲染通道）。
 *   证据二（队列消费）：worker 领 outbox → 读源字节 → 调转换沙箱（字节流进 / 字节流出）→ 产物回对象存储 → `preview_artifacts` ready。
 *   证据三（产物形态）：对象键 = `previews/{contentHash}/{pipelineVersion}/{target}`、content-type = application/pdf、内嵌 Noto CJK（中文不乱码的字体层证据）。
 *   证据四（三元组幂等 · D2-06）：同内容的第二个文件定档 → 不新增任务、不重转（登记版本仍是首次生成者）。
 *   证据五（失败降级 · D2-05）：超大源文件直接降级「请下载」→ `preview_artifacts.failed` + outbox `dead`（不重试）。
 *   证据六（不占配额）：判不出渲染通道的类型（.zip）不投递预览任务。
 *
 * 前置：真 PG（DATABASE_URL）+ 真对象存储（S3_*，见 deploy/minio/）+ 真转换沙箱（deploy/preview，默认 http://127.0.0.1:9900）
 *       + 已起 api（BASE_URL）与 worker（worker 负责消费；建议 OUTBOX_POLL_MS=1000 加快回放）。
 *       本脚本只在本地沙箱 / 联调库跑：铸临时管理员会话（跑完撤销）、建 M4PVW- 回放项目
 *       （跑完硬删项目及其文件 / 版本 / 会话 / 关联 / 审计 / outbox 事件 + 清桶内 projects/ 与 previews/ 前缀）。
 * 用法：cd server && M4_DATABASE_URL=postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink \
 *       node --env-file-if-exists=.env scripts/m4-preview-replay.mjs [--out <报告.md>] [--json <证据.json>] [--keep] [--fast]
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
const LARGE_SIZE = 101 * MI_B;
const DRAIN_TIMEOUT_MS = 120_000;
const report = [];
const evidence = { steps: [] };
let failures = 0;
let db;

/** 回放样例：中文 HTML（soffice 家族，走 convert 通道）——中文排版 + 常见业务用语，便于肉眼比对乱码。 */
const SAMPLE_HTML = Buffer.from(
  "<!doctype html><html><head><meta charset=\"utf-8\"><title>预览转换回放</title></head><body>" +
    "<h1>LibiaoLink 在线预览回放（M4-05c）</h1>" +
    "<p>机械设计图纸 / 技术协议 / 合同评审单：中文排版样例，用于验证转换沙箱的中文字体映射与产物可用性。</p>" +
    "<p>本文件由 server/scripts/m4-preview-replay.mjs 生成，仅用于回放，不代表任何真实业务文件。</p>" +
    "</body></html>",
  "utf8",
);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") out.out = argv[++i];
    else if (item === "--json") out.json = argv[++i];
    else if (item === "--base-url") out.baseUrl = argv[++i];
    else if (item === "--database-url") out.databaseUrl = argv[++i];
    else if (item === "--keep") out.keep = true;
    else if (item === "--fast") out.fast = true;
  }
  return out;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function makeSession(userId, idToken) {
  const session = { userId, token: "m4pvw-" + randomBytes(16).toString("hex"), csrf: randomBytes(16).toString("hex") };
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
  if (!ok) throw new Error("M4-05c 回放失败（" + id + "）：" + title);
}

function short(value, max = 320) {
  const text = JSON.stringify(value);
  return text === undefined ? "undefined" : text.length > max ? text.slice(0, max) + "…" : text;
}

function makeParts(bytes) {
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += 8 * MI_B) {
    parts.push(bytes.subarray(offset, Math.min(offset + 8 * MI_B, bytes.length)));
  }
  return parts;
}

async function putPart(url, body) {
  const response = await fetch(url, { method: "PUT", body });
  const payload = Buffer.from(await response.arrayBuffer());
  return { status: response.status, etag: response.headers.get("etag"), text: response.ok ? "" : payload.toString("utf8").slice(0, 300) };
}

async function uploadFile({ projectId, name, bytes, docType }) {
  const parts = makeParts(bytes);
  const contentHash = sha256(bytes);
  const init = await call(
    "POST",
    "/api/v1/files/uploads",
    { projectId, name, sizeBytes: bytes.length, contentHash, docType, intent: "version" },
    admin,
  );
  const fileId = init.body?.file?.id;
  const uploadId = init.body?.upload?.id;
  if (fileId === undefined || uploadId === undefined) {
    return { init, fileId, uploadId, contentHash, completed: { status: 0, body: null } };
  }
  const signed = await call(
    "POST",
    "/api/v1/files/" + fileId + "/uploads/" + uploadId + "/parts",
    { partNumbers: parts.map((_unused, index) => index + 1) },
    admin,
  );
  for (let index = 0; index < parts.length; index += 1) {
    await putPart(signed.body.parts[index].url, parts[index]);
  }
  const completed = await call("POST", "/api/v1/files/" + fileId + "/uploads/" + uploadId + "/complete", { contentHash }, admin);
  return { init, fileId, uploadId, contentHash, completed };
}

const finalizeFile = (fileId, version, session) => call("POST", "/api/v1/files/" + fileId + "/finalize", { version }, session);

/** 该三元组的产物行 + 任务行（断言与等待共用）。 */
async function artifactOf(contentHash, target = "pdf") {
  const rows = await db.query(
    "select id, file_id, version_id, content_hash, pipeline_version, target, status, object_key, error, generated_at from preview_artifacts where content_hash = $1 and target = $2",
    [contentHash, target],
  );
  return rows.rows;
}

async function jobOf(contentHash, target = "pdf") {
  const rows = await db.query(
    "select id, status, attempts, last_error, dedupe_key, topic from outbox_events where dedupe_key = $1",
    ["preview.job:" + contentHash + ":" + pipelineVersion + ":" + target],
  );
  return rows.rows[0];
}

/** 等 worker 把这一轮领完（轮询产物行状态，不再变化或到期即返回）。 */
async function waitForArtifact(contentHash, desired, timeoutMs = DRAIN_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    last = await artifactOf(contentHash);
    if (last.some((row) => row.status === desired)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return last;
}

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

async function headObject(key) {
  const output = await rawClient.send(new s3Module.GetObjectCommand({ Bucket: storage.bucket, Key: key }));
  const bytes = Buffer.from(await output.Body.transformToByteArray());
  return { contentType: output.ContentType ?? null, sizeBytes: bytes.length, metadata: output.Metadata ?? {}, bytes };
}

let admin;
let adminId;
let storage;
let rawClient;
let s3Module;
let project;
let pipelineVersion = "1.0.0";
const cleanup = { projectIds: [], sessions: [], contentHashes: [] };

try {
  try {
    const envModule = await import(pathToFileURL(join(serverRoot, "dist", "config", "env.js")).href);
    const storageModule = await import(pathToFileURL(join(serverRoot, "dist", "storage", "index.js")).href);
    s3Module = await import("@aws-sdk/client-s3");
    const env = envModule.loadEnv(process.env);
    pipelineVersion = env.PREVIEW_PIPELINE_VERSION;
    storage = storageModule.createS3ObjectStorage(env);
    rawClient = storageModule.createS3Client(env);
  } catch (error) {
    throw new Error("无法加载 dist / S3 环境（先 npm run build，并用 --env-file-if-exists=.env 带上 S3_* / PREVIEW_*）：" + String(error));
  }

  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  // ---------- 证据 0：四个依赖都在 ----------
  const health = await fetch(BASE_URL + "/healthz").then((response) => response.status).catch(() => 0);
  const ready = await fetch(BASE_URL + "/readyz").then((response) => response.status).catch(() => 0);
  check("S0", "api 可用（/healthz + /readyz：含存储探针）", "200 / 200", health + " / " + ready, health === 200 && ready === 200);

  const converterHealth = await fetch(process.env.PREVIEW_CONVERTER_URL + "/healthz")
    .then((response) => response.json())
    .catch(() => null);
  check(
    "S1",
    "转换沙箱可用且管线版本与 server 配置同值（deploy/preview/README「四」：标签 == 容器 PIPELINE_VERSION == server/.env）",
    "ok=true 且 pipelineVersion=" + pipelineVersion,
    short({ ok: converterHealth?.ok, pipelineVersion: converterHealth?.pipelineVersion, cjkReady: converterHealth?.fonts?.cjkReady }, 200),
    converterHealth?.ok === true && converterHealth?.pipelineVersion === pipelineVersion && converterHealth?.fonts?.cjkReady === true,
    "沙箱四性（无外网 / 只读 / 非 root / 超时杀进程）与字体映射 28 项断言见 docs/m4-05b 证据文档",
  );

  const adminRow = await db.query(
    "select u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where r.code = $1 and u.status = $2 order by u.id limit 1",
    ["admin", "active"],
  );
  adminId = adminRow.rows[0]?.id;
  if (adminId === undefined) throw new Error("找不到可用的管理员账号（roles.code = admin）");
  admin = await makeSession(adminId, "m4pvw-replay-admin");
  cleanup.sessions.push(admin.token);

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const created = await call("POST", "/api/v1/projects", {
    code: "M4PVW-" + stamp,
    name: "m4-05c 回放项目（预览转换队列）",
    projectType: "default",
    managerIds: [adminId],
  });
  check("P1", "建回放项目（为 file 提供 projectId）", "201 + 项目可见", created.status + " " + short({ id: created.body?.id, code: created.body?.code }, 120), created.status === 201);
  project = created.body.id;
  cleanup.projectIds.push(project);

  // ---------- 证据一：定档预生成投递（三元组去重键） ----------
  const sample = await uploadFile({ projectId: project, name: "中文样例-M4-05c.html", bytes: SAMPLE_HTML, docType: "技术协议" });
  cleanup.contentHashes.push(sample.contentHash);
  check(
    "F1",
    "上传中文样例（走真实上传管道：init → 分片直传 → complete）",
    "200 + 版本 v1 + contentHash 一致",
    short({ status: sample.completed.status, version: sample.completed.body?.version?.seq, hash: sample.contentHash.slice(0, 12) }, 200),
    sample.completed.status === 200 && sample.completed.body?.version?.seq === 1,
  );

  const beforeFinalize = await jobOf(sample.contentHash);
  const finalized = await finalizeFile(sample.fileId, sample.completed.body.file.version, admin);
  const job = await jobOf(sample.contentHash);
  check(
    "F2",
    "定档预生成（P1）：定档前无任务，定档后 outbox 落 preview.job（去重键 = 三元组）",
    "定档前 undefined；定档后 topic=preview.job + status=pending + payload 指向该版本",
    short({ finalized: finalized.status, before: beforeFinalize?.status, after: job?.status, key: job?.dedupe_key }, 260),
    beforeFinalize === undefined && finalized.status === 200 && job?.topic === "preview.job" && job?.status === "pending",
  );

  // ---------- 证据二 / 三：队列消费与产物形态 ----------
  const readyRows = await waitForArtifact(sample.contentHash, "ready");
  const artifact = readyRows[0];
  const artifactKey = artifactKeyOf(sample.contentHash);
  check(
    "W1",
    "队列消费：preview_artifacts 转 ready，object_key = previews/{contentHash}/{pipelineVersion}/{target}，outbox 转 done",
    "status=ready + object_key=" + artifactKey + " + generated_at 非空 + outbox=done",
    short(
      {
        status: artifact?.status,
        objectKey: artifact?.object_key,
        versionId: artifact?.version_id !== undefined ? "登记版本非空" : null,
        generatedAt: artifact?.generated_at !== null,
        outbox: (await jobOf(sample.contentHash))?.status,
      },
      300,
    ),
    artifact?.status === "ready" &&
      artifact?.object_key === artifactKey &&
      artifact?.generated_at !== null &&
      (await jobOf(sample.contentHash))?.status === "done",
  );

  const stored = await headObject(artifactKey);
  const head = "".concat(stored.bytes.subarray(0, 5).toString("latin1"));
  const hasCjkFont = /Noto[A-Za-z]*CJK|NotoSansCJK|NotoSerifCJK/.test(stored.bytes.toString("latin1"));
  check(
    "W2",
    "产物落对象存储：content-type = application/pdf + PDF 魔数 + 内嵌 Noto CJK（中文不乱码的字体层证据）",
    "%PDF- + application/pdf + 字体名含 Noto…CJK",
    short({ head, sizeBytes: stored.sizeBytes, contentType: stored.contentType, cjkFont: hasCjkFont }, 220),
    head === "%PDF-" && stored.contentType === "application/pdf" && stored.sizeBytes > 1000 && hasCjkFont,
  );

  check(
    "W3",
    "产物对象元数据留痕：三元组 + 源版本 + 转换模式（排障口径，不进业务读面）",
    "preview-content-hash / preview-target / preview-source-version / preview-mode 齐备",
    short(stored.metadata, 260),
    stored.metadata["preview-content-hash"] === sample.contentHash &&
      stored.metadata["preview-target"] === "pdf" &&
      stored.metadata["preview-pipeline-version"] === pipelineVersion &&
      typeof stored.metadata["preview-source-version"] === "string" &&
      typeof stored.metadata["preview-mode"] === "string",
  );

  // ---------- 证据四：三元组幂等（同内容只转一次 · D2-06） ----------
  const twin = await uploadFile({ projectId: project, name: "中文样例-M4-05c-副本.html", bytes: SAMPLE_HTML, docType: "技术协议" });
  const twinFinalized = await finalizeFile(twin.fileId, twin.completed.body.file.version, admin);
  const twinJobs = await db.query("select count(*)::int as total from outbox_events where dedupe_key = $1", [
    "preview.job:" + sample.contentHash + ":" + pipelineVersion + ":pdf",
  ]);
  const twinArtifacts = await artifactOf(twin.contentHash);
  check(
    "Z1",
    "三元组幂等（D2-06「同一内容只转一次」）：同内容第二个文件定档 → 不新增任务、产物行仍登记首次生成版本",
    "任务行恒为 1 + 产物行恒为 1 + version_id 仍指向第一个文件",
    short(
      {
        twinFinalized: twinFinalized.status,
        sameHash: twin.contentHash === sample.contentHash,
        jobs: twinJobs.rows[0]?.total,
        artifacts: twinArtifacts.length,
        firstGenerator: twinArtifacts[0]?.version_id === artifact.version_id,
      },
      260,
    ),
    twinFinalized.status === 200 &&
      twin.contentHash === sample.contentHash &&
      twinJobs.rows[0]?.total === 1 &&
      twinArtifacts.length === 1 &&
      twinArtifacts[0].version_id === artifact.version_id &&
      twinArtifacts[0].generated_at?.getTime() === artifact.generated_at?.getTime(),
  );

  // ---------- 证据五：失败降级（超大源文件直接降级「仅下载」· D2-05） ----------
  if (args.fast !== true) {
    const large = await uploadFile({
      projectId: project,
      name: "超大样本-M4-05c.docx",
      bytes: Buffer.alloc(LARGE_SIZE, 7),
      docType: "技术协议",
    });
    cleanup.contentHashes.push(large.contentHash);
    await finalizeFile(large.fileId, large.completed.body.file.version, admin);
    const failedRows = await waitForArtifact(large.contentHash, "failed");
    const failedRow = failedRows[0];
    const failedJob = await jobOf(large.contentHash);
    check(
      "Z2",
      "失败降级（D2-05）：101 MB 源文件超过 PREVIEW_CONVERT_MAX_SOURCE_MB=100 → failed + outbox dead（不重试、不留 not_ready）",
      "status=failed + error 含上限说明（≤500 字）+ outbox=dead + attempts=1",
      short({ status: failedRow?.status, error: failedRow?.error, job: failedJob?.status, attempts: failedJob?.attempts }, 300),
      failedRow?.status === "failed" &&
        typeof failedRow?.error === "string" &&
        failedRow.error.length <= 500 &&
        failedRow.error.includes("超过预览转换上限") &&
        failedRow.object_key === null &&
        failedJob?.status === "dead" &&
        failedJob.attempts === 1,
      "降级只影响预览：文件本体与下载不受影响（产物失败态是缓存态，换管线版本才失效）",
    );
  }

  // ---------- 证据六：判不出通道的类型不占转换配额 ----------
  const zip = await uploadFile({
    projectId: project,
    name: "交付包-M4-05c.zip",
    bytes: Buffer.from("PK\u0003\u0004 m4-05c replay zip placeholder", "binary"),
    docType: "合同",
  });
  cleanup.contentHashes.push(zip.contentHash);
  await finalizeFile(zip.fileId, zip.completed.body.file.version, admin);
  const zipJob = await db.query("select count(*)::int as total from outbox_events where dedupe_key like $1", [
    "preview.job:" + zip.contentHash + ":%",
  ]);
  const zipArtifacts = await artifactOf(zip.contentHash);
  check(
    "Z3",
    "判不出渲染通道的类型（.zip）不投递预览任务（不占转换配额、不留失败行）",
    "outbox 0 行 + preview_artifacts 0 行",
    short({ jobs: zipJob.rows[0]?.total, artifacts: zipArtifacts.length }, 160),
    zipJob.rows[0]?.total === 0 && zipArtifacts.length === 0,
  );
} catch (error) {
  failures += 1;
  report.push("| FAIL | 中断：" + (error instanceof Error ? error.message : String(error)));
  process.stderr.write("M4-05c 回放失败：" + (error instanceof Error ? error.message : String(error)) + "\n");
} finally {
  if (db !== undefined) {
    try {
      if (args.keep !== true) {
        for (const projectId of cleanup.projectIds) {
          await db.query("update files set current_version_id = null where project_id = $1", [projectId]);
          await db.query("delete from file_links where file_id in (select id from files where project_id = $1)", [projectId]);
          await db.query("delete from upload_sessions where file_id in (select id from files where project_id = $1)", [projectId]);
          await db.query("delete from preview_artifacts where file_id in (select id from files where project_id = $1)", [projectId]);
          await db.query("delete from file_versions where file_id in (select id from files where project_id = $1)", [projectId]);
          await db.query("delete from files where project_id = $1", [projectId]);
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
          for (const contentHash of cleanup.contentHashes) {
            await purgePrefix("previews/" + contentHash + "/").catch(() => undefined);
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

function artifactKeyOf(contentHash, target = "pdf") {
  return "previews/" + contentHash + "/" + pipelineVersion + "/" + target;
}

const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: serverRoot }).toString().trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: serverRoot }).toString().trim() !== "";
const lines = [];
lines.push("# M4-05c 回放证据（S7·file 预览转换队列 · outbox 领取器）");
lines.push("");
lines.push("> 卡片：M4-05「在线预览」的转换队列切片（主责 lan，评审 wmj）｜口径来源：系统功能书 D2-04 / D2-05 / D2-06 / D2-07｜技术设计v0.3 §3.5（M4-05 预览：worker 领 outbox `preview.job` → 调 converter → 产物回 MinIO → 更新 `preview_artifacts`；缓存键三元组）｜ADR-007（三元组缓存键 / 沙箱 / 降级 / pipelineVersion 语义）｜deploy/preview/README.md（转换器契约五、版本规则四）。");
lines.push("> 落点说明：`docs/` 属 px 线；本文件由 lan 随 M4-05c 卡片代记（回放脚本与断言同 PR，请 px 复核）。");
lines.push("");
lines.push("| 项 | 值 |");
lines.push("|---|---|");
lines.push("| 回放时间 | " + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ") + " +08:00 |");
lines.push("| 目标 | " + BASE_URL + " |");
lines.push("| 数据库 | " + DATABASE_URL.replace(/:[^:@/]+@/, ":***@") + " |");
lines.push("| 对象存储 | " + (storage === undefined ? "-" : storage.bucket) + "（本地 MinIO 沙箱：仅沙箱、不代表生产选型） |");
lines.push("| 转换沙箱 | " + (process.env.PREVIEW_CONVERTER_URL ?? "-") + "（deploy/preview/，镜像 libiaolink/preview-converter:" + pipelineVersion + "） |");
lines.push("| 代码版本 | " + commit + (dirty ? "（回放时工作区含本卡未提交改动）" : "") + " |");
lines.push("| 执行账号 | 管理员（建项目 / 上传 / 定档） |");
lines.push("| 脚本 | server/scripts/m4-preview-replay.mjs |");
lines.push("");
lines.push("## 断言明细");
lines.push("");
lines.push(...report);
lines.push("");
lines.push("## 汇总");
lines.push("");
lines.push(failures === 0 ? "- ✅ 全部断言通过（" + evidence.steps.filter((step) => step.ok).length + " 项）：定档预生成投递 / 真实转换与产物形态（%PDF- + 内嵌 CJK）/ 三元组幂等 / 失败降级 / 判不出通道不投递。" : "- ❌ 有 " + failures + " 项失败，见上方 FAIL 行。");
lines.push("");
lines.push("## 未覆盖 / 风险登记");
lines.push("");
lines.push("- **压测未做**：并发 2~4、200MB 级长跑内存曲线、转换成功率 ≥95%（PoC-1 真实样本集）不在本脚本范围（属 M4-05 压测 / M8 容量验证）；本脚本只证「接线正确 + 通道打通 + 降级可控」。");
lines.push("- **预览产物对象的清理未接**：彻底删除 / 回收站到期目前只清 `projects/` 前缀下的版本对象，`previews/` 前缀的产物对象与 `preview_artifacts` 行（随 files 级联删除）需在 M4-05 收口时按 content_hash 反查引用后清理（迁移 0027 的口径已写明）。");
lines.push("- **dead 重投**：`failed` 是缓存态（管线修复后由 `pipeline_version` 递增失效）；dead 任务由读取侧（PR-11）幂等补投唤醒（`appendOutboxIfAbsent`）。");
lines.push("");
lines.push("## 复跑");
lines.push("");
lines.push("```bash");
lines.push("cd deploy/preview && docker compose up -d            # 转换沙箱（首次需 build，约 1.2 GB 镜像）");
lines.push("cd server && npm run build && npm run start:api &     # api（BASE_URL）");
lines.push("OUTBOX_POLL_MS=1000 npm run start:worker &            # worker（消费 preview.job）");
lines.push('cd server && M4_DATABASE_URL=postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink \\');
lines.push('  node --env-file-if-exists=.env scripts/m4-preview-replay.mjs --out "../docs/m4-05c-回放证据(预览转换队列).md"');
lines.push("```");
lines.push("");

if (args.json !== undefined) writeFileSync(args.json, JSON.stringify(evidence, null, 2) + "\n", "utf8");
if (args.out !== undefined) writeFileSync(args.out, lines.join("\n"), "utf8");
process.stdout.write(lines.join("\n") + "\n");
process.exit(failures === 0 ? 0 : 1);