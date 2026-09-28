-- LibiaoLink · 0035 项目硬删（业务口径 2026-09-24 · Push 190）
-- 口径来源：业务（px）2026-09-24「删除要硬删不要软删；现在同一个编号删除了，再建一个编号都不可以」→
--   项目删除由「软删（deleted_at 置位、行保留、编号不回收）」改为**物理删行**（连同项目聚合子表），编号随行释放。
-- 变更：
--   1. 清存量：把所有 deleted_at 非空（历史软删）的项目连同聚合子表行按外键依赖序物理删掉 —— 软删语义自此下线；
--      读面（列表 / 详情 / facets / 搜索）仍按 deleted_at is null 过滤（deleted_at / deleted_by 降级为兼容列，新数据恒 null）。
--   2. 编号唯一性：projects_code_key 语义不变（全局唯一）；删除即删行 → 同编号可以再建（不再 409 PROJECT_CODE_EXISTS）。
--   3. 连带清理的子表（顺序 = 外键依赖序；全部 NO ACTION 外键，顺序错会撞 FK）：
--      issue_events → task_events → file_versions → files → change_requests → issues → daily_reports → tasks
--      → node_requirements → project_nodes → project_stages → project_members → project_stakeholders → projects。
--      应用侧新写入路径 = server/src/modules/project/project.repository.ts hardDeleteWithVersion（同事务、同序）。
--   4. 保留不动：audit_logs（无外键；删除前快照与子表行数由应用侧写审计，action=project.delete、metadata.hardDelete=true）。
--   5. 文件域：本迁移只删库内行；对象存储上的实体（若已上传）由文件域清理流程处理（本期库内无文件数据）。
-- 说明：本迁移含 DML（清存量），不可逆；执行前如需保留软删历史请先备份。
-- 只追加迁移，必须由 libiaolink_migrator 执行（应用角色 libiaolink_api 无 DDL）。
-- 回滚（如需）：本条无数据回滚（删除不可逆）；结构未变（仅注释），注释可按需改回 0009 文案。

-- ① 叶子行（引用本项目子表 / 文件的行）
delete from issue_events
 where issue_id in (
   select i.id from issues i
    where i.project_id in (select id from projects where deleted_at is not null)
 );

delete from task_events
 where task_id in (
   select t.id from tasks t
    where t.project_id in (select id from projects where deleted_at is not null)
 );

delete from file_versions
 where file_id in (
   select f.id from files f
    where f.project_id in (select id from projects where deleted_at is not null)
 );

-- ② 项目直属子表（按依赖序）
delete from files
 where project_id in (select id from projects where deleted_at is not null);

delete from change_requests
 where project_id in (select id from projects where deleted_at is not null);

delete from issues
 where project_id in (select id from projects where deleted_at is not null);

delete from daily_reports
 where project_id in (select id from projects where deleted_at is not null);

delete from tasks
 where project_id in (select id from projects where deleted_at is not null);

delete from node_requirements
 where node_id in (
   select n.id from project_nodes n
    where n.project_id in (select id from projects where deleted_at is not null)
 );

delete from project_nodes
 where project_id in (select id from projects where deleted_at is not null);

delete from project_stages
 where project_id in (select id from projects where deleted_at is not null);

delete from project_members
 where project_id in (select id from projects where deleted_at is not null);

delete from project_stakeholders
 where project_id in (select id from projects where deleted_at is not null);

-- ③ 项目行本体（存量软删行清空 → 编号全部释放）
delete from projects where deleted_at is not null;

-- ④ 口径落到注释（结构未变）
comment on table projects is '项目主档（M2-01）：Push 190 起删除 = 物理删行（连同聚合子表）；deleted_at / deleted_by 为兼容列（新数据恒 null），读面仍按 deleted_at is null 过滤';
comment on column projects.deleted_at is '兼容列（Push 190 起删除 = 物理删行、不再写该列）：历史软删行已在 0035 清空';
comment on column projects.deleted_by is '兼容列（Push 190 起不再写）：历史软删行的操作人';
comment on constraint projects_code_key on projects is '项目编号全局唯一（Push 190 起删除 = 物理删行 → 编号随行释放、同编号可再建）';
