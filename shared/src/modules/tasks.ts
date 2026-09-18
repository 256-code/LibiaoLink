import { z } from "../zod.ts";
import { DateTimeSchema, DateOnlySchema, PageQuerySchema, SortQuerySchema, UuidSchema, VersionSchema } from "../common/conventions.ts";
import { DocTypeSchema, FileStatusSchema, PrioritySchema, StageKeySchema, TaskBaseStatusSchema, TaskDisplayStatusSchema } from "../common/dicts.ts";

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

/** 任务随行文件摘要（A7）：列表不下发文件名数组（省载荷、免 N+1），文件名清单只在详情接口给。 */
export const TaskFileSummarySchema = z
  .object({
    total: z.number().int().min(0),
    draft: z.number().int().min(0).openapi({ description: "未定档（draft）数量；>0 时完成门禁放行但返回 warning 并触发 R02" }),
    final: z.number().int().min(0).openapi({ description: "已定档（final / changed）数量；门禁按 node_requirements 逐 doc_type 统计" }),
  })
  .openapi("TaskFileSummary");

/** 任务文件摘要项（详情接口随行下发；列表不带）。 */
export const TaskFileBriefSchema = z
  .object({
    id: UuidSchema,
    name: z.string(),
    status: FileStatusSchema,
    docType: DocTypeSchema.nullable(),
  })
  .openapi("TaskFileBrief");

/**
 * 任务列表项（A7）：表格 15 列 + 内联摘要（负责人姓名 / 变更摘要 / 文件摘要）。
 * 前端不再逐行反查 /users 或 /files，避免 N+1；changeRef 只在详情给。
 */
export const TaskListItemSchema = TaskSchema.omit({ changeRef: true })
  .extend({
    ownerName: z.string().openapi({ description: "负责人姓名（users.display_name 随行下发）" }),
    changeSummary: z.string().nullable().openapi({ description: "变更摘要（列表用短文本；详情用 changeRef 跳变更记录）" }),
    fileSummary: TaskFileSummarySchema,
  })
  .openapi("TaskListItem");

/** 任务详情（抽屉全字段，A7）：含变更指针与文件清单；列表走 TaskListItem，抽屉打开时按需请求。 */
export const TaskDetailSchema = TaskSchema.extend({
  ownerName: z.string(),
  changeSummary: z.string().nullable(),
  files: z.array(TaskFileBriefSchema),
}).openapi("TaskDetail", { description: "任务详情（M3-01；列表 → 详情不再依赖列表随行数据）" });

/** 任务排序白名单（A8）：字段白名单 + asc / desc，多项逗号分隔；白名单外字段返回 400（不静默降级）。 */
export const TaskSortSchema = z
  .string()
  .regex(
    /^(plannedStart|plannedEnd|actualEnd|progress|title|createdAt)(:(asc|desc))?(,(plannedStart|plannedEnd|actualEnd|progress|title|createdAt)(:(asc|desc))?)*$/,
  )
  .openapi({
    description:
      "排序：sort=field:asc,field2:desc；字段白名单 plannedStart / plannedEnd / actualEnd / progress / title / createdAt（白名单外 400）",
    example: "plannedEnd:asc",
  });

/**
 * 任务列表查询。
 * A8 排序：sort 字段白名单 plannedStart / plannedEnd / actualEnd / progress / title / createdAt，白名单外返回 400；
 * 不传 sort 时为默认顺序 —— 阶段顺序（STAGE_KEYS 序）+ 组内 plannedStart ASC NULLS LAST, created_at ASC, id ASC
 * （id 兜底保证稳定，分页不跳行；一期不新增 tasks.seq）。
 */
export const TaskListQuerySchema = z
  .object({
    stage: StageKeySchema.optional(),
    "filter[ownerId]": UuidSchema.optional(),
    "filter[status]": z.string().optional().openapi({ description: "展示态（多值逗号分隔）：pending / active / done / overdue / early_done" }),
    q: z.string().optional().openapi({ description: "关键字（中英文任务描述）" }),
    page: PageQuerySchema.shape.page,
    limit: PageQuerySchema.shape.limit,
    sort: TaskSortSchema.optional(),
  })
  .openapi("TaskListQuery", {
    description: "任务列表查询（分页 + 单阶段 / 负责人 / 展示态筛选 + 白名单排序）；缺省顺序 = 阶段序 + plannedStart ASC NULLS LAST, created_at ASC, id ASC",
  });

export const TaskListResponseSchema = z
  .object({
    items: z.array(TaskListItemSchema),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .openapi("TaskListResponse", { description: "任务列表（items 为 TaskListItem：表格直接渲染 + 内联摘要）" });

/** 进度更新：progress 联动状态与 doneDate；回退同样写审计（前端只做展示）。 */
export const TaskProgressUpdateBodySchema = z
  .object({
    progress: TaskProgressSchema,
    actualEnd: DateOnlySchema.optional().openapi({ description: "完成日期；progress=1 且缺省时服务端按当天写入" }),
    note: z.string().max(2000).optional(),
    version: VersionSchema,
  })
  .openapi("TaskProgressUpdateBody");
