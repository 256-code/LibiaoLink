-- LibiaoLink · 0022 tasks 软删（M3-05 · A25 任务删除：2026-09-22 业务定案「任务删除要做」）
-- 口径来源：系统功能书.md A1-01 修订段（Push 148）、前端功能需求.md §3.8 A25、技术设计v0.2 §2.3（tasks）。
--   1. tasks.deleted_at / deleted_by（照 0009 projects / 0019 stakeholders 口径）：软删，不物理删行；
--      列表 / 看板 / 甘特图 / 完成门禁 / 节点判重一律过滤 deleted_at is null（读面由应用层下推，见 task.repository.ts）。
--   2. 重复删除 / 已删任务上的任何写操作 = 统一 404（记录级 404 语义 · h6；不新增错误码，见技术设计v0.3 §3.4 M3-05）。
--   3. 节点约束：tasks 本无 (project_id, node_id) 唯一约束（判重在应用层 findTaskIdByNode），
--      软删后同节点自动回到「可添加」（A10 / A11 口径不变，无需改约束）。
--   4. 索引：ix_tasks_active_group —— 部分索引，只覆盖未删行；列表 / 看板顺序读（project_id, stage_key, sort_index）的主用索引。
--   5. 组内位次（A19 / A20）：删除后由应用层同事务压缩（后续位次整体 -1），保持「0 起、密集」不变式。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL 权限；索引随表级 GRANT 生效，无需额外授权。
-- 回滚（如需）：drop index if exists ix_tasks_active_group; alter table tasks drop column deleted_by, drop column deleted_at;
alter table tasks
  add column deleted_at timestamptz,
  add column deleted_by uuid references users (id);

create index ix_tasks_active_group on tasks (project_id, stage_key, sort_index) where deleted_at is null;
