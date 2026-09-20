import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { BlueprintController } from "./blueprint.controller.js";
import { BlueprintRepository } from "./blueprint.repository.js";
import { BlueprintService } from "./blueprint.service.js";

/** blueprint 模块（领域 · h3）：蓝图按项目类型版本化（ADR-019）、校验、导出 / 导入、建项目快照来源。 */
@Module({
  imports: [IdentityModule],
  controllers: [BlueprintController],
  providers: [BlueprintRepository, BlueprintService],
  exports: [BlueprintService],
})
export class BlueprintModule {}
