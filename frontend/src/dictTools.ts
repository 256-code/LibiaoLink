/**
 * 项目字典（地区 / 项目类型）的「＋ 添加」与「删除」能力（Push 167 起；Push 172 扩到项目类型与删除）。
 * 落点 = 数据字典（C9-01 读 / C9-02 写）：
 * - 新增 region：**任何登录用户**（Push 168 业务口径「地区要全站共享、非管理员也能加」）；
 * - 新增 projectType、以及两类条目的删除：仅管理员（dict.manage）；
 * - Push 173：删除 = **物理删行**（DELETE /dicts/{type}/items/{code}）—— 删除无记忆：同码可重新新增，按全新条目处理
 *   （本次所选颜色、排到末尾），界面不出现「已停用 / 恢复」字样。
 * 保存后全站可见（所有项目的下拉都能选到）、可在首页按它筛选；本文件只放类型，实际写库在 App 层
 * （弹窗只消费 DictTools，不直接摸接口）。
 */
import type { DictTypeCode } from "./dicts";

/** 新增条目入参：name = 名称（同时作为字典码）；metadata = 附加元数据（项目类型的 accent / accentText）。 */
export type DictAddInput = { name: string; metadata: Record<string, unknown> };

/** 字典下拉的「自定义」能力（App 层实现，弹窗只消费）。 */
export type DictTools = {
  /** 新增条目：返回 null = 成功（新增项已进缓存、浮层里即时可选）；返回文案 = 浮层内提示（409 / 403 / 网络）。 */
  onAdd: (type: DictTypeCode, input: DictAddInput) => Promise<string | null>;
  /** 删除条目（物理删行）：返回 null = 成功；返回文案 = 浮层内提示。 */
  onDelete: (type: DictTypeCode, code: string) => Promise<string | null>;
};
