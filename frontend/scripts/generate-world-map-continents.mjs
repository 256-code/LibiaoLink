#!/usr/bin/env node
/**
 * 地区 → 洲 映射生成（一次性脚本；运行需联网，产物入库 —— 构建与运行时不联网）。
 * 产物：src/data/worldMapContinents.ts —— ISO 3166-1 数字码 → 洲，键与 src/data/worldMap.ts 的 id 同口径
 *   （国家 172 条 + 微国符号 29 条，少一条本脚本就报错）。
 * 数据源：world-countries（MIT）—— 与底图中文国名同一份数据源，避免再起一套国名 / 洲名口径。
 * 洲口径（中国口径）：亚洲 / 欧洲 / 非洲 / 北美洲 / 南美洲 / 大洋洲；
 *   world-countries 的 region = Americas 再按 subregion 拆：South America → 南美洲，其余（北美 / 中美 / 加勒比）→ 北美洲。
 *   表外实体（南极洲等，视口里不画）不登记 —— 只给图上出现的编码要洲。
 * 用法：cd frontend && node scripts/generate-world-map-continents.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const NL = String.fromCharCode(10);
const NAME_SOURCE = "https://cdn.jsdelivr.net/npm/world-countries@5.1.0/countries.json";
const MAP_FILE = "src/data/worldMap.ts";
const OUT = "src/data/worldMapContinents.ts";
/** 洲名与展示顺序（前端分组按这个顺序排；「其他」是前端兜底组，不在本表里）。 */
const CONTINENTS = ["亚洲", "欧洲", "非洲", "北美洲", "南美洲", "大洋洲"];
/** world-countries 的 region → 洲（Americas 单独按 subregion 拆）。 */
const BY_REGION = { Asia: "亚洲", Europe: "欧洲", Africa: "非洲", Oceania: "大洋洲" };
/** 单独登记的条目：world-countries 把「法属南部和南极领地」归到 Antarctic（视口里画得出它的岛，按属地习惯归非洲）。 */
const CONTINENT_OVERRIDE = { "260": "非洲" };

/** 图上出现的全部编码（国家路径 + 微国符号）：逐个要求有洲，兜住上游数据源漏项。 */
const mapSource = readFileSync(MAP_FILE, "utf8");
const ids = Array.from(new Set(Array.from(mapSource.matchAll(/id: "(\d{3})"/g), (match) => match[1]))).sort();
if (ids.length !== 201) {
  throw new Error("图上的编码数不是 201（172 国 + 29 微国），实际 " + String(ids.length) + "：先复核 worldMap.ts");
}
const wanted = new Set(ids);

const records = await (await fetch(NAME_SOURCE)).json();
const continentByCcn3 = new Map();
for (const record of records) {
  const ccn3 = String(record.ccn3 ?? "");
  if (!/^\d{3}$/.test(ccn3) || ccn3 === "000" || !wanted.has(ccn3)) {
    continue;
  }
  let continent = CONTINENT_OVERRIDE[ccn3];
  if (continent !== undefined) {
    continentByCcn3.set(ccn3, continent);
    continue;
  }
  if (record.region === "Americas") {
    continent = record.subregion === "South America" ? "南美洲" : "北美洲";
  } else {
    continent = BY_REGION[record.region];
  }
  if (continent === undefined) {
    throw new Error("未登记的洲：" + String(record.region) + "（" + String(record.name.common) + "）");
  }
  continentByCcn3.set(ccn3, continent);
}
const missing = ids.filter((id) => !continentByCcn3.has(id));
if (missing.length > 0) {
  throw new Error("图上这些国家 / 微国在数据源里查不到洲：" + missing.join(" / "));
}

const output = [];
output.push("/**");
output.push(" * 地区 → 洲（Push 192：首页筛选侧栏的「地区」与新建 / 编辑项目的地区下拉都按洲分组 + 可搜索）。");
output.push(" * 本文件由 scripts/generate-world-map-continents.mjs 生成，请勿手改；");
output.push(" * 数据源：world-countries（MIT）—— 与 src/data/worldMap.ts 的中文国名同一份数据源，不另起一套口径。");
output.push(" * 键 = ISO 3166-1 数字码（与 worldMap.ts 的 WorldMapCountry.id / WorldMapMicroState.id 同口径）；查不到 → 前端归「其他」。");
output.push(" * 洲口径（中国口径）：亚洲 / 欧洲 / 非洲 / 北美洲 / 南美洲 / 大洋洲（数据源的 Americas 再按 subregion 拆南北）。");
output.push(" */");
output.push("");
output.push("/** 洲名（也是前端分组的展示顺序）。 */");
output.push("export const REGION_CONTINENT_ORDER = [" + CONTINENTS.map((name) => JSON.stringify(name)).join(", ") + "] as const;");
output.push("");
output.push("export type RegionContinent = (typeof REGION_CONTINENT_ORDER)[number];");
output.push("");
output.push("/** ISO 3166-1 数字码 → 洲：图上 201 个国家 / 微国全覆盖（少一个生成时就报错）。 */");
output.push("export const REGION_CONTINENT_OF_ISO: Readonly<Record<string, RegionContinent>> = {");
for (const continent of CONTINENTS) {
  const members = ids.filter((id) => continentByCcn3.get(id) === continent);
  output.push("  // " + continent + "（" + String(members.length) + "）");
  for (const id of members) {
    output.push("  " + JSON.stringify(id) + ": " + JSON.stringify(continent) + ",");
  }
}
output.push("};");
writeFileSync(OUT, output.join(NL) + NL, "utf8");

const summary = CONTINENTS.map((continent) => continent + " " + String(ids.filter((id) => continentByCcn3.get(id) === continent).length)).join(" / ");
console.log("已生成 " + OUT + "：" + String(ids.length) + " 个编码 —— " + summary);
