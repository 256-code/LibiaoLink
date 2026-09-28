/**
 * 地区 → 洲（Push 192）：首页筛选侧栏的「地区」段与新建 / 编辑项目的地区下拉都按洲分组（下拉另带搜索）。
 * 口径与地图同一套，不另起一套国名：
 *   ① 地区名先经 src/data/mapProjects.ts 的 matchRegion 认国家（先精确对中文名 / 英文名，再宽松对 —— 与地图悬停同一套）；
 *   ② 再用该国的 ISO 数字码查 src/data/worldMapContinents.ts（生成物，数据源 world-countries，与底图中文名同源）；
 *   ③ 认不出国家的地区（「海外」「中东」这类通用条目 / 自建地区）归「其他」；中国国内大区（华北 / 华东…）跟中国同归「亚洲」。
 * 业务口径（2026-09-28）：「我觉得这里太乱了 要根据各个州分类 可以展开」「新建项目选择地区应该也要改 是不是要加一个国家地区选择器可搜索的那种」。
 */
import { matchRegion } from "./mapProjects";
import { WORLD_MAP_COUNTRIES, WORLD_MAP_MICRO_STATES } from "./worldMap";
import { REGION_CONTINENT_OF_ISO, REGION_CONTINENT_ORDER } from "./worldMapContinents";

/** 归不进任何一洲的兜底组（排在最后）。 */
export const REGION_CONTINENT_OTHER = "其他";

/** 分组展示顺序：六大洲（生成物里的顺序）+「其他」。 */
export const REGION_CONTINENT_GROUPS: readonly string[] = [...REGION_CONTINENT_ORDER, REGION_CONTINENT_OTHER];

/** 中国国内大区：不是国家，但跟中国同归亚洲（地区字典里的通用条目）。 */
const CHINA_DOMESTIC_REGIONS: readonly string[] = ["华北", "华东", "华南", "华中", "西南", "西北", "东北"];

/** 单个地区的洲；认不出国家 → 「其他」。 */
export function continentOfRegion(name: string, code = ""): string {
  const wanted = name.trim() === "" ? code.trim() : name.trim();
  if (CHINA_DOMESTIC_REGIONS.indexOf(wanted) >= 0) {
    return "亚洲";
  }
  const hit = matchRegion(name, code);
  if (hit === null) {
    return REGION_CONTINENT_OTHER;
  }
  return REGION_CONTINENT_OF_ISO[hit.kind === "country" ? hit.country.id : hit.micro.id] ?? REGION_CONTINENT_OTHER;
}

/** 地区下拉搜索用的可搜文本：地区名 + 英文国名（如输入 United 能搜到「美国」）。 */
export function regionSearchText(name: string): string {
  const hit = matchRegion(name, "");
  if (hit === null) {
    return name;
  }
  return name + " " + (hit.kind === "country" ? hit.country.name : hit.micro.name);
}

/** 一个洲分组：continent = 洲名（含兜底「其他」），items = 该洲下的条目（组内保持入参顺序）。 */
export type ContinentGroup<T> = {
  readonly continent: string;
  readonly items: readonly T[];
};

/**
 * 「添加地区」搜索选择器的候选（Push 193）：标准国家 / 微国名 —— 与地图 / 洲归属同一份数据，
 * 新建地区不再手打（手打容易写出地图认不出的名字）。中英文都能搜；已收录的条目由下拉本体给出，候选里不再重复列。
 * 业务口径（2026-09-28）：「新建地区手打容易出问题吧 还是改成搜索选择器吧」。
 */
export type RegionCandidateOption = { readonly name: string; readonly english: string; readonly group: string };

export const REGION_CANDIDATE_OPTIONS: readonly RegionCandidateOption[] = (() => {
  const rows: RegionCandidateOption[] = [];
  const seen = new Set<string>();
  for (const entry of [...WORLD_MAP_COUNTRIES, ...WORLD_MAP_MICRO_STATES]) {
    if (seen.has(entry.nameZh)) {
      continue;
    }
    seen.add(entry.nameZh);
    rows.push({ name: entry.nameZh, english: entry.name, group: continentOfRegion(entry.nameZh, entry.id) });
  }
  rows.sort((left, right) => {
    const byGroup = REGION_CONTINENT_GROUPS.indexOf(left.group) - REGION_CONTINENT_GROUPS.indexOf(right.group);
    return byGroup !== 0 ? byGroup : left.name.localeCompare(right.name, "zh");
  });
  return rows;
})();

/**
 * 按洲分组：组内保持入参顺序，组间按 REGION_CONTINENT_GROUPS 排（认不出国家的条目落「其他」，永远在最后）；
 * 空组不出现（只列出真的有地区的洲）；locate 给出条目的地区名与地区码（侧栏胶囊 = label / value，字典条目 = name / code）。
 */
export function groupByContinent<T>(
  items: readonly T[],
  locate: (item: T) => { readonly name: string; readonly code: string },
): Array<ContinentGroup<T>> {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const spot = locate(item);
    const continent = continentOfRegion(spot.name, spot.code);
    const bucket = buckets.get(continent);
    if (bucket === undefined) {
      buckets.set(continent, [item]);
    } else {
      bucket.push(item);
    }
  }
  const groups: Array<ContinentGroup<T>> = [];
  for (const continent of REGION_CONTINENT_GROUPS) {
    const bucket = buckets.get(continent);
    if (bucket !== undefined) {
      groups.push({ continent: continent, items: bucket });
    }
  }
  return groups;
}
