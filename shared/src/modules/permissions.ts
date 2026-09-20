import { z } from "../zod.ts";
import { UuidSchema } from "../common/conventions.ts";

/**
 * 功能权限位（模块.操作）—— 本数组是唯一来源：数据库 role_permissions.permission 的 CHECK 同形
 * （database/migrations/0007_identity_org.sql），一期矩阵条目见种子 #6b（database/seeds/role-permissions.mjs）。
 * 口径来源：技术设计v0.2 §4.1（六角色「关键能力 / 限制」列）+ ADR-011；新增键先入本数组，再落种子与策略表。
 */
export const PERMISSION_KEYS = [
  "project.view",
  "project.create",
  "project.update",
  "project.delete",
  "project.export",
  "member.view",
  "member.manage",
  "task.view",
  "task.create",
  "task.update",
  "task.progress",
  "node.view",
  "node.create",
  "node.delete",
  "node.complete",
  "node.advance",
  "node.rollback",
  "blueprint.view",
  "blueprint.manage",
  "file.upload",
  "file.download",
  "stakeholder.view",
  "stakeholder.manage",
  "stakeholder.contact.view",
  "dict.manage",
  "audit.view",
] as const;

export const PermissionKeySchema = z
  .enum(PERMISSION_KEYS)
  .openapi("PermissionKey", { description: "功能权限位（模块.操作）；一期取值见 PERMISSION_KEYS（种子 #6b 按角色分配）" });

export type PermissionKey = z.infer<typeof PermissionKeySchema>;

/** 角色数据范围（roles.data_scope）：由宽到窄，多角色取并集（技术设计v0.2 §4.1）。 */
export const DataScopeSchema = z
  .enum(["all", "managed_projects", "involved_projects", "own_stakeholders", "granted"])
  .openapi("DataScope", {
    description: "角色数据范围：all > managed_projects > involved_projects > own_stakeholders > granted（多角色并集）",
  });

export type DataScope = z.infer<typeof DataScopeSchema>;

/**
 * 授权画像（服务端 ActorAuthorization 的契约投影）：前端据此置灰按钮、显示当前身份；
 * 字段级策略不下发 —— 无权字段服务端直接不返回（ADR-011 / C3-08）。
 */
export const ActorPermissionsSchema = z
  .object({
    userId: UuidSchema,
    roleCodes: z.array(z.string()).openapi({ example: ["project_manager"], description: "角色码（roles.code；多角色并集）" }),
    dataScopes: z.array(DataScopeSchema).openapi({ description: "数据范围并集（由宽到窄）" }),
    permissionKeys: z.array(PermissionKeySchema).openapi({ description: "功能权限位并集（role_permissions）" }),
  })
  .openapi("ActorPermissions", { description: "当前用户授权画像（角色 + 数据范围 + 功能权限位）" });

export type ActorPermissions = z.infer<typeof ActorPermissionsSchema>;

/** GET /api/v1/permissions/me 响应：包一层对象，便于后续追加策略版本号等字段。 */
export const PermissionMeResponseSchema = z
  .object({ permissions: ActorPermissionsSchema })
  .openapi("PermissionMeResponse", { description: "当前用户授权画像（未登录 401）" });
