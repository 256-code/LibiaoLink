-- LibiaoLink · 0013 字典（C9）与审计留痕（h7 · S6·admin）
-- 口径来源：技术设计v0.2 §1.2（平台表：dict_types / dict_items / audit_logs）、§11.1（admin 模块表）；
--   技术设计v0.3 §3.2（表口径：audit_logs = actor、action、object、before / after / diff、entry、trace_id、result；
--   dict_types / dict_items = code、name、sort、enabled、metadata 含 accent）与「审计：api 角色仅授 INSERT
--   （无 UPDATE / DELETE）+ 按月清理任务（保留 ≥6 个月）；越权尝试单独标记并告警」。
-- 设计要点：
--   1. 字典 = 类型注册表 + 条目表（唯一键 (type_code, code)）；「删除」语义 = 停用（enabled=false）：
--      停用不影响存量数据展示（C9-02），历史数据保留原值，因此不提供物理删除。
--   2. audit_logs 追加写：应用角色仅 SELECT / INSERT（本文件显式 revoke UPDATE / DELETE）；
--      按月清理（保留 ≥6 个月）由运维 / 迁移器执行，应用不参与删除（防篡改，C7-05）。
--   3. 字段级留痕存 changes（[{field, from, to}]）；对象 / 操作人检索走 ix_audit_logs_object / ix_audit_logs_actor。

create table dict_types (
  code text primary key,
  name text not null,
  sort integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_dict_types_code check (code ~ '^[a-z][a-zA-Z0-9_]{1,39}$'),
  constraint ck_dict_types_name check (char_length(btrim(name)) between 1 and 80),
  constraint ck_dict_types_sort check (sort >= 0)
);

create table dict_items (
  id uuid primary key default gen_random_uuid(),
  type_code text not null references dict_types (code) on update cascade,
  code text not null,
  name text not null,
  sort integer not null default 0,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id),
  constraint uq_dict_items_type_code unique (type_code, code),
  constraint ck_dict_items_code check (char_length(btrim(code)) between 1 and 64),
  constraint ck_dict_items_name check (char_length(btrim(name)) between 1 and 80),
  constraint ck_dict_items_sort check (sort >= 0),
  constraint ck_dict_items_metadata check (jsonb_typeof(metadata) = 'object')
);
create index ix_dict_items_type_sort on dict_items (type_code, sort, code);

create table audit_logs (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid references users (id),
  actor_name text,
  action text not null,
  object_type text not null,
  object_id text not null,
  project_id uuid,
  result text not null default 'succeeded',
  entry text not null default 'api',
  summary text not null default '',
  changes jsonb,
  metadata jsonb not null default '{}'::jsonb,
  constraint ck_audit_logs_action check (action in ('create', 'update', 'delete', 'progress', 'complete', 'advance', 'rollback', 'deny')),
  constraint ck_audit_logs_result check (result in ('succeeded', 'denied', 'failed')),
  constraint ck_audit_logs_entry check (entry in ('api', 'page', 'system', 'batch')),
  constraint ck_audit_logs_object check (char_length(btrim(object_type)) between 1 and 40 and char_length(btrim(object_id)) between 1 and 200),
  constraint ck_audit_logs_changes check (changes is null or jsonb_typeof(changes) = 'array'),
  constraint ck_audit_logs_metadata check (jsonb_typeof(metadata) = 'object')
);
create index ix_audit_logs_object on audit_logs (object_type, object_id, occurred_at desc);
create index ix_audit_logs_actor on audit_logs (actor_id, occurred_at desc);
create index ix_audit_logs_time on audit_logs (occurred_at desc);
create index ix_audit_logs_project on audit_logs (project_id, occurred_at desc) where project_id is not null;
create index ix_audit_logs_denied on audit_logs (occurred_at desc) where result = 'denied';

comment on table dict_types is '字典类型注册表（C9）：一期登记 region / projectType（阶段 / 成果文件类型走契约枚举，不进字典接口）';
comment on table dict_items is '字典条目（C9）：唯一键 (type_code, code)；停用不影响存量数据展示，无物理删除';
comment on table audit_logs is '操作审计（C7）：追加写、不可改删；应用角色仅 SELECT / INSERT；按月清理保留 ≥6 个月';

-- 防篡改（C7-05）：库级默认权限会给应用角色全量 DML，这里对 audit_logs 显式收回 UPDATE / DELETE。
revoke update, delete on table audit_logs from libiaolink_api;
grant select, insert on table audit_logs to libiaolink_api;
grant select on table audit_logs to libiaolink_readonly;
grant select, insert, update, delete on table dict_types to libiaolink_api;
grant select, insert, update, delete on table dict_items to libiaolink_api;
grant select on table dict_types to libiaolink_readonly;
grant select on table dict_items to libiaolink_readonly;