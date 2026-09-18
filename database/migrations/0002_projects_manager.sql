-- LibiaoLink · 数据库迁移 0002
-- 项目级人员字段收敛：对齐《技术设计v0.2-架构与数据模型.md》v0.2.2 §2.3（契约 Push 34 的落地迁移）。
-- 背景：0001_baseline.sql 落库时为旧口径 —— projects.owner_id（旧注释「负责人」，not null）与 projects.manager_id（可空）双列并存；
--       业务口径已定：项目级唯一责任人为「项目经理」（projects.manager_id，必填；首页筛选 filter[managerId]），删除 owner_id；
--       任务级责任人为「任务负责人」（tasks.owner_id，不变，本迁移不涉及）。
-- 执行者：libiaolink_migrator（最小权限角色，见 roles/0001_roles.sql）。
-- 规则：迁移只追加、不可修改（CONTRIBUTING §14）；本文件不含 BEGIN/COMMIT —— 迁移器把每个文件包在独立事务中执行。
-- 数据安全：已有行先按旧口径用 owner_id 回填 manager_id（第 1 条；owner_id 为 not null，回填后必然非空，第 3 条不会因空值失败）；已有 manager_id 的值不覆盖。

-- 1) 旧口径回填：owner_id（旧「负责人」列，业务口径即项目经理）→ manager_id（仅补空值，不覆盖已有值）
update projects set manager_id = owner_id where manager_id is null;

-- 2) 删除旧列：先显式删除依赖它的首页分类索引，再删列（避免隐式删除，保持脚本意图显式可读）
drop index ix_projects_facets;
alter table projects drop column owner_id;

-- 3) 项目经理必填（v0.2.2 §2.3）
alter table projects alter column manager_id set not null;

-- 4) 首页分类（facets）索引改用 manager_id（与 v0.2 §8.2 一致）
create index ix_projects_facets on projects (region, project_type, manager_id);
