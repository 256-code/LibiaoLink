import { Body, Controller, Get, HttpCode, Post, Put, Query, UseGuards } from "@nestjs/common";
import { BlueprintImportBodySchema, BlueprintQuerySchema, BlueprintSaveBodySchema, z } from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { BlueprintService } from "./blueprint.service.js";
import type { BlueprintView } from "./blueprint.service.js";
import type { Blueprint } from "./blueprint.validation.js";

type BlueprintQuery = z.infer<typeof BlueprintQuerySchema>;
type BlueprintSaveBody = z.infer<typeof BlueprintSaveBodySchema>;
type BlueprintImportBody = z.infer<typeof BlueprintImportBodySchema>;

/**
 * 蓝图接口（h3 · S6·blueprint/node）：契约 shared/src/modules/flow.ts。
 * 读接口登录即可读；写接口（保存 / 发布 / 导入）仅管理员（ADR-019 / ADR-020），actorId 为蓝图版本行的 published_by。
 */
@Controller("api/v1/blueprint")
@UseGuards(SessionGuard, CsrfGuard)
export class BlueprintController {
  constructor(private readonly blueprints: BlueprintService) {}

  /** 当前蓝图视图（编辑态 = 草稿；无未发布变更时 status = published）。 */
  @Get()
  view(@Query(new ZodValidationPipe(BlueprintQuerySchema)) query: BlueprintQuery): Promise<BlueprintView> {
    return this.blueprints.getView(query.projectType);
  }

  /** 保存草稿：校验失败 422（BLUEPRINT_SCHEMA_INVALID / BLUEPRINT_REF_UNKNOWN + 全量 issues）。 */
  @Put()
  save(
    @Query(new ZodValidationPipe(BlueprintQuerySchema)) query: BlueprintQuery,
    @Body(new ZodValidationPipe(BlueprintSaveBodySchema)) body: BlueprintSaveBody,
    @CurrentActorId() actorId: string,
  ): Promise<BlueprintView> {
    return this.blueprints.saveDraft(query.projectType, body.blueprint, actorId);
  }

  /** 发布：草稿无变更 → 幂等返回（不递增版本）；否则 published_version + 1（已生成项目不受影响）。 */
  @Post("publish")
  @HttpCode(200)
  publish(
    @Query(new ZodValidationPipe(BlueprintQuerySchema)) query: BlueprintQuery,
    @CurrentActorId() actorId: string,
  ): Promise<BlueprintView> {
    return this.blueprints.publish(query.projectType, actorId);
  }

  /** 导出（round-trip 无损）：已发布 payload 为正本；尚未发布时导出草稿。 */
  @Get("export")
  exportBlueprint(@Query(new ZodValidationPipe(BlueprintQuerySchema)) query: BlueprintQuery): Promise<Blueprint> {
    return this.blueprints.exportBlueprint(query.projectType);
  }

  /** 导入外部 JSON：保存为草稿（校验规则与保存一致；重复导入幂等）。 */
  @Post("import")
  @HttpCode(200)
  async importBlueprint(
    @Query(new ZodValidationPipe(BlueprintQuerySchema)) query: BlueprintQuery,
    @Body(new ZodValidationPipe(BlueprintImportBodySchema)) body: BlueprintImportBody,
    @CurrentActorId() actorId: string,
  ): Promise<BlueprintView> {
    return this.blueprints.importBlueprint(query.projectType, body.blueprint, actorId);
  }
}
