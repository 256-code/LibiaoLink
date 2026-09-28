import { describe, expect, it } from "vitest";
import { AppConfig } from "../src/config/config.module.js";
import type { Env } from "../src/config/env.js";
import type { OutboxStatsSnapshot, OutboxStore } from "../src/db/outbox.store.js";
import type { OutboxTopicBacklog } from "../src/db/outbox.store.js";
import {
  evaluateOutboxAlerts,
  type OutboxAlert,
  type OutboxAlertSink,
  type OutboxAlertThresholds,
} from "../src/outbox/alert.js";
import { OutboxAlertProbe } from "../src/outbox/probe.js";

/** S7-1 告警门禁：阈值判定（纯函数）与探针接线（读快照 → 发告警）。 */

const THRESHOLDS: OutboxAlertThresholds = { backlogMax: 1000, oldestDueMs: 900000, deadRecentMax: 1 };

const ENV = {
  OUTBOX_ALERT_BACKLOG_MAX: 1000,
  OUTBOX_ALERT_OLDEST_MS: 900000,
  OUTBOX_ALERT_DEAD_RECENT_MAX: 1,
  OUTBOX_ALERT_DEAD_WINDOW_MS: 3600000,
} as unknown as Env;

function snapshot(overrides: Partial<OutboxStatsSnapshot> = {}): OutboxStatsSnapshot {
  return { duePending: 0, oldestDueMs: null, deadRecent: 0, deadTotal: 0, byTopic: [], ...overrides };
}

function backlog(topic: string, due: number, oldestMs: number): OutboxTopicBacklog {
  return { topic, due, oldestMs };
}

describe("evaluateOutboxAlerts（S7-1 阈值判定）", () => {
  it("积压超阈值：warn + 主题明细（按积压排序截前 5）", () => {
    const topics = Array.from({ length: 7 }, (_, index) => backlog("topic." + index, 7 - index, 1000));
    const alerts = evaluateOutboxAlerts(snapshot({ duePending: 1001, oldestDueMs: 1000, byTopic: topics }), THRESHOLDS);

    const backlogAlert = alerts.find((alert) => alert.code === "outbox.backlog");
    expect(backlogAlert).toMatchObject({ level: "warn", detail: { duePending: 1001 } });
    expect((backlogAlert!.detail!.byTopic as OutboxTopicBacklog[])).toHaveLength(5);
  });

  it("积压等于阈值不告警（严格大于才报）", () => {
    expect(evaluateOutboxAlerts(snapshot({ duePending: 1000, oldestDueMs: 1000 }), THRESHOLDS)).toHaveLength(0);
  });

  it("最老待领取超阈值：error；无积压（oldestDueMs = null）不告警", () => {
    const alerts = evaluateOutboxAlerts(snapshot({ duePending: 1, oldestDueMs: 900001 }), THRESHOLDS);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ code: "outbox.oldest_due", level: "error" });

    expect(evaluateOutboxAlerts(snapshot({ oldestDueMs: null }), THRESHOLDS)).toHaveLength(0);
  });

  it("近期死信 >= 阈值：error（默认 1 = 窗口内出现任何死信都告警）", () => {
    const alerts = evaluateOutboxAlerts(snapshot({ deadRecent: 1, deadTotal: 3 }), THRESHOLDS);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ code: "outbox.dead_letter", level: "error" });
    expect(alerts[0]!.message).toContain("累计 3");
  });

  it("多判定同时超限：三条告警全出（死信/积压/最老可并发）", () => {
    const alerts = evaluateOutboxAlerts(
      snapshot({ duePending: 5000, oldestDueMs: 3600000, deadRecent: 2, deadTotal: 2 }),
      THRESHOLDS,
    );

    expect(alerts.map((alert) => alert.code).sort()).toEqual(["outbox.backlog", "outbox.dead_letter", "outbox.oldest_due"]);
  });
});

/** Outbox 快照替身：只实现探针用到的 stats。 */
class FakeStatsStore {
  readonly inputs: { deadWindowMs: number }[] = [];
  current: OutboxStatsSnapshot = snapshot();

  async stats(input: { deadWindowMs: number }): Promise<OutboxStatsSnapshot> {
    this.inputs.push(input);
    return this.current;
  }
}

class FakeAlertSink implements OutboxAlertSink {
  readonly emitted: OutboxAlert[] = [];

  emit(alert: OutboxAlert): void {
    this.emitted.push(alert);
  }
}

function makeProbe(): { probe: OutboxAlertProbe; store: FakeStatsStore; sink: FakeAlertSink } {
  const store = new FakeStatsStore();
  const sink = new FakeAlertSink();
  const probe = new OutboxAlertProbe(store as unknown as OutboxStore, sink, new AppConfig(ENV));
  return { probe, store, sink };
}

describe("OutboxAlertProbe.probeOnce（S7-1）", () => {
  it("读快照（带死信窗口）→ 阈值判定 → 逐条发出并返回本轮告警", async () => {
    const { probe, store, sink } = makeProbe();
    store.current = snapshot({ duePending: 1001, oldestDueMs: 1000 });

    const alerts = await probe.probeOnce();

    expect(store.inputs).toEqual([{ deadWindowMs: 3600000 }]);
    expect(alerts).toHaveLength(1);
    expect(sink.emitted).toEqual(alerts);
  });

  it("健康队列：不发任何告警", async () => {
    const { probe, sink } = makeProbe();

    const alerts = await probe.probeOnce();

    expect(alerts).toHaveLength(0);
    expect(sink.emitted).toHaveLength(0);
  });
});
