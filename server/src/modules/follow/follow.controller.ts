import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import {
  FollowBatchBodySchema,
  FollowCreateBodySchema,
  FollowListQuerySchema,
  FollowObjectTypeSchema,
  UuidSchema,
  type FollowBatchBody,
  type FollowBatchResponse,
  type FollowCreateBody,
  type FollowCreateResponse,
  type FollowDeleteResponse,
  type FollowListQuery,
  type FollowListResponse,
  type FollowObjectType,
} from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { FollowService } from "./follow.service.js";

const idParam = new ZodValidationPipe(UuidSchema);
const objectTypeParam = new ZodValidationPipe(FollowObjectTypeSchema);

/**
 * 关注接口（M2-06 首刀 · A1-15）：契约 shared/src/modules/follows.ts。
 * 根路径 /api/v1/follows —— 个人资源（关注是「我」的关系行）：无功能权限键；读 = 会话、写 = 会话 + CSRF；不写审计。
 * 创建动态状态：新建 = 201、已关注幂等 = 200（契约 FollowCreateResponse.created）；批量恒 200（失败明细内联）。
 */
@Controller("api/v1/follows")
@UseGuards(SessionGuard)
export class FollowController {
  constructor(private readonly follows: FollowService) {}

  /** 我的关注清单（按对象类型 / 对象 / 项目过滤；不可见或已删对象不返回）。 */
  @Get()
  list(@Query(new ZodValidationPipe(FollowListQuerySchema)) query: FollowListQuery, @CurrentActorId() actorId: string): Promise<FollowListResponse> {
    return this.follows.list(actorId, query);
  }

  /** 关注（目标须可见且未删除；重复关注幂等）。 */
  @Post()
  @UseGuards(CsrfGuard)
  async create(
    @Body(new ZodValidationPipe(FollowCreateBodySchema)) body: FollowCreateBody,
    @CurrentActorId() actorId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FollowCreateResponse> {
    const result = await this.follows.create(actorId, body);
    response.status(result.created ? 201 : 200);
    return result;
  }

  /** 批量关注 / 取关（1 ' 50 条；单事务逐条独立，部分失败不影响其它条目）。 */
  @Post("batch")
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  batch(
    @Body(new ZodValidationPipe(FollowBatchBodySchema)) body: FollowBatchBody,
    @CurrentActorId() actorId: string,
  ): Promise<FollowBatchResponse> {
    return this.follows.batch(actorId, body);
  }

  /** 取关（按关系键删除，不校验目标是否存在 / 可见；未关注 404）。 */
  @Delete(":objectType/:objectId")
  @UseGuards(CsrfGuard)
  remove(
    @Param("objectType", objectTypeParam) objectType: FollowObjectType,
    @Param("objectId", idParam) objectId: string,
    @CurrentActorId() actorId: string,
  ): Promise<FollowDeleteResponse> {
    return this.follows.remove(actorId, objectType, objectId);
  }
}
