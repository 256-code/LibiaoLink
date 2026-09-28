/**
 * notifications / notify_prefs（0040 · S7-4 · j1 / M5-04 首刀 · lan 线）。
 * 表口径见 database/migrations/0040_notify_delivery.sql：一行 = 一条投递事件（source_dedupe_key 唯一 =
 * 消费幂等）；合并子行（merged_into_id 非空）仅库内留档、不进收件箱；deliver_at / delivered_at 承载
 * 免打扰次日补发与每日上限排队的延迟投递；notify_prefs 一人一行、可空列 = 继承 env 缺省。
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { NOTIFICATION_STATUS_KEYS, NOTIFICATION_TYPE_KEYS, sqlValueList } from "./literals.js";

/** 站内信（C5-01 / C5-03）：收件箱主行 + 合并子行（全量留档）。 */
export const notifications = pgTable(
  "notifications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("unread"),
    /** 关联对象（ref_type / ref_id 成对）：project / task / report / issue / file / node 等，与审计对象类型同词汇表。 */
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    /** 来源 outbox 主题（当前恒为 notify.message；留列便于多生产者主题回溯）。 */
    sourceTopic: text("source_topic").notNull(),
    /** 来源 outbox 去重键（唯一）：消费重放不重复落行。 */
    sourceDedupeKey: text("source_dedupe_key").notNull(),
    templateCode: text("template_code"),
    /** 合并键（缺省按契约回退：templateCode → type:refType:refId）。 */
    mergeKey: text("merge_key").notNull(),
    /** 合并条数（未合并 = 1；命中合并时主行自增）。 */
    mergedCount: integer("merged_count").notNull().default(1),
    /** 合并归属：非空 = 本行是子行（仅留档、不进收件箱）。 */
    mergedIntoId: bigint("merged_into_id", { mode: "number" }).references((): AnyPgColumn => notifications.id, {
      onDelete: "cascade",
    }),
    /** 计划投递时刻（免打扰 / 每日上限 → 排到下一投递窗口）。 */
    deliverAt: timestamp("deliver_at", { withTimezone: true }).notNull().defaultNow(),
    /** 实际投递时刻；null = 尚未投递（子行恒为 null）。 */
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_notifications_source_dedupe_key").on(table.sourceDedupeKey),
    index("ix_notifications_inbox").on(table.recipientId, table.id.desc()).where(sql`merged_into_id is null`),
    index("ix_notifications_unread")
      .on(table.recipientId)
      .where(sql`merged_into_id is null and status = 'unread'`),
    index("ix_notifications_due")
      .on(table.deliverAt)
      .where(sql`merged_into_id is null and delivered_at is null`),
    index("ix_notifications_merge").on(table.recipientId, table.mergeKey, table.createdAt.desc()).where(sql`merged_into_id is null`),
    index("ix_notifications_daily")
      .on(table.recipientId, table.deliveredAt)
      .where(sql`merged_into_id is null and delivered_at is not null`),
    check("ck_notifications_type", sql`${table.type} in ${sql.raw(sqlValueList(NOTIFICATION_TYPE_KEYS))}`),
    check("ck_notifications_status", sql`${table.status} in ${sql.raw(sqlValueList(NOTIFICATION_STATUS_KEYS))}`),
    check("ck_notifications_title", sql`char_length(btrim(${table.title})) between 1 and 200`),
    check("ck_notifications_body", sql`char_length(btrim(${table.body})) between 1 and 4000`),
    check("ck_notifications_ref", sql`(${table.refType} is null) = (${table.refId} is null)`),
    check("ck_notifications_merged_count", sql`${table.mergedCount} >= 1`),
    check("ck_notifications_merged_into", sql`${table.mergedIntoId} is null or ${table.mergedIntoId} <> ${table.id}`),
    check("ck_notifications_delivery", sql`${table.mergedIntoId} is null or ${table.deliveredAt} is null`),
  ],
);

/** 通知偏好（C2-09）：一人一行；可空列 = 继承 env 缺省（免打扰两列同生共死）。 */
export const notifyPrefs = pgTable(
  "notify_prefs",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 免打扰三态（HH:MM-HH:MM，Asia/Shanghai）：null = 继承 env 缺省 / '' = 关闭 / 自定义时段（跨零点允许）。 */
    quietHours: text("quiet_hours"),
    /** 每人每日投递上限（0 = 不限；null = 继承 env 缺省）。 */
    dailyLimit: integer("daily_limit"),
    /** 合并窗口毫秒（0 = 不合并；null = 继承 env 缺省）。 */
    mergeWindowMs: integer("merge_window_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "ck_notify_prefs_quiet",
      sql`${table.quietHours} is null or ${table.quietHours} = '' or (${table.quietHours} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$' and split_part(${table.quietHours}, '-', 1) <> split_part(${table.quietHours}, '-', 2))`,
    ),
    check(
      "ck_notify_prefs_daily_limit",
      sql`${table.dailyLimit} is null or (${table.dailyLimit} >= 0 and ${table.dailyLimit} <= 1000)`,
    ),
    check(
      "ck_notify_prefs_merge_window",
      sql`${table.mergeWindowMs} is null or (${table.mergeWindowMs} >= 0 and ${table.mergeWindowMs} <= 86400000)`,
    ),
  ],
);
