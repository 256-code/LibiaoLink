/**
 * 通知投递规则回归（S7-4 · j1 / M5-04 首刀 · C2-09）：纯函数 —— 免打扰（含跨零点 / 次日补发）、
 * 每人每日上限（次日窗口落点）、合并键回退、载荷解析（非法 → dead 的前置）、业务日边界（ADR-028）。
 * 真机口径见 server/src/modules/notify/README.md 与 server/scripts/s7-4-notify-replay.mjs。
 */
import { describe, expect, it } from "vitest";
import {
  formatClockMinute,
  isWithinQuiet,
  mergeKeyOf,
  nextDayWindowStart,
  parseClockMinute,
  parseNotifyMessage,
  parseQuietHours,
  planDelivery,
  quietEndAfter,
  shanghaiDayStart,
  shanghaiMinuteOfDay,
} from "../src/modules/notify/notify.delivery.js";

const QUIET_NIGHT = parseQuietHours("22:00-08:00")!;

const RECIPIENT = "0f9a2b3c-1111-4a2b-8c3d-4e5f60718293";
const REF_ID = "1a2b3c4d-2222-4b3c-9d4e-5f60718293a4";

describe("通知投递 · 免打扰与每日上限（S7-4 · C2-09）", () => {
  it("parseClockMinute / formatClockMinute：HH:MM ↔ 当日分钟，非法输入拒绝", () => {
    expect(parseClockMinute("00:00")).toBe(0);
    expect(parseClockMinute("08:00")).toBe(480);
    expect(parseClockMinute("23:59")).toBe(1439);
    expect(parseClockMinute("24:00")).toBeNull();
    expect(parseClockMinute("8:00")).toBeNull();
    expect(formatClockMinute(480)).toBe("08:00");
    expect(formatClockMinute(1320)).toBe("22:00");
  });

  it("parseQuietHours：空串 = 关闭；起止相同 / 非法 → 关闭（null）", () => {
    expect(parseQuietHours("")).toBeNull();
    expect(parseQuietHours("22:00-08:00")).toEqual({ fromMinute: 1320, toMinute: 480 });
    expect(parseQuietHours("08:00-08:00")).toBeNull();
    expect(parseQuietHours("22:00")).toBeNull();
    expect(parseQuietHours("晚-早")).toBeNull();
  });

  it("isWithinQuiet：跨零点窗口 [22:00, 08:00)，结束点开区间", () => {
    expect(isWithinQuiet(parseClockMinute("23:00")!, QUIET_NIGHT)).toBe(true);
    expect(isWithinQuiet(parseClockMinute("22:00")!, QUIET_NIGHT)).toBe(true);
    expect(isWithinQuiet(parseClockMinute("07:59")!, QUIET_NIGHT)).toBe(true);
    expect(isWithinQuiet(parseClockMinute("08:00")!, QUIET_NIGHT)).toBe(false);
    expect(isWithinQuiet(parseClockMinute("12:00")!, QUIET_NIGHT)).toBe(false);
    const noon = parseQuietHours("12:00-13:00")!;
    expect(isWithinQuiet(parseClockMinute("12:30")!, noon)).toBe(true);
    expect(isWithinQuiet(parseClockMinute("13:00")!, noon)).toBe(false);
    expect(isWithinQuiet(parseClockMinute("11:59")!, noon)).toBe(false);
  });

  it("shanghaiDayStart / shanghaiMinuteOfDay：业务日边界固定 Asia/Shanghai（ADR-028）", () => {
    // 2026-09-28 15:59 UTC = 上海 23:59 → 业务日 09-28；16:00 UTC = 上海 09-29 00:00 → 业务日 09-29。
    expect(shanghaiDayStart(new Date("2026-09-28T15:59:00.000Z")).toISOString()).toBe("2026-09-27T16:00:00.000Z");
    expect(shanghaiDayStart(new Date("2026-09-28T16:00:00.000Z")).toISOString()).toBe("2026-09-28T16:00:00.000Z");
    expect(shanghaiMinuteOfDay(new Date("2026-09-28T15:59:00.000Z"))).toBe(1439);
    expect(shanghaiMinuteOfDay(new Date("2026-09-28T16:00:00.000Z"))).toBe(0);
  });

  it("quietEndAfter：免打扰中 → 时段结束（跨零点 = 次日补发落点）", () => {
    // 上海 2026-09-28 23:00（免打扰中）→ 结束 = 上海 09-29 08:00。
    expect(quietEndAfter(new Date("2026-09-28T15:00:00.000Z"), QUIET_NIGHT).toISOString()).toBe(
      "2026-09-29T00:00:00.000Z",
    );
    // 上海 2026-09-29 07:00（免打扰中，结束仍在同一天）→ 上海 09-29 08:00。
    expect(quietEndAfter(new Date("2026-09-28T23:00:00.000Z"), QUIET_NIGHT).toISOString()).toBe(
      "2026-09-29T00:00:00.000Z",
    );
  });

  it("planDelivery：三种落点（立即 / 免打扰静默 / 每日上限次日窗口）", () => {
    const quietNow = new Date("2026-09-28T15:00:00.000Z"); // 上海 23:00
    expect(planDelivery({ now: quietNow, quiet: QUIET_NIGHT, dailyLimit: 200, deliveredToday: 0, nextDayStartMinute: 480 })).toEqual({
      deliver: false,
      deliverAt: new Date("2026-09-29T00:00:00.000Z"),
      reason: "quiet_hours",
    });
    const daytime = new Date("2026-09-28T06:00:00.000Z"); // 上海 14:00
    expect(planDelivery({ now: daytime, quiet: QUIET_NIGHT, dailyLimit: 200, deliveredToday: 199, nextDayStartMinute: 480 })).toEqual({
      deliver: true,
    });
    expect(planDelivery({ now: daytime, quiet: QUIET_NIGHT, dailyLimit: 200, deliveredToday: 200, nextDayStartMinute: 480 })).toEqual({
      deliver: false,
      deliverAt: new Date("2026-09-29T00:00:00.000Z"),
      reason: "daily_limit",
    });
    // dailyLimit = 0 = 不限：超量也照投。
    expect(planDelivery({ now: daytime, quiet: QUIET_NIGHT, dailyLimit: 0, deliveredToday: 9999, nextDayStartMinute: 480 })).toEqual({
      deliver: true,
    });
    // quiet = null = 关闭免打扰。
    expect(planDelivery({ now: quietNow, quiet: null, dailyLimit: 200, deliveredToday: 0, nextDayStartMinute: 480 })).toEqual({
      deliver: true,
    });
  });

  it("planDelivery：次日窗口起点仍落在免打扰内 → 顺延到时段结束", () => {
    const quietMorning = parseQuietHours("22:00-09:00")!;
    const daytime = new Date("2026-09-28T06:00:00.000Z"); // 上海 14:00
    expect(
      planDelivery({ now: daytime, quiet: quietMorning, dailyLimit: 1, deliveredToday: 1, nextDayStartMinute: 480 }),
    ).toEqual({ deliver: false, deliverAt: new Date("2026-09-29T01:00:00.000Z"), reason: "daily_limit" });
  });

  it("nextDayWindowStart：严格晚于 now 的次日窗口起点（Asia/Shanghai）", () => {
    expect(nextDayWindowStart(new Date("2026-09-28T06:00:00.000Z"), 480).toISOString()).toBe("2026-09-29T00:00:00.000Z");
    expect(nextDayWindowStart(new Date("2026-09-28T15:30:00.000Z"), 480).toISOString()).toBe("2026-09-29T00:00:00.000Z");
  });

  it("mergeKeyOf：显式 mergeKey → templateCode → type:refType:refId 逐级回退", () => {
    const base = { recipientId: RECIPIENT, type: "reminder" as const, title: "标题", body: "正文" };
    expect(mergeKeyOf({ ...base, mergeKey: "A01:me", templateCode: "A01_INBOX_MERGED" })).toBe("A01:me");
    expect(mergeKeyOf({ ...base, templateCode: "A01_INBOX_MERGED" })).toBe("A01_INBOX_MERGED");
    expect(mergeKeyOf({ ...base, refType: "task", refId: REF_ID })).toBe("reminder:task:" + REF_ID);
    expect(mergeKeyOf(base)).toBe("reminder:-:-");
  });

  it("parseNotifyMessage：合法载荷空白归一；非法载荷 → null（消费侧转 dead）", () => {
    const parsed = parseNotifyMessage({
      recipientId: RECIPIENT,
      type: "reminder",
      title: "  日报未填  ",
      body: "  请补填  ",
      refType: "  report  ",
      refId: REF_ID,
      templateCode: null,
      mergeKey: "",
    });
    expect(parsed).toEqual({
      recipientId: RECIPIENT,
      type: "reminder",
      title: "日报未填",
      body: "请补填",
      refType: "report",
      refId: REF_ID,
      templateCode: null,
      mergeKey: null,
    });
    expect(parseNotifyMessage({ recipientId: RECIPIENT, type: "reminder", title: " ", body: "正文" })).toBeNull();
    expect(parseNotifyMessage({ type: "reminder", title: "标题", body: "正文" })).toBeNull();
    expect(parseNotifyMessage({ recipientId: RECIPIENT, type: "unknown", title: "标题", body: "正文" })).toBeNull();
    expect(parseNotifyMessage({ recipientId: RECIPIENT, type: "reminder", title: "标题", body: "正文", refType: "task" })).toBeNull();
  });
});
