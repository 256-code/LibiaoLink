import { Module, type DynamicModule } from "@nestjs/common";
import { createLoggerModule } from "./common/logging/logger.module.js";
import { AppConfigModule } from "./config/config.module.js";
import type { Env } from "./config/env.js";
import { DatabaseModule } from "./db/db.module.js";

/** worker 进程：Outbox 投递 / 调度 / 规则执行 / 转换编排 / 导出（骨架阶段只起进程与连通性）。 */
@Module({})
export class WorkerModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: WorkerModule,
      imports: [createLoggerModule(env), AppConfigModule.forRoot(env), DatabaseModule],
    };
  }
}
