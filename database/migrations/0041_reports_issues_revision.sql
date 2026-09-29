-- LibiaoLink · 0041 日报与问题修订（Push 215 · 业务口径 2026-09-28 / 29 · 代做 wmj 线，请 wmj 复核）
-- 口径来源：系统功能书.md A3「日报与问题跟踪」（A3-02 同日多条 / A3-03 关联阶段 / A3-04 提交校验 / A3-08 回写停用 /
--   A3-09 问题自动生成 / A3-10 三态 / A3-11 归类多值 / A3-14 处理时限删除）；前端功能需求.md §3.8 A21（Push 212 附图增删）；
--   ADR-026（问题处理时限与超期升级）随批废弃；契约见 shared/src/modules/reports.ts 与 issues.ts。
-- 本批六件事：
--   1. daily_reports 同日多条：删 uq_daily_reports_author_date —— 同人同项目同日记账不再唯一，409 REPORT_ALREADY_EXISTS 随批删除。
--   2. daily_reports 关联任务 → 关联阶段：task_ids uuid[] → stage_keys text[]（存量按引用任务的 stage_key 折算去重）；
--      GIN 索引 ix_daily_reports_task_ids 与任务删除引用守卫（系统功能书 A2-01 的日报一侧）随批删除。
--   3. daily_reports.issue_category text → issue_categories text[]（存量单值转单元素数组；CHECK 改十项子集，上限 10）。
--   4. daily_reports.headcount smallint → integer（契约上限 100000 与列宽打架修复，数据不丢）。
--   5. issues：处理时限 due_at 删除；状态四态 → 三态（unassigned 并入 open，存量行与 issue_events 的 from / to 同步迁移）；
--      category text → categories text[]（存量单值转单元素数组，≥1 项，上限 10）。
--   6. file_links 增 kind text not null default ''：日报附图 kind ∈ {onsite 现场图, issue 问题图}（其余关联恒为 ''）；
--      唯一键扩为 (file_id, object_type, object_id, kind)。问题图转挂 = 删 report 侧链 + 建 issue 侧链（应用层事务内完成）。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；索引随表级 GRANT 生效，无需额外授权。
-- 回滚（如需；状态 / 归类多值化后无法自动回退到单值，只保留首项）：
--   alter table file_links drop constraint ck_file_links_kind;
--   alter table file_links drop constraint uq_file_links_file_object;
--   delete from file_links where kind <> '';
--   alter table file_links add constraint uq_file_links_file_object unique (file_id, object_type, object_id);
--   alter table file_links drop column kind;
--   alter table issues drop constraint ck_issues_categories;
--   alter table issues add column category text; update issues set category = categories[1]; alter table issues alter column category set not null;
--   alter table issues drop column categories; drop index if exists ix_issues_categories;
--   create index ix_issues_category on issues (project_id, category);
--   alter table issues drop constraint ck_issues_state;
--   alter table issues add constraint ck_issues_state check (state in ('unassigned', 'open', 'in_progress', 'done'));
--   alter table issues add column due_at timestamptz;
--   alter table daily_reports drop constraint ck_daily_reports_stage_keys;
--   alter table daily_reports add column task_ids uuid[] not null default array[]::uuid[];
--   drop index if exists ix_daily_reports_stage_keys; create index ix_daily_reports_task_ids on daily_reports using gin (task_ids);
--   alter table daily_reports drop constraint ck_daily_reports_issue_categories;
--   alter table daily_reports add column issue_category text; update daily_reports set issue_category = issue_categories[1];
--   alter table daily_reports drop constraint ck_daily_reports_issue_pairs;
--   alter table daily_reports add constraint ck_daily_reports_issue_pairs check (found_issue is null or issue_category is not null);
--   alter table daily_reports drop column issue_categories;
--   alter table daily_reports alter column headcount type smallint;
--   alter table daily_reports add constraint uq_daily_reports_author_date unique (project_id, author_id, report_date);

-- 1) 同日多条：删唯一约束（同人同项目同日可多条，同日多条按创建时间区分）
alter table daily_reports drop constraint uq_daily_reports_author_date;

-- 2) 关联任务 → 关联阶段（存量按引用任务的 stage_key 折算去重；任务已删 / 无阶段键的引用折算为空）
alter table daily_reports add column stage_keys text[] not null default array[]::text[];
update daily_reports dr
set stage_keys = coalesce((
  select array_agg(distinct t.stage_key order by t.stage_key)
  from unnest(dr.task_ids) as ref(task_id)
  join tasks t on t.id = ref.task_id and t.stage_key is not null
), array[]::text[]);
alter table daily_reports drop constraint ck_daily_reports_task_ids;
drop index ix_daily_reports_task_ids;
alter table daily_reports drop column task_ids;
alter table daily_reports add constraint ck_daily_reports_stage_keys check (
  array_position(stage_keys, null) is null
  and cardinality(stage_keys) <= 9
  and stage_keys <@ array['presale', 'design', 'purchase', 'assembly', 'install', 'deploy', 'trial', 'production', 'acceptance']::text[]
);

-- 3) 问题归类多值（日报侧）
alter table daily_reports add column issue_categories text[] not null default array[]::text[];
update daily_reports set issue_categories = array[issue_category] where issue_category is not null;
alter table daily_reports drop constraint ck_daily_reports_issue_category;
alter table daily_reports drop constraint ck_daily_reports_issue_pairs;
alter table daily_reports drop column issue_category;
alter table daily_reports add constraint ck_daily_reports_issue_categories check (
  array_position(issue_categories, null) is null
  and cardinality(issue_categories) <= 10
  and issue_categories <@ array['机械部', '采购部', '规划部', '项目部', '物流原因', '供应商原因', '客户原因', '客观原因', '生产原因', '其它原因']::text[]
);
alter table daily_reports add constraint ck_daily_reports_issue_pairs check (found_issue is null or cardinality(issue_categories) >= 1);

-- 4) 施工人数列宽（smallint 上限 32767 < 契约 100000）
alter table daily_reports alter column headcount type integer;

-- 5) 问题：三态 / 归类多值 / 处理时限删除
update issues set state = 'open' where state = 'unassigned';
update issue_events set from_state = 'open' where from_state = 'unassigned';
update issue_events set to_state = 'open' where to_state = 'unassigned';
alter table issues drop constraint ck_issues_state;
alter table issues add constraint ck_issues_state check (state in ('open', 'in_progress', 'done'));
alter table issues drop column due_at;
alter table issues add column categories text[] not null default array[]::text[];
update issues set categories = array[category];
alter table issues drop constraint ck_issues_category;
drop index ix_issues_category;
alter table issues drop column category;
alter table issues add constraint ck_issues_categories check (
  array_position(categories, null) is null
  and cardinality(categories) between 1 and 10
  and categories <@ array['机械部', '采购部', '规划部', '项目部', '物流原因', '供应商原因', '客户原因', '客观原因', '生产原因', '其它原因']::text[]
);
create index ix_issues_categories on issues using gin (categories);

-- 6) file_links.kind（日报附图：onsite 现场工作附图 / issue 当前问题附图；其余关联恒为空串）
alter table file_links add column kind text not null default '';
alter table file_links drop constraint uq_file_links_file_object;
alter table file_links add constraint uq_file_links_file_object unique (file_id, object_type, object_id, kind);
alter table file_links add constraint ck_file_links_kind check (kind in ('', 'onsite', 'issue'));
