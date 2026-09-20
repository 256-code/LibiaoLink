import { desc, sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { PROJECT_MEMBER_ROLES, STAGE_KEYS, sqlValueList } from "./literals.js";

/** projects（0001 基线 + 0002 收敛：唯一责任人为 manager_id，无 owner_id）。 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    seqNo: integer("seq_no").notNull().default(sql`nextval('projects_seq_no_seq')`),
    name: text("name").notNull(),
    customer: text("customer"),
    region: text("region").notNull(),
    projectType: text("project_type").notNull(),
    managerId: uuid("manager_id").notNull(),
    stageKey: text("stage_key").notNull(),
    status: text("status").notNull(),
    description: text("description"),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** deleted_at / deleted_by（0009）：软删（A5）；列表 / 详情 / facets 一律过滤 deleted_at is null。 */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
  },
  (table) => [
    unique("projects_code_key").on(table.code),
    unique("uq_projects_seq_no").on(table.seqNo),
    index("ix_projects_facets").on(table.region, table.projectType, table.managerId),
    index("ix_projects_stage").on(table.status, table.stageKey),
    index("ix_projects_active_updated").on(desc(table.updatedAt)).where(sql`deleted_at is null`),
    check(
      "ck_projects_stage_key",
      sql`${table.stageKey} in ${sql.raw(sqlValueList(STAGE_KEYS))}`,
    ),
    check("ck_projects_status", sql`${table.status} in ${sql.raw(sqlValueList(["active", "paused", "done", "archived"]))}`),
    check("ck_projects_version", sql`${table.version} >= 0`),
    check("ck_projects_seq_no", sql`${table.seqNo} > 0`),
  ],
);

/** project_members（0010 · h2）：项目成员名册 —— 记录级权限与「我参与的项目」的来源（h6 消费）；项目软删不删行。 */
export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    roleInProject: text("role_in_project").notNull().default("project_member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_project_members_project_user").on(table.projectId, table.userId),
    index("ix_project_members_user").on(table.userId),
    check(
      "ck_project_members_role",
      sql`${table.roleInProject} in ${sql.raw(sqlValueList(PROJECT_MEMBER_ROLES))}`,
    ),
  ],
);

/** project_stages（导入蓝图时生成）。 */
export const projectStages = pgTable(
  "project_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    stageKey: text("stage_key").notNull(),
    seq: smallint("seq").notNull(),
    status: text("status").notNull(),
    plannedStart: date("planned_start"),
    plannedEnd: date("planned_end"),
    actualStart: date("actual_start"),
    actualEnd: date("actual_end"),
    version: integer("version").notNull().default(0),
  },
  (table) => [
    unique("project_stages_project_id_stage_key_key").on(table.projectId, table.stageKey),
    check(
      "ck_project_stages_stage_key",
      sql`${table.stageKey} in ${sql.raw(sqlValueList(STAGE_KEYS))}`,
    ),
    check("ck_project_stages_status", sql`${table.status} in ${sql.raw(sqlValueList(["pending", "active", "done"]))}`),
    check("ck_project_stages_seq", sql`${table.seq} > 0`),
  ],
);
