import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { DatabaseService } from "./database.service.js";
import type { DbClient } from "./db-client.js";
import { outboxEvents } from "./schema/platform.js";

/** 领取到的 Outbox 行（worker 消费用：只带消费需要的字段）。 */
export interface OutboxClaimedRow {
  id: number;
  topic: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  attempts: number;
  availableAt: Date;
  lockedAt: Date | null;
}

export interface ClaimOutboxInput {
  /** 允许领取的主题（一期只有预览队列用；空数组 = 不领任何行）。 */
  topics: readonly string[];
  limit: number;
  /** 超过该时长仍处 `processing` 的行视为崩溃遗留（migration 0028），可重新领取 —— 毫秒。 */
  staleAfterMs: number;
}

export interface OutboxRetryInput {
  /** 本次失败后的累计尝试次数（含本次）。 */
  attempts: number;
  /** 下次可领取时间（退避）。 */
  availableAt: Date;
  error: string | null;
}

/**
 * Outbox 领取 / 回写（M4-05c · Push 160 定案：领取器切片只落「领取 + 消费 + 重试 + dead」）。
 *
 * 领取是**单条语句**（`update ... from (select ... for update skip locked)`）：原子、不占长事务 ——
 * 预览转换最长 90s，绝不能把行锁握满整个转换时长。崩溃遗留由 `locked_at` 超阈值重领兜底（migration 0028）。
 *
 * 状态口径：`pending`（待领）→ `processing`（已领，有 locked_at）→ `done`（消费成功）/ `dead`（到顶或确定性放弃）；
 * 重试 = 回 `pending` 并把 `available_at` 推后（`attempts` 留痕，不新建事件）。
 */
@Injectable()
export class OutboxStore {
  constructor(private readonly database: DatabaseService) {}

  async claim(input: ClaimOutboxInput): Promise<OutboxClaimedRow[]> {
    if (input.topics.length === 0 || input.limit <= 0) {
      return [];
    }
    // 注意：drizzle 的 sql`` 模板会把 JS 数组**摊平成多个参数**（`any($1::text[])` 会拿到单个元素 → 真机报
    // `malformed array literal`），所以主题清单要显式拼成 `in ($1, $2)`（sql.join 的每一项仍是绑定参数，不拼字符串）。
    const topics = sql.join(
      input.topics.map((topic) => sql`${topic}`),
      sql`, `,
    );
    const result = await this.database.db.execute(sql`
      with claimed as (
        select id
          from outbox_events
         where topic in (${topics})
           and (
             (status = 'pending' and available_at <= now())
             or (status = 'processing' and locked_at is not null
                 and locked_at < now() - ${input.staleAfterMs}::int * interval '1 millisecond')
           )
         order by id
         limit ${input.limit}
         for update skip locked
      )
      update outbox_events as e
         set status = 'processing', locked_at = now()
        from claimed
       where e.id = claimed.id
      returning e.id, e.topic, e.payload, e.dedupe_key, e.attempts, e.available_at, e.locked_at
    `);
    return (result.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: Number(row.id),
      topic: String(row.topic),
      payload: (row.payload ?? {}) as Record<string, unknown>,
      dedupeKey: String(row.dedupe_key),
      attempts: Number(row.attempts),
      availableAt: new Date(row.available_at as string | number | Date),
      lockedAt: row.locked_at ? new Date(row.locked_at as string | number | Date) : null,
    }));
  }

  /** 消费成功：不再重投（同 dedupeKey 的后续投递只在 dead 时才唤醒，见 appendOutboxIfAbsent）。 */
  async markDone(id: number, client: DbClient = this.database.db): Promise<void> {
    await client
      .update(outboxEvents)
      .set({ status: "done", lockedAt: null, lastError: null })
      .where(eq(outboxEvents.id, id));
  }

  /** 可重试失败：回 `pending` 并推后 `available_at`（退避），`attempts` 累计。 */
  async markRetry(id: number, input: OutboxRetryInput, client: DbClient = this.database.db): Promise<void> {
    await client
      .update(outboxEvents)
      .set({
        status: "pending",
        attempts: input.attempts,
        availableAt: input.availableAt,
        lockedAt: null,
        lastError: input.error,
      })
      .where(eq(outboxEvents.id, id));
  }

  /** 到顶 / 确定性放弃：`dead` 留痕（`last_error` 记最后一次原因）。 */
  async markDead(
    id: number,
    input: { attempts: number; error: string },
    client: DbClient = this.database.db,
  ): Promise<void> {
    await client
      .update(outboxEvents)
      .set({ status: "dead", attempts: input.attempts, lockedAt: null, lastError: input.error })
      .where(eq(outboxEvents.id, id));
  }
}
