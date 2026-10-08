import { Module } from "@nestjs/common";
import { AuditRepository } from "./audit.repository.js";
import { AuditService } from "./audit.service.js";

/**
 * audit 模块（平台 · Push 173）：审计写入 / 检索出口（C7）自 admin 独立。
 * 依赖：无业务模块（只读 users.display_name 一列取操作人姓名快照）；领域与平台模块均可反向 import。
 * 独立原因：admin 模块依赖 identity 的会话 / CSRF 守卫，identity 又要写审计 —— 同模块会成环（check:boundaries 红线）。
 * 兼容：admin/index.ts 继续 re-export 本模块出口，既有调用方（project / task / file / calendar / template 等）零改动。
 */
@Module({
  providers: [AuditRepository, AuditService],
  exports: [AuditService],
})
export class AuditModule {}
