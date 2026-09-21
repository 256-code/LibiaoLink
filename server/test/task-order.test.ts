import { describe, expect, it } from "vitest";
import { clampSortIndex, currentGroupOrder, planInsertOrder, planMoveOrder } from "../src/modules/task/task.order.js";

/** 组内顺序纯函数（A19 / A20 · w2 · Push 122）：位次夹取 / 插入计划 / 移动计划 / 读序稳定。 */
describe("任务组内顺序（A19 / A20 · Push 122）", () => {
  it("clampSortIndex：0 起；越界夹到组尾；负数 / 非整数按 0", () => {
    expect(clampSortIndex(0, 3)).toBe(0);
    expect(clampSortIndex(2, 3)).toBe(2);
    expect(clampSortIndex(3, 3)).toBe(3);
    expect(clampSortIndex(99, 3)).toBe(3);
    expect(clampSortIndex(-1, 3)).toBe(0);
    expect(clampSortIndex(1.5, 3)).toBe(0);
    expect(clampSortIndex(0, 0)).toBe(0);
  });

  it("planInsertOrder：插到组首 / 中间 / 越界落组尾", () => {
    const current = ["a", "b", "c"];
    expect(planInsertOrder(current, "x", 0)).toEqual(["x", "a", "b", "c"]);
    expect(planInsertOrder(current, "x", 2)).toEqual(["a", "b", "x", "c"]);
    expect(planInsertOrder(current, "x", 3)).toEqual(["a", "b", "c", "x"]);
    expect(planInsertOrder(current, "x", 99)).toEqual(["a", "b", "c", "x"]);
    expect(current).toEqual(["a", "b", "c"]);
  });

  it("planMoveOrder：向前 / 向后 / 原地 / 越界落组尾（位次按移动后的完整顺序算）", () => {
    const current = ["a", "b", "c", "d"];
    expect(planMoveOrder(current, "c", 0)).toEqual(["c", "a", "b", "d"]);
    expect(planMoveOrder(current, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(planMoveOrder(current, "b", 1)).toEqual(["a", "b", "c", "d"]);
    expect(planMoveOrder(current, "a", 99)).toEqual(["b", "c", "d", "a"]);
    expect(current).toEqual(["a", "b", "c", "d"]);
  });

  it("currentGroupOrder：按位次升序；位次相同时按 id 稳定排序（脏数据兜底）", () => {
    expect(
      currentGroupOrder([
        { id: "b", sortIndex: 2 },
        { id: "a", sortIndex: 0 },
        { id: "c", sortIndex: 1 },
      ]),
    ).toEqual(["a", "c", "b"]);
    expect(
      currentGroupOrder([
        { id: "z", sortIndex: 1 },
        { id: "a", sortIndex: 1 },
      ]),
    ).toEqual(["a", "z"]);
  });
});
