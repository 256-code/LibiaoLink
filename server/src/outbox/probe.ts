import { Inject, Injectable } from "@nestjs/common";
import { AppConfig } from "../config/config.module.js";
import { OutboxStore, type OutboxStatsSnapshot } from "../db/outbox.store.js";
import { evaluateOutboxAlerts, outboxAlertThresholdsFromEnv, OUTBOX_ALERT_SINK, type OutboxAlert, type OutboxAlertSink } from "./alert.js";

/**
 * 告警探针（S7-1 · ADR-005：Outbox 积压量与最老消息年龄纳入告警；死信单条即时告警见 dispatcher）。
 * worker 周期调用；只覆盖「worker 活着但队列不健康」——进程级探活由部署侧探针负责（M11 告警接线登记）。
 */
@Injectable()
export class OutboxAlertProbe {
  /**
   * 死信水位线（M5-03-4 T5 反向发现修复）：dead_total 只增，探针只对「自上次上报以来的新增死信」告警 ——
   * 同一批死信在 1 小时窗口内不再每轮复报；即时告警（dispatcher `outbox.dead`）承担事件级通报。
   * 首次观测照发（重启后提醒窗口内死信）；总数回落（清理等异常）时重建基线。
   */
  private lastReportedDeadTotal: number | null = null;

  constructor(
    private readonly store: OutboxStore,
    @Inject(OUTBOX_ALERT_SINK) private readonly alerts: OutboxAlertSink,
    private readonly config: AppConfig,
  ) {}

  /** 一轮探测：读快照 → 阈值判定 → 死信增量去重 → 逐条发告警；返回本轮告警（测试 / 回放断言用）。 */
  async probeOnce(): Promise<OutboxAlert[]> {
    const snapshot = await this.store.stats({ deadWindowMs: this.config.env.OUTBOX_ALERT_DEAD_WINDOW_MS });
    const alerts = evaluateOutboxAlerts(snapshot, outboxAlertThresholdsFromEnv(this.config.env)).filter((alert) =>
      this.isFreshDeadLetter(alert, snapshot),
    );
    for (const alert of alerts) {
      this.alerts.emit(alert);
    }
    return alerts;
  }

  /**
   * 死信告警增量门槛：非死信告警一律放行；死信告警 = 首次观测或 dead_total 增加才放行。
   * 回落（清理 / 异常）→ 重建基线并放行本条（按「重新出现」处理），避免静默丢新死信。
   */
  private isFreshDeadLetter(alert: OutboxAlert, snapshot: OutboxStatsSnapshot): boolean {
    if (alert.code !== "outbox.dead_letter") {
      return true;
    }
    const last = this.lastReportedDeadTotal;
    if (last !== null && snapshot.deadTotal < last) {
      this.lastReportedDeadTotal = snapshot.deadTotal;
      return true;
    }
    if (last !== null && snapshot.deadTotal === last) {
      return false;
    }
    this.lastReportedDeadTotal = snapshot.deadTotal;
    return true;
  }
}