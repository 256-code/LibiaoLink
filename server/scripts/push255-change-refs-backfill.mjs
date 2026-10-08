#!/usr/bin/env node
/**
 * Push 255 存量回填（一次性修复工具 · 幂等可重跑）：把「变更文件挂了任务、但任务 change_refs 没记到该变更」的历史行补齐。
 *
 * 背景（业务反馈 2026-10-08「同时相关的关联也没有显示啊」）：此前变更只走 R01（变更文件成果类型 ∈ 任务输出成果文件），
 * 而前端上传口不带成果类型（doc_type 为空）→ 匹配零条 → 变更关联一直空；写口已随 Push 255 改为
 * 「变更文件所属任务 ∪ R01 命中」并集回写（server/src/modules/file/file.service.ts · finishChangeInTx），本脚本按同口径回填存量。
 *
 * 用法：cd server && node --env-file-if-exists=.env scripts/push255-change-refs-backfill.mjs [--dry-run] [--database-url <url>]
 *   --dry-run 只打印将回写的 (task_id, change_id) 对，不写库。
 * 退出码：0 = 执行完成（含无可回填）；1 = 出错。
 */
import { Client } from "pg";

const args = parseArgs(process.argv.slice(2));
const DATABASE_URL = args.databaseUrl ?? process.env.DATABASE_URL ?? "postgresql://libiaolink_migrator@127.0.0.1:5433/libiaolink";

function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--dry-run") out.dryRun = true;
    else if (item === "--database-url") out.databaseUrl = argv[++i];
  }
  return out;
}

/** 待回填对（与 finishChangeInTx 同口径）：① 变更文件所属任务；② R01 成果类型命中任务 —— 并集去重。 */
const PAIRS_SQL = [
  "select distinct f.task_id as task_id, cr.id as change_id, cr.applied_at",
  "from change_requests cr",
  "join file_versions fv on fv.change_request_id = cr.id",
  "join files f on f.id = fv.file_id",
  "where f.task_id is not null",
  "union",
  "select distinct t2.id as task_id, cr.id as change_id, cr.applied_at",
  "from change_requests cr",
  "join file_versions fv on fv.change_request_id = cr.id",
  "join files f on f.id = fv.file_id",
  "join tasks t2 on t2.project_id = f.project_id and f.doc_type is not null and f.doc_type = any(t2.deliverable_types)",
  "order by applied_at",
].join("\n");

const ORPHAN_SQL = [
  "select count(*)::int as c from (",
  "  select f.task_id, cr.id from change_requests cr",
  "  join file_versions fv on fv.change_request_id = cr.id",
  "  join files f on f.id = fv.file_id",
  "  join tasks t on t.id = f.task_id",
  "  where f.task_id is not null and not (cr.id = any(t.change_refs))",
  "  union",
  "  select t2.id, cr.id from change_requests cr",
  "  join file_versions fv on fv.change_request_id = cr.id",
  "  join files f on f.id = fv.file_id",
  "  join tasks t2 on t2.project_id = f.project_id and f.doc_type is not null and f.doc_type = any(t2.deliverable_types)",
  "  where not (cr.id = any(t2.change_refs))",
  ") s",
].join("\n");

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  const orphansBefore = (await client.query(ORPHAN_SQL)).rows[0].c;
  const pairs = (await client.query(PAIRS_SQL)).rows;
  console.log("待核对 (task, change) 对：" + String(pairs.length) + "；回填前缺失关联数：" + String(orphansBefore));
  let updated = 0;
  for (const row of pairs) {
    if (args.dryRun) {
      console.log("[dry-run] task=" + row.task_id + " <- change=" + row.change_id);
      continue;
    }
    const result = await client.query(
      "update tasks set change_refs = array_append(change_refs, $2::uuid) where id = $1 and not ($2::uuid = any(change_refs))",
      [row.task_id, row.change_id],
    );
    if (result.rowCount === 1) {
      updated += 1;
      console.log("回填：task=" + row.task_id + " <- change=" + row.change_id);
    }
  }
  const orphansAfter = (await client.query(ORPHAN_SQL)).rows[0].c;
  console.log((args.dryRun ? "[dry-run] " : "") + "回写 " + String(updated) + " 条；剩余缺失关联数：" + String(orphansAfter));
  if (!args.dryRun && orphansAfter !== 0) {
    console.error("仍有缺失关联，请检查（脚本应幂等收敛到 0）。");
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
