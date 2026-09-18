-- LibiaoLink · 数据库基线迁移 0001
-- 对应《技术设计v0.2-架构与数据模型.md》§2.3「关键表 DDL 草案（一期核心）」。
-- 执行者：libiaolink_migrator（最小权限角色，见 roles/0001_roles.sql）。
-- 规则：迁移只追加、不可修改（CONTRIBUTING §14）；本文件不含 BEGIN/COMMIT —— 迁移器把每个文件包在独立事务中执行。
-- 与草案的差异：① 为状态 / 阶段 / 成果物类型等稳定枚举补充了 CHECK 约束；② 补齐了 4 条关系外键（文末）。
-- 注：gen_random_uuid() 自 PG13 起为核心函数，无需扩展。

-- 项目（首页分类字段就位）
create table projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  customer text,
  region text not null,
  project_type text not null,
  owner_id uuid not null,
  manager_id uuid,
  stage_key text not null,
  status text not null,
  description text,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_projects_stage_key check (stage_key in ('presale','design','purchase','assembly','install','deploy','trial','production','acceptance')),
  constraint ck_projects_status check (status in ('active','paused','done','archived')),
  constraint ck_projects_version check (version >= 0)
);
create index ix_projects_facets on projects (region, project_type, owner_id);
create index ix_projects_stage on projects (status, stage_key);

-- 项目阶段（导入蓝图时生成）
create table project_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  stage_key text not null,
  seq smallint not null,
  status text not null,
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  version integer not null default 0,
  unique (project_id, stage_key),
  constraint ck_project_stages_stage_key check (stage_key in ('presale','design','purchase','assembly','install','deploy','trial','production','acceptance')),
  constraint ck_project_stages_status check (status in ('pending','active','done')),
  constraint ck_project_stages_seq check (seq > 0)
);

-- 流程节点实例（快照 + 按模板增删 + 留痕）
create table project_nodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  stage_id uuid not null references project_stages(id),
  node_key text not null,
  name text not null,
  seq numeric(10,2) not null,
  status text not null,
  origin text not null,
  done_at timestamptz,
  done_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  source_blueprint_version integer not null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  unique (project_id, node_key),
  constraint ck_project_nodes_status check (status in ('pending','active','done','deleted')),
  constraint ck_project_nodes_origin check (origin in ('blueprint','added_by_user')),
  constraint ck_project_nodes_blueprint_version check (source_blueprint_version > 0)
);
create index ix_nodes_project_seq on project_nodes (project_id, seq);

-- 节点约束（一期实现 required_doc 门禁；其余类型预留）
create table node_requirements (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references project_nodes(id),
  requirement_type text not null,
  doc_type text,
  min_count integer not null default 1,
  config jsonb,
  created_at timestamptz not null default now(),
  constraint ck_node_requirements_type check (requirement_type in ('required_doc','field','dependency','deadline')),
  constraint ck_node_requirements_doc_type check (requirement_type <> 'required_doc' or doc_type is not null),
  constraint ck_node_requirements_min_count check (min_count >= 1)
);
create index ix_node_req_node on node_requirements (node_id);

-- 任务（项目总览 15 列口径；status 为存储基础态，展示态派生，见 v0.2 §2.4）
create table tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  stage_key text not null,
  node_id uuid references project_nodes(id),
  title text not null,
  title_en text,
  owner_id uuid not null,
  status text not null,
  progress numeric(3,2) not null default 0,
  planned_start date,
  planned_end date,
  actual_end date,
  estimated_days smallint,
  headcount smallint,
  priority text,
  deliverable text,
  note text,
  on_time boolean,
  change_ref uuid,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_tasks_stage_key check (stage_key in ('presale','design','purchase','assembly','install','deploy','trial','production','acceptance')),
  constraint ck_tasks_status check (status in ('pending','active','done')),
  constraint ck_tasks_progress check (progress in (0, 0.25, 0.5, 0.75, 1)),
  constraint ck_tasks_headcount check (headcount is null or headcount >= 0),
  constraint ck_tasks_estimated_days check (estimated_days is null or estimated_days >= 0)
);
create index ix_tasks_project_stage on tasks (project_id, stage_key);
create index ix_tasks_owner_due on tasks (owner_id, planned_end);
create index ix_tasks_due on tasks (project_id, actual_end, planned_end);

-- 任务事件（字段级留痕：状态 / 日期 / 进度 / 描述变更）
create table task_events (
  id bigserial primary key,
  task_id uuid not null references tasks(id),
  event_type text not null,
  before_value text,
  after_value text,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  constraint ck_task_events_type check (event_type in ('status_change','date_change','progress_change','note_change'))
);
create index ix_task_events_task on task_events (task_id, created_at desc);

-- 文件（五态：draft | final | changed | archived | recycled）
create table files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  node_id uuid references project_nodes(id),
  task_id uuid,
  doc_type text,
  name text not null,
  status text not null,
  current_version_id uuid,
  version integer not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_files_status check (status in ('draft','final','changed','archived','recycled'))
);
create index ix_files_node on files (node_id, status);
create index ix_files_project on files (project_id, status);

-- 文件版本（内容哈希去重；定档后不覆盖）
create table file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files(id),
  seq integer not null,
  object_key text not null,
  size_bytes bigint not null,
  content_hash text not null,
  mime text,
  uploaded_by uuid not null,
  uploaded_at timestamptz not null default now(),
  change_request_id uuid,
  unique (file_id, seq),
  constraint ck_file_versions_seq check (seq > 0),
  constraint ck_file_versions_size check (size_bytes >= 0)
);

-- 变更申请（一期：申请即通过、所有人平权、全程留痕）
create table change_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  node_id uuid references project_nodes(id),
  stage_key text,
  reason text not null,
  before_summary text,
  after_summary text,
  status text not null,
  applied_by uuid not null,
  applied_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint ck_change_requests_stage_key check (stage_key is null or stage_key in ('presale','design','purchase','assembly','install','deploy','trial','production','acceptance')),
  constraint ck_change_requests_status check (status in ('applied'))
);
create index ix_change_project on change_requests (project_id, created_at desc);

-- Outbox（外部副作用唯一出口）
create table outbox_events (
  id bigserial primary key,
  topic text not null,
  payload jsonb not null,
  dedupe_key text not null unique,
  status text not null,
  available_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  constraint ck_outbox_status check (status in ('pending','processing','done','dead')),
  constraint ck_outbox_attempts check (attempts >= 0)
);
create index ix_outbox_ready on outbox_events (status, available_at);

-- 关系外键（草案仅在 §2.2 描述关系、未显式声明；此处补齐，保证引用完整性）
alter table file_versions
  add constraint fk_file_versions_change_request foreign key (change_request_id) references change_requests(id);
alter table files
  add constraint fk_files_current_version foreign key (current_version_id) references file_versions(id),
  add constraint fk_files_task foreign key (task_id) references tasks(id) on delete set null;
alter table tasks
  add constraint fk_tasks_change_ref foreign key (change_ref) references change_requests(id) on delete set null;
