import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { ProjectsController } from "./project.controller.js";
import { ProjectMemberRepository } from "./project-member.repository.js";
import { ProjectMemberService } from "./project-member.service.js";
import { ProjectRepository } from "./project.repository.js";
import { ProjectService } from "./project.service.js";

/** project 模块（领域 · h2）：项目主数据 CRUD（M2-01）、首页列表 / facets（M2-04）、成员名册（M2-05）。 */
@Module({
  imports: [IdentityModule],
  controllers: [ProjectsController],
  providers: [ProjectRepository, ProjectService, ProjectMemberRepository, ProjectMemberService],
  exports: [ProjectService, ProjectMemberService],
})
export class ProjectModule {}
