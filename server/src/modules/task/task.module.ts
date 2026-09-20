import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { PermissionModule } from "../permission/index.js";
import { TaskController } from "./task.controller.js";
import { TaskRepository } from "./task.repository.js";
import { TaskService } from "./task.service.js";
import { TaskStatsService } from "./task.stats.js";

/**
 * task 模块（领域 · h4）：任务主数据（M3-01 列表 / 详情）、进度与状态（M3-02）、项目总览四格；
 * 统计出口（TaskStatsService）供 node 门禁复用；不依赖 project / node，避免循环（project → node → task）。
 */
@Module({
  imports: [IdentityModule, PermissionModule],
  controllers: [TaskController],
  providers: [TaskRepository, TaskService, TaskStatsService],
  exports: [TaskService, TaskStatsService],
})
export class TaskModule {}
