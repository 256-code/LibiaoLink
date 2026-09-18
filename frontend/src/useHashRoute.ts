import { useSyncExternalStore } from "react";

/**
 * 列表页筛选态：URL query 是唯一来源（可分享、可收藏、刷新不丢）。
 * 参数命名与技术设计 v0.2 §8.2（GET /api/v1/projects 与 /projects/facets）同口径，
 * 键名与实际取值见《前端功能需求》§一.3「筛选态与 URL query」。
 */
export type ListQueryState = {
  regions: string[];
  projectTypes: string[];
  managerIds: string[];
  timeFrom: string | null;
  timeTo: string | null;
  q: string;
  sortDesc: boolean;
};

export const EMPTY_LIST_QUERY: ListQueryState = {
  regions: [],
  projectTypes: [],
  managerIds: [],
  timeFrom: null,
  timeTo: null,
  q: "",
  sortDesc: true,
};

export type Route = { kind: "list"; filters: ListQueryState } | { kind: "project"; id: string };

const PROJECT_PATH = /^\/project\/([^/]+)$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

/** 多值参数统一用英文逗号分隔（与契约 filter[...] 同口径）；空值与重复值丢弃。 */
function parseListValue(value: string | null): string[] {
  if (value === null) {
    return [];
  }
  const unique = new Set<string>();
  for (const piece of value.split(",")) {
    const trimmed = piece.trim();
    if (trimmed !== "") {
      unique.add(trimmed);
    }
  }
  return Array.from(unique);
}

/** 日期只接受 YYYY-MM-DD；非法值直接丢弃，不阻塞页面。 */
function parseDayValue(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (!DATE_ONLY.test(trimmed) || Number.isNaN(Date.parse(trimmed + "T00:00:00Z"))) {
    return null;
  }
  return trimmed;
}

/** 解析 hash 里的 query 串（形如 filter[region]=A,B&filter[projectType]=..&filter[managerId]=..&filter[timeFrom]=..&filter[timeTo]=..&q=..&sort=updatedAt:asc）。 */
export function parseListQuery(search: string): ListQueryState {
  const params = new Map<string, string>();
  for (const chunk of search.split("&")) {
    if (chunk === "") {
      continue;
    }
    const separator = chunk.indexOf("=");
    const key = safeDecode(separator === -1 ? chunk : chunk.slice(0, separator));
    if (!params.has(key)) {
      params.set(key, safeDecode(separator === -1 ? "" : chunk.slice(separator + 1)));
    }
  }
  let timeFrom = parseDayValue(params.get("filter[timeFrom]") ?? null);
  let timeTo = parseDayValue(params.get("filter[timeTo]") ?? null);
  if (timeFrom !== null && timeTo !== null && timeFrom > timeTo) {
    const swap = timeFrom;
    timeFrom = timeTo;
    timeTo = swap;
  }
  return {
    regions: parseListValue(params.get("filter[region]") ?? null),
    projectTypes: parseListValue(params.get("filter[projectType]") ?? null),
    managerIds: parseListValue(params.get("filter[managerId]") ?? null),
    timeFrom,
    timeTo,
    q: params.get("q") ?? "",
    sortDesc: (params.get("sort") ?? "") !== "updatedAt:asc",
  };
}

/** 序列化筛选态：默认值不落 URL（排序默认降序省略 sort；时间区间两端齐全才写入）。 */
export function buildListHash(filters: ListQueryState): string {
  const parts: string[] = [];
  const pushList = (key: string, values: string[]): void => {
    if (values.length > 0) {
      parts.push(key + "=" + values.map((value) => encodeURIComponent(value)).join(","));
    }
  };
  pushList("filter[region]", filters.regions);
  pushList("filter[projectType]", filters.projectTypes);
  pushList("filter[managerId]", filters.managerIds);
  if (filters.timeFrom !== null && filters.timeTo !== null) {
    parts.push("filter[timeFrom]=" + encodeURIComponent(filters.timeFrom));
    parts.push("filter[timeTo]=" + encodeURIComponent(filters.timeTo));
  }
  if (filters.q !== "") {
    parts.push("q=" + encodeURIComponent(filters.q));
  }
  if (!filters.sortDesc) {
    parts.push("sort=updatedAt:asc");
  }
  return parts.length === 0 ? "#/" : "#/?" + parts.join("&");
}

export function hasListFilters(filters: ListQueryState): boolean {
  return (
    filters.regions.length > 0 ||
    filters.projectTypes.length > 0 ||
    filters.managerIds.length > 0 ||
    filters.timeFrom !== null ||
    filters.timeTo !== null
  );
}

export function parseHash(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const separator = raw.indexOf("?");
  const path = separator === -1 ? raw : raw.slice(0, separator);
  const search = separator === -1 ? "" : raw.slice(separator + 1);
  const match = PROJECT_PATH.exec(path);
  if (match) {
    return { kind: "project", id: safeDecode(match[1] ?? "") };
  }
  return { kind: "list", filters: parseListQuery(search) };
}

function readHash(): string {
  return typeof window === "undefined" ? "" : window.location.hash;
}

let currentRoute: Route =
  typeof window === "undefined" ? { kind: "list", filters: EMPTY_LIST_QUERY } : parseHash(window.location.hash);
/** 进入详情页时所处列表页的地址（含筛选态）：顶栏与返回按钮据此还原列表页。 */
let listReturnHash: string | null = null;
let cameFromList = false;
let retryTimer: number | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function applyHash(hash: string): void {
  const fromList = currentRoute.kind === "list";
  const next = parseHash(hash);
  cameFromList = next.kind === "project" && fromList;
  currentRoute = next;
  emit();
}

function handleHashChange(): void {
  applyHash(readHash());
}

/** 把当前列表筛选态写回地址栏：replaceState 不产生历史条目、也不触发 hashchange。 */
function flushHash(): void {
  if (currentRoute.kind !== "list") {
    return;
  }
  const hash = buildListHash(currentRoute.filters);
  try {
    window.history.replaceState(null, "", hash);
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
  } catch {
    // 个别浏览器对 history 调用限流（如 Safari）；URL 只是筛选态的投影，内存状态不受影响，稍后重试一次
    if (retryTimer === null) {
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        flushHash();
      }, 400);
    }
  }
}

function subscribe(listener: () => void): () => void {
  if (!installed) {
    installed = true;
    window.addEventListener("hashchange", handleHashChange);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Route {
  return currentRoute;
}

export function useHashRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** 更新筛选态：同步渲染并写入 URL（replace，不新增历史条目）。 */
export function replaceListQuery(filters: ListQueryState): void {
  currentRoute = { kind: "list", filters };
  emit();
  flushHash();
}

export function openProject(id: string): void {
  listReturnHash = currentRoute.kind === "list" ? buildListHash(currentRoute.filters) : null;
  cameFromList = false;
  window.location.hash = "/project/" + encodeURIComponent(id);
}

/** 顶栏 logo 与「项目空间」的落点：列表页原地不动（保留筛选态），详情页回到进入前的列表地址。 */
export function listHref(): string {
  return currentRoute.kind === "list" ? buildListHash(currentRoute.filters) : listReturnHash ?? "#/";
}

/** 返回项目列表：优先回退历史（保留进入前的筛选态），其次跳到记录下来的列表地址。 */
export function goBackToList(): void {
  if (currentRoute.kind === "list") {
    return;
  }
  if (cameFromList) {
    cameFromList = false;
    window.history.back();
    return;
  }
  window.location.hash = (listReturnHash ?? "#/").slice(1);
}
