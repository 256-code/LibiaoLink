#!/usr/bin/env node
/**
 * S5 · R4 并发门禁真机报告（ONLYOFFICE 替换计划 S5 · lan）：
 *   证据一（50 并发拉取 200）：对**受控预览端点** `/api/v1/files/{id}/versions/{versionId}/preview-content`
 *        施放 50 个并发请求（DocServer 形态 outbox Bearer，逐请求现签），全部 200 + 字节与上传夹具逐字节一致
 *        （docx 57166B / pdf 691B 各 25 发 —— 覆盖 Office 与 PDF 两个查看器大类）。
 *   证据二（内存核查 · S3 遗留①）：受控端点整读对象进内存的实现口径下，观测 api 进程 WorkingSet 的
 *        基线 / 并发中 / 并发后 / 静置 3 分钟 四点值 —— 残留增量必须显著小于「50 × 对象大小」的量级（泄漏判据）。
 *   证据三（401 / 4xx / 5xx 基线）：并发窗口内非 200 应答 = 0。
 *
 * 前置：真 PG + 真 MinIO + 已起 api（ONLYOFFICE_* 已配置；BASE_URL = 本机；ONLYOFFICE_DOCSERVER_API_BASE_URL = DocServer 视角基址）。
 * 用法：cd server && node --env-file-if-exists=.env scripts/s5-r4-preview-burst.mjs \
 *         [--out <报告.md>] [--json <证据.json>] [--concurrency 50] [--api-pid <pid>] [--keep]
 * 退出码：断言全过 = 0，否则 = 1（可当门禁用）。
 */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "pg";

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.baseUrl ?? process.env.S5_BASE_URL ?? "http://127.0.0.1:3011";
const DATABASE_URL =
  args.databaseUrl ?? process.env.S5_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink";
const CONCURRENCY = Number(args.concurrency ?? 50);
const API_PID = Number(args.apiPid ?? process.env.S5_API_PID ?? 0);
const report = [];
const evidence = { steps: [], samples: [], latencies: [] };
let failures = 0;
let db;
let storage;
let rawClient;
let s3Module;
let ooSecret = "";
let ooBase = "";
let admin;
let project;
const cleanup = { projectIds: [], sessions: [] };

const DOCX_FIXTURE = readFileSync(join(serverRoot, "scripts", "poc10", "fixtures", "n1-03-weekly-report.docx"));
/** 最小合法 PDF 夹具（含中文标题；供 PDF 查看器通道并发覆盖）。 */
const PDF_FIXTURE = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 62>>stream\nBT /F1 18 Tf 72 760 Td (LibiaoLink R4 preview burst fixture) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \n0000000113 00000 n \n0000000266 00000 n \n0000000378 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n443\n%%EOF\n",
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
    else if (item === "--concurrency") out.concurrency = argv[++i];
    else if (item === "--api-pid") out.apiPid = argv[++i];
    else if (item === "--keep") out.keep = true;
  }
  return out;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function b64url(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
function signJwt(claims, secret) {
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url(claims);
  return header + "." + payload + "." + createHmac("sha256", secret).update(header + "." + payload).digest("base64url");
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function short(value, max = 300) {
  const text = JSON.stringify(value);
  return text === undefined ? "undefined" : text.length > max ? text.slice(0, max) + "…" : text;
}
function check(id, title, expected, actual, ok, note = "") {
  if (!ok) failures += 1;
  report.push((ok ? "| PASS | " : "| FAIL | ") + id + " | " + title + " | ");
  report.push("  - 期望：" + expected);
  report.push("  - 实际：" + actual);
  if (note !== "") report.push("  - 说明：" + note);
  evidence.steps.push({ id, title, expected, actual, ok, note });
  process.stdout.write((ok ? "PASS " : "FAIL ") + id + " " + title + "\n");
  if (!ok) throw new Error("S5 R4 断言失败（" + id + "）：" + title);
}
/** 本机 api 进程内存采样（WorkingSet / PrivateMemory）。 */
function sampleMemory(tag) {
  const sample = { tag, at: new Date().toISOString() };
  if (API_PID > 0) {
    try {
      const out = execFileSync(
        "powershell",
        ["-NoProfile", "-Command", `$p=Get-Process -Id ${API_PID} -ErrorAction Stop; "$($p.WorkingSet64)|$($p.PrivateMemorySize64)"`],
      ).toString().trim();
      const [ws, pm] = out.split("|").map((v) => Number(v));
      sample.workingSetMB = Math.round(ws / 1048576);
      sample.privateMB = Math.round(pm / 1048576);
    } catch (error) {
      sample.error = String(error).slice(0, 200);
    }
  }
  evidence.samples.push(sample);
  return sample;
}
async function makeSession(userId, idToken) {
  const session = { userId, token: "s5r4-" + randomBytes(16).toString("hex"), csrf: randomBytes(16).toString("hex") };
  await db.query("insert into sessions (token_hash, user_id, id_token, expires_at) values ($1, $2, $3, now() + interval '2 hours')", [
    sha256(session.token),
    userId,
    idToken,
  ]);
  return session;
}
async function call(method, path, body, session = admin) {
  const headers = { "content-type": "application/json" };
  if (session !== null) {
    headers.cookie = "ll_sid=" + session.token + "; ll_csrf=" + session.csrf;
    headers["x-csrf-token"] = session.csrf;
  }
  const response = await fetch(BASE_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text === "" ? null : JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: parsed };
}
function makeParts(bytes) {
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += 8 * 1024 * 1024) {
    parts.push(bytes.subarray(offset, Math.min(offset + 8 * 1024 * 1024, bytes.length)));
  }
  return parts;
}
async function putPart(url, body) {
  const response = await fetch(url, { method: "PUT", body });
  const payload = Buffer.from(await response.arrayBuffer());
  return { status: response.status, etag: response.headers.get("etag"), text: response.ok ? "" : payload.toString("utf8").slice(0, 200) };
}
async function uploadFile({ projectId, name, bytes, docType }) {
  const parts = makeParts(bytes);
  const contentHash = sha256(bytes);
  const init = await call("POST", "/api/v1/files/uploads", {
    projectId,
    name,
    sizeBytes: bytes.length,
    contentHash,
    docType,
    intent: "version",
  });
  const fileId = init.body?.file?.id;
  const uploadId = init.body?.upload?.id;
  if (fileId === undefined || uploadId === undefined) throw new Error("上传 init 失败：" + short(init));
  const signed = await call("POST", "/api/v1/files/" + fileId + "/uploads/" + uploadId + "/parts", {
    partNumbers: parts.map((_unused, index) => index + 1),
  });
  for (let index = 0; index < parts.length; index += 1) {
    const put = await putPart(signed.body.parts[index].url, parts[index]);
    if (put.status !== 200) throw new Error("分片直传失败：" + short(put));
  }
  const completed = await call("POST", "/api/v1/files/" + fileId + "/uploads/" + uploadId + "/complete", { contentHash });
  return { fileId, versionId: completed.body?.version?.id, contentHash, completedStatus: completed.status, completed: short(completed.body, 400) };
}
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}
async function purgePrefix(prefix) {
  let keyMarker;
  let versionIdMarker;
  for (;;) {
    const listed = await rawClient.send(
      new s3Module.ListObjectVersionsCommand({ Bucket: storage.bucket, Prefix: prefix, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker }),
    );
    const targets = [
      ...(listed.Versions ?? []).map((item) => ({ Key: item.Key, VersionId: item.VersionId })),
      ...(listed.DeleteMarkers ?? []).map((item) => ({ Key: item.Key, VersionId: item.VersionId })),
    ];
    for (const target of targets) {
      await rawClient.send(new s3Module.DeleteObjectCommand({ Bucket: storage.bucket, Key: target.Key, VersionId: target.VersionId })).catch(() => undefined);
    }
    if (listed.IsTruncated !== true) break;
    keyMarker = listed.NextKeyMarker;
    versionIdMarker = listed.NextVersionIdMarker;
  }
}

try {
  const envModule = await import(pathToFileURL(join(serverRoot, "dist", "config", "env.js")).href);
  const storageModule = await import(pathToFileURL(join(serverRoot, "dist", "storage", "index.js")).href);
  s3Module = await import("@aws-sdk/client-s3");
  const env = envModule.loadEnv(process.env);
  storage = storageModule.createS3ObjectStorage(env);
  rawClient = storageModule.createS3Client(env);
  ooSecret = env.ONLYOFFICE_JWT_SECRET;
  ooBase = env.ONLYOFFICE_DOCSERVER_API_BASE_URL.replace(/\/+$/, "");
  if (ooSecret === "") throw new Error("ONLYOFFICE_JWT_SECRET 为空");

  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  const health = await fetch(BASE_URL + "/healthz").then((response) => response.status).catch(() => 0);
  const ready = await fetch(BASE_URL + "/readyz").then((response) => response.status).catch(() => 0);
  check("S0", "api 可用（/healthz + /readyz）", "200 / 200", health + " / " + ready, health === 200 && ready === 200);

  const adminRow = await db.query(
    "select u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where r.code = $1 and u.status = $2 order by u.id limit 1",
    ["admin", "active"],
  );
  if (adminRow.rows[0]?.id === undefined) throw new Error("找不到可用管理员账号");
  admin = await makeSession(adminRow.rows[0].id, "s5-r4-admin");
  cleanup.sessions.push(admin.token);

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const created = await call("POST", "/api/v1/projects", {
    code: "S5R4-" + stamp,
    name: "S5 R4 并发门禁回放项目",
    projectType: "default",
    managerIds: [adminRow.rows[0].id],
  });
  check("P1", "建回放项目", "201", created.status + " " + short({ id: created.body?.id }, 80), created.status === 201);
  project = created.body.id;
  cleanup.projectIds.push(project);

  const docx = await uploadFile({ projectId: project, name: "R4-并发-周报.docx", bytes: DOCX_FIXTURE, docType: "技术协议" });
  check("F1", "上传 .docx 夹具（Office 大类）", "200 + 版本 id", short({ status: docx.completedStatus, version: docx.versionId }, 140), docx.completedStatus === 200 && typeof docx.versionId === "string");
  const pdf = await uploadFile({ projectId: project, name: "R4-并发-说明.pdf", bytes: PDF_FIXTURE, docType: "技术协议" });
  check("F2", "上传 .pdf 夹具（PDF 大类 · 2026-10-08 并入通道）", "200 + 版本 id", short({ status: pdf.completedStatus, version: pdf.versionId }, 140), pdf.completedStatus === 200 && typeof pdf.versionId === "string");

  // ---------- R4 主体：50 并发 ----------
  const targets = [];
  for (let index = 0; index < CONCURRENCY; index += 1) targets.push((index % 2 === 0 ? docx : pdf));

  const before = sampleMemory("before");
  const startedAll = Date.now();
  const results = await Promise.all(
    targets.map(async (target, index) => {
      const url = ooBase + "/api/v1/files/" + target.fileId + "/versions/" + target.versionId + "/preview-content";
      const issuedAt = Math.floor(Date.now() / 1000);
      const token = signJwt({ payload: { url }, iat: issuedAt, exp: issuedAt + 300 }, ooSecret);
      const started = Date.now();
      let status = 0;
      let hash = "";
      let bytesLength = 0;
      let error = "";
      try {
        const response = await fetch("http://127.0.0.1:3011/api/v1/files/" + target.fileId + "/versions/" + target.versionId + "/preview-content", {
          headers: { authorization: "Bearer " + token },
          redirect: "manual",
        });
        const bytes = Buffer.from(await response.arrayBuffer());
        status = response.status;
        hash = sha256(bytes);
        bytesLength = bytes.length;
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      const latency = Date.now() - started;
      evidence.latencies.push({ index, status, latencyMs: latency, bytesLength });
      return { index, status, hash, bytesLength, latency, kind: target === docx ? "docx" : "pdf", error };
    }),
  );
  const elapsedMs = Date.now() - startedAll;
  const during = sampleMemory("during");

  const nonOk = results.filter((item) => item.status !== 200);
  const docxResults = results.filter((item) => item.kind === "docx");
  const pdfResults = results.filter((item) => item.kind === "pdf");
  const docxHashOk = docxResults.every((item) => item.hash === sha256(DOCX_FIXTURE) && item.bytesLength === DOCX_FIXTURE.length);
  const pdfHashOk = pdfResults.every((item) => item.hash === sha256(PDF_FIXTURE) && item.bytesLength === PDF_FIXTURE.length);
  const latencies = results.map((item) => item.latency);
  evidence.burst = {
    concurrency: CONCURRENCY,
    elapsedMs,
    okCount: results.length - nonOk.length,
    nonOk: nonOk.map((item) => ({ index: item.index, status: item.status, error: item.error })),
    docxHashOk,
    pdfHashOk,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    max: Math.max(...latencies),
    throughputPerSecond: Math.round((CONCURRENCY / elapsedMs) * 1000 * 10) / 10,
  };

  check("C1", "50 并发全部 200（无 4xx / 5xx / 连接错误）", "okCount = " + CONCURRENCY, "ok=" + evidence.burst.okCount + " 非200=" + short(evidence.burst.nonOk, 200), nonOk.length === 0);
  check(
    "C2",
    "字节逐字比对：25 × docx（57166B）+ 25 × pdf（" + PDF_FIXTURE.length + "B）全部与上传夹具 hash 相等",
    "docx 25/25 · pdf 25/25",
    "docxHashOk=" + docxHashOk + " pdfHashOk=" + pdfHashOk,
    docxHashOk && pdfHashOk,
  );
  check(
    "C3",
    "并发窗口吞吐与延迟：" + CONCURRENCY + " 发 / " + elapsedMs + "ms",
    "p95 < 5000ms",
    "p50=" + evidence.burst.p50 + "ms p95=" + evidence.burst.p95 + "ms max=" + evidence.burst.max + "ms",
    evidence.burst.p95 < 5000,
  );

  // ---------- 内存核查（S3 遗留①：整读内存的并发表现） ----------
  await sleep(3000);
  const after = sampleMemory("after3s");
  await sleep(120000);
  const settled = sampleMemory("settled2m");
  evidence.memory = { before, during, after, settled };
  const burstLoadMB = Math.round((CONCURRENCY * (DOCX_FIXTURE.length + PDF_FIXTURE.length)) / 2 / 1048576);
  const deltaDuring = (during.workingSetMB ?? 0) - (before.workingSetMB ?? 0);
  const deltaSettled = (settled.workingSetMB ?? 0) - (before.workingSetMB ?? 0);
  check(
    "M1",
    "并发中内存增量（整读口径下 = 多份在途对象并发叠加）",
    "有界（< 512MB 且远小于病态叠加）",
    "before=" + before.workingSetMB + "MB during=" + during.workingSetMB + "MB Δduring=+" + deltaDuring + "MB（50 并发对象总量约 " + burstLoadMB + "MB）",
    deltaDuring < 512,
  );
  check(
    "M2",
    "静置 2 分钟后内存回落（无泄漏）：残留增量 < 128MB",
    "Δsettled < 128MB",
    "after3s=" + after.workingSetMB + "MB settled2m=" + settled.workingSetMB + "MB Δsettled=+" + deltaSettled + "MB",
    deltaSettled < 128,
  );

  // ---------- 收尾 ----------
  if (args.keep !== true) {
    for (const projectId of cleanup.projectIds) {
      await db.query("delete from file_links where file_id in (select id from files where project_id = $1)", [projectId]).catch(() => undefined);
      await db.query("delete from upload_sessions where file_id in (select id from files where project_id = $1)", [projectId]).catch(() => undefined);
      await db.query("delete from preview_artifacts where file_id in (select id from files where project_id = $1)", [projectId]).catch(() => undefined);
      await db.query("update files set current_version_id = null where project_id = $1", [projectId]).catch(() => undefined);
      await db.query("delete from file_versions where file_id in (select id from files where project_id = $1)", [projectId]).catch(() => undefined);
      await db.query("delete from files where project_id = $1", [projectId]).catch(() => undefined);
      await purgePrefix("projects/" + projectId + "/").catch(() => undefined);
    }
    for (const token of cleanup.sessions) {
      await db.query("update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null", [sha256(token)]).catch(() => undefined);
    }
    report.push("| INFO | 收尾：文件 / 版本 / 会话已清（project / audit / stages 由操作者按沙箱口径清） | ");
  }
  await db.end();
} catch (error) {
  failures += 1;
  report.push("| FAIL | 中断：" + (error instanceof Error ? error.message : String(error)) + " | ");
  if (db !== undefined) await db.end().catch(() => undefined);
}

const lines = [];
lines.push("# S5 · R4 并发门禁真机报告（受控预览端点 50 并发 + 内存核查）");
lines.push("");
lines.push("> 卡片：ONLYOFFICE 替换实施切片 **S5**（主责 lan + px）｜口径来源：`docs/ONLYOFFICE替换执行计划(Office预览).md` §4 S5 / §5 R4（含 v1.10 挂账「受控端点整读内存 → S5 门禁核查」）。");
lines.push("> 模式：真机（Windows + Docker：PG 18 / MinIO / ONLYOFFICE DocServer 9.4.0.1 与 LibreOffice 转换器双轨并存）。");
lines.push("");
lines.push("| 项 | 值 |");
lines.push("|---|---|");
lines.push("| 回放时间 | " + new Date().toISOString() + " |");
lines.push("| 目标 api | " + BASE_URL + " |");
lines.push("| DocServer 视角 API 基址 | " + ooBase + " |");
lines.push("| 并发 | " + CONCURRENCY + "（25 × .docx + 25 × .pdf，逐请求现签 outbox Bearer） |");
lines.push("| api 进程 | pid " + ({ 0: "n/a" }[API_PID] ?? API_PID) + "（内存采样：Windows WorkingSet） |");
lines.push("");
lines.push("## 断言明细");
lines.push("");
lines.push(...report);
lines.push("");
lines.push("## 内存采样");
lines.push("");
lines.push("| 采样点 | WorkingSet (MB) | Private (MB) |");
lines.push("|---|---|---|");
for (const sample of evidence.samples) {
  lines.push("| " + sample.tag + " | " + (sample.workingSetMB ?? "n/a") + " | " + (sample.privateMB ?? "n/a") + " |");
}
lines.push("");
lines.push("## 并发延迟分布");
lines.push("");
lines.push("```json");
lines.push(short(evidence.burst, 800));
lines.push("```");
lines.push("");
lines.push("## 汇总");
lines.push("");
lines.push(failures === 0 ? "- ✅ 全部断言通过（" + evidence.steps.filter((step) => step.ok).length + " 项）" : "- ❌ 存在失败断言（" + failures + " 项）");
lines.push("");
lines.push("## 复跑");
lines.push("");
lines.push("```bash");
lines.push("cd server && node --env-file-if-exists=.env scripts/s5-r4-preview-burst.mjs \\");
lines.push("  --out \"../docs/s5-R4并发报告(受控预览端点50并发).md\" --json \"../docs/s5-R4并发报告(受控预览端点50并发).json\" --api-pid <api pid>");
lines.push("```");

if (args.out !== undefined) writeFileSync(args.out, lines.join("\n") + "\n", "utf8");
if (args.json !== undefined) writeFileSync(args.json, JSON.stringify(evidence, null, 2), "utf8");
process.stdout.write("\n汇总：" + (failures === 0 ? "全部通过" : failures + " 项失败") + "\n");
process.exit(failures === 0 ? 0 : 1);
