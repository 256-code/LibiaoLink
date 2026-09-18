import { z } from "../zod.ts";
import { DateTimeSchema, DateOnlySchema, PageQuerySchema, SortQuerySchema, UuidSchema, VersionSchema } from "../common/conventions.ts";
import { ProjectStatusSchema, StageKeySchema } from "../common/dicts.ts";

/** 项目主数据（projects 表；API 字段 camelCase 与 DDL snake_case 的映射见 shared/README.md）。 */
export const ProjectSchema = z
  .object({
    id: UuidSchema,
    code: z.string().openapi({ example: "CNBJ-20260708-0001", description: "项目编号：创建人填写（建后可修改）；服务端只校验唯一性，不生成；格式仅前端提示" }),
    seqNo: z.number().int().positive().openapi({ example: 1, description: "项目序号：服务端创建时分配（全库唯一、不可修改、不回收；与项目编号一一对应同一项目）；卡片等展示场景两位补零，列表支持 sort=seqNo:asc|desc" }),
    name: z.string().openapi({ example: "XX 客户分拣项目" }),
    customer: z.string().nullable(),
    region: z.string().openapi({ description: "项目落地地区（字典 region；缺省「未分类」）" }),
    projectType: z.string().openapi({ description: "项目类型（字典 project_type；主题色随字典元数据下发，前端不硬编码）" }),
    managerId: UuidSchema,
    managerName: z.string().nullable().openapi({
      description: "项目经理姓名：服务端按 managerId 解析后随行下发（列表 / 详情 / 创建与编辑返回均含，免前端二次查目录）；人员停用 / 离职后仍返回姓名，取不到时为 null（前端显示「—」）",
    }),
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

/**
 * 列表查询：多维筛选 + 分页 + 排序；多值筛选用英文逗号分隔（与 v0.2 §8.2 filter[...] 口径一致）。
 * A1（Push 49）：filter[timeFrom] / filter[timeTo] 为 DateOnly 闭区间，按 Asia/Shanghai 日界截断
 * —— 下界取当日 00:00:00+08:00（含）、上界取次日 00:00:00+08:00（不含）；一期维度映射 projects.updated_at，
 * 语义以 v0.3 §7 第 4 项「项目时间」ADR 为准（主数据变更 / 阶段推进 / 任务变更触发，文件与日报不触发）。
 * 边界：只传一端合法；timeFrom 晚于 timeTo 或格式非法返回 400 VALIDATION_FAILED（不返回空列表）。
 * 列表与 facets 共用本 schema 与同一 QueryBuilder（禁止两套 SQL）。
 * 缺省排序：updatedAt:desc（项目最近活动在前）；排序白名单 updatedAt / seqNo。
 */
export const ProjectListQuerySchema = z
  .object({
    "filter[region]": z.string().optional().openapi({ description: "地区（多值逗号分隔）" }),
    "filter[projectType]": z.string().optional().openapi({ description: "项目类型（多值逗号分隔）" }),
    "filter[managerId]": z.string().optional().openapi({ description: "项目经理（多值逗号分隔）" }),
    "filter[stageKey]": z.string().optional().openapi({ description: "阶段 key（多值逗号分隔）" }),
    "filter[status]": z.string().optional().openapi({ description: "项目状态（多值逗号分隔）" }),
    "filter[timeFrom]": DateOnlySchema.optional().openapi({
      description: "项目时间下界（YYYY-MM-DD，含当日；按 Asia/Shanghai 取当日 00:00:00+08:00）",
    }),
    "filter[timeTo]": DateOnlySchema.optional().openapi({
      description: "项目时间上界（YYYY-MM-DD，含当日；按次日 00:00:00+08:00 不含截断）",
    }),
    q: z.string().optional().openapi({ description: "关键字（编号 / 名称 / 客户 / 序号）" }),
    page: PageQuerySchema.shape.page,
    limit: PageQuerySchema.shape.limit,
    sort: SortQuerySchema.optional().openapi({
      description: "排序（field:asc|desc）；一期白名单 updatedAt / seqNo；缺省 = updatedAt:desc（项目最近活动在前）",
    }),
  })
  .openapi("ProjectListQuery", {
    description: "首页列表筛选（多维 + 时间闭区间 + 分页 + 排序）；时间区间按 Asia/Shanghai 日界，timeFrom 晚于 timeTo 返回 400",
  });

export const ProjectListResponseSchema = z
  .object({
    items: z.array(ProjectSchema),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .openapi("ProjectListResponse");

/** 创建项目：编号由创建人填写（服务端保证唯一性）；项目序号由服务端分配（创建请求不传 seqNo）；默认按当前已发布蓝图导入节点（导入即快照）。 */
export const ProjectCreateBodySchema = z
  .object({
    code: z.string().min(1).max(50).openapi({ example: "CNBJ-20260708-0001", description: "项目编号：创建人填写；格式仅前端提示，服务端不做强校验；重复返回 409 PROJECT_CODE_EXISTS" }),
    name: z.string().min(1).max(200),
    customer: z.string().max(200).optional(),
    region: z.string().min(1).max(100),
    projectType: z.string().min(1).max(100),
    managerId: UuidSchema,
    stageKey: StageKeySchema.optional(),
    description: z.string().max(2000).optional(),
    blueprintVersion: z.number().int().positive().optional().openapi({ description: "导入的蓝图版本；缺省 = 当前已发布版本" }),
  })
  .openapi("ProjectCreateBody", { description: "创建项目：项目序号 seqNo 不接受传入，由服务端分配并随响应返回" });

/** 项目更新：code 可选（编号建后可修改）；修改时同样校验唯一性。 */
export const ProjectUpdateBodySchema = z
  .object({
    code: z.string().min(1).max(50).optional().openapi({ example: "CNBJ-20260708-0001", description: "项目编号：建后可修改；同样校验唯一性，重复返回 409 PROJECT_CODE_EXISTS" }),
    name: z.string().min(1).max(200).optional(),
    customer: z.string().max(200).nullable().optional(),
    region: z.string().min(1).max(100).optional(),
    projectType: z.string().min(1).max(100).optional(),
    managerId: UuidSchema.optional(),
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
    managerId: z.record(z.string(), z.number().int().min(0)),
    stageKey: z.record(z.string(), z.number().int().min(0)),
    status: z.record(z.string(), z.number().int().min(0)),
  })
  .openapi("ProjectFacets", { description: "首页分类计数；计数与列表同口径（同筛选条件）；五组固定返回，前端按需展示（A6）" });

/**
 * 项目软删（A5）：If-Match 回传当前 version 防误删（DELETE 不带 body，避免代理丢载荷）。
 * 口径：列表 / 详情 / facets / 搜索 / 导出统一不可见；seqNo 不回收、code 唯一性保留（同编号再建仍 409 PROJECT_CODE_EXISTS）；
 * 非成员 / 不存在统一 404；仅项目经理 / 管理员，写审计（action=project.delete）。
 */
export const ProjectDeleteHeadersSchema = z
  .object({
    "If-Match": z
      .string()
      .regex(/^\d+$/)
      .openapi({
        description: "项目当前 version（防误删）；缺失或非数字 → 400 VALIDATION_FAILED，不匹配 → 409 VERSION_CONFLICT",
        example: "3",
      }),
  })
  .openapi("ProjectDeleteHeaders");
