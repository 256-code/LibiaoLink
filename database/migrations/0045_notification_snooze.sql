-- LibiaoLink · 0045 稍后提醒（C5-05 · S8-3 / M5-04-2）（Push 212 · lan）
-- 口径来源：系统功能书 C5-05（稍后提醒：设置与触发记录可查）、C5-01（三态 unread / read / handled）；
--   docs/契约切片草案(S8-3-M5-04-SSE与稍后提醒).md §二-2 / §三-6（定案：① 重投原行（不生成新消息）；
--   ② 设置即置读；③ 重复设置 = 覆盖（旧记录标 cancelled_at + 新记录）；④ handled 行照提醒；
--   ⑤ 到点落免打扰时段顺延到时段结束、不消耗每日上限）；shared/src/modules/notifications.ts
--   （NotificationSnoozeBody / NotificationSnoozeRecord / NotificationSnoozeListResponse · Push 210）。
-- 变更（只加不改）：
--   1. notifications 增 snooze_until timestamptz（可空）—— 当前未触发的稍后提醒时刻；
--      null = 未设置 / 已触发 / 已取消（触发不改写 delivered_at —— 首投时刻留档，重提醒时刻见记录）。
--      条件索引 ix_notifications_snooze 供 worker 到点扫描（主行且未触发）。
--   2. 新表 notification_snoozes：一次设置一条（set_at / snooze_until；触发回填 triggered_at、
--      取消（含覆盖）回填 cancelled_at）；触发与取消互斥（CHECK）；删通知行级联清记录。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新列随表级 GRANT、新表随 roles/0001 default privileges 生效。
-- 回滚（如需）：
--   drop table if exists notification_snoozes;
--   drop index if exists ix_notifications_snooze;
--   alter table notifications drop column snooze_until;

alter table notifications add column snooze_until timestamptz;

create index ix_notifications_snooze on notifications (snooze_until)
  where merged_into_id is null and snooze_until is not null;

create table notification_snoozes (
  id bigserial primary key,
  notification_id bigint not null references notifications (id) on delete cascade,
  set_at timestamptz not null default now(),
  snooze_until timestamptz not null,
  triggered_at timestamptz,
  cancelled_at timestamptz,
  constraint ck_notification_snoozes_exclusive check (triggered_at is null or cancelled_at is null)
);

create index ix_notification_snoozes_notification on notification_snoozes (notification_id, id desc);
