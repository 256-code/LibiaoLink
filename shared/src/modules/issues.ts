import { z } from "../zod.ts";
import { DateOnlySchema, DateTimeSchema, PageQuerySchema, UuidSchema, VersionSchema } from "../common/conventions.ts";

/**
 * 问题契约（M6-02 / M6-03 · A3-09 / A3-10 / A3-11 / A3-12 / A3-13）。
 * 口径来源：系统功能书.md A3（问题自动生成 / 四态 / 归类 / 分派 / 留痕）；前端功能需求.md §3.8 A21；
 * 技术设计v0.2 §2.2 / §11.1；技术设计v0.3 §3.7（M6-02 / M6-03）。表口径见 database/migrations/0023_daily_reports_issues.sql。
 * 一期口径（差异登记）：归类为契约固定枚举（C9 字典可维护随后）；SLA due_at 仅落库，提醒 / 升级随规则引擎（M5）。
 */

/** 问题四态（A3-10）：允许回退且留痕。 */
export const ISSUE_STATES = ["unassigned", "open", "in_progress", "done"] as const;

export const IssueStateSchema = z.enum(ISSUE_STATES).openapi("IssueState", {
  description: "问题四态（A3-10）：unassigned 未分组 / open 未解决 / in_progress 处理中 / done 已完成；允许回退且留痕",
});

export const ISSUE_STATE_NAMES: Record<(typeof ISSUE_STATES)[number], string> = {
  unassigned: "未分组",
  open: "未解决",
  in_progress: "处理中",
  done: "已完成",
};

/** 问题归类十项（A3-11 · C9）：机械部 / 采购部 / 规划部 / 项目部 / 物流原因 / 供应商原因 / 客户原因 / 客观原因 / 生产原因 / 其它原因。 */
export const ISSUE_CATEGORIES = [
  "机械部",
  "采购部",
  "规划部",
  "项目部",
  "物流原因",
  "供应商原因",
  "客户原因",
  "客观原因",
  "生产原因",
  "其它原因",
] as const;

export const IssueCategorySchema = z.enum(ISSUE_CATEGORIES).openapi("IssueCategory", {
  description: "问题归类（A3-11 · C9 字典十项）；一期为契约固定枚举，字典可维护随后",
});

/** 问题事件类型（A3-13）：创建 / 状态流转 / 解决方案 / 分派。 */
export const ISSUE_EVENT_TYPES = ["created", "state_change", "solution", "assignment"] as const;

export const IssueEventTypeSchema = z.enum(ISSUE_EVENT_TYPES).openapi("IssueEventType", {
  description: "问题事件类型（A3-13）：created 创建 / state_change 状态流转 / solution 解决方案 / assignment 分派",
});

/** 一条问题（A3-09 ~ A3-13）。 */
export const IssueSchema = z
  .object({
    id: UuidSchema,
    projectId: UuidSchema,
    taskId: UuidSchema.nullable().openapi({ description: "所属任务（可空：问题可不挂任务）" }),
    sourceReportId: UuidSchema.nullable().openapi({ description: "来源日报（A3-09：非空 = 由该日报自动生成，唯一；空 = 手工创建）" }),
    title: z.string().openapi({ description: "问题描述（自动生成 = 日报「现场发现问题」原文）" }),
    category: IssueCategorySchema,
    state: IssueStateSchema,
    reporterId: UuidSchema,
    reporterName: z.string().nullable().openapi({ description: "提出人显示名（= 来源日报提交人）" }),
    ownerDepartment: z.string().nullable().openapi({ description: "责任部门（A3-12 按归类自动分派；未分派 = null）" }),
    ownerId: UuidSchema.nullable().openapi({ description: "责任人（未分派 = null）" }),
    ownerName: z.string().nullable(),
    dueAt: DateTimeSchema.nullable().openapi({ description: "处理时限（ADR-026 SLA；一期仅落库）" }),
    raisedAt: DateOnlySchema.openapi({ description: "提出日期（自动生成 = 来源日报日期）" }),
    solution: z.string().nullable().openapi({ description: "解决方案 / 回复（A3-13）" }),
    closedBy: UuidSchema.nullable().openapi({ description: "关闭人（A3-15）" }),
    closedAt: DateTimeSchema.nullable(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
    version: VersionSchema,
  })
  .openapi("Issue", { description: "一条问题记录（由日报自动生成或手工创建）" });

export type Issue = z.infer<typeof IssueSchema>;

/** 问题列表查询（A21）：按状态 / 归类 / 任务筛选 + 分页；默认提出日期倒序。 */
export const IssueListQuerySchema = z
  .object({
    "filter[state]": z.string().optional().openapi({ description: "状态多值逗号分隔：unassigned / open / in_progress / done" }),
    "filter[category]": z.string().optional().openapi({ description: "归类多值逗号分隔（C9 十项）" }),
    "filter[taskId]": UuidSchema.optional().openapi({ description: "所属任务" }),
    "filter[reportId]": UuidSchema.optional().openapi({ description: "来源日报" }),
    q: z.string().optional().openapi({ description: "关键字（问题描述）" }),
    page: PageQuerySchema.shape.page,
    limit: PageQuerySchema.shape.limit,
  })
  .openapi("IssueListQuery", { description: "问题列表查询（状态 / 归类 / 任务 / 来源日报 + 关键字 + 分页；提出日期倒序）" });

export const IssueListResponseSchema = z
  .object({
    items: z.array(IssueSchema),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .openapi("IssueListResponse", { description: "问题列表（问题追踪表 / 问题看板共用；看板按四态分组由前端渲染）" });

/** 问题状态流转 / 解决方案回复 / 分派（A3-10 / A3-12 / A3-13）：乐观锁 version；允许回退（done → 其它态，closed_at 一并清空）。 */
export const IssueUpdateBodySchema = z
  .object({
    version: VersionSchema,
    state: IssueStateSchema.optional().openapi({ description: "目标状态（A3-10 四态；允许回退且留痕）" }),
    solution: z.string().min(1).max(2000).nullable().optional().openapi({ description: "解决方案 / 回复（null = 清空）" }),
    ownerDepartment: z.string().min(1).max(80).nullable().optional().openapi({ description: "责任部门（null = 取消分派部门）" }),
    ownerId: UuidSchema.nullable().optional().openapi({ description: "责任人（null = 取消责任人）" }),
    dueAt: DateTimeSchema.nullable().optional().openapi({ description: "处理时限（null = 清空）" }),
    note: z.string().min(1).max(2000).optional().openapi({ description: "本次处理的备注（A3-13 留痕）" }),
  })
  .openapi("IssueUpdateBody", { description: "问题更新（状态流转 / 解决方案 / 分派 / 时限；一次请求写一条事件）" });

export type IssueUpdateBody = z.infer<typeof IssueUpdateBodySchema>;

/** 问题事件（A3-13 处理过程留痕）：按时间正序下发。 */
export const IssueEventSchema = z
  .object({
    id: UuidSchema,
    issueId: UuidSchema,
    eventType: IssueEventTypeSchema,
    fromState: IssueStateSchema.nullable(),
    toState: IssueStateSchema.nullable(),
    actorId: UuidSchema,
    actorName: z.string().nullable(),
    note: z.string().nullable(),
    createdAt: DateTimeSchema,
  })
  .openapi("IssueEvent", { description: "问题处理过程留痕（A3-13：创建 / 状态流转 / 解决方案 / 分派）" });

/** 问题详情（问题 + 处理过程留痕）。 */
export const IssueDetailSchema = IssueSchema.extend({
  events: z.array(IssueEventSchema).openapi({ description: "处理过程留痕（时间正序）" }),
}).openapi("IssueDetail", { description: "问题详情 = 问题 + 处理过程留痕" });
