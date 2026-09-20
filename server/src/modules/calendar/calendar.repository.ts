import { Injectable } from "@nestjs/common";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { calendarDays, calendarSettings } from "../../db/schema/calendar.js";

/** calendar_days 行（日历例外）。 */
export interface CalendarDayRow {
  date: string;
  dayType: string;
  name: string | null;
  note: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

/** calendar_settings 行（顺延配置，单行）。 */
export interface CalendarSettingsRow {
  reminderShiftEnabled: boolean;
  shiftDirection: string;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface CalendarDayUpsertInput {
  date: string;
  dayType: string;
  name?: string;
  note?: string;
}

export interface CalendarSettingsUpdatePatch {
  reminderShiftEnabled?: boolean;
  shiftDirection?: string;
}

const DAY_COLUMNS = {
  date: calendarDays.date,
  dayType: calendarDays.dayType,
  name: calendarDays.name,
  note: calendarDays.note,
  updatedAt: calendarDays.updatedAt,
  updatedBy: calendarDays.updatedBy,
};

const SETTINGS_COLUMNS = {
  reminderShiftEnabled: calendarSettings.reminderShiftEnabled,
  shiftDirection: calendarSettings.shiftDirection,
  updatedAt: calendarSettings.updatedAt,
  updatedBy: calendarSettings.updatedBy,
};

/** 工作日历数据访问（h8 · D5）：例外表（只增删例外）+ 单行顺延配置。 */
@Injectable()
export class CalendarRepository {
  constructor(private readonly database: DatabaseService) {}

  /** 区间例外（含边界）：求值窗口的唯一查询入口（按年 / 跨年同一路径）。 */
  async listDays(from: string, to: string, client: DbClient = this.database.db): Promise<CalendarDayRow[]> {
    return client
      .select(DAY_COLUMNS)
      .from(calendarDays)
      .where(and(gte(calendarDays.date, from), lte(calendarDays.date, to)))
      .orderBy(asc(calendarDays.date));
  }

  async findDay(date: string, client: DbClient = this.database.db): Promise<CalendarDayRow | null> {
    const rows = await client.select(DAY_COLUMNS).from(calendarDays).where(eq(calendarDays.date, date)).limit(1);
    return rows[0] ?? null;
  }

  /** PUT 幂等 upsert（D5-01）：name / note 缺省时保持原值（新建时为空）。 */
  async upsertDay(input: CalendarDayUpsertInput, actorId: string, at: Date, client: DbClient): Promise<CalendarDayRow> {
    const rows = await client
      .insert(calendarDays)
      .values({
        date: input.date,
        dayType: input.dayType,
        name: input.name ?? null,
        note: input.note ?? null,
        createdAt: at,
        updatedAt: at,
        updatedBy: actorId,
      })
      .onConflictDoUpdate({
        target: calendarDays.date,
        set: {
          dayType: input.dayType,
          updatedAt: at,
          updatedBy: actorId,
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.note === undefined ? {} : { note: input.note }),
        },
      })
      .returning(DAY_COLUMNS);
    const row = rows[0];
    if (row === undefined) throw new Error("calendar_days upsert 未返回行");
    return row;
  }

  /** 删除例外：返回是否命中（false = 该日期本就没有例外，服务层转 404）。 */
  async deleteDay(date: string, client: DbClient): Promise<boolean> {
    const rows = await client.delete(calendarDays).where(eq(calendarDays.date, date)).returning({ date: calendarDays.date });
    return rows.length > 0;
  }

  /** 顺延配置（单行）：缺行时补默认行（迁移已建，此处为防御式幂等）。 */
  async getSettings(client: DbClient = this.database.db): Promise<CalendarSettingsRow> {
    const rows = await client.select(SETTINGS_COLUMNS).from(calendarSettings).where(eq(calendarSettings.id, true)).limit(1);
    const found = rows[0];
    if (found !== undefined) return found;
    await client.insert(calendarSettings).values({ id: true }).onConflictDoNothing();
    const retry = await client.select(SETTINGS_COLUMNS).from(calendarSettings).where(eq(calendarSettings.id, true)).limit(1);
    const row = retry[0];
    if (row === undefined) throw new Error("calendar_settings 单行缺失");
    return row;
  }

  /** 更新顺延配置（部分更新）。 */
  async updateSettings(
    patch: CalendarSettingsUpdatePatch,
    actorId: string,
    at: Date,
    client: DbClient,
  ): Promise<CalendarSettingsRow> {
    const set: Record<string, unknown> = { updatedAt: at, updatedBy: actorId };
    if (patch.reminderShiftEnabled !== undefined) set["reminderShiftEnabled"] = patch.reminderShiftEnabled;
    if (patch.shiftDirection !== undefined) set["shiftDirection"] = patch.shiftDirection;
    const rows = await client
      .update(calendarSettings)
      .set(set)
      .where(eq(calendarSettings.id, true))
      .returning(SETTINGS_COLUMNS);
    const row = rows[0];
    if (row === undefined) throw new Error("calendar_settings 更新未返回行");
    return row;
  }
}
