import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { loadEnv } from "../config/env.js";
import { DatabaseService } from "../db/database.service.js";
import { WorkerModule } from "../worker.module.js";

const HEARTBEAT_MS = 60_000;

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  const database = app.get(DatabaseService);

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

  logger.log("worker 已启动（骨架阶段；Outbox 投递 / 调度 / 规则 / 转换编排随后续卡片接入）");
  const heartbeat = setInterval(() => logger.log("worker heartbeat"), HEARTBEAT_MS);

  const shutdown = async (signal: string): Promise<void> => {
    clearInterval(heartbeat);
    logger.log("worker 收到 " + signal + "，正在退出");
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

await bootstrap();
