/**
 * 项目地区的「＋ 添加地区」能力（Push 167 起；Push 168 按业务口径修订为**全站共享**）。
 * 落点 = **地区字典**（`POST /api/v1/dicts/region/items`，契约 C9-02 修订）：**任何登录用户**都能加 ——
 * 保存后全站可见（所有项目的地区下拉都能选到）、可在首页按它筛选；改名 / 排序 / 停用仍归管理员（PATCH + dict.manage）。
 * 本文件只放常量与类型，实际写库在 App 层（弹窗只消费 RegionTools，不直接摸接口）。
 */

/** 地区名长度上限：与字典码上限（64）取齐。 */
export const REGION_NAME_MAX = 64;

/** 新增地区的结果：成功回传项目要落的地区值（字典码）；失败回传弹窗内提示文案。 */
export type RegionAddResult = { ok: true; code: string } | { ok: false; message: string };

/** 地区下拉的「自定义」能力（App 层实现，弹窗只消费）。 */
export type RegionTools = {
  /** 新增地区（调用方已做去空格 / 长度 / 逗号校验）；返回失败文案时由弹窗内联展示。 */
  onAdd: (name: string) => Promise<RegionAddResult>;
};
