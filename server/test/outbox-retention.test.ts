import { describe, expect, it } from "vitest";
import { AppConfig } from "../src/config/config.module.js";
import type { Env } from "../src/config/env.js";
import type { OutboxStore, PurgeDoneInput } from "../src/db/outbox.store.js";
import { OutboxRetention, OUTBOX_RETENTION_MAX_ROUNDS } from "../src/outbox/retention.js";

/** S7-1 done 行保留期清理门禁：分批删到「不足一批」为止，单轮封顶防一次删太多。 */

const ENV = { OUTBOX_DONE_RETENTION_DAYS: 90, OUTBOX_RETENTION_BATCH: 1000 } as unknown as Env;

class FakePurgeStore {
  readonly inputs: PurgeDoneInput[] = [];
  batches: number[] = [];

  async purgeDone(input: PurgeDoneInput): Promise<number> {
    this.inputs.push(input);
    return this.batches.shift() ?? 0;
  }
}

function makeRetention(): { retention: OutboxRetention; store: FakePurgeStore } {
  const store = new FakePurgeStore();
  const retention = new OutboxRetention(store as unknown as OutboxStore, new AppConfig(ENV));
  return { retention, store };
}

describe("OutboxRetention.sweepOnce（S7-1）", () => {
  it("分批删到不足一批为止：参数取 env，返回本轮总删除数", async () => {
    const { retention, store } = makeRetention();
    store.batches = [1000, 1000, 3];

    const purged = await retention.sweepOnce();

    expect(purged).toBe(2003);
    expect(store.inputs).toEqual([
      { retentionDays: 90, batch: 1000 },
      { retentionDays: 90, batch: 1000 },
      { retentionDays: 90, batch: 1000 },
    ]);
  });

  it("单轮最多 OUTBOX_RETENTION_MAX_ROUNDS 批（积压巨大也不把锁与 WAL 拉满）", async () => {
    const { retention, store } = makeRetention();
    store.batches = Array.from({ length: 1000 }, () => 1000);

    const purged = await retention.sweepOnce();

    expect(store.inputs).toHaveLength(OUTBOX_RETENTION_MAX_ROUNDS);
    expect(purged).toBe(OUTBOX_RETENTION_MAX_ROUNDS * 1000);
  });

  it("无到期行：一轮即止，不空转重试", async () => {
    const { retention, store } = makeRetention();
    store.batches = [0];

    expect(await retention.sweepOnce()).toBe(0);
    expect(store.inputs).toHaveLength(1);
  });
});
