import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { users } from "../../db/schema/identity.js";
import { projects } from "../../db/schema/projects.js";
import { issues } from "../../db/schema/reports.js";
import { tasks } from "../../db/schema/tasks.js";
import type { ProjectScopeFilter } from "../permission/index.js";

/** 工作台任务行（跨项目：任务列 + 负责人姓名聚合 + 项目编号 / 名称）。 */
export interface WorkspaceTaskRow {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  stageKey: string | null;
  title: string;
  titleEn: string | null;
  status: string;
  statusOverride: string | null;
  progress: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualEnd: string | null;
  ownerIds: string[];
  ownerNames: (string | null)[] | null;
  priority: string | null;
  onTime: boolean | null;
}

/** 工作台问题行（跨项目：问题列 + 提出人 / 责任人姓名 + 项目编号 / 名称）。 */
export interface WorkspaceIssueRow {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  taskId: string | null;
  title: string;
  categories: string[];
  state: string;
  reporterId: string;
  reporterName: string | null;
  ownerDepartment: string | null;
  ownerId: string | null;
  ownerName: string | null;
  raisedAt: string;
  updatedAt: Date;
  version: number;
}

/** 负责人姓名数组：与 tasks.owner_ids 同下标（口径与 task.repository 的 OWNER_NAMES_SQL 同源，本模块为只读副本）。 */
const OWNER_NAMES_SQL = sql<(string | null)[] | null>`(
  select array_agg(u.display_name order by o.ord)
  from unnest(${tasks.ownerIds}) with ordinality as o(uid, ord)
  left join ${users} u on u.id = o.uid
)`;

const ISSUE_OWNER = alias(users, "workspace_issue_owner");

/**
 * 工作台数据访问（M6-05 第一刀 · 只读）：跨项目聚合查询 —— 「我的任务」与「我的问题」。
 * 本模块不改任何表；读面统一过滤：软删项目 / 归档项目（ADR-027 冻结，不再催办）不进工作台。
 * 记录级可见性由调用方以 ProjectScopeFilter 传入（permission.projectScope 出口；空集短路不查库）。
 */
@Injectable()
export class WorkspaceRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * 我的任务：负责人含我 或 项目经理含我（均多值任一位命中 · 2026-09-30 复评）、未完成、未删除；不设时间窗口。
   * 组内排序 plannedEnd 升序（未排期空值置末 —— PG ASC 默认 NULLS LAST）→ id 升序。
   */
  async listMyTasks(actorId: string, scope: ProjectScopeFilter, client: DbClient = this.database.db): Promise<WorkspaceTaskRow[]> {
    if (scope.kind === "ids" && scope.ids.length === 0) return [];
    const conditions: SQL[] = [
      isNull(tasks.deletedAt),
      ne(tasks.status, "done"),
      sql`(${tasks.ownerIds} @> array[${actorId}]::uuid[] or ${projects.managerIds} @> array[${actorId}]::uuid[])`,
      isNull(projects.deletedAt),
      ne(projects.status, "archived"),
    ];
    if (scope.kind === "ids") conditions.push(inArray(tasks.projectId, scope.ids));
    const rows = await client
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        projectCode: projects.code,
        projectName: projects.name,
        stageKey: tasks.stageKey,
        title: tasks.title,
        titleEn: tasks.titleEn,
        status: tasks.status,
        statusOverride: tasks.statusOverride,
        progress: tasks.progress,
        plannedStart: tasks.plannedStart,
        plannedEnd: tasks.plannedEnd,
        actualEnd: tasks.actualEnd,
        ownerIds: tasks.ownerIds,
        ownerNames: OWNER_NAMES_SQL,
        priority: tasks.priority,
        onTime: tasks.onTime,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(...conditions))
      .orderBy(asc(tasks.plannedEnd), asc(tasks.id));
    return rows as WorkspaceTaskRow[];
  }

  /** 我的问题：我处理（ownerId）∪ 我提出的（reporterId）；未关闭在前 —— raisedAt（提出日期）升序 → id（Push 215 删处理时限档）。 */
  async listMyIssues(
    actorId: string,
    scope: ProjectScopeFilter,
    client: DbClient = this.database.db,
  ): Promise<WorkspaceIssueRow[]> {
    if (scope.kind === "ids" && scope.ids.length === 0) return [];
    const conditions: SQL[] = [
      sql`(${issues.ownerId} = ${actorId} or ${issues.reporterId} = ${actorId})`,
      isNull(projects.deletedAt),
      ne(projects.status, "archived"),
    ];
    if (scope.kind === "ids") conditions.push(inArray(issues.projectId, scope.ids));
    const rows = await client
      .select({
        id: issues.id,
        projectId: issues.projectId,
        projectCode: projects.code,
        projectName: projects.name,
        taskId: issues.taskId,
        title: issues.title,
        categories: issues.categories,
        state: issues.state,
        reporterId: issues.reporterId,
        reporterName: users.displayName,
        ownerDepartment: issues.ownerDepartment,
        ownerId: issues.ownerId,
        ownerName: ISSUE_OWNER.displayName,
        raisedAt: issues.raisedAt,
        updatedAt: issues.updatedAt,
        version: issues.version,
      })
      .from(issues)
      .innerJoin(projects, eq(projects.id, issues.projectId))
      .leftJoin(users, eq(users.id, issues.reporterId))
      .leftJoin(ISSUE_OWNER, eq(ISSUE_OWNER.id, issues.ownerId))
      .where(and(...conditions))
      .orderBy(
        sql`case when ${issues.state} = ${"done"} then 1 else 0 end`,
        asc(issues.raisedAt),
        asc(issues.id),
      );
    return rows as WorkspaceIssueRow[];
  }
}
