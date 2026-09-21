import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import {
  FileSchema,
  FileVersionSchema,
  UploadAbortResponseSchema,
  UploadCompleteBodySchema,
  UploadCompleteResponseSchema,
  UploadCreateBodySchema,
  UploadCreateResponseSchema,
  UploadPartsBodySchema,
  UploadPartsResponseSchema,
  UploadSessionSchema,
  UploadSessionViewSchema,
  z,
} from "@libiaolink/contracts";
import { ClockService } from "../../common/clock/clock.service.js";
import { AppError } from "../../common/errors/app-error.js";
import { AppConfig } from "../../config/config.module.js";
import { DatabaseService } from "../../db/database.service.js";
import { appendOutbox } from "../../db/outbox.js";
import {
  buildObjectKey,
  buildUploadStagingKey,
  missingPartNumbers,
  ObjectStorage,
  planUpload,
  toApiError,
} from "../../storage/index.js";
import { AuditService } from "../admin/index.js";
import { PermissionService } from "../permission/index.js";
import { FileRepository, type FileRow, type FileVersionRow, type UploadSessionRow } from "./file.repository.js";

type UploadCreateBody = z.infer<typeof UploadCreateBodySchema>;
type UploadPartsBody = z.infer<typeof UploadPartsBodySchema>;
type UploadCompleteBody = z.infer<typeof UploadCompleteBodySchema>;
type UploadCreateResponse = z.infer<typeof UploadCreateResponseSchema>;
type UploadPartsResponse = z.infer<typeof UploadPartsResponseSchema>;
type UploadSessionView = z.infer<typeof UploadSessionViewSchema>;
type UploadCompleteResponse = z.infer<typeof UploadCompleteResponseSchema>;
type UploadAbortResponse = z.infer<typeof UploadAbortResponseSchema>;

const HOUR_MS = 3_600_000;
/** 过期会话清理单批上限（worker 每轮；避免长事务与大对象清理拖住心跳）。 */
export const EXPIRE_SWEEP_BATCH = 200;

/**
 * 文件上传管道（M4-01 · S7·file）：发起上传 → 分片预签名 → 会话状态 → 完成 → 取消。
 *
 * 口径（ADR-006 定案 2026-09-21，PR-4 实施）：
 * - 会话先写**暂存键** `…/staging/{sessionId}`，complete 校验后由服务端复制（CopyObject）到
 *   **契约键** `…/v{seq}/{contentHash}.{ext}`，再按版本清理暂存对象；落库 `file_versions.object_key` 始终是契约键；
 * - `contentHash` 在 init 可选（命中即回秒传提示）、complete 必填；与 init 声明不一致 → 422 `FILE_HASH_MISMATCH`（不省）；
 * - 分片状态以对象存储 ListParts 为唯一真相（不落 `upload_parts` 表）；大小以合并后 HEAD 为准（不信客户端声明）；
 * - 会话过期：访问时惰性判定（410，契约 `UPLOAD_SESSION_EXPIRED`）+ worker 定时清理（中止分片 + 清暂存 + 置 expired）；
 * - 文件上传**不触发** `projects.updated_at`（ADR-022 明示「不触发」：文件与变更各有自身时间字段）。
 *
 * 权限：创建 / 分片 / 完成 / 取消 = `file.upload`（项目成员平权）｜读取会话状态 = 项目可见即可。
 * 本切片只开放「新建文件」上传（`intent=version` 且不带 `fileId`）；`intent=change`（M4-04）与带 `fileId` 的
 * 对既有 draft 文件替换 / 追加版本（M4-02）见 `createUpload` 内的显式守卫。
 */
@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly repository: FileRepository,
    private readonly storage: ObjectStorage,
    private readonly permission: PermissionService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly clock: ClockService,
  ) {}

  /** POST /files/uploads：发起分片上传（建 draft 文件 + 会话；contentHash 命中给秒传提示）。 */
  async createUpload(body: UploadCreateBody, actorId: string): Promise<UploadCreateResponse> {
    const access = await this.permission.assertProjectVisible(actorId, body.projectId);
    await this.permission.assertCan(actorId, "file.upload", {
      member: access.member,
      projectManager: access.projectManager,
    });
    // 契约（Push 130 · wmj 定案）：version 分支 `fileId` 可选（给出 = 对既有 draft 文件替换 / 追加版本）、
    // change 分支必填。本切片（M4-01）尚未实现这两条路径 —— zod 放行后不再拦截，不守卫会静默把
    // 「追加版本」当成新建文件，故对「带 fileId」与 `intent=change` 一律显式 400。
    if (body.intent === "change" || body.fileId !== undefined) {
      const isChange = body.intent === "change";
      throw new AppError(
        "VALIDATION_FAILED",
        isChange
          ? "intent=change（定档后变更上传）随 M4-04 变更申请落地；本切片（M4-01）只开放「新建文件」上传"
          : "带 fileId 的上传（对既有 draft 文件替换 / 追加版本）随 M4-02 版本链 / 定档落地；本切片（M4-01）只开放「新建文件」上传",
        [
          {
            code: isChange ? "intent_change_not_open" : "file_id_not_supported",
            message: "M4-01 只开放「新建文件」上传（intent=version 且不带 fileId）",
            path: isChange ? "intent" : "fileId",
          },
        ],
      );
    }
    const project = await this.repository.findProjectBrief(body.projectId);
    if (project === null) {
      throw new AppError("NOT_FOUND", "项目不存在或不可见");
    }
    if (project.status === "archived") {
      throw new AppError("PROJECT_ARCHIVED", "项目已归档，禁止新增文件");
    }
    const maxBytes = this.config.env.UPLOAD_MAX_SIZE_MB * 1024 * 1024;
    if (body.sizeBytes > maxBytes) {
      throw new AppError("VALIDATION_FAILED", "文件大小超过上限（" + this.config.env.UPLOAD_MAX_SIZE_MB + " MB）", [
        { code: "too_large", message: "sizeBytes 不得超过 " + maxBytes, path: "sizeBytes", meta: { limitBytes: maxBytes } },
      ]);
    }
    await this.assertLinksInProject(body.projectId, body.nodeId, body.taskId);

    const at = this.clock.now();
    const expiresAt = new Date(at.getTime() + this.config.env.UPLOAD_SESSION_TTL_HOURS * HOUR_MS);
    const plan = planUpload(body.sizeBytes);
    const sessionId = randomUUID();

    const created = await this.database.db.transaction(async (tx) => {
      const file = await this.repository.insertFile(
        {
          projectId: body.projectId,
          nodeId: body.nodeId ?? null,
          taskId: body.taskId ?? null,
          docType: body.docType ?? null,
          name: body.name,
          status: "draft",
          createdBy: actorId,
        },
        tx,
      );
      const session = await this.repository.insertSession(
        {
          id: sessionId,
          fileId: file.id,
          intent: body.intent,
          objectKey: buildUploadStagingKey({ projectId: body.projectId, fileId: file.id, sessionId }),
          partSizeBytes: plan.partSizeBytes,
          totalParts: plan.totalParts,
          sizeBytes: body.sizeBytes,
          contentHash: body.contentHash?.toLowerCase() ?? null,
          mime: body.mime ?? null,
          createdBy: actorId,
          createdAt: at,
          expiresAt,
        },
        tx,
      );
      await this.audit.record(tx, {
        actorId,
        action: "create",
        objectType: "file",
        objectId: file.id,
        projectId: body.projectId,
        summary: "发起上传：" + body.name,
        changes: [
          { field: "name", from: null, to: body.name },
          { field: "status", from: null, to: file.status },
        ],
        metadata: {
          uploadId: session.id,
          intent: session.intent,
          sizeBytes: body.sizeBytes,
          partSizeBytes: plan.partSizeBytes,
          totalParts: plan.totalParts,
          expiresAt: expiresAt.toISOString(),
        },
      });
      return { file, session };
    });

    const duplicateHint =
      body.contentHash === undefined
        ? null
        : await this.repository.findDuplicateByHash(body.projectId, body.contentHash.toLowerCase(), created.file.id);

    return {
      file: toFileView(created.file),
      upload: toSessionView(created.session),
      duplicateHint:
        duplicateHint === null
          ? null
          : {
              fileId: duplicateHint.fileId,
              name: duplicateHint.name,
              sizeBytes: Number(duplicateHint.sizeBytes),
              uploadedBy: duplicateHint.uploadedBy,
              uploadedAt: duplicateHint.uploadedAt.toISOString(),
            },
    };
  }

  /** POST /files/{id}/uploads/{uploadId}/parts：批量取分片预签名 URL（首传 / 断点续传共用）。 */
  async signParts(fileId: string, uploadId: string, body: UploadPartsBody, actorId: string): Promise<UploadPartsResponse> {
    const { file, session } = await this.loadUploadContext(fileId, uploadId, actorId, "file.upload");
    const at = this.clock.now();
    if (session.status !== "active") {
      throw new AppError("UPLOAD_SESSION_EXPIRED", "上传会话已结束（" + session.status + "），请重新发起上传");
    }
    if (session.expiresAt.getTime() <= at.getTime()) {
      await this.expireSession(file.projectId, session, at);
      throw new AppError("UPLOAD_SESSION_EXPIRED", "上传会话已过期，请重新发起上传");
    }
    const outOfRange = body.partNumbers.filter((partNumber) => partNumber > session.totalParts);
    if (outOfRange.length > 0) {
      throw new AppError("VALIDATION_FAILED", "分片编号超出会话范围（1~" + session.totalParts + "）", [
        { code: "out_of_range", message: "越界分片：" + outOfRange.join(","), path: "partNumbers" },
      ]);
    }

    const storageUploadId = await this.ensureMultipartUpload(file, session);
    const parts: UploadPartsResponse["parts"] = [];
    for (const partNumber of body.partNumbers) {
      const signed = await this.signPart(file, session, storageUploadId, partNumber);
      parts.push({ partNumber, url: signed.url, expiresAt: signed.expiresAt.toISOString() });
    }
    return {
      uploadId: session.id,
      partSizeBytes: session.partSizeBytes,
      parts,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  /** GET /files/{id}/uploads/{uploadId}：会话状态（已传 / 缺失分片，断点续传依据）。 */
  async getUpload(fileId: string, uploadId: string, actorId: string): Promise<UploadSessionView> {
    const { file, session } = await this.loadUploadContext(fileId, uploadId, actorId, null);
    const at = this.clock.now();
    if (session.status === "active" && session.expiresAt.getTime() <= at.getTime()) {
      await this.expireSession(file.projectId, session, at);
      throw new AppError("FILE_STATE_INVALID", "上传会话已过期，请重新发起上传");
    }
    if (session.status !== "active") {
      throw new AppError("FILE_STATE_INVALID", "上传会话已结束（" + session.status + "），不可续传；请重新发起上传");
    }
    const uploaded =
      session.storageUploadId === null
        ? []
        : (await this.storage.listParts({ objectKey: session.objectKey, uploadId: session.storageUploadId })).map(
            (part) => part.partNumber,
          );
    const missing = missingPartNumbers(uploaded, session.totalParts);
    return { ...toSessionView(session), uploadedPartNumbers: uploaded, missingPartNumbers: missing };
  }

  /** POST /files/{id}/uploads/{uploadId}/complete：校验分片 → 合并 → 复制到契约键 → 登记版本。 */
  async completeUpload(fileId: string, uploadId: string, body: UploadCompleteBody, actorId: string): Promise<UploadCompleteResponse> {
    const { file, session } = await this.loadUploadContext(fileId, uploadId, actorId, "file.upload");
    const at = this.clock.now();
    if (session.status !== "active") {
      throw new AppError("UPLOAD_SESSION_EXPIRED", "上传会话已结束（" + session.status + "），请重新发起上传");
    }
    if (session.expiresAt.getTime() <= at.getTime()) {
      await this.expireSession(file.projectId, session, at);
      throw new AppError("UPLOAD_SESSION_EXPIRED", "上传会话已过期，请重新发起上传");
    }
    if (session.storageUploadId === null) {
      throw new AppError("UPLOAD_INCOMPLETE", "尚未上传任何分片，请补传后再完成", [
        { code: "missing_parts", message: "缺失全部分片（1~" + session.totalParts + "）", path: "parts", meta: { missing: rangeParts(session.totalParts) } },
      ]);
    }

    const stagingKey = session.objectKey;
    let uploaded;
    try {
      uploaded = await this.storage.listParts({ objectKey: stagingKey, uploadId: session.storageUploadId });
    } catch (error) {
      throw toApiError(error);
    }
    const missing = missingPartNumbers(
      uploaded.map((part) => part.partNumber),
      session.totalParts,
    );
    if (missing.length > 0) {
      throw new AppError("UPLOAD_INCOMPLETE", "分片未齐（缺失 " + missing.length + " 片），请补传后再完成", [
        { code: "missing_parts", message: "缺失分片：" + summarize(missing), path: "parts", meta: { missing } },
      ]);
    }

    let mergedEtag: string | null = null;
    try {
      const merged = await this.storage.completeMultipartUpload({
        objectKey: stagingKey,
        uploadId: session.storageUploadId,
        parts: uploaded.map((part) => ({ partNumber: part.partNumber, etag: part.etag })),
      });
      mergedEtag = merged.etag;
    } catch (error) {
      throw toApiError(error);
    }
    const head = await this.storage.headObject(stagingKey);
    if (head === null) {
      throw new AppError("UPLOAD_INCOMPLETE", "分片合并结果在对象存储侧不存在，请重新上传");
    }
    if (head.sizeBytes !== session.sizeBytes) {
      throw new AppError("UPLOAD_INCOMPLETE", "合并后大小与声明不一致（声明 " + session.sizeBytes + " / 实际 " + head.sizeBytes + "），请重新上传", [
        { code: "size_mismatch", message: "sizeBytes 不一致", path: "sizeBytes", meta: { declared: session.sizeBytes, actual: head.sizeBytes } },
      ]);
    }
    const contentHash = body.contentHash.toLowerCase();
    if (session.contentHash !== null && session.contentHash.toLowerCase() !== contentHash) {
      throw new AppError("FILE_HASH_MISMATCH", "内容哈希与发起上传时的声明不一致", [
        { code: "hash_mismatch", message: "contentHash 不一致", path: "contentHash", meta: { declared: session.contentHash, actual: contentHash } },
      ]);
    }

    // 契约键（ADR-006：v{seq}/{contentHash}.{ext}）：先复制再落库 —— 若数据库事务失败，重试会覆盖同一个键，
    // 不留「落库版本指向不存在对象」的悬挂引用；seq 在事务内锁行复核，防并发完成抢同一位次。
    const seq = await this.repository.nextVersionSeq(fileId);
    const objectKey = buildObjectKey({ projectId: file.projectId, fileId, seq, contentHash, fileName: file.name });
    try {
      await this.storage.copyObject({
        sourceKey: stagingKey,
        destinationKey: objectKey,
        contentType: session.mime,
        metadata: { "file-name": encodeURIComponent(file.name) },
      });
    } catch (error) {
      throw toApiError(error);
    }

    const committed = await this.database.db.transaction(async (tx) => {
      const lockedSession = await this.repository.lockSession(tx, session.id);
      if (lockedSession === null || lockedSession.status !== "active") {
        throw new AppError("UPLOAD_SESSION_EXPIRED", "上传会话已结束，请重新发起上传");
      }
      const lockedFile = await this.repository.lockFile(tx, fileId);
      if (lockedFile === null) {
        throw new AppError("NOT_FOUND", "文件不存在");
      }
      const currentSeq = await this.repository.nextVersionSeq(fileId, tx);
      if (currentSeq !== seq) {
        throw new AppError("INTERNAL", "文件版本位次被并发上传占用，请重试完成上传");
      }
      const version = await this.repository.insertVersion(
        {
          fileId,
          seq,
          objectKey,
          sizeBytes: head.sizeBytes,
          contentHash,
          mime: session.mime,
          uploadedBy: actorId,
          uploadedAt: at,
        },
        tx,
      );
      const updatedFile = await this.repository.updateFileOnComplete(
        fileId,
        { currentVersionId: version.id, version: lockedFile.version + 1, updatedAt: at },
        tx,
      );
      const completedSession = await this.repository.updateSession(
        session.id,
        { status: "completed", completedAt: at, updatedAt: at },
        tx,
      );
      await this.audit.record(tx, {
        actorId,
        action: "complete",
        objectType: "file",
        objectId: fileId,
        projectId: file.projectId,
        summary: "完成上传：" + lockedFile.name + " v" + version.seq,
        changes: [
          { field: "currentVersionId", from: lockedFile.currentVersionId, to: version.id },
          { field: "version", from: String(lockedFile.version), to: String(updatedFile.version) },
        ],
        metadata: {
          uploadId: session.id,
          versionSeq: version.seq,
          objectKey,
          contentHash,
          sizeBytes: head.sizeBytes,
          etag: mergedEtag,
          duplicateOf: null,
        },
      });
      await appendOutbox(tx, {
        topic: "file.version.created",
        dedupeKey: "file.version.created:" + version.id,
        payload: {
          projectId: file.projectId,
          fileId,
          versionId: version.id,
          seq: version.seq,
          objectKey,
          contentHash,
          sizeBytes: head.sizeBytes,
          mime: session.mime,
          actorId,
          at: at.toISOString(),
        },
      });
      return { file: updatedFile, version, session: completedSession };
    });

    // 暂存对象已复制到契约键：按版本清理（失败只告警 —— 残留由过期清理兜底，不影响已落库版本）。
    try {
      await this.storage.purgeObject(stagingKey);
    } catch (error) {
      this.logger.warn("暂存对象清理失败（complete 已成功）：" + stagingKey + " / " + String(error));
    }

    return {
      file: toFileView(committed.file),
      version: toVersionView(committed.version),
      changeRequest: null,
    };
  }

  /** POST /files/{id}/uploads/{uploadId}/abort：取消上传（幂等；已完成会话拒绝）。 */
  async abortUpload(fileId: string, uploadId: string, actorId: string): Promise<UploadAbortResponse> {
    const { file, session } = await this.loadUploadContext(fileId, uploadId, actorId, "file.upload");
    const at = this.clock.now();
    if (session.status === "completed") {
      throw new AppError("FILE_STATE_INVALID", "上传已完成，不能取消；如需回退请走版本回溯（M4-02）");
    }
    if (session.status === "aborted" || session.status === "expired") {
      return { upload: toSessionView(session) };
    }
    await this.discardStaging(session, "abort");
    const updated = await this.database.db.transaction(async (tx) => {
      const locked = await this.repository.lockSession(tx, session.id);
      if (locked === null || locked.status !== "active") {
        throw new AppError("FILE_STATE_INVALID", "上传会话状态已变化，请刷新后重试");
      }
      const row = await this.repository.updateSession(session.id, { status: "aborted", abortedAt: at, updatedAt: at }, tx);
      await this.audit.record(tx, {
        actorId,
        action: "delete",
        objectType: "file",
        objectId: fileId,
        projectId: file.projectId,
        summary: "取消上传：" + file.name,
        metadata: { uploadId: session.id },
      });
      return row;
    });
    return { upload: toSessionView(updated) };
  }

  /**
   * 过期会话清理（M4-01 · worker 定时调用）：中止未完成分片 + 按版本清暂存对象 + 置 `expired`。
   * 数据从未定版（没有 file_versions 行），清理只记日志与一条 system 审计；失败不阻断后续会话。
   */
  async sweepExpiredSessions(limit: number = EXPIRE_SWEEP_BATCH): Promise<{ scanned: number; expired: number }> {
    const at = this.clock.now();
    const rows = await this.repository.listExpiredActiveSessions(at, limit);
    let expired = 0;
    for (const row of rows) {
      try {
        await this.expireSession(row.projectId, row, at);
        expired += 1;
      } catch (error) {
        this.logger.warn("过期会话清理失败：" + row.id + " / " + String(error));
      }
    }
    return { scanned: rows.length, expired };
  }

  // ---------- 内部 ----------

  /** 文件 + 会话的公共装载（可见性 → 404；会话不属于该文件 → 404；写路径再判 `file.upload`）。 */
  private async loadUploadContext(
    fileId: string,
    uploadId: string,
    actorId: string,
    permission: "file.upload" | null,
  ): Promise<{ file: FileRow; session: UploadSessionRow }> {
    const file = await this.repository.findFileById(fileId);
    if (file === null) {
      throw new AppError("NOT_FOUND", "文件不存在");
    }
    const access = await this.permission.assertProjectVisible(actorId, file.projectId);
    if (permission !== null) {
      await this.permission.assertCan(actorId, permission, { member: access.member, projectManager: access.projectManager });
    }
    const session = await this.repository.findSessionById(uploadId);
    if (session === null || session.fileId !== fileId) {
      throw new AppError("NOT_FOUND", "上传会话不存在或不属于该文件");
    }
    return { file, session };
  }

  /** 首次取分片 URL 时登记存储侧 multipart UploadId（行锁防并发双建）。 */
  private async ensureMultipartUpload(file: FileRow, session: UploadSessionRow): Promise<string> {
    if (session.storageUploadId !== null) {
      return session.storageUploadId;
    }
    const created = await this.storage.createMultipartUpload({
      objectKey: session.objectKey,
      contentType: session.mime,
      metadata: { "file-name": encodeURIComponent(file.name) },
    });
    const updated = await this.database.db.transaction(async (tx) => {
      const locked = await this.repository.lockSession(tx, session.id);
      if (locked === null || locked.status !== "active") {
        throw new AppError("UPLOAD_SESSION_EXPIRED", "上传会话已结束，请重新发起上传");
      }
      if (locked.storageUploadId !== null) {
        return locked;
      }
      return this.repository.updateSession(session.id, { storageUploadId: created.uploadId, updatedAt: this.clock.now() }, tx);
    });
    return updated.storageUploadId ?? created.uploadId;
  }

  private async signPart(file: FileRow, session: UploadSessionRow, storageUploadId: string, partNumber: number) {
    try {
      return await this.storage.signPartUploadUrl({ objectKey: session.objectKey, uploadId: storageUploadId, partNumber });
    } catch (error) {
      throw toApiError(error);
    }
  }

  /** nodeId / taskId 归属校验：不属于该项目一律 400（防跨项目挂接）。 */
  private async assertLinksInProject(projectId: string, nodeId?: string, taskId?: string): Promise<void> {
    if (nodeId !== undefined) {
      const node = await this.repository.findNodeBrief(nodeId);
      if (node === null || node.projectId !== projectId || node.deletedAt !== null) {
        throw new AppError("VALIDATION_FAILED", "nodeId 不属于该项目或节点已删除", [
          { code: "invalid_node", message: "节点不可用", path: "nodeId" },
        ]);
      }
    }
    if (taskId !== undefined) {
      const task = await this.repository.findTaskBrief(taskId);
      if (task === null || task.projectId !== projectId) {
        throw new AppError("VALIDATION_FAILED", "taskId 不属于该项目", [
          { code: "invalid_task", message: "任务不可用", path: "taskId" },
        ]);
      }
    }
  }

  /** 惰性 / 定时过期的公共实现（先清存储、后置状态；重复调用安全）。 */
  private async expireSession(projectId: string, session: UploadSessionRow, at: Date): Promise<void> {
    await this.discardStaging(session, "expire");
    await this.database.db.transaction(async (tx) => {
      const locked = await this.repository.lockSession(tx, session.id);
      if (locked === null || locked.status !== "active") {
        return;
      }
      await this.repository.updateSession(session.id, { status: "expired", updatedAt: at }, tx);
      await this.audit.record(tx, {
        actorId: null,
        action: "delete",
        objectType: "file",
        objectId: locked.fileId,
        projectId,
        summary: "上传会话过期清理（未完成分片与暂存对象已清除）",
        metadata: { uploadId: locked.id, expiresAt: locked.expiresAt.toISOString() },
      });
    });
  }

  /** 中止分片会话 + 按版本清暂存对象（都不抛错：清理失败只告警，过期清理会兜底）。 */
  private async discardStaging(session: UploadSessionRow, reason: string): Promise<void> {
    if (session.storageUploadId !== null) {
      try {
        await this.storage.abortMultipartUpload({ objectKey: session.objectKey, uploadId: session.storageUploadId });
      } catch (error) {
        this.logger.warn("中止分片会话失败（" + reason + "）：" + session.objectKey + " / " + String(error));
      }
    }
    try {
      await this.storage.purgeObject(session.objectKey);
    } catch (error) {
      this.logger.warn("清理暂存对象失败（" + reason + "）：" + session.objectKey + " / " + String(error));
    }
  }
}

function rangeParts(totalParts: number): number[] {
  return Array.from({ length: totalParts }, (_unused, index) => index + 1);
}

/** 缺失分片摘要（details 里不放大数组：超过 20 个只列前 20）。 */
function summarize(parts: readonly number[]): string {
  return parts.length <= 20 ? parts.join(",") : parts.slice(0, 20).join(",") + "…（共 " + parts.length + " 片）";
}

function toFileView(row: FileRow): z.infer<typeof FileSchema> {
  return {
    id: row.id,
    projectId: row.projectId,
    nodeId: row.nodeId,
    taskId: row.taskId,
    docType: row.docType as z.infer<typeof FileSchema>["docType"],
    name: row.name,
    status: row.status as z.infer<typeof FileSchema>["status"],
    currentVersionId: row.currentVersionId,
    version: row.version,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finalizedAt: row.finalizedAt?.toISOString() ?? null,
    finalizedBy: row.finalizedBy,
    recycledAt: row.recycledAt?.toISOString() ?? null,
    recycledBy: row.recycledBy,
    recycledFromStatus: row.recycledFromStatus as z.infer<typeof FileSchema>["recycledFromStatus"],
  };
}

function toSessionView(row: UploadSessionRow): z.infer<typeof UploadSessionSchema> {
  return {
    id: row.id,
    fileId: row.fileId,
    intent: row.intent as z.infer<typeof UploadSessionSchema>["intent"],
    partSizeBytes: row.partSizeBytes,
    totalParts: row.totalParts,
    status: row.status as z.infer<typeof UploadSessionSchema>["status"],
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

function toVersionView(row: FileVersionRow): z.infer<typeof FileVersionSchema> {
  return {
    id: row.id,
    fileId: row.fileId,
    seq: row.seq,
    sizeBytes: Number(row.sizeBytes),
    contentHash: row.contentHash,
    mime: row.mime,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt.toISOString(),
    changeRequestId: row.changeRequestId,
  };
}
