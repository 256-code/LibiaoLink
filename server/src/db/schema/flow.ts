import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sqlValueList } from "./literals.js";
import { projectStages, projects } from "./projects.js";

/** project_nodes（流程节点实例：蓝图快照 + 按模板增删 + 留痕）。 */
export const projectNodes = pgTable(
  "project_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    stageId: uuid("stage_id").notNull().references(() => projectStages.id),
    nodeKey: text("node_key").notNull(),
    name: text("name").notNull(),
    seq: numeric("seq", { precision: 10, scale: 2 }).notNull(),
    status: text("status").notNull(),
    origin: text("origin").notNull(),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneBy: uuid("done_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    sourceBlueprintVersion: integer("source_blueprint_version").notNull(),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("project_nodes_project_id_node_key_key").on(table.projectId, table.nodeKey),
    index("ix_nodes_project_seq").on(table.projectId, table.seq),
    check(
      "ck_project_nodes_status",
      sql`${table.status} in ${sql.raw(sqlValueList(["pending", "active", "done", "deleted"]))}`,
    ),
    check(
      "ck_project_nodes_origin",
      sql`${table.origin} in ${sql.raw(sqlValueList(["blueprint", "added_by_user"]))}`,
    ),
    check("ck_project_nodes_blueprint_version", sql`${table.sourceBlueprintVersion} > 0`),
  ],
);

/** node_requirements（节点约束：一期实现 required_doc 门禁，其余类型预留）。 */
export const nodeRequirements = pgTable(
  "node_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeId: uuid("node_id").notNull().references(() => projectNodes.id),
    requirementType: text("requirement_type").notNull(),
    docType: text("doc_type"),
    minCount: integer("min_count").notNull().default(1),
    config: jsonb("config").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_node_req_node").on(table.nodeId),
    check(
      "ck_node_requirements_type",
      sql`${table.requirementType} in ${sql.raw(sqlValueList(["required_doc", "field", "dependency", "deadline"]))}`,
    ),
    check(
      "ck_node_requirements_doc_type",
      sql`${table.requirementType} <> ${sql.raw(sqlValueList(["required_doc"]).slice(1, -1))} or ${table.docType} is not null`,
    ),
    check("ck_node_requirements_min_count", sql`${table.minCount} >= 1`),
  ],
);
