import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { loadEnv } from "../config/env.js";
import { DatabaseService } from "../db/database.service.js";
import { FileService, PreviewService } from "../modules/file/index.js";
import { WorkerModule } from "../worker.module.js";

const HEARTBEAT_MS = 60_000;
/** 上传会话过期清理周期（M4-01）：10 分钟一轮，启动即跑一次；失败只记日志不退出。 */
const UPLOAD_SWEEP_INTERVAL_MS = 10 * 60_000;
/** 回收站到期清理周期（M4-02）：30 分钟一轮，启动即跑一次；单条失败只记日志。 */
const RECYCLE_SWEEP_INTERVAL_MS = 30 * 60_000;

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  const database = app.get(DatabaseService);
  const files = app.get(FileService);
  const previews = app.get(PreviewService);

  if (process.argv.includes("--health-check")) {
    try {
      await database.ping();
      logger.log("worker 健康检查通过：PG 连通（骨架阶段无投递任务）");
      await app.close();
      process.exit(0);
    } catch (error) {
      logger.error("worker 健康检查失败：" + (error instanceof Error ? error.message : String(error)));
      await app.close();
      process.exit(1);
    }
  }

  logger.log(
    "worker 已启动（已接入上传会话过期清理 / 回收站到期清理 / 预览转换队列；通用 Outbox 投递 / 调度 / 规则随后续卡片接入）",
  );
  const heartbeat = setInterval(() => logger.log("worker heartbeat"), HEARTBEAT_MS);

  const sweepUploads = async (): Promise<void> => {
    try {
      const result = await files.sweepExpiredSessions();
      if (result.scanned > 0) {
        logger.log("上传会话过期清理：扫描 " + result.scanned + " 个 / 清理 " + result.expired + " 个");
      }
    } catch (error) {
      logger.error("上传会话过期清理失败：" + (error instanceof Error ? error.message : String(error)));
    }
  };
  const sweep = setInterval(() => void sweepUploads(), UPLOAD_SWEEP_INTERVAL_MS);
  void sweepUploads();

  const sweepRecycled = async (): Promise<void> => {
    try {
      const result = await files.sweepExpiredRecycled();
      if (result.scanned > 0) {
        logger.log("回收站到期清理：扫描 " + result.scanned + " 个 / 彻底删除 " + result.purged + " 个");
      }
    } catch (error) {
      logger.error("回收站到期清理失败：" + (error instanceof Error ? error.message : String(error)));
    }
  };
  const recycleSweep = setInterval(() => void sweepRecycled(), RECYCLE_SWEEP_INTERVAL_MS);
  void sweepRecycled();

  // 预览转换队列（M4-05c）：一轮最多领 OUTBOX_BATCH_LIMIT 条（默认 2），串行消费；
  // 单条最长占满客户端超时（默认 90s），用 draining 闸门避免上一轮没跑完就叠加下一轮。
  const previewEnabled = env.PREVIEW_JOB_ENABLED === "true";
  if (previewEnabled) {
    // 启动自检：转换器可达性 + 管线版本比对（不一致只会让任务按确定性失败降级，绝不写错缓存键 ——
    // 「换镜像必须递增 PREVIEW_PIPELINE_VERSION」，deploy/preview/README「四」）。
    const health = await previews.checkConverter();
    if (health.ok && health.versionMatches) {
      logger.log("预览转换器自检通过：" + health.detail);
    } else {
      logger.warn("预览转换器自检未通过（预览任务会降级为 failed，不影响其它任务）：" + health.detail);
    }
  } else {
    logger.warn("预览转换队列已关闭（PREVIEW_JOB_ENABLED=false）：preview.job 只投递不消费");
  }

  let draining = false;
  const drainPreviews = async (): Promise<void> => {
    if (draining) {
      return;
    }
    draining = true;
    try {
      const stats = await previews.drainOnce();
      if (stats.claimed > 0) {
        logger.log(
          "预览队列：领取 " + stats.claimed + " / 就绪 " + stats.ready + " / 复用 " + stats.reused + " / 重试 " +
            stats.retried + " / 放弃 " + stats.dead + " / 跳过 " + stats.skipped,
        );
      }
    } catch (error) {
      logger.error("预览队列领取失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      draining = false;
    }
  };
  const previewPoll = previewEnabled ? setInterval(() => void drainPreviews(), env.OUTBOX_POLL_MS) : null;
  if (previewPoll !== null) {
    void drainPreviews();
  }

  const shutdown = async (signal: string): Promise<void> => {
    clearInterval(heartbeat);
    clearInterval(sweep);
    clearInterval(recycleSweep);
    if (previewPoll !== null) {
      clearInterval(previewPoll);
    }
    logger.log("worker 收到 " + signal + "，正在退出");
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

await bootstrap();
