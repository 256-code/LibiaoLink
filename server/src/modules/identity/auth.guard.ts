import { createParamDecorator, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { AppError } from "../../common/errors/app-error.js";
import { parseCookieHeader } from "../../common/http/cookies.js";
import { SESSION_COOKIE } from "./auth.constants.js";
import { toMeUser, type MeUser } from "./me-user.js";
import { SessionService } from "./session.service.js";

/**
 * 请求级用户信息：user 与 /auth/me 同口径（id 为 Casdoor 侧标识）；actorId 为本库 users.id（uuid）。
 * 两者刻意分开：落库外键 / 审计字段（*_by uuid）只能用 actorId，展示与 SSO 侧对齐用 user。
 */
export type RequestWithUser = Request & { user?: MeUser; actorId?: string };

/** 会话守卫：校验 HttpOnly 会话 Cookie，并把用户挂到 request.user / request.actorId（业务写接口按需叠加 CsrfGuard）。 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = parseCookieHeader(request.headers.cookie)[SESSION_COOKIE];
    if (token === undefined || token === "") {
      throw new AppError("AUTH_REQUIRED", "未登录");
    }
    const resolved = await this.sessions.resolve(token);
    request.user = toMeUser(resolved.user);
    request.actorId = resolved.user.id;
    return true;
  }
}

/** 参数装饰器：取 SessionGuard 注入的当前用户（/auth/me 同口径）。 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): MeUser => {
  const request = context.switchToHttp().getRequest<RequestWithUser>();
  if (request.user === undefined) {
    throw new AppError("AUTH_REQUIRED", "未登录");
  }
  return request.user;
});

/** 参数装饰器：取当前用户在本库 users.id（uuid）——写审计 / 外键字段用这个，不要用 MeUser.id。 */
export const CurrentActorId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<RequestWithUser>();
  if (request.actorId === undefined) {
    throw new AppError("AUTH_REQUIRED", "未登录");
  }
  return request.actorId;
});
