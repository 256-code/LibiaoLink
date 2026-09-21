-- LibiaoLink · 0015 tasks 落库口径（w2 · A15 / A18 / A19 / A20：2026-09-21 业务定案 1A / 2B / 3A）
-- 口径来源：前端功能需求.md 附录 A15 / A18 / A19 / A20（Push 119 / 120 定案）、字段对照清单.md §七。
--   1. tasks.sort_index：组内位次 —— 一组 = 同一 project_id + 同一 stage_key（stage_key 为空 = 「未分组」自成一组，
--      默认顺序里落在九个施工阶段之后）；组内 0 起、密集（0..n-1）；拖动排序与「插入位置」都写这一列。
--   2. stage_key 放宽可空：看板「＋ 添加 → 临时任务」先不带阶段（卡片显示「未分组」）。
--   3. owner_id 放宽可空：「待分配」是合法中间状态（卡片拖进「待分配」列 = 清空负责人）。
--   4. 回填：按迁移前的默认读序（planned_start asc nulls last, created_at, id）给存量任务排位次，迁移前后读序一致。

alter table tasks
  add column sort_index integer,
  alter column stage_key drop not null,
  alter column owner_id drop not null;

with ranked as (
  select id,
         row_number() over (
           partition by project_id, stage_key
           order by planned_start asc nulls last, created_at asc, id asc
         ) - 1 as position
  from tasks
)
update tasks
set sort_index = ranked.position
from ranked
where tasks.id = ranked.id;

alter table tasks
  alter column sort_index set default 0,
  alter column sort_index set not null,
  add constraint ck_tasks_sort_index check (sort_index >= 0);

create index ix_tasks_project_stage_order on tasks (project_id, stage_key, sort_index);
