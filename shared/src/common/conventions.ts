import { z } from "../zod.ts";

/** 通用标量：全项目唯一来源，禁止各模块自行定义同义 schema。 */
export const UuidSchema = z.uuid().openapi("Uuid", { description: "UUID（主键与关联 ID）" });
export const DateTimeSchema = z.iso.datetime().openapi("DateTime", {
  description: "ISO8601 时间戳（UTC 存储，前端按 Asia/Shanghai 展示）",
});
export const DateOnlySchema = z.iso.date().openapi("DateOnly", {
  description: "业务日期 YYYY-MM-DD（不携带时区）",
});
export const VersionSchema = z.number().int().min(0).openapi("Version", {
  description: "乐观锁版本：读取时返回，更新时必须原样回传，冲突返回 409",
});
export const IdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .openapi("IdempotencyKey", { description: "写操作幂等键（Idempotency-Key 请求头）；重复提交返回首次结果" });

/** 列表分页（表格型接口）：page / limit + total；信息流型接口后续用 cursor（本批未涉及）。 */
export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const SortQuerySchema = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9]*(:(asc|desc))?(,[a-zA-Z][a-zA-Z0-9]*(:(asc|desc))?)*$/)
  .openapi({
    description: "排序：sort=field:asc,field2:desc（v0.2 §7.1）",
    example: "plannedEnd:asc",
  });

/** 列表响应工厂：分页元数据口径统一（items / page / limit / total）。 */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
  });
}
