import { Injectable } from "@nestjs/common";
import { SAVED_HOME_FILTER_LIMIT, type SavedHomeFilter, type UserPreferences, type UserPreferencesUpdateBody } from "@libiaolink/contracts";
import { UserPreferenceRepository } from "./user-preference.repository.js";
import type { UserPreferenceRow } from "./user-preference.repository.js";

type PrefsRecord = Record<string, unknown>;

/** 读侧规范化：jsonb 是自由对象（手工 / 旧版本写入都可能存在），声明键一律按契约形状收敛，坏数据丢弃不抛错。 */
function stringArrayOf(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item !== "" && !result.includes(item)) {
      result.push(item);
    }
  }
  return result;
}

function savedFiltersOf(value: unknown): SavedHomeFilter[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: SavedHomeFilter[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" && record.id !== "" ? record.id : null;
    const name = typeof record.name === "string" ? record.name.slice(0, 20) : "";
    if (id === null || name === "" || result.some((existing) => existing.id === id)) {
      continue;
    }
    result.push({
      id,
      name,
      regions: stringArrayOf(record.regions),
      projectTypes: stringArrayOf(record.projectTypes),
      managerIds: stringArrayOf(record.managerIds),
      timeFrom: dayOf(record.timeFrom),
      timeTo: dayOf(record.timeTo),
    });
    if (result.length >= SAVED_HOME_FILTER_LIMIT) {
      break;
    }
  }
  return result;
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function dayOf(value: unknown): string | null {
  return typeof value === "string" && DAY_ONLY.test(value) ? value : null;
}

/**
 * 用户级 UI 偏好用例（A4 / A24）：GET 返回契约全量形状（无行 = 默认值 + updatedAt null）；
 * PATCH 合并语义 —— 只传变更键、数组键整体替换、未声明键原样保存（前向兼容，不必为新偏好键改契约）。
 * 偏好是界面状态（非业务数据），不写审计；单用户单写者，无乐观锁。
 */
@Injectable()
export class UserPreferenceService {
  constructor(private readonly preferences: UserPreferenceRepository) {}

  async get(userId: string): Promise<UserPreferences> {
    return this.toContract(await this.preferences.find(userId));
  }

  async update(userId: string, body: UserPreferencesUpdateBody, at: Date = new Date()): Promise<UserPreferences> {
    const existing = await this.preferences.find(userId);
    const current: PrefsRecord = { ...(existing?.prefs ?? {}) };
    const next: PrefsRecord = { ...current, ...(body as PrefsRecord) };
    return this.toContract(await this.preferences.upsert(userId, next, at));
  }

  /** 行 → 契约：声明键按形状收敛，updatedAt 由写入时间给出（无行 = null）。 */
  private toContract(row: UserPreferenceRow | null): UserPreferences {
    const prefs: PrefsRecord = row?.prefs ?? {};
    return {
      taskTableHiddenColumns: stringArrayOf(prefs["taskTableHiddenColumns"]),
      homeSavedFilters: savedFiltersOf(prefs["homeSavedFilters"]),
      updatedAt: row === null ? null : row.updatedAt.toISOString(),
    };
  }
}
