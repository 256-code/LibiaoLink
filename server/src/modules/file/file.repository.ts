import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, isNull, lt, ne, sql } from "drizzle-orm";
import type { DbClient, DbTransaction } from "../../db/db-client.js";
import { DatabaseService } from "../../db/database.service.js";
import { files, fileVersions, uploadSessions } from "../../db/schema/files.js";
import { projectNodes } from "../../db/schema/flow.js";
import { projects } from "../../db/schema/projects.js";
import { tasks } from "../../db/schema/tasks.js";

/**
 * file 模块数据访问（M4-01 上传管道）。
 *
 * 事务约定（对齐 task 模块）：写路径由服务层开事务并把 `tx` 传进来（审计 / Outbox 同事务）；
 * 会话与文件行在关键路径用 `for update` 串行化（防并发 complete / abort / 首次取分片 URL 竞态）。
 * 分片状态**不落表**（2026-09-18 评审定案）：以对象存储 ListParts 为唯一真相，本层只登记会话元数据。
 */

/** 项目摘要（发起上传的前置校验：存在 / 未软删 / 未归档）。 */
export interface FileProjectBriefRow {
  id: string;
  status: string;
  deletedAt: Date | null;
}

/** 节点摘要（nodeId 归属校验：必须属于该项目且未删除）。 */
export interface FileNodeBriefRow {
  id: string;
  projectId: string;
  deletedAt: Date | null;
}

/** 任务摘要（taskId 归属校验）。 */
export interface FileTaskBriefRow {
  id: string;
  projectId: string;
}

export type FileRow = typeof files.$inferSelect;
export type FileVersionRow = typeof fileVersions.$inferSelect;
export type UploadSessionRow = typeof uploadSessions.$inferSelect;

export interface FileInsertInput {
  projectId: string;
  nodeId: string | null;
  taskId: string | null;
  docType: string | null;
  name: string;
  /** 上传管道只创建 draft（定档 / 归档随 M4-02）。 */
  status: string;
  createdBy: string;
}

export interface FileVersionInsertInput {
  fileId: string;
  seq: number;
  /** 契约键（ADR-006：`…/v{seq}/{contentHash}.{ext}`，complete 时由暂存键复制而来）。 */
  objectKey: string;
  sizeBytes: number;
  contentHash: string;
  mime: string | null;
  uploadedBy: string;
  uploadedAt: Date;
}

export interface UploadSessionInsertInput {
  /** 服务层预生成：对象键（暂存键）需要 sessionId，不能等数据库默认值。 */
  id: string;
  fileId: string;
  intent: string;
  /** 暂存键 `…/staging/{sessionId}`（ADR-006 定案：complete 复制到契约键后清理）。 */
  objectKey: string;
  partSizeBytes: number;
  totalParts: number;
  sizeBytes: number;
  contentHash: string | null;
  mime: string | null;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface UploadSessionPatch {
  status?: string;
  storageUploadId?: string;
  updatedAt?: Date;
  completedAt?: Date;
  abortedAt?: Date;
}

/** 同内容哈希的既有文件提示（A4-04 秒传提示；不强阻断）。 */
export interface DuplicateFileRow {
  fileId: string;
  name: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: Date;
}

/** complete 后的文件增量（乐观锁 version 由服务层换算）。 */
export interface FileCompletePatch {
  currentVersionId: string;
  version: number;
  updatedAt: Date;
}

@Injectable()
export class FileRepository {
  constructor(private readonly database: DatabaseService) {}

  async findProjectBrief(projectId: string, client: DbClient = this.database.db): Promise<FileProjectBriefRow | null> {
    const rows = await client
      .select({ id: projects.id, status: projects.status, deletedAt: projects.deletedAt })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findNodeBrief(nodeId: string, client: DbClient = this.database.db): Promise<FileNodeBriefRow | null> {
    const rows = await client
      .select({ id: projectNodes.id, projectId: projectNodes.projectId, deletedAt: projectNodes.deletedAt })
      .from(projectNodes)
      .where(eq(projectNodes.id, nodeId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findTaskBrief(taskId: string, client: DbClient = this.database.db): Promise<FileTaskBriefRow | null> {
    const rows = await client
      .select({ id: tasks.id, projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    return rows[0] ?? null;
  }

  async insertFile(input: FileInsertInput, client: DbClient): Promise<FileRow> {
    const rows = await client
      .insert(files)
      .values({
        projectId: input.projectId,
        nodeId: input.nodeId,
        taskId: input.taskId,
        docType: input.docType,
        name: input.name,
        status: input.status,
        createdBy: input.createdBy,
        version: 0,
      })
      .returning();
    return rows[0]!;
  }

  async findFileById(fileId: string, client: DbClient = this.database.db): Promise<FileRow | null> {
    const rows = await client.select().from(files).where(eq(files.id, fileId)).limit(1);
    return rows[0] ?? null;
  }

  /** 行锁：complete / 后续定档路径用（同一文件的版本号分配串行化）。 */
  async lockFile(tx: DbTransaction, fileId: string): Promise<FileRow | null> {
    const rows = await tx.select().from(files).where(eq(files.id, fileId)).limit(1).for("update");
    return rows[0] ?? null;
  }

  async updateFileOnComplete(fileId: string, patch: FileCompletePatch, client: DbClient): Promise<FileRow> {
    const rows = await client
      .update(files)
      .set({ currentVersionId: patch.currentVersionId, version: patch.version, updatedAt: patch.updatedAt })
      .where(eq(files.id, fileId))
      .returning();
    return rows[0]!;
  }

  async insertVersion(input: FileVersionInsertInput, client: DbClient): Promise<FileVersionRow> {
    const rows = await client
      .insert(fileVersions)
      .values({
        fileId: input.fileId,
        seq: input.seq,
        objectKey: input.objectKey,
        sizeBytes: input.sizeBytes,
        contentHash: input.contentHash,
        mime: input.mime,
        uploadedBy: input.uploadedBy,
        uploadedAt: input.uploadedAt,
      })
      .returning();
    return rows[0]!;
  }

  /** 下一个版本号（同一文件内递增，从 1 开始）；锁下调用保证不重号。 */
  async nextVersionSeq(fileId: string, client: DbClient = this.database.db): Promise<number> {
    const rows = await client
      .select({ nextSeq: sql<number>`coalesce(max(${fileVersions.seq}), 0) + 1` })
      .from(fileVersions)
      .where(eq(fileVersions.fileId, fileId));
    return Number(rows[0]?.nextSeq ?? 1);
  }

  async listVersions(fileId: string, client: DbClient = this.database.db): Promise<FileVersionRow[]> {
    return client.select().from(fileVersions).where(eq(fileVersions.fileId, fileId)).orderBy(asc(fileVersions.seq));
  }

  async insertSession(input: UploadSessionInsertInput, client: DbClient): Promise<UploadSessionRow> {
    const rows = await client
      .insert(uploadSessions)
      .values({
        id: input.id,
        fileId: input.fileId,
        intent: input.intent,
        status: "active",
        objectKey: input.objectKey,
        partSizeBytes: input.partSizeBytes,
        totalParts: input.totalParts,
        sizeBytes: input.sizeBytes,
        contentHash: input.contentHash,
        mime: input.mime,
        createdBy: input.createdBy,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        expiresAt: input.expiresAt,
      })
      .returning();
    return rows[0]!;
  }

  async findSessionById(sessionId: string, client: DbClient = this.database.db): Promise<UploadSessionRow | null> {
    const rows = await client.select().from(uploadSessions).where(eq(uploadSessions.id, sessionId)).limit(1);
    return rows[0] ?? null;
  }

  /** 行锁：complete / abort / 首次取分片 URL 的串行化入口。 */
  async lockSession(tx: DbTransaction, sessionId: string): Promise<UploadSessionRow | null> {
    const rows = await tx.select().from(uploadSessions).where(eq(uploadSessions.id, sessionId)).limit(1).for("update");
    return rows[0] ?? null;
  }

  async updateSession(sessionId: string, patch: UploadSessionPatch, client: DbClient): Promise<UploadSessionRow> {
    const rows = await client.update(uploadSessions).set(patch).where(eq(uploadSessions.id, sessionId)).returning();
    return rows[0]!;
  }

  /** 秒传提示：同项目、同内容哈希的最近一条版本（排除回收站与本次新建的文件）。 */
  async findDuplicateByHash(
    projectId: string,
    contentHash: string,
    excludeFileId: string,
    client: DbClient = this.database.db,
  ): Promise<DuplicateFileRow | null> {
    const rows = await client
      .select({
        fileId: files.id,
        name: files.name,
        sizeBytes: fileVersions.sizeBytes,
        uploadedBy: fileVersions.uploadedBy,
        uploadedAt: fileVersions.uploadedAt,
      })
      .from(fileVersions)
      .innerJoin(files, eq(fileVersions.fileId, files.id))
      .where(
        and(
          eq(files.projectId, projectId),
          eq(fileVersions.contentHash, contentHash),
          ne(files.status, "recycled"),
          ne(files.id, excludeFileId),
        ),
      )
      .orderBy(desc(fileVersions.uploadedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 过期但状态仍为 active 的会话（worker 清理入口；带 projectId，按到期时间升序先进先出）。 */
  async listExpiredActiveSessions(
    now: Date,
    limit: number,
    client: DbClient = this.database.db,
  ): Promise<(UploadSessionRow & { projectId: string })[]> {
    const rows = await client
      .select({ session: uploadSessions, projectId: files.projectId })
      .from(uploadSessions)
      .innerJoin(files, eq(uploadSessions.fileId, files.id))
      .where(and(eq(uploadSessions.status, "active"), lt(uploadSessions.expiresAt, now)))
      .orderBy(asc(uploadSessions.expiresAt))
      .limit(limit);
    return rows.map((row) => ({ ...row.session, projectId: row.projectId }));
  }

  /** 未完成会话计数（回放 / 运维观测用）。 */
  async countActiveSessionsForFile(fileId: string, client: DbClient = this.database.db): Promise<number> {
    const rows = await client
      .select({ total: sql<number>`count(*)` })
      .from(uploadSessions)
      .where(and(eq(uploadSessions.fileId, fileId), eq(uploadSessions.status, "active"), isNull(uploadSessions.completedAt)));
    return Number(rows[0]?.total ?? 0);
  }
}
