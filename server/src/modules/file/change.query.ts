import { STAGE_KEYS, UuidSchema } from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";

/**
 * 变更记录读面查询解析（M4-04 读面 · A4-15）：纯函数、不做 IO。
 * 非法枚举 / uuid 一律 400（明确失败，不返回静默空列表）；排序白名单外 400。
 * `filter[projectId]` 与路径项目不一致同样 400：列表已按路径项目限定，给出冲突值只能是调用方口径错，
 * 静默空列表会把「筛选错」伪装成「没有变更」。
 */

export type ChangeRequestSortField = "appliedAt" | "createdAt";

export interface ChangeRequestSort {
  field: ChangeRequestSortField;
  direction: "asc" | "desc";
}

export interface ChangeRequestListFilter {
  /** 阶段多值（OR）；null = 不筛选。 */
  stageKeys: string[] | null;
  nodeId: string | null;
  fileId: string | null;
  appliedBy: string | null;
  /** 关键字（变更原因 / 变更前摘要 / 变更后摘要）。 */
  keyword: string | null;
}

/** 与 shared ChangeRequestListQuerySchema 的 z.infer 同形（窄化键名，避免 controller 重复传 z 类型）。 */
export interface ChangeRequestListQueryInput {
  "filter[stageKey]"?: string | undefined;
  "filter[nodeId]"?: string | undefined;
  "filter[fileId]"?: string | undefined;
  "filter[appliedBy]"?: string | undefined;
  "filter[projectId]"?: string | undefined;
  q?: string | undefined;
  page: number;
  limit: number;
  sort?: string | undefined;
}

export function parseChangeListFilter(
  projectId: string,
  query: ChangeRequestListQueryInput,
): ChangeRequestListFilter {
  const requestedProject = optionalUuid(query["filter[projectId]"], "filter[projectId]");
  if (requestedProject !== null && requestedProject !== projectId) {
    throw new AppError("VALIDATION_FAILED", "filter[projectId] 与路径项目不一致：" + requestedProject);
  }
  const stageKeys = splitMulti(query["filter[stageKey]"]);
  if (stageKeys !== null) {
    for (const stageKey of stageKeys) {
      if (!(STAGE_KEYS as readonly string[]).includes(stageKey)) {
        throw new AppError("VALIDATION_FAILED", "filter[stageKey] 含非法阶段：" + stageKey);
      }
    }
  }
  const keyword = query.q?.trim() ?? "";
  return {
    stageKeys,
    nodeId: optionalUuid(query["filter[nodeId]"], "filter[nodeId]"),
    fileId: optionalUuid(query["filter[fileId]"], "filter[fileId]"),
    appliedBy: optionalUuid(query["filter[appliedBy]"], "filter[appliedBy]"),
    keyword: keyword === "" ? null : keyword,
  };
}

/**
 * 排序解析：白名单 appliedAt / createdAt（阶段排序需按九阶段字典序，非字母序，本期不提供）。
 * 空值 = 默认顺序（created_at desc + id 升序 tie-breaker，见 repository，与 ix_change_project 同序）。
 */
export function parseChangeListSort(sort: string | undefined): ChangeRequestSort[] {
  if (sort === undefined || sort === "") return [];
  const parsed: ChangeRequestSort[] = [];
  for (const segment of sort.split(",")) {
    const [rawField = "", rawDirection] = segment.split(":");
    if (!isSortField(rawField)) {
      throw new AppError(
        "VALIDATION_FAILED",
        "sort 字段不在白名单（appliedAt / createdAt）：" + rawField,
      );
    }
    if (rawDirection !== undefined && rawDirection !== "asc" && rawDirection !== "desc") {
      throw new AppError("VALIDATION_FAILED", "sort 方向仅支持 asc / desc：" + rawDirection);
    }
    parsed.push({ field: rawField, direction: rawDirection ?? "asc" });
  }
  return parsed;
}

function isSortField(value: string): value is ChangeRequestSortField {
  return value === "appliedAt" || value === "createdAt";
}

function optionalUuid(value: string | undefined, field: string): string | null {
  if (value === undefined) return null;
  if (!UuidSchema.safeParse(value).success) {
    throw new AppError("VALIDATION_FAILED", field + " 不是合法 UUID：" + value);
  }
  return value;
}

function splitMulti(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  const parts = value.split(",").map((part) => part.trim()).filter((part) => part !== "");
  return parts.length === 0 ? null : parts;
}
