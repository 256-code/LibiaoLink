import { z } from "../zod.ts";
import { DateOnlySchema, DateTimeSchema, PageQuerySchema, UuidSchema, VersionSchema } from "../common/conventions.ts";
import { IssueCategorySchema } from "./issues.ts";

/**
 * 日报契约（M6-01 / M6-02 · A3-01 / A3-02 / A3-03 / A3-04 / A3-08 / A3-09）。
 * 口径来源：系统功能书.md A3「日报与问题跟踪」；前端功能需求.md §3.8 A21（接口提案）；
 * 技术设计v0.2 §2.2 / §11.1；技术设计v0.3 §3.7（M6-01 / M6-02）。表口径见 database/migrations/0023_daily_reports_issues.sql。
 * 一期口径（差异登记）：一人一项目一天一条 —— 草稿 / 提交 / 补填共用同一行；补填 = 对过去日期首次提交；
 * 不做版本历史（「补填保留原始提交记录」以状态 + 提交时间表达，随迭代再评估）。
 */

/** 日报状态（A3-02）：draft / submitted / supplement。 */
export const DAILY_REPORT_STATES = ["draft", "submitted", "supplement"] as const;

export const DailyReportStateSchema = z.enum(DAILY_REPORT_STATES).openapi("DailyReportState", {
  description: "日报状态（A3-02）：draft 草稿 / submitted 已提交 / supplement 补填（对过去日期首次提交）",
});

/** 日报写入状态（提交 / 暂存）：补填状态由服务端按日期推导，不接受客户端直接指定。 */
export const DailyReportWriteStateSchema = z.enum(["draft", "submitted"]).openapi("DailyReportWriteState", {
  description: "日报写入状态（A3-02）：draft 暂存草稿 / submitted 提交（对过去日期提交 = 服务端自动标记 supplement）",
});

/** 一条日报（A3-01 表单字段 + 系统字段）。 */
export const DailyReportSchema = z
  .object({
    id: UuidSchema,
    projectId: UuidSchema,
    authorId: UuidSchema,
    authorName: z.string().nullable().openapi({ description: "提交人显示名（A3-01 系统字段）" }),
    date: DateOnlySchema.openapi({ description: "填报日期（A3-01「时间」）" }),
    state: DailyReportStateSchema,
    headcount: z.number().int().min(0).nullable().openapi({ description: "今日施工人数（A3-03 默认带上次填报值，可修改）" }),
    doneWork: z.string().openapi({ description: "当日完成工作（A3-04 必填；关联任务后回写任务「项目进展描述」，A3-08）" }),
    plan: z.string().nullable().openapi({ description: "明日计划" }),
    foundIssue: z.string().nullable().openapi({ description: "现场发现问题（非空 → 提交时自动生成问题，A3-09 幂等）" }),
    issueCategory: IssueCategorySchema.nullable().openapi({ description: "问题归类（C9 十项；「现场发现问题」非空时必填，A3-04）" }),
    suggestion: z.string().nullable().openapi({ description: "解决方案或建议" }),
    taskIds: z.array(UuidSchema).openapi({ description: "关联任务（A3-03 多选；用于回写任务进展）" }),
    taskTitles: z.array(z.string()).openapi({ description: "关联任务标题（与 taskIds 同下标）" }),
    submittedAt: DateTimeSchema.nullable().openapi({ description: "提交时间（草稿为空）" }),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
    version: VersionSchema,
  })
  .openapi("DailyReport", { description: "一条日报（A3-01 全字段 + 系统字段）" });

export type DailyReport = z.infer<typeof DailyReportSchema>;

/** 新报一天的日报（A3-01 / A3-02；同项目 + 同人 + 同日期已存在 → 409 REPORT_ALREADY_EXISTS，改用编辑）。 */
export const DailyReportCreateBodySchema = z
  .object({
    date: DateOnlySchema.openapi({ description: "填报日期（当天或过去日期 = 补填；未来日期 400）" }),
    state: DailyReportWriteStateSchema.default("submitted").openapi({ description: "draft 暂存 / submitted 提交（缺省 submitted）" }),
    headcount: z.number().int().min(0).max(100000).optional().openapi({ description: "今日施工人数（缺省为空）" }),
    doneWork: z.string().min(1).max(2000).openapi({ description: "当日完成工作（A3-04 必填）" }),
    plan: z.string().min(1).max(2000).optional().openapi({ description: "明日计划" }),
    foundIssue: z.string().min(1).max(2000).optional().openapi({ description: "现场发现问题（非空时问题归类必填；提交时自动生成问题，A3-09）" }),
    issueCategory: IssueCategorySchema.optional().openapi({ description: "问题归类（C9 十项）" }),
    suggestion: z.string().min(1).max(2000).optional().openapi({ description: "解决方案或建议" }),
    taskIds: z.array(UuidSchema).max(200).optional().openapi({ description: "关联任务（A3-03 多选；须属本项目）" }),
  })
  .superRefine((value, ctx) => {
    if (value.foundIssue !== undefined && value.foundIssue.trim().length > 0 && value.issueCategory === undefined) {
      ctx.addIssue({ code: "custom", message: "「现场发现问题」非空时问题归类必填（A3-04）", path: ["issueCategory"] });
    }
  })
  .openapi("DailyReportCreateBody", { description: "新报一天日报（草稿 / 提交）；补填由服务端按日期推导" });

export type DailyReportCreateBody = z.infer<typeof DailyReportCreateBodySchema>;

/** 编辑已存在的日报行（草稿继续编辑 / 已提交修改 / 提交草稿）：乐观锁 version。date 不可改（唯一键组成）。 */
export const DailyReportUpdateBodySchema = z
  .object({
    version: VersionSchema,
    state: DailyReportWriteStateSchema.optional().openapi({ description: "draft → submitted = 提交草稿（已提交行不允许退回草稿）" }),
    headcount: z.number().int().min(0).max(100000).nullable().optional().openapi({ description: "今日施工人数（null = 清空）" }),
    doneWork: z.string().min(1).max(2000).optional(),
    plan: z.string().min(1).max(2000).nullable().optional().openapi({ description: "明日计划（null = 清空）" }),
    foundIssue: z.string().min(1).max(2000).nullable().optional().openapi({ description: "现场发现问题（null = 清空；已生成问题不随清空撤回）" }),
    issueCategory: IssueCategorySchema.nullable().optional(),
    suggestion: z.string().min(1).max(2000).nullable().optional(),
    taskIds: z.array(UuidSchema).max(200).optional().openapi({ description: "关联任务整体替换（缺省 = 不改）" }),
  })
  .superRefine((value, ctx) => {
    if (value.foundIssue !== undefined && value.foundIssue !== null && value.foundIssue.trim().length > 0 && value.issueCategory === undefined) {
      ctx.addIssue({ code: "custom", message: "「现场发现问题」非空时问题归类必填（A3-04）", path: ["issueCategory"] });
    }
  })
  .openapi("DailyReportUpdateBody", { description: "编辑日报（乐观锁 version；date 不可改）" });

export type DailyReportUpdateBody = z.infer<typeof DailyReportUpdateBodySchema>;

/** 日报列表查询（A21）：按日期区间 / 状态 / 提交人筛选 + 分页；默认按日期倒序。 */
export const DailyReportListQuerySchema = z
  .object({
    "filter[dateFrom]": DateOnlySchema.optional().openapi({ description: "日期下界（含）" }),
    "filter[dateTo]": DateOnlySchema.optional().openapi({ description: "日期上界（含）" }),
    "filter[state]": z.string().optional().openapi({ description: "状态多值逗号分隔：draft / submitted / supplement" }),
    "filter[authorId]": UuidSchema.optional().openapi({ description: "提交人" }),
    page: PageQuerySchema.shape.page,
    limit: PageQuerySchema.shape.limit,
  })
  .openapi("DailyReportListQuery", { description: "日报列表查询（日期区间 / 状态 / 提交人 + 分页；日期倒序）" });

export const DailyReportListResponseSchema = z
  .object({
    items: z.array(DailyReportSchema),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .openapi("DailyReportListResponse", { description: "日报列表（项目内成员可见）" });
