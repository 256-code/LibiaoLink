import { Injectable, Logger } from "@nestjs/common";
import { FilePreviewResponseSchema, z } from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { AppConfig } from "../../config/config.module.js";
import { DatabaseService } from "../../db/database.service.js";
import { appendOutboxIfAbsent } from "../../db/outbox.js";
import { ObjectStorage } from "../../storage/index.js";
import { AuditService } from "../admin/index.js";
import { PermissionService } from "../permission/index.js";
import { FileRepository, type FileRow, type FileVersionRow } from "./file.repository.js";
import { buildPreviewJobPayload, PREVIEW_JOB_TOPIC, previewJobDedupeKey, type PreviewTarget } from "./preview.job.js";
import { PreviewRepository, type PreviewArtifactKey, type PreviewArtifactRow } from "./preview.repository.js";
import { previewTargetsFor } from "./preview.targets.js";

type FilePreviewResponse = z.infer<typeof FilePreviewResponseSchema>;

/**
 * 预览读 API（M4-05 读面 · `GET /files/{id}/preview` · 契约 shared/src/modules/files.ts）。
 *
 * 三态语义（D2-05，未就绪 / 失败都是 200）：
 * - `ready`：三元组命中产物 → 签发**短时签名地址**（D2-04：对象存储禁匿名读取）+ 写**一条** `action = preview` 审计；
 * - `not_ready`：**同事务**登记产物行（首次）+ 幂等补投 `preview.job`（去重键 = 三元组，`dead` 会被唤醒）→ 前端轮询；
 * - `failed`：返回 `preview_artifacts.error`（≤ 500 字）供前端降级「请下载查看」（D2-05），**不原地重试**
 *   （缓存态：管线修复靠 `PREVIEW_PIPELINE_VERSION` 递增失效）。
 *
 * 读取侧的两个**终态降级**（不落表、不投任务 —— 判不出来就永远不会有产物，落表只堆垃圾行，投任务只烧转换配额）：
 * - 文件尚无版本（未完成过上传）：`failed` + 「尚无版本」；
 * - 判不出渲染通道（如 `.zip`）：`failed` + 「暂不支持在线预览」。
 * 两者都返回 `failed` 而不是 `not_ready`，是为了让前端**轮询有终点**（契约：前端轮询至 ready / failed）。
 *
 * 权限 = 项目可见即可（Push 160 定案，同文件详情 / 版本链：不可见 / 不存在统一 404，防 IDOR）；
 * 版本 404：`versionId` 给定但不属于该文件 / 不存在（A4-06「任意历史版本可预览」，缺省 = 当前版本）。
 * 审计只记**用户访问**（`object_type = file` + metadata `versionId` / `target` / `pipelineVersion`）：
 * 生成侧不写审计（否则一次预览两条，把「查看 / 下载」审计计数翻倍）。
 */
@Injectable()
export class PreviewReadService {
  private readonly logger = new Logger(PreviewReadService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly repository: FileRepository,
    private readonly previews: PreviewRepository,
    private readonly storage: ObjectStorage,
    private readonly permission: PermissionService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  /** `GET /files/{id}/preview`：文件可见性 → 目标版本 → 三元组三态。 */
  async getPreview(fileId: string, versionId: string | null, actorId: string): Promise<FilePreviewResponse> {
    const file = await this.loadVisibleFile(fileId, actorId);
    const version = await this.resolveVersion(file, versionId);
    if (version === null) {
      return this.degrade(file.id, null, "文件尚无任何版本（未完成过上传），请下载查看");
    }

    const targets = previewTargetsFor({ fileName: file.name, mime: version.mime });
    if (targets.length === 0) {
      return this.degrade(file.id, version.id, "该文件类型暂不支持在线预览，请下载查看");
    }

    // 缓存键 = 三元组（内容哈希 + 管线版本 + 通道）；同一内容可有多个通道，逐个查已有产物。
    const pipelineVersion = this.config.env.PREVIEW_PIPELINE_VERSION;
    const keys: PreviewArtifactKey[] = targets.map((target) => ({
      contentHash: version.contentHash,
      pipelineVersion,
      target,
    }));
    const rows: (PreviewArtifactRow | null)[] = [];
    for (const key of keys) {
      rows.push(await this.previews.findByKey(key));
    }

    const readyIndex = rows.findIndex((row) => row !== null && row.status === "ready");
    if (readyIndex >= 0) {
      return this.serveReady(file, version, keys[readyIndex]!, rows[readyIndex]!, actorId);
    }

    const failed = rows.filter((row): row is PreviewArtifactRow => row !== null && row.status === "failed");
    if (failed.length === rows.length) {
      return {
        fileId: file.id,
        versionId: version.id,
        status: "failed",
        target: null,
        url: null,
        expiresAt: null,
        pipelineVersion,
        reason: failed[0]!.error ?? "预览转换失败，请下载查看",
        generatedAt: null,
      };
    }

    await this.dispatch(file, version, keys, rows);
    return {
      fileId: file.id,
      versionId: version.id,
      status: "not_ready",
      target: null,
      url: null,
      expiresAt: null,
      pipelineVersion,
      reason: null,
      generatedAt: null,
    };
  }

  /** 文件装载（读路径）：不存在 / 不可见 → 404（同文件详情 / 版本链口径）。 */
  private async loadVisibleFile(fileId: string, actorId: string): Promise<FileRow> {
    const file = await this.repository.findFileById(fileId);
    if (file === null) {
      throw new AppError("NOT_FOUND", "文件不存在");
    }
    await this.permission.assertProjectVisible(actorId, file.projectId);
    return file;
  }

  /** 目标版本：查询参数缺省 = 当前版本；给出但不属于该文件 / 不存在 → 404；文件无版本 → null。 */
  private async resolveVersion(file: FileRow, versionId: string | null): Promise<FileVersionRow | null> {
    const wanted = versionId ?? file.currentVersionId;
    if (wanted === null) {
      return null;
    }
    const version = await this.repository.findVersionById(file.id, wanted);
    if (version === null) {
      throw new AppError("NOT_FOUND", versionId === null ? "文件当前版本不存在" : "版本不存在或不属于该文件");
    }
    return version;
  }

  /** ready：短时签名 + 审计（先签名后审计 —— 地址没签发成功就不算一次「查看」）。 */
  private async serveReady(
    file: FileRow,
    version: FileVersionRow,
    key: PreviewArtifactKey,
    row: PreviewArtifactRow,
    actorId: string,
  ): Promise<FilePreviewResponse> {
    if (row.objectKey === null) {
      // 库侧 CHECK（ck_preview_artifacts_ready_pair）保证 ready ⇔ object_key，这里只做不变量兜底。
      throw new AppError("INTERNAL", "预览产物登记不完整（ready 行缺 object_key），请重新生成");
    }
    // 不传 fileName = 不改写 Content-Disposition → 浏览器内联渲染（下载地址才需要 attachment）。
    const signed = await this.storage.signDownloadUrl({
      objectKey: row.objectKey,
      expiresInSeconds: this.config.env.PREVIEW_URL_TTL_SECONDS,
    });
    await this.audit.record(this.database.db, {
      actorId,
      action: "preview",
      objectType: "file",
      objectId: file.id,
      projectId: file.projectId,
      summary: "预览文件：" + file.name + "（版本 v" + version.seq + " · 通道 " + key.target + "）",
      metadata: { versionId: version.id, target: key.target, pipelineVersion: key.pipelineVersion },
    });
    return {
      fileId: file.id,
      versionId: version.id,
      status: "ready",
      target: key.target,
      url: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
      pipelineVersion: key.pipelineVersion,
      reason: null,
      generatedAt: row.generatedAt === null ? null : row.generatedAt.toISOString(),
    };
  }

  /**
   * 未就绪：同事务「登记产物行（首次）+ 幂等补投任务」。
   * - 已有 `not_ready` 行：只补投（登记不重复写）；
   * - 无行：先登记 `not_ready`（读面首次请求即登记，定档未预生成的通道靠这里补上）；
   * - `failed` 行：跳过（缓存态失败不原地重试，等管线版本递增）；
   * - `ready` 行：不会走到这里（上游已返回）。
   */
  private async dispatch(
    file: FileRow,
    version: FileVersionRow,
    keys: readonly PreviewArtifactKey[],
    rows: readonly (PreviewArtifactRow | null)[],
  ): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]!;
        const existing = rows[index] ?? null;
        if (existing !== null && existing.status !== "not_ready") {
          continue;
        }
        if (existing === null) {
          await this.previews.ensureRequested({ fileId: file.id, versionId: version.id, ...key }, tx);
        }
        await appendOutboxIfAbsent(tx, {
          topic: PREVIEW_JOB_TOPIC,
          dedupeKey: previewJobDedupeKey(key),
          payload: buildPreviewJobPayload({
            projectId: file.projectId,
            fileId: file.id,
            versionId: version.id,
            contentHash: version.contentHash,
            target: key.target,
            trigger: "read",
          }),
        });
      }
    });
    this.logger.log(
      "预览未就绪（已幂等补投）：" + file.name + " / version=" + version.id + " / pipeline=" + keys[0]!.pipelineVersion,
    );
  }

  /** 读取侧终态降级（D2-05）：判定与投递都不做，直接给前端一个可落地的「请下载」状态。 */
  private degrade(fileId: string, versionId: string | null, reason: string): FilePreviewResponse {
    return {
      fileId,
      versionId,
      status: "failed",
      target: null,
      url: null,
      expiresAt: null,
      pipelineVersion: null,
      reason,
      generatedAt: null,
    };
  }
}