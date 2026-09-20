import { z } from "../zod.ts";
import { DateTimeSchema, PageQuerySchema, UuidSchema, paginated } from "../common/conventions.ts";

/**
 * 审计（C7）契约：操作留痕的读取面；写入由服务端在各业务用例内同事务完成。
 * 表口径见 database/migrations/0013_admin_dict_audit.sql 与技术设计v0.3 §3.2。
 */

/** 审计动作（audit_logs.action）：新增 / 修改 / 删除 / 进度 / 完成 / 推进 / 回退 / 越权拒绝（C7-03）。 */
export const AUDIT_ACTIONS = ["create", "update", "delete", "progress", "complete", "advance", "rollback", "deny"] as const;
export const AuditActionSchema = z.enum(AUDIT_ACTIONS).openapi("AuditAction", {
  description:
    "审计动作：create 新增 / update 修改 / delete 删除 / progress 进度 / complete 节点完成 / advance 阶段推进 / rollback 阶段回退 / deny 越权拒绝",
});

/** 审计对象类型（audit_logs.object_type）：一期覆盖 h7 的全部写入点。 */
export const AUDIT_OBJECT_TYPES = ["project", "project_member", "task", "node", "stage", "dict_item", "blueprint"] as const;
export const AuditObjectTypeSchema = z.enum(AUDIT_OBJECT_TYPES).openapi("AuditObjectType", {
  description: "审计对象类型：project 项目 / project_member 名册 / task 任务 / node 节点 / stage 阶段 / dict_item 字典条目 / blueprint 蓝图",
});

/** 审计结果：成功 / 越权拒绝（C7-03，管理员可按 result=denied 筛出）/ 失败（门禁拒绝等）。 */
export const AUDIT_RESULTS = ["succeeded", "denied", "failed"] as const;
export const AuditResultSchema = z.enum(AUDIT_RESULTS).openapi("AuditResult", {
  description: "审计结果：succeeded 成功 / denied 越权尝试（C7-03）/ failed 业务拒绝（门禁等）",
});

/** 审计入口：一期全部为 api；页面 / 系统任务 / 批量随各自卡片接入。 */
export const AUDIT_ENTRIES = ["api", "page", "system", "batch"] as const;
export const AuditEntrySchema = z.enum(AUDIT_ENTRIES).openapi("AuditEntry", {
  description: "审计入口：api / page / system / batch",
});

/** 字段级修改（C7-02）：谁、何时、从什么改成什么 —— changes 数组元素。 */
export const AuditChangeSchema = z
  .object({
    field: z.string().openapi({ description: "字段名（契约口径 camelCase）" }),
    from: z.unknown().openapi({ description: "修改前值（JSON；无值时为 null）" }),
    to: z.unknown().openapi({ description: "修改后值（JSON；无值时为 null）" }),
  })
  .openapi("AuditChange", { description: "字段级修改条目（C7-02）" });

export const AuditLogSchema = z
  .object({
    id: z.number().int().positive().openapi({ description: "审计序号（只增不减）" }),
    occurredAt: DateTimeSchema,
    actorId: UuidSchema.nullable().openapi({ description: "操作人 users.id（系统任务为 null）" }),
    actorName: z.string().nullable().openapi({ description: "操作人姓名快照（写入时冗余，改名后仍可追溯）" }),
    action: AuditActionSchema,
    objectType: AuditObjectTypeSchema,
    objectId: z.string().openapi({ description: "对象 id（uuid 或字典码等业务键）" }),
    projectId: UuidSchema.nullable().openapi({ description: "所属项目（非项目对象为 null）" }),
    result: AuditResultSchema,
    entry: AuditEntrySchema,
    summary: z.string().openapi({ description: "可读摘要（列表直接展示）" }),
    changes: z.array(AuditChangeSchema).nullable().openapi({ description: "字段级修改（C7-02）；无字段级变化时为 null" }),
    metadata: z.record(z.string(), z.unknown()).openapi({ description: "附加信息（trace_id / 请求方法路径等）" }),
  })
  .openapi("AuditLog", { description: "审计日志（C7）：追加写、不可改删、保留 ≥6 个月（C7-05）" });

export const AuditLogListQuerySchema = z
  .object({
    objectType: AuditObjectTypeSchema.optional(),
    objectId: z.string().min(1).max(200).optional().openapi({
      description: "对象 id（与 objectType 组合 = 按对象检索 —— h7 验收项②）",
    }),
    actorId: UuidSchema.optional().openapi({ description: "操作人（按人检索 —— h7 验收项②）" }),
    action: AuditActionSchema.optional(),
    result: AuditResultSchema.optional().openapi({ description: "result=denied 即越权尝试（C7-03）" }),
    projectId: UuidSchema.optional(),
    from: DateTimeSchema.optional().openapi({ description: "时间下界（含，ISO8601）" }),
    to: DateTimeSchema.optional().openapi({ description: "时间上界（含，ISO8601）" }),
    page: PageQuerySchema.shape.page,
    limit: PageQuerySchema.shape.limit,
  })
  .openapi("AuditLogListQuery", {
    description: "审计检索（C7-04）：按对象 / 操作人 / 动作 / 结果 / 项目 / 时间区间过滤；固定 occurredAt 降序",
  });

export const AuditLogListResponseSchema = paginated(AuditLogSchema).openapi("AuditLogListResponse");


/** 审计枚举与视图的类型别名（前端与 handler 直接用）。 */
export type AuditAction = z.infer<typeof AuditActionSchema>;
export type AuditObjectType = z.infer<typeof AuditObjectTypeSchema>;
export type AuditResult = z.infer<typeof AuditResultSchema>;
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
export type AuditChange = z.infer<typeof AuditChangeSchema>;
export type AuditLog = z.infer<typeof AuditLogSchema>;
export type AuditLogListQuery = z.infer<typeof AuditLogListQuerySchema>;
export type AuditLogListResponse = z.infer<typeof AuditLogListResponseSchema>;
