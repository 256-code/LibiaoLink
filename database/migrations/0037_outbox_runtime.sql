-- LibiaoLink · 0037 outbox 运行时支撑：locked_by（领取者标识）+ updated_at（状态迁移时刻）（S7·outbox · S7-1 · lan）
-- 口径来源：技术设计v0.2-架构与数据模型.md §1.3（Outbox 至少一次投递 + dedupe_key 幂等）、ADR-005（领取 / 重试 / 死信告警 /
--   积压与最老消息年龄观测）、卡片 i5（S7·outbox：去重键 / SKIP LOCKED）；S7-1 切片只补运行时列，不动领取语义。
-- 口径：
--   1. 为什么要 locked_by：0028 只有 locked_at（领取时刻）—— 出问题时看不出「是谁领走的」；多 worker / 多实例排障与
--      PoC-5（50 并发领取）报告需要领取者身份（workerId = WORKER_ID 或 host:pid，入口侧解析）。
--   2. 为什么要 updated_at：死信告警要回答「最近新增了多少死信」—— dead 行的 created_at 是入队时刻，无法区分
--      「刚死」与「一个月前死的」；同时 markDone / markRetry / markDead 的状态迁移时刻可查。
--   3. 两列口径：locked_by 只在 processing 时有值（回 pending / done / dead 时保留最后一次领取者，便于排障）；
--      updated_at 由 OutboxStore 显式回写（不用触发器，保持状态迁移一处可见）；存量行回填为迁移时刻（近似值）。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL 权限（DDL 由迁移器角色 libiaolink_migrator 执行）。
-- 回滚（如需）：
--   alter table outbox_events drop column if exists updated_at;
--   alter table outbox_events drop column if exists locked_by;

alter table outbox_events add column locked_by text;
alter table outbox_events add column updated_at timestamptz not null default now();
