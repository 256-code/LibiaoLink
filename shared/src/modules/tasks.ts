import { z } from "../zod.ts";
import { DateTimeSchema, DateOnlySchema, PageQuerySchema, SortQuerySchema, UuidSchema, VersionSchema } from "../common/conventions.ts";
import { DocTypeSchema, PrioritySchema, StageKeySchema, TaskBaseStatusSchema, TaskDisplayStatusSchema } from "../common/dicts.ts";

/** 四格进度：0 / 0.25 / 0.5 / 0.75 / 1（写入即联动状态与完成日期，并写审计）。 */
export const TaskProgressSchema = z
  .union([z.literal(0), z.literal(0.25), z.literal(0.5), z.literal(0.75), z.literal(1)])
  .openapi("TaskProgress", { description: "任务进度四格：0 / 25% / 50% / 75% / 100%" });

/** 任务（tasks 表；displayStatus 为服务端派生，不写回存储）。 */
export const TaskSchema = z
  .object({
    id: UuidSchema,
    projectId: UuidSchema,
    stageKey: StageKeySchema,
    nodeId: UuidSchema.nullable(),
    title: z.string(),
    titleEn: z.string().nullable(),
    ownerId: UuidSchema,
    status: TaskBaseStatusSchema,
    displayStatus: TaskDisplayStatusSchema,
    progress: TaskProgressSchema,
    plannedStart: DateOnlySchema.nullable(),
    plannedEnd: DateOnlySchema.nullable(),
    actualEnd: DateOnlySchema.nullable(),
    estimatedDays: z.number().int().min(0).nullable(),
    headcount: z.number().int().min(0).nullable(),
    priority: PrioritySchema.nullable(),
    deliverable: DocTypeSchema.nullable(),
    note: z.string().nullable(),
    onTime: z.boolean().nullable(),
    changeRef: UuidSchema.nullable(),
    version: VersionSchema,
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .openapi("Task", { description: "任务（v0.2 §2.3 tasks；展示态派生规则见 §2.4）" });

export const TaskListQuerySchema = z.object({
  stage: StageKeySchema.optional(),
  "filter[ownerId]": UuidSchema.optional(),
  "filter[status]": z.string().optional().openapi({ description: "展示态（多值逗号分隔）：pending / active / done / overdue / early_done" }),
  q: z.string().optional().openapi({ description: "关键字（中英文任务描述）" }),
  page: PageQuerySchema.shape.page,
  limit: PageQuerySchema.shape.limit,
  sort: SortQuerySchema.optional(),
});

export const TaskListResponseSchema = z
  .object({
    items: z.array(TaskSchema),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .openapi("TaskListResponse");

/** 进度更新：progress 联动状态与 doneDate；回退同样写审计（前端只做展示）。 */
export const TaskProgressUpdateBodySchema = z
  .object({
    progress: TaskProgressSchema,
    actualEnd: DateOnlySchema.optional().openapi({ description: "完成日期；progress=1 且缺省时服务端按当天写入" }),
    note: z.string().max(2000).optional(),
    version: VersionSchema,
  })
  .openapi("TaskProgressUpdateBody");
