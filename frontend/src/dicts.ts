/**
 * 数据字典（C9-01 · A3）：GET /api/v1/dicts 一期两类 —— region（地区）/ projectType（项目类型）。
 * 项目类型主题色随条目 metadata.accent / accentText 下发，前端不硬编码（《前端功能需求》§3.2 / §二.1）。
 * 契约 shared/src/modules/dicts.ts：普通用户只拿到 enabled=true 的项；阶段 / 成果文件类型 / 紧急重要度是契约枚举，不走本接口。
 */
import { apiRequest } from "./api";

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

/**
 * 旧链接值换算（Push 161）：Push 159 之前的演示数据地区是**国家名**（中国 / 美国 / 德国 …），
 * 现在的字典 region 是 8 个大区（华东 … 海外）—— 别名表把旧国家名折到「海外」。
 * 例外：「中国」落哪个国内大区无法判定（可能华东也可能西南），不猜、不映射，保留原值
 * （侧栏显示 0 计数胶囊、可一键取消；若业务要「中国 → 未分类」，在此表加一行即可）。
 */
export const LEGACY_REGION_ALIASES: Record<string, string> = {
  美国: "海外",
  德国: "海外",
  日本: "海外",
  英国: "海外",
  法国: "海外",
  韩国: "海外",
  泰国: "海外",
  越南: "海外",
  印度: "海外",
  巴西: "海外",
  智利: "海外",
  秘鲁: "海外",
  希腊: "海外",
  波兰: "海外",
  荷兰: "海外",
  瑞典: "海外",
  瑞士: "海外",
  挪威: "海外",
  南非: "海外",
};

export type DictValueFix = {
  /** 换算后的值（顺序保持；字典未加载时原样返回）。 */
  values: string[];
  /** 是否发生过换算（用于回写地址栏 / 提示）。 */
  changed: boolean;
  /** 具体换算明细（旧值 → 新码），用于提示文案。 */
  mapped: Array<{ from: string; to: string }>;
};

/**
 * 把 URL / 常用筛选里的值换算成字典码：命中码（不区分大小写）→ 命中显示名 → 命中别名表；都不中保持原值。
 * 字典未加载（items 为空）时一律原样返回，避免把条件误判掉。
 */
export function fixDictFilterValues(
  items: DictItem[],
  values: readonly string[],
  aliases: Record<string, string> = {},
): DictValueFix {
  if (items.length === 0) {
    return { values: values.slice(), changed: false, mapped: [] };
  }
  const byCode = new Map<string, string>();
  for (const item of items) {
    byCode.set(item.code, item.code);
    byCode.set(item.code.toLowerCase(), item.code);
    byCode.set(item.name, item.code);
    byCode.set(item.name.toLowerCase(), item.code);
  }
  const next: string[] = [];
  const mapped: Array<{ from: string; to: string }> = [];
  let changed = false;
  for (const raw of values) {
    const value = raw.trim();
    if (value === "") {
      changed = true;
      continue;
    }
    let resolved = byCode.get(value) ?? byCode.get(value.toLowerCase());
    if (resolved === undefined) {
      const alias = aliases[value];
      if (alias !== undefined) {
        resolved = byCode.get(alias) ?? byCode.get(alias.toLowerCase());
      }
    }
    const final = resolved ?? value;
    if (final !== raw) {
      changed = true;
      mapped.push({ from: raw, to: final });
    }
    if (!next.includes(final)) {
      next.push(final);
    } else {
      changed = true;
    }
  }
  return { values: next, changed, mapped };
}
