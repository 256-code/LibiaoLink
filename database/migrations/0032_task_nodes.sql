-- LibiaoLink · 0032 任务节点库（M3-05 余 · A1-16 / A1-17 · 2026-09-24）
-- 起因：任务模板页（#/templates）左列「任务节点」此前由 frontend/src/data/templatePresets.ts 写死（Push 60 原型）；
--   业务 2026-09-24 要求节点可维护（新增 / 删除）—— 节点池就此落库，模板页与「项目总览 → 添加任务」卡片共用本表。
-- 口径：
--   1. 一条 = 「可生成任务的定义」：阶段（九阶段字典）+ 中英文名称 + 库内排序（seq，10/20/30 步长便于插队）。
--   2. 与流程节点（project_nodes / 蓝图实例）无关：tasks.node_id 仍指向 project_nodes，本表不被 tasks 引用；
--      本表也不是 blueprint 的节点清单（那是「项目流程」，本表是「任务从哪来」）。
--   3. 同阶段内名称唯一（uq_task_nodes_stage_title）= 前端「同阶段同名」判重的落库版。
--   4. 删除 = 物理删行（与字典条目硬删同口径，Push 173）：删除前快照写审计 action=delete，不留软删标记。
--      模板引用守卫（task_template_nodes）随模板接口那一刀追加，本迁移不建引用关系。
-- 权限：只追加迁移，必须由 libiaolink_migrator 执行（应用角色 libiaolink_api 无 DDL）；
--   新表按 alter default privileges 自动授应用 / 只读角色，无需额外 GRANT。
-- 契约：shared/src/modules/templates.ts 的 TaskNodeSchema（含 version —— 乐观锁占位，本刀只读写 0）；
-- 种子：首批节点由 database/seeds/task-nodes.mjs 从业务预设导入（幂等；库内已改名 / 已删的不覆盖、不复活）。
-- 回滚（如需）：drop table task_nodes;

create table task_nodes (
  id uuid primary key default gen_random_uuid(),
  stage_key text not null,
  seq integer not null,
  title text not null,
  title_en text,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_task_nodes_stage_key check (stage_key in ('presale', 'design', 'purchase', 'assembly', 'install', 'deploy', 'trial', 'production', 'acceptance')),
  constraint ck_task_nodes_seq check (seq > 0),
  constraint ck_task_nodes_title check (char_length(btrim(title)) between 1 and 200),
  constraint ck_task_nodes_version check (version >= 0),
  constraint uq_task_nodes_stage_title unique (stage_key, title)
);

create index ix_task_nodes_stage_seq on task_nodes (stage_key, seq, id);

comment on table task_nodes is '任务节点库：任务模板页「任务节点」左列的节点来源（阶段 + 中英文名 + 库内排序）；可新增 / 删除，删除为物理删行并写审计';
comment on column task_nodes.stage_key is '所属阶段（九阶段字典 StageKey）';
comment on column task_nodes.seq is '库内排序（10/20/30 步长，便于插队）；前端按 (stage_key, seq, id) 升序展示';
comment on column task_nodes.title is '节点名称（中文，生成任务时写入任务描述）';
comment on column task_nodes.title_en is '英文名（可空 —— 业务预设里的空串落库归一为 null）';
