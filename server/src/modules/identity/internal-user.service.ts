import { Injectable } from "@nestjs/common";
import { AppError } from "../../common/errors/app-error.js";
import { SessionService } from "./session.service.js";
import { UserRepository, type UserRow } from "./user.repository.js";

/** 离职回收三动作（docs/开发者接入注意事项(SSO接入标准).md 第五部分）。 */
export type InternalUserAction = "disable" | "enable" | "delete";

export interface InternalUserActionInput {
  name: string | null;
  email: string | null;
}

/** 内部离职回收响应：接入标准约定字段（ok / name / action / affectedSessions）。 */
export interface InternalUserActionResponse {
  ok: true;
  name: string;
  action: InternalUserAction;
  affectedSessions: number;
}

/**
 * 离职回收（h1 · D1-02 闭环）：disable / enable / delete 三动作。
 * - 定位：name 为准（username），email 兜底（大小写不敏感）；两者至少一个，全缺 400。
 * - 幂等：目录中不存在（或已删除）的用户一律 200，affectedSessions = 0（自动化可重试）。
 * - 副作用：disable / delete 必须踢掉该用户全部在线会话；enable 不恢复旧会话（安全默认）。
 * - delete 语义：置 status = disabled + removed_at（软删，不物理删行）；复职走 enable（清 removed_at）。
 */
@Injectable()
export class InternalUserService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionService,
  ) {}

  async execute(action: InternalUserAction, input: InternalUserActionInput): Promise<InternalUserActionResponse> {
    if (input.name === null && input.email === null) {
      throw new AppError("VALIDATION_FAILED", "name 与 email 至少提供一个");
    }
    const target = await this.resolveUser(input);
    if (target === null) {
      return { ok: true, name: input.name ?? "", action, affectedSessions: 0 };
    }
    const now = new Date();
    if (action === "disable") {
      await this.users.updateInternalState(target.id, { status: "disabled" }, now);
      return { ok: true, name: target.username, action, affectedSessions: await this.sessions.revokeAllForUser(target.id) };
    }
    if (action === "enable") {
      await this.users.updateInternalState(target.id, { status: "active", removedAt: null }, now);
      return { ok: true, name: target.username, action, affectedSessions: 0 };
    }
    await this.users.updateInternalState(target.id, { status: "disabled", removedAt: now }, now);
    return { ok: true, name: target.username, action, affectedSessions: await this.sessions.revokeAllForUser(target.id) };
  }

  private async resolveUser(input: InternalUserActionInput): Promise<UserRow | null> {
    if (input.name !== null) {
      const byName = await this.users.findByUsername(input.name);
      if (byName !== null) return byName;
    }
    if (input.email !== null) {
      return this.users.findByEmail(input.email);
    }
    return null;
  }
}
