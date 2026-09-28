/**
 * 工作台分组口径（M6-05 第一刀 · 纯函数：不连库、不取系统时间）。
 * 预计完成日期（DateOnly 串）相对基准日（Asia/Shanghai 今天）落组：已逾期 / 今日待办 / 即将到期；
 * 窗口外（含未排期 = null、7 天以外）返回 null —— 由调用方丢弃（契约口径见 shared/src/modules/workspace.ts）。
 */
import { WORKSPACE_UPCOMING_DAYS, type WorkspaceTaskGroup } from "@libiaolink/contracts";

/** DateOnly（YYYY-MM-DD）加天数：UTC 运算，纯日期串进出，不引入本地时区。 */
export function addDays(dateOnly: string, days: number): string {
  const base = new Date(dateOnly + "T00:00:00.000Z");
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** 分组：plannedEnd < today → overdue；= today → today；≤ today + 7 → upcoming；其余（含 null）→ null。 */
export function taskGroupOf(plannedEnd: string | null, today: string): WorkspaceTaskGroup | null {
  if (plannedEnd === null) return null;
  if (plannedEnd < today) return "overdue";
  if (plannedEnd === today) return "today";
  if (plannedEnd <= addDays(today, WORKSPACE_UPCOMING_DAYS)) return "upcoming";
  return null;
}

/** 三组空篮子（键序与契约一致：today / upcoming / overdue）。 */
export function emptyTaskGroups<T>(): { today: T[]; upcoming: T[]; overdue: T[] } {
  return { today: [], upcoming: [], overdue: [] };
}
