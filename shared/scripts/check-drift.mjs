import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLIENT_FILE, OPENAPI_FILE, renderArtifacts } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { doc, openapiJson, clientTypes } = await renderArtifacts();

const pathCount = Object.keys(doc.paths || {}).length;
const schemaCount = Object.keys((doc.components && doc.components.schemas) || {}).length;
if (doc.openapi !== "3.1.0" || pathCount === 0 || schemaCount === 0) {
  console.error("OpenAPI 文档结构异常：openapi=" + doc.openapi + " paths=" + pathCount + " schemas=" + schemaCount);
  process.exit(1);
}
console.log("OpenAPI 3.1 结构校验通过：paths=" + pathCount + "，schemas=" + schemaCount);

const checks = [
  [OPENAPI_FILE, openapiJson],
  [CLIENT_FILE, clientTypes],
];

let drifted = 0;
for (const [file, expected] of checks) {
  let actual = null;
  try {
    actual = readFileSync(join(root, file), "utf8");
  } catch {
    actual = null;
  }
  if (actual === expected) {
    console.log("ok    " + file + "（与生成结果一致）");
  } else {
    drifted += 1;
    console.log("DRIFT " + file + "（与生成结果不一致）");
  }
}

if (drifted > 0) {
  console.error("契约漂移检查失败：请运行 npm run generate 并提交生成物（CONTRIBUTING 第 14 节）。");
  process.exit(1);
}
console.log("契约漂移检查通过。");
