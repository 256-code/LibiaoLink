import { boolean, check, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { CALENDAR_DAY_TYPE_KEYS, CALENDAR_SHIFT_DIRECTION_KEYS, sqlValueList } from "./literals.js";

/**
 * 工作日历（D5 · h8）：calendar_days 只存「例外」（放假 / 调休上班）；calendar_settings 为单行顺延配置。
 * 与 database/migrations/0014_work_calendar.sql 对齐（check:db-schema 逐列 / 逐索引 / 逐 CHECK 比对）。
 */

/** 日历例外（D5-01）：holiday 放假 / makeup_workday 调休上班；未登记日期按默认规则判定。 */
export const calendarDays = pgTable(
  "calendar_days",
  {
    date: date("date").primaryKey(),
    dayType: text("day_type").notNull(),
    name: text("name"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
  },
  (table) => [
    check("ck_calendar_days_day_type", sql`${table.dayType} in ${sql.raw(sqlValueList(CALENDAR_DAY_TYPE_KEYS))}`),
    check("ck_calendar_days_date", sql`${table.date} between date '2000-01-01' and date '2100-12-31'`),
    check("ck_calendar_days_name", sql`${table.name} is null or char_length(btrim(${table.name})) between 1 and 80`),
    check("ck_calendar_days_note", sql`${table.note} is null or char_length(btrim(${table.note})) between 1 and 200`),
    index("ix_calendar_days_type").on(table.dayType, table.date),
  ],
);

/** 顺延规则配置（D5-02，单行）：是否顺延 + 顺延方向。 */
export const calendarSettings = pgTable(
  "calendar_settings",
  {
    id: boolean("id").primaryKey().default(true),
    reminderShiftEnabled: boolean("reminder_shift_enabled").notNull().default(true),
    shiftDirection: text("shift_direction").notNull().default("forward"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
  },
  (table) => [
    check("ck_calendar_settings_single", sql`${table.id}`),
    check(
      "ck_calendar_settings_direction",
      sql`${table.shiftDirection} in ${sql.raw(sqlValueList(CALENDAR_SHIFT_DIRECTION_KEYS))}`,
    ),
  ],
);
