#!/usr/bin/env node
// 权限矩阵自检（h6 · PoC-6）：种子 #6b（role_permissions）与契约枚举、角色集三方对齐。
// 不连库：读 database/seeds/role-permissions.mjs 的 MATRIX + database/seeds/roles.mjs 的 ROLES +
// shared/generated/openapi.json 的 PermissionKey 枚举（契约生成物）。
// 用法：node scripts/check-permission-matrix.mjs（server 目录下）；退出码 0 = 对齐，1 = 有差异。
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MATRIX } from "../../database/seeds/role-permissions.mjs";
import { ROLES } from "../../database/seeds/roles.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const openapi = JSON.parse(readFileSync(join(root, "shared", "generated", "openapi.json"), "utf8"));
const keys = openapi.components?.schemas?.PermissionKey?.enum ?? [];

const problems = [];
if (keys.length === 0) problems.push("契约生成物里找不到 PermissionKey 枚举（先跑 shared 的 npm run generate）");

const seedRoleCodes = new Set(ROLES.map((role) => role.code));
const matrixRoleCodes = new Set(MATRIX.map((entry) => entry.roleCode));
for (const code of seedRoleCodes) {
  if (!matrixRoleCodes.has(code)) problems.push("角色未在矩阵中登记：" + code);
}
for (const code of matrixRoleCodes) {
  if (!seedRoleCodes.has(code)) problems.push("矩阵里的角色不在种子 #6a：" + code);
}

const known = new Set(keys);
let total = 0;
for (const entry of MATRIX) {
  const seen = new Set();
  if (entry.keys.length === 0) problems.push("角色没有任何权限位：" + entry.roleCode);
  for (const key of entry.keys) {
    total += 1;
    if (seen.has(key)) problems.push("角色内权限位重复：" + entry.roleCode + " / " + key);
    seen.add(key);
    if (!known.has(key)) problems.push("权限位不在契约枚举内：" + entry.roleCode + " / " + key);
  }
}

const admin = MATRIX.find((entry) => entry.roleCode === "admin");
if (admin === undefined) {
  problems.push("矩阵缺少系统管理员（admin）条目");
} else {
  for (const key of keys) {
    if (!admin.keys.includes(key)) problems.push("系统管理员缺少权限位：" + key);
  }
}

if (problems.length > 0) {
  console.error("check:permission-matrix 未通过：");
  for (const problem of problems) console.error("  - " + problem);
  process.exitCode = 1;
} else {
  console.log(
    "check:permission-matrix 通过：角色 " + MATRIX.length + " 个 / 权限位条目 " + total + " 条 / 契约枚举 " + keys.length + " 键（系统管理员全量）",
  );
}
