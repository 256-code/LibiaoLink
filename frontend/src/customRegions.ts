/**
 * 自定义地区（本机记忆）：地区字典（C9）之外的「自填地区」，服务于新建 / 编辑项目弹窗里地区下拉的「＋ 添加地区」。
 * 两条落点（由 App 层按权限分派，弹窗只消费 RegionTools）：
 * - 有 dict.manage（系统管理员）→ 写地区字典（POST /api/v1/dicts/region/items），全站可见、可筛选（不落本文件）；
 * - 无权限 → 仅作为本项目的地区值（契约 projects.region 是自由文本、上限 100 字），并记在本机，方便下次直接选。
 * 只存浏览器 localStorage（与 homePrefs / savedFilters 同口径）：不上传、不跨设备、不参与服务端校验。
 */
const STORAGE_KEY = "libiaolink.customRegions";

/** 地区名长度上限：与字典码上限（64）取齐，两条落点共用同一套校验。 */
export const REGION_NAME_MAX = 64;

/** 新增地区的结果：成功回传项目要落的地区值（字典码 / 自定义值）；失败回传弹窗内提示文案。 */
export type RegionAddResult = { ok: true; code: string } | { ok: false; message: string };

/** 地区下拉的「自定义」能力（App 层实现，弹窗只消费）。 */
export type RegionTools = {
  /** 当前用户是否有 dict.manage：true = 新增写字典（C9，全站可见）；false = 仅本项目 + 本机记忆。 */
  canManageDict: boolean;
  /** 本机记住的自定义地区（字典之外的补充项，按加入顺序）。 */
  customRegions: readonly string[];
  /** 新增地区（调用方已做去空格 / 长度 / 逗号校验）；返回失败文案时由弹窗内联展示。 */
  onAdd: (name: string) => Promise<RegionAddResult>;
};

/** 读取本机自定义地区（坏数据一律当空数组：不让它在渲染期抛错）。 */
export function loadCustomRegions(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === "") {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  } catch {
    return [];
  }
}

/** 记住一个自定义地区（去重、追加到末尾），返回更新后的完整列表。 */
export function rememberCustomRegion(name: string): string[] {
  const next = loadCustomRegions();
  if (!next.includes(name)) {
    next.push(name);
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式 / 配额满：只影响「下次还能直接选」，不影响本次提交（本项目地区值照常落库）
  }
  return next;
}
