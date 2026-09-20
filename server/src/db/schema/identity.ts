import { desc, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { DATA_SCOPE_KEYS, sqlValueList } from "./literals.js";

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
    /** removed_at（0008）：delete 动作置位（目录源已删除）；enable 清空；不物理删除用户行。 */
    removedAt: timestamp("removed_at", { withTimezone: true }),
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

/** departments（0007）：企微 / Casdoor 同步的部门树；快照中缺失的部门置 disabled（不物理删除）。 */
export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => departments.id),
    sourceId: text("source_id"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("departments_source_id_key").on(table.sourceId),
    index("ix_departments_parent").on(table.parentId),
    check(
      "ck_departments_status",
      sql`${table.status} in ${sql.raw(sqlValueList(["active", "disabled"]))}`,
    ),
    check("ck_departments_not_self_parent", sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`),
  ],
);

/** roles（0007）：一期六个内置角色，种子见 database/seeds/roles.mjs；data_scope 见 DATA_SCOPE_KEYS。 */
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    dataScope: text("data_scope").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("roles_code_key").on(table.code),
    check("ck_roles_code", sql`${table.code} ~ '^[a-z][a-z0-9_]*$'`),
    check(
      "ck_roles_data_scope",
      sql`${table.dataScope} in ${sql.raw(sqlValueList(DATA_SCOPE_KEYS))}`,
    ),
  ],
);

/** role_permissions（0007）：功能权限位（模块.操作）；矩阵条目随 h6（PoC-6）填充。 */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "role_permissions_pkey", columns: [table.roleId, table.permission] }),
    check("ck_role_permissions_key", sql`${table.permission} ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'`),
  ],
);

/** user_roles（0007）：用户 ↔ 角色绑定；多角色取并集（role.service.ts）。 */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "user_roles_pkey", columns: [table.userId, table.roleId] }),
    index("ix_user_roles_role").on(table.roleId),
  ],
);
