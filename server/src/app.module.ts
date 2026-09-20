import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ApiErrorFilter } from "./common/errors/api-error.filter.js";
import { createLoggerModule } from "./common/logging/logger.module.js";
import { AppConfigModule } from "./config/config.module.js";
import type { Env } from "./config/env.js";
import { DatabaseModule } from "./db/db.module.js";
import { HealthModule } from "./health/health.module.js";
import { IdentityModule } from "./modules/identity/index.js";
import { ProjectModule } from "./modules/project/index.js";
import { TaskModule } from "./modules/task/index.js";

/** api 进程：HTTP 入口（无状态、不跑 CPU 密集任务）。 */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [createLoggerModule(env), AppConfigModule.forRoot(env), DatabaseModule, HealthModule, IdentityModule, ProjectModule, TaskModule],
      providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
    };
  }
}
