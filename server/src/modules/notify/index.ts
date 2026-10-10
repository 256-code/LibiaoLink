/** notify 模块唯一公开出口（api / worker 组合根与 outbox 注册表使用）。 */
export { NotifyModule } from "./notify.module.js";
export { NotifyService } from "./notify.service.js";
export type { NotifyFlushStats, NotifySnoozeFlushStats } from "./notify.service.js";
export { NOTIFY_MESSAGE_TOPIC } from "./notify.constants.js";
export {
  formatClockMinute,
  isDeliverableChannel,
  isWithinQuiet,
  mergeKeyOf,
  nextDayWindowStart,
  parseClockMinute,
  parseNotifyMessage,
  parseQuietHours,
  planDelivery,
  quietEndAfter,
  shanghaiDayStart,
  shanghaiMinuteOfDay,
} from "./notify.delivery.js";
export type { DeliveryDecision, QuietHours } from "./notify.delivery.js";
export {
  classifyWecomErrcode,
  classifyWecomHttpStatus,
  describeNetworkError,
  WECOM_APP_TOKEN_ERRCODES,
  WECOM_CHANNELS,
} from "./wecom.errors.js";
export type { WecomChannel, WecomFailureKind } from "./wecom.errors.js";
export { InMemoryRateWindowStore, WECOM_APP_BUCKET_ID, WecomRateLimiter, webhookBucketId } from "./wecom.rate.js";
export type { RateWindowStore, WecomRateDecision, WecomRateKind } from "./wecom.rate.js";
export { WecomTokenError, WecomTokenManager } from "./wecom.token.js";
export type { WecomTokenInfo } from "./wecom.token.js";
export { createWecomClientFromEnv, WecomClient } from "./wecom.client.js";
export type { WecomClientOptions, WecomRuntime, WecomRuntimeOverrides, WecomSendResult } from "./wecom.client.js";
