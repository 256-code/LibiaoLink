import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  NotificationListQuerySchema,
  NotificationMarkBodySchema,
  NotifyPrefsUpdateBodySchema,
  z,
  type Notification,
  type NotificationListQuery,
  type NotificationListResponse,
  type NotificationMarkAllReadResponse,
  type NotificationMarkBody,
  type NotifyPrefs,
  type NotifyPrefsUpdateBody,
} from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { NotifyService } from "./notify.service.js";

const notificationIdParam = new ZodValidationPipe(z.coerce.number().int().positive());

/**
 * 消息中心接口（S7-4 · j1 / M5-04 首刀）：契约 shared/src/modules/notifications.ts。
 * 根路径 /api/v1/notifications —— 个人资源（收件箱只属收件人）：无功能权限键；读 = 会话、写 = 会话 + CSRF；不写审计。
 * 路由顺序：静态段（prefs / mark-all-read）声明在 `:id` 之前（Nest 按声明顺序匹配，否则 PATCH /prefs 会被 `:id` 吞掉）。
 */
@Controller("api/v1/notifications")
@UseGuards(SessionGuard)
export class NotifyController {
  constructor(private readonly notify: NotifyService) {}

  /** 收件箱清单（C5-01 / C5-02）：状态 / 类型 / 关联对象 + 投递时刻区间 + 分页；随行未读角标。 */
  @Get()
  list(
    @Query(new ZodValidationPipe(NotificationListQuerySchema)) query: NotificationListQuery,
    @CurrentActorId() actorId: string,
  ): Promise<NotificationListResponse> {
    return this.notify.list(actorId, query);
  }

  /** 通知偏好（C2-09；生效值）。 */
  @Get("prefs")
  prefs(@CurrentActorId() actorId: string): Promise<NotifyPrefs> {
    return this.notify.getPrefs(actorId);
  }

  /** 更新通知偏好（局部更新；空更新 400）。 */
  @Patch("prefs")
  @UseGuards(CsrfGuard)
  updatePrefs(
    @Body(new ZodValidationPipe(NotifyPrefsUpdateBodySchema)) body: NotifyPrefsUpdateBody,
    @CurrentActorId() actorId: string,
  ): Promise<NotifyPrefs> {
    return this.notify.updatePrefs(actorId, body);
  }

  /** 全部标记已读（幂等；无未读时 updated=0）。 */
  @Post("mark-all-read")
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  markAllRead(@CurrentActorId() actorId: string): Promise<NotificationMarkAllReadResponse> {
    return this.notify.markAllRead(actorId);
  }

  /** 标记状态（未读 / 已读 / 已处理；幂等）：他人 / 合并子行 / 未投递行统一 404。 */
  @Patch(":id")
  @UseGuards(CsrfGuard)
  mark(
    @Param("id", notificationIdParam) id: number,
    @Body(new ZodValidationPipe(NotificationMarkBodySchema)) body: NotificationMarkBody,
    @CurrentActorId() actorId: string,
  ): Promise<Notification> {
    return this.notify.mark(actorId, id, body.status);
  }
}
