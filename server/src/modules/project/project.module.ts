import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/index.js";
import { BlueprintModule } from "../blueprint/index.js";
import { IdentityModule } from "../identity/index.js";
import { NodeModule } from "../node/index.js";
import { PermissionModule } from "../permission/index.js";
import { FlowController } from "./flow.controller.js";
import { FlowRepository } from "./flow.repository.js";
import { FlowService } from "./flow.service.js";
import { NodesController } from "./nodes.controller.js";
import { ProjectsController } from "./project.controller.js";
import { ProjectMemberRepository } from "./project-member.repository.js";
import { ProjectMemberService } from "./project-member.service.js";
import { ProjectRepository } from "./project.repository.js";
import { ProjectService } from "./project.service.js";

/**
 * project 模块（领域 · h2 / h3）：项目主数据 CRUD（M2-01）、列表 / facets（M2-04）、成员名册（M2-05）、
 * 流程实例与导入快照（M2-02）、节点增删与完成门禁（v0.2 §3.6）、阶段推进 / 回退（M2-03）。
 * 依赖方向：project → { blueprint, node(GateService), identity, permission(策略守卫) }（node 不反依赖 project，避免循环）。
 */
@Module({
  imports: [IdentityModule, BlueprintModule, NodeModule, PermissionModule, AdminModule],
  controllers: [ProjectsController, FlowController, NodesController],
  providers: [
    ProjectRepository,
    ProjectService,
    ProjectMemberRepository,
    ProjectMemberService,
    FlowRepository,
    FlowService,
  ],
  exports: [ProjectService, ProjectMemberService],
})
export class ProjectModule {}
