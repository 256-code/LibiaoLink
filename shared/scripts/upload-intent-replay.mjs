/*
 * 上传入口回放（契约 · Push 130 · wmj）：intent x fileId 接受 / 拒绝矩阵（Zod 层，无 DB / 无 HTTP）。
 * 运行：shared/ 下 node scripts/upload-intent-replay.mjs；退出码 0 = 全过。
 * 口径：version 省略 fileId = 新建；version + fileId = 既有 draft 替换 / 追加版本；change 必填 fileId（目标须 final / changed）。
 */
import { UploadCreateBodySchema } from "../src/modules/files.ts";

const projectId = "11111111-1111-4111-8111-111111111111";
const fileId = "22222222-2222-4222-8222-222222222222";
const base = { projectId, name: "回放留痕.docx", sizeBytes: 1048576 };

const cases = [
  ["version 省略 fileId（新建文件）", { ...base, intent: "version" }, true],
  ["version + fileId（既有 draft 替换 / 追加版本）", { ...base, intent: "version", fileId }, true],
  ["version + fileId 非 UUID（形状校验）", { ...base, intent: "version", fileId: "not-a-uuid" }, false],
  ["change 省略 fileId（必填缺失）", { ...base, intent: "change", change: { reason: "设计变更" } }, false],
  ["change + fileId 缺 change 体（必填缺失）", { ...base, intent: "change", fileId }, false],
  ["change + fileId + change（定档后变更）", { ...base, intent: "change", fileId, change: { reason: "设计变更" } }, true],
];

let pass = 0;
for (const [name, body, expectOk] of cases) {
  const parsed = UploadCreateBodySchema.safeParse(body);
  const ok = parsed.success === expectOk;
  if (ok) pass += 1;
  const detail = parsed.success
    ? "接受"
    : "拒绝（" + parsed.error.issues.map((issue) => (issue.path.join(".") || "(root)") + " " + issue.code).join("; ") + "）";
  console.log((ok ? "PASS" : "FAIL") + " | " + name + " | 期望" + (expectOk ? "接受" : "拒绝") + " → 实际" + detail);
}

console.log("共 " + cases.length + " 组，PASS " + pass + " / FAIL " + (cases.length - pass));
if (pass !== cases.length) process.exit(1);
