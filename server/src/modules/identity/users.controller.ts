import { Body, Controller, Get, Patch, Query, UseGuards } from "@nestjs/common";
import {
  UserListQuerySchema,
  UserListResponseSchema,
  UserPreferencesUpdateBodySchema,
  z,
} from "@libiaolink/contracts";
import type { UserPreferences, UserPreferencesUpdateBody } from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CurrentActorId, SessionGuard } from "./auth.guard.js";
import { CsrfGuard } from "./csrf.guard.js";
import { UserPreferenceService } from "./user-preference.service.js";
import { UserService } from "./user.service.js";

type UserListQuery = z.infer<typeof UserListQuerySchema>;
type UserListResponse = z.infer<typeof UserListResponseSchema>;

/**
 * 用户域（A2 目录 · A4 / A24 偏好）：已登录全员可读；偏好只读写「自己」那一行（actorId 取自会话，不接受路径参数）。
 * 契约 shared/src/modules/users.ts（Push 49；偏好路径 A4 定案 · Push 42，落库 Push 169）。
 */
@Controller("api/v1/users")
@UseGuards(SessionGuard)
export class UsersController {
  constructor(
    private readonly users: UserService,
    private readonly preferences: UserPreferenceService,
  ) {}

  @Get()
  list(@Query(new ZodValidationPipe(UserListQuerySchema)) query: UserListQuery): Promise<UserListResponse> {
    return this.users.listUsers(query);
  }

  /** 读取当前用户偏好（任务表列显隐 / 常用筛选）：无行 = 默认值 + updatedAt null。 */
  @Get("me/preferences")
  getPreferences(@CurrentActorId() actorId: string): Promise<UserPreferences> {
    return this.preferences.get(actorId);
  }

  /** 更新当前用户偏好：PATCH 合并语义（只传变更键、数组键整体替换）；写路径带 CSRF。 */
  @Patch("me/preferences")
  @UseGuards(CsrfGuard)
  updatePreferences(
    @Body(new ZodValidationPipe(UserPreferencesUpdateBodySchema)) body: UserPreferencesUpdateBody,
    @CurrentActorId() actorId: string,
  ): Promise<UserPreferences> {
    return this.preferences.update(actorId, body);
  }
}
