import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/index.js";
import { IdentityModule } from "../identity/index.js";
import { PermissionModule } from "../permission/index.js";
import { TaskNodeRepository } from "./task-node.repository.js";
import { TemplateController } from "./template.controller.js";
import { TemplateService } from "./template.service.js";

/**
 * template 模块（领域 · M3-05 余 · A1-16 / A1-17）：任务节点库（task_nodes）—— 任务模板页左列与
 * 「项目总览 → 添加任务」卡片的节点来源；可新增 / 删除（写 = blueprint.manage，仅管理员）。
 * 依赖：identity（会话 / CSRF / 当前用户）、permission（blueprint.manage 判定）、admin（审计留痕，同事务）。
 * 边界：不碰 tasks / project_nodes —— tasks.node_id 指向流程节点（project_nodes），节点库只回答「任务从哪来」；
 * 模板（TaskTemplate）读写随本域第二段落（契约已定：GET/POST/PATCH/DELETE /task-templates）。
 */
@Module({
  imports: [IdentityModule, PermissionModule, AdminModule],
  controllers: [TemplateController],
  providers: [TaskNodeRepository, TemplateService],
  exports: [TemplateService],
})
export class TemplateModule {}
