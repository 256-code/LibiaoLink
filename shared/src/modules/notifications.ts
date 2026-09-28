import { z } from "../zod.ts";
import { NotifyChannelSchema } from "./automation.ts";
import { DateTimeSchema, PageQuerySchema, UuidSchema } from "../common/conventions.ts";

/**
 * 通知（站内信 · 消息中心）契约（S7-4 · j1 / M5-04 首刀 · lan）。
 *
 * 口径来源：系统功能书 C5-01 收件箱三态（未读 / 已读 / 已处理）、C5-02 分类与筛选（提醒 / 审批 / 播报 / 系统 +
 *   时间区间 + 已读状态）、C5-03 全量留档；C2-08 投递保障（幂等去重 / 失败重试 / 错过补发 / 死信告警）、
 *   C2-09 合并与免打扰（同期消息合并推送 / 免打扰时段静默次日补发 / 每人每日上限）；
 *   技术设计v0.2 §6.2「合并与免打扰」，§11.1 新增表 notifications / notify_prefs（技术设计v0.3 §3.6 同）；
 *   ADR-005（Outbox + PG 原生队列）、ADR-028（业务日固定 Asia/Shanghai）。
 *
 * 本切片边界（S7-4）：站内信投递（outbox 主题 `notify.message` 消费）+ 合并（同人同时段）+ 免打扰（次日补发）+
 *   每人每日上限 + 收件箱读面（列表 / 未读计数 / 标记已读·已处理 / 全部已读）+ 全量留档 + 个人通知偏好。
 *   余下随后续卡片：企微通道（M5-03）/ SSE（`/notifications/stream`）/ 稍后提醒（C5-05）/
 *   规则生产端（i12 / i13：写 `notify.message` 的主题生产者）—— 投递层就绪后加项即可。
 */

/** 通知类型（C5-02 分类筛选）：提醒 / 审批 / 播报 / 系统。 */
export const NOTIFICATION_TYPES = ["reminder", "approval", "broadcast", "system"] as const;
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES).openapi("NotificationType", {
  description:
    "通知类型（C5-02 分类）：reminder 提醒（任务 / 日报 / 问题等业务提醒）/ approval 审批（待办审批与门禁）/ broadcast 播报（喜报 / 阶段达成 / 摘要群发同步留档）/ system 系统（账号 / 权限 / 运维通知）",
});
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/** 收件箱状态（C5-01）：未读 / 已读 / 已处理（三态单向回退允许：已处理可退回已读，标记幂等）。 */
export const NOTIFICATION_STATUSES = ["unread", "read", "handled"] as const;
export const NotificationStatusSchema = z.enum(NOTIFICATION_STATUSES).openapi("NotificationStatus", {
  description: "收件箱状态：unread 未读 / read 已读 / handled 已处理（标记接口幂等；允许回退到更早状态）",
});
export type NotificationStatus = z.infer<typeof NotificationStatusSchema>;

/** 标题 / 正文 / 关联类型 / 合并键 / 模板码上限（与库侧 CHECK 同口径）。 */
export const NOTIFICATION_TITLE_MAX_LENGTH = 200;
export const NOTIFICATION_BODY_MAX_LENGTH = 4000;
export const NOTIFICATION_REF_TYPE_MAX_LENGTH = 40;
export const NOTIFICATION_MERGE_KEY_MAX_LENGTH = 120;
export const NOTIFICATION_TEMPLATE_CODE_MAX_LENGTH = 60;
/** 每人每日上限的库侧 / 契约上限（0 = 不限）。 */
export const NOTIFICATION_DAILY_LIMIT_MAX = 1000;
/** 合并窗口上限（毫秒；0 = 不合并）—— 防止把「同期」拉成无限期合并。 */
export const NOTIFICATION_MERGE_WINDOW_MAX_MS = 24 * 60 * 60_000;

/** 非空文本（前后空白剔除后 1 ~ max 字）：载荷与请求体的标题 / 正文共用口径。 */
function nonBlankText(max: number, label: string) {
  return z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, { message: label + "剔除前后空白后不能为空" });
}

/**
 * `notify.message` 主题载荷（outbox 消费侧唯一输入；i12 / i13 规则生产端按本 schema 写入）。
 *
 * 生产端责任：按收件人口径逐位展开（一个收件人一条事件，recipientId 必填）、同事务 appendOutbox、
 *   dedupeKey 用「规则码:实体 id:窗口」（含状态版本再生窗口，见 outbox 契约）；
 * 消费端责任：载荷非法 → outbox dead（确定性失败，一次即弃，先例 preview.job）、标题 / 正文 trim 后落库。
 * 渠道（channel）：缺省 inbox = 站内信；M5-03 落地前投递层只支持 inbox —— 非 inbox 值按确定性失败收口（dead + 告警），
 *   不得静默当站内信投递（接线层护栏；M5-03 落地后由投递层分流）。
 * 合并键（mergeKey）：缺省按 `templateCode` → `type:refType:refId` 逐级回退（见投递层口径）；
 *   需要「同人同时段合并成一条」的系列消息（A01 多项目提醒等）应显式给 mergeKey。
 */
export const NotifyMessagePayloadSchema = z
  .object({
    recipientId: UuidSchema.openapi({ description: "收件人（用户 id；生产端已按收件人口径展开到人）" }),
    type: NotificationTypeSchema,
    channel: NotifyChannelSchema.optional().openapi({
      description: "投递渠道（复用 automation 的 NOTIFY_CHANNELS，与引擎 ReplayMessage.channel 同源；缺省 inbox = 站内信）。M5-03 落地前非 inbox 值由投递层按确定性失败收口（dead + 告警）",
    }),
    title: nonBlankText(NOTIFICATION_TITLE_MAX_LENGTH, "标题").openapi({ description: "标题（前后空白剔除后 1 ~ 200 字）" }),
    body: nonBlankText(NOTIFICATION_BODY_MAX_LENGTH, "正文").openapi({ description: "正文（前后空白剔除后 1 ~ 4000 字）" }),
    refType: z
      .string()
      .max(NOTIFICATION_REF_TYPE_MAX_LENGTH)
      .nullish()
      .openapi({ description: "关联对象类型（project / task / report / issue / file / node 等，与审计对象类型同词汇表；可空）" }),
    refId: UuidSchema.nullish().openapi({ description: "关联对象 id（与 refType 成对；可空）" }),
    templateCode: z
      .string()
      .max(NOTIFICATION_TEMPLATE_CODE_MAX_LENGTH)
      .nullish()
      .openapi({ description: "模板码（如 A01_INBOX_MERGED / R02_INBOX；排障与文案回溯用；可空）" }),
    mergeKey: z
      .string()
      .max(NOTIFICATION_MERGE_KEY_MAX_LENGTH)
      .nullish()
      .openapi({ description: "合并键（缺省按 templateCode → type:refType:refId 回退；显式给键 = 同人同时段只推一条）" }),
  })
  .superRefine((value, context) => {
    const hasRefType = value.refType !== null && value.refType !== undefined && value.refType !== "";
    const hasRefId = value.refId !== null && value.refId !== undefined;
    if (hasRefType !== hasRefId) {
      context.addIssue({
        code: "custom",
        message: "refType 与 refId 必须成对出现（库侧 CHECK ck_notifications_ref 同口径）",
        path: ["refId"],
      });
    }
  })
  .openapi("NotifyMessagePayload", {
    description: "站内信投递事件载荷（outbox 主题 notify.message）：收件人 + 渠道 + 类型 + 标题 / 正文 + 关联对象 + 合并键",
  });
export type NotifyMessagePayload = z.infer<typeof NotifyMessagePayloadSchema>;

/**
 * 收件箱条目（C5-01 / C5-03 全量留档）。
 * 只返回**已投递**的主行（合并子行仅在库内留档，不进收件箱）；`mergedCount` = 本行合并的消息条数（≥ 1）。
 */
export const NotificationSchema = z
  .object({
    id: z.number().int().positive().openapi({ description: "通知 id（库内自增；收件箱以 id 降序）" }),
    type: NotificationTypeSchema,
    title: z.string().openapi({ description: "标题（已剔除前后空白）" }),
    body: z.string().openapi({ description: "正文（已剔除前后空白；首条消息的正文，被合并行正文留档在库内）" }),
    status: NotificationStatusSchema,
    refType: z.string().nullable().openapi({ description: "关联对象类型（可空）" }),
    refId: UuidSchema.nullable().openapi({ description: "关联对象 id（可空；与 refType 成对）" }),
    templateCode: z.string().nullable().openapi({ description: "模板码（可空）" }),
    mergedCount: z.number().int().min(1).openapi({ description: "合并条数：同期同合并键的消息条数（未合并 = 1）" }),
    deliveredAt: DateTimeSchema.openapi({ description: "投递时刻（进入收件箱的时刻）" }),
    createdAt: DateTimeSchema.openapi({ description: "消息创建时刻（收到投递事件的时刻）" }),
  })
  .openapi("Notification", { description: "收件箱条目（已投递；合并子行不进收件箱、只在库内留档）" });
export type Notification = z.infer<typeof NotificationSchema>;

/** 收件箱查询：状态 / 类型 / 关联对象 + 时间区间 + 分页（id 降序 = 新消息在前）。 */
export const NotificationListQuerySchema = z
  .object({
    status: NotificationStatusSchema.optional().openapi({ description: "状态过滤（缺省 = 全部三态）" }),
    type: NotificationTypeSchema.optional().openapi({ description: "类型过滤（C5-02 分类；缺省 = 全部）" }),
    refType: z
      .string()
      .max(NOTIFICATION_REF_TYPE_MAX_LENGTH)
      .optional()
      .openapi({ description: "关联对象类型过滤（如 task / issue；缺省 = 全部）" }),
    from: DateTimeSchema.optional().openapi({ description: "投递时刻下界（含；缺省 = 不限）" }),
    to: DateTimeSchema.optional().openapi({ description: "投递时刻上界（含；缺省 = 不限）" }),
    page: PageQuerySchema.shape.page,
    limit: PageQuerySchema.shape.limit,
  })
  .openapi("NotificationListQuery", {
    description: "收件箱查询：状态 / 类型 / 关联对象 + 投递时刻区间 + 分页（缺省 id 降序 = 新消息在前）",
  });
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

export const NotificationListResponseSchema = z
  .object({
    items: z.array(NotificationSchema),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0).openapi({ description: "当前筛选下的总条数" }),
    unreadCount: z.number().int().min(0).openapi({ description: "未读总数（不受 status 过滤影响；角标口径）" }),
  })
  .openapi("NotificationListResponse", { description: "收件箱清单（含未读角标计数）" });
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;

/** 标记状态（PATCH /notifications/{id}）：幂等；允许回退到更早状态。 */
export const NotificationMarkBodySchema = z
  .object({ status: NotificationStatusSchema })
  .openapi("NotificationMarkBody", { description: "标记收件箱状态（幂等；已处理可退回已读）" });
export type NotificationMarkBody = z.infer<typeof NotificationMarkBodySchema>;

export const NotificationMarkAllReadResponseSchema = z
  .object({
    updated: z.number().int().min(0).openapi({ description: "本次实际置为已读的条数" }),
    unreadCount: z.number().int().min(0).openapi({ description: "置位后的未读数（恒为 0；回读口径）" }),
  })
  .openapi("NotificationMarkAllReadResponse", { description: "全部标记已读结果" });
export type NotificationMarkAllReadResponse = z.infer<typeof NotificationMarkAllReadResponseSchema>;

/** 免打扰配置三态：`default` 继承缺省（env NOTIFY_QUIET_HOURS）/ `off` 关闭 / `HH:MM-HH:MM` 自定义（跨零点允许，from ≠ to）。 */
export const NotifyQuietHoursSchema = z
  .string()
  .regex(/^(default|off|([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9])$/)
  .superRefine((value, context) => {
    const match = /^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$/.exec(value);
    if (match !== null && match[1] === match[2]) {
      context.addIssue({ code: "custom", message: "免打扰开始与结束不能相同（要关闭免打扰请用 off）" });
    }
  })
  .openapi("NotifyQuietHours", {
    description:
      "免打扰配置（三态）：default 继承缺省（env NOTIFY_QUIET_HOURS，缺省 22:00-08:00）/ off 关闭 / HH:MM-HH:MM 自定义（Asia/Shanghai，跨零点允许）",
  });
export type NotifyQuietHours = z.infer<typeof NotifyQuietHoursSchema>;

/**
 * 通知偏好（notify_prefs；C2-09 的按人配置面）—— `quietHours` 为配置态三态，`quietFrom` / `quietTo` 为
 * **生效值**（default 时解析为缺省时段、off 时双 null），供前端直接展示；免打扰与合并窗口按 Asia/Shanghai（ADR-028）。
 */
export const NotifyPrefsSchema = z
  .object({
    quietHours: NotifyQuietHoursSchema,
    quietFrom: z
      .string()
      .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
      .nullable()
      .openapi({ description: "免打扰开始（生效值，HH:MM，Asia/Shanghai）；null = 免打扰关闭" }),
    quietTo: z
      .string()
      .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
      .nullable()
      .openapi({ description: "免打扰结束（生效值，HH:MM，Asia/Shanghai）；跨零点允许（from > to）；null = 免打扰关闭" }),
    dailyLimit: z
      .number()
      .int()
      .min(0)
      .max(NOTIFICATION_DAILY_LIMIT_MAX)
      .openapi({ description: "每人每日投递上限（0 = 不限）；超限消息排到次日窗口起点" }),
    mergeWindowMs: z
      .number()
      .int()
      .min(0)
      .max(NOTIFICATION_MERGE_WINDOW_MAX_MS)
      .openapi({ description: "合并窗口（毫秒；0 = 不合并）：同人同合并键、窗口内未读主行合并为一条" }),
    updatedAt: DateTimeSchema.nullable().openapi({ description: "偏好最近保存时刻；null = 从未保存（全走缺省）" }),
  })
  .openapi("NotifyPrefs", { description: "通知偏好（免打扰时段 / 每日上限 / 合并窗口；读面为生效值）" });
export type NotifyPrefs = z.infer<typeof NotifyPrefsSchema>;

/** 偏好更新（局部更新：只传变更键；空更新 400）。 */
export const NotifyPrefsUpdateBodySchema = z
  .object({
    quietHours: NotifyQuietHoursSchema.optional(),
    dailyLimit: z.number().int().min(0).max(NOTIFICATION_DAILY_LIMIT_MAX).optional(),
    mergeWindowMs: z.number().int().min(0).max(NOTIFICATION_MERGE_WINDOW_MAX_MS).optional(),
  })
  .openapi("NotifyPrefsUpdateBody", {
    description: "通知偏好更新（局部更新：只传变更键；quietHours 三态 default / off / HH:MM-HH:MM；空更新 400）",
  });
export type NotifyPrefsUpdateBody = z.infer<typeof NotifyPrefsUpdateBodySchema>;
