-- LibiaoLink · 0037 保存视图与关注关系（M2-06 首刀 · A1-03 视图 / A1-15 关注 · Push 168 · wmj 线）
-- 口径来源：契约 shared/src/modules/views.ts + shared/src/modules/follows.ts；系统功能书 A1-03（视图管理）/ A1-15（关注订阅）；
--   技术设计v0.3 §3.1（M2-06：视图（个人/公共）/ 关注订阅 / 用户偏好 —— 偏好已随 0029 落地，本片只做视图与关注）。
-- 口径：
--   1. project_views：视图 = 仅保存配置（筛选 filters + 列 columns + 排序 sort + 分组 grouping），不复制数据；打开视图实时反映最新数据。
--      scope = personal（个人：仅 owner 可见 / 可改）/ public（公共：全员可见、创建者可改；角色级共享未做 —— 差异登记见契约头注释）。
--      库列名用 grouping 避 PG 保留字 group（技术设计v0.3 §3.1 原字段名 group 以契约 / 本迁移为准修订，请 wmj 复核）。
--   2. 每人至多一条默认视图：部分唯一索引 uq_project_views_owner_default（owner_id）where is_default；
--      置位 / 取消由服务端同事务维护（建 / 改时自动清掉本人其它默认；删除默认视图后不自动补位）。
--   3. follows：关注关系单独存储（不作为任务字段）；object_type = project | task；跨对象唯一 uq_follows_user_object。
--      多态 object_id 不设外键（项目 / 任务两族）：目标硬删时由服务端按关系键清理（项目硬删 15 步已含 follows 清行）。
--      取关 = 按关系键物理删行（不校验目标存在 / 可见）；归档项目不可新关注（读侧口径，不在库侧限制）。
--   4. 两表均不写审计、无版本号：视图是界面配置（单人单写者）、关注是幂等关系行 —— 先例 user_preferences（0029）。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新表权限由 roles/0001 的 default privileges 自动授予。
-- 回滚（如需）：drop table follows; drop table project_views;

create table project_views (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  scope text not null default 'personal',
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  columns jsonb not null default '[]'::jsonb,
  sort jsonb,
  grouping jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_project_views_scope check (scope in ('personal','public')),
  constraint ck_project_views_name check (char_length(btrim(name)) between 1 and 50),
  constraint ck_project_views_filters_object check (jsonb_typeof(filters) = 'object'),
  constraint ck_project_views_columns_array check (jsonb_typeof(columns) = 'array')
);

comment on column project_views.grouping is '分组方式（jsonb {key}；列名避 PG 保留字 group，契约字段同名）';

create unique index uq_project_views_owner_default on project_views (owner_id) where is_default;
create index ix_project_views_owner_updated on project_views (owner_id, updated_at desc);
create index ix_project_views_scope_updated on project_views (scope, updated_at desc);

create table follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  object_type text not null,
  object_id uuid not null,
  created_at timestamptz not null default now(),
  constraint ck_follows_object_type check (object_type in ('project','task')),
  constraint uq_follows_user_object unique (user_id, object_type, object_id)
);

create index ix_follows_object on follows (object_type, object_id);
create index ix_follows_user_created on follows (user_id, created_at desc, id);
