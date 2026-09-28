/** Outbox worker 运行时唯一公开出口（入口 entry/worker.ts 与组合根使用）。 */
export { OutboxModule } from "./outbox.module.js";
export { OUTBOX_POLICIES, OUTBOX_REGISTRY, OutboxDispatcher } from "./dispatcher.js";
export type { OutboxDrainStats } from "./dispatcher.js";
export { OutboxAlertProbe } from "./probe.js";
export { OUTBOX_RETENTION_MAX_ROUNDS, OutboxRetention } from "./retention.js";
export { evaluateOutboxAlerts, LogOutboxAlertSink, outboxAlertThresholdsFromEnv, OUTBOX_ALERT_SINK } from "./alert.js";
export type { OutboxAlert, OutboxAlertCode, OutboxAlertSink, OutboxAlertThresholds } from "./alert.js";
export type { OutboxHandleOutcome, OutboxTopicHandler } from "./handler.js";
export { backoffDelayMs, defaultTopicPolicy, PREVIEW_BACKOFF_MAX_MS, previewTopicPolicy, resolveOutboxPolicies } from "./policy.js";
export type { OutboxTopicPolicy } from "./policy.js";