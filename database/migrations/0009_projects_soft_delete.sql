-- LibiaoLink · 0009 projects 软删（deleted_at / deleted_by）
-- 依据：A5 决议（v0.3 §7.1；Push 49 契约已入 DELETE /projects/{id} + If-Match）；v0.3 §3.3 M2-01
--   「项目 CRUD：编号唯一（409 PROJECT_CODE_EXISTS）、seq_no 分配、乐观锁、软删 / 归档写保护」；h2 · S6·project。
-- 口径：
--   1. deleted_at：软删落点（A5）—— 列表 / 详情 / facets / 搜索 / 导出统一过滤 deleted_at is null；
--      seq_no 不回收、code 唯一约束保留（同编号再建仍 409 PROJECT_CODE_EXISTS）。
--   2. deleted_by：软删操作人（审计线索；audit_logs 随 h7 落表）。
--   3. 归档写保护（ADR-027）：status = archived 后项目写路径（PATCH / DELETE）拒绝，409 PROJECT_ARCHIVED。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新列权限随表默认权限（roles/0001）。

alter table projects add column deleted_at timestamptz;
alter table projects add column deleted_by uuid;
create index ix_projects_active_updated on projects (updated_at desc) where deleted_at is null;
