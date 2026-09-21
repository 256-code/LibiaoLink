import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AUDIT_SINK } from "./common/audit/audit-sink.js";
import { ApiErrorFilter } from "./common/errors/api-error.filter.js";
import { createLoggerModule } from "./common/logging/logger.module.js";
import { AppConfigModule } from "./config/config.module.js";
import type { Env } from "./config/env.js";
import { DatabaseModule } from "./db/db.module.js";
import { HealthModule } from "./health/health.module.js";
import { AdminModule, AuditService } from "./modules/admin/index.js";
import { CalendarModule } from "./modules/calendar/index.js";
import { FileModule } from "./modules/file/index.js";
import { IdentityModule } from "./modules/identity/index.js";
import { PermissionModule } from "./modules/permission/index.js";
import { ProjectModule } from "./modules/project/index.js";
import { TaskModule } from "./modules/task/index.js";
import { StorageModule } from "./storage/index.js";

/** api 进程：HTTP 入口（无状态、不跑 CPU 密集任务）。 */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        createLoggerModule(env),
        AppConfigModule.forRoot(env),
        DatabaseModule,
        StorageModule,
        HealthModule,
        IdentityModule,
        PermissionModule,
        ProjectModule,
        TaskModule,
        AdminModule,
        CalendarModule,
        FileModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ApiErrorFilter },
        // 越权留痕出口：全局异常过滤器经 common 令牌调用 admin 的 AuditService（避免 common → modules 反向依赖）
        { provide: AUDIT_SINK, useExisting: AuditService },
      ],
    };
  }
}
