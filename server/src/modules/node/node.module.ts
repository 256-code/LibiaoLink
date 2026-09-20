import { Module } from "@nestjs/common";
import { GateRepository } from "./gate.repository.js";
import { GateService } from "./gate.service.js";

/** node 模块（领域 · h3）：门禁判定唯一出口（GateService）；流程实例读写收在 project 聚合，避免双向依赖。 */
@Module({
  providers: [GateRepository, GateService],
  exports: [GateService],
})
export class NodeModule {}
