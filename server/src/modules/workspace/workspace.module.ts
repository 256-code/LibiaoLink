import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { PermissionModule } from "../permission/index.js";
import { WorkspaceController } from "./workspace.controller.js";
import { WorkspaceRepository } from "./workspace.repository.js";
import { WorkspaceService } from "./workspace.service.js";

/**
 * workspace 模块（领域 · M6-05 第一刀）：工作台聚合读面（我的任务 / 我的问题）。
 * 口径：跨项目个人读面（无项目路径参数）；记录级可见性经 permission 的 projectScope 出口；
 * 本模块只读 tasks / issues / projects / users（不改表）—— 跨模块写路径仍归各领域模块。
 * 已登记 check-boundaries 的 DOMAIN_MODULES（workspace 属领域模块，平台模块不得反依赖）。
 */
@Module({
  imports: [IdentityModule, PermissionModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceRepository, WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
