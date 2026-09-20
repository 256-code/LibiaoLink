-- LibiaoLink · 0010 项目成员名册（project_members）
-- 依据：v0.3 §3.3「新增表」project_members（project_id、user_id、role_in_project、joined_at）+ 卡片 M2-05（项目成员与记录级权限）；
--   系统功能书「项目成员制：非项目成员不可见，统一 404 语义，防 IDOR 探测」；ADR-011 记录权限（本项目成员制）；h2 · S6·project。
-- 口径：
--   1. 名册是「谁能看见这个项目」的来源（记录级权限由 h6 策略服务消费；ADR-011 统一 404 语义）。
--   2. role_in_project 一期两值：project_manager（项目经理）/ project_member（项目成员）——项目内角色与全局角色
--      （roles / user_roles，管功能权限）相互独立；记录级可见性只看名册。
--   3. projects.manager_id（主数据：首页筛选 filter[managerId] / 卡片展示）与名册不自动联动；建项目时的成员初始化
--      随 M2-02 建项目事务（h3），管理界面（u 系列）落地时再收敛口径。
--   4. 项目软删（0009）不物理删名册行：项目不可见即成员接口 404，名册行保留以备恢复与审计。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新表权限随 roles/0001 的 default privileges 自动授权。

create table project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  user_id uuid not null references users(id),
  role_in_project text not null default 'project_member',
  joined_at timestamptz not null default now(),
  constraint uq_project_members_project_user unique (project_id, user_id),
  constraint ck_project_members_role check (role_in_project in ('project_manager', 'project_member'))
);
-- 「我参与的项目」反查（h6 数据范围 involved_projects；v0.2 §4.1）
create index ix_project_members_user on project_members (user_id);
