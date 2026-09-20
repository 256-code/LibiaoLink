import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { PermissionModule } from "../permission/index.js";
import { AuditLogsController } from "./audit.controller.js";
import { AuditRepository } from "./audit.repository.js";
import { AuditService } from "./audit.service.js";
import { DictRepository } from "./dict.repository.js";
import { DictService } from "./dict.service.js";
import { DictsController } from "./dicts.controller.js";

/**
 * admin 模块（平台 · h7 · S6·admin）：字典（C9）与操作审计（C7）。
 * 依赖：identity（会话 / CSRF 守卫）、permission（dict.manage / audit.view 的统一判定出口）。
 * 边界：平台模块不反依赖业务模块 —— 业务模块反向 import 本模块的 AuditService 注入留痕；
 * 越权留痕经 common 的 AUDIT_SINK 令牌由全局异常过滤器调用（common 不依赖 modules）。
 */
@Module({
  imports: [IdentityModule, PermissionModule],
  controllers: [DictsController, AuditLogsController],
  providers: [DictRepository, DictService, AuditRepository, AuditService],
  exports: [AuditService],
})
export class AdminModule {}
