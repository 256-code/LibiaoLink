-- LibiaoLink · 0034 tasks 节点库来源（M3-07 刀 3 前半 · A1-16 / A11 模板实例化：2026-09-24）
-- 起因：「项目总览 → 添加任务」的节点 / 模板添加此前只能按「同阶段同名」折算判重（前端内存态），任务侧没有「节点库来源」
--   字段；模板实例化 POST /api/v1/projects/{id}/tasks/from-template（契约 Push 62 已入 paths）需要「这个节点在这个项目里加过没有」的落点。
-- 口径（本刀定，请 wmj 复核）：
--   1. tasks.task_node_id = 来源**任务节点库**节点（task_nodes）id；与 tasks.node_id（**项目流程节点** project_nodes）并行、
--      互不替代 —— 节点库节点回答「任务从哪来」（A1-16），流程节点是蓝图实例（A1-17 锁定字段 / 完成门禁依据）。
--   2. 判重 = 同一项目内同一节点库节点只留一份（部分唯一索引，只约束未删行）：重复添加 409 TASK_ALREADY_EXISTS；
--      软删（deleted_at 置位）后该节点回到「可添加」，与 tasks.node_id 的既有口径一致（照 0022 第 3 条）。
--   3. 节点库删除 = 物理删行（0032）；本列 on delete set null —— 节点被删后已生成的任务保留、只丢来源关联
--      （系统功能书 A1-16「删除节点不影响已生成的项目任务」）。
--   4. 手工创建 / 流程节点生成的任务该列为 null；存量数据不回溯（前端「已添加」对旧行仍按同阶段同名兜底）。
-- 只追加迁移，必须由 libiaolink_migrator 执行（应用角色 libiaolink_api 无 DDL）；索引随表级 GRANT 生效，无需额外授权。
-- 回滚（如需）：drop index if exists uq_tasks_active_source_node; alter table tasks drop column task_node_id;
alter table tasks add column task_node_id uuid references task_nodes (id) on delete set null;

comment on column tasks.task_node_id is '来源任务节点库节点（task_nodes）id；null = 非节点库来源（手工创建 / 流程节点任务）；节点物理删除时置空（任务保留）';

create unique index uq_tasks_active_source_node on tasks (project_id, task_node_id) where deleted_at is null and task_node_id is not null;
