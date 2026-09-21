import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { loadEnv } from "../config/env.js";
import { DatabaseService } from "../db/database.service.js";
import { FileService } from "../modules/file/index.js";
import { WorkerModule } from "../worker.module.js";

const HEARTBEAT_MS = 60_000;
/** 上传会话过期清理周期（M4-01）：10 分钟一轮，启动即跑一次；失败只记日志不退出。 */
const UPLOAD_SWEEP_INTERVAL_MS = 10 * 60_000;

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

  logger.log("worker 已启动（已接入上传会话过期清理；Outbox 投递 / 调度 / 规则 / 转换编排随后续卡片接入）");
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

  const shutdown = async (signal: string): Promise<void> => {
    clearInterval(heartbeat);
    clearInterval(sweep);
    logger.log("worker 收到 " + signal + "，正在退出");
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

await bootstrap();
