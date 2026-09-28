#!/usr/bin/env node
/**
 * S7-2 · PoC-5 真机并发报告（i7 · 团队分工.md §6 第 5 行）：PG 队列 50 并发领取 —— 无重复 / 无死锁 + 表膨胀与 vacuum 观察。
 *
 *  证据一（50 并发领取）：500 行 pending，50 个并发 worker（各自独立连接池 + 真 OutboxDispatcher.drainOnce，
 *        workerId=poc5-w01…w50，批量 10）同时领取 —— 逐行归属去重：**无重复、无遗漏**（500 行恰好各领一次）；
 *        领取者 locked_by 与行归属逐一核对；一轮 50 并发无错误、无死锁（pg_stat_database.deadlocks 增量 = 0）。
 *  证据二（终态不重发）：全部 done 后再跑一轮 50 并发 —— claimed=0、投递数不变。
 *  证据三（表膨胀与 vacuum）：对 500 行做 6 轮状态回写 churn（等价「领取 → 回写」两态）→ 读 pg_stat_user_tables
 *        观察死元组膨胀 → VACUUM (ANALYZE) → 死元组回落、空间可复用（再插 500 行观察体积增幅）。
 *  并附：领取语句真实执行计划（EXPLAIN (ANALYZE, BUFFERS) 的 LockRows 节点）与并发连接数观测。
 *
 * 前置：真 PG（**表 owner / 迁移器角色** —— 需要 VACUUM）+ 已构建的 server/dist（cd server && npm run build）。
 * 用法：cd server && POC5_DATABASE_URL=postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink \
 *       node --env-file-if-exists=.env scripts/poc5-outbox-concurrency.mjs [--rows 500] [--workers 50] [--out <报告.md>] [--json <证据.json>] [--keep]
 * 退出码：断言全过 = 0，否则 = 1（可当门禁用）。
 * 说明：本机无 PG 时只做语法门禁；真机证据以 CI database job 为准（不伪造）。
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const DATABASE_URL =
  args.databaseUrl ?? process.env.POC5_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink";

/** 本回放话题（证据专用合成主题，不在契约白名单；不落生产代码）。 */
const TOPIC = "poc5.claim";
/** OUTBOX_STALE_MS 下限（60000）：并发轮次内绝无「超窗重领」，重复 = 真重复。 */
const STALE_MS = 60_000;
const WORKER_ID_PREFIX = "poc5-w";
const DEFAULTS = { rows: 500, workers: 50, batch: 10 };
const MAX_ROUNDS = 40;
const CHURN_ROUNDS = 6;

const report = [];
const evidence = { checks: [], rounds: [], stats: {} };
let failures = 0;
let assertionThrown = false;
let runtime;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") out.out = argv[++i];
    else if (item === "--json") out.json = argv[++i];
    else if (item === "--database-url") out.databaseUrl = argv[++i];
    else if (item === "--rows") out.rows = argv[++i];
    else if (item === "--workers") out.workers = argv[++i];
    else if (item === "--batch") out.batch = argv[++i];
    else if (item === "--keep") out.keep = true;
  }
  return out;
}

function note(line) {
  report.push(line);
  process.stdout.write(line + "\n");
}

function check(id, title, expected, actual, ok) {
  if (!ok) {
    failures += 1;
    assertionThrown = true;
  }
  note("| " + (ok ? "PASS" : "FAIL") + " | " + id + " | " + title + " | 期望：" + expected + " | 实际：" + actual + " |");
  evidence.checks.push({ id, title, expected, actual, ok });
  if (!ok) throw new Error("PoC-5 断言失败（" + id + "）：" + title);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function short(value, max = 320) {
  const text = JSON.stringify(value);
  return text === undefined ? "undefined" : text.length > max ? text.slice(0, max) + "..." : text;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
async function loadRuntime() {
  await import("reflect-metadata");
  const load = (rel) => import(pathToFileURL(join(HERE, "..", "dist", rel)).href);
  try {
    const [envModule, configModule, databaseModule, storeModule, dispatcherModule, clockModule, policyModule, outboxModule] =
      await Promise.all([
        load("config/env.js"),
        load("config/config.module.js"),
        load("db/database.service.js"),
        load("db/outbox.store.js"),
        load("outbox/dispatcher.js"),
        load("common/clock/clock.service.js"),
        load("outbox/policy.js"),
        load("db/outbox.js"),
      ]);
    return {
      loadEnv: envModule.loadEnv,
      AppConfig: configModule.AppConfig,
      DatabaseService: databaseModule.DatabaseService,
      OutboxStore: storeModule.OutboxStore,
      OutboxDispatcher: dispatcherModule.OutboxDispatcher,
      ClockService: clockModule.ClockService,
      defaultTopicPolicy: policyModule.defaultTopicPolicy,
      appendOutbox: outboxModule.appendOutbox,
    };
  } catch (error) {
    process.stderr.write("PoC-5：无法加载 server/dist（先执行 cd server && npm run build）：" + String(error) + "\n");
    process.exit(1);
  }
}

/** 每个并发 worker 的环境：WORKER_ID 各异（进 locked_by）；批量与卡面口径一致。 */
function buildEnv(overrides = {}) {
  return runtime.loadEnv({
    ...process.env,
    DATABASE_URL,
    PREVIEW_CONVERT_TIMEOUT_MS: "1000",
    OUTBOX_STALE_MS: String(STALE_MS),
    OUTBOX_BATCH_LIMIT: String(DEFAULTS.batch),
    ...overrides,
  });
}

async function runMain() {
  const rows = Number(args.rows ?? DEFAULTS.rows);
  const workersCount = Number(args.workers ?? DEFAULTS.workers);
  const batch = Number(args.batch ?? DEFAULTS.batch);
  const tag = randomBytes(4).toString("hex");
  const reinsertTag = "poc5-" + tag + "-reinsert-";

  const env = buildEnv({ WORKER_ID: "poc5-main" });
  const config = new runtime.AppConfig(env);
  const db = new runtime.DatabaseService(config);
  const noopSink = { emit() {} };

  const tableStats = async () => {
    try {
      await db.pool.query("select pg_stat_force_next_flush()");
    } catch {
      /* 统计落盘提示函数不可用时跳过（旧版 / 权限不足）；读数仍以 pg_stat_user_tables 为准 */
    }
    await sleep(80);
    const result = await db.pool.query(
      "select s.n_live_tup::int as live, s.n_dead_tup::int as dead, pg_relation_size('outbox_events')::bigint as heap_bytes, pg_total_relation_size('outbox_events')::bigint as total_bytes from pg_stat_user_tables s where s.relname = 'outbox_events'",
    );
    return result.rows[0];
  };
  const waitDeadTuples = async (minDead) => {
    let stats = await tableStats();
    for (let attempt = 0; attempt < 10 && stats.dead < minDead; attempt += 1) {
      await sleep(300);
      stats = await tableStats();
    }
    return stats;
  };

  const workerList = [];
  for (let index = 1; index <= workersCount; index += 1) {
    const workerId = WORKER_ID_PREFIX + String(index).padStart(2, "0");
    const workerEnv = buildEnv({ WORKER_ID: workerId });
    const workerConfig = new runtime.AppConfig(workerEnv);
    const service = new runtime.DatabaseService(workerConfig);
    const store = new runtime.OutboxStore(service);
    const delivered = [];
    const handler = {
      handle: async (row) => {
        delivered.push(String(row.id));
        return { outcome: "done" };
      },
    };
    const dispatcher = new runtime.OutboxDispatcher(
      store,
      new Map([[TOPIC, handler]]),
      new Map([[TOPIC, runtime.defaultTopicPolicy(workerEnv)]]),
      noopSink,
      workerConfig,
      new runtime.ClockService(),
    );
    workerList.push({ index, workerId, service, dispatcher, delivered, consumed: 0 });
  }

  let inserted = 0;
  let reinserted = 0;
  let maxConnections = 0;

  try {
    // ------------------------------------------------------------------ 基线 / 口径
    const baseline = await db.pool.query("select count(*)::int as n from outbox_events where topic = $1", [TOPIC]);
    check("P0", "基线：本脚本话题无存量行（回放自清理）", "0 行", baseline.rows[0].n + " 行", baseline.rows[0].n === 0);
    check(
      "C0",
      "证据口径：并发 worker 数 = 50（卡面「50 并发领取」）、行数 ≥ worker×批量",
      "workers=50 / rows >= workers×batch",
      "workers=" + workersCount + " / rows=" + rows + " / batch=" + batch,
      workersCount === 50 && rows >= workersCount * batch,
    );

    // ------------------------------------------------------------------ 造数（真 appendOutbox 路径）
    for (let n = 1; n <= rows; n += 1) {
      await runtime.appendOutbox(db.db, { topic: TOPIC, payload: { n, tag }, dedupeKey: "poc5-" + tag + "-" + n });
      inserted += 1;
    }
    const pendingRows = await db.pool.query("select count(*)::int as n from outbox_events where topic = $1 and status = 'pending'", [TOPIC]);
    check("C1", "造数：500 行 pending（真 appendOutbox 写入，全部可领取）", "pending=" + rows, "pending=" + pendingRows.rows[0].n, pendingRows.rows[0].n === rows);

    // ------------------------------------------------------------------ 计划证据（真领取语句形状；事务内回滚不留痕）
    const planClient = await db.pool.connect();
    let planLines = [];
    try {
      await planClient.query("begin");
      const plan = await planClient.query(
        "explain (analyze, buffers) select id from outbox_events where topic in ($1) and ((status = 'pending' and available_at <= now()) or (status = 'processing' and locked_at is not null and locked_at < now() - $2::int * interval '1 millisecond')) order by id limit $3 for update skip locked",
        [TOPIC, STALE_MS, batch],
      );
      planLines = plan.rows.map((row) => String(row["QUERY PLAN"]));
    } finally {
      await planClient.query("rollback");
      planClient.release();
    }
    evidence.stats.plan = planLines;
    check(
      "C2",
      "领取语句执行计划：LockRows 节点（SKIP LOCKED 行级锁语义）",
      "计划含 LockRows",
      short(planLines, 600),
      planLines.some((line) => line.includes("LockRows")),
    );

    maxConnections = (await db.pool.query("show max_connections")).rows[0].max_connections;
  } catch (error) {
    if (!assertionThrown) failures += 1;
    process.stderr.write("PoC-5 回放失败（前置段）：" + messageOf(error) + "\n");
  }
  try {
    // ------------------------------------------------------------------ 50 并发领取（多轮直到取尽；首轮为 50 并发主证据）
    const claims = new Map();
    const duplicates = [];
    const workerErrors = [];
    const roundsLog = [];
    note("| 轮次 | 并发 | claimed | done | 有产出 worker | 用时 ms | 备注 |");
    note("|---|---|---|---|---|---|---|");
    const startedAll = performance.now();
    for (let round = 1; round <= MAX_ROUNDS; round += 1) {
      const started = performance.now();
      const results = await Promise.all(
        workerList.map(async (worker) => {
          try {
            const stats = await worker.dispatcher.drainOnce();
            return { worker, stats, error: null };
          } catch (error) {
            return { worker, stats: null, error: messageOf(error) };
          }
        }),
      );
      const elapsedMs = Math.round(performance.now() - started);
      let claimedThisRound = 0;
      let doneThisRound = 0;
      let errorsThisRound = 0;
      let workersWithRows = 0;
      const perWorker = [];
      for (const result of results) {
        if (result.error !== null) {
          errorsThisRound += 1;
          workerErrors.push({ workerId: result.worker.workerId, error: result.error });
          continue;
        }
        claimedThisRound += result.stats.claimed;
        doneThisRound += result.stats.done;
        if (result.stats.claimed > 0) workersWithRows += 1;
        perWorker.push(result.stats.claimed);
      }
      for (const worker of workerList) {
        const fresh = worker.delivered.slice(worker.consumed);
        worker.consumed = worker.delivered.length;
        for (const id of fresh) {
          if (claims.has(id)) {
            duplicates.push({ id, workerId: worker.workerId });
          } else {
            claims.set(id, worker.workerId);
          }
        }
      }
      roundsLog.push({ round, claimed: claimedThisRound, done: doneThisRound, errors: errorsThisRound, workersWithRows, elapsedMs, perWorker });
      note(
        "| " + round + " | " + workersCount + " | " + claimedThisRound + " | " + doneThisRound + " | " + workersWithRows + " | " + elapsedMs + " | " + (errorsThisRound === 0 ? "0 错误" : errorsThisRound + " 错误") + " |",
      );
      if (errorsThisRound > 0 || claims.size >= rows || claimedThisRound === 0) break;
    }
    const totalMs = Math.round(performance.now() - startedAll);
    evidence.rounds = roundsLog;
    evidence.stats.claims = claims.size;
    evidence.stats.duplicates = duplicates.length;
    evidence.stats.workerErrors = workerErrors.length;

    const firstRound = roundsLog[0] ?? { claimed: 0, workersWithRows: 0, elapsedMs: 0, errors: 1, perWorker: [] };
    check(
      "C3",
      "首轮 50 并发领取：0 错误、0 重复，且真的并发争抢（≥ 半数行 + ≥ 20 个 worker 有产出）",
      "errors=0 / duplicates=0 / claimed>=" + Math.floor(rows / 2) + " / workersWithRows>=20",
      "claimed=" + firstRound.claimed + " / workersWithRows=" + firstRound.workersWithRows + " / errors=" + firstRound.errors + " / duplicates=" + duplicates.length + " / 用时=" + firstRound.elapsedMs + "ms",
      firstRound.errors === 0 && duplicates.length === 0 && firstRound.claimed >= Math.floor(rows / 2) && firstRound.workersWithRows >= 20,
    );

    check(
      "C4",
      "取尽口径：全部行恰好领取一次（无重复 / 无遗漏），全部 done",
      "claims=" + rows + " / duplicates=0 / done=" + rows,
      "claims=" + claims.size + " / duplicates=" + duplicates.length + " / 轮次=" + roundsLog.length + " / 总用时=" + totalMs + "ms",
      claims.size === rows && duplicates.length === 0 && roundsLog.every((item) => item.claimed === item.done),
    );

    const lockedByRows = await db.pool.query("select id::text as id, locked_by, status from outbox_events where topic = $1", [TOPIC]);
    const mismatches = [];
    for (const row of lockedByRows.rows) {
      if (claims.get(row.id) !== row.locked_by || row.status !== "done") {
        mismatches.push({ id: row.id, lockedBy: row.locked_by, expected: claims.get(row.id) ?? null, status: row.status });
      }
    }
    check(
      "C5",
      "领取者归属核对：每行 locked_by = 实际领取 worker（0038 列的多 worker 排障口径）、终态 done",
      "不匹配 0 行",
      "核对 " + lockedByRows.rows.length + " 行 / 不匹配 " + mismatches.length + " 行" + (mismatches.length === 0 ? "" : " " + short(mismatches, 240)),
      lockedByRows.rows.length === rows && mismatches.length === 0,
    );

    const deadlocksBefore = Number((await db.pool.query("select deadlocks from pg_stat_database where datname = current_database()")).rows[0].deadlocks);
    const finalWave = await Promise.all(workerList.map(async (worker) => worker.dispatcher.drainOnce().catch((error) => ({ error: messageOf(error) }))));
    const finalClaimed = finalWave.reduce((sum, item) => sum + (typeof item.claimed === "number" ? item.claimed : 0), 0);
    const deadlocksAfter = Number((await db.pool.query("select deadlocks from pg_stat_database where datname = current_database()")).rows[0].deadlocks);
    const deliveredTotal = workerList.reduce((sum, worker) => sum + worker.delivered.length, 0);
    evidence.stats.deadlocksBefore = deadlocksBefore;
    evidence.stats.deadlocksAfter = deadlocksAfter;
    check(
      "C6",
      "终态不重发 + 无死锁：done 后再跑一轮 50 并发 —— claimed=0、投递数不变；deadlocks 增量=0",
      "claimed=0 / 投递总数=" + rows + " / deadlocks 增量=0 / workerErrors=0",
      "claimed=" + finalClaimed + " / 投递总数=" + deliveredTotal + " / deadlocks=" + deadlocksBefore + "→" + deadlocksAfter + " / workerErrors=" + workerErrors.length,
      finalClaimed === 0 && deliveredTotal === rows && deadlocksAfter - deadlocksBefore === 0 && workerErrors.length === 0,
    );

    const connections = await db.pool.query("select count(*)::int as n from pg_stat_activity where datname = current_database()");
    check(
      "C7",
      "连接观测：50 个并发 worker 各自持连接（峰后仍在库），不触 max_connections",
      "并发连接 >= 51 且留有 >= 5 余量",
      "max_connections=" + maxConnections + " / 当前库连接=" + connections.rows[0].n + " / 吞吐≈" + ((rows / Math.max(totalMs, 1)) * 1000).toFixed(1) + " 行/s（" + rows + " 行 / " + totalMs + "ms）",
      connections.rows[0].n >= 51 && connections.rows[0].n <= maxConnections - 5,
    );

    // ------------------------------------------------------------------ 表膨胀与 vacuum 观察
    const statsBefore = await tableStats();
    for (let round = 1; round <= CHURN_ROUNDS; round += 1) {
      await db.pool.query("update outbox_events set status = 'processing', locked_at = now(), locked_by = 'poc5-churn', updated_at = now() where topic = $1 and status = 'done'", [TOPIC]);
      await db.pool.query("update outbox_events set status = 'done', locked_at = null, updated_at = now() where topic = $1 and status = 'processing' and locked_by = 'poc5-churn'", [TOPIC]);
    }
    const statsAfterChurn = await waitDeadTuples(CHURN_ROUNDS * rows);
    evidence.stats.churn = { before: statsBefore, afterChurn: statsAfterChurn };
    check(
      "C8",
      "表膨胀观察：churn（" + CHURN_ROUNDS + " 轮 × " + rows + " 行 × 2 次状态回写）后死元组可观察",
      "n_dead_tup >= " + CHURN_ROUNDS * rows,
      "live=" + statsAfterChurn.live + " / dead=" + statsAfterChurn.dead + " / heap=" + statsAfterChurn.heap_bytes + "B / total=" + statsAfterChurn.total_bytes + "B（churn 前 dead=" + statsBefore.dead + "）",
      statsAfterChurn.dead >= CHURN_ROUNDS * rows,
    );

    await db.pool.query("vacuum (analyze) outbox_events");
    const statsAfterVacuum = await tableStats();
    evidence.stats.vacuum = statsAfterVacuum;
    check(
      "C9",
      "VACUUM (ANALYZE)：死元组回落到接近 0（膨胀可回收）",
      "dead <= max(10, churn 后 10%) 且 < churn 后",
      "churn 后 dead=" + statsAfterChurn.dead + " → vacuum 后 dead=" + statsAfterVacuum.dead + " / heap=" + statsAfterVacuum.heap_bytes + "B / total=" + statsAfterVacuum.total_bytes + "B",
      statsAfterVacuum.dead <= Math.max(10, Math.floor(statsAfterChurn.dead * 0.1)) && statsAfterVacuum.dead < statsAfterChurn.dead,
    );

    for (let n = 1; n <= rows; n += 1) {
      await runtime.appendOutbox(db.db, { topic: TOPIC, payload: { n, tag, reinsert: true }, dedupeKey: reinsertTag + n });
      reinserted += 1;
    }
    const statsAfterReinsert = await tableStats();
    const growth = Number(statsAfterReinsert.total_bytes) - Number(statsAfterVacuum.total_bytes);
    evidence.stats.reinsert = statsAfterReinsert;
    check(
      "C10",
      "空间复用观察：vacuum 后再插 " + rows + " 行 —— 总体积增幅受控（<= 1MiB）且无新增死元组",
      "total 增幅 <= 1048576B / dead <= 10",
      "total=" + statsAfterVacuum.total_bytes + "B → " + statsAfterReinsert.total_bytes + "B（增幅 " + growth + "B） / dead=" + statsAfterReinsert.dead + " / live=" + statsAfterReinsert.live,
      growth <= 1024 * 1024 && statsAfterReinsert.dead <= 10,
    );
  } catch (error) {
    if (!assertionThrown) failures += 1;
    process.stderr.write("PoC-5 回放失败（并发段）：" + messageOf(error) + "\n");
  } finally {
    try {
      if (args.keep === true) {
        note("| KEEP | --keep：保留本脚本 outbox 行（topic=" + TOPIC + "） |");
      } else {
        const deleted = await db.pool.query("delete from outbox_events where topic = $1 and (dedupe_key like $2 or dedupe_key like $3)", [
          TOPIC,
          "poc5-" + tag + "-%",
          reinsertTag + "%",
        ]);
        note("| CLEANUP | 清除本脚本 outbox 行 " + deleted.rowCount + " 条（" + inserted + " 首插 + " + reinserted + " 复用观察） |");
      }
    } catch (error) {
      note("| WARN | 收尾未完全成功：" + messageOf(error) + " |");
    }
    for (const worker of workerList) {
      await worker.service.onApplicationShutdown().catch(() => {});
    }
    await db.onApplicationShutdown().catch(() => {});
  }
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd() }).toString().trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: process.cwd() }).toString().trim() !== "";
  const lines = [];
  lines.push("# S7-2 · PoC-5 并发报告（PG 队列 50 并发领取 + 表膨胀与 vacuum 观察）");
  lines.push("");
  lines.push("> 卡片：i7 · S7·PoC-5（主责 lan，评审 wmj 或 px）｜验收：50 并发领取无重复无死锁报告 + 表膨胀与 vacuum 观察（团队分工.md §6 第 5 行）。");
  lines.push("");
  lines.push("| 项 | 值 |");
  lines.push("|---|---|");
  lines.push("| 回放时间 | " + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ") + " +08:00 |");
  lines.push("| 数据库 | " + DATABASE_URL.replace(/:[^:@/]+@/, ":***") + " |");
  lines.push("| 代码版本 | " + commit + (dirty ? "（工作区含未提交改动）" : "") + " |");
  lines.push("| 脚本 | server/scripts/poc5-outbox-concurrency.mjs |");
  lines.push("| 口径 | " + workersCount + " 个并发 worker（各自独立连接池 + 真 OutboxDispatcher.drainOnce）× " + rows + " 行 × 批量 " + batch + " · OUTBOX_STALE_MS=" + STALE_MS + " |");
  lines.push("| 库参数 | max_connections=" + maxConnections + " |");
  lines.push("");
  lines.push("## 轮次明细（" + workersCount + " 并发 drainOnce）");
  lines.push("");
  lines.push("| 轮次 | claimed | done | 有产出 worker | 用时 ms | 错误 |");
  lines.push("|---|---|---|---|---|---|");
  for (const item of evidence.rounds) {
    lines.push("| " + item.round + " | " + item.claimed + " | " + item.done + " | " + item.workersWithRows + " | " + item.elapsedMs + " | " + item.errors + " |");
  }
  lines.push("");
  lines.push("## 并发报告汇总");
  lines.push("");
  const first = evidence.rounds[0] ?? { perWorker: [], elapsedMs: 0, claimed: 0, workersWithRows: 0 };
  const perWorkerFirst = first.perWorker ?? [];
  lines.push("- 首轮 50 并发领取：" + first.claimed + " 行 / 有产出 worker " + first.workersWithRows + " 个 / 用时 " + first.elapsedMs + "ms；单 worker 领取条数 min/中位/max = " + (perWorkerFirst.length === 0 ? "n/a" : Math.min(...perWorkerFirst) + "/" + median(perWorkerFirst) + "/" + Math.max(...perWorkerFirst)) + "。");
  lines.push("- 取尽：" + (evidence.stats.claims ?? 0) + " 行恰好各领一次（重复 " + (evidence.stats.duplicates ?? 0) + " / 遗漏 " + (rows - (evidence.stats.claims ?? 0)) + "）。");
  lines.push("- 死锁：pg_stat_database.deadlocks " + (evidence.stats.deadlocksBefore ?? "n/a") + " → " + (evidence.stats.deadlocksAfter ?? "n/a") + "（增量 0）；worker 异常 " + (evidence.stats.workerErrors ?? 0) + " 条。");
  lines.push("- 表膨胀：churn 后 dead=" + (evidence.stats.churn?.afterChurn?.dead ?? "n/a") + " → VACUUM (ANALYZE) 后 dead=" + (evidence.stats.vacuum?.dead ?? "n/a") + "；再插 " + rows + " 行总体积 " + (evidence.stats.vacuum?.total_bytes ?? "n/a") + "B → " + (evidence.stats.reinsert?.total_bytes ?? "n/a") + "B。");
  lines.push("");
  lines.push("## 领取语句执行计划（EXPLAIN (ANALYZE, BUFFERS)，事务内回滚）");
  lines.push("");
  lines.push("```");
  lines.push(...(evidence.stats.plan ?? []));
  lines.push("```");
  lines.push("");
  lines.push("## 断言明细");
  lines.push("");
  lines.push(...report);
  lines.push("");
  lines.push("## 复跑");
  lines.push("");
  lines.push("cd server && POC5_DATABASE_URL=postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink node --env-file-if-exists=.env scripts/poc5-outbox-concurrency.mjs [--rows 500] [--workers 50] [--out <报告.md>] [--keep]");
  lines.push("");
  if (args.json !== undefined) writeFileSync(args.json, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  if (args.out !== undefined) writeFileSync(args.out, lines.join("\n") + "\n", "utf8");
  process.stdout.write("\n" + lines.join("\n") + "\n");
  process.stdout.write("PoC-5 " + (failures === 0 ? "全部断言通过" : "失败 " + failures + " 项") + "\n");
  process.exit(failures === 0 ? 0 : 1);
}

runtime = await loadRuntime();
await runMain();