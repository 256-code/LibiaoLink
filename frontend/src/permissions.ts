/**
 * 当前用户权限画像（h6 · PoC-6）：GET /api/v1/permissions/me（契约 shared/src/modules/permissions.ts）。
 * 用途：前端据此显示 / 隐藏管理入口（如「地区」新增写字典需要 dict.manage）；服务端逐请求仍是最终裁决，前端只做呈现层收敛。
 * 失败口径：拉取失败一律回落「无管理权限」（不阻塞页面），入口降级为只影响本项目 / 本机的写法。
 */
import { apiRequest } from "./api";

export type MyPermissions = {
  /** 角色码（roles.code；多角色并集），排障 / 调试用。 */
  roleCodes: string[];
  /** 功能权限位并集（role_permissions ↔ 契约 PERMISSION_KEYS）。 */
  permissionKeys: string[];
};

type PermissionMeResponse = {
  permissions: { userId: string; roleCodes: string[]; dataScopes: string[]; permissionKeys: string[] };
};

/** 拉取本人授权画像（登录后一次；角色调整由服务端策略缓存 TTL 刷新）。 */
export async function loadMyPermissions(): Promise<MyPermissions> {
  const payload = await apiRequest<PermissionMeResponse>("/api/v1/permissions/me");
  return { roleCodes: payload.permissions.roleCodes, permissionKeys: payload.permissions.permissionKeys };
}

/** 是否持有某个功能权限位（画像未拿到 = false：入口按「无权限」呈现）。 */
export function hasPermission(permissions: MyPermissions | null, key: string): boolean {
  return permissions !== null && permissions.permissionKeys.includes(key);
}
