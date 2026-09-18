import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLIENT_FILE, OPENAPI_FILE, renderArtifacts } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
const only = onlyArg ? onlyArg.split("=")[1] : "all";

const { openapiJson, clientTypes } = await renderArtifacts();
mkdirSync(join(root, "generated"), { recursive: true });

if (only === "all" || only === "openapi") {
  writeFileSync(join(root, OPENAPI_FILE), openapiJson, "utf8");
  console.log("已生成 " + OPENAPI_FILE + "（" + Buffer.byteLength(openapiJson, "utf8") + " bytes）");
}
if (only === "all" || only === "client") {
  writeFileSync(join(root, CLIENT_FILE), clientTypes, "utf8");
  console.log("已生成 " + CLIENT_FILE + "（" + Buffer.byteLength(clientTypes, "utf8") + " bytes）");
}
