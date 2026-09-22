-- LibiaoLink · 0023 日报与问题（M6-01 / M6-02 / M6-03 第一刀 · A3-01 / A3-02 / A3-04 / A3-09 / A3-10 / A3-13）
-- 口径来源：系统功能书.md A3「日报与问题跟踪」（A3-01 表单字段 / A3-02 草稿与补填 / A3-04 提交校验 /
--   A3-09 问题自动生成幂等 / A3-10 问题四态 / A3-13 处理过程留痕）；前端功能需求.md §3.8 A21（接口提案）；
--   技术设计v0.2 §2.2 / §11.1；技术设计v0.3 §3.7（M6-01 / M6-02 / M6-03）。
--   1. daily_reports：一人一项目一天一条（uq_daily_reports_author_date）—— 草稿 / 提交 / 补填共用同一行；
--      补填 = 对过去日期首次提交（state = supplement）；一期不做版本历史（差异登记：补填保留原始提交记录）。
--   2. issues：由日报「现场发现问题」自动生成（source_report_id 唯一 = A3-09 幂等）；source_report_id 为空 = 手工创建。
--   3. issue_events：处理过程留痕（创建 / 状态流转 / 解决方案 / 分派），允许回退（A3-10）。
--   4. 引用守卫：tasks 删除时检查 daily_reports.task_ids（GIN 索引）与 issues.task_id（b-tree 索引）—— 系统功能书 A2-01。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL 权限；索引随表级 GRANT 生效，无需额外授权。
-- 回滚（如需）：drop table issue_events, issues, daily_reports;

create table daily_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id),
  author_id uuid not null references users (id),
  report_date date not null,
  state text not null,
  headcount smallint,
  done_work text not null,
  plan text,
  found_issue text,
  issue_category text,
  suggestion text,
  task_ids uuid[] not null default array[]::uuid[],
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint uq_daily_reports_author_date unique (project_id, author_id, report_date),
  constraint ck_daily_reports_state check (state in ('draft', 'submitted', 'supplement')),
  constraint ck_daily_reports_headcount check (headcount is null or (headcount >= 0 and headcount <= 100000)),
  constraint ck_daily_reports_done_work check (char_length(btrim(done_work)) between 1 and 2000),
  constraint ck_daily_reports_plan check (plan is null or char_length(btrim(plan)) between 1 and 2000),
  constraint ck_daily_reports_found_issue check (found_issue is null or char_length(btrim(found_issue)) between 1 and 2000),
  constraint ck_daily_reports_suggestion check (suggestion is null or char_length(btrim(suggestion)) between 1 and 2000),
  constraint ck_daily_reports_issue_category check (issue_category is null or issue_category in ('机械部', '采购部', '规划部', '项目部', '物流原因', '供应商原因', '客户原因', '客观原因', '生产原因', '其它原因')),
  constraint ck_daily_reports_issue_pairs check (found_issue is null or issue_category is not null),
  constraint ck_daily_reports_task_ids check (array_position(task_ids, null) is null and cardinality(task_ids) <= 200)
);

create index ix_daily_reports_project_date on daily_reports (project_id, report_date desc);
create index ix_daily_reports_author_date on daily_reports (author_id, report_date desc);
create index ix_daily_reports_task_ids on daily_reports using gin (task_ids);

create table issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id),
  task_id uuid references tasks (id),
  source_report_id uuid references daily_reports (id),
  title text not null,
  category text not null,
  state text not null,
  reporter_id uuid not null references users (id),
  owner_department text,
  owner_id uuid references users (id),
  due_at timestamptz,
  raised_at date not null,
  solution text,
  closed_by uuid references users (id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint ck_issues_state check (state in ('unassigned', 'open', 'in_progress', 'done')),
  constraint uq_issues_source_report unique (source_report_id),
  constraint ck_issues_category check (category in ('机械部', '采购部', '规划部', '项目部', '物流原因', '供应商原因', '客户原因', '客观原因', '生产原因', '其它原因')),
  constraint ck_issues_title check (char_length(btrim(title)) between 1 and 500),
  constraint ck_issues_solution check (solution is null or char_length(btrim(solution)) between 1 and 2000),
  constraint ck_issues_owner_department check (owner_department is null or char_length(btrim(owner_department)) between 1 and 80),
  constraint ck_issues_closed_pairs check ((state = 'done') = (closed_at is not null))
);

create index ix_issues_project_state on issues (project_id, state, raised_at desc);
create index ix_issues_task on issues (task_id);
create index ix_issues_category on issues (project_id, category);
create index ix_issues_reporter on issues (reporter_id, raised_at desc);

create table issue_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues (id),
  event_type text not null,
  from_state text,
  to_state text,
  actor_id uuid not null references users (id),
  note text,
  created_at timestamptz not null default now(),
  constraint ck_issue_events_type check (event_type in ('created', 'state_change', 'solution', 'assignment')),
  constraint ck_issue_events_note check (note is null or char_length(btrim(note)) between 1 and 2000)
);

create index ix_issue_events_issue on issue_events (issue_id, created_at);
