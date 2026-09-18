import openapiTS, { astToString } from "openapi-typescript";
import { buildOpenApiDocument } from "../src/openapi.ts";

export const OPENAPI_FILE = "generated/openapi.json";
export const CLIENT_FILE = "generated/api-types.d.ts";

const CLIENT_HEADER = [
  "/**",
  " * 本文件由 shared/scripts/generate.mjs 生成，禁止手改（CONTRIBUTING 第 14 节）。",
  " * 源：shared/src 下的 Zod schema → generated/openapi.json → 本文件。",
  " */",
  "",
].join("\n");

export async function renderArtifacts() {
  const doc = buildOpenApiDocument();
  const openapiJson = JSON.stringify(doc, null, 2) + "\n";
  const ast = await openapiTS(doc);
  const clientTypes = CLIENT_HEADER + astToString(ast);
  return { doc, openapiJson, clientTypes };
}
