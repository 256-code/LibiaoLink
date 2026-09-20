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
