/**
 * follows（0037 · M2-06 首刀 · A1-15 关注 · Push 168 · wmj 线）。
 * 表口径见 database/migrations/0037_views_follows.sql：关注 = 幂等关系行（user × object_type × object_id），
 * 多态 object_id 不设外键（项目硬删时由 project 仓储按关系键一并清理；任务关注随项目硬删清理）。
 */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { FOLLOW_OBJECT_TYPE_KEYS, sqlValueList } from "./literals.js";

/** 关注关系（A1-15）：user × object_type × object_id 唯一；取关 = 按关系键物理删行。 */
export const follows = pgTable(
  "follows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_follows_user_object").on(table.userId, table.objectType, table.objectId),
    index("ix_follows_object").on(table.objectType, table.objectId),
    index("ix_follows_user_created").on(table.userId, table.createdAt.desc(), table.id),
    check("ck_follows_object_type", sql`${table.objectType} in ${sql.raw(sqlValueList(FOLLOW_OBJECT_TYPE_KEYS))}`),
  ],
);
