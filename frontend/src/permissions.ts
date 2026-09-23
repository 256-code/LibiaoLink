/**
 * 当前用户权限画像（h6 · PoC-6）：GET /api/v1/permissions/me（契约 shared/src/modules/permissions.ts）。
 * 用途：管理入口的呈现层收敛 —— Push 172 起两处按它分叉：
 * ① 字典治理（「＋ 添加项目类型」、地区 / 项目类型的行内删除 = dict.manage）；② 卡片删除项目（project.delete）。
 * （Push 168 曾随「地区全站共享」下线；地区新增对所有人开放，仍然不看权限。）
 * 服务端逐请求仍是最终裁决，前端只做呈现层收敛；失败口径：拉取失败一律回落「无权限」（入口不渲染，误点会吃 403）。
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

/** 拉取本人授权画像（登录后一次，与字典 / 目录 / 偏好并行；角色调整由服务端策略缓存 TTL 刷新）。 */
export async function loadMyPermissions(): Promise<MyPermissions> {
  const payload = await apiRequest<PermissionMeResponse>("/api/v1/permissions/me");
  return { roleCodes: payload.permissions.roleCodes, permissionKeys: payload.permissions.permissionKeys };
}

/** 是否持有某个功能权限位（画像未拿到 = false：入口按「无权限」呈现）。 */
export function hasPermission(permissions: MyPermissions | null, key: string): boolean {
  return permissions !== null && permissions.permissionKeys.includes(key);
}
