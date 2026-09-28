-- LibiaoLink · 0040 通知投递面：notifications（站内信收件箱 / 合并留档）+ notify_prefs（免打扰 / 每日上限 / 合并窗口）
--   （S7·outbox · S7-4 · j1 / M5-04 首刀 · lan）
-- 口径来源：系统功能书 C5-01（收件箱：未读 / 已读 / 已处理）、C5-02（分类与筛选）、C5-03（全量留档）、
--   C2-08（投递保障：幂等去重 / 失败重试 / 错过补发 / 死信告警）、C2-09（同期消息合并推送 / 免打扰时段静默次日补发 /
--   每人每日上限）；技术设计v0.2-架构与数据模型.md §6.2「合并与免打扰」与 §11.1 新增表（notifications / notify_prefs）、
--   技术设计v0.3-实施与验收.md §3.6 新增表清单；ADR-005（Outbox 至少一次投递 + dedupe_key 幂等）、ADR-028（固定 Asia/Shanghai）。
-- 口径：
--   1. notifications 一行 = 一条投递事件（outbox 主题 notify.message 的消费结果）；`source_dedupe_key` 唯一 ——
--      消费重放（worker 崩溃超领取窗重领 / 人工重放）不重复落行，是「至少一次投递」配对的消费侧幂等兜底。
--   2. 合并（C2-09「同人同时段消息合并」）：同收件人 + 同 `merge_key`、合并窗口内、未读且未合并的主行命中 ——
--      新行以 `merged_into_id` 指向主行留档（全量留档 C5-03：被合并消息不丢弃），主行 `merged_count` 自增；
--      收件箱读面只返回 `merged_into_id is null` 的主行，合并子行仅库内留档。
--   3. 投递延迟（免打扰次日补发 / 每日上限溢出）：`deliver_at` = 计划投递时刻、`delivered_at` = 实际投递时刻；
--      `merged_into_id is null and delivered_at is null` 的行由 worker flush 循环按 `deliver_at` 到期重排。
--      **不走 outbox 重试** —— 重试语义是「消费失败退避」，延迟投递是「投递窗口静默」，两者不可混用。
--   4. 每人每日上限按 Asia/Shanghai 业务日统计**已投递主行**（`delivered_at` 落在当日窗口内、`merged_into_id is null`）。
--   5. notify_prefs 一人一行（user_id 主键）；可空列 = 继承 env 缺省（NOTIFY_DAILY_LIMIT / NOTIFY_MERGE_WINDOW_MS）；
--      免打扰为三态单列 `quiet_hours`：null = 继承缺省（env NOTIFY_QUIET_HOURS）/ '' = 关闭 / 'HH:MM-HH:MM' 自定义
--      （跨零点允许，from <> to）—— 与 env 同一套写法，避免「显式关闭」与「未设置」被 NULL 吞掉。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新表权限由 roles/0001 的 default privileges 自动授予。
-- 回滚（如需）：
--   drop table if exists notifications;
--   drop table if exists notify_prefs;

create table notifications (
  id bigserial primary key,
  recipient_id uuid not null references users (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  status text not null default 'unread',
  ref_type text,
  ref_id uuid,
  source_topic text not null,
  source_dedupe_key text not null,
  template_code text,
  merge_key text not null,
  merged_count integer not null default 1,
  merged_into_id bigint references notifications (id) on delete cascade,
  deliver_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_notifications_type check (type in ('reminder', 'approval', 'broadcast', 'system')),
  constraint ck_notifications_status check (status in ('unread', 'read', 'handled')),
  constraint ck_notifications_title check (char_length(btrim(title)) between 1 and 200),
  constraint ck_notifications_body check (char_length(btrim(body)) between 1 and 4000),
  constraint ck_notifications_ref check ((ref_type is null) = (ref_id is null)),
  constraint ck_notifications_merged_count check (merged_count >= 1),
  constraint ck_notifications_merged_into check (merged_into_id is null or merged_into_id <> id),
  constraint ck_notifications_delivery check (merged_into_id is null or delivered_at is null)
);

create unique index uq_notifications_source_dedupe_key on notifications (source_dedupe_key);
create index ix_notifications_inbox on notifications (recipient_id, id desc) where merged_into_id is null;
create index ix_notifications_unread on notifications (recipient_id)
  where merged_into_id is null and status = 'unread';
create index ix_notifications_due on notifications (deliver_at)
  where merged_into_id is null and delivered_at is null;
create index ix_notifications_merge on notifications (recipient_id, merge_key, created_at desc)
  where merged_into_id is null;
create index ix_notifications_daily on notifications (recipient_id, delivered_at)
  where merged_into_id is null and delivered_at is not null;

create table notify_prefs (
  user_id uuid primary key references users (id) on delete cascade,
  quiet_hours text,
  daily_limit integer,
  merge_window_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_notify_prefs_quiet check (
    quiet_hours is null
    or quiet_hours = ''
    or (
      quiet_hours ~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$'
      and split_part(quiet_hours, '-', 1) <> split_part(quiet_hours, '-', 2)
    )
  ),
  constraint ck_notify_prefs_daily_limit check (daily_limit is null or (daily_limit >= 0 and daily_limit <= 1000)),
  constraint ck_notify_prefs_merge_window check (
    merge_window_ms is null or (merge_window_ms >= 0 and merge_window_ms <= 86400000)
  )
);
