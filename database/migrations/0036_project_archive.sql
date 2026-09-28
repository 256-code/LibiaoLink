-- LibiaoLink · 0036 项目归档（ADR-027 · M7-04 · 门禁 + 引用式清单 + 冻结状态位）
-- 口径来源：docs/adr/ADR-027-项目归档快照.md；系统功能书 C4-01 / C4-02 / C4-03；技术设计v0.3 §3.8（M7-04 归档）。
-- 变更：
--   1. projects 增归档时点 / 操作人两列（archived_at / archived_by；成对 CHECK：要么都空、要么都有 —— 只由归档端点置位）。
--   2. 新增 project_archives：一项目一份的引用式清单（归档时点 / 操作人 / 快照 jsonb / 确认越过的缺项 jsonb）——
--      只记 id 与摘要（任务数与状态分布 / 阶段状态 / 文件清单含版本 / 变更 / 日报 / 问题），不复制业务数据（ADR-027）。
--   3. 审计动作 ck_audit_logs_action 由十值扩为十一值（新增 archive —— 归档动作写审计，ADR-027；
--      与契约 shared/src/modules/audits.ts AUDIT_ACTIONS 同序：archive 紧随 rollback，preview / download / deny 次序不动）。
--   4. 归档写保护（PROJECT_ARCHIVED）此前已随 0009 落地；本迁移不改写路径拦截，只补状态位落点与清单存证。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新表权限由 roles/0001 的 default privileges 自动授予。
-- 回滚（如需）：
--   alter table audit_logs drop constraint ck_audit_logs_action,
--     add constraint ck_audit_logs_action check (action in ('create','update','delete','progress','complete','advance','rollback','preview','download','deny'));
--   drop table project_archives;
--   alter table projects drop constraint ck_projects_archived_pair, drop column archived_by, drop column archived_at;

alter table projects add column archived_at timestamptz;
alter table projects add column archived_by uuid;

alter table projects add constraint ck_projects_archived_pair check ((archived_at is null) = (archived_by is null));

create table project_archives (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  archived_at timestamptz not null default now(),
  archived_by uuid not null,
  snapshot jsonb not null,
  acknowledged_missing jsonb not null default '[]'::jsonb,
  constraint uq_project_archives_project unique (project_id),
  constraint ck_project_archives_acknowledged check (jsonb_typeof(acknowledged_missing) = 'array')
);

create index ix_project_archives_archived_at on project_archives (archived_at);

alter table audit_logs drop constraint ck_audit_logs_action;
alter table audit_logs add constraint ck_audit_logs_action
  check (action in ('create','update','delete','progress','complete','advance','rollback','archive','preview','download','deny'));
