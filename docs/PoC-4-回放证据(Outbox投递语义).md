# PoC-4 回放证据（Outbox 投递语义：杀 worker 不丢 / 重复领取不重发 / 重试与死信告警）

> 卡片：i6 · S7·PoC-4（主责 lan，评审 wmj 或 px）｜验收口径见 团队分工.md §6 第 4 行：杀 worker 不丢消息、重复领取不重发、重试与死信告警演示。所属模块：S7·outbox（S7-1 运行时 + S7-2 证据）。
> `docs/` 属 px 线：本文件由 lan 随 S7-2（Push 176）代记，**请 px 复核**（先例：M2-06 / M6 证据文件）。

| 项 | 值 |
|---|---|
| 回放时间 | 2026-09-28 13:42:25 +08:00（本地沙箱预跑） |
| 环境 | 本地沙箱（Windows · Docker `postgres:18` · `127.0.0.1:55432`） |
| 数据库 | postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink（已迁移至 0038） |
| 代码版本 | `lan` 分支工作区（实现提交 `07e459a`）；CI 复跑见下节（run `36383649213` · 头 `cf7154f`） |
| 脚本 | server/scripts/poc4-outbox-replay.mjs |
| 运行时 | `server/dist` 真代码：`OutboxStore.claim` / `OutboxDispatcher.drainOnce` / `OutboxAlertProbe.probeOnce` / `appendOutbox(IfAbsent)` |
| 口径 | OUTBOX_STALE_MS=60000（env 下限）· 退避 1000ms 起 / 2000ms 封顶 · maxAttempts=3 · 告警阈值 backlog=1 / oldest=60s / deadRecent>=1 |

## 断言明细（本地沙箱逐行转写）

| 结果 | 编号 | 断言 | 期望 | 实际 |
|---|---|---|---|---|
| PASS | P0 | 基线：本脚本话题前缀无存量行（回放自清理） | 0 行 | 0 行 |
| PASS | A1 | 投递落库：appendOutbox 写 pending（提交后可见、可领取） | status=pending / attempts=0 / locked_at=null | id=4608 / status=pending / attempts=0 / locked_by=null / locked_at=null / last_error=null |
| PASS | A2 | 杀 worker 不丢：子进程真领取后被 SIGKILL —— 行留 processing 且可查（locked_by / locked_at 留痕） | signal=SIGKILL；status=processing / locked_by=poc4-crashed-worker / locked_at 非空 / attempts=0 | child pid=27812 code=null signal=SIGKILL / claimed.id=4608 / status=processing / attempts=0 / locked_by=poc4-crashed-worker / locked_at=非空 / last_error=null |
| PASS | A3 | 崩溃窗口内（locked_at 未超 OUTBOX_STALE_MS）第二 worker 领取 0 条 —— 不重复投递 | claimed=0 / done=0 / handler 调用 0 | stats={"claimed":0,"done":0,"retried":0,"dead":0} / handler=0 |
| PASS | A4 | 超窗重领（回拨 locked_at 到 stale 之外 = 崩溃已超阈值）：真 dispatcher 重领并恰好消费一次 | claimed=1 / done=1 / handler=1（dedupeKey 一致）/ 行 done / locked_by=poc4-main | stats={"claimed":1,"done":1,"retried":0,"dead":0} / handler=1 / status=done / attempts=0 / locked_by=poc4-main / locked_at=null |
| PASS | A5 | done 后不再投递 + 同 dedupeKey 复投不重开：行数仍 1 / 仍 done / 消费恒 1 次 | 两轮 drain claimed=0 / 行数=1 / status=done / handler=1 | claimed=[0,0] / 行数=1 / status=done / locked_by=poc4-main / handler=1 |
| PASS | A6 | 去重键：同 dedupeKey 重复投递只落 1 行（onConflict 幂等）、只消费 1 次 | 行数=1 / claimed=1 / handler=1 / status=done | 行数=1 / stats={"claimed":1,"done":1,"retried":0,"dead":0} / status=done / handler=1 |
| PASS | B1 | 可重试失败：attempts 累计 + 按主题策略退避（第 1 次 = base 1000ms）回 pending | retried=1 / status=pending / attempts=1 / last_error=记录 / 剩余退避∈[850,1600]ms / locked_at=null | stats={"claimed":1,"done":0,"retried":1,"dead":0} / status=pending / attempts=1 / locked_at=null / last_error=poc4 通道抖动（可重试） / 剩余退避=994ms |
| PASS | B2 | 退避到期重领 → 第 2 次成功 done（attempts 留痕保留，不抹历史） | done=1 / status=done / attempts=1 / last_error=null / handler=2 | stats={"claimed":1,"done":1,"retried":0,"dead":0} / status=done / attempts=1 / last_error=null / handler=2 |
| PASS | B3 | 重试到顶（3/3）转 dead：onDead 留痕 + 单条死信即时告警（detail 口径） | 轮次 retried=1,retried=1,dead=1 / status=dead / attempts=3 / handler=3 / onDead=1 / outbox.dead 1 条（attempts=3 maxAttempts=3） | stats=[{retried:1},{retried:1},{dead:1}] / status=dead / attempts=3 / locked_by=poc4-main / last_error=poc4 上游持续不可用（重试到顶） / handler=3 / onDead=1 / 告警=[{"code":"outbox.dead","level":"error","detail":{"topic":"poc4.replay.dead","id":4613,"dedupeKey":"poc4-4694b6b8-dead","attempts":3,"maxAttempts":3}}] |
| PASS | C1 | 告警探针（阈值内）：backlog / oldest_due / dead_letter 三码齐发（真快照 + 真阈值判定） | 三码齐发；backlog.detail.duePending>=2；oldest_due.detail.oldestDueMs>=119000；dead_letter 命中 | codes=["outbox.backlog","outbox.dead_letter","outbox.oldest_due"] / backlog detail duePending=2（byTopic 命中 poc4.replay.backlog due=2）/ oldest due 120001ms / dead_letter 命中 |
| PASS | C2 | 同一份快照、宽阈值对照：0 告警（探针语义 = 阈值判定，不是恒告警噪声） | 0 条 | 0 条 [] |
| PASS | C3 | 演示记录入库：本脚本全部状态迁移在 outbox_events 可查（三态计数） | pending=2 / processing=0 / done=3 / dead=1 | {"dead":1,"done":3,"pending":2} |
| CLEANUP | — | 清除本脚本 outbox 行 6 条（前缀 poc4.replay.） | — | 6 条 |

## 三条验收对照（团队分工.md §6 第 4 行 → 断言）

- 「杀 worker 不丢消息」= A1 ~ A4：真实子进程执行真领取语句（`OutboxStore.claim`）后被 `SIGKILL` —— 行留在 `processing`（`locked_by` / `locked_at` 留痕、可查）；崩溃窗口内第二 worker 领取 0 条（不重复投递）；把 `locked_at` 回拨到 `OUTBOX_STALE_MS` 之外（等价于「崩溃已超阈值」；CI 不等满 10 分钟）→ 真 `OutboxDispatcher` 重领并**恰好消费一次**（`done`，`locked_by` 更新为第二 worker）。
- 「重复领取不重发」= A3 / A5 / A6：窗口内不重投；`done` 后不再被领取；同 `dedupeKey` 复投（`appendOutboxIfAbsent`）不新增行、不重开 `pending`、消费恒 1 次。
- 「重试与死信告警演示」= B1 ~ B3 / C1 ~ C3：可重试失败按策略退避回 `pending`（attempts 累计 + `available_at = now + base*2^(n-1)`，第 1 次实测 994ms）；到顶转 `dead` + `onDead` 留痕 + `OUTBOX_ALERT_SINK` 捕获单条 `outbox.dead` 即时告警；告警探针真快照三码齐发（backlog / oldest_due / dead_letter），宽阈值对照 0 告警；全部状态迁移在 `outbox_events` 可查（C3）。

## CI 复跑（`database` job）

- run：[36383649213](https://github.com/256-code/LibiaoLink/actions/runs/36383649213) · database job `108804391107`（头 `cf7154f`，2026-09-28 13:51 +08:00 起）；同 run 的 frontend / server / shared 三 job 全绿。
- 结果：**PoC-4 12/12 PASS**（日志末行「PoC-4 全部断言通过」）。

| 断言 | 本地沙箱（预跑） | CI（真机） |
|---|---|---|
| A1 投递落库（id 为自增序，不入断言） | id=4608 | id=28 |
| A2 子进程真领取后被 SIGKILL | child pid=27812 · signal=SIGKILL · 行留 processing | child pid=3619 · signal=SIGKILL · claimed.id=28 · 行留 processing（`locked_by=poc4-crashed-worker`） |
| B1 退避（第 1 次 ≈ base 1000ms） | 剩余退避=994ms | 剩余退避=997ms |
| B3 3/3 转 dead 的即时告警（detail 口径） | id=4613 / attempts=3 / maxAttempts=3 | id=33 / attempts=3 / maxAttempts=3 |
| C1 探针三码齐发（backlog / oldest_due / dead_letter） | oldest due 120001ms · backlog duePending=2 | oldest due 120000.829ms · backlog duePending=2 |
| CLEANUP（前缀 `poc4.replay.`） | 6 条 | 6 条 |

其余断言（P0 / A3~A6 / B2 / C2 / C3）CI 同判 PASS，口径与本地一致：窗口内重领 0 条 · done 后不重投 · 同 `dedupeKey` 幂等 · 宽阈值 0 告警 · 三态计数 `{"dead":1,"done":3,"pending":2}`。CI 与本地差异均为自增 id / 毫秒级计时抖动，不改变断言结论。

## 复跑

```bash
cd server && POC4_DATABASE_URL=postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink \
  node --env-file-if-exists=.env scripts/poc4-outbox-replay.mjs [--out ../docs/PoC-4-回放证据(Outbox投递语义).md] [--keep]
```

退出码 0 = 断言全过（可当门禁）；`--keep` 保留回放行（默认自清理）。
