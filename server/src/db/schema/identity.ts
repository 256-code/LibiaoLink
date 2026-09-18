import { desc, sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sqlValueList } from "./literals.js";

/** users（0004）：SSO 归一化用户；离职禁用由组织同步（h1）维护。 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    casdoorId: text("casdoor_id").notNull(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    owner: text("owner"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("users_casdoor_id_key").on(table.casdoorId),
    unique("users_username_key").on(table.username),
    check(
      "ck_users_status",
      sql`${table.status} in ${sql.raw(sqlValueList(["active", "disabled"]))}`,
    ),
  ],
);

/** sessions（0004）：会话 Cookie 值只存 sha256 哈希；id_token 仅用于单点登出（ADR-010）。 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    idToken: text("id_token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("sessions_token_hash_key").on(table.tokenHash),
    index("ix_sessions_user").on(table.userId, desc(table.expiresAt)),
    index("ix_sessions_expiry").on(table.expiresAt),
    check("ck_sessions_expires", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);
