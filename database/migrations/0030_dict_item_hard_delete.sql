-- LibiaoLink · 0030 字典条目真删除（C9-02 修订 · Push 173）
-- 口径来源：前端功能需求.md §二 / §3.3（地区与项目类型的增删改）、shared/src/modules/dicts.ts
--   （DELETE /api/v1/dicts/{type}/items/{code}）、系统功能书 C9-02。
-- 变更：
--   1. 「删除」语义由「停用（enabled=false）」改为**物理删行**：DELETE 接口从 dict_items 删除该行，
--      删除前快照（code / name / sort / enabled / metadata）写 audit_logs（action=delete，C7-02 字段级留痕）。
--   2. 存量数据安全：projects.region / projects.project_type 是 text 冗余码，无外键引用 dict_items，
--      删除字典条目不影响存量项目展示（仍按原码 / 原名渲染，前端兜底色）。同码可重新新增 = 全新条目。
--   3. enabled / includeDisabled 保留为兼容字段与兼容参数（二期「临时下架」用），一期产品不再产生停用项。
-- 只追加迁移：应用角色 libiaolink_api 已有 dict_items 的 delete 权限（0013），本文件不改权限、不动结构。
-- 回滚（如需）：恢复 0013 的旧注释即可（数据层面无需回滚 —— 停用行与删除行都是一行数据）。

comment on table dict_items is '字典条目（C9）：唯一键 (type_code, code)；删除 = 物理删行（Push 173 起，删除前快照写审计）；enabled 为兼容字段';
comment on table dict_types is '字典类型注册表（C9）：一期登记 region / projectType（阶段 / 成果文件类型走契约枚举，不进字典接口）；条目删除不影响类型';
comment on column dict_items.enabled is '兼容字段（Push 173 起删除 = 物理删行）：保留给二期「临时下架」；一期恒为 true';
