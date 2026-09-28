import { Module } from "@nestjs/common";
import { ClockService } from "../../common/clock/clock.service.js";
import { IdentityModule } from "../identity/index.js";
import { NotifyController } from "./notify.controller.js";
import { NotifyRepository } from "./notify.repository.js";
import { NotifyService } from "./notify.service.js";

/**
 * notify 模块（平台 · S7-4 · j1 / M5-04 首刀）：站内信投递内核 —— outbox `notify.message` 消费 +
 * 合并（同人同时段）+ 免打扰（次日补发）+ 每人每日上限 + 收件箱读面 + 全量留档 + 通知偏好。
 * 依赖：identity（会话 / CSRF / 当前用户）—— 个人资源不做功能权限位、不写审计（先例 user_preferences / project_views）。
 * 装配：api 侧挂控制器（AppModule）；worker 侧经 OutboxModule 的消费注册表 + entry/worker.ts 的 flush 循环。
 */
@Module({
  imports: [IdentityModule],
  controllers: [NotifyController],
  providers: [NotifyRepository, NotifyService, ClockService],
  exports: [NotifyService],
})
export class NotifyModule {}
