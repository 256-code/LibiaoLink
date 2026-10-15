/**
 * 仪表盘取数（蓝图页「蓝图 ⇄ 仪表盘」转场视图）：项目列表 + 逐项目任务，前端聚合（口径见 data/dashboardProgress.ts）。
 *
 * 说明（2026-10-15）：
 * - 读面全部复用现有接口：GET /api/v1/projects（readAllPages）+ GET /api/v1/projects/{id}/tasks（readAllPages）；
 *   没有新增契约。服务端 dashboard 模块目前是占位（server/src/modules/dashboard/README.md），上量后把聚合
 *   收口到服务端读面 —— 本文件是唯一改动点。
 * - 并发上限 4；失败让调用方决定怎么呈现（蓝图页转场视图给「统计加载失败」）。
 * - Push 334：返回体带上「全部项目」与「逐项目」两份统计 —— 仪表盘标题旁的项目选择器（「项目进度一览·全部项目」/
 *   「项目进度一览·{项目名}」）直接切这份 byProject，**不额外发请求**（同一轮取数里顺带按项目分桶）。
 * - Push 335：返回体再带上逐项目任务明细（tasksByProject）与项目经理名（managerByProject）—— 点柱段打开的
 *   「数据详情」只读表用，仍是同一轮取数里存下、**零额外请求**（明细筛选口径见 data/dashboardProgress.ts）。
 */
import { buildDashboardProgress, type DashboardProgress } from "./data/dashboardProgress";
import { fetchProjectList } from "./projectApi";
import { fetchProjectTasks, type ApiTaskListItem } from "./taskApi";
import { EMPTY_LIST_QUERY } from "./useHashRoute";

/** 并发闸：同时最多 4 个 /tasks 请求在飞。 */
async function mapWithLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workerCount = Math.min(limit, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await run(items[index]);
      }
    }),
  );
  return results;
}

/** 选择器里的一行（固定第一行「全部项目」由展示层补，这里只放真实项目）。 */
export type DashboardProjectOption = {
  readonly id: string;
  readonly name: string;
};

/** 仪表盘一份完整取数：全部项目聚合 + 逐项目聚合（选择器用）。 */
export type DashboardDataset = {
  readonly options: readonly DashboardProjectOption[];
  /** 全部项目合计。 */
  readonly all: DashboardProgress;
  /** 项目 id → 该项目统计（选择器切换用；同一轮取数里分桶，不再发请求）。 */
  readonly byProject: ReadonlyMap<string, DashboardProgress>;
  /** 项目 id → 该项目任务明细（Push 335：点柱段打开的「数据详情」只读表用；同一轮取数里存下，零额外请求）。 */
  readonly tasksByProject: ReadonlyMap<string, readonly ApiTaskListItem[]>;
  /** 项目 id → 项目经理名（契约 managerNames 按「、」连接；「数据详情」表「项目经理」列用）。 */
  readonly managerByProject: ReadonlyMap<string, string>;
};

/** 全量任务聚合 → 阶段 × 进度五档；projects 可传已取好的项目列表（蓝图页地图那份）复用，缺省自己取。 */
export async function fetchDashboardProgress(projects?: readonly { id: string; name: string; managerNames?: readonly (string | null)[] }[]): Promise<DashboardDataset> {
  const list = projects === undefined ? (await fetchProjectList(EMPTY_LIST_QUERY)).items : projects;
  const pages = await mapWithLimit(list, 4, (project) => fetchProjectTasks(project.id));
  const byProject = new Map<string, DashboardProgress>();
  const tasksByProject = new Map<string, readonly ApiTaskListItem[]>();
  const managerByProject = new Map<string, string>();
  const allTasks: Array<{ readonly stageKey: string | null; readonly progress: number }> = [];
  list.forEach((project, index) => {
    const items = pages[index].items;
    byProject.set(project.id, buildDashboardProgress(items));
    tasksByProject.set(project.id, items);
    managerByProject.set(project.id, (project.managerNames ?? []).filter((name): name is string => name !== null && name !== "").join("、"));
    allTasks.push(...items);
  });
  return {
    options: list.map((project) => ({ id: project.id, name: project.name })),
    all: buildDashboardProgress(allTasks),
    byProject,
    tasksByProject,
    managerByProject,
  };
}
