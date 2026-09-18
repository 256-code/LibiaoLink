#!/usr/bin/env node
// Drizzle schema 与实际数据库的结构漂移检查（g4）：表 / 列（类型、可空）/ 索引 / CHECK 约束名。
// 依据：技术设计v0.2 §2.3 与 database/migrations（0001 + 0002…）。
// 只读目录信息（pg_catalog），不需要业务权限；应用角色 libiaolink_api 即可运行。
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

const here = dirname(fileURLToPath(import.meta.url));
const distSchema = join(here, "..", "dist", "db", "schema", "index.js");

let schemaModule;
try {
  schemaModule = await import(pathToFileURL(distSchema).href);
} catch (error) {
  console.error("check:db-schema: 无法加载 dist/db/schema（先执行 npm run build）：" + String(error));
  process.exit(1);
}

const normalizeType = (sqlType) => {
  const normalized = String(sqlType).toLowerCase().replace(/\s+/g, "");
  const aliases = { bigserial: "bigint", serial: "integer" };
  return aliases[normalized] ?? normalized;
};

const expected = new Map();
for (const value of Object.values(schemaModule)) {
  if (!is(value, PgTable)) continue;
  const config = getTableConfig(value);
  const columns = new Map();
  for (const column of config.columns) {
    columns.set(column.name, {
      type: normalizeType(column.getSQLType()),
      notNull: Boolean(column.notNull),
    });
  }
  const indexNames = new Set();
  for (const item of config.indexes ?? []) {
    if (item?.config?.name) indexNames.add(item.config.name);
  }
  for (const item of config.uniqueConstraints ?? []) {
    if (item?.name) indexNames.add(item.name);
  }
  if (config.columns.some((column) => column.primary)) indexNames.add(config.name + "_pkey");
  for (const item of config.primaryKeys ?? []) {
    const name = typeof item?.getName === "function" ? item.getName() : item?.name;
    if (name) indexNames.add(name);
  }
  const checkNames = new Set((config.checks ?? []).map((item) => item.name).filter(Boolean));
  expected.set(config.name, { columns, indexNames, checkNames });
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("check:db-schema: 缺少 DATABASE_URL（可用 --env-file-if-exists=.env 或环境变量提供）");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();

const tablesResult = await client.query(
  "select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1",
);
const actualTables = new Set(
  tablesResult.rows.map((row) => row.name).filter((name) => name !== "schema_migrations"),
);

const columnsResult = await client.query(
  "select c.relname as table_name, a.attname as column_name, a.attnotnull as not_null, format_type(a.atttypid, a.atttypmod) as data_type from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped order by c.relname, a.attnum",
);
const actualColumns = new Map();
for (const row of columnsResult.rows) {
  const table = actualColumns.get(row.table_name) ?? new Map();
  table.set(row.column_name, { type: normalizeType(row.data_type), notNull: Boolean(row.not_null) });
  actualColumns.set(row.table_name, table);
}

const indexResult = await client.query(
  "select tablename, indexname from pg_indexes where schemaname = 'public'",
);
const actualIndexes = new Map();
for (const row of indexResult.rows) {
  const set = actualIndexes.get(row.tablename) ?? new Set();
  set.add(row.indexname);
  actualIndexes.set(row.tablename, set);
}

const checkResult = await client.query(
  "select c.relname as table_name, con.conname as constraint_name from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = con.connamespace where con.contype = 'c' and n.nspname = 'public'",
);
const actualChecks = new Map();
for (const row of checkResult.rows) {
  const set = actualChecks.get(row.table_name) ?? new Set();
  set.add(row.constraint_name);
  actualChecks.set(row.table_name, set);
}

await client.end();

const problems = [];

for (const tableName of expected.keys()) {
  if (!actualTables.has(tableName)) problems.push("缺表：" + tableName);
}
for (const tableName of actualTables) {
  if (!expected.has(tableName)) problems.push("多表（未在 Drizzle schema 中）：" + tableName);
}

for (const [tableName, table] of expected) {
  const actual = actualColumns.get(tableName);
  if (!actual) continue;
  for (const [columnName, column] of table.columns) {
    const found = actual.get(columnName);
    if (!found) {
      problems.push("缺列：" + tableName + "." + columnName);
      continue;
    }
    if (found.type !== column.type) {
      problems.push("类型不一致：" + tableName + "." + columnName + "，Drizzle=" + column.type + "，数据库=" + found.type);
    }
    if (found.notNull !== column.notNull) {
      problems.push("可空性不一致：" + tableName + "." + columnName + "，Drizzle=" + (column.notNull ? "not null" : "null") + "，数据库=" + (found.notNull ? "not null" : "null"));
    }
  }
  for (const [columnName] of actual) {
    if (!table.columns.has(columnName)) problems.push("多列（未在 Drizzle schema 中）：" + tableName + "." + columnName);
  }

  const indexes = actualIndexes.get(tableName) ?? new Set();
  for (const name of table.indexNames) {
    if (!indexes.has(name)) problems.push("缺索引 / 唯一约束：" + tableName + "." + name);
  }
  for (const name of indexes) {
    if (!table.indexNames.has(name)) problems.push("多索引（未在 Drizzle schema 中）：" + tableName + "." + name);
  }

  const checks = actualChecks.get(tableName) ?? new Set();
  for (const name of table.checkNames) {
    if (!checks.has(name)) problems.push("缺 CHECK：" + tableName + "." + name);
  }
  for (const name of checks) {
    if (!table.checkNames.has(name)) problems.push("多 CHECK（未在 Drizzle schema 中）：" + tableName + "." + name);
  }
}

const columnCount = [...expected.values()].reduce((total, table) => total + table.columns.size, 0);
const indexCount = [...expected.values()].reduce((total, table) => total + table.indexNames.size, 0);
const checkCount = [...expected.values()].reduce((total, table) => total + table.checkNames.size, 0);

if (problems.length === 0) {
  console.log(
    "check:db-schema: 通过（" + expected.size + " 张表 · " + columnCount + " 列 · " + indexCount + " 索引/唯一 · " + checkCount + " CHECK 与 Drizzle schema 一致）",
  );
  process.exit(0);
}

console.error("check:db-schema: 发现 " + problems.length + " 处漂移：");
for (const problem of problems) console.error("  [x] " + problem);
process.exit(1);
