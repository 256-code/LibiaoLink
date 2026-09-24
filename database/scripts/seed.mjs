#!/usr/bin/env node
// LibiaoLink · 种子执行器（h1 · S6·identity/org；规格见 database/seeds/README.md）
// 与迁移的分界：种子只写业务字典 / 模板数据（DML），可重跑、可修订；不写 schema_migrations，不参与漂移校验。
// 保证：1) pg_advisory_lock 串行化（锁键与迁移器分开）；2) 每个种子独立事务，--dry-run 一律回滚；
//       3) 幂等：按业务键 upsert / 比对，重复执行第二次零变更；4) 默认不做 DELETE。
// 用法：
//   DATABASE_URL=postgres://user:pass@host:5432/db node scripts/seed.mjs
//   DATABASE_URL=... node scripts/seed.mjs --dry-run
//   DATABASE_URL=... node scripts/seed.mjs --only=roles
//   DATABASE_URL=... node scripts/seed.mjs --with-optional   # 连可选种子（演示数据）一起跑
//   也可用 PG* 环境变量（PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE）。

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { SEEDS } from "../seeds/index.mjs";

const { Client } = pg;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEEDS_DIR = path.resolve(HERE, "..", "seeds");

// 固定 advisory lock 键：同一数据库内串行化种子执行（与迁移器 20260918 分开，避免互锁）
const LOCK_KEY = 20260919;

const DRY_RUN = process.argv.includes("--dry-run");
const ONLY_ARG = process.argv.find((arg) => arg.startsWith("--only="));
const ONLY = ONLY_ARG === undefined ? null : ONLY_ARG.slice("--only=".length);
const WITH_OPTIONAL = process.argv.includes("--with-optional");

function describeTarget() {
  const url = process.env.DATABASE_URL;
  if (!url) return "PG* 环境变量（PGHOST / PGPORT / PGUSER / PGDATABASE）";
  const scheme = url.indexOf("://");
  const at = url.indexOf("@");
  if (scheme < 0 || at < 0 || at < scheme) return "(已设置 DATABASE_URL)";
  return url.slice(0, scheme + 3) + "***:***" + url.slice(at);
}

async function main() {
  // 可选种子（optional = true，例如演示数据）：默认不执行 —— CI 与正式环境不需要它们；--with-optional 显式带上。
  const optionalSeeds = SEEDS.filter((seed) => seed.optional === true);
  const selected =
    ONLY !== null
      ? SEEDS.filter((seed) => seed.name === ONLY)
      : WITH_OPTIONAL
        ? SEEDS
        : SEEDS.filter((seed) => seed.optional !== true);
  if (selected.length === 0) {
    console.error("seed: --only=" + ONLY + " 未匹配任何种子；可用：" + SEEDS.map((seed) => seed.name).join(" / "));
    process.exitCode = 1;
    return;
  }
  console.log(
    "seed: 目标 " + describeTarget() + "，种子目录 " + SEEDS_DIR + (DRY_RUN ? "（dry-run，全部回滚）" : ""),
  );
  if (ONLY === null && !WITH_OPTIONAL && optionalSeeds.length > 0) {
    console.log(
      "seed: 跳过可选种子 " + optionalSeeds.map((seed) => seed.name).join(" / ") + "（演示数据；--only=<name> 或 --with-optional 显式执行）",
    );
  }
  const client = new Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    for (const seed of selected) {
      await client.query("begin");
      try {
        const summary = await seed.run(client);
        await client.query(DRY_RUN ? "rollback" : "commit");
        const parts = Object.entries(summary).map(([key, value]) => key + " " + value);
        console.log("seed: " + seed.name + "（" + seed.title + "）" + (DRY_RUN ? " dry-run 已回滚" : " 已提交"));
        console.log("  - " + parts.join("，"));
      } catch (error) {
        await client.query("rollback").catch(() => {});
        const reason = error && error.message ? error.message : String(error);
        throw new Error("种子失败并已回滚：" + seed.name + " —— " + reason);
      }
    }
    console.log("seed: 完成，本次执行 " + selected.length + " 个种子");
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error("seed: " + (error && error.message ? error.message : String(error)));
  process.exitCode = 1;
});
