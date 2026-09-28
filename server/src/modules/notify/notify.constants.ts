/** 站内信投递事件主题（契约 `OUTBOX_TOPICS` 白名单成员；S7-4 前为「已定案预留」主题，本刀消费侧接线）。 */
export const NOTIFY_MESSAGE_TOPIC = "notify.message" as const;
