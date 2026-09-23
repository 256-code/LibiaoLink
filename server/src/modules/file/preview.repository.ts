import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { DbClient } from "../../db/db-client.js";
import { DatabaseService } from "../../db/database.service.js";
import { previewArtifacts } from "../../db/schema/preview.js";
import type { PreviewTarget } from "./preview.job.js";

/**
 * preview_artifacts 数据访问（M4-05c · ADR-007：三元组缓存键 = content_hash + pipeline_version + target）。
 *
 * 读面按三元组命中（不按版本命中）：内容相同（跨文件 / 回溯 / 变更）就复用同一行；
 * `file_id` / `version_id` = **首次生成**该产物的版本，登记后不因后来者改写（引用判定以首登为准）。
 * 状态机 not_ready → ready / failed（值集与契约 PREVIEW_STATUSES 同值，README「五」数据层口径）。
 */

export type PreviewArtifactRow = typeof previewArtifacts.$inferSelect;

/**
 * 三元组缓存键（三个字段一起唯一：uq_preview_artifacts_cache_key）。
 *
 * `target` 用契约通道联合类型（不是裸 string）：键的持有者直接拿去拼任务载荷 / 写响应，
 * 在这里就挡住「写进一个不存在的通道」—— 库侧 CHECK ck_preview_artifacts_target 只是最后一道。
 */
export interface PreviewArtifactKey {
  contentHash: string;
  pipelineVersion: string;
  target: PreviewTarget;
}

@Injectable()
export class PreviewRepository {
  constructor(private readonly database: DatabaseService) {}

  async findByKey(key: PreviewArtifactKey, client: DbClient = this.database.db): Promise<PreviewArtifactRow | null> {
    const rows = await client.select().from(previewArtifacts).where(this.keyWhere(key)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * 首次请求登记（not_ready）：同三元组已存在（含并发插入）**不覆盖**，原样返回既有行 ——
   * 调用方据此判断「已有 ready 就复用 / 已有 failed 就按缓存态处理，不做原地重试」。
   */
  async ensureRequested(
    input: { fileId: string; versionId: string } & PreviewArtifactKey,
    client: DbClient = this.database.db,
  ): Promise<PreviewArtifactRow> {
    const inserted = await client
      .insert(previewArtifacts)
      .values({
        fileId: input.fileId,
        versionId: input.versionId,
        contentHash: input.contentHash,
        pipelineVersion: input.pipelineVersion,
        target: input.target,
        status: "not_ready",
      })
      .onConflictDoNothing({
        target: [previewArtifacts.contentHash, previewArtifacts.pipelineVersion, previewArtifacts.target],
      })
      .returning();
    if (inserted[0] !== undefined) {
      return inserted[0];
    }
    const existing = await this.findByKey(input, client);
    if (existing === null) {
      throw new Error("预览产物登记失败：三元组写入后读不到行（并发删除？）");
    }
    return existing;
  }

  /** 产物就绪：object_key / generated_at 成对写入（ck_preview_artifacts_ready_pair），并清掉旧失败原因。 */
  async markReady(
    key: PreviewArtifactKey,
    input: { objectKey: string; generatedAt: Date },
    client: DbClient = this.database.db,
  ): Promise<void> {
    await client
      .update(previewArtifacts)
      .set({
        status: "ready",
        objectKey: input.objectKey,
        generatedAt: input.generatedAt,
        error: null,
        updatedAt: input.generatedAt,
      })
      .where(this.keyWhere(key));
  }

  /**
   * 产物失败：error 与 failed 成对（ck_preview_artifacts_failed_pair），object_key / generated_at 必须清空
   * （ready 成对约束是双向的）。error 由调用方截到 ≤ 500（CHECK ck_preview_artifacts_error_length）。
   */
  async markFailed(
    key: PreviewArtifactKey,
    input: { error: string; updatedAt: Date },
    client: DbClient = this.database.db,
  ): Promise<void> {
    await client
      .update(previewArtifacts)
      .set({
        status: "failed",
        error: input.error,
        objectKey: null,
        generatedAt: null,
        updatedAt: input.updatedAt,
      })
      .where(this.keyWhere(key));
  }

  private keyWhere(key: PreviewArtifactKey) {
    return and(
      eq(previewArtifacts.contentHash, key.contentHash),
      eq(previewArtifacts.pipelineVersion, key.pipelineVersion),
      eq(previewArtifacts.target, key.target),
    );
  }
}