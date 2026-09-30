/**
 * 工作台分组口径（M6-05 · 纯函数：不连库、不取系统时间）。
 * 预计完成日期（DateOnly 串）相对基准日（Asia/Shanghai 今天）落组：已逾期 / 今日待办 / 即将到期 / 未排期。
 * 2026-09-30 业务复评：取消原「今天起 7 天」窗口（plannedEnd > 今天一律 upcoming，远期照收）；
 * 未排期（plannedEnd 空）单列一组（unscheduled），不再丢弃 —— 契约口径见 shared/src/modules/workspace.ts。
 */
import type { WorkspaceTaskGroup } from "@libiaolink/contracts";

/** DateOnly（YYYY-MM-DD）加天数：UTC 运算，纯日期串进出，不引入本地时区。 */
export function addDays(dateOnly: string, days: number): string {
  const base = new Date(dateOnly + "T00:00:00.000Z");
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** 分组：plannedEnd < today → overdue；= today → today；> today → upcoming；null → unscheduled。 */
export function taskGroupOf(plannedEnd: string | null, today: string): WorkspaceTaskGroup {
  if (plannedEnd === null) return "unscheduled";
  if (plannedEnd < today) return "overdue";
  if (plannedEnd === today) return "today";
  return "upcoming";
}

/** 四组空篮子（键序与契约一致：today / upcoming / overdue / unscheduled）。 */
export function emptyTaskGroups<T>(): { today: T[]; upcoming: T[]; overdue: T[]; unscheduled: T[] } {
  return { today: [], upcoming: [], overdue: [], unscheduled: [] };
}
