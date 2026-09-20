import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { ProjectsController } from "./project.controller.js";
import { ProjectRepository } from "./project.repository.js";
import { ProjectService } from "./project.service.js";

/** project 模块（领域 · h2）：项目主数据 CRUD（M2-01）与首页列表 / facets（M2-04）。 */
@Module({
  imports: [IdentityModule],
  controllers: [ProjectsController],
  providers: [ProjectRepository, ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
