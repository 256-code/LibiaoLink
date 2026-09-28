-- LibiaoLink · 0033 任务模板（M3-05 余 · 第二段 · A1-16 / A1-17 · 2026-09-24）
-- 起因：任务模板页（#/templates）右侧模板面板此前是前端内存草稿 + 业务预设（Push 58~60 原型），刷新即回预设；
--   业务要求模板真正落库（刷新后保留、可改名 / 拖入节点增删 / 面板内排序 / 删除）—— 本迁移落两张表。
-- 口径：
--   1. task_templates：一条 = 一份模板（名称 + 所属阶段 + 乐观锁 version）。**不设同阶段同名唯一** —— 前端「＋ 新建模板」
--      默认名「未命名模板」允许重复（现状原型可连开多块同名面板），是否唯一待业务定稿；只约束名称长度 1~100。
--   2. task_template_nodes：模板内节点引用，(template_id, node_id) 主键 = 同一模板内按节点 id 去重；
--      seq = 模板内顺序（全量替换时应用层按数组下标重排为 10/20/30…）。节点必须属于模板同一阶段：
--      这是应用层校验（400），DB 只保证「节点存在」（外键），不表达跨表阶段一致。
--   3. 删除模板 = 软删（deleted_at / deleted_by，照 0009 projects / 0022 tasks 口径）：读面恒带 deleted_at is null，
--      重复删除 / 已删模板上的写操作统一 404；删除即生效、已生成的项目任务不变（模板只是「从哪来」的定义）。
--      引用行（task_template_nodes）不跟着清：软删只打标、不连带清子表（照 0009 stakeholders 软删保留项目关联 /
--      0022 tasks 软删保留行），读面一律 deleted_at is null 过滤，因此对接口与页面不可见。
--   4. 删除节点（节点库物理删行 = 0032 口径）连带移除它在各模板里的引用（on delete cascade）：
--      模板行保留、只是少一条节点；节点删除审计在 metadata.removedFromTemplates 记影响面。
-- 权限：只追加迁移，必须由 libiaolink_migrator 执行（应用角色 libiaolink_api 无 DDL）；
--   新表按 alter default privileges 自动授应用 / 只读角色，无需额外 GRANT。
-- 契约：shared/src/modules/templates.ts 的 TaskTemplateSchema / TaskTemplateNodeSchema（GET/POST/PATCH/DELETE /api/v1/task-templates）。
-- 种子：首批模板由 database/seeds/task-templates.mjs 从业务预设导入（幂等；按 (stage_key, name) 存在即跳过）。
-- 回滚（如需）：drop table task_template_nodes; drop table task_templates;

create table task_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stage_key text not null,
  version integer not null default 0,
  deleted_at timestamptz,
  deleted_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_task_templates_stage_key check (stage_key in ('presale', 'design', 'purchase', 'assembly', 'install', 'deploy', 'trial', 'production', 'acceptance')),
  constraint ck_task_templates_name check (char_length(btrim(name)) between 1 and 100),
  constraint ck_task_templates_version check (version >= 0)
);

-- 未删模板专用（读面恒带 deleted_at is null）：列表按 阶段 → created_at 倒序 → id 读（最新在最左，与「＋ 新建模板」插到最左一致；
--   索引同向读亦可反向扫，故索引仍按 created_at 升序建）。
create index ix_task_templates_active_stage on task_templates (stage_key, created_at, id) where deleted_at is null;

create table task_template_nodes (
  template_id uuid not null references task_templates (id) on delete cascade,
  node_id uuid not null references task_nodes (id) on delete cascade,
  seq integer not null,
  constraint pk_task_template_nodes primary key (template_id, node_id),
  constraint ck_task_template_nodes_seq check (seq > 0)
);

-- 模板内顺序读（详情 / 列表都按 seq → node_id）。
create index ix_task_template_nodes_order on task_template_nodes (template_id, seq);

comment on table task_templates is '任务模板：名称 + 所属阶段 + 节点顺序（任务模板页右列 / 「项目总览 → 添加任务」卡片的模板来源）；删除为软删并写审计';
comment on column task_templates.name is '模板名称（1~100 字；不设同阶段唯一 —— 「未命名模板」可重复）';
comment on column task_templates.stage_key is '所属阶段（九阶段字典 StageKey；与模板内节点同阶段）';
comment on column task_templates.version is '乐观锁版本（PATCH / DELETE 必传；不匹配 409 VERSION_CONFLICT）';
comment on column task_templates.deleted_at is '软删时间（读面恒带 deleted_at is null；已删模板上的写操作统一 404）';
comment on table task_template_nodes is '模板内节点引用：主键 (template_id, node_id) = 同一模板内按节点 id 去重；seq = 模板内顺序（10/20/30 步长）';
comment on column task_template_nodes.seq is '模板内顺序（全量替换时按 nodeIds 数组下标重排）；模板内唯一由应用层保证';
