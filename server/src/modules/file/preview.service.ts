import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ClockService } from "../../common/clock/clock.service.js";
import { AppConfig } from "../../config/config.module.js";
import { OutboxStore, type OutboxClaimedRow } from "../../db/outbox.store.js";
import { buildPreviewArtifactKey, ObjectStorage } from "../../storage/index.js";
import { FileRepository } from "./file.repository.js";
import { ConverterError, PreviewConverter, type ConverterHealth } from "./preview.converter.js";
import { PREVIEW_JOB_TOPIC, parsePreviewJob } from "./preview.job.js";
import { PreviewRepository, type PreviewArtifactKey } from "./preview.repository.js";

/**
 * 预览转换队列（M4-05c）：worker 领 outbox `preview.job` → 调转换沙箱 → 产物回对象存储 → 更新 preview_artifacts。
 *
 * 切片边界（Push 160 定案）：本服务只落「领取 + 消费 + 重试 + dead」，**不含规则 / 通知编排**（那是 i5 的活）。
 * 三元组幂等（D2-06「同一内容只转一次」）在三处合围：
 * ① 投递侧去重键 = 三元组（同三元组只落一条任务）；② 消费侧先查 preview_artifacts（ready 直接复用，failed 不原地重试）；
 * ③ 对象键由三元组构造（换内容 / 换管线版本 / 换通道 = 新键，不覆盖旧产物）。
 *
 * 失败处置（deploy/preview/README「五」错误面）：可重试（503 / 504 / 连接错误 / 存储抖动）按
 * `PREVIEW_CONVERT_BACKOFF_MS` 指数退避，到 `PREVIEW_CONVERT_MAX_ATTEMPTS` 次仍失败则写 failed + outbox dead；
 * 确定性失败（400 / 413 / 415 / 422 / 501 / 管线版本不一致 / 超大文件）一次即降级（D2-05「请下载查看」）。
 */

/** 单轮领取结果（worker 循环日志与测试断言共用）。 */
export interface PreviewDrainStats {
  /** 本轮领到的行数。 */
  claimed: number;
  /** 本轮新转成的产物数。 */
  ready: number;
  /** 复用（已有 ready）/ 缓存态失败（failed）/ 源已不存在 —— 未调用转换器的行数。 */
  reused: number;
  /** 回 pending 等退避重试的行数。 */
  retried: number;
  /** 转 dead（到顶或确定性失败）的行数。 */
  dead: number;
  /** 任务已无意义、直接消费掉的行数（源文件或版本已不存在）。 */
  skipped: number;
}

/** 退避上限：15s 起步翻倍，最多等 30 分钟（容器重启 / 打满配额等场景）。 */
const BACKOFF_MAX_MS = 30 * 60_000;

/** structured 一期不启用（ADR-007：xlsx 走 pdf）；投了也不调转换器，直接按确定性失败降级。 */
const STRUCTURED_NOT_SUPPORTED = "structured 通道一期未启用（ADR-007：xlsx 走 pdf 通道），已降级「请下载查看」";

@Injectable()
export class PreviewService {
  private readonly logger = new Logger(PreviewService.name);

  constructor(
    private readonly repository: FileRepository,
    private readonly previews: PreviewRepository,
    private readonly outbox: OutboxStore,
    private readonly storage: ObjectStorage,
    private readonly converter: PreviewConverter,
    private readonly config: AppConfig,
    private readonly clock: ClockService,
  ) {}

  /** 本实例期望的转换管线版本（进三元组缓存键；与镜像标签同值，deploy/preview/README「四」）。 */
  get pipelineVersion(): string {
    return this.config.env.PREVIEW_PIPELINE_VERSION;
  }

  /** worker 启动自检：转换器可达性 + 管线版本比对（只告警不阻断启动，见 entry/worker.ts）。 */
  checkConverter(): Promise<ConverterHealth> {
    return this.converter.healthz();
  }

  /**
   * 领取一轮并逐条消费。串行处理：单条最长占满客户端超时（默认 90s），串行 = 同实例并发恒为 1，
   * 给转换沙箱（并发 2 / 队列 8）留出人工排障与 api 侧预留；要提速先把
   * `OUTBOX_BATCH_LIMIT` 与转换器限额一起按 ADR-013 复核，再把这里改成小并发。
   */
  async drainOnce(limit = this.config.env.OUTBOX_BATCH_LIMIT): Promise<PreviewDrainStats> {
    const rows = await this.outbox.claim({
      topics: [PREVIEW_JOB_TOPIC],
      limit,
      staleAfterMs: this.config.env.OUTBOX_STALE_MS,
    });
    const stats: PreviewDrainStats = { claimed: rows.length, ready: 0, reused: 0, retried: 0, dead: 0, skipped: 0 };
    for (const row of rows) {
      await this.processJob(row, stats);
    }
    return stats;
  }

  /** 单条消费：任何异常都收敛成「重试 / dead」，绝不把错误抛给 worker 循环（否则整轮停摆）。 */
  private async processJob(row: OutboxClaimedRow, stats: PreviewDrainStats): Promise<void> {
    const job = parsePreviewJob(row.payload);
    if (job === null) {
      stats.dead += 1;
      this.logger.warn("预览任务载荷非法，转 dead：outbox#" + row.id + "（" + row.dedupeKey + "）");
      await this.outbox.markDead(row.id, {
        attempts: row.attempts + 1,
        error: "预览任务载荷非法（缺 projectId / fileId / versionId / target）：" + row.dedupeKey,
      });
      return;
    }

    const file = await this.repository.findFileById(job.fileId);
    const version = file === null ? null : await this.repository.findVersionById(job.fileId, job.versionId);
    if (file === null || version === null) {
      // 源版本已不存在（彻底删除 / 回收站到期清理 / 历史数据）：任务已无意义 —— 重试与 dead 都只会留噪音。
      stats.skipped += 1;
      this.logger.warn("预览任务跳过（源文件或版本已不存在）：file=" + job.fileId + " version=" + job.versionId);
      await this.outbox.markDone(row.id);
      return;
    }

    // 缓存键以**库内版本行的 contentHash** 为准（payload 里那份只作排障参照，不参与构造）。
    const key: PreviewArtifactKey = {
      contentHash: version.contentHash,
      pipelineVersion: this.pipelineVersion,
      target: job.target,
    };

    try {
      const existing = await this.previews.findByKey(key);
      if (existing !== null && existing.status !== "not_ready") {
        // ready = 同三元组已转成，直接复用；failed = 缓存态失败，等 pipeline_version 递增才失效（不做原地重试）。
        stats.reused += 1;
        this.logger.log("预览任务命中既有产物（" + existing.status + "），复用不重转：" + row.dedupeKey);
        await this.outbox.markDone(row.id);
        return;
      }

      const artifact = existing ?? (await this.previews.ensureRequested({ fileId: job.fileId, versionId: job.versionId, ...key }));
      if (artifact.status !== "not_ready") {
        // 并发窗口：另一实例（或上一轮）刚把这一行转成了。
        stats.reused += 1;
        await this.outbox.markDone(row.id);
        return;
      }

      if (job.target === "structured") {
        throw new ConverterError("deterministic", "UNSUPPORTED_TARGET", null, STRUCTURED_NOT_SUPPORTED);
      }

      const limitMb = this.config.env.PREVIEW_CONVERT_MAX_SOURCE_MB;
      if (version.sizeBytes > limitMb * 1024 * 1024) {
        throw new ConverterError(
          "deterministic",
          "SOURCE_TOO_LARGE",
          null,
          "源文件 " + megabytes(version.sizeBytes) + " 超过预览转换上限 " + limitMb + " MB（转换峰值内存约为源文件数倍），已降级「请下载查看」",
        );
      }

      const source = await this.storage.getObject(version.objectKey);
      if (source === null) {
        // 存储侧短时不可见 / 对象缺失：按可重试处理，交给退避与到顶兜底（不立刻判死）。
        throw new ConverterError("retryable", "SOURCE_OBJECT_MISSING", null, "源对象不存在（objectKey=" + version.objectKey + "）");
      }

      const requestId = randomUUID();
      const converted = await this.converter.convert({
        bytes: source.bytes,
        target: job.target,
        fileName: file.name,
        sourceMime: version.mime,
        requestId,
      });

      const objectKey = buildPreviewArtifactKey(key);
      const generatedAt = this.clock.now();
      await this.storage.putObject({
        objectKey,
        body: converted.bytes,
        contentType: converted.contentType,
        metadata: {
          "preview-pipeline-version": key.pipelineVersion,
          "preview-target": key.target,
          "preview-content-hash": key.contentHash,
          "preview-source-version": version.id,
          "preview-mode": converted.mode ?? "unknown",
          "preview-request-id": requestId,
        },
      });
      await this.previews.markReady(key, { objectKey, generatedAt });
      await this.outbox.markDone(row.id);
      stats.ready += 1;
      this.logger.log(
        "预览产物就绪：" + file.name + "（target=" + key.target + " / " + converted.bytes.byteLength + " 字节 / " +
          (converted.durationMs === null ? "耗时未标注" : converted.durationMs + " ms") + " / 键 " + objectKey + "）",
      );
    } catch (error) {
      await this.failJob(row, key, file.name, error, stats);
    }
  }

  /** 失败收敛：可重试且未到顶 → 回 pending 退避；否则写产物 failed + outbox dead（D2-05 降级）。 */
  private async failJob(
    row: OutboxClaimedRow,
    key: PreviewArtifactKey,
    fileName: string,
    error: unknown,
    stats: PreviewDrainStats,
  ): Promise<void> {
    const attempts = row.attempts + 1;
    const message = messageOf(error);
    const retryable = !(error instanceof ConverterError) || error.kind === "retryable";
    const maxAttempts = this.config.env.PREVIEW_CONVERT_MAX_ATTEMPTS;

    if (retryable && attempts < maxAttempts) {
      const backoffMs = Math.min(this.config.env.PREVIEW_CONVERT_BACKOFF_MS * 2 ** (attempts - 1), BACKOFF_MAX_MS);
      await this.outbox.markRetry(row.id, {
        attempts,
        availableAt: new Date(this.clock.now().getTime() + backoffMs),
        error: message,
      });
      stats.retried += 1;
      this.logger.warn(
        "预览转换失败（第 " + attempts + "/" + maxAttempts + " 次），" + Math.round(backoffMs / 1000) + "s 后重试：" +
          fileName + " —— " + message,
      );
      return;
    }

    try {
      await this.previews.markFailed(key, { error: message, updatedAt: this.clock.now() });
    } catch (markError) {
      // 失败态写不进去（如行被并发清掉）不该阻塞队列：留痕后继续把 outbox 转 dead。
      this.logger.error("预览失败态写入失败（继续把 outbox 转 dead）：" + fileName + " —— " + messageOf(markError));
    }
    await this.outbox.markDead(row.id, { attempts, error: message });
    stats.dead += 1;
    this.logger.error(
      "预览转换放弃（" + (retryable ? "重试到顶" : "确定性失败") + "）：" + fileName + " —— " + message,
    );
  }
}

function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > 500 ? raw.slice(0, 500) : raw;
}

function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}