/**
 * wecom_app（自建应用消息）数据访问（M5-03-3 · C2-07 / C5-03）。
 * 边界（ADR 架构检查）：notify 属 PLATFORM —— 本层不得 import identity 模块，直接读 `db/schema/identity.ts`
 * 的 users 表（表访问允许，先例 outbox/automation-subjects.ts）。
 * userid 口径（请 wmj 复核）：SSO 的 claims.name → users.username —— README「WeCom Provider `Use id as name`
 * 已开 → 令牌 name 就是企微 userid」（技术设计 v0.3 §3 曾注「一期不落 wecom_userid」；M5-03-4 真机实测最终确认）。
 * 留痕口径：每次尝试一行（0046 CHECK：非 sent 行必须带非空 error；sent ↔ sentAt 非空且 error 为空）。
 */
import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { users } from "../../db/schema/identity.js";
import { notifyDeliveries } from "../../db/schema/notify.js";

/** 应用消息收件人（userid 口径 = users.username）。 */
export interface WecomAppContact {
  id: string;
  username: string;
  status: string;
  removedAt: Date | null;
}

/** 投递留痕输入（服务层保证 CHECK 语义：sent ↔ sentAt 非空且 error 为空）。 */
export interface NotifyAppDeliveryInsert {
  outboxId: number | null;
  target: string;
  state: "sent" | "failed" | "deferred" | "dead";
  attempts: number;
  error: string | null;
  sentAt: Date | null;
}

@Injectable()
export class NotifyAppRepository {
  constructor(private readonly database: DatabaseService) {}

  /** 读收件人（不存在 = null；停用 / 软删由服务层判定）。 */
  async findContact(userId: string, client: DbClient = this.database.db): Promise<WecomAppContact | null> {
    const rows = await client
      .select({ id: users.id, username: users.username, status: users.status, removedAt: users.removedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 投递留痕（channel = wecom_app；一次尝试一行）。 */
  async insertDelivery(input: NotifyAppDeliveryInsert, client: DbClient = this.database.db): Promise<void> {
    await client.insert(notifyDeliveries).values({
      outboxId: input.outboxId,
      channel: "wecom_app",
      target: input.target,
      state: input.state,
      attempts: input.attempts,
      error: input.error,
      sentAt: input.sentAt,
    });
  }
}
