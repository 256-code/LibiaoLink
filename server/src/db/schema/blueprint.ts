import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/** blueprints（0011 · h3）：按项目类型各一份蓝图（project_type 唯一；default = 兜底模板，ADR-019）。 */
export const blueprints = pgTable(
  "blueprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectType: text("project_type").notNull(),
    name: text("name").notNull(),
    /** 当前草稿（完整蓝图 JSON，契约 BlueprintSchema）；发布前的编辑都落在这里。 */
    draftPayload: jsonb("draft_payload").$type<Record<string, unknown>>().notNull(),
    draftUpdatedAt: timestamp("draft_updated_at", { withTimezone: true }).notNull().defaultNow(),
    draftUpdatedBy: uuid("draft_updated_by"),
    /** 已发布版本号（0 = 尚未发布）；发布即递增并落 blueprint_versions 不可变行。 */
    publishedVersion: integer("published_version").notNull().default(0),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("blueprints_project_type_key").on(table.projectType),
    check("ck_blueprints_published_version", sql`${table.publishedVersion} >= 0`),
    check("ck_blueprints_version", sql`${table.version} >= 0`),
  ],
);

/** blueprint_versions（0011 · h3）：发布产生不可变版本行；已生成项目为导入快照，不受后续变更影响。 */
export const blueprintVersions = pgTable(
  "blueprint_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blueprintId: uuid("blueprint_id")
      .notNull()
      .references(() => blueprints.id),
    blueprintVersion: integer("blueprint_version").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** 发布时校验结果（全量 issues；通过则为空数组）。 */
    issues: jsonb("issues").$type<unknown[]>().notNull().default([]),
    publishedBy: uuid("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("blueprint_versions_blueprint_id_blueprint_version_key").on(table.blueprintId, table.blueprintVersion),
    index("ix_blueprint_versions_bp").on(table.blueprintId, table.blueprintVersion),
    check("ck_blueprint_versions_version", sql`${table.blueprintVersion} > 0`),
  ],
);
