import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { OUTBOX_SCHEDULER } from "@libiaolink/contracts";
import { loadEnv } from "../config/env.js";
import { DatabaseService } from "../db/database.service.js";
import { FileService, PreviewService } from "../modules/file/index.js";
import { JobScheduler, OutboxAlertProbe, OutboxDispatcher, OutboxRetention } from "../outbox/index.js";
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
  const dispatcher = app.get(OutboxDispatcher);
  const alerts = app.get(OutboxAlertProbe);
  const retention = app.get(OutboxRetention);
  const scheduler = app.get(JobScheduler);

  if (process.argv.includes("--health-check")) {
    try {
      await database.ping();
      logger.log("worker 健康检查通过：PG 连通（一次性检查，不启动常驻循环）");
      await app.close();
      process.exit(0);
    } catch (error) {
      logger.error("worker 健康检查失败：" + (error instanceof Error ? error.message : String(error)));
      await app.close();
      process.exit(1);
    }
  }

  logger.log(
    "worker 已启动（上传会话过期清理 / 回收站到期清理 / Outbox 运行时：领取消费 · 积压与死信告警 · done 行保留期清理 · 调度 tick（每分钟：cron 领取 + last_run_at 补发 + 单活锁；注册表为空 = 只存不跑））",
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

  // 预览转换器启动自检（M4-05c）：可达性 + 管线版本比对（不一致只会让任务按确定性失败降级，绝不写错缓存键 ——
  // 「换镜像必须递增 PREVIEW_PIPELINE_VERSION」，deploy/preview/README「四」）。
  // 关闭时预览不入消费注册表（OutboxModule）：preview.job 只投递不消费，属排障态。
  if (env.PREVIEW_JOB_ENABLED === "true") {
    const health = await previews.checkConverter();
    if (health.ok && health.versionMatches) {
      logger.log("预览转换器自检通过：" + health.detail);
    } else {
      logger.warn("预览转换器自检未通过（预览任务会降级为 failed，不影响其它任务）：" + health.detail);
    }
  } else {
    logger.warn("预览转换队列已关闭（PREVIEW_JOB_ENABLED=false）：preview.job 只投递不消费");
  }

  // Outbox 分派（S7-1）：一轮 = 按注册主题各领一批（每主题 OUTBOX_BATCH_LIMIT 条，SKIP LOCKED）后串行收敛；
  // 单条预览最长占满客户端超时（默认 90s），用 draining 闸门避免上一轮没跑完就叠加下一轮。
  let draining = false;
  const drainOutbox = async (): Promise<void> => {
    if (draining) {
      return;
    }
    draining = true;
    try {
      const stats = await dispatcher.drainOnce();
      if (stats.claimed > 0) {
        logger.log(
          "outbox 分派：领取 " + stats.claimed + " / done " + stats.done + " / 重试 " + stats.retried + " / 死信 " +
            stats.dead,
        );
      }
    } catch (error) {
      logger.error("outbox 分派失败：" + messageOf(error));
    } finally {
      draining = false;
    }
  };
  const outboxPoll = setInterval(() => void drainOutbox(), env.OUTBOX_POLL_MS);
  void drainOutbox();

  // 调度器（S7-3 · i11 / M5-02）：每分钟 tick（契约 OUTBOX_SCHEDULER.tickMs）——单活 advisory lock 选主，
  // 领取到期 jobs（SKIP LOCKED），窗口 (last_run_at, now] 按应执行清单补发；无生产者注册的 kind = 只存不跑。
  // 与分派循环同用 draining 闸门思路：上一 tick 未跑完不叠加（单条任务可能触发多条产出）。
  let scheduling = false;
  const tickScheduler = async (): Promise<void> => {
    if (scheduling) {
      return;
    }
    scheduling = true;
    try {
      const stats = await scheduler.tickOnce();
      if (stats.claimed > 0 || stats.failed > 0) {
        logger.log(
          "调度 tick：领取 " + stats.claimed + " / 执行 " + stats.executed + " / 失败 " + stats.failed + " / 产出 " +
            stats.produced,
        );
      }
    } catch (error) {
      logger.error("调度 tick 失败：" + messageOf(error));
    } finally {
      scheduling = false;
    }
  };
  const schedulerTick = setInterval(() => void tickScheduler(), OUTBOX_SCHEDULER.tickMs);
  void tickScheduler();

  // 积压 / 最老待领取 / 近期死信告警（ADR-005）；死信单条即时告警不依赖本循环（dispatcher 直发）。
  const probeAlerts = async (): Promise<void> => {
    try {
      await alerts.probeOnce();
    } catch (error) {
      logger.error("outbox 告警探针失败：" + messageOf(error));
    }
  };
  const alertProbe = setInterval(() => void probeAlerts(), env.OUTBOX_ALERT_INTERVAL_MS);
  void probeAlerts();

  // done 行保留期清理（ADR-005 约 90 天）：分批删除，内容与条数由 OutboxRetention 自记日志。
  const sweepOutbox = async (): Promise<void> => {
    try {
      await retention.sweepOnce();
    } catch (error) {
      logger.error("outbox done 行清理失败：" + messageOf(error));
    }
  };
  const retentionSweep = setInterval(() => void sweepOutbox(), env.OUTBOX_RETENTION_INTERVAL_MS);
  void sweepOutbox();

  const shutdown = async (signal: string): Promise<void> => {
    clearInterval(heartbeat);
    clearInterval(sweep);
    clearInterval(recycleSweep);
    clearInterval(outboxPoll);
    clearInterval(schedulerTick);
    clearInterval(alertProbe);
    clearInterval(retentionSweep);
    logger.log("worker 收到 " + signal + "，正在退出");
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

await bootstrap();
