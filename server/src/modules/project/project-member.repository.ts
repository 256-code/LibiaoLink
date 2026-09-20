import { Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { users } from "../../db/schema/identity.js";
import { projectMembers } from "../../db/schema/projects.js";

export type ProjectMemberRow = typeof projectMembers.$inferSelect;

/** 名册视图行：名册字段 + 工号 / 姓名（A2 随行下发，免前端二次查目录）。 */
export interface ProjectMemberViewRow {
  member: ProjectMemberRow;
  username: string;
  displayName: string;
}

const memberColumns = {
  member: projectMembers,
  username: users.username,
  displayName: users.displayName,
} as const;

/** project_members 数据访问（M2-05）：名册读写与「名册 + 用户」JOIN 都收敛在本层。 */
@Injectable()
export class ProjectMemberRepository {
  constructor(private readonly database: DatabaseService) {}

  /** 名册列表：项目经理在前（project_manager < project_member），同角色按工号升序（稳定序）。 */
  async listByProject(projectId: string): Promise<ProjectMemberViewRow[]> {
    return this.database.db
      .select(memberColumns)
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(projectMembers.roleInProject), asc(users.username));
  }

  async findByProjectAndUser(projectId: string, userId: string): Promise<ProjectMemberViewRow | null> {
    const rows = await this.database.db
      .select(memberColumns)
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 添加 / 更新成员（幂等 upsert）：同项目 + 同用户唯一；改角色不动 joined_at（加入时间保持首次）。 */
  async upsert(
    projectId: string,
    userId: string,
    roleInProject: string,
    at: Date,
    client: DbClient = this.database.db,
  ): Promise<ProjectMemberRow> {
    const rows = await client
      .insert(projectMembers)
      .values({ projectId, userId, roleInProject, joinedAt: at })
      .onConflictDoUpdate({
        target: [projectMembers.projectId, projectMembers.userId],
        set: { roleInProject },
      })
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error("project_members upsert 未返回记录");
    }
    return row;
  }

  /** 移除成员：返回被删行（不存在返回 null，由服务层落 404）。 */
  async remove(projectId: string, userId: string, client: DbClient = this.database.db): Promise<ProjectMemberRow | null> {
    const rows = await client
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .returning();
    return rows[0] ?? null;
  }
}
