import { Inject, Injectable } from "@nestjs/common";
import { AppConfig } from "../config/config.module.js";
import { OutboxStore } from "../db/outbox.store.js";
import { evaluateOutboxAlerts, outboxAlertThresholdsFromEnv, OUTBOX_ALERT_SINK, type OutboxAlert, type OutboxAlertSink } from "./alert.js";

/**
 * 告警探针（S7-1 · ADR-005：Outbox 积压量与最老消息年龄纳入告警；死信单条即时告警见 dispatcher）。
 * worker 周期调用；只覆盖「worker 活着但队列不健康」——进程级探活由部署侧探针负责（M11 告警接线登记）。
 */
@Injectable()
export class OutboxAlertProbe {
  constructor(
    private readonly store: OutboxStore,
    @Inject(OUTBOX_ALERT_SINK) private readonly alerts: OutboxAlertSink,
    private readonly config: AppConfig,
  ) {}

  /** 一轮探测：读快照 → 阈值判定 → 逐条发告警；返回本轮告警（测试 / 回放断言用）。 */
  async probeOnce(): Promise<OutboxAlert[]> {
    const snapshot = await this.store.stats({ deadWindowMs: this.config.env.OUTBOX_ALERT_DEAD_WINDOW_MS });
    const alerts = evaluateOutboxAlerts(snapshot, outboxAlertThresholdsFromEnv(this.config.env));
    for (const alert of alerts) {
      this.alerts.emit(alert);
    }
    return alerts;
  }
}