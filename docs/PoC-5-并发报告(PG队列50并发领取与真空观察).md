# PoC-5 并发报告（PG 队列 50 并发领取：无重复 / 无死锁 + 表膨胀与 vacuum 观察）

> 卡片：i7 · S7·PoC-5（主责 lan，评审 wmj 或 px）｜验收口径见 团队分工.md §6 第 5 行：50 并发领取无重复无死锁报告 + 表膨胀与 vacuum 观察。所属模块：S7·outbox（S7-1 运行时 + S7-2 证据）。
> `docs/` 属 px 线：本文件由 lan 随 S7-2（Push 176）代记，**请 px 复核**（先例：M2-06 / M6 证据文件）。

| 项 | 值 |
|---|---|
| 回放时间 | 2026-09-28 13:45:20 +08:00（本地沙箱预跑） |
| 环境 | 本地沙箱（Windows · Docker `postgres:18` · `127.0.0.1:55432` · `max_connections=100`） |
| 数据库 | postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink（已迁移至 0038） |
| 代码版本 | `lan` 分支工作区（实现提交 `07e459a`）；CI 复跑见下节（run `36383649213` · 头 `cf7154f`） |
| 脚本 | server/scripts/poc5-outbox-concurrency.mjs |
| 运行时 | `server/dist` 真代码：50 个并发 worker（各自独立连接池 + 真 `OutboxDispatcher.drainOnce`，workerId=`poc5-w01`…`poc5-w50`）× 500 行 × 批量 10 · `OUTBOX_STALE_MS=60000` |
| 口径 | 行来源 = 真 `appendOutbox` 写入；cleanup 自清理；VACUUM 需表 owner（迁移器角色） |

## 轮次明细（50 并发 drainOnce）

| 轮次 | claimed | done | 有产出 worker | 用时 ms | 错误 |
|---|---|---|---|---|---|
| 1 | 500 | 500 | 50 | 117 | 0 |

（单 worker 领取条数 min/中位/max = 10/10/10 —— 500 行在首轮被 50 个并发 worker 各领 10 行，分片干净、无争抢落空。）

## 断言明细（本地沙箱逐行转写）

| 结果 | 编号 | 断言 | 期望 | 实际 |
|---|---|---|---|---|
| PASS | P0 | 基线：本脚本话题无存量行（回放自清理） | 0 行 | 0 行 |
| PASS | C0 | 证据口径：并发 worker 数 = 50（卡面「50 并发领取」）、行数 ≥ worker×批量 | workers=50 / rows >= workers×batch | workers=50 / rows=500 / batch=10 |
| PASS | C1 | 造数：500 行 pending（真 appendOutbox 写入，全部可领取） | pending=500 | pending=500 |
| PASS | C2 | 领取语句执行计划：LockRows 节点（SKIP LOCKED 行级锁语义） | 计划含 LockRows | `LockRows (actual time=0.161..0.164 rows=10.00 loops=1)` + `Sort` + `Bitmap Heap Scan on outbox_events (rows=500)`（完整计划见下） |
| PASS | C3 | 首轮 50 并发领取：0 错误、0 重复，且真的并发争抢（≥ 半数行 + ≥ 20 个 worker 有产出） | errors=0 / duplicates=0 / claimed>=250 / workersWithRows>=20 | claimed=500 / workersWithRows=50 / errors=0 / duplicates=0 / 用时=117ms |
| PASS | C4 | 取尽口径：全部行恰好领取一次（无重复 / 无遗漏），全部 done | claims=500 / duplicates=0 / done=500 | claims=500 / duplicates=0 / 轮次=1 / 总用时=117ms |
| PASS | C5 | 领取者归属核对：每行 locked_by = 实际领取 worker（0038 列的多 worker 排障口径）、终态 done | 不匹配 0 行 | 核对 500 行 / 不匹配 0 行 |
| PASS | C6 | 终态不重发 + 无死锁：done 后再跑一轮 50 并发 —— claimed=0、投递数不变；deadlocks 增量=0 | claimed=0 / 投递总数=500 / deadlocks 增量=0 / workerErrors=0 | claimed=0 / 投递总数=500 / deadlocks=0→0 / workerErrors=0 |
| PASS | C7 | 连接观测：50 个并发 worker 各自持连接（峰后仍在库），不触 max_connections | 并发连接 >= 51 且留有 >= 5 余量 | max_connections=100 / 当前库连接=51 / 吞吐≈4273.5 行/s（500 行 / 117ms） |
| PASS | C8 | 表膨胀观察：churn（6 轮 × 500 行 × 2 次状态回写）后死元组可观察 | n_dead_tup >= 3000 | live=500 / dead=6000 / heap=909312B / total=1662976B（churn 前 dead=0） |
| PASS | C9 | VACUUM (ANALYZE)：死元组回落到接近 0（膨胀可回收） | dead <= max(10, churn 后 10%) 且 < churn 后 | churn 后 dead=6000 → vacuum 后 dead=0 / heap=909312B / total=1671168B |
| PASS | C10 | 空间复用观察：vacuum 后再插 500 行 —— 总体积增幅受控（<= 1MiB）且无新增死元组 | total 增幅 <= 1048576B / dead <= 10 | total=1671168B → 1671168B（增幅 0B） / dead=0 / live=1000 |
| CLEANUP | — | 清除本脚本 outbox 行 1000 条（500 首插 + 500 复用观察） | — | 1000 条 |

## 领取语句执行计划（EXPLAIN (ANALYZE, BUFFERS)，事务内回滚）

```text
Limit  (cost=12.47..12.48 rows=1 width=14) (actual time=0.162..0.166 rows=10.00 loops=1)
  Buffers: shared hit=27
  ->  LockRows  (cost=12.47..12.48 rows=1 width=14) (actual time=0.161..0.164 rows=10.00 loops=1)
        Buffers: shared hit=27
        ->  Sort  (cost=12.47..12.47 rows=1 width=14) (actual time=0.155..0.156 rows=10.00 loops=1)
              Sort Key: id
              Sort Method: quicksort  Memory: 40kB
              Buffers: shared hit=17
              ->  Bitmap Heap Scan on outbox_events  (cost=8.43..12.46 rows=1 width=14) (actual time=0.034..0.084 rows=500.00 loops=...)
                    Recheck Cond: (...)
                    Heap Blocks: ...
                    ->  Bitmap Index Scan on ix_outbox_ready  (...)
```

（`LockRows` = `FOR UPDATE SKIP LOCKED` 的行级锁节点；实际数据量下规划器走 `ix_outbox_ready (status, available_at)` 位图扫描 + 内存排序 —— 领取语句是**单条** `update … from (select … for update skip locked)`，见 `src/db/outbox.store.ts`。）

## 三条验收对照（团队分工.md §6 第 5 行 → 断言）

- 「50 并发领取无重复」= C3 ~ C5：50 个并发 worker（各独立连接池、各注册真 `OutboxDispatcher`）同轮领取 500 行 —— 逐行归属去重 **0 重复 / 0 遗漏**（500 行恰好各领一次），每行 `locked_by` 与领取 worker 逐一核对一致。
- 「无死锁」= C6：`pg_stat_database.deadlocks` 增量 0、worker 异常 0 条、领取错误 0 条；终态（全部 done）后再跑一轮 50 并发 `claimed=0`（不重发）。
- 「表膨胀与 vacuum 观察」= C8 ~ C10：6 轮状态回写 churn 后死元组 6000（可观察）→ `VACUUM (ANALYZE)` 后 dead=0（膨胀可回收）→ 再插 500 行总体积增幅 0B（空间可复用）。

## CI 复跑（`database` job）

- run：[36383649213](https://github.com/256-code/LibiaoLink/actions/runs/36383649213) · database job `108804391107`（头 `cf7154f`，2026-09-28 13:51 +08:00 起）；同 run 的 frontend / server / shared 三 job 全绿。
- 结果：**PoC-5 13/13 PASS**（日志末行「PoC-5 全部断言通过」）。

| 断言 | 本地沙箱（预跑） | CI（真机） |
|---|---|---|
| 首轮 50 并发（C3 / C4） | claimed=500 / 有产出 worker=50 / 用时 117ms / 0 重复 | claimed=500 / 有产出 worker=50 / 用时 261ms / 0 重复 / 轮次=1 |
| C2 领取语句计划 | `LockRows cost=12.47..12.48` | `LockRows cost=12.49..12.50` |
| C7 连接观测 | max_connections=100 / 当前库连接=51 / 吞吐≈4273.5 行/s | max_connections=100 / 当前库连接=53 / 吞吐≈1915.7 行/s |
| C8 churn 后死元组 | live=500 / dead=6000 / heap=909312B / total=1662976B（churn 前 dead=0） | live=503 / dead=6053 / heap=2375680B / total=2768896B（churn 前 dead=53） |
| C9 `VACUUM (ANALYZE)` 后 | dead=0 / heap=909312B / total=1671168B | dead=0 / heap=2195456B / total=2596864B |
| C10 再插 500 行复用 | 增幅 0B / live=1000 / dead=0 | 增幅 49152B（≤ 1MiB 宽口径内）/ live=1000 / dead=0 |
| CLEANUP（话题 `poc5.claim`） | 1000 条 | 1000 条 |

其余断言（P0 / C0 / C1 / C5 / C6）CI 同判 PASS：workers=50 / rows=500 / batch=10 · 造数 pending=500 · `locked_by` 500/500 核对 0 不匹配 · 终态重跑 claimed=0 且 `pg_stat_database.deadlocks` 0→0。

## 复跑

```bash
cd server && POC5_DATABASE_URL=postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink \
  node --env-file-if-exists=.env scripts/poc5-outbox-concurrency.mjs [--rows 500] [--workers 50] [--out <报告.md>] [--keep]
```

退出码 0 = 断言全过（可当门禁）；`--keep` 保留回放行（默认自清理）。
