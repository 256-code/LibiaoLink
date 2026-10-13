import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { DbClient } from "../../db/db-client.js";
import { NOTIFY_STREAM_CHANNEL, type NotifyStreamWireMessage } from "./notify.stream.js";

/**
 * SSE 广播发布器（S8-3 · M5-04-1 实现刀）：写方在**业务事务内** `pg_notify`（通道 `notify_stream`）。
 *
 * PG 语义：通知随事务提交才广播、事务回滚零可见 —— 因此发布与落库必须同事务（入参即 tx 客户端，
 * 事务外发布是 bug：会绕开「回滚不发」的原子性）；多实例 api 各自 LISTEN 后桥到本地连接。
 * 同事务内先发 `notification`（新投递）再发 `unread`（角标）—— PG 按发出顺序投递，客户端先见通知后见角标。
 */
@Injectable()
export class NotifyStreamPublisher {
  async publish(client: DbClient, message: NotifyStreamWireMessage): Promise<void> {
    await client.execute(sql`select pg_notify(${NOTIFY_STREAM_CHANNEL}, ${JSON.stringify(message)})`);
  }
}
