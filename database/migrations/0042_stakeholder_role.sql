-- LibiaoLink · 0042 干系人角色列（Push 225 · 业务口径 2026-09-29 · 代做 wmj 线，请 wmj 复核）
-- 口径来源：系统功能书.md A5-01 字段清单（「……填写者、干系人角色、关联项目、最近更新时间」）；前端功能需求.md §6.15 / §3.8 A27；
--   字段对照清单.md §二.1（原「口径未定，暂不落列」随本批改写）；契约 shared/src/modules/stakeholders.ts（同批扩 role）。
-- 口径：
--   1. stakeholders 增 role text（可空）：干系人角色 = 自由文本（如「决策人」「技术接口人」），长度 1..80（照 title 写法；空串非法、未填为 null）。
--   2. 不做字段级权限：有 stakeholder.view 即可见（role 不登记 FIELD_POLICIES —— 非联系方式 / 商务字段，照 C3-04 口径）。
--   3. 存量行 role = null（未填），不回填推算值。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；列级授权随表级 GRANT 生效。
-- 回滚（如需）：alter table stakeholders drop constraint ck_stakeholders_role; alter table stakeholders drop column role;

alter table stakeholders add column role text;
alter table stakeholders add constraint ck_stakeholders_role check (role is null or char_length(btrim(role)) between 1 and 80);
