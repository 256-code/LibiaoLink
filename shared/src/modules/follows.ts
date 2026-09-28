import { z } from "../zod.ts";
import { DateTimeSchema, UuidSchema } from "../common/conventions.ts";

/**
 * 关注 / 订阅（系统功能书 A1-15 · M2-06 首刀）：关注项目或任务；关注关系单独存储（follows 表，迁移 0037），
 * 不作为任务字段；关注清单在任务详情可见（我的关注读面，支持按对象过滤），支持批量关注 / 取消。
 * 关注后的关键事件通知（状态变更 / 延期 / 变更生效）随消息通道 M5（lan 线）；关注动态流（A6-08）随工作台二刀。
 * 取关语义：按「关系键」删除（不校验目标是否可见 / 存在）—— 目标被硬删后仍可清理自己的关注行；未关注 = 404。
 */

export const FOLLOW_OBJECT_TYPES = ["project", "task"] as const;
export const FollowObjectTypeSchema = z.enum(FOLLOW_OBJECT_TYPES).openapi("FollowObjectType", {
  description: "关注对象类型：project 项目 / task 任务",
});

/** 批量条目上限（防御性硬顶；超限 400 VALIDATION_FAILED）。 */
export const FOLLOW_BATCH_MAX = 50;

export const FollowItemSchema = z
  .object({
    objectType: FollowObjectTypeSchema,
    objectId: UuidSchema.openapi({ description: "关注对象 id（project.id / task.id）" }),
    projectId: UuidSchema.openapi({ description: "所属项目 id（关注项目 = 自身；关注任务 = 任务所属项目）" }),
    projectCode: z.string().openapi({ description: "项目编号（随行展示）" }),
    name: z.string().openapi({ description: "关注对象名称（项目名 / 任务标题；随行展示）" }),
    createdAt: DateTimeSchema.openapi({ description: "关注时间" }),
  })
  .openapi("FollowItem", { description: "关注关系（我的关注清单行；随行名称用于列表展示）" });

export const FollowListQuerySchema = z.object({
  objectType: FollowObjectTypeSchema.optional(),
  objectId: UuidSchema.optional().openapi({ description: "按对象过滤（配合 objectType；用于任务详情判断是否已关注）" }),
  projectId: UuidSchema.optional().openapi({ description: "按项目过滤（含该项目下的任务关注）" }),
});

export const FollowListResponseSchema = z
  .object({
    items: z.array(FollowItemSchema).openapi({ description: "我的关注清单（createdAt 降序 → id 升序；不可见 / 已删对象不返回）" }),
  })
  .openapi("FollowListResponse", { description: "关注清单（当前会话用户）" });

export const FollowCreateBodySchema = z
  .object({
    objectType: FollowObjectTypeSchema,
    objectId: UuidSchema,
  })
  .openapi("FollowCreateBody", { description: "关注（目标必须可见且未删除；重复关注幂等）" });

export const FollowCreateResponseSchema = z
  .object({
    item: FollowItemSchema,
    created: z.boolean().openapi({ description: "true = 本次新建（201）；false = 已关注（幂等，200）" }),
  })
  .openapi("FollowCreateResponse", { description: "关注结果（幂等）" });

export const FollowDeleteResponseSchema = z
  .object({
    objectType: FollowObjectTypeSchema,
    objectId: UuidSchema,
    removed: z.boolean().openapi({ description: "恒为 true（未关注 = 404，不返回本响应）" }),
  })
  .openapi("FollowDeleteResponse", { description: "取关结果" });

export const FollowBatchItemSchema = z.object({
  objectType: FollowObjectTypeSchema,
  objectId: UuidSchema,
  follow: z.boolean().openapi({ description: "true 关注 / false 取消" }),
});

export const FollowBatchBodySchema = z
  .object({
    items: z.array(FollowBatchItemSchema).min(1).max(FOLLOW_BATCH_MAX).openapi({ description: "批量条目（1 ~ 50；逐条独立处理）" }),
  })
  .openapi("FollowBatchBody", { description: "批量关注 / 取关（A1-15；部分失败不影响其它条目）" });

export const FOLLOW_BATCH_FAILURE_CODES = ["not_found"] as const;
export const FollowBatchFailureCodeSchema = z.enum(FOLLOW_BATCH_FAILURE_CODES).openapi("FollowBatchFailureCode", {
  description: "批量失败原因：not_found 目标不存在 / 不可见 / 已删除（仅关注动作产生；取关不存在的行 = unchanged）",
});

export const FollowBatchFailureSchema = z.object({
  index: z.number().int().openapi({ description: "条目在请求里的下标（0 起）" }),
  objectType: FollowObjectTypeSchema,
  objectId: UuidSchema,
  code: FollowBatchFailureCodeSchema,
  message: z.string(),
});

export const FollowBatchResponseSchema = z
  .object({
    followed: z.number().int().openapi({ description: "新关注数" }),
    unfollowed: z.number().int().openapi({ description: "取消关注数" }),
    unchanged: z.number().int().openapi({ description: "无需变更数（重复关注 / 取关不存在的行）" }),
    failures: z.array(FollowBatchFailureSchema).openapi({ description: "失败项（顺序 = 请求顺序）" }),
  })
  .openapi("FollowBatchResponse", { description: "批量结果（整体 200；失败清单给逐条原因）" });

export type FollowObjectType = z.infer<typeof FollowObjectTypeSchema>;
export type FollowItem = z.infer<typeof FollowItemSchema>;
export type FollowListQuery = z.infer<typeof FollowListQuerySchema>;
export type FollowListResponse = z.infer<typeof FollowListResponseSchema>;
export type FollowCreateBody = z.infer<typeof FollowCreateBodySchema>;
export type FollowCreateResponse = z.infer<typeof FollowCreateResponseSchema>;
export type FollowDeleteResponse = z.infer<typeof FollowDeleteResponseSchema>;
export type FollowBatchItem = z.infer<typeof FollowBatchItemSchema>;
export type FollowBatchBody = z.infer<typeof FollowBatchBodySchema>;
export type FollowBatchFailure = z.infer<typeof FollowBatchFailureSchema>;
export type FollowBatchFailureCode = z.infer<typeof FollowBatchFailureCodeSchema>;
export type FollowBatchResponse = z.infer<typeof FollowBatchResponseSchema>;
