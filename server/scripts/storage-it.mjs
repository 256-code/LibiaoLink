#!/usr/bin/env node
// 对象存储真机回放（ADR-006 阶段 0：用真实网络与真实存储验证接入层）。
// 跑通契约里的整条上传链路：创建会话 → 分片预签名直传 → ListParts → 合并 → HEAD → 签名下载 → 哈希比对，
// 外加「中止后会话即失效」「对象禁止匿名读取」两条负向断言。
// 用法：npm run storage:it（需真实对象存储，见 deploy/minio/；先 npm run build）
// 退出码 0 = 全部断言通过。CI 不跑本脚本（与 PoC-9 回放同口径：真机证据入文档）。
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");

let envModule;
let storageModule;
try {
  envModule = await import(pathToFileURL(join(distDir, "config", "env.js")).href);
  storageModule = await import(pathToFileURL(join(distDir, "storage", "index.js")).href);
} catch (error) {
  console.error("storage:it: 无法加载 dist（先执行 npm run build）：" + String(error));
  process.exit(1);
}

const env = envModule.loadEnv(process.env);
const storage = storageModule.createS3ObjectStorage(env);

const projectId = randomUUID();
const fileId = randomUUID();
const assertions = [];
const check = (label, ok, detail) => {
  assertions.push({ label, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? "：" + detail : ""}`);
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** 与浏览器同口径的直传：对预签名 URL 原样 PUT，不额外带任何头。 */
async function putPart(url, body) {
  const response = await fetch(url, { method: "PUT", body });
  // 一律读完响应体：Windows 上残留的 fetch 句柄会让进程退出时踩到 libuv 断言。
  const payload = Buffer.from(await response.arrayBuffer());
  return { status: response.status, etag: response.headers.get("etag"), text: response.ok ? "" : payload.toString("utf8") };
}

const created = [];
const objectKeys = [];

try {
  await storage.probe();
  check("桶可达（/readyz 探针同口径）", true, storage.bucket);

  const contentHash = "b".repeat(64);
  const objectKey = storageModule.buildObjectKey({ projectId, fileId, seq: 1, contentHash, fileName: "机械设计图纸-v2.docx" });
  objectKeys.push(objectKey);

  check("对象键形态", objectKey.startsWith(`projects/${projectId}/files/${fileId}/v1/`), objectKey.split("/").slice(-1)[0]);

  const absent = await storage.headObject(objectKey);
  check("合并前对象不存在（HEAD 返回 null，不抛错）", absent === null);

  // 按**服务端给出的分片计划**切分（真实链路里客户端就是从 UploadCreateResponse 拿 partSizeBytes）。
  const sizeBytes = 20 * 1024 * 1024;
  const plan = storageModule.planUpload(sizeBytes);
  const payload = Array.from({ length: plan.totalParts }, (_, index) => {
    const start = index * plan.partSizeBytes;
    return Buffer.alloc(Math.min(plan.partSizeBytes, sizeBytes - start), index + 1);
  });
  const totalBytes = payload.reduce((sum, part) => sum + part.length, 0);
  const upload = await storage.createMultipartUpload({ objectKey, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  created.push(upload);
  check("创建分片会话", typeof upload.uploadId === "string" && upload.uploadId.length > 0, `partSize=${plan.partSizeBytes} / totalParts=${plan.totalParts}`);

  const signed = await storage.signPartUploadUrl({ objectKey, uploadId: upload.uploadId, partNumber: 1 });
  check("分片预签名 URL（不夹带校验和签名头，浏览器可裸 PUT）", signed.url.includes("X-Amz-Signature=") && !/checksum/i.test(signed.url));
  check("预签名 host 对客户端可达（ADR-006 阶段 0 验证项）", signed.url.startsWith(env.S3_ENDPOINT.replace(/\/$/, "")), new URL(signed.url).host);

  const uploaded = [];
  for (let index = 0; index < payload.length; index += 1) {
    const partNumber = index + 1;
    const { url } = await storage.signPartUploadUrl({ objectKey, uploadId: upload.uploadId, partNumber });
    const result = await putPart(url, payload[index]);
    check(`分片 ${partNumber} 直传（${payload[index].length} 字节）`, result.status === 200 && result.etag !== null, `HTTP ${result.status} ${result.etag ?? result.text}`);
    uploaded.push({ partNumber, etag: result.etag ?? "" });
  }

  const listed = await storage.listParts({ objectKey, uploadId: upload.uploadId });
  check(
    "ListParts 为分片唯一真相（编号 / 字节数与直传一致）",
    listed.length === payload.length && listed.every((part, index) => part.partNumber === index + 1 && part.sizeBytes === payload[index].length),
    listed.map((part) => `${part.partNumber}:${part.sizeBytes}`).join(" "),
  );
  const missing = storageModule.missingPartNumbers(listed.map((part) => part.partNumber), plan.totalParts);
  check("缺片计算与已传分片互补", missing.length === 0, `缺失 ${missing.length} 片 / 共 ${plan.totalParts} 片`);
  check(
    "非末片均 >= 5 MiB（S3 协议约束；服务端分片计划保证）",
    payload.slice(0, -1).every((part) => part.length >= storageModule.MIN_PART_SIZE_BYTES),
    payload.map((part) => part.length).join(" / "),
  );

  const completed = await storage.completeMultipartUpload({ objectKey, uploadId: upload.uploadId, parts: [...uploaded].reverse() });
  check("合并分片（乱序提交也会按编号归位）", typeof completed.etag === "string" && completed.etag.length > 0, completed.etag ?? "");

  const head = await storage.headObject(objectKey);
  check("HEAD 校验大小（服务端不信客户端声明）", head !== null && head.sizeBytes === totalBytes, `${head?.sizeBytes ?? "-"} / ${totalBytes}`);

  const download = await storage.signDownloadUrl({ objectKey, fileName: "机械设计图纸-v2.docx" });
  const downloaded = await fetch(download.url);
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  check("签名下载可取回且字节一致", downloaded.status === 200 && bytes.length === totalBytes, `HTTP ${downloaded.status} / ${bytes.length}`);
  check("内容哈希比对通过（SHA-256）", sha256(bytes) === sha256(Buffer.concat(payload)), sha256(bytes).slice(0, 16));
  check(
    "中文文件名走 RFC 5987 下载头",
    decodeURIComponent(downloaded.headers.get("content-disposition") ?? "").includes("filename*=UTF-8''"),
    downloaded.headers.get("content-disposition") ?? "",
  );

  const anonymous = await fetch(`${env.S3_ENDPOINT.replace(/\/$/, "")}/${storage.bucket}/${objectKey}`);
  const anonymousStatus = anonymous.status;
  await anonymous.arrayBuffer();
  check("对象禁止匿名读取（ADR-006：短时签名方可下载）", anonymousStatus !== 200, `匿名 GET -> HTTP ${anonymousStatus}`);

  const aborted = await storage.createMultipartUpload({ objectKey: `${objectKey}.aborted`, contentType: "text/plain" });
  created.push(aborted);
  await storage.abortMultipartUpload({ objectKey: aborted.objectKey, uploadId: aborted.uploadId });
  await storage.abortMultipartUpload({ objectKey: aborted.objectKey, uploadId: aborted.uploadId });
  check("中止上传幂等（重复中止不报错）", true);
  let abortedListCode = "none";
  let abortedApiCode = "none";
  try {
    await storage.listParts({ objectKey: aborted.objectKey, uploadId: aborted.uploadId });
  } catch (error) {
    abortedListCode = error?.code ?? "unknown";
    abortedApiCode = storageModule.toApiError(error).code;
  }
  check(
    "中止后的会话即失效（映射契约 UPLOAD_SESSION_EXPIRED / 410）",
    abortedListCode === "upload_not_found" && abortedApiCode === "UPLOAD_SESSION_EXPIRED",
    `${abortedListCode} -> ${abortedApiCode} / HTTP ${storageModule.toApiError(new storageModule.StorageError("upload_not_found", "x")).httpStatus}`,
  );
} catch (error) {
  check("回放异常终止", false, String(error?.stack ?? error));
} finally {
  for (const upload of created) {
    await storage.abortMultipartUpload({ objectKey: upload.objectKey, uploadId: upload.uploadId }).catch(() => undefined);
  }
  for (const key of objectKeys) {
    await storage.deleteObject(key).catch(() => undefined);
  }
}

const failed = assertions.filter((item) => !item.ok);
console.log(`\n对象存储真机回放：${assertions.length - failed.length}/${assertions.length} 项断言通过（${env.S3_ENDPOINT} / ${storage.bucket}）`);
process.exitCode = failed.length === 0 ? 0 : 1;
