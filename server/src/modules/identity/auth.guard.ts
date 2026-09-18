import { createParamDecorator, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { AppError } from "../../common/errors/app-error.js";
import { parseCookieHeader } from "../../common/http/cookies.js";
import { SESSION_COOKIE } from "./auth.constants.js";
import { toMeUser, type MeUser } from "./me-user.js";
import { SessionService } from "./session.service.js";

/** 请求级用户信息（/auth/me 的 user 同口径；业务接口后续经 SessionGuard 注入）。 */
export type RequestWithUser = Request & { user?: MeUser };

/** 会话守卫：校验 HttpOnly 会话 Cookie，并把用户挂到 request.user（业务写接口按需叠加 CsrfGuard）。 */
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
    return true;
  }
}

/** 参数装饰器：取 SessionGuard 注入的当前用户。 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): MeUser => {
  const request = context.switchToHttp().getRequest<RequestWithUser>();
  if (request.user === undefined) {
    throw new AppError("AUTH_REQUIRED", "未登录");
  }
  return request.user;
});
