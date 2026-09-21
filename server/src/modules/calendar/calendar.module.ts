import { Module } from "@nestjs/common";
import { ClockService } from "../../common/clock/clock.service.js";
import { AdminModule } from "../admin/index.js";
import { IdentityModule } from "../identity/index.js";
import { PermissionModule } from "../permission/index.js";
import { CalendarController } from "./calendar.controller.js";
import { CalendarRepository } from "./calendar.repository.js";
import { CalendarService } from "./calendar.service.js";

/**
 * calendar 模块（领域 · 横切 · h8 · S6·工作日历 · D5）：日历例外维护（D5-01）、顺延规则配置（D5-02）、
 * 顺延与 T-1/T+1 求值（D5-03）。
 * 依赖：identity（会话 / CSRF 守卫）、permission（calendar.manage 判定出口）、admin（AuditService 留痕，同事务）。
 * 边界：横切模块 —— 领域与平台模块都可经本模块 index.ts 复用日期求值（i8 规则引擎 / 任务提醒 / 应填未填清单）；
 * 本模块不反向依赖业务模块。时钟统一走 common 的 ClockService（v0.3 §4.7）。
 */
@Module({
  imports: [IdentityModule, PermissionModule, AdminModule],
  controllers: [CalendarController],
  providers: [CalendarRepository, CalendarService, ClockService],
  exports: [CalendarService, ClockService],
})
export class CalendarModule {}
