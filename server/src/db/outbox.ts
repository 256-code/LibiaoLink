import { sql } from "drizzle-orm";
import { outboxEvents } from "./schema/platform.js";
import type { DbClient } from "./db-client.js";

export interface OutboxEventInput {
  topic: string;
  payload: Record<string, unknown>;
  /** 消费幂等键（unique）：状态变更事件用「实体 + 版本」，重试事件追加时间戳。 */
  dedupeKey: string;
}

/**
 * 同事务写 Outbox（v0.2 §1.3：外部副作用唯一出口，至少一次投递 + dedupe_key 幂等）。
 * 业务事务内调用；投递由 worker 承接（骨架阶段仅落行）。
 */
export async function appendOutbox(client: DbClient, event: OutboxEventInput): Promise<void> {
  await client.insert(outboxEvents).values({
    topic: event.topic,
    payload: event.payload,
    dedupeKey: event.dedupeKey,
    status: "pending",
  });
}

/**
 * 幂等投递（M4-05c 预览任务：「同一三元组只转一次」的投递侧落点）。
 *
 * - 同 `dedupeKey` 已存在：**不重复插入**（不覆盖已有进度）；
 * - 该行处于 `dead`：**重新唤醒**为 `pending`（重试次数归零、`last_error` 清空）——
 *   预览任务的 dead 只代表「这一轮重试到顶」，读取侧再次请求时应当可以重投（不是永久丢弃）。
 */
export async function appendOutboxIfAbsent(client: DbClient, event: OutboxEventInput): Promise<void> {
  await client
    .insert(outboxEvents)
    .values({
      topic: event.topic,
      payload: event.payload,
      dedupeKey: event.dedupeKey,
      status: "pending",
    })
    .onConflictDoUpdate({
      target: outboxEvents.dedupeKey,
      set: { status: "pending", availableAt: sql`now()`, attempts: 0, lastError: null },
      setWhere: sql`${outboxEvents.status} = 'dead'`,
    });
}
