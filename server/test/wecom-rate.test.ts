/**
 * 企微限速桶回归（M5-03-1 · S8-1）：窗口计数 / 拒绝与 retryAt / 跨窗口重置 / 桶隔离 / 0=未启用 / 桶键摘要。
 */
import { describe, expect, it, vi } from "vitest";
import {
  InMemoryRateWindowStore,
  WecomRateLimiter,
  webhookBucketId,
  type RateWindowStore,
} from "../src/modules/notify/wecom.rate.js";

const WINDOW_MS = 60_000;

function makeLimiter(limits: { app: number; group: number }, store: RateWindowStore = new InMemoryRateWindowStore()) {
  return { limiter: new WecomRateLimiter({ store, windowMs: WINDOW_MS, limits }), store };
}

describe("企微限速桶（M5-03-1 · S8-1）", () => {
  it("窗口内放行至上限；第 limit+1 次拒绝并给出下一窗口 retryAt", async () => {
    const { limiter } = makeLimiter({ app: 0, group: 2 });
    const now = 1_000; // 窗口 [0, 60000)

    const first = await limiter.tryConsume("group", "abc", now);
    const second = await limiter.tryConsume("group", "abc", now);
    const third = await limiter.tryConsume("group", "abc", now);

    expect(first).toMatchObject({ ok: true, count: 1, limit: 2, bucket: "group:abc" });
    expect(second).toMatchObject({ ok: true, count: 2 });
    expect(third).toMatchObject({ ok: false, count: 3, limit: 2 });
    if (!third.ok) {
      expect(third.retryAt.getTime()).toBe(WINDOW_MS);
      expect(third.windowStart.getTime()).toBe(0);
    }
  });

  it("跨窗口重置：下一窗口重新计数", async () => {
    const { limiter } = makeLimiter({ app: 0, group: 1 });
    expect((await limiter.tryConsume("group", "abc", 1_000)).ok).toBe(true);
    expect((await limiter.tryConsume("group", "abc", 2_000)).ok).toBe(false);
    expect((await limiter.tryConsume("group", "abc", WINDOW_MS)).ok).toBe(true);
    expect((await limiter.tryConsume("group", "abc", WINDOW_MS + 1_000)).ok).toBe(false);
  });

  it("桶隔离：不同 webhook 摘要 / app 与 group 互不影响", async () => {
    const { limiter } = makeLimiter({ app: 1, group: 1 });
    expect((await limiter.tryConsume("group", "a", 0)).ok).toBe(true);
    expect((await limiter.tryConsume("group", "a", 0)).ok).toBe(false);
    expect((await limiter.tryConsume("group", "b", 0)).ok).toBe(true);
    expect((await limiter.tryConsume("app", "global", 0)).ok).toBe(true);
    expect((await limiter.tryConsume("app", "global", 0)).ok).toBe(false);
  });

  it("0 = 未启用：不触达计数存储、直接放行", async () => {
    const store: RateWindowStore = { consume: vi.fn(async () => 999) };
    const { limiter } = makeLimiter({ app: 0, group: 0 }, store);
    const decision = await limiter.tryConsume("app", "global", 1_000);
    expect(decision.ok).toBe(true);
    expect(store.consume).not.toHaveBeenCalled();
  });

  it("webhookBucketId：确定性 12 位十六进制摘要，不含 URL 明文", () => {
    const url = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret-key-123";
    const first = webhookBucketId(url);
    expect(first).toBe(webhookBucketId(url));
    expect(first).toMatch(/^[0-9a-f]{12}$/);
    expect(first).not.toContain("secret");
    expect(first).not.toContain("qyapi");
  });
});
