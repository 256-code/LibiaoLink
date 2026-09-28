import type { Env } from "../config/env.js";
import type { OutboxTopic } from "@libiaolink/contracts";
import { PREVIEW_JOB_TOPIC } from "../modules/file/index.js";

/**
 * 主题级重试策略（S7-1）：重试与死信的**语义**由契约 fixed（shared/src/modules/outbox.ts），
 * 数值按主题落 env —— 缺省走 OUTBOX_DEFAULT_*，preview.job 沿用 PREVIEW_CONVERT_*（与 M4-05c 同口径，
 * 不改既有 env 契约）。
 */
export interface OutboxTopicPolicy {
  /** 单轮领取条数（每主题独立批；防慢主题把批次占满、饿死其它主题）。 */
  batchLimit: number;
  /** 可重试失败的最大尝试次数（含首次）。 */
  maxAttempts: number;
  /** 指数退避基数（毫秒）：第 n 次失败后等待 base * 2^(n-1)，封顶 backoffMaxMs。 */
  backoffBaseMs: number;
  backoffMaxMs: number;
}

/** 预览转换退避封顶 30 分钟（与 M4-05c 原实现同口径：容器重启 / 配额耗尽不无限拉长）。 */
export const PREVIEW_BACKOFF_MAX_MS = 30 * 60_000;

export function defaultTopicPolicy(env: Env): OutboxTopicPolicy {
  return {
    batchLimit: env.OUTBOX_BATCH_LIMIT,
    maxAttempts: env.OUTBOX_DEFAULT_MAX_ATTEMPTS,
    backoffBaseMs: env.OUTBOX_DEFAULT_BACKOFF_BASE_MS,
    backoffMaxMs: env.OUTBOX_DEFAULT_BACKOFF_MAX_MS,
  };
}

export function previewTopicPolicy(env: Env): OutboxTopicPolicy {
  return {
    batchLimit: env.OUTBOX_BATCH_LIMIT,
    maxAttempts: env.PREVIEW_CONVERT_MAX_ATTEMPTS,
    backoffBaseMs: env.PREVIEW_CONVERT_BACKOFF_MS,
    backoffMaxMs: PREVIEW_BACKOFF_MAX_MS,
  };
}

/** 已注册主题 → 策略；未登记主题由 dispatcher 回退缺省策略（正常不会发生：领取只按注册表主题）。 */
export function resolveOutboxPolicies(env: Env): ReadonlyMap<OutboxTopic, OutboxTopicPolicy> {
  return new Map<OutboxTopic, OutboxTopicPolicy>([[PREVIEW_JOB_TOPIC, previewTopicPolicy(env)]]);
}

/** 第 attempts 次失败（含本次，1 起）后的退避时长。 */
export function backoffDelayMs(policy: OutboxTopicPolicy, attempts: number): number {
  return Math.min(policy.backoffBaseMs * 2 ** (attempts - 1), policy.backoffMaxMs);
}
