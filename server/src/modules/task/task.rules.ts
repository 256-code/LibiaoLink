/**
 * 任务规则（纯函数，不连库）：展示五态 / 按时交付派生、进度与状态写入联动、Asia/Shanghai 日界。
 * 口径来源：系统功能书 A1-06、技术设计v0.2 §2.4、A12 / A13 / A14（PR #42 / Push 70 定案）、ADR-028（时区）。
 * 派生结果只在读时计算、不写回存储（v0.2 §2.4：基础态仅 pending / active / done）。
 */

export type TaskBaseStatus = "pending" | "active" | "done";
export type TaskDisplayStatus = "pending" | "active" | "done" | "overdue" | "early_done";

export interface TaskDerivationInput {
  /** 存储基础态（tasks.status）。 */
  status: string;
  /** 预计完成日期 YYYY-MM-DD（tasks.planned_end）。 */
  plannedEnd: string | null;
  /** 实际完成日期 YYYY-MM-DD（tasks.actual_end）。 */
  actualEnd: string | null;
  /** 迁移导入的存储值（tasks.on_time），派生不出时回落。 */
  storedOnTime: boolean | null;
  /** 业务日（Asia/Shanghai）YYYY-MM-DD。 */
  today: string;
}

/** Asia/Shanghai 当天（ADR-028：UTC+8 固定偏移、无夏令时；日界在应用层算出后以参数进入 SQL）。 */
export function shanghaiToday(now: Date): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * 展示五态派生（A1-06 / A12 / A14）：完成按实际完成日期与预计完成日期比较分「已完成 / 提前完成」；
 * 未完成且已过预计完成日期 = 「已延期」（派生优先，人工写状态不改写它）；其余按基础态。
 */
export function deriveDisplayStatus(input: TaskDerivationInput): TaskDisplayStatus {
  if (input.status === "done") {
    if (input.actualEnd !== null && input.plannedEnd !== null && input.actualEnd < input.plannedEnd) {
      return "early_done";
    }
    return "done";
  }
  if (input.plannedEnd !== null && input.plannedEnd < input.today) return "overdue";
  return input.status === "active" ? "active" : "pending";
}

/**
 * 是否按时交付派生（A14）：
 * 完成且实际完成不晚于预计完成 → true；完成但晚于预计完成，或已完成未填完成日期且预计完成已过 → false；
 * 未完成且已过预计完成日期 → false（配 displayStatus=overdue 渲染「逾期未交付」）；其余派生不出 → 回落存储值（仍无则 null）。
 */
export function deriveOnTime(input: TaskDerivationInput): boolean | null {
  if (input.status === "done") {
    if (input.actualEnd !== null && input.plannedEnd !== null) return input.actualEnd <= input.plannedEnd;
    if (input.actualEnd === null && input.plannedEnd !== null && input.plannedEnd < input.today) return false;
    return input.storedOnTime;
  }
  if (input.plannedEnd !== null && input.plannedEnd < input.today) return false;
  return input.storedOnTime;
}

/** 任务写入三态（状态 / 进度 / 完成日期）——联动后一起落库。 */
export interface TaskWriteState {
  status: string;
  progress: number;
  actualEnd: string | null;
}

/**
 * 状态写入联动（A12，服务端同事务裁决）：
 * done → 满格 + 缺省按当天补完成日期（已完成保留原日期）；active → 至少 1 格（0 → 0.25、满格 → 0.75）并清完成日期；
 * pending → 清进度、清完成日期。「已延期 / 提前完成」是派生展示态、不可写（入参已由契约 Zod 限制为基础三态）。
 */
export function applyStatusWrite(current: TaskWriteState, status: TaskBaseStatus, today: string): TaskWriteState {
  if (status === "done") {
    return { status, progress: 1, actualEnd: current.actualEnd ?? today };
  }
  if (status === "active") {
    const progress = current.progress === 0 ? 0.25 : current.progress === 1 ? 0.75 : current.progress;
    return { status, progress, actualEnd: null };
  }
  return { status, progress: 0, actualEnd: null };
}

/**
 * 进度写入联动（A12 / A13）：0 → 待开始；0.25 / 0.5 / 0.75 → 进行中并清完成日期（清除完成日期的唯一方式）；
 * 1 → 已完成 + 完成日期（缺省按当天，显式传入则用传入值）。
 */
export function applyProgressWrite(
  progress: number,
  actualEndInput: string | null,
  today: string,
): TaskWriteState {
  if (progress === 1) {
    return { status: "done", progress: 1, actualEnd: actualEndInput ?? today };
  }
  return { status: progress === 0 ? "pending" : "active", progress, actualEnd: null };
}
