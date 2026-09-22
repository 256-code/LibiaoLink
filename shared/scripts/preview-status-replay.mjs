/*
 * 预览契约回放（契约切片 · S7·file M4-04 / M4-05 前置；wmj 评审定案 PR #103）：
 * FilePreviewResponse 三态矩阵 + FilePreviewQuery 历史版本参数 + 审计枚举（Zod 层，无 DB / 无 HTTP）。
 * 运行：shared/ 下 node scripts/preview-status-replay.mjs；退出码 0 = 全过。
 * 口径：ready 必须带 url / target / generatedAt；not_ready / failed 不带 url；failed 必须带 reason（D2-05，≤ 500 字）；
 *       审计动作 preview 入枚举；对象类型 = file（预览不为同一 fileId 开第二种对象类型）+ change（M4-04）。
 */
import { FilePreviewQuerySchema, FilePreviewResponseSchema } from "../src/modules/files.ts";
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES } from "../src/modules/audits.ts";

const fileId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const at = "2026-09-22T09:00:00.000Z";
const url = "https://minio.local/previews/abc/p1/out.pdf?sig=1";

const base = {
  fileId,
  versionId,
  status: "not_ready",
  target: null,
  url: null,
  expiresAt: null,
  pipelineVersion: null,
  reason: null,
  generatedAt: null,
};

const responseCases = [
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

console.log("共 " + total + " 组，PASS " + pass + " / FAIL " + (total - pass));
if (pass !== total) process.exit(1);