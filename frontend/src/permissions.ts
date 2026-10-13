/**
 * 当前用户权限画像（h6 · PoC-6）：GET /api/v1/permissions/me（契约 shared/src/modules/permissions.ts）。
 * 用途：管理入口的呈现层收敛 —— Push 172 起两处按它分叉：
 * ① 字典治理（「＋ 添加项目类型」、地区 / 项目类型的行内删除 = dict.manage）；② 卡片删除项目（project.delete）。
 * （Push 168 曾随「地区全站共享」下线；地区新增对所有人开放，仍然不看权限。）
 * 2026-10-08 第三处：头像菜单「操作记录」（audit.view，AppHeader 自取同一份画像）。
 * 服务端逐请求仍是最终裁决，前端只做呈现层收敛；失败口径：拉取失败一律回落「无权限」（入口不渲染，误点会吃 403）。
 * 取数口径：进程内单飞缓存（App 启动与 AppHeader 共用同一请求；失败不缓存 —— 下次挂载可重试；换角色靠刷新 / 服务端 TTL）。
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

let cached: Promise<MyPermissions> | null = null;

/** 拉取本人授权画像（登录后一次，与字典 / 目录 / 偏好并行；多调用方共享同一请求 —— 见文件头「取数口径」）。 */
export function loadMyPermissions(): Promise<MyPermissions> {
  if (cached === null) {
    cached = apiRequest<PermissionMeResponse>("/api/v1/permissions/me")
      .then((payload) => ({ roleCodes: payload.permissions.roleCodes, permissionKeys: payload.permissions.permissionKeys }))
      .catch((error: unknown) => {
        cached = null;
        throw error;
      });
  }
  return cached;
}

/** 是否持有某个功能权限位（画像未拿到 = false：入口按「无权限」呈现）。 */
export function hasPermission(permissions: MyPermissions | null, key: string): boolean {
  return permissions !== null && permissions.permissionKeys.includes(key);
}
