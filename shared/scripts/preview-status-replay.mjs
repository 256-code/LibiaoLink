/*
 * 预览契约回放（契约切片 · S7·file M4-04 / M4-05 前置；wmj 评审定案 PR #103）：
 * FilePreviewResponse 三态矩阵 + FilePreviewQuery 历史版本参数 + 审计枚举（Zod 层，无 DB / 无 HTTP）。
 * 运行：shared/ 下 node scripts/preview-status-replay.mjs；退出码 0 = 全过。
 * 口径：ready 必须带 url / target / generatedAt；not_ready / failed 不带 url；failed 必须带 reason（D2-05，≤ 500 字）；
 *       审计动作 preview 入枚举；对象类型 = file（预览不为同一 fileId 开第二种对象类型）+ change（M4-04）。
 *       S1 契约切片（S8-x · ONLYOFFICE 查看器）：FilePreviewResponse.viewer 查看器矩阵（必填可空）+ 受控端点（preview-content）OpenAPI 路由断言。
 */
import { FilePreviewQuerySchema, FilePreviewResponseSchema } from "../src/modules/files.ts";
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES } from "../src/modules/audits.ts";
import { readFileSync } from "node:fs";

const fileId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const at = "2026-09-22T09:00:00.000Z";
const url = "https://minio.local/previews/abc/p1/out.pdf?sig=1";

// Push 258 错层修正：permissions 嵌 document（ONLYOFFICE 只认该位置；顶层不再有 permissions 段）。
const VIEWER = { kind: "onlyoffice", docServerUrl: "http://127.0.0.1:8001", documentType: "word", document: { title: "N1-03 项目周报.docx", url: "http://api.internal:3000/api/v1/files/" + fileId + "/versions/" + versionId + "/preview-content", fileType: "docx", key: "demo-key", permissions: { edit: false, download: true, print: false, comment: false, chat: false, fillForms: false, protect: true } }, editorConfig: { mode: "view", lang: "zh-CN", user: { id: "u-preview", name: "查看者" } }, token: "eyJhbGciOiJIUzI1NiJ9.demo.token" };
const base = {
  fileId,
  versionId,
  status: "not_ready",
  target: null,
  viewer: null,
  url: null,
  expiresAt: null,
  pipelineVersion: null,
  reason: null,
  generatedAt: null,
};

const responseCases = [
  ["ready：ONLYOFFICE 查看器通道（viewer 非空 / 无转换产物：target、url 为空）", { ...base, status: "ready", viewer: VIEWER }, true],
  ["ready：缺 viewer（必填可空 —— 三态响应必须显式给位）", { ...base, status: "ready", target: "pdf", url, expiresAt: at, pipelineVersion: "lo-24.8.1-v1", generatedAt: at, viewer: undefined }, false],
  ["viewer：kind 白名单外（libreoffice）", { ...base, viewer: { ...VIEWER, kind: "libreoffice" } }, false],
  ["viewer：documentType 白名单外（sheet）", { ...base, viewer: { ...VIEWER, documentType: "sheet" } }, false],
  ["viewer：editorConfig.mode 非 view（edit）", { ...base, viewer: { ...VIEWER, editorConfig: { ...VIEWER.editorConfig, mode: "edit" } } }, false],
  ["viewer：缺 token", { ...base, viewer: { ...VIEWER, token: undefined } }, false],
  ["viewer：document 缺 permissions（Push 258 起嵌 document · 必填）", { ...base, status: "ready", viewer: { ...VIEWER, document: { ...VIEWER.document, permissions: undefined } } }, false],
  ["ready：pdf 产物 + 短时签名 + generatedAt", { ...base, status: "ready", target: "pdf", url, expiresAt: at, pipelineVersion: "lo-24.8.1-v1", generatedAt: at }, true],
  ["ready：image 通道（矢量 SVG 产物）", { ...base, versionId: null, status: "ready", target: "image", url, expiresAt: at, pipelineVersion: "lo-24.8.1-v1", generatedAt: at }, true],
  ["not_ready：尚未生成（无版本）", base, true],
  ["failed：转换失败降级「请下载」", { ...base, status: "failed", pipelineVersion: "lo-24.8.1-v1", reason: "converter timeout after 120s" }, true],
  ["非法状态（白名单外）", { ...base, status: "processing" }, false],
  ["非法目标（白名单外）", { ...base, status: "ready", target: "docx", url, expiresAt: at, generatedAt: at }, false],
  ["缺 fileId（必填）", { ...base, fileId: undefined }, false],
  ["缺 generatedAt（必填可空）", { ...base, generatedAt: undefined }, false],
  ["failed reason 超 500 字（限量）", { ...base, status: "failed", reason: "x".repeat(501) }, false],
];

const queryCases = [
  ["查询参数：指定历史版本（A4-06）", { versionId }, true],
  ["查询参数：缺省 = 当前版本", {}, true],
  ["查询参数：versionId 非 UUID", { versionId: "not-a-uuid" }, false],
];

const enumCases = [
  ["审计动作含 preview（D2-07：预览计入查看 / 下载审计）", AUDIT_ACTIONS.includes("preview")],
  ["审计对象类型含 change（M4-04 变更记录）", AUDIT_OBJECT_TYPES.includes("change")],
  ["审计对象类型不含 preview（预览沿用 object_type = file + action = preview）", !AUDIT_OBJECT_TYPES.includes("preview")],
];

let pass = 0;
let total = 0;

function runCases(label, schema, cases) {
  for (const [name, body, expectOk] of cases) {
    total += 1;
    const parsed = schema.safeParse(body);
    const ok = parsed.success === expectOk;
    if (ok) pass += 1;
    const detail = parsed.success
      ? "接受"
      : "拒绝（" + parsed.error.issues.map((issue) => (issue.path.join(".") || "(root)") + " " + issue.code).join("; ") + "）";
    console.log((ok ? "PASS" : "FAIL") + " | " + label + " · " + name + " | 期望" + (expectOk ? "接受" : "拒绝") + " → 实际" + detail);
  }
}

runCases("响应", FilePreviewResponseSchema, responseCases);
runCases("查询", FilePreviewQuerySchema, queryCases);

for (const [name, ok] of enumCases) {
  total += 1;
  if (ok) pass += 1;
  console.log((ok ? "PASS" : "FAIL") + " | " + name);
}

const openapi = JSON.parse(readFileSync(new URL("../generated/openapi.json", import.meta.url), "utf8"));
const routePath = openapi.paths["/api/v1/files/{id}/versions/{versionId}/preview-content"];
const routeOp = routePath && routePath.get;
const routeCases = [
  ["OpenAPI：受控端点路由已注册（C6：契约可见、入口不可达）", Boolean(routeOp)],
  ["OpenAPI：仅 GET（其余方法不在契约面）", Boolean(routeOp) && !routePath.post && !routePath.put && !routePath.patch && !routePath.delete],
  ["OpenAPI：响应含 200 / 401 / 404 / 405 / 503（C2 / C4 口径）", Boolean(routeOp) && ["200", "401", "404", "405", "503"].every((code) => Boolean(routeOp.responses[code]))],
  ["OpenAPI：200 = 字节流（application/octet-stream / binary）", Boolean(routeOp) && routeOp.responses["200"].content["application/octet-stream"].schema.format === "binary"],
  ["OpenAPI：401 明确服务间鉴权语义（缺 / 签名错 / 过期 / 绑定不匹配）", Boolean(routeOp) && String(routeOp.responses["401"].description).includes("URL 绑定不匹配")],
];

for (const [name, ok] of routeCases) {
  total += 1;
  if (ok) pass += 1;
  console.log((ok ? "PASS" : "FAIL") + " | " + name);
}

console.log("共 " + total + " 组，PASS " + pass + " / FAIL " + (total - pass));
if (pass !== total) process.exit(1);