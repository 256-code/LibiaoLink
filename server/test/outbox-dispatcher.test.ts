import { describe, expect, it } from "vitest";
import { ClockService } from "../src/common/clock/clock.service.js";
import { AppConfig } from "../src/config/config.module.js";
import type { Env } from "../src/config/env.js";
import type { ClaimOutboxInput, OutboxClaimedRow, OutboxRetryInput } from "../src/db/outbox.store.js";
import type { OutboxStore } from "../src/db/outbox.store.js";
import type { OutboxAlert, OutboxAlertSink } from "../src/outbox/alert.js";
import { OutboxDispatcher } from "../src/outbox/dispatcher.js";
import type { OutboxHandleOutcome, OutboxTopicHandler } from "../src/outbox/handler.js";
import { previewTopicPolicy, type OutboxTopicPolicy } from "../src/outbox/policy.js";

/**
 * S7-1 Outbox 分派器门禁（不连库）：按注册主题独立成批领取、逐条收敛（done / retry 退避 / dead + 告警）、
 * handler 异常与非法返回兜底、onDead 留痕。
 * 真机语义（杀 worker 不丢 / 重复领取不重发 + PoC-5 并发）由 i6 / i7 的证据脚本覆盖，这里只管接线口径。
 */

const NOW = new Date("2026-09-28T02:00:00Z");

const ENV = {
  OUTBOX_BATCH_LIMIT: 2,
  OUTBOX_STALE_MS: 600000,
  OUTBOX_DEFAULT_MAX_ATTEMPTS: 3,
  OUTBOX_DEFAULT_BACKOFF_BASE_MS: 1000,
  OUTBOX_DEFAULT_BACKOFF_MAX_MS: 10000,
  PREVIEW_CONVERT_MAX_ATTEMPTS: 3,
  PREVIEW_CONVERT_BACKOFF_MS: 15000,
  WORKER_ID: "test-worker",
} as unknown as Env;

function makeRow(topic: string, id: number, overrides: Partial<OutboxClaimedRow> = {}): OutboxClaimedRow {
  return {
    id,
    topic,
    payload: {},
    dedupeKey: topic + ":key:" + id,
    attempts: 0,
    availableAt: NOW,
    lockedAt: NOW,
    ...overrides,
  };
}

/** outbox 领取 / 回写替身：claim 按主题取行并记账，三态回写各记一笔。 */
class FakeOutboxStore {
  readonly byTopic = new Map<string, OutboxClaimedRow[]>();
  readonly claims: ClaimOutboxInput[] = [];
  readonly done: number[] = [];
  readonly retried: { id: number; input: OutboxRetryInput }[] = [];
  readonly dead: { id: number; input: { attempts: number; error: string } }[] = [];

  async claim(input: ClaimOutboxInput): Promise<OutboxClaimedRow[]> {
    this.claims.push(input);
    const rows = this.byTopic.get(input.topics[0]!) ?? [];
    return rows.splice(0, input.limit);
  }

  async markDone(id: number): Promise<void> {
    this.done.push(id);
  }

  async markRetry(id: number, input: OutboxRetryInput): Promise<void> {
    this.retried.push({ id, input });
  }

  async markDead(id: number, input: { attempts: number; error: string }): Promise<void> {
    this.dead.push({ id, input });
  }
}

class FakeAlertSink implements OutboxAlertSink {
  readonly emitted: OutboxAlert[] = [];

  emit(alert: OutboxAlert): void {
    this.emitted.push(alert);
  }
}

interface Harness {
  dispatcher: OutboxDispatcher;
  store: FakeOutboxStore;
  alerts: FakeAlertSink;
}

function makeDispatcher(options: {
  registry?: ReadonlyMap<string, OutboxTopicHandler>;
  policies?: ReadonlyMap<string, OutboxTopicPolicy>;
  env?: Partial<Env>;
} = {}): Harness {
  const store = new FakeOutboxStore();
  const alerts = new FakeAlertSink();
  const clock = new ClockService();
  clock.setSource(() => NOW);
  const config = new AppConfig({ ...ENV, ...options.env } as Env);
  const dispatcher = new OutboxDispatcher(
    store as unknown as OutboxStore,
    options.registry ?? new Map(),
    options.policies ?? new Map(),
    alerts,
    config,
    clock,
  );
  return { dispatcher, store, alerts };
}

function handlerOf(
  handle: (row: OutboxClaimedRow) => Promise<OutboxHandleOutcome>,
  onDead?: (row: OutboxClaimedRow, error: string) => Promise<void>,
): OutboxTopicHandler {
  return onDead === undefined ? { handle } : { handle, onDead };
}

describe("OutboxDispatcher.drainOnce（S7-1 分派与收敛）", () => {
  it("按注册主题逐主题领取：每主题独立成批（batchLimit / staleAfterMs / workerId 均落领取参数）", async () => {
    const h = makeDispatcher({
      registry: new Map<string, OutboxTopicHandler>([
        ["topic.a", handlerOf(async () => ({ outcome: "done" }))],
        ["topic.b", handlerOf(async () => ({ outcome: "done" }))],
      ]),
    });
    h.store.byTopic.set("topic.a", [makeRow("topic.a", 1), makeRow("topic.a", 2), makeRow("topic.a", 3)]);
    h.store.byTopic.set("topic.b", [makeRow("topic.b", 4)]);

    const stats = await h.dispatcher.drainOnce();

    expect(h.store.claims).toEqual([
      { topics: ["topic.a"], limit: 2, staleAfterMs: 600000, workerId: "test-worker" },
      { topics: ["topic.b"], limit: 2, staleAfterMs: 600000, workerId: "test-worker" },
    ]);
    expect(stats).toEqual({ claimed: 3, done: 3, retried: 0, dead: 0 });
    // 每主题轮内只领 OUTBOX_BATCH_LIMIT 条：topic.a 领 2（余 1 条留给下一轮，不被清空），topic.b 领 1
    expect(h.store.done).toEqual([1, 2, 4]);
    expect(h.store.byTopic.get("topic.a")!.map((row) => row.id)).toEqual([3]);
  });

  it("注册表为空：不触库、零领取（只投递不消费的排障态）", async () => {
    const h = makeDispatcher();

    const stats = await h.dispatcher.drainOnce();

    expect(stats).toEqual({ claimed: 0, done: 0, retried: 0, dead: 0 });
    expect(h.store.claims).toHaveLength(0);
  });

  it("handler 抛异常 / 返回非法值：按可重试收敛，不打断同批其余行", async () => {
    const h = makeDispatcher({
      env: { OUTBOX_BATCH_LIMIT: 5 },
      registry: new Map<string, OutboxTopicHandler>([
        [
          "topic.a",
          handlerOf(async (row) => {
            if (row.id === 1) {
              throw new Error("处理器炸了");
            }
            if (row.id === 2) {
              return null as unknown as OutboxHandleOutcome;
            }
            return { outcome: "done" };
          }),
        ],
      ]),
    });
    h.store.byTopic.set("topic.a", [makeRow("topic.a", 1), makeRow("topic.a", 2), makeRow("topic.a", 3)]);

    const stats = await h.dispatcher.drainOnce();

    expect(stats).toEqual({ claimed: 3, done: 1, retried: 2, dead: 0 });
    expect(h.store.retried.map((item) => item.id)).toEqual([1, 2]);
    expect(h.store.retried[0]!.input.error).toBe("处理器炸了");
    expect(h.store.retried[1]!.input.error).toBe("处理器返回非法结果");
  });

  it("retry 未到顶：按主题策略退避回 pending（attempts 累计；availableAt = now + base * 2^(n-1)）", async () => {
    const policies = new Map<string, OutboxTopicPolicy>([
      ["topic.a", { batchLimit: 2, maxAttempts: 5, backoffBaseMs: 1000, backoffMaxMs: 10000 }],
    ]);
    const h = makeDispatcher({
      registry: new Map<string, OutboxTopicHandler>([
        ["topic.a", handlerOf(async () => ({ outcome: "retry", error: "稍后再试" }))],
      ]),
      policies,
    });
    h.store.byTopic.set("topic.a", [makeRow("topic.a", 1, { attempts: 2 })]);

    const stats = await h.dispatcher.drainOnce();

    expect(stats).toEqual({ claimed: 1, done: 0, retried: 1, dead: 0 });
    expect(h.store.retried[0]).toMatchObject({ id: 1, input: { attempts: 3, error: "稍后再试" } });
    // 第 3 次失败后：1000 * 2^(3-1) = 4000ms
    expect(h.store.retried[0]!.input.availableAt.getTime()).toBe(NOW.getTime() + 4000);
    expect(h.store.dead).toHaveLength(0);
  });

  it("retry 到顶：先 onDead 留痕再落 dead，并发单条死信告警（不等探针周期）", async () => {
    const deadHooks: { id: number; error: string }[] = [];
    const h = makeDispatcher({
      registry: new Map<string, OutboxTopicHandler>([
        [
          "topic.a",
          handlerOf(
            async () => ({ outcome: "retry", error: "一直失败" }),
            async (row, error) => {
              deadHooks.push({ id: row.id, error });
            },
          ),
        ],
      ]),
    });
    h.store.byTopic.set("topic.a", [makeRow("topic.a", 7, { attempts: 2 })]);

    const stats = await h.dispatcher.drainOnce();

    expect(stats).toEqual({ claimed: 1, done: 0, retried: 0, dead: 1 });
    expect(deadHooks).toEqual([{ id: 7, error: "一直失败" }]);
    expect(h.store.dead[0]).toMatchObject({ id: 7, input: { attempts: 3, error: "一直失败" } });
    expect(h.alerts.emitted).toHaveLength(1);
    expect(h.alerts.emitted[0]).toMatchObject({
      code: "outbox.dead",
      level: "error",
      detail: { topic: "topic.a", id: 7, attempts: 3, maxAttempts: 3 },
    });
  });

  it("确定性 dead：一次即终态；onDead 抛错只记日志，不阻塞 markDead", async () => {
    const h = makeDispatcher({
      registry: new Map<string, OutboxTopicHandler>([
        [
          "topic.a",
          handlerOf(
            async () => ({ outcome: "dead", error: "文件损坏" }),
            async () => {
              throw new Error("留痕也炸了");
            },
          ),
        ],
      ]),
    });
    h.store.byTopic.set("topic.a", [makeRow("topic.a", 9)]);

    const stats = await h.dispatcher.drainOnce();

    expect(stats).toEqual({ claimed: 1, done: 0, retried: 0, dead: 1 });
    expect(h.store.dead[0]).toMatchObject({ id: 9, input: { attempts: 1, error: "文件损坏" } });
    expect(h.alerts.emitted[0]!.code).toBe("outbox.dead");
  });

  it("done 路径不触发死信告警；预览主题走 PREVIEW_CONVERT_* 策略（到顶次数与 M4-05c 同口径）", async () => {
    const policies = new Map<string, OutboxTopicPolicy>([
      ["preview.job", previewTopicPolicy({ ...ENV, OUTBOX_DEFAULT_MAX_ATTEMPTS: 99 } as unknown as Env)],
    ]);
    const h = makeDispatcher({
      registry: new Map<string, OutboxTopicHandler>([
        ["preview.job", handlerOf(async () => ({ outcome: "retry", error: "转换器忙" }))],
      ]),
      policies,
    });
    h.store.byTopic.set("preview.job", [makeRow("preview.job", 11, { attempts: 2 })]);

    const stats = await h.dispatcher.drainOnce();

    expect(stats).toEqual({ claimed: 1, done: 0, retried: 0, dead: 1 });
    expect(h.store.dead[0]!.input.attempts).toBe(3);
    expect(h.alerts.emitted).toHaveLength(1);
  });
});
