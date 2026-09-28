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
    managerIds: z.array(UuidSchema).min(1).openapi({
      description: "项目经理（A22 · Push 136：一位也可、可多位）：至少一位、数组顺序 = 展示顺序（前端按「、」连接展示）；与 managerNames 同下标一一对应",
    }),
    managerNames: z.array(z.string().nullable()).openapi({
      description: "项目经理姓名数组：服务端按 managerIds 解析后随行下发，与 managerIds 同下标一一对应（列表 / 详情 / 创建与编辑返回均含，免前端二次查目录）；人员停用 / 离职后仍返回姓名，取不到时该位为 null（前端显示「—」）",
    }),
    stageKey: StageKeySchema,
    status: ProjectStatusSchema,
    description: z.string().nullable(),
    version: VersionSchema,
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .openapi("Project", { description: "项目（v0.2 §2.3 projects）" });

/**
 * 项目总览汇总卡：最慢阶段 / 最新阶段 / 逾期 / 已完成 / 总数。
 * 2026-09-24 定案：原 `currentStage`（= projects.stage_key 项目当前阶段）随本刀下线 —— 汇总卡改用两个任务派生字段；
 * 「未分组」任务（stage_key 为空）不参与阶段判定，只进三个计数。
 */
export const ProjectSummarySchema = z
  .object({
    projectId: UuidSchema,
    slowestStage: StageKeySchema.nullable().openapi({
      description: "最慢阶段：按九阶段顺序**第一个「存在未完成任务」的阶段**；全部完成或项目无任务 = null（前端显示「—」/「全部完成」按 done / total 判断）",
    }),
    latestStage: StageKeySchema.nullable().openapi({
      description: "最新阶段（最快）：**已动工任务**（基础态 active / done，即进度 ≥ 1 格）中**阶段序最靠后**的那一个阶段；尚无任务动工 = null",
    }),
    overdue: z.number().int().min(0),
    done: z.number().int().min(0),
    total: z.number().int().min(0),
  })
  .openapi("ProjectSummary", { description: "项目总览汇总卡统计（任务派生；口径见 v0.2 §2.4 与前端功能需求 §3.4）" });

/**
 * 列表查询：多维筛选 + 分页 + 排序；多值筛选用英文逗号分隔（与 v0.2 §8.2 filter[...] 口径一致）。
 * A1（Push 49；**Push 175 维度修订**）：filter[timeFrom] / filter[timeTo] 为 DateOnly 闭区间，按 Asia/Shanghai 日界截断
 * —— 下界取当日 00:00:00+08:00（含）、上界取次日 00:00:00+08:00（不含）；维度映射 **projects.created_at（项目创建时间）**
 * （业务定调 2026-09-23：「这个筛选是按照项目创建时间筛选」；原「最近活动时间（updated_at）」口径随之作废，
 * 卡片上展示的也是创建时间 —— 两处同一维度，不再出现「筛选看活动、卡片看创建」的错位）。
 * 边界：只传一端合法；timeFrom 晚于 timeTo 或格式非法返回 400 VALIDATION_FAILED（不返回空列表）。
 * 列表与 facets 共用本 schema 与同一 QueryBuilder（禁止两套 SQL）。
 * 缺省排序（**Push 175 修订**）：createdAt:desc（最近创建的在前，与「项目时间筛选 = 创建时间」同一维度）；
 * 排序白名单 updatedAt / createdAt / seqNo。
 * A9（Push 69）：白名单补 createdAt（sort=createdAt:asc|desc）；**Push 175 起前端 TIME 升级为「维度（创建时间 / 更新时间）× 方向」**，默认 = 创建时间 × 降序。
 */
export const ProjectListQuerySchema = z
  .object({
    "filter[region]": z.string().optional().openapi({ description: "地区（多值逗号分隔）" }),
    "filter[projectType]": z.string().optional().openapi({ description: "项目类型（多值逗号分隔）" }),
    "filter[managerId]": z
      .string()
      .optional()
      .openapi({ description: "项目经理（多值逗号分隔，UUID）；命中口径（A22 · Push 136）= 项目挂的任意一位经理命中即命中" }),
    "filter[stageKey]": z.string().optional().openapi({ description: "阶段 key（多值逗号分隔）" }),
    "filter[status]": z.string().optional().openapi({ description: "项目状态（多值逗号分隔）" }),
    "filter[timeFrom]": DateOnlySchema.optional().openapi({
      description: "项目**创建时间**下界（YYYY-MM-DD，含当日；按 Asia/Shanghai 取当日 00:00:00+08:00；Push 175 起维度 = projects.created_at）",
    }),
    "filter[timeTo]": DateOnlySchema.optional().openapi({
      description: "项目**创建时间**上界（YYYY-MM-DD，含当日；按次日 00:00:00+08:00 不含截断）",
    }),
    q: z.string().optional().openapi({ description: "关键字（编号 / 名称 / 客户 / 序号）" }),
    page: PageQuerySchema.shape.page,
    limit: PageQuerySchema.shape.limit,
    sort: SortQuerySchema.optional().openapi({
      description: "排序（field:asc|desc）；一期白名单 updatedAt / createdAt / seqNo；缺省 = createdAt:desc（最近创建的在前；Push 175 起默认维度 = 创建时间）",
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
    region: z
      .string()
      .min(1)
      .max(100)
      .default("未分类")
      .openapi({ description: "项目落地地区（字典 region）；未填写归入「未分类」（A1-12 定档）" }),
    projectType: z
      .string()
      .min(1)
      .max(100)
      .default("未分类")
      .openapi({ description: "项目类型（字典 project_type）；未填写归入「未分类」（A1-12 定档）" }),
    managerIds: z.array(UuidSchema).min(1).openapi({
      description: "项目经理（A22 · Push 136）：至少一位、可多位；数组顺序 = 展示顺序；判空失败返回 400 VALIDATION_FAILED",
    }),
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
    managerIds: z.array(UuidSchema).min(1).optional().openapi({
      description: "项目经理（A22 · Push 136）：至少一位、可多位；不传 = 不改、传空数组 = 400；数组顺序 = 展示顺序",
    }),
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
    managerId: z.record(z.string(), z.number().int().min(0)).openapi({
      description: "项目经理维度计数：键 = users.id；一个项目挂多位经理时**每位各计一次**（A22 · Push 136）",
    }),
    stageKey: z.record(z.string(), z.number().int().min(0)),
    status: z.record(z.string(), z.number().int().min(0)),
  })
  .openapi("ProjectFacets", { description: "首页分类计数；计数与列表同口径（同筛选条件）；五组固定返回，前端按需展示（A6）" });

/** 项目内角色（project_members.role_in_project，M2-05）：一期两值，与全局角色（roles / user_roles）相互独立。 */
export const ProjectMemberRoleSchema = z
  .enum(["project_manager", "project_member"])
  .openapi("ProjectMemberRole", {
    description: "项目内角色：project_manager（项目经理）/ project_member（项目成员）；只作用于项目名册，不改变全局功能权限",
  });

/**
 * 项目成员名册项（M2-05）：记录级权限（谁能看见这个项目）的唯一来源，由 h6 策略服务消费（ADR-011 统一 404 语义）。
 * 姓名随行下发（A2 / ADR-021：关联一律用 users.id，姓名只作展示）。
 */
export const ProjectMemberSchema = z
  .object({
    userId: UuidSchema,
    username: z.string().openapi({ description: "工号（users.username）", example: "10086" }),
    displayName: z.string().openapi({ description: "姓名（users.display_name；账号停用 / 离职后仍返回）" }),
    roleInProject: ProjectMemberRoleSchema,
    joinedAt: DateTimeSchema.openapi({ description: "加入名册时间（成员变更会按 ADR-022 刷新项目 updatedAt）" }),
  })
  .openapi("ProjectMember", { description: "项目成员（名册行）" });

/** 成员列表：项目经理在前，同角色按工号升序（与用户目录同一稳定序）。 */
export const ProjectMemberListResponseSchema = z
  .object({
    items: z.array(ProjectMemberSchema),
    total: z.number().int().min(0),
  })
  .openapi("ProjectMemberListResponse");

/** 添加 / 更新成员（幂等 upsert）：同项目 + 同用户唯一，重复提交覆盖角色，不报错（前端「已在项目中」直接改角色）。 */
export const ProjectMemberCreateBodySchema = z
  .object({
    userId: UuidSchema,
    roleInProject: ProjectMemberRoleSchema.default("project_member").openapi({ description: "缺省 = project_member（项目成员）" }),
  })
  .openapi("ProjectMemberCreateBody", { description: "添加成员：重复添加（同 project + user）幂等并覆盖角色；项目归档后拒绝（409 PROJECT_ARCHIVED）" });

/**
 * 项目硬删（Push 190 起；原 A5「软删」口径作废）：If-Match 回传当前 version 防误删（DELETE 不带 body，避免代理丢载荷）。
 * 口径：物理删行 —— 项目聚合子表（任务 / 流程节点 / 阶段 / 成员 / 干系人 / 日报 / 问题 / 变更 / 文件）连同清掉；
 * code 随行释放（同编号可再建）、seqNo 不回收（跳号）；删除前快照 + 子表行数写审计（action=project.delete，metadata.hardDelete=true）；
 * 非成员 / 不存在统一 404；仅项目经理 / 管理员。
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
