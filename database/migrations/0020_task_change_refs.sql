-- LibiaoLink · 0020 任务「变更关联」单值 → 多条（A1-07 / R01「追加＋去重」· Push 146）
--   编号说明：原为 0019，与 j6 的 0019_stakeholders.sql 撞号（main 先落地），按只追加规则顺延为 0020。
-- 口径来源：系统功能书.md A1-07（变更关联由 R01 自动写入，追加＋去重）、A4-13（新增变更记录自动回写任务「变更关联」）、
--   docs/rules/R01-R07-内置规则文案.md（R01 执行动作 + 待确认项 1「追加 + 去重」）、技术设计v0.2 §2.3（tasks）。
--   1. tasks.change_ref（uuid 单值、可空、外键 fk_tasks_change_ref → change_requests，on delete set null）
--      → tasks.change_refs（uuid[]，非空、默认空数组）：一条任务可关联多条变更（业务要求「变更关联」列展示多条，
--      与 A1-07 原文一致）。数组顺序 = 关联先后（追加序，末位 = 最近一次变更）；**空数组 = 无变更**（不用 null 表达）；
--      重复引用在应用层去重（与 0017 owner_ids / 0018 deliverable_types 同口径）。R01 回写为「追加 + 去重」，
--      不递增任务乐观锁 version（变更关联不视为任务编辑）。
--   2. 回填：change_ref 非空 → array[change_ref]；为空 → 空数组。
--   3. 外键：多值后不再保留 —— Postgres 不支持数组外键；change_requests 为只追加表（一期申请即通过、无删除路径），
--      原 on delete set null 不会触发；「无 NULL 元素」由 ck_tasks_change_refs_no_null 兜底。
--   4. 索引：ix_tasks_change_refs（GIN）—— 「变更 → 任务」反查（R01 命中回写 / 变更读面随行任务）与多值包含查询。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新列沿用既有表级 GRANT。

alter table tasks add column change_refs uuid[];
update tasks
   set change_refs = case
     when change_ref is null then array[]::uuid[]
     else array[change_ref]
   end;
alter table tasks
  alter column change_refs set default array[]::uuid[],
  alter column change_refs set not null,
  add constraint ck_tasks_change_refs_no_null check (array_position(change_refs, null::uuid) is null);
alter table tasks drop constraint fk_tasks_change_ref;
alter table tasks drop column change_ref;
create index ix_tasks_change_refs on tasks using gin (change_refs);