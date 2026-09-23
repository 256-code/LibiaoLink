/**
 * 数据字典（C9-01 · A3）：GET /api/v1/dicts 一期两类 —— region（地区）/ projectType（项目类型）。
 * 项目类型主题色随条目 metadata.accent / accentText 下发，前端不硬编码（《前端功能需求》§3.2 / §二.1）。
 * 契约 shared/src/modules/dicts.ts：普通用户只拿到 enabled=true 的项；阶段 / 成果文件类型 / 紧急重要度是契约枚举，不走本接口。
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

type DictListResponse = { items: Array<{ type: string; items: DictItem[] }> };

/** 拉全量字典（登录后一次）；调用方失败时回落 EMPTY_DICTS，页面继续可用（下拉退化为空、卡片用兜底色）。 */
export async function loadDicts(): Promise<Dicts> {
  const payload = await apiRequest<DictListResponse>("/api/v1/dicts");
  const next: Dicts = { region: [], projectType: [] };
  for (const dict of payload.items) {
    if (dict.type !== "region" && dict.type !== "projectType") {
      continue;
    }
    next[dict.type] = dict.items.slice().sort((left, right) => left.sort - right.sort);
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
 * 新增字典条目（仅管理员 · dict.manage · C9-02）：POST /api/v1/dicts/{type}/items。
 * 响应 = 更新后的整个字典，前端直接替换缓存（不本地拼接：库内顺序 / updatedAt 以服务端为准）；
 * 码重复 409 DICT_ITEM_EXISTS、无权限 403 由调用方分支提示。
 */
export async function createDictItem(
  type: DictTypeCode,
  input: { code: string; name: string; sort: number; enabled: boolean; metadata: Record<string, unknown> },
): Promise<DictItem[]> {
  const dict = await apiSend<{ type: string; items: DictItem[] }>("/api/v1/dicts/" + type + "/items", "POST", input);
  return dict.items.slice().sort((left, right) => left.sort - right.sort);
}

/** 项目类型主题色：取字典 metadata.accent / accentText；缺省回落品牌黄 + 深灰字（浅色底可读）。 */
export function typeAccent(dicts: Dicts, code: string): { color: string; text: string } {
  const item = dicts.projectType.find((entry) => entry.code === code);
  const color = item === undefined ? undefined : item.metadata["accent"];
  const text = item === undefined ? undefined : item.metadata["accentText"];
  return {
    color: typeof color === "string" && color !== "" ? color : "#feca04",
    text: typeof text === "string" && text !== "" ? text : "#313033",
  };
}
