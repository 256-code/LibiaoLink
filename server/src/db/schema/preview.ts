import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { fileVersions, files } from "./files.js";
import { PREVIEW_STATUS_KEYS, PREVIEW_TARGET_KEYS, sqlValueList } from "./literals.js";

/**
 * preview_artifacts（M4-05 预览管道 · 数据层 · migration 0027）。
 * 三元组缓存键 = content_hash + pipeline_version + target（ADR-007 / v0.2 §5.4，D2-06 同一内容只转换一次）；
 * file_id / version_id = 首次生成该产物的版本（登记 + 引用判定），读面按三元组命中、不按版本命中。
 * 状态值集与契约 PREVIEW_STATUSES 同值（not_ready = 已请求未就绪，生成任务由 outbox 重试兜底）。
 */
export const previewArtifacts = pgTable(
  "preview_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => fileVersions.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    target: text("target").notNull(),
    pipelineVersion: text("pipeline_version").notNull(),
    status: text("status").notNull().default("not_ready"),
    objectKey: text("object_key"),
    error: text("error"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_preview_artifacts_cache_key").on(table.contentHash, table.pipelineVersion, table.target),
    index("ix_preview_artifacts_version").on(table.versionId, table.target),
    index("ix_preview_artifacts_file").on(table.fileId),
    check("ck_preview_artifacts_target", sql`${table.target} in ${sql.raw(sqlValueList(PREVIEW_TARGET_KEYS))}`),
    check("ck_preview_artifacts_status", sql`${table.status} in ${sql.raw(sqlValueList(PREVIEW_STATUS_KEYS))}`),
    check(
      "ck_preview_artifacts_ready_pair",
      sql`(${table.status} = 'ready') = (${table.objectKey} is not null and ${table.generatedAt} is not null)`,
    ),
    check("ck_preview_artifacts_failed_pair", sql`(${table.status} = 'failed') = (${table.error} is not null)`),
    check(
      "ck_preview_artifacts_error_length",
      sql`${table.error} is null or char_length(${table.error}) <= 500`,
    ),
  ],
);
