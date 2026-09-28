/**
 * project_views（0037 · M2-06 首刀 · A1-03 视图 · Push 168 · wmj 线）。
 * 表口径见 database/migrations/0037_views_follows.sql：视图仅保存配置（filters / columns / sort / grouping），
 * 范围 scope = personal / public；默认视图每人至多一条（部分唯一索引 uq_project_views_owner_default）。
 */
import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { VIEW_SCOPE_KEYS, sqlValueList } from "./literals.js";

/** 保存视图（A1-03）：owner 私有 / 公共两种范围；每人至多一条默认（部分唯一索引，服务端同事务维护）。 */
export const projectViews = pgTable(
  "project_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull().default("personal"),
    name: text("name").notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default({}),
    columns: jsonb("columns").$type<string[]>().notNull().default([]),
    sort: jsonb("sort").$type<{ key: string; order: "asc" | "desc" } | null>(),
    /** 分组方式；库列名避 PG 保留字 group（契约字段同名 grouping）。 */
    grouping: jsonb("grouping").$type<{ key: string } | null>(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_project_views_owner_default").on(table.ownerId).where(sql`is_default`),
    index("ix_project_views_owner_updated").on(table.ownerId, table.updatedAt.desc()),
    index("ix_project_views_scope_updated").on(table.scope, table.updatedAt.desc()),
    check("ck_project_views_scope", sql`${table.scope} in ${sql.raw(sqlValueList(VIEW_SCOPE_KEYS))}`),
    check("ck_project_views_name", sql`char_length(btrim(${table.name})) between 1 and 50`),
    check("ck_project_views_filters_object", sql`jsonb_typeof(${table.filters}) = 'object'`),
    check("ck_project_views_columns_array", sql`jsonb_typeof(${table.columns}) = 'array'`),
  ],
);
