/**
 * 仪表盘数据口径（蓝图页「蓝图 ⇄ 仪表盘」转场视图 · 2026-10-15 业务口径「鼠标滑动蓝图转场展示仪表盘」）。
 *
 * 形态 = 「阶段 × 进度五档」横向堆叠条 —— 效果图业务已确认（「效果不错」）；落地时按业务口径
 * 「多余的注释和文字不需要」去掉了效果图上的数据来源 / 口径注释，只留标题 + 图例 + 数据本身。
 *
 * 口径（改规则只改这里）：
 * - 行 = 九阶段（契约 STAGE_KEYS 序：售前规划 / 设计开发 / 加工采购 / 组装发货 / 硬件实施 / 软件部署 /
 *   试运行 / 生产阶段 / 验收）+「未分组」（stageKey 为空的临时任务；没有就不出行，落最后一行）。
 * - 档 = 任务进度本身：契约 TaskProgress 就是离散五档（0 / 0.25 / 0.5 / 0.75 / 1），直接落档、不做就近收敛
 *   （「进行中收 25/50/75」只发生在旧表导入折算里，见服务端 project-import/legacy.ts）；异常小数按
 *   最近档四舍五入兜底（与契约迁移口径一致：0.49 → 0.5）。
 * - 段上数字 = 该档任务数；行右侧合计 = 该阶段任务总数。
 * - 汇总范围 = 全部项目（项目列表读面 + 逐项目任务读面前端聚合，取数在 src/dashboardApi.ts；
 *   服务端 dashboard 读面未落地 —— server/src/modules/dashboard/README.md 仍是占位，上量后再收口）。
 */
import { stageNameOf } from "../taskApi";

/** 进度五档（契约 TaskProgressSchema）：堆叠顺序 = 从左到右 0 → 1。 */
export const DASHBOARD_BINS = [0, 0.25, 0.5, 0.75, 1] as const;

/** 九阶段行键（与契约 STAGE_KEYS 同序）：前端本地维护一份（与 taskApi 的 STAGE_NAMES_BY_KEY 同源口径）。 */
export const DASHBOARD_STAGE_KEYS = [
  "presale",
  "design",
  "purchase",
  "assembly",
  "install",
  "deploy",
  "trial",
  "production",
  "acceptance",
] as const;

/** 一行 = 一个阶段（或「未分组」）的五档分布。 */
export type DashboardRow = {
  /** 行键：九阶段 key 或 "ungrouped"。 */
  readonly key: string;
  /** 行标题（中文阶段名；「未分组」行为空串，展示层用 i18n 键）。 */
  readonly label: string;
  /** 是否「未分组」行（展示层据此换 i18n 文案）。 */
  readonly isUngrouped: boolean;
  /** 五档计数，与 DASHBOARD_BINS 同下标。 */
  readonly counts: readonly number[];
  /** 该行任务总数（= counts 合计）。 */
  readonly total: number;
};

export type DashboardProgress = {
  readonly rows: readonly DashboardRow[];
  /** 任务总数（跨全部项目）。 */
  readonly totalTasks: number;
};

/** 聚合输入的最小任务形状（ApiTaskListItem 满足）。 */
export type DashboardTaskLike = {
  readonly stageKey: string | null;
  readonly progress: number;
};

/** 进度值 → 档下标（0..4）：就近档四舍五入；非数值返回 -1（不计入）。 */
export function progressBinIndex(progress: number): number {
  if (!Number.isFinite(progress)) {
    return -1;
  }
  return Math.min(4, Math.max(0, Math.round(progress * 4)));
}

/** 九阶段 key 集合（判断 stageKey 是否落在既有行上：不在 = 归「未分组」行）。 */
const KNOWN_STAGE_KEYS: readonly string[] = DASHBOARD_STAGE_KEYS;

/**
 * 任务是否落在该（行 × 档）格子里 —— 点击柱段打开的「数据详情」列表按它筛（Push 335）。
 * 与 buildDashboardProgress 同一套口径：档 = progressBinIndex；行 = stageKey 命中该阶段，未命中（含未知 key
 * 与 stageKey 为空）都归「未分组」行。保证「段上数字 = 详情表行数」。
 */
export function isTaskInCell(task: DashboardTaskLike, rowKey: string, bin: number): boolean {
  if (progressBinIndex(task.progress) !== bin) {
    return false;
  }
  if (rowKey === "ungrouped") {
    return task.stageKey === null || !KNOWN_STAGE_KEYS.includes(task.stageKey);
  }
  return task.stageKey === rowKey;
}

/** 聚合中的可变行（key 放宽成 string，兼容 stageKey 的任何落库值）。 */
type MutableRow = { key: string; label: string; isUngrouped: boolean; counts: number[] };

/** 全量任务 → 阶段 × 进度五档（纯函数，取数见 dashboardApi.ts）。 */
export function buildDashboardProgress(tasks: readonly DashboardTaskLike[]): DashboardProgress {
  const stageRows: MutableRow[] = DASHBOARD_STAGE_KEYS.map((key) => ({
    key,
    label: stageNameOf(key),
    isUngrouped: false,
    counts: [0, 0, 0, 0, 0],
  }));
  const ungroupedRow: MutableRow = { key: "ungrouped", label: "", isUngrouped: true, counts: [0, 0, 0, 0, 0] };
  const byKey = new Map<string, MutableRow>(stageRows.map((row) => [row.key, row] as const));
  let totalTasks = 0;
  for (const task of tasks) {
    const bin = progressBinIndex(task.progress);
    if (bin < 0) {
      continue;
    }
    const target = (task.stageKey !== null ? byKey.get(task.stageKey) : undefined) ?? ungroupedRow;
    target.counts[bin] += 1;
    totalTasks += 1;
  }
  const rows = ungroupedRow.counts.some((count) => count > 0) ? [...stageRows, ungroupedRow] : stageRows;
  return {
    rows: rows.map((row) => ({ ...row, total: row.counts.reduce((sum, count) => sum + count, 0) })),
    totalTasks,
  };
}
