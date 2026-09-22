-- LibiaoLink · 0017 多位项目经理 / 多位任务负责人（A22 / A23 · Push 136）
-- 口径来源：前端功能需求.md §3.8 A22 / A23 与第六章 Q16、字段对照清单.md §一 / §七、技术设计v0.2 §2.3 / §8（同批同步）。
--   1. projects.manager_id（单值）→ projects.manager_ids（uuid[]）：至少一位、可多位；数组顺序 = 展示顺序
--      （前端按「、」连接展示）；判非空由 ck_projects_manager_ids 兜底。
--   2. tasks.owner_id（单值、可空）→ tasks.owner_ids（uuid[]）：可多位；**空数组 = 「待分配」**
--      （A18 合法中间状态，不用 null 表达）。
--   3. 命中口径（筛选）：filter[managerId] / filter[ownerId] = 与筛选值有交集即命中（任意一位命中即命中）；
--      facets 的 managerId 维度按「人头 × 项目」计数（一个项目挂多位经理时每位各计一次）。
--   4. 索引：projects 的 ix_projects_facets 去掉 manager_id 列（保留 region / project_type 过滤），
--      新增 ix_projects_manager_ids（GIN，数组包含查询）；tasks 的 ix_tasks_owner_due（owner_id, planned_end）
--      改为 ix_tasks_owner_ids（GIN）（到期侧由 ix_tasks_due 覆盖）。
--   5. 回填：manager_id → array[manager_id]；owner_id 为 null → 空数组，非空 → array[owner_id]。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新列沿用既有表级 GRANT（roles/0001 的 default privileges 不涉及本迁移）。

alter table projects add column manager_ids uuid[];
update projects set manager_ids = array[manager_id];
alter table projects
  alter column manager_ids set not null,
  add constraint ck_projects_manager_ids check (cardinality(manager_ids) >= 1),
  add constraint ck_projects_manager_ids_no_null check (array_position(manager_ids, null::uuid) is null);
drop index ix_projects_facets;          -- 旧索引含 manager_id 列，必须在删列前删（否则随列级联消失）
alter table projects drop column manager_id;
create index ix_projects_facets on projects (region, project_type);
create index ix_projects_manager_ids on projects using gin (manager_ids);

alter table tasks add column owner_ids uuid[];
update tasks set owner_ids = case when owner_id is null then array[]::uuid[] else array[owner_id] end;
alter table tasks
  alter column owner_ids set default array[]::uuid[],
  alter column owner_ids set not null,
  add constraint ck_tasks_owner_ids_no_null check (array_position(owner_ids, null::uuid) is null);
drop index ix_tasks_owner_due;          -- 旧索引含 owner_id 列，必须在删列前删（否则随列级联消失）
alter table tasks drop column owner_id;
create index ix_tasks_owner_ids on tasks using gin (owner_ids);
