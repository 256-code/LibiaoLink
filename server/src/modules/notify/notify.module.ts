import { Module } from "@nestjs/common";
import { ClockService } from "../../common/clock/clock.service.js";
import { IdentityModule } from "../identity/index.js";
import { NotifyController } from "./notify.controller.js";
import { NotifyRepository } from "./notify.repository.js";
import { NotifyService } from "./notify.service.js";
import { NotifyStreamPublisher } from "./notify.stream.publisher.js";
import { NotifyStreamService } from "./notify.stream.service.js";

/**
 * notify 模块（平台 · S7-4 · j1 / M5-04 首刀）：站内信投递内核 —— outbox `notify.message` 消费 +
 * 合并（同人同时段）+ 免打扰（次日补发）+ 每人每日上限 + 收件箱读面 + 全量留档 + 通知偏好。
 * 依赖：identity（会话 / CSRF / 当前用户）—— 个人资源不做功能权限位、不写审计（先例 user_preferences / project_views）。
 * 装配：api 侧挂控制器（AppModule）；worker 侧经 OutboxModule 的消费注册表 + entry/worker.ts 的 flush 循环。
 * 实时流（S8-3 · M5-04-1）：`NotifyStreamService` 惰性 LISTEN（首个 SSE 连接建立才启动 —— worker 不建连接 → 不启动）；
 * `NotifyStreamPublisher` 供投递 / 标记在事务内 pg_notify（worker 写方同样生效，api 各实例桥到本地连接）。
 */
@Module({
  imports: [IdentityModule],
  controllers: [NotifyController],
  providers: [NotifyRepository, NotifyService, NotifyStreamPublisher, NotifyStreamService, ClockService],
  exports: [NotifyService],
})
export class NotifyModule {}
