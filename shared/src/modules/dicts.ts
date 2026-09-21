import { z } from "../zod.ts";
import { DateTimeSchema } from "../common/conventions.ts";

/**
 * 字典类型（A3）：一期只下发「可运营数据字典」（业务会变的主数据）。
 * 阶段 / 成果文件类型 / 紧急重要度属契约枚举，唯一来源是 shared/src/common/dicts.ts，
 * 前端直接引用，不走接口 —— 避免同一事实两处来源（v0.1 复盘头号问题）。
 */
export const DICT_TYPES = ["region", "projectType"] as const;

export const DictTypeSchema = z.enum(DICT_TYPES).openapi("DictType", {
  description: "字典类型（一期）：region 地区 / projectType 项目类型；未知类型返回 404",
});

export const DictItemSchema = z
  .object({
    code: z.string().openapi({ description: "字典码（projects.region / projects.projectType 存该值）" }),
    name: z.string().openapi({ description: "显示名" }),
    sort: z.number().int().openapi({ description: "展示顺序（升序）" }),
    enabled: z.boolean().openapi({ description: "普通用户只见 enabled=true 的项；管理员可见全集（二期）" }),
    metadata: z.record(z.string(), z.unknown()).openapi({
      description:
        "字典元数据；projectType 必含 accent（CSS 颜色字符串，如 #3b82f6）；另有 accentText（徽标文字色，可缺省，缺省按 #fff 处理；浅色底如品牌黄 #feca04 用深灰 #313033）。前端据此渲染，不硬编码",
    }),
  })
  .openapi("DictItem");

export const DictSchema = z
  .object({
    type: DictTypeSchema,
    items: z.array(DictItemSchema),
    updatedAt: DateTimeSchema,
  })
  .openapi("Dict", { description: "单个字典（含元数据）；响应带 ETag，前端启动拉一次、登出清缓存" });

export const DictListResponseSchema = z
  .object({
    items: z.array(DictSchema),
  })
  .openapi("DictListResponse", { description: "全量字典（一期两个类型：region / projectType）" });


/** 字典读取参数（GET /dicts 与 GET /dicts/{type} 共用）：管理端带 includeDisabled=true 查看停用项。 */
export const DictReadQuerySchema = z
  .object({
    includeDisabled: z.enum(["true", "false"]).optional().openapi({
      description: "是否包含停用项（缺省 / false = 只见 enabled=true）；true 需要 dict.manage（缺权限 403）",
    }),
  })
  .openapi("DictReadQuery", {
    description: "字典读取参数：includeDisabled=true 用于管理端维护停用项（C9-02：停用不影响存量数据展示）",
  });

/** 新增字典条目（仅管理员 · dict.manage）：码建后不可改（存量数据按码引用）。 */
export const DictItemCreateBodySchema = z
  .object({
    code: z.string().min(1).max(64).openapi({ description: "字典码：同类型内唯一；重复返回 409 DICT_ITEM_EXISTS" }),
    name: z.string().min(1).max(80).openapi({ description: "显示名" }),
    sort: z.number().int().min(0).default(0).openapi({ description: "展示顺序（升序）；缺省 0" }),
    enabled: z.boolean().default(true).openapi({ description: "是否启用；缺省 true" }),
    metadata: z.record(z.string(), z.unknown()).default({}).openapi({ description: "字典元数据（projectType 必含 accent）" }),
  })
  .openapi("DictItemCreateBody", { description: "新增字典条目：变更写审计留痕（C9-02）；响应为更新后的整个字典" });

/** 更新字典条目（仅管理员 · dict.manage）：PATCH 合并语义；code 不可改；停用替代删除。 */
export const DictItemUpdateBodySchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    sort: z.number().int().min(0).optional(),
    enabled: z.boolean().optional().openapi({ description: "停用（false）替代删除：存量数据仍按原值展示（C9-02）" }),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi("DictItemUpdateBody", {
    description: "更新字典条目（只传变更键）；本次变更写审计（含字段级 before / after，C9-02 / C7-02）",
  });


/** 字典类型 / 条目 / 字典的类型别名（前端与 handler 直接用；与 permissions.ts 同风格）。 */
export type DictType = z.infer<typeof DictTypeSchema>;
export type DictItem = z.infer<typeof DictItemSchema>;
export type Dict = z.infer<typeof DictSchema>;
export type DictListResponse = z.infer<typeof DictListResponseSchema>;
export type DictReadQuery = z.infer<typeof DictReadQuerySchema>;
export type DictItemCreateBody = z.infer<typeof DictItemCreateBodySchema>;
export type DictItemUpdateBody = z.infer<typeof DictItemUpdateBodySchema>;
