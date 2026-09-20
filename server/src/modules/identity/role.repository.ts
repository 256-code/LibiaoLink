import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import { rolePermissions, roles, userRoles } from "../../db/schema/identity.js";

export type RoleRow = typeof roles.$inferSelect;

/** roles / role_permissions / user_roles 数据访问（0007）；角色集由种子维护（database/seeds/roles.mjs）。 */
@Injectable()
export class RoleRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(): Promise<RoleRow[]> {
    return this.database.db.select().from(roles).orderBy(asc(roles.code));
  }

  async findByCode(code: string): Promise<RoleRow | null> {
    const rows = await this.database.db.select().from(roles).where(eq(roles.code, code)).limit(1);
    return rows[0] ?? null;
  }

  async listByUser(userId: string): Promise<RoleRow[]> {
    const rows = await this.database.db
      .select({ role: roles })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, userId))
      .orderBy(asc(roles.code));
    return rows.map((row) => row.role);
  }

  /** 功能权限位并集（去重升序）；矩阵条目随 h6（PoC-6）填充，当前为空集。 */
  async listPermissionKeys(roleIds: readonly string[]): Promise<string[]> {
    if (roleIds.length === 0) return [];
    const rows = await this.database.db
      .selectDistinct({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(inArray(rolePermissions.roleId, [...roleIds]));
    return rows.map((row) => row.permission).sort();
  }

  /** 绑定用户与角色（重复调用幂等）。 */
  async assign(userId: string, roleId: string): Promise<void> {
    await this.database.db.insert(userRoles).values({ userId, roleId }).onConflictDoNothing();
  }

  async revoke(userId: string, roleId: string): Promise<boolean> {
    const rows = await this.database.db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
      .returning({ roleId: userRoles.roleId });
    return rows.length > 0;
  }
}
