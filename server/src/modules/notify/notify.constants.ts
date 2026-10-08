/** 站内信投递事件主题（契约 `OUTBOX_TOPICS` 白名单成员；Push 169 定案时为「已定案预留」，S7-4 规则接线 Push 180 起为写入端 + 本模块消费侧接线）。 */
export const NOTIFY_MESSAGE_TOPIC = "notify.message" as const;
