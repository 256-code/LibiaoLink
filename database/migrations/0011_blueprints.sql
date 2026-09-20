-- LibiaoLink · 0011 blueprints / blueprint_versions（h3 · S6·blueprint/node：蓝图数据面）
-- 口径来源：ADR-019（按项目类型各一份 + default 兜底模板，版本化）、v0.2 §3.1~§3.5。
--   1. blueprints：每个项目类型一行（project_type 唯一）；default 为兜底模板。draft_payload 保存当前草稿
--      （完整蓝图 JSON，契约 BlueprintSchema）；published_version 记录已发布版本号（0 = 尚未发布）。
--   2. blueprint_versions：发布产生不可变版本行（payload + 校验结果 issues）；已生成项目为导入快照，
--      不受后续蓝图变更影响（project_nodes.source_blueprint_version 指向本表的具体版本）。
--   3. 乐观锁：blueprints.version 保护草稿编辑；发布 = 草稿转版本行（payload 无变化时不递增版本）。
--   4. 种子：默认模板由 database/seeds/blueprint.mjs（种子 #7）灌入，不在本迁移内写数据。

create table blueprints (
  id uuid primary key default gen_random_uuid(),
  project_type text not null unique,
  name text not null,
  draft_payload jsonb not null,
  draft_updated_at timestamptz not null default now(),
  draft_updated_by uuid,
  published_version integer not null default 0,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_blueprints_published_version check (published_version >= 0),
  constraint ck_blueprints_version check (version >= 0)
);

create table blueprint_versions (
  id uuid primary key default gen_random_uuid(),
  blueprint_id uuid not null references blueprints(id),
  blueprint_version integer not null,
  payload jsonb not null,
  issues jsonb not null default '[]'::jsonb,
  published_by uuid,
  published_at timestamptz not null default now(),
  unique (blueprint_id, blueprint_version),
  constraint ck_blueprint_versions_version check (blueprint_version > 0)
);
create index ix_blueprint_versions_bp on blueprint_versions (blueprint_id, blueprint_version desc);
