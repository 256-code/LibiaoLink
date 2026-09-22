-- LibiaoLink · 0019 干系人台账与项目关联（j6 · S8·stakeholder · A5-01 / A5-04 / A5-07）
-- 口径来源：系统功能书.md A5-01'A5-04、A5-07、C3-04、C3-08；技术设计v0.2 §2.3（stakeholders / project_stakeholders）、§4.1（数据范围）；
--   技术设计v0.3 §3.7（M6-04）；server/src/modules/permission/permission.rules.ts 字段策略表 + ENTITY_FIELDS.stakeholder。
-- 口径：
--   1. stakeholders = 全库台账（不挂项目）；项目维度走 project_stakeholders 多对多（A5-03 按项目看清单 / 按干系人反查项目）。
--   2. 字段集与 h6 字段策略表一一对应：name（未登记 = 可见）、company_type（A5-02 四类分类，未登记）、company（商务字段 → stakeholder.view）、
--      title（同上）、phone / wechat / email（联系方式 → stakeholder.contact.view）、remark（→ stakeholder.manage）。
--      未登记字段不受字段级裁剪；「无权字段一律不返回」由服务端 projectFields 执行（C3-08，不做前端打码）。
--   3. created_by = 录入人（A5-04 销售端口）：数据范围 own_stakeholders（销售）据此判定「我录入的干系人」；系统导入可空。
--   4. 软删（照 0009 projects 口径）：deleted_at / deleted_by；列表 / 详情一律过滤 deleted_at is null，不物理删行。
--   5. 判重（A5-05 姓名 + 手机号）在应用层提示，不建唯一约束 —— 同名同号可能属不同项目的不同人；去重合并（A5-06）二期。
--   6. 干系人角色（A5-01「干系人角色」）口径未定，本迁移不落列（登记于模块 README 差异）；随 C3-09 / 二期一并提请。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新表权限由 roles/0001 的 default privileges 自动授予。

create table stakeholders (
  id uuid primary key default gen_random_uuid(),
  name text not null,                              -- 干系人姓名
  company_type text not null,                      -- 公司分类（A5-02）：立镖机器人 / 供应商 / 总包单位 / 客户
  company text,                                    -- 具体公司名称（A5-02「可补充具体公司名称」；可空）
  title text,                                      -- 职务 / 责任板块
  phone text,                                      -- 电话（含 WhatsApp）
  wechat text,                                     -- 微信号
  email text,                                      -- 邮箱
  remark text,                                     -- 备注（仅维护者可见）
  created_by uuid references users (id),           -- 录入人（own_stakeholders 判定依据；系统导入可空）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references users (id),
  constraint ck_stakeholders_name check (char_length(btrim(name)) between 1 and 80),
  constraint ck_stakeholders_company_type check (company_type in ('libiao', 'supplier', 'general_contractor', 'customer')),
  constraint ck_stakeholders_company check (company is null or char_length(btrim(company)) between 1 and 120),
  constraint ck_stakeholders_title check (title is null or char_length(btrim(title)) between 1 and 80),
  constraint ck_stakeholders_phone check (phone is null or char_length(btrim(phone)) between 1 and 40),
  constraint ck_stakeholders_wechat check (wechat is null or char_length(btrim(wechat)) between 1 and 64),
  constraint ck_stakeholders_email check (email is null or char_length(btrim(email)) between 3 and 120),
  constraint ck_stakeholders_remark check (remark is null or char_length(btrim(remark)) between 1 and 500)
);
-- 台账默认视图（updated_at 降序、排除软删）：列表 / 导出同一谓词。
create index ix_stakeholders_active_updated on stakeholders (updated_at desc) where deleted_at is null;
-- 数据范围 own_stakeholders（销售）反查：我录入的干系人。
create index ix_stakeholders_created_by on stakeholders (created_by) where deleted_at is null;
-- 公司分类筛选（A5-09 按公司类型导出）+ 关键词前缀命中。
create index ix_stakeholders_company_type on stakeholders (company_type, updated_at desc) where deleted_at is null;
create index ix_stakeholders_name on stakeholders (name) where deleted_at is null;

create table project_stakeholders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id),
  stakeholder_id uuid not null references stakeholders (id),
  linked_by uuid references users (id),
  linked_at timestamptz not null default now(),
  constraint uq_project_stakeholders unique (project_id, stakeholder_id)
);
-- 按项目看联系人清单（A5-03）：project_id 前缀命中。
create index ix_project_stakeholders_project on project_stakeholders (project_id);
-- 按干系人反查参与项目（A5-03）：干系人侧反查。
create index ix_project_stakeholders_stakeholder on project_stakeholders (stakeholder_id);
