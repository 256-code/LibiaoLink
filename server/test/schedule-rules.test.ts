import { describe, expect, it } from "vitest";
import { enumerateFireTimes, nextFireAfter, parseCron, planCatchup } from "../src/outbox/schedule.js";

/**
 * S7-3 调度窗口求值门禁（纯函数：不连库、不取系统时间）：cron 五段解析 / 下一触发时刻（Asia/Shanghai · ADR-028）/
 * 补发窗口枚举与跨度裁剪（契约 OUTBOX_SCHEDULER.catchupMaxDays）。
 * 真机语义（杀 worker 不丢 / 重复领取不重发 / 补发与状态回退再生落库）由 s7-3-scheduler-replay.mjs 覆盖。
 */

describe("parseCron（五段解析）", () => {
  it("通配 / 单值 / 列表 / 区间 / 步进（星号、单值、区间）", () => {
    const daily = parseCron("0 8 * * *");
    expect(daily.minutes).toEqual([0]);
    expect(daily.hours).toEqual([8]);
    expect(daily.daysOfMonth).toBeNull();
    expect(daily.months).toBeNull();
    expect(daily.daysOfWeek).toBeNull();

    expect(parseCron("5,10,25 9 * * *").minutes).toEqual([5, 10, 25]);
    expect(parseCron("0-30/10 9 * * *").minutes).toEqual([0, 10, 20, 30]);
    expect(parseCron("*/15 * * * *").minutes).toEqual([0, 15, 30, 45]);
    expect(parseCron("0/15 * * * *").minutes).toEqual([0, 15, 30, 45]);
  });

  it("周字段 0~7：7 归一到 0（周日）", () => {
    expect(parseCron("30 9 * * 1").daysOfWeek).toEqual([1]);
    expect(parseCron("30 9 * * 7").daysOfWeek).toEqual([0]);
    expect(parseCron("30 9 * * 0").daysOfWeek).toEqual([0]);
    expect(parseCron("30 9 * * 1-5").daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it("非法写法直接抛（段数 / 越界 / 步进 0 / 区间倒置）", () => {
    expect(() => parseCron("0 8 * *")).toThrow(/五段/);
    expect(() => parseCron("0 8 * * * *")).toThrow(/五段/);
    expect(() => parseCron("60 8 * * *")).toThrow(/分钟/);
    expect(() => parseCron("0 24 * * *")).toThrow(/小时/);
    expect(() => parseCron("0 8 0 * *")).toThrow(/日/);
    expect(() => parseCron("0 8 * 13 *")).toThrow(/月/);
    expect(() => parseCron("0 8 * * 8")).toThrow(/周/);
    expect(() => parseCron("*/0 8 * * *")).toThrow(/分钟/);
    expect(() => parseCron("30-10 8 * * *")).toThrow(/分钟/);
    expect(() => parseCron("a 8 * * *")).toThrow(/分钟/);
  });
});

describe("nextFireAfter（上海业务日 · ADR-028）", () => {
  it("每日 08:00：过点取次日（08:00 CST = 00:00 UTC）", () => {
    expect(nextFireAfter("0 8 * * *", new Date("2026-09-28T02:00:00Z"))?.toISOString()).toBe(
      "2026-09-29T00:00:00.000Z",
    );
  });

  it("19:30 日报窗口（A01）：当天未过点取当天", () => {
    expect(nextFireAfter("30 19 * * *", new Date("2026-09-28T02:00:00Z"))?.toISOString()).toBe(
      "2026-09-28T11:30:00.000Z",
    );
  });

  it("跨 CST 日界（23:00 窗口）：上海 09-28 23:00 = UTC 09-28 15:00", () => {
    expect(nextFireAfter("0 23 * * *", new Date("2026-09-28T15:30:00Z"))?.toISOString()).toBe(
      "2026-09-29T15:00:00.000Z",
    );
  });

  it("每周一 09:30（R07）：周日 20:00 CST 起算取周一", () => {
    expect(nextFireAfter("30 9 * * 1", new Date("2026-09-27T12:00:00Z"))?.toISOString()).toBe(
      "2026-09-28T01:30:00.000Z",
    );
  });

  it("日 / 周同时受限按 OR（任一回命）：10-01（周四）按「1 日」命中", () => {
    expect(nextFireAfter("0 8 1 * 1", new Date("2026-09-28T02:00:00Z"))?.toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("不可能 cron（2 月 31 日）：扫描上限内无命中返回 null", () => {
    expect(nextFireAfter("0 0 31 2 *", new Date("2026-09-28T00:00:00Z"))).toBeNull();
  });
});

describe("enumerateFireTimes（补发窗口枚举）", () => {
  it("窗口内外半开 (after, until]：边界时刻不重复计入", () => {
    const { times, truncated } = enumerateFireTimes(
      "0 8 * * *",
      new Date("2026-09-28T00:00:00Z"),
      new Date("2026-09-30T23:59:00Z"),
    );
    expect(times.map((time) => time.toISOString())).toEqual([
      "2026-09-29T00:00:00.000Z",
      "2026-09-30T00:00:00.000Z",
    ]);
    expect(truncated).toBe(false);
  });

  it("命中数触顶：只取前 limit 个并标 truncated（防异常 cron 撑爆内存）", () => {
    const { times, truncated } = enumerateFireTimes(
      "0 8 * * *",
      new Date("2026-09-01T00:00:00Z"),
      new Date("2026-09-30T23:59:00Z"),
      5,
    );
    expect(times).toHaveLength(5);
    expect(truncated).toBe(true);
  });
});

describe("planCatchup（last_run_at 补发与跨度裁剪）", () => {
  it("未超跨度：窗口 (after, now]，无 skipped", () => {
    const plan = planCatchup({
      cron: "0 8 * * *",
      after: new Date("2026-09-27T00:30:00Z"),
      now: new Date("2026-09-28T02:00:00Z"),
      catchupMaxDays: 7,
    });
    expect(plan.windowFrom.toISOString()).toBe("2026-09-27T00:30:00.000Z");
    expect(plan.windowTo.toISOString()).toBe("2026-09-28T02:00:00.000Z");
    expect(plan.fireTimes.map((time) => time.toISOString())).toEqual(["2026-09-28T00:00:00.000Z"]);
    expect(plan.skippedFrom).toBeNull();
    expect(plan.skippedTo).toBeNull();
    expect(plan.truncated).toBe(false);
  });

  it("超跨度：窗口收窄到上限处，超出区间只记 skipped 留痕", () => {
    const plan = planCatchup({
      cron: "0 8 * * *",
      after: new Date("2026-09-01T00:00:00Z"),
      now: new Date("2026-09-30T06:00:00Z"),
      catchupMaxDays: 7,
    });
    expect(plan.windowFrom.toISOString()).toBe("2026-09-23T06:00:00.000Z");
    expect(plan.skippedFrom?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(plan.skippedTo?.toISOString()).toBe("2026-09-23T06:00:00.000Z");
    expect(plan.fireTimes.map((time) => time.toISOString())).toEqual([
      "2026-09-24T00:00:00.000Z",
      "2026-09-25T00:00:00.000Z",
      "2026-09-26T00:00:00.000Z",
      "2026-09-27T00:00:00.000Z",
      "2026-09-28T00:00:00.000Z",
      "2026-09-29T00:00:00.000Z",
      "2026-09-30T00:00:00.000Z",
    ]);
    expect(plan.truncated).toBe(false);
  });
});
