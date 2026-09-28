import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  UuidSchema,
  ViewCreateBodySchema,
  ViewListQuerySchema,
  ViewUpdateBodySchema,
  type SavedView,
  type ViewCreateBody,
  type ViewDeleteResponse,
  type ViewListQuery,
  type ViewListResponse,
  type ViewUpdateBody,
} from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { ViewService } from "./view.service.js";

const idParam = new ZodValidationPipe(UuidSchema);

/**
 * 视图接口（M2-06 首刀 · A1-03）：契约 shared/src/modules/views.ts。
 * 根路径 /api/v1/views —— 个人资源（视图是用户界面配置）：无功能权限键；读 = 会话、写 = 会话 + CSRF；不写审计。
 * 可见 / 可改：个人视图仅本人；公共视图全员可见、创建者可改（服务层判定：404 / 403）。
 */
@Controller("api/v1/views")
@UseGuards(SessionGuard)
export class ViewController {
  constructor(private readonly views: ViewService) {}

  /** 视图清单：默认我的个人视图 + 全部公共视图；scope 可过滤（个人在前）。 */
  @Get()
  list(@Query(new ZodValidationPipe(ViewListQuerySchema)) query: ViewListQuery, @CurrentActorId() actorId: string): Promise<ViewListResponse> {
    return this.views.list(actorId, query);
  }

  /** 新建视图（201）：仅保存配置；isDefault 置位时自动清掉本人其它默认。 */
  @Post()
  @HttpCode(201)
  @UseGuards(CsrfGuard)
  create(
    @Body(new ZodValidationPipe(ViewCreateBodySchema)) body: ViewCreateBody,
    @CurrentActorId() actorId: string,
  ): Promise<SavedView> {
    return this.views.create(actorId, body);
  }

  /** 更新视图（局部更新：只传变更键，空更新 400）：个人视图他人 404；公共视图非创建者 403。 */
  @Patch(":id")
  @UseGuards(CsrfGuard)
  update(
    @Param("id", idParam) id: string,
    @Body(new ZodValidationPipe(ViewUpdateBodySchema)) body: ViewUpdateBody,
    @CurrentActorId() actorId: string,
  ): Promise<SavedView> {
    return this.views.update(actorId, id, body);
  }

  /** 删除视图（物理删；归属校验同上）。 */
  @Delete(":id")
  @UseGuards(CsrfGuard)
  remove(@Param("id", idParam) id: string, @CurrentActorId() actorId: string): Promise<ViewDeleteResponse> {
    return this.views.remove(actorId, id);
  }
}
