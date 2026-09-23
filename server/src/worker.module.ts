import { Module, type DynamicModule } from "@nestjs/common";
import { createLoggerModule } from "./common/logging/logger.module.js";
import { AppConfigModule } from "./config/config.module.js";
import type { Env } from "./config/env.js";
import { DatabaseModule } from "./db/db.module.js";
import { FileModule } from "./modules/file/index.js";
import { StorageModule } from "./storage/index.js";

/**
 * worker 进程：Outbox 投递 / 调度 / 规则执行 / 转换编排 / 导出。
 * 已接入：上传会话过期清理（M4-01）、回收站到期清理（M4-02）、预览转换队列（M4-05c：outbox `preview.job`
 * 领取 + 消费 + 重试 + dead，见 entry/worker.ts 的轮询循环）；通用 Outbox 投递与规则编排随 M5 / M7 接入。
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
