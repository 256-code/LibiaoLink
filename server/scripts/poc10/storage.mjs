// PoC-10 存储工具：上传夹具 / 生成预签名 URL
// 用法：node --env-file-if-exists=server/.env storage.mjs upload <file> <key>
//       node --env-file-if-exists=server/.env storage.mjs presign <key> [ttl] [endpoint]
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { putObject, presignGet } from "./poclib.mjs";

const CT = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain",
};
const argv = process.argv.slice(2);
const cmd = argv[0];
if (cmd === "upload") {
  const [file, key] = argv.slice(1);
  await putObject(key, readFileSync(file), CT[extname(file).toLowerCase()] ?? "application/octet-stream");
  console.log("uploaded " + key);
} else if (cmd === "presign") {
  const [key, ttl, endpoint] = argv.slice(1);
  console.log(await presignGet(key, Number(ttl ?? 900), endpoint));
} else {
  console.log("usage: storage.mjs upload <file> <key> | presign <key> [ttl] [endpoint]");
  process.exit(2);
}
