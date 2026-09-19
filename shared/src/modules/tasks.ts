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

/**
 * 任务创建（A10；2026-09-19 定案入契约）：从任务节点库 / 任务模板生成或手工创建。
 * 默认值：状态 pending、进度 0；headcount / priority 可空（Q8 定案）。
 */
export const TaskCreateBodySchema = z
  .object({
    stageKey: StageKeySchema,
    title: z.string().min(1).max(200).openapi({ example: "货架组装", description: "任务描述（节点名称）" }),
    titleEn: z.string().max(200).nullable().optional(),
    taskNodeId: UuidSchema.optional().openapi({
      description: "来源任务节点库节点 id：用于按项目判重（同一节点在项目里只留一份，重复返回 409）并建立节点关联",
    }),
    ownerId: UuidSchema.optional().openapi({ description: "任务负责人；缺省 = 项目项目经理（projects.manager_id）兜底" }),
    plannedStart: DateOnlySchema.nullable().optional(),
    plannedEnd: DateOnlySchema.nullable().optional(),
    estimatedDays: z.number().int().min(0).nullable().optional(),
    headcount: z.number().int().min(0).nullable().optional(),
    priority: PrioritySchema.nullable().optional(),
    deliverable: DocTypeSchema.nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .openapi("TaskCreateBody", { description: "创建任务（进度默认 0、状态默认 pending；从模板生成时与整套添加同口径）" });

/** 任务编辑（A10）：仅开放未锁定字段；任务描述 / 成果文件按 A1-17 生成后锁定，进度走 /progress。 */
export const TaskUpdateBodySchema = z
  .object({
    ownerId: UuidSchema.optional(),
    plannedStart: DateOnlySchema.nullable().optional(),
    plannedEnd: DateOnlySchema.nullable().optional(),
    estimatedDays: z.number().int().min(0).nullable().optional(),
    headcount: z.number().int().min(0).nullable().optional(),
    priority: PrioritySchema.nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    version: VersionSchema,
  })
  .openapi("TaskUpdateBody", { description: "编辑任务（乐观锁 version 必传；任务描述 / 成果文件 / 阶段不在本接口）" });

/** 从任务模板批量生成任务（「整套添加」）：按节点判重，已存在默认跳过。 */
export const TaskCreateFromTemplateBodySchema = z
  .object({
    templateId: UuidSchema,
    nodeIds: z.array(UuidSchema).optional().openapi({ description: "只添加模板内的部分节点（缺省 = 模板全部节点）；必须是该模板包含的节点，否则 400" }),
    skipExisting: z.boolean().default(true).openapi({ description: "已存在的节点跳过并计入 skipped（默认 true）；false 时遇重复返回 409" }),
    ownerId: UuidSchema.optional().openapi({ description: "任务负责人；缺省 = 项目项目经理兜底" }),
  })
  .openapi("TaskCreateFromTemplateBody", { description: "从任务模板生成任务（批量；同一节点在项目里只留一份）" });

export const TaskCreateFromTemplateResponseSchema = z
  .object({
    created: z.array(TaskSchema),
    skipped: z
      .array(z.object({ nodeId: UuidSchema, taskId: UuidSchema }))
      .openapi({ description: "skipExisting=true 时跳过的节点及其已存在的任务" }),
  })
  .openapi("TaskCreateFromTemplateResponse");
