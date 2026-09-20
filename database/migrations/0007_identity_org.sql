-- LibiaoLink · 0007 identity/org（departments / roles / role_permissions / user_roles）
-- 依据：技术设计v0.2 §4.1（角色与数据范围）、§11.1（identity/org 待建表）；技术设计v0.3 §3.2（M1 身份与平台底座）；
--   ADR-010（SSO 为准；组织同步 / 离职自动禁用）、ADR-011（五层权限：功能权限 + 数据范围 + …）。
-- 口径：
--   1. departments：企微 / Casdoor 同步的部门树；source_id = 同步源部门 ID（唯一，手工建部门为 null）；
--      status 与 users.status 同口径（active | disabled）；快照中缺失的部门置 disabled（不物理删除）。
--   2. roles：一期六个内置角色以种子维护（database/seeds/roles.mjs · 种子 #6a）；data_scope 与 §4.1 数据范围一一对应；
--      多角色取并集（server identity/role.service.ts），由宽到窄：all > managed_projects > involved_projects > own_stakeholders > granted。
--   3. role_permissions：功能权限位（模块.操作，如 project.create）；结构随本迁移落地，矩阵条目随 h6（PoC-6 权限矩阵与脱敏五出口）填充。
--   4. user_roles：用户 ↔ 角色绑定（多角色并集）；首任管理员授权走运维脚本 / 后续管理界面，不写死种子。
--   5. 人员 ↔ 部门映射（多部门 / 兼职）：随 D1-06 组织维护与同步适配器 payload 确认后另起迁移，本迁移不落列。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新表权限由 roles/0001 的 default privileges 自动授予。

create table departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,                          -- 部门名（同步源为准）
  parent_id uuid references departments(id),   -- 上级部门；null = 根
  source_id text unique,                       -- 同步源部门 ID（企微 / Casdoor）；手工建部门为 null
  status text not null default 'active',       -- active | disabled（与 users.status 同口径）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_departments_status check (status in ('active','disabled')),
  constraint ck_departments_not_self_parent check (parent_id is null or parent_id <> id)
);

create index ix_departments_parent on departments (parent_id);

create table roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                   -- 角色编码（admin / project_manager / task_owner / project_member / sales / viewer）
  name text not null,                          -- 角色名（系统管理员 / 项目经理 / …）
  data_scope text not null,                    -- 数据范围（v0.2 §4.1）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_roles_code check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint ck_roles_data_scope check (data_scope in ('all','managed_projects','involved_projects','own_stakeholders','granted'))
);

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission text not null,                    -- 功能权限位（模块.操作，如 project.create；矩阵随 h6 落）
  created_at timestamptz not null default now(),
  primary key (role_id, permission),
  constraint ck_role_permissions_key check (permission ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$')
);

create table user_roles (
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index ix_user_roles_role on user_roles (role_id);
