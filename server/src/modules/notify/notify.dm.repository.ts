/**
 * wecom_aibot（智能机器人单聊）数据访问（M5-03-5-3 · 计划 §3.2 ~ §3.5 / D4）。
 * 边界（ADR 架构检查）：notify 属 PLATFORM —— 本层不得 import identity 模块，直接读 `db/schema/identity.ts`
 * 的 users 表（表访问允许，先例 notify.app.repository.ts / outbox/automation-subjects.ts）。
 * userid 口径（同 app 面）：SSO 的 claims.name → users.username（M5-03-4 真机实测最终确认）。
 * 激活表口径（0048 · M5-03-5-2）：wecom_userid = 回调 from.userid 原文唯一；user_id 可空（未匹配 / 尚未
 * 回填）；first_activated_at 首次不覆盖、last_message_at 随回调 upsert 刷新（语义 = 用户消息时刻）；
 * 发送成功旁证回填（D4）只补 user_id / updated_at，不动 last_message_at。
 * 留痕口径：每次尝试一行（0046 CHECK：非 sent 行必须带非空 error；sent ↔ sentAt 非空且 error 为空）。
 */
import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { users } from "../../db/schema/identity.js";
import { notifyDeliveries, wecomAibotDmActivations } from "../../db/schema/notify.js";

/** 单聊收件人（userid 口径 = users.username，同 app 面）。 */
export interface WecomDmContact {
  id: string;
  username: string;
  status: string;
  removedAt: Date | null;
}

/** 激活行（846607 分流 / 旁证回填判重读面）。 */
export interface DmActivationRow {
  wecomUserid: string;
  userId: string | null;
  firstActivatedAt: Date;
  lastMessageAt: Date;
}

/** 投递留痕输入（服务层保证 CHECK 语义：sent ↔ sentAt 非空且 error 为空）。 */
export interface NotifyDmDeliveryInsert {
  outboxId: number | null;
  target: string;
  state: "sent" | "failed" | "deferred" | "dead";
  attempts: number;
  error: string | null;
  sentAt: Date | null;
}

@Injectable()
export class NotifyDmRepository {
  constructor(private readonly database: DatabaseService) {}

  /** 读收件人（不存在 = null；停用 / 软删由服务层判定）。 */
  async findContact(userId: string, client: DbClient = this.database.db): Promise<WecomDmContact | null> {
    const rows = await client
      .select({ id: users.id, username: users.username, status: users.status, removedAt: users.removedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 按 userid 反查本地用户（回调 ingest 回填用；username 唯一，未匹配 = null）。 */
  async findUserIdByUsername(username: string, client: DbClient = this.database.db): Promise<string | null> {
    const rows = await client.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    return rows[0]?.id ?? null;
  }

  /** 激活态读（846607 分流 / 旁证回填判重）：按 wecom_userid 命中 = 已登记激活。 */
  async findActivation(wecomUserid: string, client: DbClient = this.database.db): Promise<DmActivationRow | null> {
    const rows = await client
      .select({
        wecomUserid: wecomAibotDmActivations.wecomUserid,
        userId: wecomAibotDmActivations.userId,
        firstActivatedAt: wecomAibotDmActivations.firstActivatedAt,
        lastMessageAt: wecomAibotDmActivations.lastMessageAt,
      })
      .from(wecomAibotDmActivations)
      .where(eq(wecomAibotDmActivations.wecomUserid, wecomUserid))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * 回调 ingest（计划 §3.2）：用户消息（cmd=aibot_msg_callback · chattype=single）→ upsert（幂等）——
   * 新建或刷新 last_message_at；first_activated_at 首次后不覆盖；user_id 未填时尝试回填（已填不覆盖）。
   */
  async upsertActivationFromCallback(
    input: { wecomUserid: string; userId: string | null; at: Date },
    client: DbClient = this.database.db,
  ): Promise<void> {
    await client
      .insert(wecomAibotDmActivations)
      .values({
        wecomUserid: input.wecomUserid,
        userId: input.userId,
        firstActivatedAt: input.at,
        lastMessageAt: input.at,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .onConflictDoUpdate({
        target: wecomAibotDmActivations.wecomUserid,
        set: {
          lastMessageAt: input.at,
          updatedAt: input.at,
          userId: sql`coalesce(${wecomAibotDmActivations.userId}, ${input.userId})`,
        },
      });
  }

  /**
   * 发送成功旁证回填（D4）：行缺失 → 新建（first / last 都记回填时刻，语义 =「已知激活时刻」近似 ——
   * 表内不区分来源，登记为已知近似）；行已存在 → 只补 user_id / updated_at（不动 last_message_at）。
   */
  async backfillActivationOnSend(
    input: { wecomUserid: string; userId: string; at: Date },
    client: DbClient = this.database.db,
  ): Promise<void> {
    await client
      .insert(wecomAibotDmActivations)
      .values({
        wecomUserid: input.wecomUserid,
        userId: input.userId,
        firstActivatedAt: input.at,
        lastMessageAt: input.at,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .onConflictDoUpdate({
        target: wecomAibotDmActivations.wecomUserid,
        set: {
          userId: sql`coalesce(${wecomAibotDmActivations.userId}, ${input.userId})`,
          updatedAt: input.at,
        },
      });
  }

  /** 投递留痕（channel = wecom_aibot；一次尝试一行）。 */
  async insertDelivery(input: NotifyDmDeliveryInsert, client: DbClient = this.database.db): Promise<void> {
    await client.insert(notifyDeliveries).values({
      outboxId: input.outboxId,
      channel: "wecom_aibot",
      target: input.target,
      state: input.state,
      attempts: input.attempts,
      error: input.error,
      sentAt: input.sentAt,
    });
  }
}