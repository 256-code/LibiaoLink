-- LibiaoLink · 0018 任务「输出成果文件」单值 → 多选（ADR-024 · M3-03 · Push 143）
-- 口径来源：ADR-024（成果文件：任务侧多选 deliverable_types，门禁以 node_requirements 为准）、系统功能书.md A2-10 / A4-20、
--   技术设计v0.2 §2.3 / §3.6、技术设计v0.3 §3.4（M3-03）。
--   1. tasks.deliverable（text 单值、可空）→ tasks.deliverable_types（text[]，非空、默认空数组）：取值属十类成果文件字典，
--      **空数组 = 不要求**（不用 null 表达）；数组顺序 = 展示顺序；「无重复」在应用层保证（CHECK 不便表达）。
--   2. 回填：deliverable 非空且非空串 → array[deliverable]；其余 → 空数组。
--   3. 门禁唯一来源仍是 node_requirements（ADR-024 决策二）：任务侧 deliverable_types 只作「应产出什么」的展示、R02 提醒条件、
--      快筛（未上传成果文件）输入与「无节点任务」的兜底判定；本迁移不动 node_requirements。
--   4. 索引：ix_tasks_deliverable_types（GIN）—— R01 变更关联匹配（变更文件 doc_type 命中任一取值，ADR-024 + v0.2 §5.3）与多值筛选。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新列沿用既有表级 GRANT。

alter table tasks add column deliverable_types text[];
update tasks
   set deliverable_types = case
     when deliverable is null or deliverable = '' then array[]::text[]
     else array[deliverable]
   end;
alter table tasks
  alter column deliverable_types set default array[]::text[],
  alter column deliverable_types set not null,
  add constraint ck_tasks_deliverable_types check (
    deliverable_types <@ array['CAD图纸','技术协议','合同','评审单','设备清单','物料总清单','发货装箱单','到货单','安装完成证明','验收单']::text[]
  ),
  add constraint ck_tasks_deliverable_types_no_null check (array_position(deliverable_types, null::text) is null);
alter table tasks drop column deliverable;
create index ix_tasks_deliverable_types on tasks using gin (deliverable_types);
