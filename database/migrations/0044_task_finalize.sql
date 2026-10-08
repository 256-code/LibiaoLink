-- LibiaoLink · 0044 任务定档（Push 249 · 业务口径「添加和替换文件要提示是否为定档文件，若是则上传文件后该任务定档不支持任何修改」）
-- 口径来源：系统功能书 A2-10 / A4-05 / A4-13（定档锁版；定档后修改走变更）；前端功能需求 §6.3（任务表「文件」列添加 / 替换）。
-- 变更：
--   1. tasks 增任务定档时点 / 操作人两列（finalized_at / finalized_by；成对 CHECK：要么都空、要么都有）——
--      由「文件定档」服务路径同事务置位（定档某文件即定档其挂接任务，文件模块 finalizeFile）；置位后任务写口 / 文件直接写口一律 409 TASK_FINALIZED。
--   2. 存量行不动：既有任务自然处于「未定档」（两列皆空）。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；不改权限，新列随表级 GRANT 生效。
-- 回滚（如需）：alter table tasks drop constraint ck_tasks_finalized_pair, drop column finalized_by, drop column finalized_at;
alter table tasks
  add column finalized_at timestamptz,
  add column finalized_by uuid references users (id);

alter table tasks add constraint ck_tasks_finalized_pair check ((finalized_at is null) = (finalized_by is null));
