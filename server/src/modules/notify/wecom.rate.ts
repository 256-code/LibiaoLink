/**
 * 企微发送限速桶（M5-03-1 · S8-1：「限速桶（DB 计数）」）。
 *
 * 语义（进契约口径 · 实施方案 §五 处置三分类）：
 *   固定窗口 —— 窗口起点按 epoch 对齐到 windowMs 的整数倍；窗口内第 limit+1 次尝试 → 拒绝，
 *   `retryAt` = 下一窗口起点 —— 调用方据此**延期重排（不消耗 outbox 重试次数）**。
 *   数值按主题落 env（app 待 A5 实测回填；group = 群机器人文档值 20 条/分钟）；0 = 未启用（不计数、直接放行）。
 *
 * 计数存储 = `RateWindowStore` 端口：本刀交付内存实现（单测 / stub 回放）；**落库实现（DB 计数）随
 * `notify_deliveries` / 群绑定迁移接入（M5-03-2 / M5-03-3）** —— SQL 形态 = 单语句
 * `INSERT ... ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1 RETURNING count`
 * （先增量后判定，天然处理跨进程并发；桶键不含凭据明文）。
 */
import { createHash } from "node:crypto";

/** 计数端口：计数并返回该窗口内的新值（含本次）；落库 / 内存实现可替换。 */
export interface RateWindowStore {
  consume(bucket: string, windowStartMs: number): Promise<number>;
}

/** 内存计数（默认）：单进程范围 —— 单测 / stub 回放 / 单 worker 过渡期可用；多进程一致性由落库实现承担。 */
export class InMemoryRateWindowStore implements RateWindowStore {
  private readonly counters = new Map<string, number>();

  async consume(bucket: string, windowStartMs: number): Promise<number> {
    const key = bucket + "@" + String(windowStartMs);
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }
}

export type WecomRateKind = "app" | "group";

export type WecomRateDecision =
  | { ok: true; kind: WecomRateKind; bucket: string; windowStart: Date; count: number; limit: number }
  | { ok: false; kind: WecomRateKind; bucket: string; windowStart: Date; retryAt: Date; count: number; limit: number };

export interface WecomRateLimiterOptions {
  store: RateWindowStore;
  /** 窗口长度（毫秒）。 */
  windowMs: number;
  /** app / group 各自窗口内上限（0 = 未启用）。 */
  limits: { app: number; group: number };
  now?: () => number;
}

export class WecomRateLimiter {
  constructor(private readonly options: WecomRateLimiterOptions) {}

  /**
   * 发送前取额度：ok = 放行；拒绝 = 不发 HTTP，调用方按 retryAt 延期重排（不消耗重试次数）。
   * 未启用（limit 0）不触达计数存储。
   */
  async tryConsume(kind: WecomRateKind, bucketId: string, nowMs?: number): Promise<WecomRateDecision> {
    const current = nowMs ?? (this.options.now ?? Date.now)();
    const windowMs = this.options.windowMs;
    const windowStartMs = Math.floor(current / windowMs) * windowMs;
    const bucket = kind + ":" + bucketId;
    const limit = kind === "app" ? this.options.limits.app : this.options.limits.group;
    if (limit <= 0) {
      return { ok: true, kind, bucket, windowStart: new Date(windowStartMs), count: 0, limit };
    }
    const count = await this.options.store.consume(bucket, windowStartMs);
    if (count <= limit) {
      return { ok: true, kind, bucket, windowStart: new Date(windowStartMs), count, limit };
    }
    return {
      ok: false,
      kind,
      bucket,
      windowStart: new Date(windowStartMs),
      retryAt: new Date(windowStartMs + windowMs),
      count,
      limit,
    };
  }
}

/** 自建应用全局桶 id（token 面共享一个桶）。 */
export const WECOM_APP_BUCKET_ID = "global";

/** webhook 桶 id = URL 摘要（sha256 前 12 位十六进制）—— 计数键 / 日志均不出现 webhook 明文（等同凭据）。 */
export function webhookBucketId(webhookUrl: string): string {
  return createHash("sha256").update(webhookUrl).digest("hex").slice(0, 12);
}
