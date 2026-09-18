import { z } from "../zod.ts";
import { DateTimeSchema, DateOnlySchema, PageQuerySchema, SortQuerySchema, UuidSchema, VersionSchema } from "../common/conventions.ts";
import { ProjectStatusSchema, StageKeySchema } from "../common/dicts.ts";

/** 项目主数据（projects 表；API 字段 camelCase 与 DDL snake_case 的映射见 shared/README.md）。 */
export const ProjectSchema = z
  .object({
    id: UuidSchema,
    code: z.string().openapi({ example: "LB-2026-0001", description: "项目编号：服务端生成，创建请求不接收" }),
    name: z.string().openapi({ example: "XX 客户分拣项目" }),
    customer: z.string().nullable(),
    region: z.string().openapi({ description: "项目落地地区（字典 region；缺省「未分类」）" }),
    projectType: z.string().openapi({ description: "项目类型（字典 project_type；主题色随字典元数据下发，前端不硬编码）" }),
    ownerId: UuidSchema,
    managerId: UuidSchema.nullable(),
    stageKey: StageKeySchema,
    status: ProjectStatusSchema,
    description: z.string().nullable(),
    version: VersionSchema,
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .openapi("Project", { description: "项目（v0.2 §2.3 projects）" });

/** 项目总览四格：当前阶段 / 逾期 / 已完成 / 总数。 */
export const ProjectSummarySchema = z
  .object({
    projectId: UuidSchema,
    currentStage: StageKeySchema,
    overdue: z.number().int().min(0),
    done: z.number().int().min(0),
    total: z.number().int().min(0),
  })
  .openapi("ProjectSummary", { description: "项目总览统计（任务派生，口径见 v0.2 §2.4）" });

/** 列表查询：多维筛选 + 分页 + 排序；多值筛选用英文逗号分隔（与 v0.2 §8.2 filter[...] 口径一致）。 */
export const ProjectListQuerySchema = z.object({
  "filter[region]": z.string().optional().openapi({ description: "地区（多值逗号分隔）" }),
  "filter[projectType]": z.string().optional().openapi({ description: "项目类型（多值逗号分隔）" }),
  "filter[ownerId]": UuidSchema.optional(),
  "filter[stageKey]": z.string().optional().openapi({ description: "阶段 key（多值逗号分隔）" }),
  "filter[status]": z.string().optional().openapi({ description: "项目状态（多值逗号分隔）" }),
  q: z.string().optional().openapi({ description: "关键字（编号 / 名称 / 客户）" }),
  page: PageQuerySchema.shape.page,
  limit: PageQuerySchema.shape.limit,
  sort: SortQuerySchema.optional(),
});

export const ProjectListResponseSchema = z
  .object({
    items: z.array(ProjectSchema),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .openapi("ProjectListResponse");

/** 创建项目：编号由服务端生成；默认按当前已发布蓝图导入节点（导入即快照）。 */
export const ProjectCreateBodySchema = z
  .object({
    name: z.string().min(1).max(200),
    customer: z.string().max(200).optional(),
    region: z.string().min(1).max(100),
    projectType: z.string().min(1).max(100),
    ownerId: UuidSchema,
    managerId: UuidSchema.optional(),
    stageKey: StageKeySchema.optional(),
    description: z.string().max(2000).optional(),
    blueprintVersion: z.number().int().positive().optional().openapi({ description: "导入的蓝图版本；缺省 = 当前已发布版本" }),
  })
  .openapi("ProjectCreateBody");

export const ProjectUpdateBodySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    customer: z.string().max(200).nullable().optional(),
    region: z.string().min(1).max(100).optional(),
    projectType: z.string().min(1).max(100).optional(),
    ownerId: UuidSchema.optional(),
    managerId: UuidSchema.nullable().optional(),
    stageKey: StageKeySchema.optional(),
    status: ProjectStatusSchema.optional(),
    description: z.string().max(2000).nullable().optional(),
    version: VersionSchema,
  })
  .openapi("ProjectUpdateBody");

/** 首页侧边栏计数（facets）：与列表同一过滤口径（v0.2 §8.2）。 */
export const ProjectFacetsSchema = z
  .object({
    total: z.number().int().min(0),
    region: z.record(z.string(), z.number().int().min(0)),
    projectType: z.record(z.string(), z.number().int().min(0)),
    ownerId: z.record(z.string(), z.number().int().min(0)),
    stageKey: z.record(z.string(), z.number().int().min(0)),
    status: z.record(z.string(), z.number().int().min(0)),
  })
  .openapi("ProjectFacets", { description: "首页分类计数；计数与列表同口径（同筛选条件）" });
