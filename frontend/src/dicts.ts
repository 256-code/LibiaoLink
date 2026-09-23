/**
 * 数据字典（C9-01 · A3）：GET /api/v1/dicts 一期两类 —— region（地区）/ projectType（项目类型）。
 * 项目类型主题色随条目 metadata.accent / accentText 下发，前端不硬编码（《前端功能需求》§3.2 / §二.1）。
 * 契约 shared/src/modules/dicts.ts：普通用户只拿到 enabled=true 的项；阶段 / 成果文件类型 / 紧急重要度是契约枚举，不走本接口。
 * Push 172：新增项目类型时从预置色板（DICT_ACCENT_PALETTE，「颜色模板」）选色；删除 = 停用（setDictItemEnabled(false)，C9-02）。
 */
import { apiRequest, apiSend } from "./api";

export type DictTypeCode = "region" | "projectType";

export type DictItem = {
  code: string;
  name: string;
  sort: number;
  enabled: boolean;
  metadata: Record<string, unknown>;
};

export type Dicts = Record<DictTypeCode, DictItem[]>;

export const EMPTY_DICTS: Dicts = { region: [], projectType: [] };

/** 条目名称 / 码上限：契约 code ≤ 64、name ≤ 80；前端两个入口（地区 / 项目类型）统一按 64 收口。 */
export const DICT_NAME_MAX = 64;

type DictListResponse = { items: Array<{ type: string; items: DictItem[] }> };

/**
 * 只保留启用项并按 sort 升序：写接口（POST / PATCH）的响应是**含停用项**的整个字典（服务端 includeDisabled=true），
 * 直接替换缓存会把停用项带回下拉 —— 前端缓存一律过滤掉 enabled=false（停用 = 删除，C9-02）。
 */
function enabledOnly(items: DictItem[]): DictItem[] {
  return items.filter((item) => item.enabled).sort((left, right) => left.sort - right.sort);
}

/** 拉全量字典（登录后一次）；调用方失败时回落 EMPTY_DICTS，页面继续可用（下拉退化为空、卡片用兜底色）。 */
export async function loadDicts(): Promise<Dicts> {
  const payload = await apiRequest<DictListResponse>("/api/v1/dicts");
  const next: Dicts = { region: [], projectType: [] };
  for (const dict of payload.items) {
    if (dict.type !== "region" && dict.type !== "projectType") {
      continue;
    }
    next[dict.type] = enabledOnly(dict.items);
  }
  return next;
}

/** 字典显示名：未知码（停用 / 存量数据）回落码本身，界面不出现空白。 */
export function dictLabel(dicts: Dicts, type: DictTypeCode, code: string): string {
  const item = dicts[type].find((entry) => entry.code === code);
  return item === undefined ? code : item.name;
}

/** 新字典项的排序值：排在现有条目之后（步长 10，与种子 #5 的 10 / 20 / 30… 同口径）。 */
export function nextDictSort(items: readonly DictItem[]): number {
  let maxSort = 0;
  for (const item of items) {
    if (item.sort > maxSort) {
      maxSort = item.sort;
    }
  }
  return maxSort + 10;
}

/**
 * 新增字典条目：POST /api/v1/dicts/{type}/items（C9-02）。region = 任何登录用户（Push 168 业务口径「全站共享」）；
 * projectType 等其余类型 = dict.manage（仅管理员）。响应 = 更新后的整个字典，前端过滤停用项后替换缓存
 * （不本地拼接：库内顺序 / updatedAt 以服务端为准）；码重复 409 DICT_ITEM_EXISTS、无权限 403 由调用方分支提示。
 */
export async function createDictItem(
  type: DictTypeCode,
  input: { code: string; name: string; sort: number; enabled: boolean; metadata: Record<string, unknown> },
): Promise<DictItem[]> {
  const dict = await apiSend<{ type: string; items: DictItem[] }>("/api/v1/dicts/" + type + "/items", "POST", input);
  return enabledOnly(dict.items);
}

/**
 * 停用 / 恢复字典条目（「删除」= 停用，C9-02）：PATCH /api/v1/dicts/{type}/items/{code}（仅管理员 · dict.manage）。
 * 停用不影响存量数据展示（项目仍按原码 / 原名渲染），只是不再出现在下拉候选里；恢复 = enabled: true。
 * 响应 = 含停用项的整个字典，前端过滤后替换缓存。
 */
export async function setDictItemEnabled(type: DictTypeCode, code: string, enabled: boolean): Promise<DictItem[]> {
  const dict = await apiSend<{ type: string; items: DictItem[] }>(
    "/api/v1/dicts/" + type + "/items/" + encodeURIComponent(code),
    "PATCH",
    { enabled },
  );
  return enabledOnly(dict.items);
}

/**
 * 预置色板（「颜色模板」· Push 172）：新增项目类型时选一个 —— 色值 + 徽标文字色成对给出（白字 / 深灰字按底色定对比度），
 * 写进条目 metadata.accent / metadata.accentText。前三项 = 库内已有类型（T-sort / 3D分拣 / 飞箱）的同款取值，
 * 新增类型据此与既有类型同色系；前端不提供自由取色器（业务口径「颜色之前应该有模板」）。
 */
export const DICT_ACCENT_PALETTE = [
  { key: "blue", name: "蓝", color: "#3b82f6", text: "#ffffff" },
  { key: "emerald", name: "绿", color: "#10b981", text: "#ffffff" },
  { key: "amber", name: "品牌黄", color: "#feca04", text: "#313033" },
  { key: "orange", name: "橙", color: "#f97316", text: "#ffffff" },
  { key: "red", name: "红", color: "#ef4444", text: "#ffffff" },
  { key: "violet", name: "紫", color: "#8b5cf6", text: "#ffffff" },
  { key: "cyan", name: "青", color: "#06b6d4", text: "#ffffff" },
  { key: "indigo", name: "靛蓝", color: "#6366f1", text: "#ffffff" },
  { key: "pink", name: "玫红", color: "#ec4899", text: "#ffffff" },
  { key: "lime", name: "草绿", color: "#84cc16", text: "#313033" },
  { key: "slate", name: "石板灰", color: "#64748b", text: "#ffffff" },
] as const;

export type DictAccent = (typeof DICT_ACCENT_PALETTE)[number];

/** 条目的主题色：取 metadata.accent / accentText；缺省或非字符串回落品牌黄 + 深灰字（浅色底可读）。 */
export function accentOfItem(item: DictItem | undefined): { color: string; text: string } {
  const color = item === undefined ? undefined : item.metadata["accent"];
  const text = item === undefined ? undefined : item.metadata["accentText"];
  return {
    color: typeof color === "string" && color !== "" ? color : "#feca04",
    text: typeof text === "string" && text !== "" ? text : "#313033",
  };
}

/** 项目类型主题色：按码取字典条目的 accent / accentText（卡片、类型徽标、色点共用）。 */
export function typeAccent(dicts: Dicts, code: string): { color: string; text: string } {
  return accentOfItem(dicts.projectType.find((entry) => entry.code === code));
}
