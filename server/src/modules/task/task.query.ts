import { STAGE_KEYS, UuidSchema } from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";

/**
 * 任务列表 / 详情的查询解析（M3-01 · A7 / A8）：纯函数、不做 IO。
 * 非法枚举 / uuid 一律 400（明确失败，不返回静默空列表）；排序白名单外 400（A8）。
 * 展示态筛选（filter[status]）按派生定义下推 SQL（task.repository 的 displayStatusCondition），
 * 保证与读时派生同一口径（overdue / early_done 不是存储态）。
 */

export const TASK_DISPLAY_STATUSES = ["pending", "active", "done", "overdue", "early_done"] as const;

export type TaskSortField = "plannedStart" | "plannedEnd" | "actualEnd" | "progress" | "title" | "createdAt";

export interface TaskSort {
  field: TaskSortField;
  direction: "asc" | "desc";
}

export interface TaskListFilter {
  stageKey: string | null;
  ownerId: string | null;
  /** 展示态多值（OR）；null = 不筛选。 */
  displayStatuses: string[] | null;
  keyword: string | null;
}

/** 与 shared TaskListQuerySchema 的 z.infer 同形（窄化键名，避免 controller 重复传 z 类型）。 */
export interface TaskListQueryInput {
  stage?: string | undefined;
  "filter[ownerId]"?: string | undefined;
  "filter[status]"?: string | undefined;
  q?: string | undefined;
  page: number;
  limit: number;
  sort?: string | undefined;
}

export function parseTaskListFilter(query: TaskListQueryInput): TaskListFilter {
  const stageKey = query.stage ?? null;
  if (stageKey !== null && !(STAGE_KEYS as readonly string[]).includes(stageKey)) {
    throw new AppError("VALIDATION_FAILED", "stage 不在九阶段字典内：" + stageKey);
  }
  const ownerId = query["filter[ownerId]"] ?? null;
  if (ownerId !== null && !UuidSchema.safeParse(ownerId).success) {
    throw new AppError("VALIDATION_FAILED", "filter[ownerId] 不是合法用户 ID：" + ownerId);
  }
  const displayStatuses = splitMulti(query["filter[status]"]);
  if (displayStatuses !== null) {
    for (const status of displayStatuses) {
      if (!(TASK_DISPLAY_STATUSES as readonly string[]).includes(status)) {
        throw new AppError("VALIDATION_FAILED", "filter[status] 含非法展示态：" + status);
      }
    }
  }
  const keyword = query.q?.trim() ?? "";
  return {
    stageKey,
    ownerId,
    displayStatuses,
    keyword: keyword === "" ? null : keyword,
  };
}

/**
 * 排序解析（A8）：白名单 plannedStart / plannedEnd / actualEnd / progress / title / createdAt；
 * 空值 = 默认顺序（阶段序 + 组内 plannedStart ASC NULLS LAST, created_at ASC, id ASC，见 repository）。
 */
export function parseTaskSort(sort: string | undefined): TaskSort[] {
  if (sort === undefined || sort === "") return [];
  const parsed: TaskSort[] = [];
  for (const segment of sort.split(",")) {
    const [rawField = "", rawDirection] = segment.split(":");
    if (!isSortField(rawField)) {
      throw new AppError(
        "VALIDATION_FAILED",
        "sort 字段不在白名单（plannedStart / plannedEnd / actualEnd / progress / title / createdAt）：" + rawField,
      );
    }
    if (rawDirection !== undefined && rawDirection !== "asc" && rawDirection !== "desc") {
      throw new AppError("VALIDATION_FAILED", "sort 方向仅支持 asc / desc：" + rawDirection);
    }
    parsed.push({ field: rawField, direction: rawDirection ?? "asc" });
  }
  return parsed;
}

function isSortField(value: string): value is TaskSortField {
  return (
    value === "plannedStart" ||
    value === "plannedEnd" ||
    value === "actualEnd" ||
    value === "progress" ||
    value === "title" ||
    value === "createdAt"
  );
}

function splitMulti(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  const parts = value.split(",").map((part) => part.trim()).filter((part) => part !== "");
  return parts.length === 0 ? null : parts;
}
