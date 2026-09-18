import { sql } from "drizzle-orm";
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
import { STAGE_KEYS, sqlValueList } from "./literals.js";

/** projects（0001 基线 + 0002 收敛：唯一责任人为 manager_id，无 owner_id）。 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
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
  },
  (table) => [
    unique("projects_code_key").on(table.code),
    index("ix_projects_facets").on(table.region, table.projectType, table.managerId),
    index("ix_projects_stage").on(table.status, table.stageKey),
    check(
      "ck_projects_stage_key",
      sql`${table.stageKey} in ${sql.raw(sqlValueList(STAGE_KEYS))}`,
    ),
    check("ck_projects_status", sql`${table.status} in ${sql.raw(sqlValueList(["active", "paused", "done", "archived"]))}`),
    check("ck_projects_version", sql`${table.version} >= 0`),
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
