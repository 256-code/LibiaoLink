import { Injectable } from "@nestjs/common";
import { AppError } from "../../common/errors/app-error.js";
import { DatabaseService } from "../../db/database.service.js";
import { AuditService } from "../audit/index.js";
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
 * - 留痕（Push 173）：三动作各写一条审计（objectType = user、entry = system、actorId = null —— 无人类操作人的系统动作），
 *   状态写入 / 会话撤销 / 审计同事务。
 */
@Injectable()
export class InternalUserService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly database: DatabaseService,
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
    const matchedBy = input.name !== null ? "name" : "email";
    const beforeStatus = target.status;
    const beforeRemovedAt = target.removedAt;
    if (action === "disable") {
      const affectedSessions = await this.database.db.transaction(async (tx) => {
        await this.users.updateInternalState(target.id, { status: "disabled" }, now, tx);
        const sessions = await this.sessions.revokeAllForUser(target.id, tx);
        await this.audit.record(tx, {
          actorId: null,
          action: "update",
          objectType: "user",
          objectId: target.id,
          entry: "system",
          summary: "离职回收 · 停用用户：" + target.displayName + "（" + target.username + "，撤销会话 " + sessions + " 个）",
          changes: beforeStatus === "disabled" ? null : [{ field: "status", from: beforeStatus, to: "disabled" }],
          metadata: { source: "internal_api", internalAction: "disable", matchedBy, affectedSessions: sessions },
        });
        return sessions;
      });
      return { ok: true, name: target.username, action, affectedSessions };
    }
    if (action === "enable") {
      await this.database.db.transaction(async (tx) => {
        await this.users.updateInternalState(target.id, { status: "active", removedAt: null }, now, tx);
        const changes = [
          ...(beforeStatus === "active" ? [] : [{ field: "status", from: beforeStatus, to: "active" }]),
          ...(beforeRemovedAt === null ? [] : [{ field: "removedAt", from: beforeRemovedAt.toISOString(), to: null }]),
        ];
        await this.audit.record(tx, {
          actorId: null,
          action: "update",
          objectType: "user",
          objectId: target.id,
          entry: "system",
          summary: "离职回收 · 复职启用用户：" + target.displayName + "（" + target.username + "）",
          changes: changes.length > 0 ? changes : null,
          metadata: { source: "internal_api", internalAction: "enable", matchedBy },
        });
      });
      return { ok: true, name: target.username, action, affectedSessions: 0 };
    }
    const affectedSessions = await this.database.db.transaction(async (tx) => {
      await this.users.updateInternalState(target.id, { status: "disabled", removedAt: now }, now, tx);
      const sessions = await this.sessions.revokeAllForUser(target.id, tx);
      const changes = [
        ...(beforeStatus === "disabled" ? [] : [{ field: "status", from: beforeStatus, to: "disabled" }]),
        { field: "removedAt", from: beforeRemovedAt === null ? null : beforeRemovedAt.toISOString(), to: now.toISOString() },
      ];
      await this.audit.record(tx, {
        actorId: null,
        action: "delete",
        objectType: "user",
        objectId: target.id,
        entry: "system",
        summary: "离职回收 · 删除用户（软删）：" + target.displayName + "（" + target.username + "，撤销会话 " + sessions + " 个）",
        changes,
        metadata: { source: "internal_api", internalAction: "delete", matchedBy, affectedSessions: sessions },
      });
      return sessions;
    });
    return { ok: true, name: target.username, action, affectedSessions };
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
