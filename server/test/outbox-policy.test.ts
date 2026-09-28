import { describe, expect, it } from "vitest";
import type { Env } from "../src/config/env.js";
import {
  backoffDelayMs,
  defaultTopicPolicy,
  PREVIEW_BACKOFF_MAX_MS,
  previewTopicPolicy,
  resolveOutboxPolicies,
} from "../src/outbox/policy.js";

/** S7-1 主题策略门禁：缺省策略读 OUTBOX_DEFAULT_*、preview.job 沿用 PREVIEW_CONVERT_*、指数退避封顶。 */

const ENV = {
  OUTBOX_BATCH_LIMIT: 2,
  OUTBOX_DEFAULT_MAX_ATTEMPTS: 5,
  OUTBOX_DEFAULT_BACKOFF_BASE_MS: 15000,
  OUTBOX_DEFAULT_BACKOFF_MAX_MS: 1800000,
  PREVIEW_CONVERT_MAX_ATTEMPTS: 3,
  PREVIEW_CONVERT_BACKOFF_MS: 15000,
} as unknown as Env;

describe("outbox 主题策略（S7-1）", () => {
  it("缺省策略读 OUTBOX_DEFAULT_*（batchLimit 复用 OUTBOX_BATCH_LIMIT）", () => {
    expect(defaultTopicPolicy(ENV)).toEqual({
      batchLimit: 2,
      maxAttempts: 5,
      backoffBaseMs: 15000,
      backoffMaxMs: 1800000,
    });
  });

  it("preview.job 沿用 PREVIEW_CONVERT_*（attempts / backoff 与 M4-05c 同口径），退避封顶 30 分钟", () => {
    const policy = previewTopicPolicy({ ...ENV, PREVIEW_CONVERT_BACKOFF_MS: 600000 } as Env);

    expect(policy.maxAttempts).toBe(3);
    expect(backoffDelayMs(policy, 1)).toBe(600000);
    expect(backoffDelayMs(policy, 2)).toBe(1200000);
    // 第 3 次 = 600000 * 2^2 = 2400000 > 封顶 1800000
    expect(backoffDelayMs(policy, 3)).toBe(PREVIEW_BACKOFF_MAX_MS);
    expect(PREVIEW_BACKOFF_MAX_MS).toBe(30 * 60_000);
  });

  it("resolveOutboxPolicies：注册主题清单只含 preview.job（未登记主题由 dispatcher 回退缺省）", () => {
    const policies = resolveOutboxPolicies(ENV);

    expect([...policies.keys()]).toEqual(["preview.job"]);
    expect(policies.get("preview.job")).toEqual(previewTopicPolicy(ENV));
  });

  it("退避单调递增且封顶：attempts 很大也不超过 backoffMaxMs", () => {
    const policy = defaultTopicPolicy(ENV);

    expect(backoffDelayMs(policy, 1)).toBe(15000);
    expect(backoffDelayMs(policy, 4)).toBe(120000);
    expect(backoffDelayMs(policy, 8)).toBe(1800000);
    expect(backoffDelayMs(policy, 30)).toBe(1800000);
  });
});
