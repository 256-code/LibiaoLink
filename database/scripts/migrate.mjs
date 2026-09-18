#!/usr/bin/env node
// LibiaoLink · 数据库迁移器（g3 · S5）
// 规则（CONTRIBUTING §14）：只追加、已合入迁移不可修改；结构变更由独立受限任务执行，
// 应用进程不得在启动时自动改结构 —— 本脚本只由部署 / 运维手工触发。
// 保证：1) pg_advisory_lock 串行化并发迁移；2) 每个文件独立事务，失败整体回滚；
//       3) schema_migrations 记录「文件名 + 校验和 + 执行时间」；
//       4) 漂移校验：已执行迁移被修改 / 删除、或在中间插队，一律拒绝执行并退出码 1。
// 用法：
//   DATABASE_URL=postgres://user:pass@host:5432/db node scripts/migrate.mjs
//   DATABASE_URL=... node scripts/migrate.mjs --dry-run
//   也可用 PG* 环境变量（PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE）。

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(HERE, "..", "migrations");

// 固定 advisory lock 键：同一数据库内串行化迁移（按库生效，与其他应用互不影响）
const LOCK_KEY = 20260918;

const CR = String.fromCharCode(13);
const BOM = String.fromCharCode(65279);
const DRY_RUN = process.argv.includes("--dry-run");

function describeTarget() {
  const url = process.env.DATABASE_URL;
  if (!url) return "PG* 环境变量（PGHOST / PGPORT / PGUSER / PGDATABASE）";
  const scheme = url.indexOf("://");
  const at = url.indexOf("@");
  if (scheme < 0 || at < 0 || at < scheme) return "(已设置 DATABASE_URL)";
  return url.slice(0, scheme + 3) + "***:***" + url.slice(at);
}

// 统一行尾（去 CR）并去 BOM 后再计算校验和，避免 Windows 检出造成假漂移

function normalize(text) {
  return text.split(CR).join("").split(BOM).join("");
}

function checksumOf(text) {
  return createHash("sha256").update(normalize(text), "utf8").digest("hex");
}

async function loadMigrations() {
  const names = (await readdir(MIGRATIONS_DIR)).filter((n) => n.endsWith(".sql")).sort();
  const files = [];
  for (const name of names) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, name), "utf8");
    files.push({ name, sql, checksum: checksumOf(sql) });
  }
  return files;
}

async function ensureMetaTable(client) {
  await client.query(
    "create table if not exists schema_migrations (" +
      "filename text primary key, " +
      "checksum text not null, " +
      "applied_at timestamptz not null default now(), " +
      "execution_ms integer" +
      ")"
  );
  // 迁移记录只归迁移器：即使角色脚本的默认权限覆盖到它，这里也显式收回
  for (const role of ["libiaolink_api", "libiaolink_readonly"]) {
    const found = await client.query("select 1 from pg_roles where rolname = $1", [role]);
    if (found.rowCount > 0) {
      await client.query("revoke all on table schema_migrations from " + role);
    }
  }
}

// 漂移校验：已执行迁移必须与磁盘文件一一对应，且已执行序列必须是磁盘序列的前缀

function verifyNoDrift(appliedRows, files) {
  const byName = new Map(files.map((f) => [f.name, f]));
  for (const row of appliedRows) {
    const file = byName.get(row.filename);
    if (!file) {
      throw new Error("已执行迁移文件缺失：" + row.filename + " —— 历史迁移不可修改或删除（CONTRIBUTING §14）");
    }
    if (file.checksum !== row.checksum) {
      throw new Error("已执行迁移内容被修改：" + row.filename + " —— 校验和不一致，违反「已合入迁移不可变」");
    }
  }
  for (let i = 0; i < appliedRows.length; i += 1) {
    if (appliedRows[i].filename !== files[i].name) {
      throw new Error(
        "迁移顺序非法：第 " + (i + 1) + " 个应为 " + appliedRows[i].filename + "，目录中却是 " + files[i].name + " —— 只允许在末尾追加"
      );
    }
  }
}

async function applyOne(client, file) {
  const startedAt = Date.now();
  await client.query("begin");
  try {
    await client.query(file.sql);
    const elapsed = Date.now() - startedAt;
    await client.query(
      "insert into schema_migrations (filename, checksum, execution_ms) values ($1, $2, $3)",
      [file.name, file.checksum, elapsed]
    );
    await client.query("commit");
    return elapsed;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    const reason = error && error.message ? error.message : String(error);
    throw new Error("迁移失败并已回滚：" + file.name + " —— " + reason);
  }
}

async function main() {
  const files = await loadMigrations();
  console.log("migrate: 目标 " + describeTarget() + "，迁移目录 " + MIGRATIONS_DIR);
  if (files.length === 0) {
    console.log("migrate: 注意：migrations/ 目录为空");
  }

  const client = new Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    await ensureMetaTable(client);

    const applied = await client.query("select filename, checksum from schema_migrations order by filename");
    verifyNoDrift(applied.rows, files);

    const pending = files.slice(applied.rows.length);
    if (pending.length === 0) {
      console.log("migrate: 数据库已是最新（已执行 " + applied.rows.length + " 个迁移，无漂移）");
      return;
    }
    if (DRY_RUN) {
      console.log("migrate: dry-run，待执行 " + pending.length + " 个：");
      for (const file of pending) console.log("  - " + file.name);
      return;
    }
    for (const file of pending) {
      const elapsed = await applyOne(client, file);
      console.log("migrate: 已执行 " + file.name + "（" + elapsed + " ms）");
    }
    console.log("migrate: 完成，本次执行 " + pending.length + " 个迁移");
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error("migrate: " + (error && error.message ? error.message : String(error)));
  process.exitCode = 1;
});
