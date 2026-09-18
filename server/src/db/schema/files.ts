import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { changeRequests } from "./change.js";
import { projectNodes } from "./flow.js";
import { STAGE_KEYS, sqlValueList } from "./literals.js";
import { projects } from "./projects.js";
import { tasks } from "./tasks.js";

/** files（五态：draft | final | changed | archived | recycled）。 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    nodeId: uuid("node_id").references(() => projectNodes.id),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    docType: text("doc_type"),
    name: text("name").notNull(),
    status: text("status").notNull(),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => fileVersions.id),
    version: integer("version").notNull().default(0),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_files_node").on(table.nodeId, table.status),
    index("ix_files_project").on(table.projectId, table.status),
    check(
      "ck_files_status",
      sql`${table.status} in ${sql.raw(sqlValueList(["draft", "final", "changed", "archived", "recycled"]))}`,
    ),
  ],
);

/** file_versions（内容哈希去重；定档后不覆盖）。 */
export const fileVersions = pgTable(
  "file_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id").notNull().references(() => files.id),
    seq: integer("seq").notNull(),
    objectKey: text("object_key").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    contentHash: text("content_hash").notNull(),
    mime: text("mime"),
    uploadedBy: uuid("uploaded_by").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    changeRequestId: uuid("change_request_id").references(
      (): AnyPgColumn => changeRequests.id,
    ),
  },
  (table) => [
    unique("file_versions_file_id_seq_key").on(table.fileId, table.seq),
    check("ck_file_versions_seq", sql`${table.seq} > 0`),
    check("ck_file_versions_size", sql`${table.sizeBytes} >= 0`),
  ],
);
