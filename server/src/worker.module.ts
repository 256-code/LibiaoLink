import { Module, type DynamicModule } from "@nestjs/common";
import { createLoggerModule } from "./common/logging/logger.module.js";
import { AppConfigModule } from "./config/config.module.js";
import type { Env } from "./config/env.js";
import { DatabaseModule } from "./db/db.module.js";
import { FileModule } from "./modules/file/index.js";
import { StorageModule } from "./storage/index.js";

/**
 * worker 进程：Outbox 投递 / 调度 / 规则执行 / 转换编排 / 导出。
 * 已接入：上传会话过期清理（M4-01 定时档，见 entry/worker.ts）；Outbox 投递与预览编排随 M4-05 / M7 接入。
 */
@Module({})
export class WorkerModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: WorkerModule,
      imports: [createLoggerModule(env), AppConfigModule.forRoot(env), DatabaseModule, StorageModule, FileModule],
    };
  }
}
