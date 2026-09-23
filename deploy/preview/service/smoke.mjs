#!/usr/bin/env node
/**
 * LibiaoLink 预览转换器 · 容器内自检（M4-05 / PoC-1 证据脚本）
 * ============================================================================
 * 用法（宿主）：
 *   docker compose up -d
 *   docker compose exec -T converter node /app/smoke.mjs
 *
 * 覆盖四类断言：
 *   ① 沙箱四性：非 root / 只读根文件系统 / tmpfs 可写 / 真无外网
 *   ② 字体：fontconfig 把 宋体/黑体 映射到镜像内 Noto CJK（ADR-007 构建门禁）
 *   ③ 转换：中文 DOCX -> PDF（pdftotext 回读 + pdffonts 字体核实）、首屏 PNG、
 *            image/pdf 直出（字节级一致）、错误面（501/415/400/413）、超时杀进程（504）
 *   ④ 契约：/healthz 自报 pipelineVersion，响应头 x-pipeline-version 一致
 *
 * 退出码：0 = 全部通过；1 = 有失败项。
 */
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { connect } from "node:net";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 9900);
const BASE = "http://127.0.0.1:" + PORT;
const WORK = await mkdtemp("/tmp/libiaolink-smoke-");
const SAMPLE_CN = "项目成果文件预览中文验收";
const SAMPLE_CN_2 = "一二三四五六七八九十，变更申请与阶段门禁";
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok, detail: detail ?? null });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  |  " + detail : ""));
}

function short(text, max = 160) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "..." : flat;
}

async function main() {
  console.log("== LibiaoLink 预览转换器自检 ==");
  console.log("converter = " + BASE + "  work = " + WORK);
  console.log("");

  await checkSandbox();
  await checkFonts();
  const health = await checkHealth();

  const docx = await buildSampleDocx();
  const pdf = await checkPdfFromDocx(docx);
  if (pdf) {
    await checkImageFromDocx(docx);
    await checkPdfPassthrough(pdf);
  }
  await checkImagePassthrough();
  await checkErrorSurface(docx);
  await checkTimeoutKillsProcess();

  await rm(WORK, { recursive: true, force: true }).catch(() => {});

  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log("== 汇总 ==");
  console.log("通过 " + (results.length - failed.length) + " / " + results.length);
  if (failed.length > 0) {
    for (const item of failed) console.log("  FAILED: " + item.name + "  " + (item.detail ?? ""));
  }
  const evidence = {
    pipelineVersion: process.env.PIPELINE_VERSION ?? null,
    soffice: health?.engine?.version ?? null,
    rasterizer: health?.engine?.rasterizer ?? null,
    fonts: health?.fonts ?? null,
    checks: results.map((r) => ({ name: r.name, ok: r.ok, detail: r.detail }))
  };
  writeFileSync("/tmp/libiaolink-preview-smoke.json", JSON.stringify(evidence, null, 2) + String.fromCharCode(10), "utf8");
  console.log("证据 JSON 已写入容器内 /tmp/libiaolink-preview-smoke.json");
  process.exit(failed.length === 0 ? 0 : 1);
}

/* ------------------------------------------------------- ① 沙箱四性 */

async function checkSandbox() {
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  check("非 root 运行（uid != 0）", uid !== 0, "uid=" + uid);

  let readOnly = false;
  let readOnlyDetail = "";
  try {
    writeFileSync("/app/.smoke-write-probe", "x");
    readOnlyDetail = "意外成功：根文件系统可写";
  } catch (err) {
    readOnly = err.code === "EROFS" || err.code === "EACCES";
    readOnlyDetail = err.code + " " + short(err.message, 80);
  }
  check("只读根文件系统（/app 不可写）", readOnly, readOnlyDetail);

  let tmpWritable = false;
  try {
    writeFileSync(join(WORK, "probe.txt"), "ok");
    tmpWritable = readFileSync(join(WORK, "probe.txt"), "utf8") === "ok";
  } catch (err) {
    tmpWritable = false;
  }
  check("tmpfs 工作目录可写", tmpWritable, WORK);

  const egress = await probeEgress();
  check("无外网（HTTP 与裸 TCP 均出不去）", !egress.http && !egress.tcp, "http=" + egress.http + " tcp=" + egress.tcp + " (" + egress.detail + ")");
}

async function probeEgress() {
  const out = { http: false, tcp: false, detail: "" };
  try {
    const res = await fetch("http://example.com/", { signal: AbortSignal.timeout(3000) });
    out.http = true;
    out.detail = "http status " + res.status;
  } catch (err) {
    out.detail = short(err.name + " " + err.message, 60);
  }
  try {
    await new Promise((resolve, reject) => {
      const socket = connect(443, "1.1.1.1");
      socket.setTimeout(3000);
      socket.on("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("timeout"));
      });
      socket.on("error", reject);
    });
    out.tcp = true;
  } catch {
    out.tcp = false;
  }
  return out;
}

/* ------------------------------------------------------- ② 字体 */

async function checkFonts() {
  const simsun = (await run("fc-match", ["-f", "%{family}", "SimSun"])).stdout.trim();
  const simhei = (await run("fc-match", ["-f", "%{family}", "SimHei"])).stdout.trim();
  const yahei = (await run("fc-match", ["-f", "%{family}", "Microsoft YaHei"])).stdout.trim();
  check("fontconfig：SimSun -> Noto Serif CJK SC", /Noto Serif CJK SC/.test(simsun), simsun);
  check("fontconfig：SimHei -> Noto Sans CJK SC", /Noto Sans CJK SC/.test(simhei), simhei);
  check("fontconfig：微软雅黑 -> Noto Sans CJK SC", /Noto Sans CJK SC/.test(yahei), yahei);
  const listed = (await run("fc-list", [":lang=zh-cn", "family"])).stdout;
  check("镜像内置中文字体（fc-list zh-cn 非空）", listed.trim().length > 0, short(listed.split(String.fromCharCode(10))[0] ?? "", 60));
}

/* ------------------------------------------------------- ③ 契约 /healthz */

async function checkHealth() {
  const res = await fetch(BASE + "/healthz");
  const body = await res.json().catch(() => null);
  check("GET /healthz 返回 200", res.status === 200, "status=" + res.status + " ok=" + (body?.ok ?? null));
  check("healthz 自报 pipelineVersion", Boolean(body?.pipelineVersion), "pipelineVersion=" + (body?.pipelineVersion ?? null));
  check("healthz 自报 soffice 可用", Boolean(body?.engine?.available), short(body?.engine?.version ?? "", 60));
  check("healthz 字体就绪标记 cjkReady", body?.fonts?.cjkReady === true, JSON.stringify(body?.fonts ?? {}));
  return body;
}

/* ------------------------------------------------------- ③ 转换链路 */

async function buildSampleDocx() {
  const htmlPath = join(WORK, "sample.html");
  const html = [
    "<!doctype html><html><head><meta charset=\"utf-8\"><style>",
    "body { font-family: SimSun, serif; font-size: 14pt; }",
    "h1 { font-family: SimHei, sans-serif; font-size: 18pt; }",
    "</style></head><body>",
    "<h1>" + SAMPLE_CN + "（黑体标题）</h1>",
    "<p>" + SAMPLE_CN_2 + "。</p>",
    "<p>混排 English ASCII 1234567890 与中文标点：（）【】、；。！？</p>",
    "<table border=\"1\"><tr><td>项目编号</td><td>PX-20260923-0001</td></tr><tr><td>状态</td><td>定档</td></tr></table>",
    "</body></html>"
  ].join(String.fromCharCode(10));
  await writeFile(htmlPath, html, "utf8");
  const outDir = join(WORK, "sample-out");
  await mkdir(outDir, { recursive: true });
  // 显式过滤器名：LO 25.2 下 --convert-to docx 的扩展名映射在本镜像里解析不到导出过滤器，
  // 显式写 "docx:MS Word 2007 XML" 稳定可用（产品路径只导出 pdf，不受此影响）。
  const build = await run("soffice", [
    "--headless", "--nologo", "--norestore", "--nolockcheck",
    "-env:UserInstallation=file://" + join(WORK, "sample-profile"),
    "--convert-to", "docx:MS Word 2007 XML", "--outdir", outDir, htmlPath
  ], 60000);
  const files = await readdir(outDir).catch(() => []);
  const docx = files.find((f) => f.endsWith(".docx"));
  check("样例生成：中文 HTML -> DOCX（容器内 soffice）", Boolean(docx), short((build.stdout + " " + build.stderr).trim(), 140));
  if (!docx) return null;
  return readFile(join(outDir, docx));
}

async function checkPdfFromDocx(docx) {
  if (!docx) return null;
  const res = await postConvert(docx, { fileName: "中文样例文件.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", target: "pdf" });
  const ok = res.status === 200 && res.body.length > 1024 && res.body.subarray(0, 5).toString("latin1") === "%PDF-";
  check("DOCX -> PDF（200 + %PDF 魔数）", ok, "status=" + res.status + " bytes=" + res.body.length + " type=" + res.headers.get("content-type"));
  check("响应头 x-pipeline-version 与进程一致", res.headers.get("x-pipeline-version") === (process.env.PIPELINE_VERSION ?? null), "header=" + res.headers.get("x-pipeline-version") + " env=" + (process.env.PIPELINE_VERSION ?? null));
  if (!ok) return null;
  const pdfPath = join(WORK, "check.pdf");
  await writeFile(pdfPath, res.body);
  const text = (await run("pdftotext", ["-layout", pdfPath, "-"])).stdout;
  const flat = text.replace(/\s+/g, "");
  check("中文不乱码（pdftotext 回读命中样例文本）", flat.includes(SAMPLE_CN.replace(/\s+/g, "")), "命中片段：" + short(flat.slice(0, 60), 60));
  check("无替换字符 U+FFFD", !text.includes(String.fromCharCode(0xFFFD)));
  const pdffonts = (await run("pdffonts", [pdfPath])).stdout;
  check("PDF 内嵌 CJK 字体（pdffonts）", /Noto(Serif|Sans)CJK/i.test(pdffonts), short(pdffonts.split(String.fromCharCode(10)).slice(0, 4).join(" / "), 140));
  return res.body;
}

async function checkImageFromDocx(docx) {
  if (!docx) return;
  const res = await postConvert(docx, { fileName: "中文样例文件.docx", target: "image" });
  const isPng = res.body.length > 1024 && res.body.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  check("DOCX -> 首屏 PNG（image 通道）", res.status === 200 && isPng && res.headers.get("content-type") === "image/png", "status=" + res.status + " bytes=" + res.body.length + " mode=" + res.headers.get("x-convert-mode"));
}

async function checkPdfPassthrough(pdf) {
  const res = await postConvert(pdf, { fileName: "中文样例文件.pdf", target: "pdf" });
  const same = res.status === 200 && sha256(res.body) === sha256(pdf);
  check("PDF 源直通（target=pdf 字节级一致）", same, "status=" + res.status + " mode=" + res.headers.get("x-convert-mode") + " sha=" + sha256(res.body).slice(0, 12));
}

async function checkImagePassthrough() {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
  const res = await postConvert(png, { fileName: "缩略图.png", target: "image" });
  const same = res.status === 200 && sha256(res.body) === sha256(png);
  check("图片源直通（image 通道字节级一致）", same, "status=" + res.status + " bytes=" + res.body.length + " mode=" + res.headers.get("x-convert-mode"));
}

/* ------------------------------------------------------- ③ 错误面 */

async function checkErrorSurface(docx) {
  const structured = await postConvert(docx ?? Buffer.from("x"), { fileName: "表.xlsx", target: "structured" });
  const structuredBody = await structured.json.catch(() => null);
  check("target=structured -> 501 UNSUPPORTED_TARGET", structured.status === 501 && structuredBody?.error === "UNSUPPORTED_TARGET", "status=" + structured.status + " error=" + (structuredBody?.error ?? null));

  const unknownTarget = await postConvert(docx ?? Buffer.from("x"), { fileName: "a.pdf", target: "cad" });
  const unknownBody = await unknownTarget.json.catch(() => null);
  check("未知 target -> 400 BAD_REQUEST", unknownTarget.status === 400 && unknownBody?.error === "BAD_REQUEST", "status=" + unknownTarget.status);

  const unsupported = await postConvert(Buffer.from("MZ binary"), { fileName: "木马.exe", mime: "application/octet-stream", target: "pdf" });
  const unsupportedBody = await unsupported.json.catch(() => null);
  check("不支持的源类型 -> 415 UNSUPPORTED_MEDIA", unsupported.status === 415 && unsupportedBody?.error === "UNSUPPORTED_MEDIA", "status=" + unsupported.status);

  const oversize = await rawRequest([
    "POST /convert HTTP/1.1",
    "host: 127.0.0.1",
    "x-preview-target: pdf",
    "x-file-name: big.pdf",
    "content-length: 999999999",
    "",
    ""
  ]);
  check("声明超长 Content-Length -> 413 PAYLOAD_TOO_LARGE", /\s413\s/.test(oversize.split(String.fromCharCode(10))[0] ?? ""), short(oversize.split(String.fromCharCode(10))[0] ?? "", 60));
}

/* ------------------------------------------------------- ③ 超时杀进程 */

async function checkTimeoutKillsProcess() {
  const child = spawn(process.execPath, ["/app/server.mjs"], {
    env: { ...process.env, PORT: "9901", CONVERT_TIMEOUT_MS: "1" },
    stdio: ["ignore", "ignore", "ignore"]
  });
  try {
    const ready = await waitFor("http://127.0.0.1:9901/healthz", 15000);
    if (!ready) {
      check("超时路径：第二个实例就绪", false, "9901 未就绪");
      return;
    }
    const docx = await buildSampleDocx();
    const started = Date.now();
    const res = await postConvert(docx, { fileName: "超时样例.docx", target: "pdf", base: "http://127.0.0.1:9901" });
    const body = await res.json.catch(() => null);
    check("超时 -> 504 CONVERT_TIMEOUT", res.status === 504 && body?.error === "CONVERT_TIMEOUT", "status=" + res.status + " error=" + (body?.error ?? null) + " elapsedMs=" + (Date.now() - started));
    await sleep(1500);
    const strays = countProcesses(/soffice|oosplash/);
    check("超时后无 soffice 残留进程", strays === 0, "strays=" + strays);
  } finally {
    child.kill("SIGKILL");
  }
}

function countProcesses(pattern) {
  let count = 0;
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const comm = readFileSync("/proc/" + entry + "/comm", "utf8").trim();
      if (pattern.test(comm)) count += 1;
    } catch {
      /* 进程已退出 */
    }
  }
  return count;
}

/* ------------------------------------------------------- 工具层 */

async function postConvert(bytes, { fileName, mime, target, base }) {
  const headers = { "x-preview-target": target ?? "pdf" };
  if (fileName) headers["x-file-name"] = encodeURIComponent(fileName);
  if (mime) headers["x-source-mime"] = mime;
  const res = await fetch((base ?? BASE) + "/convert", { method: "POST", headers, body: bytes });
  const body = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "";
  const json = contentType.includes("application/json") ? parseJson(body) : Promise.resolve(null);
  return { status: res.status, headers: res.headers, body, json };
}

function rawRequest(lines) {
  return new Promise((resolve, reject) => {
    const socket = connect(PORT, "127.0.0.1");
    let data = "";
    socket.setTimeout(8000);
    socket.on("connect", () => socket.write(lines.join(String.fromCharCode(13, 10))));
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(data);
    });
    socket.on("close", () => resolve(data));
    socket.on("error", reject);
  });
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status === 200 || res.status === 503) return true;
    } catch {
      /* 还没起来 */
    }
    await sleep(500);
  }
  return false;
}

function run(cmd, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: "/tmp", TMPDIR: "/tmp", SAL_USE_VCLPLUGIN: "svp" } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* 已退出 */
      }
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: stderr + err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

function parseJson(buffer) {
  try {
    return Promise.resolve(JSON.parse(buffer.toString("utf8")));
  } catch {
    return Promise.resolve(null);
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
