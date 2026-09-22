import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  integer,
  jsonb,
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
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalizedBy: uuid("finalized_by"),
    recycledAt: timestamp("recycled_at", { withTimezone: true }),
    recycledBy: uuid("recycled_by"),
    recycledFromStatus: text("recycled_from_status"),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
  },
  (table) => [
    index("ix_files_node").on(table.nodeId, table.status),
    index("ix_files_project").on(table.projectId, table.status),
    index("ix_files_purge").on(table.purgeAfter),
    check(
      "ck_files_status",
      sql`${table.status} in ${sql.raw(sqlValueList(["draft", "final", "changed", "archived", "recycled"]))}`,
    ),
    check("ck_files_finalized_pair", sql`(${table.finalizedAt} is null) = (${table.finalizedBy} is null)`),
    check(
      "ck_files_recycled_pair",
      sql`(${table.recycledAt} is null) = (${table.recycledBy} is null) and (${table.recycledAt} is null) = (${table.recycledFromStatus} is null)`,
    ),
    check(
      "ck_files_recycled_from_status",
      sql`${table.recycledFromStatus} is null or ${table.recycledFromStatus} in ${sql.raw(sqlValueList(["draft", "final", "changed", "archived"]))}`,
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
    // 变更读面反查（migration 0021）：change_request_id → 版本（部分索引，非变更流版本不入索引）。
    index("ix_file_versions_change_request")
      .on(table.changeRequestId)
      .where(sql`change_request_id is not null`),
    check("ck_file_versions_seq", sql`${table.seq} > 0`),
    check("ck_file_versions_size", sql`${table.sizeBytes} >= 0`),
  ],
);

/** upload_sessions（分片直传会话；分片状态以对象存储 ListParts 为准，不落表）。 */
export const uploadSessions = pgTable(
  "upload_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    intent: text("intent").notNull(),
    status: text("status").notNull().default("active"),
    objectKey: text("object_key").notNull(),
    storageUploadId: text("storage_upload_id"),
    partSizeBytes: integer("part_size_bytes").notNull(),
    totalParts: integer("total_parts").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    contentHash: text("content_hash"),
    mime: text("mime"),
    changePayload: jsonb("change_payload").$type<Record<string, unknown>>(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    abortedAt: timestamp("aborted_at", { withTimezone: true }),
  },
  (table) => [
    index("ix_upload_sessions_file").on(table.fileId, table.status),
    index("ix_upload_sessions_expiry").on(table.status, table.expiresAt),
    check(
      "ck_upload_sessions_intent",
      sql`${table.intent} in ${sql.raw(sqlValueList(["version", "change"]))}`,
    ),
    check(
      "ck_upload_sessions_status",
      sql`${table.status} in ${sql.raw(sqlValueList(["active", "completed", "aborted", "expired"]))}`,
    ),
    check("ck_upload_sessions_part_size", sql`${table.partSizeBytes} > 0`),
    check("ck_upload_sessions_total_parts", sql`${table.totalParts} between 1 and 10000`),
    check("ck_upload_sessions_size", sql`${table.sizeBytes} >= 0`),
    check("ck_upload_sessions_expires", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "ck_upload_sessions_change_payload",
      sql`(${table.intent} = 'change') = (${table.changePayload} is not null)`,
    ),
  ],
);

/** file_links（多态关联：project / task / node / report / issue / change；M4-03）。 */
export const fileLinks = pgTable(
  "file_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_file_links_file_object").on(table.fileId, table.objectType, table.objectId),
    index("ix_file_links_object").on(table.objectType, table.objectId),
    check(
      "ck_file_links_object_type",
      sql`${table.objectType} in ${sql.raw(sqlValueList(["project", "task", "node", "report", "issue", "change"]))}`,
    ),
  ],
);
