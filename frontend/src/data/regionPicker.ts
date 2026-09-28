/**
 * 新建 / 编辑项目的「地区」候选（Push 195）：直接存着全部国家 / 地区的模态窗数据源。
 * 业务口径（2026-09-28）：「我的需求是直接改成一个存着所有国家的模态窗 然后用户自己选」。
 * - 候选 = 地区字典启用条目（沿用其码 / 名，存量口径不拆行）＋ 标准国家清单里字典没覆盖到的国家（值 = 中文名）；
 * - 国名与洲口径与地图 / 侧栏同源：清单 = worldMap.ts（中国标准地图口径），洲 = worldMapContinents.ts 生成物，
 *   认国家 = mapProjects.ts 的 matchRegion（台湾不是国家；科索沃 / 北塞浦路斯 / 索马里兰并入主权国家）；
 * - 只做候选、不写字典：选中的值直接落项目 region，地图立柱 / 侧栏筛选用同一套认名规则识别。
 */
import type { DictItem } from "../dicts";
import { matchRegion } from "./mapProjects";
import { REGION_CONTINENT_GROUPS, REGION_CONTINENT_OTHER, continentOfRegion } from "./regionContinents";
import { WORLD_MAP_COUNTRIES, WORLD_MAP_MICRO_STATES } from "./worldMap";
import { REGION_CONTINENT_OF_ISO } from "./worldMapContinents";

/** 一条候选：value = 落项目 region 的值（字典码 / 标准中文国名）；name / en 供展示与搜索。 */
export type RegionPickerOption = {
  readonly value: string;
  readonly name: string;
  readonly en: string;
  readonly continent: string;
  /** 字典条目的项目引用数（「已有项目地区」排序用）；标准国家行恒 0。 */
  readonly usageCount: number;
};

/** 洲间按 REGION_CONTINENT_GROUPS 排；洲内按中文名拼音（zh-Hans-CN 排序规则）。 */
const collator = new Intl.Collator("zh-Hans-CN");

/**
 * 候选构建：字典条目先占位（码可能与标准中文名不同，如「阿联酋 / 阿拉伯联合酋长国」——命中国家的字典条目
 * 以字典行为准，同一国家不拆成两条），再把标准清单里没被覆盖的国家补上。
 */
export function buildRegionPickerOptions(items: readonly DictItem[]): RegionPickerOption[] {
  const options: RegionPickerOption[] = [];
  const seen = new Set<string>();
  const covered = new Set<string>();
  const push = (option: RegionPickerOption): void => {
    if (seen.has(option.value)) {
      return;
    }
    seen.add(option.value);
    options.push(option);
  };
  for (const item of items) {
    const hit = matchRegion(item.name, item.code);
    if (hit !== null) {
      covered.add(hit.kind === "country" ? "country:" + hit.country.id : "micro:" + hit.micro.id);
    }
    const en = hit === null ? "" : hit.kind === "country" ? hit.country.name : hit.micro.name;
    push({ value: item.code, name: item.name, en: en, continent: continentOfRegion(item.name, item.code), usageCount: item.usageCount });
  }
  for (const country of WORLD_MAP_COUNTRIES) {
    if (covered.has("country:" + country.id)) {
      continue;
    }
    push({
      value: country.nameZh,
      name: country.nameZh,
      en: country.name,
      continent: REGION_CONTINENT_OF_ISO[country.id] ?? REGION_CONTINENT_OTHER,
      usageCount: 0,
    });
  }
  for (const micro of WORLD_MAP_MICRO_STATES) {
    if (covered.has("micro:" + micro.id)) {
      continue;
    }
    push({
      value: micro.nameZh,
      name: micro.nameZh,
      en: micro.name,
      continent: REGION_CONTINENT_OF_ISO[micro.id] ?? REGION_CONTINENT_OTHER,
      usageCount: 0,
    });
  }
  const rankOf = (option: RegionPickerOption): number => {
    const index = REGION_CONTINENT_GROUPS.indexOf(option.continent);
    return index < 0 ? REGION_CONTINENT_GROUPS.length : index;
  };
  options.sort((left, right) => rankOf(left) - rankOf(right) || collator.compare(left.name, right.name));
  return options;
}

/**
 * 「已有项目地区」= 有项目在用的条目（usageCount > 0，字典接口 Push 174 起下发）：
 * 按用量降序、同量按名称 —— 常用地区排最前，业务口径「最上方是已有项目地区」。
 */
export function usedRegionPickerOptions(options: readonly RegionPickerOption[]): RegionPickerOption[] {
  return options
    .filter((option) => option.usageCount > 0)
    .sort((left, right) => right.usageCount - left.usageCount || collator.compare(left.name, right.name));
}

/** 搜索：中文名 / 英文名 / 落库值任一段包含关键词（大小写不敏感）。 */
export function searchRegionPickerOptions(
  options: readonly RegionPickerOption[],
  query: string,
): RegionPickerOption[] {
  const keyword = query.trim().toLowerCase();
  if (keyword === "") {
    return options.slice();
  }
  return options.filter((option) => (option.name + " " + option.en + " " + option.value).toLowerCase().indexOf(keyword) >= 0);
}

/** 按洲分组：组序 = REGION_CONTINENT_GROUPS，空组不出现（入参顺序即组内顺序）。 */
export function groupRegionPickerOptions(
  options: readonly RegionPickerOption[],
): Array<{ readonly continent: string; readonly items: readonly RegionPickerOption[] }> {
  const buckets = new Map<string, RegionPickerOption[]>();
  for (const option of options) {
    const bucket = buckets.get(option.continent);
    if (bucket === undefined) {
      buckets.set(option.continent, [option]);
    } else {
      bucket.push(option);
    }
  }
  const groups: Array<{ readonly continent: string; readonly items: readonly RegionPickerOption[] }> = [];
  for (const continent of REGION_CONTINENT_GROUPS) {
    const bucket = buckets.get(continent);
    if (bucket !== undefined) {
      groups.push({ continent: continent, items: bucket });
    }
  }
  return groups;
}
