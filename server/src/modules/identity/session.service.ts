import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { AppError } from "../../common/errors/app-error.js";
import { AppConfig } from "../../config/config.module.js";
import { SessionRepository, type SessionWithUser } from "./session.repository.js";

const TOUCH_THROTTLE_MS = 60_000;

/** 会话令牌哈希（DB 中只存哈希；原始值仅存在于用户浏览器 Cookie）。 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * 会话用例：建立 / 校验（空闲超时 + 绝对上限 + 禁用踢线）/ 撤销。
 * 超时口径见 docs/开发者接入注意事项(SSO接入标准).md：应用侧自控，空闲时长取 SESSION_IDLE_MINUTES。
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly config: AppConfig,
    private readonly sessions: SessionRepository,
  ) {}

  get idleMs(): number {
    return this.config.env.SESSION_IDLE_MINUTES * 60_000;
  }

  async create(input: { userId: string; idToken: string; expiresAtSeconds: number }): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(input.expiresAtSeconds * 1000);
    const row = await this.sessions.insert({
      tokenHash: hashToken(token),
      userId: input.userId,
      idToken: input.idToken,
      expiresAt,
    });
    return { token, expiresAt: row.expiresAt };
  }

  /** 校验会话（无效 / 超时 / 禁用一律 AUTH_REQUIRED，前端据此重新走 SSO）；命中后按节流刷新 last_seen_at。 */
  async resolve(token: string): Promise<SessionWithUser> {
    const found = await this.sessions.findWithUserByHash(hashToken(token));
    if (found === null) {
      throw new AppError("AUTH_REQUIRED", "会话无效，请重新登录");
    }
    const now = Date.now();
    if (found.session.revokedAt !== null) {
      throw new AppError("AUTH_REQUIRED", "会话已失效，请重新登录");
    }
    if (found.session.expiresAt.getTime() <= now) {
      await this.sessions.revokeById(found.session.id, new Date(now));
      throw new AppError("AUTH_REQUIRED", "会话已过期，请重新登录");
    }
    if (now - found.session.lastSeenAt.getTime() > this.idleMs) {
      await this.sessions.revokeById(found.session.id, new Date(now));
      throw new AppError("AUTH_REQUIRED", "会话空闲超时，请重新登录");
    }
    if (found.user.status !== "active") {
      await this.sessions.revokeAllForUser(found.user.id, new Date(now));
      throw new AppError("AUTH_REQUIRED", "账号不可用，请联系管理员");
    }
    if (now - found.session.lastSeenAt.getTime() >= TOUCH_THROTTLE_MS) {
      await this.sessions.touch(found.session.id, new Date(now));
    }
    return found;
  }

  /** 撤销会话并返回 id_token（用于 Casdoor 单点登出）；无会话返回 null。 */
  async revoke(token: string): Promise<string | null> {
    const found = await this.sessions.findWithUserByHash(hashToken(token));
    if (found === null) {
      return null;
    }
    if (found.session.revokedAt === null) {
      await this.sessions.revokeById(found.session.id, new Date());
    }
    return found.session.idToken;
  }

  /** 踢掉某用户全部在线会话（管理动作 / h1 组织同步复用）。 */
  async revokeAllForUser(userId: string): Promise<number> {
    return this.sessions.revokeAllForUser(userId, new Date());
  }
}
