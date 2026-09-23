#!/usr/bin/env node
/**
 * LibiaoLink 预览转换器 · 转换服务（ADR-007 / M4-05）
 * ============================================================================
 * 职责：接收源文件字节流 -> 在容器沙箱内用 LibreOffice headless 转 PDF / 首屏图片
 *       -> 回传产物字节流。不接触数据库、不接触对象存储、不出网（沙箱网络层保证）。
 *
 * 设计口径（PX 定案，供 lan 线 PR-10 接线；契约见 deploy/preview/README.md）：
 *   - 无状态：每次请求一个独立工作目录（tmpfs），产物不回存，缓存/幂等由 worker 负责；
 *   - 字节流进、字节流出：转换器不需要任何对象存储凭证，也就不需要出网；
 *   - 零依赖：只用 Node 内置模块，镜像内没有 node_modules（缩小攻击面）；
 *   - 超时用进程组 SIGKILL 兜底：LibreOffice 会派生 soffice.bin 等子进程，杀单进程不够。
 *
 * 环境变量（compose 由 deploy/preview/.env 注入）：
 *   PORT                     监听端口，默认 9900（仅容器内网 / 本机回环转发）
 *   PIPELINE_VERSION         转换管线版本，必须等于镜像标签（换镜像 = 递增该值，见 README）
 *   CONVERT_TIMEOUT_MS       单次转换硬超时，默认 60000（worker 侧客户端超时应留余量）
 *   CONVERT_MAX_BYTES        单次请求体上限，默认 268435456（256MiB）
 *   CONVERT_MAX_CONCURRENCY  并发转换数，默认 2（对齐 ADR-013 的 converter 并发行 2~4）
 *   CONVERT_MAX_QUEUE        排队上限，默认 8（超出直接 503 SERVICE_BUSY，让 worker 重试）
 *   CONVERT_IMAGE_DPI        image 通道光栅化 DPI，默认 150
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join, extname, basename } from "node:path";
import { pathToFileURL } from "node:url";

const PORT = intEnv("PORT", 9900);
const PIPELINE_VERSION = process.env.PIPELINE_VERSION ?? "0.0.0-dev";
const CONVERT_TIMEOUT_MS = intEnv("CONVERT_TIMEOUT_MS", 60000);
const CONVERT_MAX_BYTES = intEnv("CONVERT_MAX_BYTES", 256 * 1024 * 1024);
const CONVERT_MAX_CONCURRENCY = intEnv("CONVERT_MAX_CONCURRENCY", 2);
const CONVERT_MAX_QUEUE = intEnv("CONVERT_MAX_QUEUE", 8);
const CONVERT_IMAGE_DPI = intEnv("CONVERT_IMAGE_DPI", 150);
const WORK_ROOT = process.env.CONVERT_WORK_ROOT ?? tmpdir();
const SOFFICE_BIN = process.env.SOFFICE_BIN ?? "soffice";
const PDFTOPPM_BIN = process.env.PDFTOPPM_BIN ?? "pdftoppm";
const STARTED_AT = Date.now();

const PREVIEW_TARGETS = ["pdf", "image", "structured"];
const OFFICE_EXTENSIONS = new Set([
  ".doc", ".docx", ".docm", ".dot", ".dotx", ".odt", ".ott", ".rtf", ".txt", ".fodt",
  ".xls", ".xlsx", ".xlsm", ".xlt", ".xltx", ".ods", ".ots", ".csv", ".fods",
  ".ppt", ".pptx", ".pptm", ".pot", ".potx", ".odp", ".otp", ".fodp",
  ".html", ".htm", ".xml", ".wps", ".et", ".dps"
]);
const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tif", ".tiff", ".svg", ".heic"
]);
const IMAGE_MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/bmp", "image/webp",
  "image/tiff", "image/svg+xml", "image/heic", "image/heif"
]);

/** 有界队列：并发满则排队，队列满则 503（worker 侧超时重试语义） */
const pool = { inflight: 0, queue: [] };
function acquireSlot() {
  if (pool.inflight < CONVERT_MAX_CONCURRENCY) {
    pool.inflight += 1;
    return Promise.resolve();
  }
  if (pool.queue.length >= CONVERT_MAX_QUEUE) {
    return Promise.reject(new HttpError(503, "SERVICE_BUSY", "转换器排队已满（inflight " + pool.inflight + " / queue " + pool.queue.length + "），请稍后重试"));
  }
  return new Promise((resolve) => pool.queue.push(resolve));
}
function releaseSlot() {
  const next = pool.queue.shift();
  if (next) next();
  else pool.inflight = Math.max(0, pool.inflight - 1);
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const server = createServer((req, res) => {
  const requestId = typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : undefined;
  handle(req, res, requestId).catch((err) => {
    const status = err instanceof HttpError ? err.status : 500;
    const code = err instanceof HttpError ? err.code : "INTERNAL";
    const message = err instanceof HttpError ? err.message : sanitizeReason(err && err.message ? err.message : "unexpected error");
    log({ level: status >= 500 ? "error" : "warn", event: "request_failed", requestId, path: req.url, status, code, message });
    if (!res.headersSent) {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "x-pipeline-version": PIPELINE_VERSION });
    }
    if (!res.writableEnded) res.end(JSON.stringify({ error: code, message, pipelineVersion: PIPELINE_VERSION }));
  });
});

async function handle(req, res, requestId) {
  const url = new URL(req.url ?? "/", "http://converter.local");
  if (url.pathname === "/healthz") {
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "METHOD_NOT_ALLOWED", "GET /healthz only");
    return respondHealth(req, res);
  }
  if (url.pathname === "/convert") {
    if (req.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "POST /convert only");
    return respondConvert(req, res, requestId);
  }
  throw new HttpError(404, "NOT_FOUND", "unknown path " + url.pathname);
}

/* ---------------------------------------------------------------- /healthz */

async function respondHealth(req, res) {
  const engine = await engineStatus();
  const fonts = await fontStatus();
  const ok = engine.available && fonts.cjkReady;
  const body = {
    ok,
    service: "preview-converter",
    pipelineVersion: PIPELINE_VERSION,
    engine,
    fonts,
    limits: {
      timeoutMs: CONVERT_TIMEOUT_MS,
      maxBytes: CONVERT_MAX_BYTES,
      maxConcurrency: CONVERT_MAX_CONCURRENCY,
      maxQueue: CONVERT_MAX_QUEUE,
      imageDpi: CONVERT_IMAGE_DPI,
      inflight: pool.inflight,
      queued: pool.queue.length
    },
    uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000)
  };
  const payload = JSON.stringify(body);
  res.writeHead(ok ? 200 : 503, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "x-pipeline-version": PIPELINE_VERSION
  });
  if (req.method === "HEAD") return res.end();
  res.end(payload);
}

const engineCache = { at: 0, value: null };
async function engineStatus() {
  if (engineCache.value && Date.now() - engineCache.at < 15000) return engineCache.value;
  const soffice = await run(SOFFICE_BIN, ["--version"], { timeoutMs: 10000 });
  const pdftoppm = await run(PDFTOPPM_BIN, ["-v"], { timeoutMs: 10000 });
  const value = {
    available: soffice.ok,
    bin: SOFFICE_BIN,
    version: (soffice.stdout || soffice.stderr).trim().split("\n")[0] || null,
    rasterizer: (pdftoppm.stderr || pdftoppm.stdout).trim().split("\n")[0] || null,
    lastError: soffice.ok ? null : sanitizeReason(soffice.stderr || "soffice --version failed")
  };
  engineCache.at = Date.now();
  engineCache.value = value;
  return value;
}

const fontCache = { value: null };
async function fontStatus() {
  if (fontCache.value) return fontCache.value;
  const [simsun, simhei, yahei] = await Promise.all([
    matchFont("SimSun"),
    matchFont("SimHei"),
    matchFont("Microsoft YaHei")
  ]);
  const value = {
    simsun: simsun || null,
    simhei: simhei || null,
    yahei: yahei || null,
    cjkReady: Boolean(simsun && simhei && /CJK/.test(simsun) && /CJK/.test(simhei))
  };
  fontCache.value = value;
  return value;
}

async function matchFont(name) {
  const r = await run("fc-match", ["-f", "%{family}", name], { timeoutMs: 10000 });
  return r.ok ? r.stdout.trim() : "";
}

/* ---------------------------------------------------------------- /convert */

async function respondConvert(req, res, requestId) {
  const target = String(req.headers["x-preview-target"] ?? "pdf").toLowerCase();
  if (!PREVIEW_TARGETS.includes(target)) {
    throw new HttpError(400, "BAD_REQUEST", "x-preview-target 必须是 " + PREVIEW_TARGETS.join(" / ") + " 之一");
  }
  const fileName = decodeFileName(req.headers["x-file-name"]);
  const sourceMime = String(req.headers["x-source-mime"] ?? "").toLowerCase();
  const extension = extname(fileName).toLowerCase();
  const source = classifySource(extension, sourceMime);

  if (target === "structured") {
    throw new HttpError(501, "UNSUPPORTED_TARGET", "structured 通道一期未启用（ADR-007：xlsx 走 pdf 通道）");
  }
  if (source === "unknown") {
    throw new HttpError(415, "UNSUPPORTED_MEDIA", "不支持的源类型（fileName=" + (fileName || "<empty>") + " mime=" + (sourceMime || "<empty>") + "）");
  }
  if (target === "pdf" && source === "image") {
    throw new HttpError(415, "UNSUPPORTED_MEDIA", "image 源不走 pdf 通道（应请求 target=image 直出）");
  }

  const declaredLength = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > CONVERT_MAX_BYTES) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Content-Length " + declaredLength + " 超过上限 " + CONVERT_MAX_BYTES + " 字节");
  }

  await acquireSlot();
  const jobDir = await mkdtemp(join(WORK_ROOT, "libiaolink-preview-"));
  const startedAt = Date.now();
  try {
    const inputPath = join(jobDir, "input" + (extension || ""));
    const received = await writeBodyToFile(req, inputPath, CONVERT_MAX_BYTES);

    const outcome = await convert({ source, target, inputPath, jobDir, extension, fileName });
    const durationMs = Date.now() - startedAt;
    const info = await stat(outcome.path);
    log({
      level: "info",
      event: "convert_ok",
      requestId,
      target,
      source,
      mode: outcome.mode,
      inputBytes: received,
      outputBytes: info.size,
      outputKind: outcome.contentType,
      durationMs,
      fileName: fileName || null,
      sourceMime: sourceMime || null
    });
    res.writeHead(200, {
      "content-type": outcome.contentType,
      "content-length": info.size,
      "x-preview-target": target,
      "x-pipeline-version": PIPELINE_VERSION,
      "x-convert-mode": outcome.mode,
      "x-convert-duration-ms": String(durationMs),
      "x-artifact-name": encodeURIComponent(outcome.artifactName),
      ...(outcome.engineVersion ? { "x-convert-engine": encodeURIComponent(outcome.engineVersion) } : {})
    });
    await pipeline(createReadStream(outcome.path), res);
  } finally {
    await rm(jobDir, { recursive: true, force: true }).catch(() => {});
    releaseSlot();
  }
}

async function convert({ source, target, inputPath, jobDir, extension, fileName }) {
  const stem = (fileName ? basename(fileName, extension) : "artifact") || "artifact";

  if (target === "pdf") {
    if (source === "pdf") {
      return { path: inputPath, mode: "passthrough", contentType: "application/pdf", artifactName: stem + ".pdf" };
    }
    const pdfPath = await sofficeConvertToPdf(inputPath, jobDir);
    return { path: pdfPath, mode: "convert", contentType: "application/pdf", artifactName: stem + ".pdf", engineVersion: engineCache.value?.version ?? undefined };
  }

  if (target === "image") {
    if (source === "image") {
      return { path: inputPath, mode: "passthrough", contentType: imageContentType(extension), artifactName: stem + extension };
    }
    const pdfPath = await sofficeConvertToPdf(inputPath, jobDir);
    const pngPath = await rasterizeFirstPage(pdfPath, jobDir);
    return { path: pngPath, mode: source === "pdf" ? "rasterize" : "convert+rasterize", contentType: "image/png", artifactName: stem + ".png", engineVersion: engineCache.value?.version ?? undefined };
  }

  throw new HttpError(501, "UNSUPPORTED_TARGET", "target " + target + " 未实现");
}

async function sofficeConvertToPdf(inputPath, jobDir) {
  const outDir = join(jobDir, "out");
  const profileDir = join(jobDir, "profile");
  await mkdir(outDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });
  const args = [
    "--headless",
    "--nologo",
    "--nofirststartwizard",
    "--norestore",
    "--nolockcheck",
    "-env:UserInstallation=" + pathToFileURL(profileDir).href,
    "--convert-to",
    "pdf",
    "--outdir",
    outDir,
    inputPath
  ];
  const result = await run(SOFFICE_BIN, args, { timeoutMs: CONVERT_TIMEOUT_MS, cwd: outDir });
  if (result.timedOut) {
    throw new HttpError(504, "CONVERT_TIMEOUT", "转换超过 " + CONVERT_TIMEOUT_MS + " ms 仍未完成，已杀进程");
  }
  if (!result.ok) {
    throw new HttpError(422, "CONVERT_FAILED", "LibreOffice 退出码 " + result.code + "：" + sanitizeReason(result.stderr || result.stdout || "无输出"));
  }
  const produced = (await readdir(outDir)).filter((f) => f.toLowerCase().endsWith(".pdf"));
  if (produced.length === 0) {
    throw new HttpError(422, "CONVERT_FAILED", "LibreOffice 未产出 PDF（stderr：" + sanitizeReason(result.stderr) + "）");
  }
  return join(outDir, produced[0]);
}

async function rasterizeFirstPage(pdfPath, jobDir) {
  const prefix = join(jobDir, "page");
  const args = ["-png", "-r", String(CONVERT_IMAGE_DPI), "-f", "1", "-l", "1", "-singlefile", pdfPath, prefix];
  const result = await run(PDFTOPPM_BIN, args, { timeoutMs: Math.min(CONVERT_TIMEOUT_MS, 30000), cwd: jobDir });
  if (result.timedOut) {
    throw new HttpError(504, "CONVERT_TIMEOUT", "首屏光栅化超时（>" + Math.min(CONVERT_TIMEOUT_MS, 30000) + " ms）");
  }
  const pngPath = prefix + ".png";
  const exists = await stat(pngPath).then(() => true).catch(() => false);
  if (!result.ok || !exists) {
    throw new HttpError(422, "CONVERT_FAILED", "pdftoppm 光栅化失败：" + sanitizeReason(result.stderr || "无输出"));
  }
  return pngPath;
}

/* ------------------------------------------------------------------ 工具层 */

function classifySource(extension, sourceMime) {
  if (extension === ".pdf" || sourceMime === "application/pdf") return "pdf";
  if (OFFICE_EXTENSIONS.has(extension)) return "office";
  if (IMAGE_EXTENSIONS.has(extension) || IMAGE_MIME_TYPES.has(sourceMime)) return "image";
  return "unknown";
}

function imageContentType(extension) {
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".webp": "image/webp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".svg": "image/svg+xml",
    ".heic": "image/heic"
  };
  return map[extension] ?? "application/octet-stream";
}

function decodeFileName(raw) {
  if (typeof raw !== "string" || raw.length === 0) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function writeBodyToFile(req, destPath, maxBytes) {
  let size = 0;
  const sink = createWriteStream(destPath);
  try {
    await pipeline(
      req,
      async function* enforceLimit(source) {
        for await (const chunk of source) {
          size += chunk.length;
          if (size > maxBytes) {
            throw new HttpError(413, "PAYLOAD_TOO_LARGE", "请求体超过上限 " + maxBytes + " 字节");
          }
          yield chunk;
        }
      },
      sink
    );
  } catch (err) {
    sink.destroy();
    throw err;
  }
  return size;
}

/** 统一子进程执行器：捕获输出、硬超时、按进程组 SIGKILL（LibreOffice 会派生 soffice.bin） */
function run(cmd, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 20000;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, HOME: process.env.HOME ?? "/tmp", TMPDIR: process.env.TMPDIR ?? "/tmp", SAL_USE_VCLPLUGIN: "svp" }
      });
    } catch (err) {
      return resolve({ ok: false, timedOut: false, code: null, stdout: "", stderr: String(err.message) });
    }
    const cap = 16384;
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    child.stdout.on("data", (chunk) => { if (stdout.length < cap) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { if (stderr.length < cap) stderr += chunk.toString("utf8"); });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };
    child.on("error", (err) => finish({ ok: false, timedOut, code: null, stdout, stderr: stderr + String(err.message) }));
    child.on("close", (code, signal) => finish({ ok: code === 0 && !timedOut, timedOut, code, signal, stdout, stderr }));
  });
}

function killTree(pid) {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* 已退出 */
    }
  }
}

function sanitizeReason(text) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > 480 ? flat.slice(0, 477) + "..." : flat;
}

function intEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function log(fields) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...fields }) + "\n");
}

/* ------------------------------------------------------------------ 启动 */

server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;

server.listen(PORT, "0.0.0.0", () => {
  log({ level: "info", event: "listening", port: PORT, pipelineVersion: PIPELINE_VERSION, maxConcurrency: CONVERT_MAX_CONCURRENCY, timeoutMs: CONVERT_TIMEOUT_MS, maxBytes: CONVERT_MAX_BYTES });
  Promise.all([engineStatus(), fontStatus()]).then(([engine, fonts]) => {
    log({ level: engine.available && fonts.cjkReady ? "info" : "error", event: "selfcheck", engine, fonts });
  });
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    log({ level: "info", event: "shutdown", signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
