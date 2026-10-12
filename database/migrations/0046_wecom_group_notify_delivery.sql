-- LibiaoLink · 0046 项目群绑定 + 通知投递留痕 + 限速计数（M5-03-2 群通道迁移刀 · Push 222 · lan）
-- 口径来源：docs/M5-03-实施方案(企微通道).md §四 M5-03-2 / §五 5.3A（智能机器人 + chatid · P5 定案）/
--   §五 5.4（处置三分类）；PR #297（P1 定案）/ PR #309（P5 定案）评论；shared/src/modules/projects.ts
--   （ProjectGroupBinding / ProjectGroupPutBody · Push 221）、shared/src/modules/notifications.ts
--   （NotifyGroupMessagePayload · Push 221）；server/src/modules/notify/wecom.rate.ts 头注（DB 计数 SQL 形态）。
-- 变更（只加不改）：
--   1. wecom_groups —— 项目群绑定（P5 定案：智能机器人长连接 + chatid）：
--      · project_id 唯一（一个项目最多一个群）；chatid 唯一（一个群最多绑一个项目 —— 防重复播报；
--        换绑 = 先解绑再绑）；enabled = 绑定启用态（群失效 / 人工暂停时置 false，投递层跳过并留痕）；
--      · activated_at = 会话激活态（群内有人给机器人发过消息 —— 主动推送前置；未激活推送命中 846607
--        未激活分支：不重试 + 降级 B4 + 留痕）；换绑（chatid 变更）视为新会话、重置为 null；
--      · 审计两列 created_at / updated_at（无触发器，由应用写入 updated_at）。
--   2. notify_deliveries —— 外部渠道投递留痕（C2-07 投递保障 + C5-03 全量留档共用底座）：每次尝试一行；
--      state 口径 = 处置三分类映射：sent（API 受理成功）/ failed（retryable，将退避重试）/
--      deferred（rate_limited，延期重排、不消耗重试次数）/ dead（permanent 或重试到顶）；
--      error = 失败 / 延期描述（掩码后，不含凭据）；sent_at = 受理成功时刻；
--      outbox_id = 来源事件（outbox 行清理后置 null，留档不回删）。
--   3. notify_rate_counters —— 固定窗口限速计数（C2-10 按队列限速发送）：bucket 由调用方构造
--      （含渠道桶 id + 窗口长度，避免 1 分钟 / 1 小时两类窗口在同起点互污）；消费 = 单语句
--      `insert … on conflict (bucket, window_start) do update set count = count + 1 returning count`
--      （先增量后判定，跨进程并发安全）—— S8-1 草案未列本表，为先例 SQL 形态（wecom.rate.ts 头注）的落点；
--      过期窗口行由运维 / 后续清理作业按 updated_at 裁剪。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新表随 roles/0001 default privileges 自动授权。
-- 回滚（如需）：
--   drop table if exists notify_rate_counters;
--   drop table if exists notify_deliveries;
--   drop table if exists wecom_groups;

create table wecom_groups (
  id bigserial primary key,
  project_id uuid not null references projects (id) on delete cascade,
  chatid text not null,
  name text,
  enabled boolean not null default true,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_wecom_groups_chatid check (chatid ~ '^[A-Za-z0-9_-]{8,128}$'),
  constraint ck_wecom_groups_name check (name is null or char_length(btrim(name)) between 1 and 64)
);

create unique index uq_wecom_groups_project on wecom_groups (project_id);
create unique index uq_wecom_groups_chatid on wecom_groups (chatid);

create table notify_deliveries (
  id bigserial primary key,
  outbox_id bigint references outbox_events (id) on delete set null,
  channel text not null,
  target text not null,
  state text not null,
  attempts integer not null default 0,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ck_notify_deliveries_channel check (channel in ('wecom_app', 'wecom_group', 'email')),
  constraint ck_notify_deliveries_state check (state in ('sent', 'failed', 'deferred', 'dead')),
  constraint ck_notify_deliveries_attempts check (attempts >= 0),
  constraint ck_notify_deliveries_sent check ((state = 'sent') = (sent_at is not null)),
  constraint ck_notify_deliveries_error check ((state = 'sent') = (error is null))
);

create index ix_notify_deliveries_outbox on notify_deliveries (outbox_id, id desc);
create index ix_notify_deliveries_recent on notify_deliveries (channel, created_at desc);

create table notify_rate_counters (
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint notify_rate_counters_pkey primary key (bucket, window_start),
  constraint ck_notify_rate_counters_count check (count >= 0)
);

create index ix_notify_rate_counters_updated on notify_rate_counters (updated_at);
