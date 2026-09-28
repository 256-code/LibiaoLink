import type { OutboxClaimedRow } from "../db/outbox.store.js";

/**
 * 单条消费的结果（S7-1）：dispatcher 据此收敛 outbox 状态 ——
 *   done  = 处理完成（含「业务上无需处理，消费掉」）；
 *   retry = 可重试失败，按主题策略退避回 pending（attempts 累计）；
 *   dead  = 确定性失败或重试到顶，落 dead + 死信告警。
 * handler 只做业务处理与分类，**不直接回写 outbox 状态**（回写统一在 dispatcher）。
 */
export type OutboxHandleOutcome =
  | { outcome: "done" }
  | { outcome: "retry"; error: string }
  | { outcome: "dead"; error: string };

/** 主题消费者（worker 注册表的一项）。 */
export interface OutboxTopicHandler {
  handle(row: OutboxClaimedRow): Promise<OutboxHandleOutcome>;
  /** 终态 dead 的留痕钩子（可选）：如把产物置 failed（D2-05 降级）。抛错只记日志，不阻塞 dead 落库。 */
  onDead?(row: OutboxClaimedRow, error: string): Promise<void>;
}