-- LibiaoLink · 0028 outbox 领取器支撑：`locked_at`（领取时刻）+ processing 部分索引（M4-05c 预览队列 · Push 168）
-- 口径来源：技术设计v0.2-架构与数据模型.md §1.3（Outbox 至少一次投递 + dedupe_key 消费幂等）、ADR-007（在线预览管道）、
--   Push 160 定案（outbox 领取器切片只落「领取 + 消费 + 重试 + dead」，不含规则 / 通知编排）。
-- 口径：
--   1. 为什么要这一列：worker 把 `pending` 领为 `processing` 时必须记下「领取时刻」—— 没有它，worker 崩溃 / 重启
--      会把行永久留在 `processing`（预览任务静默丢失，且没有任何痕迹可查）。
--   2. 领取语义：常规领取 = `status = 'pending' and available_at <= now()`；崩溃遗留重领 = `status = 'processing'`
--      且 `locked_at` 早于阈值（worker 侧默认 10 分钟）。两条都走 `for update skip locked`，同实例内不互相重叠。
--   3. 为什么是列而不是表 / 状态：一期 worker 单实例、单表领取，列 + 部分索引是最小改动；
--      与 `attempts` / `last_error` 同层留痕，排障时一眼能看出「谁在什么时候领走了它」。
--   4. 部分索引只覆盖 `processing` 行：常规领取走既有 `ix_outbox_ready (status, available_at)`；
--      本索引只服务「崩溃遗留重领」这一条窄路径（全表绝大多数行是 done，不必进索引）。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL 权限（DDL 由迁移器角色 libiaolink_migrator 执行）。
-- 回滚（如需）：
--   drop index if exists ix_outbox_processing;
--   alter table outbox_events drop column if exists locked_at;

alter table outbox_events add column locked_at timestamptz;
create index ix_outbox_processing on outbox_events (locked_at) where status = 'processing';
