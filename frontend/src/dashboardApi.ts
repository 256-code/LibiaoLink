/**
 * 仪表盘取数（蓝图页「蓝图 ⇄ 仪表盘」转场视图）：项目列表 + 逐项目任务，前端聚合（口径见 data/dashboardProgress.ts）。
 *
 * 说明（2026-10-15）：
 * - 读面全部复用现有接口：GET /api/v1/projects（readAllPages）+ GET /api/v1/projects/{id}/tasks（readAllPages）；
 *   没有新增契约。服务端 dashboard 模块目前是占位（server/src/modules/dashboard/README.md），上量后把聚合
 *   收口到服务端读面 —— 本文件是唯一改动点。
 * - 并发上限 4；失败让调用方决定怎么呈现（蓝图页转场视图给「统计加载失败」）。
 */
import { buildDashboardProgress, type DashboardProgress } from "./data/dashboardProgress";
import { fetchProjectList } from "./projectApi";
import { fetchProjectTasks } from "./taskApi";
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

/** 全量任务聚合 → 阶段 × 进度五档；projects 可传已取好的项目列表（蓝图页地图那份）复用，缺省自己取。 */
export async function fetchDashboardProgress(projects?: readonly { id: string }[]): Promise<DashboardProgress> {
  const list = projects === undefined ? (await fetchProjectList(EMPTY_LIST_QUERY)).items : projects;
  const pages = await mapWithLimit(list, 4, (project) => fetchProjectTasks(project.id));
  const tasks = pages.flatMap((page) => page.items);
  return buildDashboardProgress(tasks);
}
