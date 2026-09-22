import { clearSavedFilters } from "./savedFilters";
import type { ListQueryState } from "./useHashRoute";

/**
 * 首页偏好本地记忆（A1-18「记忆并恢复用户上次选择」：URL 优先、本地次之）。
 * 「常用筛选」的组合库另存一个键（frontend/src/savedFilters.ts），退出登录时一并清除。
 *
 * - 记忆范围：地区 / 项目类型 / 项目经理 / 时间区间 / 排序，以及分类筛选侧边栏开合；
 *   关键字（q）属于临时操作，不写入记忆。
 * - 仅在不带任何列表参数的入口（书签 / 直接输域名）下恢复；带参数的链接严格按 URL 展示。
 * - 退出登录时清除（多人共用设备的隔离手段）；存储受限（隐私模式）时静默降级，不影响页面功能。
 */
export type HomeFilterPrefs = Pick<
  ListQueryState,
  "regions" | "projectTypes" | "managerIds" | "timeFrom" | "timeTo" | "sortDesc"
>;

type StoredPrefs = {
  v: 1;
  filters: HomeFilterPrefs | null;
  sidebarOpen: boolean | null;
};

const STORAGE_KEY = "libiaolink.home.prefs.v1";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item === "") {
      return null;
    }
    if (!result.includes(item)) {
      result.push(item);
    }
  }
  return result;
}

/** 日期只接受 YYYY-MM-DD；非法值返回 undefined（整条筛选记忆作废）。 */
function sanitizeDay(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string" && DATE_ONLY.test(value)) {
    return value;
  }
  return undefined;
}

function sanitizeFilters(value: unknown): HomeFilterPrefs | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const regions = sanitizeList(record.regions);
  const projectTypes = sanitizeList(record.projectTypes);
  const managerIds = sanitizeList(record.managerIds);
  const timeFrom = sanitizeDay(record.timeFrom);
  const timeTo = sanitizeDay(record.timeTo);
  if (
    regions === null ||
    projectTypes === null ||
    managerIds === null ||
    timeFrom === undefined ||
    timeTo === undefined ||
    typeof record.sortDesc !== "boolean"
  ) {
    return null;
  }
  return { regions, projectTypes, managerIds, timeFrom, timeTo, sortDesc: record.sortDesc };
}

/** 读取存储；损坏或缺失一律按「无记忆」处理，不抛错。 */
function readStore(): StoredPrefs {
  const empty: StoredPrefs = { v: 1, filters: null, sidebarOpen: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return empty;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return empty;
    }
    const record = parsed as Record<string, unknown>;
    return {
      v: 1,
      filters: sanitizeFilters(record.filters),
      sidebarOpen: typeof record.sidebarOpen === "boolean" ? record.sidebarOpen : null,
    };
  } catch {
    return empty;
  }
}

function writeStore(store: StoredPrefs): void {
  try {
    if (store.filters === null && store.sidebarOpen === null) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 隐私模式 / 存储配额受限：记忆属增强能力，写失败静默降级
  }
}

/** 上次的筛选选择；无记忆或记忆损坏返回 null。 */
export function readStoredFilters(): HomeFilterPrefs | null {
  return readStore().filters;
}

/** 上次的侧边栏开合；无记忆返回 null（沿用页面默认）。 */
export function readStoredSidebarOpen(): boolean | null {
  return readStore().sidebarOpen;
}

/** 记录筛选选择（关键字不写入；存储受限时静默跳过）。 */
export function saveFiltersPref(filters: ListQueryState): void {
  const store = readStore();
  store.filters = {
    regions: filters.regions.slice(),
    projectTypes: filters.projectTypes.slice(),
    managerIds: filters.managerIds.slice(),
    timeFrom: filters.timeFrom,
    timeTo: filters.timeTo,
    sortDesc: filters.sortDesc,
  };
  writeStore(store);
}

/** 记录侧边栏开合。 */
export function saveSidebarPref(open: boolean): void {
  const store = readStore();
  store.sidebarOpen = open;
  writeStore(store);
}

/** 清除全部本地记忆（退出登录时调用）：筛选 / 侧栏开合 + 「常用筛选」（同一隔离口径）。 */
export function clearHomePrefs(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 与写入同一降级策略
  }
  clearSavedFilters();
}
