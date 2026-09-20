import { describe, expect, it } from "vitest";
import { ClockService } from "../src/common/clock/clock.service.js";
import type { DatabaseService } from "../src/db/database.service.js";
import type { AuditService } from "../src/modules/admin/index.js";
import type {
  CalendarDayRow,
  CalendarSettingsRow,
  CalendarSettingsUpdatePatch,
} from "../src/modules/calendar/calendar.repository.js";
import { CalendarRepository } from "../src/modules/calendar/calendar.repository.js";
import { CalendarService } from "../src/modules/calendar/calendar.service.js";

const ACTOR = "caa8d763-4b6a-4967-9b26-7d1086272c9c";

function makeDay(date: string, overrides: Partial<CalendarDayRow> = {}): CalendarDayRow {
  return {
    date,
    dayType: "holiday",
    name: "国庆假期",
    note: null,
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    updatedBy: null,
    ...overrides,
  };
}

/** 与规则侧金标数据集同形（合成日历）：10-01 ~ 10-07 放假 + 10-10（周六）调休上班。 */
class FakeCalendarRepository {
  rows: CalendarDayRow[] = [
    makeDay("2026-10-01", { name: "国庆节" }),
    makeDay("2026-10-02"),
    makeDay("2026-10-03"),
    makeDay("2026-10-04"),
    makeDay("2026-10-05"),
    makeDay("2026-10-06"),
    makeDay("2026-10-07"),
    makeDay("2026-10-10", { dayType: "makeup_workday", name: "国庆调休上班" }),
  ];
  settings: CalendarSettingsRow = {
    reminderShiftEnabled: true,
    shiftDirection: "forward",
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    updatedBy: null,
  };

  async listDays(from: string, to: string): Promise<CalendarDayRow[]> {
    return this.rows.filter((row) => row.date >= from && row.date <= to);
  }
  async findDay(date: string): Promise<CalendarDayRow | null> {
    return this.rows.find((row) => row.date === date) ?? null;
  }
  async upsertDay(
    input: { date: string; dayType: string; name?: string; note?: string },
    actorId: string,
    at: Date,
  ): Promise<CalendarDayRow> {
    const existing = this.rows.find((row) => row.date === input.date);
    if (existing === undefined) {
      const created = makeDay(input.date, {
        dayType: input.dayType,
        name: input.name ?? null,
        note: input.note ?? null,
        updatedAt: at,
        updatedBy: actorId,
      });
      this.rows.push(created);
      return created;
    }
    const updated: CalendarDayRow = {
      ...existing,
      dayType: input.dayType,
      name: input.name === undefined ? existing.name : input.name,
      note: input.note === undefined ? existing.note : input.note,
      updatedAt: at,
      updatedBy: actorId,
    };
    this.rows = this.rows.map((row) => (row.date === input.date ? updated : row));
    return updated;
  }
  async deleteDay(date: string): Promise<boolean> {
    const index = this.rows.findIndex((row) => row.date === date);
    if (index < 0) return false;
    this.rows.splice(index, 1);
    return true;
  }
  async getSettings(): Promise<CalendarSettingsRow> {
    return { ...this.settings };
  }
  async updateSettings(patch: CalendarSettingsUpdatePatch, actorId: string, at: Date): Promise<CalendarSettingsRow> {
    const next: CalendarSettingsRow = { ...this.settings, updatedAt: at, updatedBy: actorId };
    if (patch.reminderShiftEnabled !== undefined) next.reminderShiftEnabled = patch.reminderShiftEnabled;
    if (patch.shiftDirection !== undefined) next.shiftDirection = patch.shiftDirection;
    this.settings = next;
    return next;
  }
}

class FakeAuditService {
  entries: unknown[] = [];
  async record(_client: unknown, input: unknown): Promise<void> {
    this.entries.push(input);
  }
}

class FakeDatabase {
  db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  };
}

/** 固定时钟：2026-10-09T20:00:00Z = Asia/Shanghai 2026-10-10 04:00（业务日 = 10-10，调休上班日）。 */
function makeService() {
  const repo = new FakeCalendarRepository();
  const audit = new FakeAuditService();
  const clock = new ClockService();
  clock.setSource(() => new Date("2026-10-09T20:00:00Z"));
  const service = new CalendarService(
    new FakeDatabase() as unknown as DatabaseService,
    repo as unknown as CalendarRepository,
    audit as unknown as AuditService,
    clock,
  );
  return { service, repo, audit };
}

describe("CalendarService · 日历维护（D5-01）", () => {
  it("getYear：返回该年例外清单 + 顺延配置（按日期升序）", async () => {
    const { service } = makeService();
    const year = await service.getYear(2026);
    expect(year.year).toBe(2026);
    expect(year.days.map((day) => day.date)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-10",
    ]);
    expect(year.days[0]).toMatchObject({ dayType: "holiday", name: "国庆节", updatedAt: "2026-09-01T00:00:00.000Z" });
    expect(year.settings).toMatchObject({ reminderShiftEnabled: true, shiftDirection: "forward" });
  });

  it("getDay 缺省今天：按 Asia/Shanghai 业务日判定（10-10 调休上班 = 工作日）", async () => {
    const { service } = makeService();
    await expect(service.getDay()).resolves.toMatchObject({
      date: "2026-10-10",
      kind: "makeup_workday",
      isWorkday: true,
      source: "calendar",
    });
    await expect(service.getDay("2026-09-21")).resolves.toMatchObject({ kind: "workday", isWorkday: true, source: "default" });
  });

  it("setDay 新增例外：写审计 create（字段级 changes）并返回更新后的整年日历", async () => {
    const { service, audit } = makeService();
    const year = await service.setDay("2026-11-03", { dayType: "holiday", name: "临时放假" }, ACTOR);
    expect(year.days.map((day) => day.date)).toContain("2026-11-03");
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      actorId: ACTOR,
      action: "create",
      objectType: "calendar_day",
      objectId: "2026-11-03",
      metadata: { dayType: "holiday" },
    });
    const entry = audit.entries[0] as { changes: { field: string; from: unknown; to: unknown }[] };
    expect(entry.changes.map((change) => change.field)).toEqual(["dayType", "name"]);
    expect(entry.changes.find((change) => change.field === "dayType")).toMatchObject({ from: null, to: "holiday" });
  });

  it("setDay 幂等 upsert：同一天改类型 → 审计 update；name 缺省保持原值", async () => {
    const { service, repo, audit } = makeService();
    await service.setDay("2026-10-02", { dayType: "makeup_workday" }, ACTOR);
    expect(repo.rows.find((row) => row.date === "2026-10-02")).toMatchObject({
      dayType: "makeup_workday",
      name: "国庆假期",
      updatedBy: ACTOR,
    });
    expect(audit.entries[0]).toMatchObject({ action: "update", objectId: "2026-10-02" });
  });

  it("deleteDay：无该例外 → 404 NOT_FOUND；命中 → 审计 delete 且回落默认规则", async () => {
    const { service, audit } = makeService();
    await expect(service.deleteDay("2026-11-03", ACTOR)).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });

    const year = await service.deleteDay("2026-10-01", ACTOR);
    expect(year.days.map((day) => day.date)).not.toContain("2026-10-01");
    expect(audit.entries[0]).toMatchObject({ actorId: ACTOR, action: "delete", objectType: "calendar_day", objectId: "2026-10-01" });
  });
});

describe("CalendarService · 顺延配置（D5-02）", () => {
  it("updateSettings：写审计 update（objectId = default），返回更新后的配置", async () => {
    const { service, audit } = makeService();
    const settings = await service.updateSettings({ reminderShiftEnabled: false, shiftDirection: "backward" }, ACTOR);
    expect(settings).toMatchObject({ reminderShiftEnabled: false, shiftDirection: "backward", updatedBy: ACTOR });
    expect(audit.entries[0]).toMatchObject({ action: "update", objectType: "calendar_settings", objectId: "default" });
    const entry = audit.entries[0] as { changes: { field: string; from: unknown; to: unknown }[] };
    expect(entry.changes).toEqual([
      { field: "reminderShiftEnabled", from: true, to: false },
      { field: "shiftDirection", from: "forward", to: "backward" },
    ]);
  });

  it("updateSettings 空变更：changes = null（不留噪声）", async () => {
    const { service, audit } = makeService();
    await service.updateSettings({ reminderShiftEnabled: true }, ACTOR);
    expect(audit.entries[0]).toMatchObject({ changes: null });
  });
});

describe("CalendarService · 顺延与 T-N / T+N 求值（D5-03）", () => {
  it("shift：缺省用配置方向（backward）—— 假期内日期提前到节前最后工作日", async () => {
    const { service, repo } = makeService();
    repo.settings.shiftDirection = "backward";
    await expect(service.shift({ date: "2026-10-02" })).resolves.toMatchObject({
      baseDate: "2026-10-02",
      direction: "backward",
      date: "2026-09-30",
      shifted: true,
      baseKind: "holiday",
      baseIsWorkday: false,
    });
  });

  it("shift：显式方向覆盖配置；已是工作日原样返回", async () => {
    const { service, repo } = makeService();
    repo.settings.shiftDirection = "backward";
    await expect(service.shift({ date: "2026-10-02", direction: "forward" })).resolves.toMatchObject({ date: "2026-10-08" });
    await expect(service.shift({ date: "2026-10-09" })).resolves.toMatchObject({
      date: "2026-10-09",
      shifted: false,
      skipped: [],
      baseIsWorkday: true,
    });
  });

  it("offset：T-1 命中（基准 10-10 → 10-09），缺省基准日期取时钟业务日", async () => {
    const { service } = makeService();
    await expect(service.offset({ days: -1, shift: "inherit" })).resolves.toMatchObject({
      baseDate: "2026-10-10",
      rawDate: "2026-10-09",
      date: "2026-10-09",
      shifted: false,
      kind: "workday",
      at: null,
    });
  });

  it("offset：节假日顺延开 / 关两态（配置驱动）+ 08:00 时刻换算", async () => {
    const { service, repo } = makeService();
    const enabled = await service.offset({ date: "2026-10-09", days: -7, time: "08:00", shift: "inherit" });
    expect(enabled).toMatchObject({
      rawDate: "2026-10-02",
      date: "2026-10-08",
      shifted: true,
      shiftDirection: "forward",
      at: "2026-10-08T00:00:00.000Z",
    });

    repo.settings.reminderShiftEnabled = false;
    const disabled = await service.offset({ date: "2026-10-09", days: -7, time: "08:00", shift: "inherit" });
    expect(disabled).toMatchObject({ rawDate: "2026-10-02", date: "2026-10-02", shifted: false, at: "2026-10-02T00:00:00.000Z" });

    const forced = await service.offset({ date: "2026-10-09", days: -7, shift: "on" });
    expect(forced).toMatchObject({ date: "2026-10-08", shifted: true });
  });

  it("offset：T+1 逐级（A03 / A06 升级链路的时间基准，+3 / +7 同理）", async () => {
    const { service } = makeService();
    await expect(service.offset({ date: "2026-09-30", days: 1, shift: "on" })).resolves.toMatchObject({
      rawDate: "2026-10-01",
      date: "2026-10-08",
      shifted: true,
    });
    await expect(service.offset({ date: "2026-10-10", days: 1, shift: "inherit" })).resolves.toMatchObject({
      rawDate: "2026-10-11",
      date: "2026-10-12",
      shifted: true,
    });
  });
});
