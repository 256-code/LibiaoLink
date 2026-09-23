import { Injectable } from "@nestjs/common";
import { PERMISSION_KEYS } from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { AppConfig } from "../../config/config.module.js";
import { sortDataScopes, type DataScope } from "./data-scope.js";
import { RoleRepository, type RoleRow } from "./role.repository.js";

/**
 * 授权画像：用户当前全部角色 + 数据范围并集 + 功能权限位并集。
 * h6 策略服务（can / buildScopeWhere / fieldPolicy / exportPolicy）以本画像为唯一输入（ADR-011）。
 */
export interface ActorAuthorization {
  userId: string;
  roleCodes: string[];
  /** 多角色数据范围并集（由宽到窄去重）。 */
  dataScopes: DataScope[];
  /** 功能权限位并集（role_permissions；矩阵随 h6 填充，当前为空集）。 */
  permissionKeys: string[];
}

/**
 * 「一期不判权限」等效管理员画像（PERMISSION_ENFORCED=false；业务口径 2026-09-23「我们当前这个系统就不要考虑权限」）：
 * 授权画像一律按系统管理员下发 —— 数据范围 `all` + 契约全量权限位（PERMISSION_KEYS）+ `admin` 角色码，
 * 于是四处判定一并放开：功能权限（can / @RequirePermission）、记录级可见集（projectScopeSpec）、
 * 字段级投影（FIELD_POLICIES）与角色内硬检查（task / flow / file 三处读 roleCodes 含 admin）。
 * 只影响**裁定**、不动数据：用户偏好（常用筛选 / 醒目模式 / 任务表列显隐）仍按账号各存一行。
 */
export function equivalentAdminAuthorization(userId: string): ActorAuthorization {
  return {
    userId,
    roleCodes: ["admin"],
    dataScopes: ["all"],
    permissionKeys: [...PERMISSION_KEYS],
  };
}

/** 角色用例（h1）：角色列表、授权画像、用户 ↔ 角色绑定；不新开 HTTP 端点（管理界面随 C3-09 / u12）。 */
@Injectable()
export class RoleService {
  constructor(
    private readonly config: AppConfig,
    private readonly roles: RoleRepository,
  ) {}

  /** 一期六个内置角色（种子维护）。 */
  listRoles(): Promise<RoleRow[]> {
    return this.roles.list();
  }

  /**
   * 授权画像：全站权限判定的唯一输入（ADR-011）。
   * `PERMISSION_ENFORCED=false`（默认 · 一期）= 不判权限 —— 一律等效管理员（不读库）；
   * `true`（二期打开）= 按 roles / role_permissions 判定。
   */
  async getActorAuthorization(userId: string): Promise<ActorAuthorization> {
    if (!this.permissionEnforced) {
      return equivalentAdminAuthorization(userId);
    }
    const rows = await this.roles.listByUser(userId);
    const permissionKeys = await this.roles.listPermissionKeys(rows.map((row) => row.id));
    return {
      userId,
      roleCodes: rows.map((row) => row.code),
      dataScopes: sortDataScopes(rows.map((row) => row.dataScope)),
      permissionKeys,
    };
  }

  /** 权限判定开关（PERMISSION_ENFORCED）：`true` = 按 ADR-011 判定；`false` = 一期不判权限（等效管理员）。 */
  private get permissionEnforced(): boolean {
    return this.config.env.PERMISSION_ENFORCED === "true";
  }

  /** 授予角色（幂等）；未知角色码 → 404（与「不存在与无权统一 404」一致，ADR-011）。 */
  async assignRole(userId: string, roleCode: string): Promise<RoleRow> {
    const role = await this.requireRole(roleCode);
    await this.roles.assign(userId, role.id);
    return role;
  }

  /** 撤销角色（幂等）；返回撤销前是否存在绑定。 */
  async revokeRole(userId: string, roleCode: string): Promise<boolean> {
    const role = await this.requireRole(roleCode);
    return this.roles.revoke(userId, role.id);
  }

  private async requireRole(roleCode: string): Promise<RoleRow> {
    const role = await this.roles.findByCode(roleCode);
    if (role === null) {
      throw new AppError("NOT_FOUND", "角色不存在：" + roleCode);
    }
    return role;
  }
}
