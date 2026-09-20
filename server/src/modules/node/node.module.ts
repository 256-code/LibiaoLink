import { Module } from "@nestjs/common";
import { TaskModule } from "../task/index.js";
import { GateRepository } from "./gate.repository.js";
import { GateService } from "./gate.service.js";

/** node 模块（领域 · h3 / h4）：门禁判定唯一出口（GateService）；任务计数经 task 模块出口，流程实例读写收在 project 聚合，避免双向依赖。 */
@Module({
  imports: [TaskModule],
  providers: [GateRepository, GateService],
  exports: [GateService],
})
export class NodeModule {}
