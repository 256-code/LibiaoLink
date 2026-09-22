import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import {
  FileDetailSchema,
  FileFinalizeBodySchema,
  FileListResponseSchema,
  FilePurgeBodySchema,
  FilePurgeResponseSchema,
  FileRecycleBodySchema,
  FileRestoreBodySchema,
  FileRollbackBodySchema,
  FileRollbackResponseSchema,
  FileSchema,
  FileVersionListResponseSchema,
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
import type { DbTransaction } from "../../db/db-client.js";
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
import {
  FileRepository,
  type FileLinkInsertInput,
  type FileRow,
  type FileVersionRow,
  type UploadSessionRow,
} from "./file.repository.js";
import { parseFileListFilter, parseFileListSort, type FileListQueryInput } from "./file.query.js";

type UploadCreateBody = z.infer<typeof UploadCreateBodySchema>;
type UploadPartsBody = z.infer<typeof UploadPartsBodySchema>;
type UploadCompleteBody = z.infer<typeof UploadCompleteBodySchema>;
type UploadCreateResponse = z.infer<typeof UploadCreateResponseSchema>;
type UploadPartsResponse = z.infer<typeof UploadPartsResponseSchema>;
type UploadSessionView = z.infer<typeof UploadSessionViewSchema>;
type UploadCompleteResponse = z.infer<typeof UploadCompleteResponseSchema>;
type UploadAbortResponse = z.infer<typeof UploadAbortResponseSchema>;
type FileDetail = z.infer<typeof FileDetailSchema>;
type FileVersionList = z.infer<typeof FileVersionListResponseSchema>;
type FileView = z.infer<typeof FileSchema>;
type FileFinalizeBody = z.infer<typeof FileFinalizeBodySchema>;
type FileRollbackBody = z.infer<typeof FileRollbackBodySchema>;
type FileRollbackResponse = z.infer<typeof FileRollbackResponseSchema>;
type FileRecycleBody = z.infer<typeof FileRecycleBodySchema>;
type FileRestoreBody = z.infer<typeof FileRestoreBodySchema>;
type FilePurgeBody = z.infer<typeof FilePurgeBodySchema>;
type FilePurgeResponse = z.infer<typeof FilePurgeResponseSchema>;
type FileListResponse = z.infer<typeof FileListResponseSchema>;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** 过期会话清理单批上限（worker 每轮；避免长事务与大对象清理拖住心跳）。 */
export const EXPIRE_SWEEP_BATCH = 200;
/** 回收站到期清理单批上限（worker 每轮；彻底删除含对象清理，批更小）。 */
export const RECYCLE_SWEEP_BATCH = 100;

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
 * 权限：创建 / 分片 / 完成 / 取消 / 定档 / 回溯 / 回收 / 恢复 = `file.upload`（项目成员平权，ADR-011 平权例外）；
 * 读取（详情 / 版本链 / 会话状态）= 项目可见即可；彻底删除 = 仅系统管理员（权限模型落地前临时口径）；
 * 不可见资源统一 404（防 IDOR）。
 *
 * M4-02 增补（版本 / 定档 / 回溯 / 回收站 + 到期清理）：
 * - 状态机：draft → final（定档锁版）→ changed（M4-04 变更）→ archived；任意态可 recycled（回收站，保留 30 天可恢复）；
 * - 放开 `intent=version` + `fileId`（Push 130 定案）：对既有 draft 文件追加 / 替换版本（版本链只追加，当前版本指向新版本）；
 * - 生命周期写操作一律带乐观锁 `version`（409 VERSION_CONFLICT；「并发定档 409」为 M4 出口标准）；
 * - 回溯生成新版本（复制目标版对象到新版本契约键），不删历史；定档后回溯走变更流（随 M4-04）；
 * - `intent=change`（M4-04）与「定档后回溯」见各方法内的暂缓说明；到期清理由 worker 定时档执行（system 审计 actorId=null）。
 *
 * M4-03 增补（多态关联与文件库查询）：
 * - complete 时在事务内写 `file_links`（project 必写、node / task 有则写；唯一（file, object_type, object_id）保证幂等）；
 * - 文件库列表 `GET /projects/{id}/files`：状态 / 类型 / 节点 / 任务 / 上传人筛选 + 关键字 + 白名单排序 + 分页
 *   （默认排除 recycled —— 回收站文件走显式 `filter[status]=recycled`）。
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
    // `intent=change`（定档后变更上传）随 M4-04 变更申请落地：zod 已按契约放行（change 必填 fileId + change 体），
    // 本切片显式 400 —— 不处理会把变更误当「新建 / 追加版本」写库。
    if (body.intent === "change") {
      throw new AppError(
        "VALIDATION_FAILED",
        "intent=change（定档后变更上传）随 M4-04 变更申请落地；当前只开放 intent=version（省略 fileId = 新建文件、给出 = 对既有 draft 文件替换 / 追加版本）",
        [
          {
            code: "intent_change_not_open",
            message: "change 意图随 M4-04 变更申请落地",
            path: "intent",
          },
        ],
      );
    }
    // 目标文件（Push 130 定案 · M4-02 放开）：给出 fileId = 对既有 draft 文件替换 / 追加新版本。
    const target = body.fileId === undefined ? null : await this.resolveUploadTarget(body, actorId);
    const effectiveName = target === null ? body.name : target.name;
    const effectiveDocType = target === null ? body.docType ?? null : target.docType;
    const effectiveNodeId = target === null ? body.nodeId : target.nodeId ?? undefined;
    const effectiveTaskId = target === null ? body.taskId : target.taskId ?? undefined;

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
    await this.assertLinksInProject(body.projectId, effectiveNodeId, effectiveTaskId);

    const at = this.clock.now();
    const expiresAt = new Date(at.getTime() + this.config.env.UPLOAD_SESSION_TTL_HOURS * HOUR_MS);
    const plan = planUpload(body.sizeBytes);
    const sessionId = randomUUID();

    const created = await this.database.db.transaction(async (tx) => {
      const file =
        target === null
          ? await this.repository.insertFile(
              {
                projectId: body.projectId,
                nodeId: effectiveNodeId ?? null,
                taskId: effectiveTaskId ?? null,
                docType: effectiveDocType,
                name: effectiveName,
                status: "draft",
                createdBy: actorId,
              },
              tx,
            )
          : target;
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
        action: target === null ? "create" : "update",
        objectType: "file",
        objectId: file.id,
        projectId: body.projectId,
        summary: (target === null ? "发起上传：" : "发起上传（既有 draft 文件追加版本）：") + effectiveName,
        changes:
          target === null
            ? [
                { field: "name", from: null, to: effectiveName },
                { field: "status", from: null, to: file.status },
              ]
            : [{ field: "pendingVersion", from: null, to: String(target.version + 1) }],
        metadata: {
          uploadId: session.id,
          intent: session.intent,
          sizeBytes: body.sizeBytes,
          partSizeBytes: plan.partSizeBytes,
          totalParts: plan.totalParts,
          expiresAt: expiresAt.toISOString(),
          targetFileId: target === null ? null : target.id,
        },
      });
      return { file, session };
    });

    // 秒传提示：仅新建文件（Push 130 定案：给出 fileId 时 duplicateHint 恒空 —— 目标文件已经确定）。
    const duplicateHint =
      target !== null || body.contentHash === undefined
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
      // 目标文件在会话期间被定档 / 回收时不得再追加版本（Push 130 定案：version 意图目标须 draft）。
      if (lockedFile.status !== "draft") {
        throw new AppError(
          "FILE_STATE_INVALID",
          "目标文件已不是未定档状态（" + lockedFile.status + "），不能追加版本；定档后修改请走变更（M4-04）",
        );
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
      // M4-03 多态关联：上传成功即建立关联（project 必写，node / task 有则写；on conflict do nothing 幂等）。
      await this.repository.insertFileLinks(buildFileLinkInputs(lockedFile, actorId, at), tx);
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

  /** 文件装载（读路径）：不存在 / 不可见 → 404（防 IDOR；读取面 = 项目可见即可）。 */
  private async loadFileForRead(fileId: string, actorId: string): Promise<FileRow> {
    const file = await this.repository.findFileById(fileId);
    if (file === null) {
      throw new AppError("NOT_FOUND", "文件不存在");
    }
    await this.permission.assertProjectVisible(actorId, file.projectId);
    return file;
  }

  /** 文件装载（生命周期写路径）：可见性之后加判 `file.upload`（项目成员平权，ADR-011 平权例外）。 */
  private async loadFileForWrite(fileId: string, actorId: string): Promise<FileRow> {
    const file = await this.repository.findFileById(fileId);
    if (file === null) {
      throw new AppError("NOT_FOUND", "文件不存在");
    }
    const access = await this.permission.assertProjectVisible(actorId, file.projectId);
    await this.permission.assertCan(actorId, "file.upload", { member: access.member, projectManager: access.projectManager });
    return file;
  }

  /** 锁行装载：生命周期写路径一律在事务内 `for update`（乐观锁校验的基准行）。 */
  private async lockFileOr404(tx: DbTransaction, fileId: string): Promise<FileRow> {
    const locked = await this.repository.lockFile(tx, fileId);
    if (locked === null) {
      throw new AppError("NOT_FOUND", "文件不存在");
    }
    return locked;
  }

  /** 乐观锁：`version` 不匹配 → 409 VERSION_CONFLICT（details 带 current / expected，前端刷新后重试）。 */
  private assertOptimisticVersion(expected: number, actual: number): void {
    if (expected === actual) return;
    throw new AppError("VERSION_CONFLICT", "文件已被他人更新，请刷新后重试", [
      { code: "version_conflict", message: "version 不匹配", path: "version", meta: { expected, current: actual } },
    ]);
  }

  /** 回溯准入：仅未定档（draft）可回溯；final / changed 走变更流（M4-04），recycled / archived 状态不允许。 */
  private assertRollbackAllowed(status: string): void {
    if (status === "final" || status === "changed") {
      throw new AppError("VALIDATION_FAILED", "文件已定档，回溯必须走变更（申请即通过，随 M4-04 落地）；当前仅支持未定档文件回溯", [
        { code: "change_flow_not_open", message: "定档后回溯随 M4-04 变更流落地", path: "toVersionId" },
      ]);
    }
    if (status !== "draft") {
      throw new AppError(
        "FILE_STATE_INVALID",
        "文件当前状态（" + status + "）不允许回溯" + (status === "recycled" ? "；请先从回收站恢复" : ""),
      );
    }
  }

  /** 彻底删除仅系统管理员（权限模型落地前的临时口径，A4-12）。 */
  private async assertAdmin(actorId: string, action: string): Promise<void> {
    const permissions = await this.permission.permissionsOf(actorId);
    if (!permissions.roleCodes.includes("admin")) {
      throw new AppError("FORBIDDEN", "仅系统管理员可" + action);
    }
  }

  /**
   * POST /files/{id}/purge：彻底删除（仅系统管理员 —— 权限模型落地前的临时口径，A4-12）。
   * 仅回收站中的文件可彻底删除（先 `recycle`）；对象按版本清 + 元数据删 + 留痕，乐观锁同其它生命周期写操作。
   */
  async purgeFile(fileId: string, body: FilePurgeBody, actorId: string): Promise<FilePurgeResponse> {
    const file = await this.loadFileForWrite(fileId, actorId);
    await this.assertAdmin(actorId, "彻底删除文件");
    if (file.status !== "recycled") {
      throw new AppError("FILE_STATE_INVALID", "仅回收站中的文件可彻底删除（当前 " + file.status + "）；请先移入回收站");
    }
    const at = this.clock.now();
    await this.purgeRecycled(file, at, { actorId, expectedVersion: body.version, reason: body.reason ?? null });
    return { fileId, purgedAt: at.toISOString() };
  }

  /**
   * 回收站到期清理（M4-02 · worker 定时调用）：`purge_after ≤ now` 的文件按批彻底删除
   * （对象按版本清 + 元数据删 + system 留痕）。单条失败只告警不阻断（下轮重试）；
   * 并发恢复 / 并发彻底删除在事务内复核后跳过。
   */
  async sweepExpiredRecycled(limit: number = RECYCLE_SWEEP_BATCH): Promise<{ scanned: number; purged: number }> {
    const at = this.clock.now();
    const rows = await this.repository.listExpiredRecycledFiles(at, limit);
    let purged = 0;
    for (const row of rows) {
      try {
        const result = await this.purgeRecycled(row, at, { actorId: null, reason: "回收站到期自动清理" });
        if (result !== null) purged += 1;
      } catch (error) {
        this.logger.warn("回收站到期清理失败：" + row.id + " / " + String(error));
      }
    }
    return { scanned: rows.length, purged };
  }

  /**
   * POST /files/{id}/recycle：移入回收站（任意状态可删）。记 `recycled_from_status` 供恢复回退，
   * `purge_after = recycled_at + FILE_RECYCLE_RETENTION_DAYS`（默认 30 天，到期由 worker 彻底删除）。
   */
  async recycleFile(fileId: string, body: FileRecycleBody, actorId: string): Promise<FileView> {
    const file = await this.loadFileForWrite(fileId, actorId);
    const at = this.clock.now();
    const retainedDays = this.config.env.FILE_RECYCLE_RETENTION_DAYS;
    const purgeAfter = new Date(at.getTime() + retainedDays * DAY_MS);
    return this.database.db.transaction(async (tx) => {
      const locked = await this.lockFileOr404(tx, fileId);
      this.assertOptimisticVersion(body.version, locked.version);
      if (locked.status === "recycled") {
        throw new AppError("FILE_STATE_INVALID", "文件已在回收站，不能重复回收");
      }
      const updated = await this.repository.updateFileState(
        fileId,
        {
          status: "recycled",
          recycledAt: at,
          recycledBy: actorId,
          recycledFromStatus: locked.status,
          purgeAfter,
          version: locked.version + 1,
          updatedAt: at,
        },
        tx,
      );
      await this.audit.record(tx, {
        actorId,
        action: "delete",
        objectType: "file",
        objectId: fileId,
        projectId: file.projectId,
        summary: "移入回收站：" + locked.name + "（保留 " + retainedDays + " 天）",
        changes: [{ field: "status", from: locked.status, to: "recycled" }],
        metadata: {
          reason: body.reason ?? null,
          fromStatus: locked.status,
          retainedDays,
          purgeAfter: purgeAfter.toISOString(),
        },
      });
      return toFileView(updated);
    });
  }

  /** POST /files/{id}/restore：从回收站恢复（回到进入前状态；清空回收站三列与到期时间）。 */
  async restoreFile(fileId: string, body: FileRestoreBody, actorId: string): Promise<FileView> {
    const file = await this.loadFileForWrite(fileId, actorId);
    const at = this.clock.now();
    return this.database.db.transaction(async (tx) => {
      const locked = await this.lockFileOr404(tx, fileId);
      this.assertOptimisticVersion(body.version, locked.version);
      if (locked.status !== "recycled") {
        throw new AppError("FILE_STATE_INVALID", "文件不在回收站（当前 " + locked.status + "），无需恢复");
      }
      const restored = locked.recycledFromStatus ?? "draft";
      const updated = await this.repository.updateFileState(
        fileId,
        {
          status: restored,
          recycledAt: null,
          recycledBy: null,
          recycledFromStatus: null,
          purgeAfter: null,
          version: locked.version + 1,
          updatedAt: at,
        },
        tx,
      );
      await this.audit.record(tx, {
        actorId,
        action: "update",
        objectType: "file",
        objectId: fileId,
        projectId: file.projectId,
        summary: "回收站恢复：" + locked.name + "（回退到 " + restored + "）",
        changes: [{ field: "status", from: "recycled", to: restored }],
        metadata: { restoredFrom: "recycled", purgeAfter: locked.purgeAfter?.toISOString() ?? null },
      });
      return toFileView(updated);
    });
  }

  /**
   * POST /files/{id}/rollback：版本回溯 —— 生成新版本（复制目标版对象到新版本契约键），不删除历史。
   * 定档（final / changed）后回溯按变更流处理（A4-13 申请即通过），随 M4-04 落地：
   * 本切片显式 400（details `change_flow_not_open`，同 M4-01 `intent_change_not_open` 的切片守卫口径）。
   */
  async rollbackFile(fileId: string, body: FileRollbackBody, actorId: string): Promise<FileRollbackResponse> {
    const file = await this.loadFileForWrite(fileId, actorId);
    this.assertRollbackAllowed(file.status);
    const target = await this.repository.findVersionById(fileId, body.toVersionId);
    if (target === null) {
      throw new AppError("NOT_FOUND", "回溯目标版本不存在或不属于该文件");
    }
    if (file.currentVersionId === target.id) {
      throw new AppError("VALIDATION_FAILED", "目标版本已是当前版本，无需回溯", [
        { code: "already_current", message: "toVersionId 即当前版本", path: "toVersionId" },
      ]);
    }
    const at = this.clock.now();
    // 与 complete 同序：先把目标版对象复制到新版本契约键（事务外），事务内锁行复核位次，防并发抢同一位次。
    const seq = await this.repository.nextVersionSeq(fileId);
    const objectKey = buildObjectKey({
      projectId: file.projectId,
      fileId,
      seq,
      contentHash: target.contentHash,
      fileName: file.name,
    });
    try {
      await this.storage.copyObject({
        sourceKey: target.objectKey,
        destinationKey: objectKey,
        contentType: target.mime,
        metadata: { "file-name": encodeURIComponent(file.name) },
      });
    } catch (error) {
      throw toApiError(error);
    }

    const committed = await this.database.db.transaction(async (tx) => {
      const locked = await this.lockFileOr404(tx, fileId);
      this.assertOptimisticVersion(body.version, locked.version);
      this.assertRollbackAllowed(locked.status);
      if (locked.currentVersionId === target.id) {
        throw new AppError("VALIDATION_FAILED", "目标版本已是当前版本，无需回溯", [
          { code: "already_current", message: "toVersionId 即当前版本", path: "toVersionId" },
        ]);
      }
      const currentSeq = await this.repository.nextVersionSeq(fileId, tx);
      if (currentSeq !== seq) {
        throw new AppError("INTERNAL", "文件版本位次被并发上传占用，请重试回溯");
      }
      const version = await this.repository.insertVersion(
        {
          fileId,
          seq,
          objectKey,
          sizeBytes: target.sizeBytes,
          contentHash: target.contentHash,
          mime: target.mime,
          uploadedBy: actorId,
          uploadedAt: at,
        },
        tx,
      );
      const updated = await this.repository.updateFileState(
        fileId,
        { currentVersionId: version.id, version: locked.version + 1, updatedAt: at },
        tx,
      );
      await this.audit.record(tx, {
        actorId,
        action: "rollback",
        objectType: "file",
        objectId: fileId,
        projectId: file.projectId,
        summary: "版本回溯：" + locked.name + " v" + target.seq + " → 新版本 v" + version.seq + "（不删历史）",
        changes: [{ field: "currentVersionId", from: locked.currentVersionId, to: version.id }],
        metadata: { toVersionId: target.id, fromSeq: target.seq, newSeq: version.seq, reason: body.reason, objectKey },
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
          contentHash: target.contentHash,
          sizeBytes: target.sizeBytes,
          mime: target.mime,
          rollbackOf: target.id,
          reason: body.reason,
          actorId,
          at: at.toISOString(),
        },
      });
      return { file: updated, version };
    });
    return { file: toFileView(committed.file), version: toVersionView(committed.version), changeRequest: null };
  }

  /**
   * GET /files/{id}：文件详情（含当前版本）。读取面 = 项目可见即可（不可见 404，防 IDOR）。
   * 回收站中的文件同样可读（回收站列表 / 详情与恢复入口）。
   */
  async getFile(fileId: string, actorId: string): Promise<FileDetail> {
    const file = await this.loadFileForRead(fileId, actorId);
    const currentVersion =
      file.currentVersionId === null ? null : await this.repository.findVersionById(file.id, file.currentVersionId);
    return { ...toFileView(file), currentVersion: currentVersion === null ? null : toVersionView(currentVersion) };
  }

  /** GET /files/{id}/versions：版本链（按 seq 升序；含已回收文件与历史版本，只读不删）。 */
  async listFileVersions(fileId: string, actorId: string): Promise<FileVersionList> {
    const file = await this.loadFileForRead(fileId, actorId);
    const items = await this.repository.listVersions(file.id);
    return { items: items.map(toVersionView), total: items.length };
  }

  /**
   * GET /projects/{id}/files：文件库列表（M4-03 · A4-01）—— 筛选 / 关键字 / 白名单排序 / 分页。
   * 读 = 项目可见即可（不可见 404 由 ProjectAccessGuard 在入口判定）；默认排除 recycled。
   */
  async listProjectFiles(projectId: string, query: FileListQueryInput): Promise<FileListResponse> {
    const filter = parseFileListFilter(query);
    const sorts = parseFileListSort(query.sort);
    const offset = (query.page - 1) * query.limit;
    const { items, total } = await this.repository.listProjectFiles(projectId, filter, sorts, query.limit, offset);
    return { items: items.map(toFileView), page: query.page, limit: query.limit, total };
  }

  /**
   * POST /files/{id}/finalize：定档锁版（draft → final；至少 1 个版本）。
   * 乐观锁 `version` 不匹配 → 409 VERSION_CONFLICT（M4 出口标准「并发定档 409」）；非 draft → 409 FILE_STATE_INVALID。
   * 定档后不可覆盖 / 替换，修改必须走变更（M4-04）。
   */
  async finalizeFile(fileId: string, body: FileFinalizeBody, actorId: string): Promise<FileView> {
    const file = await this.loadFileForWrite(fileId, actorId);
    const at = this.clock.now();
    return this.database.db.transaction(async (tx) => {
      const locked = await this.lockFileOr404(tx, fileId);
      this.assertOptimisticVersion(body.version, locked.version);
      if (locked.status !== "draft") {
        throw new AppError(
          "FILE_STATE_INVALID",
          "文件当前状态（" + locked.status + "）不允许定档；定档后修改请走变更（M4-04）",
        );
      }
      const versions = await this.repository.listVersions(fileId, tx);
      if (versions.length === 0) {
        throw new AppError("VALIDATION_FAILED", "文件没有任何版本，不能定档；请先完成一次上传", [
          { code: "no_version", message: "定档至少需要 1 个版本", path: "version" },
        ]);
      }
      const updated = await this.repository.updateFileState(
        fileId,
        { status: "final", finalizedAt: at, finalizedBy: actorId, version: locked.version + 1, updatedAt: at },
        tx,
      );
      await this.audit.record(tx, {
        actorId,
        action: "complete",
        objectType: "file",
        objectId: fileId,
        projectId: file.projectId,
        summary: "定档锁版：" + locked.name + "（" + versions.length + " 个版本，此后修改走变更）",
        changes: [
          { field: "status", from: locked.status, to: "final" },
          { field: "finalizedAt", from: null, to: at.toISOString() },
        ],
        metadata: { versions: versions.length, currentVersionId: locked.currentVersionId },
      });
      await appendOutbox(tx, {
        topic: "file.finalized",
        dedupeKey: "file.finalized:" + fileId + ":" + updated.version,
        payload: {
          projectId: file.projectId,
          fileId,
          currentVersionId: locked.currentVersionId,
          versions: versions.length,
          actorId,
          at: at.toISOString(),
        },
      });
      return toFileView(updated);
    });
  }

  /**
   * 目标文件解析（`intent=version` + `fileId`，Push 130 定案 · M4-02 放开）：
   * 不存在 / 不可见 → 404；与 projectId 不一致 / 名称与归属（name / docType / nodeId / taskId）与现状不符 → 400；
   * 非 draft → 409 FILE_STATE_INVALID（定档后修改走变更 M4-04）。生效字段一律以目标文件现状为准。
   */
  private async resolveUploadTarget(body: Extract<UploadCreateBody, { intent: "version" }>, actorId: string): Promise<FileRow> {
    const fileId = body.fileId;
    if (fileId === undefined) {
      throw new AppError("INTERNAL", "内部错误：resolveUploadTarget 需要 fileId");
    }
    const file = await this.repository.findFileById(fileId);
    if (file === null) {
      throw new AppError("NOT_FOUND", "目标文件不存在或不可见");
    }
    const access = await this.permission.assertProjectVisible(actorId, file.projectId);
    await this.permission.assertCan(actorId, "file.upload", { member: access.member, projectManager: access.projectManager });
    if (file.projectId !== body.projectId) {
      throw new AppError("VALIDATION_FAILED", "目标文件不属于该项目（projectId 与目标文件不一致）", [
        { code: "invalid_file", message: "fileId 与 projectId 不一致", path: "fileId" },
      ]);
    }
    if (file.status !== "draft") {
      throw new AppError(
        "FILE_STATE_INVALID",
        "目标文件当前状态（" + file.status + "）不允许追加版本；定档后修改请走变更（M4-04）",
      );
    }
    if (body.name !== file.name) {
      throw new AppError("VALIDATION_FAILED", "name 与目标文件现状不一致（以目标文件为准，可原样回填）", [
        { code: "name_mismatch", message: "name 与目标文件不一致", path: "name", meta: { current: file.name } },
      ]);
    }
    if (body.docType !== undefined && body.docType !== file.docType) {
      throw new AppError("VALIDATION_FAILED", "docType 与目标文件现状不一致", [
        { code: "doc_type_mismatch", message: "docType 与目标文件不一致", path: "docType", meta: { current: file.docType } },
      ]);
    }
    if (body.nodeId !== undefined && body.nodeId !== file.nodeId) {
      throw new AppError("VALIDATION_FAILED", "nodeId 与目标文件现状不一致（防静默改挂接）", [
        { code: "node_mismatch", message: "nodeId 与目标文件不一致", path: "nodeId", meta: { current: file.nodeId } },
      ]);
    }
    if (body.taskId !== undefined && body.taskId !== file.taskId) {
      throw new AppError("VALIDATION_FAILED", "taskId 与目标文件现状不一致（防静默改挂接）", [
        { code: "task_mismatch", message: "taskId 与目标文件不一致", path: "taskId", meta: { current: file.taskId } },
      ]);
    }
    return file;
  }

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

  /**
   * 彻底删除公共实现（admin 手动 / worker 到期清理）：事务内**先锁行复核**，再按版本清对象
   * （ADR-006：不依赖存储 lifecycle）→ 清 current_version_id → 删版本 → 删文件行（upload_sessions 外键 cascade）→ 留痕。
   * 对象清理放在持锁事务内（而非「先清对象后开事务」）：防「清理快照过期 + 并发恢复」把已恢复文件的对象误删；
   * 删除对象是幂等空操作 —— 事务中途失败时元数据回滚、下轮重试收敛（对象多删一次无副作用）。
   */
  private async purgeRecycled(
    file: FileRow,
    at: Date,
    options: { actorId: string | null; expectedVersion?: number; reason: string | null },
  ): Promise<{ deletedVersions: number } | null> {
    return this.database.db.transaction(async (tx) => {
      const locked = await this.repository.lockFile(tx, file.id);
      if (locked === null) return null;
      if (options.expectedVersion !== undefined) {
        this.assertOptimisticVersion(options.expectedVersion, locked.version);
      }
      if (locked.status !== "recycled") {
        if (options.expectedVersion !== undefined) {
          throw new AppError("FILE_STATE_INVALID", "文件已不在回收站（当前 " + locked.status + "），不能彻底删除");
        }
        return null;
      }
      const versions = await this.repository.listVersions(file.id, tx);
      for (const version of versions) {
        try {
          await this.storage.purgeObject(version.objectKey);
        } catch (error) {
          throw toApiError(error);
        }
      }
      await this.repository.updateFileState(file.id, { currentVersionId: null }, tx);
      const deletedVersions = await this.repository.deleteVersionsByFile(file.id, tx);
      await this.repository.deleteFile(file.id, tx);
      await this.audit.record(tx, {
        actorId: options.actorId,
        action: "delete",
        objectType: "file",
        objectId: file.id,
        projectId: locked.projectId,
        summary: "彻底删除：" + locked.name + "（" + deletedVersions + " 个版本与对象一并清理）",
        changes: [{ field: "status", from: "recycled", to: null }],
        metadata: {
          source: options.actorId === null ? "system" : "api",
          reason: options.reason,
          deletedVersions,
          purgedAt: at.toISOString(),
          objectKeys: versions.map((version) => version.objectKey),
        },
      });
      return { deletedVersions };
    });
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

/** complete 的关联写入（M4-03）：project 必写，node / task 有则写（唯一约束兜底幂等）。 */
function buildFileLinkInputs(file: FileRow, actorId: string, at: Date): FileLinkInsertInput[] {
  const rows: FileLinkInsertInput[] = [
    { fileId: file.id, objectType: "project", objectId: file.projectId, createdBy: actorId, createdAt: at },
  ];
  if (file.nodeId !== null) {
    rows.push({ fileId: file.id, objectType: "node", objectId: file.nodeId, createdBy: actorId, createdAt: at });
  }
  if (file.taskId !== null) {
    rows.push({ fileId: file.id, objectType: "task", objectId: file.taskId, createdBy: actorId, createdAt: at });
  }
  return rows;
}
