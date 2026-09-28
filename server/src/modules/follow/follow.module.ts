import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { PermissionModule } from "../permission/index.js";
import { FollowController } from "./follow.controller.js";
import { FollowRepository } from "./follow.repository.js";
import { FollowService } from "./follow.service.js";

/**
 * follow 模块（领域 · M2-06 首刀 · A1-15）：关注订阅 —— 关注项目 / 任务、清单、批量关注 / 取关。
 * 依赖：identity（会话 / CSRF / 当前用户）、permission（项目级可见性，ADR-011）。不做功能权限位、不写审计。
 * 通知扇出随 M5（lan 线）；本模块只读写 follows 关系表。
 * 已登记 check-boundaries 的 DOMAIN_MODULES（follow 属领域模块，平台模块不得反依赖）。
 */
@Module({
  imports: [IdentityModule, PermissionModule],
  controllers: [FollowController],
  providers: [FollowRepository, FollowService],
  exports: [FollowService],
})
export class FollowModule {}
