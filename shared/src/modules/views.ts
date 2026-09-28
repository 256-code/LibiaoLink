import { z } from "../zod.ts";
import { DateTimeSchema, UuidSchema } from "../common/conventions.ts";

/**
 * 视图管理（系统功能书 A1-03 · M2-06 首刀）：保存个人视图与公共视图 —— 视图内容
 * = 筛选条件 filters + 列配置 columns + 排序 sort + 分组方式 grouping；仅保存配置、不复制数据；
 * 打开视图实时反映最新数据。落库 project_views（迁移 0037 · Push 168）。
 * 命名：契约字段 grouping 对应库列 grouping（避 PG 保留字 group；技术设计v0.3 §3.1 原字段名 group 以本刀为准修订）。
 * 差异登记（首刀）：公共视图「共享给指定角色」（A1-03）未做 —— 一期公共视图 = 全员可见、创建者可改。
 */

/** 视图范围：personal 个人（仅本人可见 / 可改）/ public 公共（全员可见，创建者可改）。 */
export const VIEW_SCOPES = ["personal", "public"] as const;
export const ViewScopeSchema = z.enum(VIEW_SCOPES).openapi("ViewScope", {
  description: "视图范围：personal 个人视图（仅本人可见 / 可改）/ public 公共视图（全员可见，创建者可改；角色级共享未做，差异登记）",
});

/** 名称上限（与库侧 CHECK ck_project_views_name 同口径：btrim 后 1 ~ 50 字）。 */
export const VIEW_NAME_MAX_LENGTH = 50;
/** 列配置上限（防御性硬顶；超限 400 VALIDATION_FAILED）。 */
export const VIEW_COLUMNS_MAX = 60;
/** 筛选条件键数上限（防御性硬顶；超限 400 VALIDATION_FAILED）。 */
export const VIEW_FILTERS_MAX_KEYS = 30;

/** 单个筛选值（扁平键值口径）：null = 显式清空。 */
export const ViewFilterValueSchema = z
  .union([z.string().max(120), z.number(), z.boolean(), z.array(z.string().max(120)).max(50), z.null()])
  .openapi("ViewFilterValue", { description: "筛选值：字符串 / 数字 / 布尔 / 字符串数组（多值）/ null（显式清空）" });

/** 视图筛选条件：键 ≤ 40 字、最多 30 键；值见 ViewFilterValue。 */
export const ViewFiltersSchema = z
  .record(z.string().min(1).max(40), ViewFilterValueSchema)
  .superRefine((value, ctx) => {
    if (Object.keys(value).length > VIEW_FILTERS_MAX_KEYS) {
      ctx.addIssue({ code: "custom", message: "筛选条件最多 " + VIEW_FILTERS_MAX_KEYS + " 键（防御性硬顶）", path: [] });
    }
  })
  .openapi("ViewFilters", {
    description: "筛选条件（扁平键值，最多 " + VIEW_FILTERS_MAX_KEYS + " 键；键 = 任务表 URL 参数名，如 stageKey / ownerId / displayStatus / keyword）",
  });

/** 列配置：列键数组（顺序 = 展示顺序），单键 ≤ 40 字、最多 60 列。 */
export const ViewColumnsSchema = z.array(z.string().min(1).max(40)).max(VIEW_COLUMNS_MAX).openapi("ViewColumns", {
  description: "列配置（列键数组；顺序 = 展示顺序；列键白名单由前端列定义维护）",
});

/** 排序：键 ≤ 40 字 + asc / desc。 */
export const ViewSortSchema = z
  .object({
    key: z.string().min(1).max(40).openapi({ description: "排序键（白名单由目标列表维护）" }),
    order: z.enum(["asc", "desc"]).openapi({ description: "升序 / 降序" }),
  })
  .openapi("ViewSort", { description: "排序方式（键 + 方向）" });

/** 分组方式：阶段 / 负责人 / 状态 / 项目等（键由目标列表维护）。 */
export const ViewGroupingSchema = z
  .object({
    key: z.string().min(1).max(40).openapi({ description: "分组键（如 stage / owner / status / project）" }),
  })
  .openapi("ViewGrouping", { description: "分组方式" });

/** 视图（读面全量）：个人视图仅 owner 可见；公共视图全员可见。 */
export const SavedViewSchema = z
  .object({
    id: UuidSchema,
    ownerId: UuidSchema.openapi({ description: "创建者（改 / 删的唯一责任人）" }),
    ownerName: z.string().openapi({ description: "创建者姓名（公共视图列表随行展示）" }),
    scope: ViewScopeSchema,
    name: z.string().openapi({ description: "视图名称（btrim 后 1 ~ 50 字）" }),
    filters: ViewFiltersSchema,
    columns: ViewColumnsSchema,
    sort: ViewSortSchema.nullable(),
    grouping: ViewGroupingSchema.nullable(),
    isDefault: z.boolean().openapi({ description: "是否创建者的默认视图（每人至多一条；置位时自动清掉该人其它默认）" }),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .openapi("SavedView", { description: "保存的视图（内容 = 筛选 + 列配置 + 排序 + 分组；仅保存配置、不复制数据）" });

export const ViewListQuerySchema = z.object({
  scope: ViewScopeSchema.optional().openapi({
    description: "范围过滤：personal = 我的个人视图；public = 公共视图；缺省 = 我的个人视图 + 全部公共视图",
  }),
});

export const ViewListResponseSchema = z
  .object({
    items: z.array(SavedViewSchema).openapi({ description: "可见视图清单（排序：个人在前 → updatedAt 降序 → id 升序）" }),
  })
  .openapi("ViewListResponse", { description: "视图清单（无分页：个人 + 公共视图量级小）" });

export const ViewCreateBodySchema = z
  .object({
    name: z.string().min(1).max(VIEW_NAME_MAX_LENGTH).openapi({ description: "视图名称（前后空白剔除后 1 ~ 50 字）" }),
    scope: ViewScopeSchema.default("personal"),
    filters: ViewFiltersSchema.default({}),
    columns: ViewColumnsSchema.default([]),
    sort: ViewSortSchema.nullish(),
    grouping: ViewGroupingSchema.nullish(),
    isDefault: z.boolean().default(false).openapi({ description: "建为我的默认视图（置位时自动清掉该人其它默认）" }),
  })
  .openapi("ViewCreateBody", { description: "新建视图（A1-03：筛选 + 列配置 + 排序 + 分组）" });

export const ViewUpdateBodySchema = z
  .object({
    name: z.string().min(1).max(VIEW_NAME_MAX_LENGTH).optional(),
    scope: ViewScopeSchema.optional(),
    filters: ViewFiltersSchema.optional(),
    columns: ViewColumnsSchema.optional(),
    sort: ViewSortSchema.nullable().optional(),
    grouping: ViewGroupingSchema.nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .openapi("ViewUpdateBody", { description: "更新视图（局部更新：只传变更键；空更新 400 VALIDATION_FAILED）" });

export const ViewDeleteResponseSchema = z
  .object({
    id: UuidSchema,
    deleted: z.boolean().openapi({ description: "恒为 true（视图是配置文件，物理删、不留痕）" }),
  })
  .openapi("ViewDeleteResponse", { description: "视图删除结果（物理删）" });

export type ViewScope = z.infer<typeof ViewScopeSchema>;
export type ViewFilterValue = z.infer<typeof ViewFilterValueSchema>;
export type ViewFilters = z.infer<typeof ViewFiltersSchema>;
export type ViewColumns = z.infer<typeof ViewColumnsSchema>;
export type ViewSort = z.infer<typeof ViewSortSchema>;
export type ViewGrouping = z.infer<typeof ViewGroupingSchema>;
export type SavedView = z.infer<typeof SavedViewSchema>;
export type ViewListQuery = z.infer<typeof ViewListQuerySchema>;
export type ViewListResponse = z.infer<typeof ViewListResponseSchema>;
export type ViewCreateBody = z.infer<typeof ViewCreateBodySchema>;
export type ViewUpdateBody = z.infer<typeof ViewUpdateBodySchema>;
export type ViewDeleteResponse = z.infer<typeof ViewDeleteResponseSchema>;
