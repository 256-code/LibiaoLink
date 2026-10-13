/**
 * 限速计数落库实现（M5-03-2 接线段 · S8-1「限速桶（DB 计数）」差异登记①收口）：
 * bucket / window_start 单语句 upsert —— 先增量后判定、跨进程并发安全（多 worker / 多实例共享配额）。
 * 计数语义与 `InMemoryRateWindowStore` 同形（`RateWindowStore` 端口）：返回**含本次**的窗口计数，
 * 由 `WecomRateLimiter` 判定放行 / 拒绝；窗口起点由调用方按 epoch 对齐后传入。
 * 过期窗口行由运维 / 后续清理作业按 `updated_at` 裁剪（迁移 0046 头注）。
 */
import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import { notifyRateCounters } from "../../db/schema/notify.js";
import type { RateWindowStore } from "./wecom.rate.js";

@Injectable()
export class PgRateWindowStore implements RateWindowStore {
  constructor(private readonly database: DatabaseService) {}

  async consume(bucket: string, windowStartMs: number): Promise<number> {
    const rows = await this.database.db
      .insert(notifyRateCounters)
      .values({ bucket, windowStart: new Date(windowStartMs), count: 1 })
      .onConflictDoUpdate({
        target: [notifyRateCounters.bucket, notifyRateCounters.windowStart],
        set: { count: sql`${notifyRateCounters.count} + 1`, updatedAt: sql`now()` },
      })
      .returning({ count: notifyRateCounters.count });
    const row = rows[0];
    if (row === undefined) {
      throw new Error("notify_rate_counters upsert 未返回记录");
    }
    return row.count;
  }
}