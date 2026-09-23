/**
 * 用户偏好（A4 / A24）：GET / PATCH /api/v1/users/me/preferences。
 * 常用筛选（A24）自 Push 169 起按账号存服务端（user_preferences.prefs.homeSavedFilters）——
 * 同一账号换设备可见；同一设备换账号互不可见（服务端按会话 actorId 隔离，路径不接受用户 id）。
 * 契约 shared/src/modules/users.ts：PATCH 为合并语义（只传变更键、数组键整体替换）。
 */
import { apiRequest, apiSend } from "./api";
import { clearLegacySavedFilters, readLegacySavedFilters } from "./savedFilters";
import type { SavedFilter } from "./savedFilters";

/** 偏好全量（与契约 UserPreferences 同形；`updatedAt` = 尚未保存过时 null）。 */
export type UserPreferences = {
  taskTableHiddenColumns: string[];
  homeSavedFilters: SavedFilter[];
  updatedAt: string | null;
};

/** 读取当前账号的偏好（无记录 = 默认值 + updatedAt null；401 由 apiRequest 统一跳登录）。 */
export function loadMyPreferences(): Promise<UserPreferences> {
  return apiRequest<UserPreferences>("/api/v1/users/me/preferences");
}

/** 常用筛选整体替换（PATCH 只带这一个键）：返回服务端收敛后的全量偏好，前端以返回值覆盖本地。 */
export function saveHomeSavedFilters(items: SavedFilter[]): Promise<UserPreferences> {
  return apiSend<UserPreferences>("/api/v1/users/me/preferences", "PATCH", { homeSavedFilters: items });
}

/** 任务表列显隐整体替换（A4 · Push 170）：只传这一个键，返回服务端收敛后的全量偏好。 */
export function saveTaskTableHiddenColumns(keys: string[]): Promise<UserPreferences> {
  return apiSend<UserPreferences>("/api/v1/users/me/preferences", "PATCH", { taskTableHiddenColumns: keys });
}

/**
 * 登录后取偏好（含 Push 169 一次性迁移）：服务端为空 + 本机仍有 Push 138–168 的 localStorage 旧键
 * （libiaolink.home.savedFilters.v1）时，把本机组合整体推上云，成功后再清本机键（老用户不丢数据）。
 * - 服务端已有值：以账号为准，本机旧键直接清掉（避免下次误复活旧组合）。
 * - 迁移失败：本次用本机组合兜底展示（键保留，下次登录自动重试），不因偏好失败阻塞页面。
 */
export async function loadMyPreferencesWithLegacyMigration(): Promise<UserPreferences> {
  const prefs = await loadMyPreferences();
  if (prefs.homeSavedFilters.length > 0) {
    clearLegacySavedFilters();
    return prefs;
  }
  const legacy = readLegacySavedFilters();
  if (legacy.length === 0) {
    clearLegacySavedFilters();
    return prefs;
  }
  try {
    const migrated = await saveHomeSavedFilters(legacy);
    clearLegacySavedFilters();
    return migrated;
  } catch {
    return { ...prefs, homeSavedFilters: legacy };
  }
}
