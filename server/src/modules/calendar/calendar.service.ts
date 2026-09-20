import { Injectable } from "@nestjs/common";
import type {
  CalendarDay,
  CalendarDayUpsertBody,
  CalendarDayView,
  CalendarOffsetQuery,
  CalendarOffsetResult,
  CalendarSettingsUpdateBody,
  CalendarShiftQuery,
  CalendarShiftResult,
  CalendarShiftSettings,
  CalendarYear,
} from "@libiaolink/contracts";
import { ClockService } from "../../common/clock/clock.service.js";
import { AppError } from "../../common/errors/app-error.js";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { AuditService, diffRecords } from "../admin/index.js";
import type { CalendarDayRow, CalendarSettingsRow } from "./calendar.repository.js";
import { CalendarRepository } from "./calendar.repository.js";
import { addDays, atShanghaiTime, calendarWindow, evaluateOffset, resolveDay, shiftToWorkday } from "./calendar.rules.js";
import type { CalendarException, CalendarShiftDirection, CalendarShiftMode, CalendarWindow } from "./calendar.rules.js";

/** 求值窗口跨度（天）：顺延最远查找一年；T±N 在此基础上再叠加自然日偏移量。 */
const WINDOW_SPAN_DAYS = 370;

const DAY_TYPE_LABELS: Record<string, string> = { holiday: "放假", makeup_workday: "调休上班" };
const DIRECTION_LABELS: Record<string, string> = { forward: "顺延到之后最近工作日", backward: "提前到之前最近工作日" };

function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

function toDirection(value: string): CalendarShiftDirection {
  return value === "backward" ? "backward" : "forward";
}

function toCalendarDay(row: CalendarDayRow): CalendarDay {
  return {
    date: row.date,
    dayType: row.dayType as CalendarDay["dayType"],
    name: row.name,
    note: row.note,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

function toSettings(row: CalendarSettingsRow): CalendarShiftSettings {
  return {
    reminderShiftEnabled: row.reminderShiftEnabled,
    shiftDirection: toDirection(row.shiftDirection),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

function toException(row: CalendarDayRow): CalendarException {
  return { date: row.date, dayType: row.dayType as CalendarException["dayType"], name: row.name, note: row.note };
}

function daySnapshot(row: CalendarDayRow | null): Record<string, unknown> | null {
  return row === null ? null : { dayType: row.dayType, name: row.name, note: row.note };
}

function settingsSnapshot(row: CalendarSettingsRow): Record<string, unknown> {
  return { reminderShiftEnabled: row.reminderShiftEnabled, shiftDirection: row.shiftDirection };
}

/**
 * 工作日历用例（h8 · D5）：
 * 1) 日历维护（D5-01）：读写例外（放假 / 调休上班），变更写审计留痕（与业务同事务）；
 * 2) 顺延规则配置（D5-02）：是否顺延 + 方向（单行配置），变更写审计留痕；
 * 3) 日期求值（D5-03）：顺延 / T-N·T+N 实时求值（不缓存、不落库）—— 改期后按新日期重算（i8 规则引擎直接复用）。
 * 基准日期一律经 ClockService（缺省今天，Asia/Shanghai），测试可注入固定时钟复算。
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly database: DatabaseService,
    private readonly calendar: CalendarRepository,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  /** GET /api/v1/calendar/days：某年例外清单 + 顺延配置（登录即可读）。 */
  async getYear(year: number, client: DbClient = this.database.db): Promise<CalendarYear> {
    const rows = await this.calendar.listDays(year + "-01-01", year + "-12-31", client);
    const settings = await this.calendar.getSettings(client);
    return { year, days: rows.map(toCalendarDay), settings: toSettings(settings) };
  }

  /** GET /api/v1/calendar/day：某天的工作日判定（缺省今天）。 */
  async getDay(date?: string): Promise<CalendarDayView> {
    const target = date ?? this.clock.today();
    const window = await this.buildWindow(target, 1);
    const resolved = resolveDay(target, window);
    if (resolved === null) throw new AppError("INTERNAL", "工作日历窗口异常：" + target);
    return {
      date: resolved.date,
      kind: resolved.kind,
      isWorkday: resolved.isWorkday,
      name: resolved.name,
      note: resolved.note,
      source: resolved.source,
    };
  }

  /** PUT /api/v1/calendar/days/{date}（calendar.manage）：幂等设置例外 + 留痕；响应为更新后的整年日历。 */
  async setDay(date: string, body: CalendarDayUpsertBody, actorId: string): Promise<CalendarYear> {
    const at = this.clock.now();
    await this.database.db.transaction(async (tx) => {
      const before = await this.calendar.findDay(date, tx);
      const saved = await this.calendar.upsertDay(
        { date, dayType: body.dayType, name: body.name, note: body.note },
        actorId,
        at,
        tx,
      );
      const changes = diffRecords(daySnapshot(before), daySnapshot(saved));
      await this.audit.record(tx, {
        actorId,
        action: before === null ? "create" : "update",
        objectType: "calendar_day",
        objectId: date,
        summary:
          (before === null ? "设置日历例外：" : "修改日历例外：") +
          date +
          " · " +
          (DAY_TYPE_LABELS[saved.dayType] ?? saved.dayType) +
          (saved.name === null ? "" : "（" + saved.name + "）"),
        changes: changes.length > 0 ? changes : null,
        metadata: { dayType: saved.dayType },
      });
    });
    return this.getYear(yearOf(date));
  }

  /** DELETE /api/v1/calendar/days/{date}（calendar.manage）：删除例外（回落默认规则）；无该例外 404。 */
  async deleteDay(date: string, actorId: string): Promise<CalendarYear> {
    const at = this.clock.now();
    await this.database.db.transaction(async (tx) => {
      const before = await this.calendar.findDay(date, tx);
      if (before === null) throw new AppError("NOT_FOUND", "该日期没有日历例外：" + date);
      await this.calendar.deleteDay(date, tx);
      const changes = diffRecords(daySnapshot(before), null);
      await this.audit.record(tx, {
        actorId,
        action: "delete",
        objectType: "calendar_day",
        objectId: date,
        summary:
          "删除日历例外：" + date + " · " + (DAY_TYPE_LABELS[before.dayType] ?? before.dayType) + "（回落默认规则）",
        changes: changes.length > 0 ? changes : null,
        metadata: { dayType: before.dayType },
      });
    });
    return this.getYear(yearOf(date));
  }

  /** GET /api/v1/calendar/settings：顺延规则配置（登录即可读）。 */
  async getSettings(client: DbClient = this.database.db): Promise<CalendarShiftSettings> {
    return toSettings(await this.calendar.getSettings(client));
  }

  /** PUT /api/v1/calendar/settings（calendar.manage）：更新顺延规则（部分更新）+ 留痕。 */
  async updateSettings(body: CalendarSettingsUpdateBody, actorId: string): Promise<CalendarShiftSettings> {
    const at = this.clock.now();
    await this.database.db.transaction(async (tx) => {
      const before = await this.calendar.getSettings(tx);
      const saved = await this.calendar.updateSettings(
        { reminderShiftEnabled: body.reminderShiftEnabled, shiftDirection: body.shiftDirection },
        actorId,
        at,
        tx,
      );
      const changes = diffRecords(settingsSnapshot(before), settingsSnapshot(saved));
      await this.audit.record(tx, {
        actorId,
        action: "update",
        objectType: "calendar_settings",
        objectId: "default",
        summary:
          "更新顺延规则：是否顺延 " +
          (saved.reminderShiftEnabled ? "开" : "关") +
          " · " +
          (DIRECTION_LABELS[saved.shiftDirection] ?? saved.shiftDirection),
        changes: changes.length > 0 ? changes : null,
        metadata: {},
      });
    });
    return this.getSettings();
  }

  /**
   * GET /api/v1/calendar/shift：顺延求值（登录即可读）。
   * 金标（R03）：节假日顺延开 / 关两态由配置驱动 —— 开关只影响本接口之外的使用方（i8 提醒编排），
   * 本接口本身是显式求值（按方向移动到最近工作日），开 / 关两态在 offset 接口与规则引擎侧体现。
   */
  async shift(query: CalendarShiftQuery): Promise<CalendarShiftResult> {
    const settings = await this.calendar.getSettings();
    const baseDate = query.date ?? this.clock.today();
    const direction: CalendarShiftDirection = query.direction ?? toDirection(settings.shiftDirection);
    const window = await this.buildWindow(baseDate, WINDOW_SPAN_DAYS);
    const base = resolveDay(baseDate, window);
    const outcome = shiftToWorkday(baseDate, direction, window);
    if (base === null || !outcome.ok) {
      throw new AppError("INTERNAL", "工作日历窗口不足（连续非工作日超过一年），请检查日历数据：" + baseDate);
    }
    return {
      baseDate,
      direction,
      date: outcome.date,
      shifted: outcome.shifted,
      skipped: outcome.skipped,
      baseKind: base.kind,
      baseIsWorkday: base.isWorkday,
      kind: outcome.kind,
      name: outcome.name,
    };
  }

  /**
   * GET /api/v1/calendar/offset：T-N / T+N 实时求值（登录即可读）。
   * 口径（D5-03 / R03 / R05）：自然日偏移 → 「顺延开关」→ 顺延到最近工作日 →（可选）叠加提醒时刻（08:00）。
   * shift=inherit 时按日历配置（D5-02）生效；on / off 供规则引擎回放与金标用例强制覆盖。
   */
  async offset(query: CalendarOffsetQuery): Promise<CalendarOffsetResult> {
    const settings = await this.calendar.getSettings();
    const baseDate = query.date ?? this.clock.today();
    const mode: CalendarShiftMode = query.shift ?? "inherit";
    const direction = toDirection(settings.shiftDirection);
    const shiftEnabled = mode === "on" || (mode === "inherit" && settings.reminderShiftEnabled);
    const window = await this.buildWindow(baseDate, Math.abs(query.days) + WINDOW_SPAN_DAYS);
    const outcome = evaluateOffset({ baseDate, days: query.days, shiftEnabled, shiftDirection: direction, window });
    if (outcome === null) {
      throw new AppError("INTERNAL", "工作日历窗口不足（连续非工作日超过一年），请检查日历数据：" + baseDate);
    }
    return {
      baseDate,
      days: query.days,
      time: query.time ?? null,
      shift: mode,
      rawDate: outcome.rawDate,
      date: outcome.date,
      shifted: outcome.shifted,
      shiftDirection: outcome.shiftDirection,
      kind: outcome.kind,
      name: outcome.name,
      at: query.time === undefined ? null : atShanghaiTime(outcome.date, query.time),
    };
  }

  /** 求值窗口：一次加载覆盖 [base - span, base + span] 的例外（跨年自动包含）。 */
  private async buildWindow(baseDate: string, span: number, client: DbClient = this.database.db): Promise<CalendarWindow> {
    const from = addDays(baseDate, -span);
    const to = addDays(baseDate, span);
    const rows = await this.calendar.listDays(from, to, client);
    return calendarWindow(from, to, rows.map(toException));
  }
}
