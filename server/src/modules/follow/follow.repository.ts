/**
 * follows 数据访问（0037 · M2-06 首刀 · A1-15）：关注关系单独存储（不作为任务字段）；取关 = 按关系键物理删行。
 * 多态 object_id（项目 / 任务两族）不设外键：列表 join 项目 / 任务行随行取名称，行已删 → 整条丢弃（读面隐藏）。
 * 可见性（项目级）由服务层经 PermissionService 判定；本仓储只管关系与随行名称。
 */
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { projects } from "../../db/schema/projects.js";
import { tasks } from "../../db/schema/tasks.js";
import { follows } from "../../db/schema/follows.js";

/** 关注关系行。 */
export interface FollowRow {
  id: string;
  userId: string;
  objectType: string;
  objectId: string;
  createdAt: Date;
}

/** 关注清单行（含随行名称：项目名 / 任务标题 + 所属项目编号）。 */
export interface FollowListRow extends FollowRow {
  projectId: string;
  projectCode: string;
  name: string;
}

/** 关注目标（服务层可见性判定与随行展示）。 */
export interface FollowTarget {
  projectId: string;
  projectCode: string;
  name: string;
  archived: boolean;
}

/** 清单过滤（null = 不过滤；projectId 含「该项目下的任务关注」，在随行 join 后过滤）。 */
export interface FollowListFilter {
  objectType: string | null;
  objectId: string | null;
  projectId: string | null;
}

@Injectable()
export class FollowRepository {
  constructor(private readonly database: DatabaseService) {}

  /** 我的关注清单：created_at 降序 → id 升序；目标已删 / 不可见的行丢弃（可见性在服务层再过一道 projectScope）。 */
  async list(userId: string, filter: FollowListFilter, tx?: DbClient): Promise<FollowListRow[]> {
    const db = tx ?? this.database.db;
    const conditions = [eq(follows.userId, userId)];
    if (filter.objectType !== null) conditions.push(eq(follows.objectType, filter.objectType));
    if (filter.objectId !== null) conditions.push(eq(follows.objectId, filter.objectId));
    const rows = await db
      .select()
      .from(follows)
      .where(and(...conditions))
      .orderBy(desc(follows.createdAt), asc(follows.id));
    const projectIds = rows.filter((row) => row.objectType === "project").map((row) => row.objectId);
    const taskIds = rows.filter((row) => row.objectType === "task").map((row) => row.objectId);
    const projectRefs = await this.projectRefs(projectIds, db);
    const taskRefs = await this.taskRefs(taskIds, db);
    const items: FollowListRow[] = [];
    for (const row of rows) {
      if (row.objectType === "project") {
        const ref = projectRefs.get(row.objectId);
        if (ref === undefined) continue;
        items.push({ ...row, projectId: row.objectId, projectCode: ref.code, name: ref.name });
      } else {
        const ref = taskRefs.get(row.objectId);
        if (ref === undefined) continue;
        items.push({ ...row, projectId: ref.projectId, projectCode: ref.projectCode, name: ref.title });
      }
    }
    return filter.projectId === null ? items : items.filter((item) => item.projectId === filter.projectId);
  }

  /** 目标解析（不存在 / 已删 = null；归档项目 archived=true —— 由服务层转 not_found）。 */
  async resolveTarget(objectType: string, objectId: string, tx?: DbClient): Promise<FollowTarget | null> {
    const db = tx ?? this.database.db;
    if (objectType === "project") {
      const rows = await db
        .select({ id: projects.id, code: projects.code, name: projects.name, archivedAt: projects.archivedAt })
        .from(projects)
        .where(and(eq(projects.id, objectId), isNull(projects.deletedAt)))
        .limit(1);
      const row = rows[0];
      if (row === undefined) return null;
      return { projectId: row.id, projectCode: row.code, name: row.name, archived: row.archivedAt !== null };
    }
    const rows = await db
      .select({ id: tasks.id, title: tasks.title, projectId: tasks.projectId, projectCode: projects.code, archivedAt: projects.archivedAt })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, objectId), isNull(tasks.deletedAt), isNull(projects.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return { projectId: row.projectId, projectCode: row.projectCode, name: row.title, archived: row.archivedAt !== null };
  }

  /** 关系行读（按关系键）。 */
  async find(userId: string, objectType: string, objectId: string, tx?: DbClient): Promise<FollowRow | null> {
    const db = tx ?? this.database.db;
    const rows = await db
      .select()
      .from(follows)
      .where(and(eq(follows.userId, userId), eq(follows.objectType, objectType), eq(follows.objectId, objectId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 幂等插入：已存在返回 null（服务层转 unchanged / created=false）。 */
  async insertIfAbsent(userId: string, objectType: string, objectId: string, at: Date, tx?: DbClient): Promise<FollowRow | null> {
    const db = tx ?? this.database.db;
    const rows = await db
      .insert(follows)
      .values({ userId, objectType, objectId, createdAt: at })
      .onConflictDoNothing({ target: [follows.userId, follows.objectType, follows.objectId] })
      .returning();
    return rows[0] ?? null;
  }

  /** 直插（仅用于「插入被冲突挡下、随后行又被删」的极端竞态重试）。 */
  async insert(userId: string, objectType: string, objectId: string, at: Date, tx?: DbClient): Promise<FollowRow> {
    const db = tx ?? this.database.db;
    const rows = await db.insert(follows).values({ userId, objectType, objectId, createdAt: at }).returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error("follows insert 未返回记录");
    }
    return row;
  }

  /** 按关系键物理删（不校验目标存在 / 可见）：返回删除行数。 */
  async deleteByKey(userId: string, objectType: string, objectId: string, tx?: DbClient): Promise<number> {
    const db = tx ?? this.database.db;
    const rows = await db
      .delete(follows)
      .where(and(eq(follows.userId, userId), eq(follows.objectType, objectType), eq(follows.objectId, objectId)))
      .returning({ id: follows.id });
    return rows.length;
  }

  /** 项目随行（未删）。 */
  private async projectRefs(ids: string[], db: DbClient): Promise<Map<string, { code: string; name: string }>> {
    if (ids.length === 0) return new Map();
    const rows = await db
      .select({ id: projects.id, code: projects.code, name: projects.name })
      .from(projects)
      .where(and(inArray(projects.id, ids), isNull(projects.deletedAt)));
    return new Map(rows.map((row) => [row.id, { code: row.code, name: row.name }]));
  }

  /** 任务随行（任务与所属项目都未删）：项目编号供列表展示。 */
  private async taskRefs(ids: string[], db: DbClient): Promise<Map<string, { projectId: string; projectCode: string; title: string }>> {
    if (ids.length === 0) return new Map();
    const rows = await db
      .select({ id: tasks.id, title: tasks.title, projectId: tasks.projectId, projectCode: projects.code })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(inArray(tasks.id, ids), isNull(tasks.deletedAt), isNull(projects.deletedAt)));
    return new Map(rows.map((row) => [row.id, { projectId: row.projectId, projectCode: row.projectCode, title: row.title }]));
  }
}
