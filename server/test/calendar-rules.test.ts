import { describe, expect, it } from "vitest";
import {
  addDays,
  atShanghaiTime,
  calendarWindow,
  dayOfWeek,
  evaluateOffset,
  isWeekend,
  isWorkday,
  resolveDay,
  shiftToWorkday,
} from "../src/modules/calendar/calendar.rules.js";
import type { CalendarException, CalendarWindow } from "../src/modules/calendar/calendar.rules.js";

/**
 * h8 金标用例（D5-02 / D5-03）：顺延与 T-1 / T+1 的日期语义。
 * 数据集是合成日历（非真实法定假日安排）：国庆假期 10-01（周四）~ 10-07（周三）+ 10-10（周六）调休上班
 * + 12-31（周四）跨年放假。规则层不取系统时间，基准日期一律显式传入。
 */
const EXCEPTIONS: CalendarException[] = [
  { date: "2026-10-01", dayType: "holiday", name: "国庆节", note: "金标数据集" },
  { date: "2026-10-02", dayType: "holiday", name: "国庆假期", note: null },
  { date: "2026-10-03", dayType: "holiday", name: "国庆假期", note: null },
  { date: "2026-10-04", dayType: "holiday", name: "国庆假期", note: null },
  { date: "2026-10-05", dayType: "holiday", name: "国庆假期", note: null },
  { date: "2026-10-06", dayType: "holiday", name: "国庆假期", note: null },
  { date: "2026-10-07", dayType: "holiday", name: "国庆假期", note: null },
  { date: "2026-10-10", dayType: "makeup_workday", name: "国庆调休上班", note: null },
  { date: "2026-12-31", dayType: "holiday", name: "年终假", note: null },
];

const YEAR = calendarWindow("2026-01-01", "2026-12-31", EXCEPTIONS);

describe("工作日历规则 · 日期判定（D5-01 / D5-03）", () => {
  it("默认规则：周一至周五工作日、周六周日非工作日", () => {
    expect(dayOfWeek("2026-10-08")).toBe(4);
    expect(isWeekend("2026-09-19")).toBe(true);
    expect(isWeekend("2026-09-21")).toBe(false);
    expect(resolveDay("2026-09-21", YEAR)).toMatchObject({ kind: "workday", isWorkday: true, source: "default" });
    expect(resolveDay("2026-09-19", YEAR)).toMatchObject({ kind: "weekend", isWorkday: false, source: "default" });
  });

  it("例外优先：放假不是工作日；调休上班（周末补班）是工作日", () => {
    expect(resolveDay("2026-10-01", YEAR)).toMatchObject({ kind: "holiday", isWorkday: false, name: "国庆节", source: "calendar" });
    expect(resolveDay("2026-10-10", YEAR)).toMatchObject({
      kind: "makeup_workday",
      isWorkday: true,
      name: "国庆调休上班",
      source: "calendar",
    });
    expect(isWorkday("2026-10-10", YEAR)).toBe(true);
    expect(isWorkday("2026-10-03", YEAR)).toBe(false);
  });

  it("窗口外返回 null（未加载 ≠ 非工作日）", () => {
    const narrow = calendarWindow("2026-10-08", "2026-10-09", EXCEPTIONS);
    expect(resolveDay("2026-10-02", narrow)).toBeNull();
    expect(isWorkday("2026-10-02", narrow)).toBe(false);
  });

  it("日期算术（跨月 / 跨年）", () => {
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("工作日历规则 · 顺延（D5-02 金标）", () => {
  it("顺延到之后最近工作日：假期中一路跳过后回到 10-08", () => {
    const outcome = shiftToWorkday("2026-10-02", "forward", YEAR);
    expect(outcome).toEqual({
      ok: true,
      date: "2026-10-08",
      shifted: true,
      skipped: ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"],
      kind: "workday",
      name: null,
    });
  });

  it("提前到之前最近工作日：假期前移回 09-30", () => {
    const outcome = shiftToWorkday("2026-10-02", "backward", YEAR);
    expect(outcome).toEqual({
      ok: true,
      date: "2026-09-30",
      shifted: true,
      skipped: ["2026-10-02", "2026-10-01"],
      kind: "workday",
      name: null,
    });
  });

  it("已是工作日原样返回（含调休上班日与周末顺延回工作日）", () => {
    expect(shiftToWorkday("2026-10-09", "forward", YEAR)).toMatchObject({ ok: true, date: "2026-10-09", shifted: false, skipped: [] });
    expect(shiftToWorkday("2026-10-10", "forward", YEAR)).toMatchObject({ ok: true, date: "2026-10-10", shifted: false, kind: "makeup_workday" });
    expect(shiftToWorkday("2026-10-11", "forward", YEAR)).toMatchObject({ ok: true, date: "2026-10-12", shifted: true, skipped: ["2026-10-11"] });
  });

  it("跨年顺延：12-31 放假 → 2027-01-01（周五）", () => {
    const window = calendarWindow("2026-12-30", "2027-01-03", EXCEPTIONS);
    expect(shiftToWorkday("2026-12-31", "forward", window)).toMatchObject({ ok: true, date: "2027-01-01", shifted: true, skipped: ["2026-12-31"] });
  });

  it("窗口用尽返回 exhausted（不把未加载当成工作日）", () => {
    const narrow = calendarWindow("2026-09-20", "2026-10-05", EXCEPTIONS);
    expect(shiftToWorkday("2026-10-02", "forward", narrow)).toEqual({
      ok: false,
      reason: "exhausted",
      skipped: ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"],
    });
  });
});

describe("工作日历规则 · T-1 / T+1 求值（D5-03 金标）", () => {
  const settings = { shiftDirection: "forward" as const };

  it("T-1 命中：10-09 的前一天（10-08）是工作日，不顺延", () => {
    const outcome = evaluateOffset({ baseDate: "2026-10-09", days: -1, shiftEnabled: true, ...settings, window: YEAR });
    expect(outcome).toMatchObject({ rawDate: "2026-10-08", date: "2026-10-08", shifted: false, shiftDirection: null, kind: "workday" });
  });

  it("节假日顺延开：T-7 落到假期 → 顺延到 10-08", () => {
    const outcome = evaluateOffset({ baseDate: "2026-10-09", days: -7, shiftEnabled: true, ...settings, window: YEAR });
    expect(outcome).toMatchObject({ rawDate: "2026-10-02", date: "2026-10-08", shifted: true, shiftDirection: "forward", kind: "workday" });
  });

  it("节假日顺延关：同一入参保留假期内日期（两态各一例）", () => {
    const outcome = evaluateOffset({ baseDate: "2026-10-09", days: -7, shiftEnabled: false, ...settings, window: YEAR });
    expect(outcome).toMatchObject({ rawDate: "2026-10-02", date: "2026-10-02", shifted: false, shiftDirection: null, kind: "holiday" });
  });

  it("T+1 跨假期：09-30 的后一天是假期 → 顺延到 10-08", () => {
    const outcome = evaluateOffset({ baseDate: "2026-09-30", days: 1, shiftEnabled: true, ...settings, window: YEAR });
    expect(outcome).toMatchObject({ rawDate: "2026-10-01", date: "2026-10-08", shifted: true, kind: "workday", name: null });
  });

  it("提前方向（backward）：假期后的 T-1 → 节前最后工作日", () => {
    const outcome = evaluateOffset({
      baseDate: "2026-10-08",
      days: -1,
      shiftEnabled: true,
      shiftDirection: "backward",
      window: YEAR,
    });
    expect(outcome).toMatchObject({ rawDate: "2026-10-07", date: "2026-09-30", shifted: true, shiftDirection: "backward" });
  });

  it("实时求值：基准日期变化后按新日期重算（改期后未发送提醒的口径）", () => {
    const before = evaluateOffset({ baseDate: "2026-09-29", days: 1, shiftEnabled: true, ...settings, window: YEAR });
    const after = evaluateOffset({ baseDate: "2026-09-30", days: 1, shiftEnabled: true, ...settings, window: YEAR });
    expect(before).toMatchObject({ rawDate: "2026-09-30", date: "2026-09-30" });
    expect(after).toMatchObject({ rawDate: "2026-10-01", date: "2026-10-08" });
  });

  it("日历数据变化后同一入参得到新结果（不缓存）", () => {
    const extra: CalendarException[] = [...EXCEPTIONS, { date: "2026-10-08", dayType: "holiday", name: "临时放假", note: null }];
    const changed = calendarWindow("2026-01-01", "2026-12-31", extra);
    const before = evaluateOffset({ baseDate: "2026-10-09", days: -1, shiftEnabled: true, ...settings, window: YEAR });
    const after = evaluateOffset({ baseDate: "2026-10-09", days: -1, shiftEnabled: true, ...settings, window: changed });
    expect(before).toMatchObject({ date: "2026-10-08", shifted: false });
    expect(after).toMatchObject({ rawDate: "2026-10-08", date: "2026-10-09", shifted: true });
  });

  it("时刻换算（Asia/Shanghai）：08:00 → UTC 当天 00:00；跨日界按 UTC+8", () => {
    expect(atShanghaiTime("2026-10-08", "08:00")).toBe("2026-10-08T00:00:00.000Z");
    expect(atShanghaiTime("2026-10-08", "10:00")).toBe("2026-10-08T02:00:00.000Z");
    expect(atShanghaiTime("2026-10-08", "00:00")).toBe("2026-10-07T16:00:00.000Z");
  });
});
