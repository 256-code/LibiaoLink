/**
 * 组内顺序（A19 / A20 · w2 · Push 122）：纯函数，不连库。
 * 一组 = 同一项目 + 同一阶段（stage_key 为 null 时 = 「未分组」，自成一组）；组内位次 0 起、密集（0..n-1）。
 * 读口径（task.repository 默认排序：阶段为主键 + 组内位次）与写口径（本模块）共用同一定义。
 * 口径来源：前端功能需求.md 附录 A19 / A20（Push 119 / 120 定案）、字段对照清单.md §七。
 */

/** 位次夹取：0 = 组内最前；groupSize = 组尾（追加 / 移到组尾）。非法输入（负数 / 非整数）按 0 处理。 */
export function clampSortIndex(sortIndex: number, groupSize: number): number {
  if (!Number.isInteger(sortIndex) || sortIndex < 0) return 0;
  return sortIndex > groupSize ? groupSize : sortIndex;
}

/**
 * 插入计划（看板「＋ 添加 → 插入位置」）：把新任务插到组内第 sortIndex 位，返回该组的新完整顺序。
 * 越界（含缺省传组内任务数）= 追加到组尾。
 */
export function planInsertOrder(currentIds: readonly string[], newId: string, sortIndex: number): string[] {
  const order = [...currentIds];
  order.splice(clampSortIndex(sortIndex, order.length), 0, newId);
  return order;
}

/**
 * 移动计划（拖动排序 / 「移到某条之后」）：把 taskId 移到组内第 sortIndex 位，返回该组的新完整顺序。
 * 目标位次按「移动后的完整顺序」计算（0 = 组内最前；越界 = 组尾）。
 */
export function planMoveOrder(currentIds: readonly string[], taskId: string, sortIndex: number): string[] {
  const order = currentIds.filter((id) => id !== taskId);
  order.splice(clampSortIndex(sortIndex, order.length), 0, taskId);
  return order;
}

/** 组内当前顺序（按位次 + id 稳定排序）—— plan* 的输入顺序约定。 */
export function currentGroupOrder(rows: readonly { id: string; sortIndex: number }[]): string[] {
  return [...rows]
    .sort((left, right) => (left.sortIndex - right.sortIndex) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((row) => row.id);
}
