import { z } from "../zod.ts";
import { DateOnlySchema, DateTimeSchema, UuidSchema, VersionSchema } from "../common/conventions.ts";
import { PrioritySchema, StageKeySchema, TaskDisplayStatusSchema } from "../common/dicts.ts";
import { TaskProgressSchema } from "./tasks.ts";
import { IssueCategoryListSchema, IssueStateSchema } from "./issues.ts";

/**
 * 工作台（M6-05 第一刀 · 系统功能书 A6-01 / A6-03）：跨项目的个人聚合读面 ——
 * 「我的任务」三组（今日待办 / 即将到期 / 已逾期）与「我的问题」（我处理 / 我提出的）。
 *
 * 口径（第一刀，差异登记见 server/src/modules/workspace/README.md 与 技术设计v0.3 §3.7）：
 * - 「我的任务」= 任务负责人名单内任一位是我（A6-01 · Push 136 多负责人口径），且任务未完成（status != done）、未删除；
 *   只含预计完成日期（plannedEnd）在「今天起 7 天内」窗口内（含已逾期）的任务：
 *   已逾期 = plannedEnd < 今天；今日待办 = plannedEnd = 今天；即将到期 = 今天 < plannedEnd ≤ 今天 + 7 天。
 *   未排期（plannedEnd 为空）与 7 天以外的远期任务不进工作台；「我参与的任务」口径未定（差异登记，本刀不含）。
 * - 归档项目（ADR-027 冻结）与软删项目下的任务 / 问题一律不进工作台（不再催办 / 不可见）。
 * - 「我的问题」= 我处理（ownerId = 我）与我提出的（reporterId = 我）两个清单；同一问题两边都命中时两个清单都出现。
 * - 排序：任务组内按 plannedEnd 升序、同日期按 id 升序；问题未关闭（state != done）在前 —— 按提出日期（raisedAt）升序、
 *   id 升序；已完成后置。
 * - 记录级可见性：只含对我可见的项目（ADR-011；PERMISSION_ENFORCED 关闭期等价全量）。
 */

/** 工作台任务三组（A6-01）：today 今日待办 / upcoming 即将到期 / overdue 已逾期。 */
export const WORKSPACE_TASK_GROUPS = ["today", "upcoming", "overdue"] as const;

export const WorkspaceTaskGroupSchema = z.enum(WORKSPACE_TASK_GROUPS).openapi("WorkspaceTaskGroup", {
  description: "工作台任务分组（基准日 = Asia/Shanghai 今天）：today 今日待办 / upcoming 即将到期 / overdue 已逾期",
});

export type WorkspaceTaskGroup = z.infer<typeof WorkspaceTaskGroupSchema>;

/** 「即将到期」窗口（天）：今天起 7 天内（含第 7 天）—— 数值为第一刀建议值（原文未定），随前端联调（M6-06）复评。 */
export const WORKSPACE_UPCOMING_DAYS = 7;

/** 工作台任务项（跨项目：带项目编号 / 名称，不带文件摘要与变更关联 —— 详情按需取）。 */
export const WorkspaceTaskItemSchema = z
  .object({
    id: UuidSchema,
    projectId: UuidSchema,
    projectCode: z.string().openapi({ description: "项目编号（跨项目列表直接展示）" }),
    projectName: z.string(),
    stageKey: StageKeySchema.nullable().openapi({ description: "所属阶段；null = 「未分组」（A15）" }),
    title: z.string(),
    titleEn: z.string().nullable(),
    displayStatus: TaskDisplayStatusSchema.openapi({
      description: "展示五态（A1-06 读时派生，含显式覆盖 · Push 179）：待开始 / 进行中 / 已完成 / 提前完成 / 已延期",
    }),
    progress: TaskProgressSchema,
    plannedStart: DateOnlySchema.nullable(),
    plannedEnd: DateOnlySchema.nullable().openapi({ description: "预计完成日期（分组依据；三组内必非空）" }),
    actualEnd: DateOnlySchema.nullable(),
    ownerIds: z.array(UuidSchema).openapi({ description: "任务负责人（多值；本组内必含会话用户）" }),
    ownerNames: z.array(z.string().nullable()).openapi({ description: "负责人姓名（与 ownerIds 同下标；缺失为 null）" }),
    priority: PrioritySchema.nullable(),
  })
  .openapi("WorkspaceTaskItem", { description: "工作台任务项（跨项目；按预计完成日期落入三组之一）" });

export const WorkspaceTasksSchema = z
  .object({
    today: z.array(WorkspaceTaskItemSchema).openapi({ description: "今日待办：plannedEnd = 今天且未完成" }),
    upcoming: z.array(WorkspaceTaskItemSchema).openapi({ description: "即将到期：今天 < plannedEnd ≤ 今天 + 7 天且未完成" }),
    overdue: z.array(WorkspaceTaskItemSchema).openapi({ description: "已逾期：plannedEnd < 今天且未完成" }),
  })
  .openapi("WorkspaceTasks", { description: "我的任务三组（A6-01；组内按 plannedEnd 升序、id 升序）" });

/** 工作台问题项（跨项目；保留 version —— 工作台内快速流转 / 关闭确认时带乐观锁）。 */
export const WorkspaceIssueItemSchema = z
  .object({
    id: UuidSchema,
    projectId: UuidSchema,
    projectCode: z.string(),
    projectName: z.string(),
    taskId: UuidSchema.nullable().openapi({ description: "所属任务（可空：问题可不挂任务）" }),
    title: z.string(),
    categories: IssueCategoryListSchema,
    state: IssueStateSchema,
    reporterId: UuidSchema,
    reporterName: z.string().nullable(),
    ownerDepartment: z.string().nullable(),
    ownerId: UuidSchema.nullable(),
    ownerName: z.string().nullable(),
    raisedAt: DateOnlySchema,
    updatedAt: DateTimeSchema,
    version: VersionSchema,
  })
  .openapi("WorkspaceIssueItem", { description: "工作台问题项（跨项目）" });

export const WorkspaceIssuesSchema = z
  .object({
    handling: z.array(WorkspaceIssueItemSchema).openapi({ description: "我处理的（ownerId = 会话用户）" }),
    raised: z.array(WorkspaceIssueItemSchema).openapi({ description: "我提出的（reporterId = 会话用户）" }),
  })
  .openapi("WorkspaceIssues", {
    description: "我的问题两栏（A6-03）；同一问题两边都命中时两个清单都出现；未关闭在前、已完成后置",
  });

export const WorkspaceResponseSchema = z
  .object({
    today: DateOnlySchema.openapi({ description: "分组基准日（Asia/Shanghai 今天 · ADR-028），前端可据此渲染「今天」标注" }),
    myTasks: WorkspaceTasksSchema,
    myIssues: WorkspaceIssuesSchema,
  })
  .openapi("WorkspaceResponse", { description: "工作台聚合（M6-05 第一刀）：我的任务三组 + 我的问题两栏" });

export type WorkspaceTaskItem = z.infer<typeof WorkspaceTaskItemSchema>;
export type WorkspaceIssueItem = z.infer<typeof WorkspaceIssueItemSchema>;
export type WorkspaceResponse = z.infer<typeof WorkspaceResponseSchema>;
