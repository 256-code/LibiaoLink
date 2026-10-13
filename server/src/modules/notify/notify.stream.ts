/**
 * SSE 实时流（S8-3 · M5-04-1）线协议与帧编码：契约 shared/src/modules/notifications.ts（NOTIFICATION_STREAM_EVENTS）。
 *
 * 两段协议：
 * ① 广播桥（写方事务内 `pg_notify` → 各实例 LISTEN）：载荷 = 契约事件 + `recipientId`（扇出键，不进 SSE 帧）；
 * ② SSE 帧（实例 → 浏览器 EventSource）：`event: <notification|unread>` + `data: <契约载荷>`；
 *    心跳 / 停机告知 = 注释行（无事件名、无载荷，按定案不入契约）。
 * 重连不补发（定案 §三-3）：本层零游标状态 —— 错过的事件由客户端读面补拉对齐。
 */
import {
  NotificationSchema,
  NotificationStreamUnreadPayloadSchema,
  z,
  type NotificationStreamEvent,
} from "@libiaolink/contracts";

/** PG 广播通道名（定案 §三-5：写方事务内 pg_notify；api 各实例 LISTEN 后桥到本地连接，多实例零额外配置）。 */
export const NOTIFY_STREAM_CHANNEL = "notify_stream" as const;

/** 广播桥载荷（契约事件 + 收件人）：监听侧校验通过才扇出（非法载荷告警丢弃，不影响已建连接）。 */
export const NotifyStreamWireSchema = z.discriminatedUnion("event", [
  z.object({ recipientId: z.string().min(1), event: z.literal("notification"), data: NotificationSchema }),
  z.object({
    recipientId: z.string().min(1),
    event: z.literal("unread"),
    data: NotificationStreamUnreadPayloadSchema,
  }),
]);
export type NotifyStreamWireMessage = z.infer<typeof NotifyStreamWireSchema>;

/** SSE 帧编码（契约事件 → EventSource 事件）：`event:` + 单行 JSON `data:` + 空行结束一帧。 */
export function frameOf(event: NotificationStreamEvent["event"], data: unknown): string {
  return "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
}

/** 心跳注释行（定案 §三-4：周期落 env `NOTIFY_STREAM_HEARTBEAT_MS`；不进契约）。 */
export const NOTIFY_STREAM_HEARTBEAT_FRAME = ": ping\n\n";

/** 停机告知注释行（定案：优雅关闭先发注释行，客户端 EventSource 自动重连）。 */
export const NOTIFY_STREAM_SHUTDOWN_FRAME = ": server-shutdown\n\n";
