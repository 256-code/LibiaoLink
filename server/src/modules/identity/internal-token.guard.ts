import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { AppError } from "../../common/errors/app-error.js";
import { AppConfig } from "../../config/config.module.js";

/** 内部作业接口凭证头（docs/开发者接入注意事项(SSO接入标准).md 第五部分）。 */
export const INTERNAL_TOKEN_HEADER = "x-internal-token";

/** 常量时间比较：任一侧为空即失败（空 token 配置 = 未启用，一律拒绝；生产启动已强制非空）。 */
export function matchesInternalToken(provided: string, expected: string): boolean {
  if (provided === "" || expected === "") return false;
  const given = Buffer.from(provided, "utf8");
  const want = Buffer.from(expected, "utf8");
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}

/** 内部端点守卫：校验 X-Internal-Token；缺失 / 不匹配一律 401（接入标准「无凭证调用 401」）。 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = headerValue(request.headers[INTERNAL_TOKEN_HEADER]);
    if (!matchesInternalToken(provided, this.config.env.INTERNAL_SYNC_TOKEN)) {
      throw new AppError("AUTH_REQUIRED", "内部调用凭证缺失或无效");
    }
    return true;
  }
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
