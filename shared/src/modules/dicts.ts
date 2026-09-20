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
