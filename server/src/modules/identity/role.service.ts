import { Injectable } from "@nestjs/common";
import { AppError } from "../../common/errors/app-error.js";
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

/** 角色用例（h1）：角色列表、授权画像、用户 ↔ 角色绑定；不新开 HTTP 端点（管理界面随 C3-09 / u12）。 */
@Injectable()
export class RoleService {
  constructor(private readonly roles: RoleRepository) {}

  /** 一期六个内置角色（种子维护）。 */
  listRoles(): Promise<RoleRow[]> {
    return this.roles.list();
  }

  async getActorAuthorization(userId: string): Promise<ActorAuthorization> {
    const rows = await this.roles.listByUser(userId);
    const permissionKeys = await this.roles.listPermissionKeys(rows.map((row) => row.id));
    return {
      userId,
      roleCodes: rows.map((row) => row.code),
      dataScopes: sortDataScopes(rows.map((row) => row.dataScope)),
      permissionKeys,
    };
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
