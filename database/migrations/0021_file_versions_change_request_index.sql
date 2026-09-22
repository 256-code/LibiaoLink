-- LibiaoLink · 0021 变更记录读面反查索引（M4-04 读面 · Push 147）
-- 口径来源：系统功能书.md A4-15（变更记录按项目 / 任务 / 阶段 / 原因检索）、技术设计v0.2 §5.3（变更记录）、
--   契约 shared/src/modules/files.ts（ChangeRequest 的 fileId / versionId / versionSeq 由 file_versions 反查）。
--   1. file_versions.change_request_id 只有外键约束、没有索引 —— Postgres 不会为外键列自动建索引；
--      而变更列表 / 详情都按「change_requests 一行 → file_versions 一行」连接（一期一变更一版本），
--      缺索引时连接只能退化为全表扫描 / 哈希连接（随版本数增长线性变差）。
--   2. 用部分索引（where change_request_id is not null）：正常上传（非变更流）产生的版本不进索引，索引更小、写代价更低。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL 权限；索引随表级 GRANT 生效，无需额外授权。
-- 回滚（如需）：drop index if exists ix_file_versions_change_request;
create index ix_file_versions_change_request on file_versions (change_request_id) where change_request_id is not null;
