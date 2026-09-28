/**
 * 入口页世界地图 SVG 路径生成（一次性脚本；运行需联网，产物入库 —— 构建与运行时不联网）。
 * 数据源：
 *   ① 世界国界：Natural Earth 1:110m Admin 0（public domain），经 world-atlas@2 打包为 TopoJSON；
 *   ② 中国国界（中国标准地图口径：含台湾、藏南、阿克赛钦、钓鱼岛）+ 南海断续线：阿里云 DataV GeoAtlas（areas_v3）；
 *   ③ 中文国名：world-countries（MIT）。
 * 中国口径修正（本脚本内逐条登记，改口径只改这里）：
 *   ① 台湾并入中国：中国国界整份取 DataV 口径，Natural Earth 的 China / Taiwan 两份都不再用；
 *   ② 中国不承认的实体并回母国：科索沃→塞尔维亚、北塞浦路斯→塞浦路斯、索马里兰→索马里；
 *   ③ 克里米亚从俄罗斯摘出、并入乌克兰（中国不承认并入俄罗斯）；
 *   ④ 南海断续线（十段）单独导出一份，由前端按线描出（不参与逐国悬停）。
 * 微国符号层：110m 精度画不出的主权微国（新加坡、巴林、马耳他……）按形心单独导出一份点位，前端画成可触碰的小圆点。
 * 南海诸岛符号层：视口里岛礁本体不到 1px，按标准地图习惯点出来 —— **只点群岛、不逐岛列**（业务口径「细小的岛屿不用列」），一个群岛一个点，触碰报「中国」。
 * 用法：cd frontend && node scripts/generate-world-map.mjs
 */
import { writeFileSync } from "node:fs";

const NL = String.fromCharCode(10);
const BOUNDARY_SOURCE = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const NAME_SOURCE = "https://cdn.jsdelivr.net/npm/world-countries@5.1.0/countries.json";
const CHINA_SOURCE = "https://geo.datav.aliyun.com/areas_v3/bound/100000.json";
const CHINA_DASHLINE_SOURCE = "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json";
const CHINA_DASHLINE_ADCODE = "100000_JD";
const OUT = "src/data/worldMap.ts";
// 视口：等距圆柱（equirectangular）投影 —— 经度 -180~180 满铺 WIDTH 宽，纬度 LAT_TOP ~ LAT_BOTTOM（不画南极，与参考稿一致）
const WIDTH = 1000;
const LAT_TOP = 84;
const LAT_BOTTOM = -58;
const SCALE = WIDTH / 360;
const HEIGHT = Math.round((LAT_TOP - LAT_BOTTOM) * SCALE * 10) / 10;
// 小岛过滤阈值（视口单位面积）与生成文件的字符串分行长度
const MIN_RING_AREA = 1.5;
const CHUNK = 6000;
// DataV 的中国国界是高精度矢量（7134 点），按视口比例抽稀；0.08° ≈ 0.22 视口单位，肉眼无差
const SIMPLIFY_TOLERANCE = 0.08;
// 110m 边界里三块没有 ISO 数字码的实体：中文名手工补，英文名沿用数据源
// 中文名按中国大陆口径修正：world-countries 的词条里混着台译 / 繁体 / 张冠李戴（多明尼加、北馬其頓、法国南部和南极土地；多米尼克被写成了「多米尼加」……），
// 以及中国官方叫法与数据源不同的条目（福克兰群岛 → 马尔维纳斯群岛）；属地按标准地图习惯标出宗主国
const ZH_OVERRIDE = {
  "Dem. Rep. Congo": "刚果（金）",
  Congo: "刚果（布）",
  "Dominican Rep.": "多米尼加",
  Macedonia: "北马其顿",
  "Fr. S. Antarctic Lands": "法属南部和南极领地",
  "Falkland Is.": "马尔维纳斯群岛（福克兰群岛）",
  "Puerto Rico": "波多黎各（美）",
  Greenland: "格陵兰（丹）",
  "New Caledonia": "新喀里多尼亚（法）",
  Dominica: "多米尼克",
  Micronesia: "密克罗尼西亚联邦"
};
// 中国口径修正表（见文件头说明）
const REPLACED_BY_CHINA = ["China", "Taiwan"];
const MERGE_INTO = { Kosovo: "Serbia", "N. Cyprus": "Cyprus", Somaliland: "Somalia" };
const CRIMEA = { from: "Russia", to: "Ukraine", box: [30, 43, 40, 47] };
const CHINA_ID = "156";
// 钓鱼岛及其附属岛屿：世界尺度下小到看不见（远小于 1px），但按中国标准地图口径保留在数据里、不按碎岛裁掉
const KEEP_SMALL_BOXES = [[122.8, 25.4, 125.2, 26.2]];
// 南海诸岛符号层：视口里岛礁本体都不到 1px（过不了 MIN_RING_AREA），按中国标准地图的习惯点出来。
// 口径（业务 2026-09-24「细小的岛屿不用列 总体对就可以了」）：**只点群岛、不逐岛列** —— 一个群岛一个点，
// 点位 = 该群岛范围内所有岛礁环的形心（取自同一份中国国界，不手写坐标）。
// 断续线段在国界里又重复画了一遍（与 JD 那份同形），按包围盒重合剔掉，免得把线段当成岛。
const NANHAI_GROUPS = [
  { name: "东沙群岛", box: [116.5, 20.5, 117.1, 21.0] },
  { name: "西沙群岛", box: [110.8, 15.5, 113.0, 17.3] },
  { name: "中沙群岛", box: [113.5, 14.8, 118.3, 16.7] },
  { name: "南沙群岛", box: [108.9, 6.8, 118.2, 12.2] },
  { name: "南沙南部（曾母暗沙一带）", box: [111.4, 3.2, 113.1, 6.2] }
];
const NANHAI_BOX_TOLERANCE = 0.02;
const EXPECTED_NANHAI_ISLANDS = 5;
// 微国符号层：110m 国界（约 1:1.1 亿）画不出新加坡这一档的主权国 —— 本体比图上最小的一块还小，新加坡还整个并进了马来西亚那块。
// 判定口径 = world-countries 里 independent 的主权国 交 110m 里没有几何的国家；台湾不在其列（world-countries 里 independent=false）。
// DENY 再兜一道：上游数据哪天把不该有的实体标成独立国，这里直接报错，不许悄悄冒出一个国家。
const MICRO_STATE_DENY = ["TWN", "XKX"];
const MICRO_STATE_FORBIDDEN_ZH = ["台湾", "臺灣", "科索沃", "北塞浦路斯", "索马里兰"];
// 审查过的条数：上游一变就报错，逼人重审（口径清单见 docs/入口页地图口径审查(中国标准地图·前端).md）
const EXPECTED_MICRO_STATES = 29;

const topology = await (await fetch(BOUNDARY_SOURCE)).json();
const nameRecords = await (await fetch(NAME_SOURCE)).json();
const nameIndex = new Map();
for (const record of nameRecords) {
  nameIndex.set(String(record.ccn3).padStart(3, "0"), record.translations.zho.common);
}

const [scaleX, scaleY] = topology.transform.scale;
const [translateX, translateY] = topology.transform.translate;

const arcs = topology.arcs.map((arc) => {
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * scaleX + translateX, y * scaleY + translateY];
  });
});

function toRingPoints(ring) {
  const points = [];
  for (const index of ring) {
    const arc = index >= 0 ? arcs[index] : arcs[~index].slice().reverse();
    for (let i = points.length === 0 ? 0 : 1; i < arc.length; i += 1) {
      points.push(arc[i]);
    }
  }
  return points;
}

function toView(point) {
  return [(point[0] + 180) * SCALE, (LAT_TOP - point[1]) * SCALE];
}

function ringArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** GeoJSON 的环首尾同点，这里统一去掉重复的末点（下游按隐含闭合处理）。 */
function openRing(ring) {
  const points = ring.map((pair) => [pair[0], pair[1]]);
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) {
    points.pop();
  }
  return points;
}

/** 环的经纬度包围盒。 */
function lonLatBox(points) {
  let minLon = 1e9;
  let maxLon = -1e9;
  let minLat = 1e9;
  let maxLat = -1e9;
  for (const point of points) {
    minLon = Math.min(minLon, point[0]);
    maxLon = Math.max(maxLon, point[0]);
    minLat = Math.min(minLat, point[1]);
    maxLat = Math.max(maxLat, point[1]);
  }
  return [minLon, minLat, maxLon, maxLat];
}

/** 盒子里套盒子（判断某个环是否整段落在保留小岛的海域里）。 */
function boxContains(box, inner) {
  return inner[0] >= box[0] && inner[1] >= box[1] && inner[2] <= box[2] && inner[3] <= box[3];
}

/** Douglas-Peucker 抽稀（度）；DataV 的高精度国界只留视口看得出来的折点。 */
function simplifyRing(points, tolerance) {
  if (points.length <= 4) {
    return points;
  }
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let maxDistance = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const dx = points[last][0] - points[first][0];
      const dy = points[last][1] - points[first][1];
      const length = Math.sqrt(dx * dx + dy * dy);
      const distance = length === 0
        ? Math.sqrt(Math.pow(points[i][0] - points[first][0], 2) + Math.pow(points[i][1] - points[first][1], 2))
        : Math.abs(dy * points[i][0] - dx * points[i][1] + points[last][0] * points[first][1] - points[last][1] * points[first][0]) / length;
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }
    if (maxDistance > tolerance && index > 0) {
      keep[index] = true;
      stack.push([first, index]);
      stack.push([index, last]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    if (keep[i]) {
      out.push(points[i]);
    }
  }
  return out;
}

/**
 * 跨 180 度经线的环：在经线处切开，两端各自沿地图边闭合。
 * 不切的话 Z 会把环首尾直连，图上就会多出一条横贯全图的假边（斐济 / 俄罗斯 / 弗兰格尔岛三处）。
 */
function splitWrappedRing(points) {
  const pieces = [];
  let current = [];
  let wrapped = false;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const next = points[(i + 1) % points.length];
    current.push(point);
    const delta = next[0] - point[0];
    if (Math.abs(delta) <= 180) {
      continue;
    }
    wrapped = true;
    const edgeLon = delta > 0 ? -180 : 180;
    const step = delta > 0 ? -360 : 360;
    const denominator = next[0] + step - point[0];
    const ratio = denominator === 0 ? 0 : (edgeLon - point[0]) / denominator;
    const lat = point[1] + (next[1] - point[1]) * ratio;
    current.push([edgeLon, lat]);
    pieces.push(current);
    current = [[-edgeLon, lat]];
  }
  current.push(points[0]);
  pieces.push(current);
  if (wrapped) {
    const first = pieces.shift();
    pieces[pieces.length - 1] = pieces[pieces.length - 1].concat(first);
  }
  return pieces;
}

function toPath(points) {
  const rounded = [];
  let previous = "";
  for (const point of points) {
    const view = toView(point);
    const px = Math.round(view[0] * 10) / 10;
    const py = Math.round(view[1] * 10) / 10;
    const key = px + "," + py;
    if (key === previous) {
      continue;
    }
    previous = key;
    rounded.push([px, py]);
  }
  if (rounded.length < 4) {
    return "";
  }
  let d = "M" + rounded[0][0] + " " + rounded[0][1];
  for (let i = 1; i < rounded.length; i += 1) {
    d += "L" + rounded[i][0] + " " + rounded[i][1];
  }
  return d + "Z";
}

/** 一个国家的几何 = 一组环（经纬度）；按国名归拢，便于并国 / 移块 / 替换。 */
const ringsByCountry = new Map();
for (const geometry of topology.objects.countries.geometries) {
  const name = geometry.properties.name;
  if (REPLACED_BY_CHINA.indexOf(name) >= 0) {
    continue;
  }
  const list = ringsByCountry.get(name) === undefined ? [] : ringsByCountry.get(name);
  const polygons = geometry.type === "MultiPolygon" ? geometry.arcs : [geometry.arcs];
  for (const polygon of polygons) {
    for (const ring of polygon.map(toRingPoints)) {
      list.push(ring);
    }
  }
  ringsByCountry.set(name, list);
}

const appliedFixes = [];
// 中国不承认的实体：并回母国（科索沃→塞尔维亚、北塞浦路斯→塞浦路斯、索马里兰→索马里）
for (const from of Object.keys(MERGE_INTO)) {
  const to = MERGE_INTO[from];
  const source = ringsByCountry.get(from);
  const target = ringsByCountry.get(to);
  if (source === undefined || target === undefined) {
    throw new Error("并国失败，找不到 " + from + " 或 " + to);
  }
  for (const ring of source) {
    target.push(ring);
  }
  ringsByCountry.delete(from);
  appliedFixes.push(from + " → " + to);
}

// 克里米亚：整块从俄罗斯摘出、并入乌克兰（按包围盒识别，避免写死几何下标）
const russia = ringsByCountry.get(CRIMEA.from);
const ukraine = ringsByCountry.get(CRIMEA.to);
if (russia === undefined || ukraine === undefined) {
  throw new Error("克里米亚改划失败：找不到俄罗斯或乌克兰");
}
const keptRussian = [];
let movedCrimea = 0;
for (const ring of russia) {
  const box = lonLatBox(ring);
  const inside = box[0] >= CRIMEA.box[0] && box[1] >= CRIMEA.box[1] && box[2] <= CRIMEA.box[2] && box[3] <= CRIMEA.box[3];
  if (inside) {
    ukraine.push(ring);
    movedCrimea += 1;
  } else {
    keptRussian.push(ring);
  }
}
if (movedCrimea !== 1) {
  throw new Error("克里米亚改划异常：命中的多边形数 = " + movedCrimea + "（应为 1）");
}
ringsByCountry.set(CRIMEA.from, keptRussian);
appliedFixes.push("克里米亚 " + CRIMEA.from + " → " + CRIMEA.to);

// 中国国界（标准地图口径）：整份替换 Natural Earth 的 China / Taiwan，含台湾、藏南、阿克赛钦、钓鱼岛
const chinaOutline = await (await fetch(CHINA_SOURCE)).json();
const chinaRings = [];
const chinaRawRings = [];
for (const feature of chinaOutline.features) {
  const polygons = feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates : [feature.geometry.coordinates];
  for (const polygon of polygons) {
    const ring = openRing(polygon[0]);
    const box = lonLatBox(ring);
    // 小岛（钓鱼岛这类）不做抽稀：抽稀会把整个小环抽没，标准地图口径要求它在数据里
    chinaRings.push(Math.max(box[2] - box[0], box[3] - box[1]) < 0.5 ? ring : simplifyRing(ring, SIMPLIFY_TOLERANCE));
    chinaRawRings.push({ ring: ring, box: box });
  }
}
ringsByCountry.set("China", chinaRings);
appliedFixes.push("中国国界取中国标准地图口径（Natural Earth 的 China / Taiwan 弃用）");

// 南海断续线（十段）：单列一份，不参与逐国悬停；抽稀会把细段抽没，所以保留原始点
const chinaFull = await (await fetch(CHINA_DASHLINE_SOURCE)).json();
const dashFeature = chinaFull.features.find((feature) => feature.properties && feature.properties.adcode === CHINA_DASHLINE_ADCODE);
if (dashFeature === undefined) {
  throw new Error("没找到南海断续线：" + CHINA_DASHLINE_ADCODE);
}
const dashRings = dashFeature.geometry.coordinates.map((polygon) => openRing(polygon[0]));

// 南海诸岛符号层：只点群岛（业务口径「细小的岛屿不用列」），一个群岛一个点 —— 点位是该群岛范围内所有岛礁环的形心。
const dashBoxes = dashRings.map(lonLatBox);
const nanhaiIslands = [];
for (const group of NANHAI_GROUPS) {
  let sumLon = 0;
  let sumLat = 0;
  let points = 0;
  let rings = 0;
  for (const raw of chinaRawRings) {
    const box = raw.box;
    if (box[0] < group.box[0] || box[1] < group.box[1] || box[2] > group.box[2] || box[3] > group.box[3]) {
      continue;
    }
    const hitsDash = dashBoxes.some((dashBox) => Math.abs(dashBox[0] - box[0]) <= NANHAI_BOX_TOLERANCE && Math.abs(dashBox[1] - box[1]) <= NANHAI_BOX_TOLERANCE && Math.abs(dashBox[2] - box[2]) <= NANHAI_BOX_TOLERANCE && Math.abs(dashBox[3] - box[3]) <= NANHAI_BOX_TOLERANCE);
    if (hitsDash) {
      continue;
    }
    for (const point of raw.ring) {
      sumLon += point[0];
      sumLat += point[1];
      points += 1;
    }
    rings += 1;
  }
  if (rings === 0) {
    throw new Error("南海诸岛符号找不到岛礁环：" + group.name);
  }
  const view = toView([sumLon / points, sumLat / points]);
  nanhaiIslands.push({ x: Math.round(view[0] * 10) / 10, y: Math.round(view[1] * 10) / 10 });
  console.log("南海诸岛符号 " + group.name + "：岛礁环 " + rings + " 个 / " + points + " 点 -> " + String(nanhaiIslands[nanhaiIslands.length - 1].x) + "," + String(nanhaiIslands[nanhaiIslands.length - 1].y));
}

nanhaiIslands.sort((a, b) => a.y - b.y || a.x - b.x);
if (nanhaiIslands.length !== EXPECTED_NANHAI_ISLANDS) {
  throw new Error("南海诸岛符号条数变了：算出 " + nanhaiIslands.length + "，审查过的是 " + EXPECTED_NANHAI_ISLANDS + " —— 重审后再改 EXPECTED_NANHAI_ISLANDS");
}
appliedFixes.push("南海诸岛符号 " + nanhaiIslands.length + " 点（群岛各一点：东沙 / 西沙 / 中沙 / 南沙 / 南沙南部·曾母暗沙一带；视口里岛礁本体不到 1px，按标准地图习惯点出来，触碰报中国）");

const idByName = new Map();
for (const geometry of topology.objects.countries.geometries) {
  idByName.set(geometry.properties.name, String(geometry.id === undefined ? "" : geometry.id));
}

const countries = [];
let droppedRings = 0;
let splitRings = 0;
let skippedRings = 0;
for (const [name, rings] of ringsByCountry) {
  const pieces = [];
  for (const ring of rings) {
    let maxLat = -90;
    for (const point of ring) {
      if (point[1] > maxLat) {
        maxLat = point[1];
      }
    }
    if (maxLat < LAT_BOTTOM) {
      skippedRings += 1;
      continue;
    }
    pieces.push({ ring: ring, area: ringArea(ring.map(toView)) });
  }
  if (pieces.length === 0) {
    continue;
  }
  // 视口下面积不足 MIN_RING_AREA 的碎岛不画；整国都碎则保最大的一块，避免国家整个消失
  const kept = pieces.filter((item) => item.area >= MIN_RING_AREA || KEEP_SMALL_BOXES.some((box) => boxContains(box, lonLatBox(item.ring))));
  const chosen = kept.length > 0 ? kept : [pieces.slice().sort((a, b) => b.area - a.area)[0]];
  droppedRings += pieces.length - chosen.length;
  const subpaths = [];
  for (const item of chosen) {
    const split = splitWrappedRing(item.ring);
    if (split.length > 1) {
      splitRings += 1;
    }
    for (const piece of split) {
      const d = toPath(piece);
      if (d !== "") {
        subpaths.push(d);
      }
    }
  }
  if (subpaths.length === 0) {
    continue;
  }
  const id = name === "China" ? CHINA_ID : idByName.get(name) === undefined ? "" : idByName.get(name);
  const nameZh = ZH_OVERRIDE[name] === undefined ? nameIndex.get(String(id).padStart(3, "0")) === undefined ? name : nameIndex.get(String(id).padStart(3, "0")) : ZH_OVERRIDE[name];
  countries.push({ id: id, name: name, nameZh: nameZh, d: subpaths.join("") });
}

// 画序：中国放最后 —— 藏南等争议块与中国国界重叠时，中国压在下面算赢（悬停认中国）
countries.sort((a, b) => (a.name === "China" ? 1 : 0) - (b.name === "China" ? 1 : 0));

// 微国符号：110m 精度画不出的主权国家（新加坡、巴林、马耳他……），按数据源的形心补一个点符号
const drawnIds = new Set();
for (const geometry of topology.objects.countries.geometries) {
  drawnIds.add(String(geometry.id === undefined ? "" : geometry.id));
}
const drawnNamesZh = new Set();
for (const country of countries) {
  drawnNamesZh.add(country.nameZh);
}
const microStates = [];
for (const record of nameRecords) {
  if (record.independent !== true || drawnIds.has(String(record.ccn3))) {
    continue;
  }
  if (MICRO_STATE_DENY.indexOf(record.cca3) >= 0) {
    throw new Error("微国符号命中不该出现的主权实体：" + record.cca3);
  }
  const id = String(record.ccn3).padStart(3, "0");
  const nameZh = ZH_OVERRIDE[record.name.common] === undefined ? nameIndex.get(id) : ZH_OVERRIDE[record.name.common];
  if (nameZh === undefined) {
    throw new Error("微国符号缺中文名：" + record.cca3);
  }
  if (MICRO_STATE_FORBIDDEN_ZH.indexOf(nameZh) >= 0) {
    throw new Error("微国符号命中不该出现的中文名：" + nameZh);
  }
  if (drawnNamesZh.has(nameZh)) {
    throw new Error("微国符号与已画的国家重名：" + nameZh);
  }
  const latlng = record.latlng;
  if (Array.isArray(latlng) !== true || latlng.length !== 2) {
    throw new Error("微国符号缺形心坐标：" + record.cca3);
  }
  const view = toView([latlng[1], latlng[0]]);
  if (view[0] < 0 || view[0] > WIDTH || view[1] < 0 || view[1] > HEIGHT) {
    throw new Error("微国符号落在视口外：" + nameZh);
  }
  microStates.push({ id: id, name: record.name.common, nameZh: nameZh, x: Math.round(view[0] * 10) / 10, y: Math.round(view[1] * 10) / 10 });
}
if (microStates.length !== EXPECTED_MICRO_STATES) {
  throw new Error("微国条数变了：算出 " + microStates.length + "，审查过的是 " + EXPECTED_MICRO_STATES + " —— 重审后再改 EXPECTED_MICRO_STATES");
}
appliedFixes.push("微国符号 " + microStates.length + " 国（110m 画不出的主权国补形心点位）");

const dashPaths = [];
for (const ring of dashRings) {
  const d = toPath(ring);
  if (d !== "") {
    dashPaths.push(d);
  }
}
if (dashPaths.length !== dashRings.length) {
  throw new Error("南海断续线有段没生成出来：" + dashPaths.length + " / " + dashRings.length);
}

const body = countries.map((country) => country.d).join("") + dashPaths.join("");
if (body.includes("NaN") || body.includes("Infinity")) {
  throw new Error("生成的路径里出现了 NaN / Infinity —— 检查跨经线切分的插值");
}

/** 单个字段的字面量：短的一行写完；超长的按 CHUNK 切段用 + 拼接（文件好读、diff 稳）。 */
const literalOf = (value) => {
  if (value.length <= CHUNK) {
    return JSON.stringify(value);
  }
  const chunks = [];
  for (let start = 0; start < value.length; start += CHUNK) {
    chunks.push(value.slice(start, start + CHUNK));
  }
  return chunks.map((chunk) => JSON.stringify(chunk)).join(" +" + NL + "    ");
};

const lines = [
  "/**",
  " * 入口页世界地图的国家路径（等距圆柱投影），一个国家一条闭合路径。",
  " * 本文件由 scripts/generate-world-map.mjs 生成，请勿手改；",
  " * 数据源：Natural Earth 1:110m Admin 0（public domain，经 world-atlas@2 打包）＋ 中国国界与南海断续线取",
  " * 阿里云 DataV GeoAtlas（中国标准地图口径）＋ world-countries（MIT）中文国名。",
  " * 微国符号层：110m 精度画不出的主权国家（新加坡、巴林、马耳他……）按形心单独出一份点位（WORLD_MAP_MICRO_STATES）。",
  " * 南海诸岛符号层：视口里岛礁本体不足 1px，按标准地图习惯点出来 —— 只点群岛（东沙 / 西沙 / 中沙 / 南沙 / 南沙南部·曾母暗沙一带 各一点，WORLD_MAP_NANHAI_ISLANDS）。",
  " * 中国口径修正（生成时已应用）：" + appliedFixes.join("；") + "。",
  " * 视口 " + WIDTH + " x " + HEIGHT + "：经度 -180 ~ 180 满铺，纬度 " + LAT_TOP + " ~ " + LAT_BOTTOM + "（不含南极，与参考稿一致）。",
  " */",
  "export const WORLD_MAP_VIEW = { width: " + WIDTH + ", height: " + HEIGHT + ", latTop: " + LAT_TOP + ", latBottom: " + LAT_BOTTOM + " } as const;",
  "",
  "/** 单个国家：id 为 ISO 3166-1 数字码（少数无码实体为空串），nameZh 为中文名；d 已含海外岛屿与跨经线切分。 */",
  "export type WorldMapCountry = {",
  "  readonly id: string;",
  "  readonly name: string;",
  "  readonly nameZh: string;",
  "  readonly d: string;",
  "};",
  "",
  "/** 按画序排列：中国在最后，与争议地区重叠时压在最上层（悬停认中国）。 */",
  "export const WORLD_MAP_COUNTRIES: readonly WorldMapCountry[] = [",
  ...countries.map((country) => "  { id: " + JSON.stringify(country.id) + ", name: " + JSON.stringify(country.name) + ", nameZh: " + JSON.stringify(country.nameZh) + ", d: " + literalOf(country.d) + " },"),
  "];",
  "",
  "/** 微国符号：110m 国界精度画不出的主权国家（新加坡、巴林、马耳他……）。x / y 为投影后的形心（视口坐标）。 */",
  "export type WorldMapMicroState = {",
  "  readonly id: string;",
  "  readonly name: string;",
  "  readonly nameZh: string;",
  "  readonly x: number;",
  "  readonly y: number;",
  "};",
  "",
  "export const WORLD_MAP_MICRO_STATES: readonly WorldMapMicroState[] = [",
  ...microStates.map((state) => "  { id: " + JSON.stringify(state.id) + ", name: " + JSON.stringify(state.name) + ", nameZh: " + JSON.stringify(state.nameZh) + ", x: " + state.x + ", y: " + state.y + " },"),
  "];",
  "",
  "/** 南海诸岛符号：一个群岛一个点（东沙 / 西沙 / 中沙 / 南沙 / 南沙南部·曾母暗沙一带），点位是该群岛岛礁环的形心（取自 DataV 中国国界，不手写坐标）。 */",
  "export type WorldMapIslandDot = {",
  "  readonly x: number;",
  "  readonly y: number;",
  "};",
  "",
  "export const WORLD_MAP_NANHAI_ISLANDS: readonly WorldMapIslandDot[] = [",
  ...nanhaiIslands.map((island) => "  { x: " + island.x + ", y: " + island.y + " },"),
  "];",
  "",
  "/** 南海断续线（十段，中国标准地图口径）：又细又长的面，前端按线描（stroke、不 fill、不参与悬停）。 */",
  "export const WORLD_MAP_DASHLINE_PATHS: readonly string[] = [",
  ...dashPaths.map((d) => "  " + literalOf(d) + ","),
  "];",
  ""
];

writeFileSync(OUT, lines.join(NL), "utf8");
console.log("countries=" + countries.length + " chars=" + body.length + " droppedRings=" + droppedRings + " splitRings=" + splitRings + " skippedRings=" + skippedRings + " micro=" + microStates.length + " nanhai=" + nanhaiIslands.length + " dash=" + dashPaths.length + " viewHeight=" + HEIGHT + " -> " + OUT);
console.log("修正：" + appliedFixes.join(" | "));

