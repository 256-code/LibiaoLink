import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { users } from "../../db/schema/identity.js";
import { projects } from "../../db/schema/projects.js";
import { issueEvents, issues } from "../../db/schema/reports.js";
import type { IssueFilter } from "./report-issue.rules.js";

/** 问题行（含提出人 / 责任人显示名）。 */
export interface IssueRow {
  id: string;
  projectId: string;
  taskId: string | null;
  sourceReportId: string | null;
  title: string;
  category: string;
  state: string;
  reporterId: string;
  reporterName: string | null;
  ownerDepartment: string | null;
  ownerId: string | null;
  ownerName: string | null;
  dueAt: Date | null;
  raisedAt: string;
  solution: string | null;
  closedBy: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/** 问题事件行（A3-13 处理过程留痕）。 */
export interface IssueEventRow {
  id: string;
  issueId: string;
  eventType: string;
  fromState: string | null;
  toState: string | null;
  actorId: string;
  actorName: string | null;
  note: string | null;
  createdAt: Date;
}

export interface IssueInsertInput {
  projectId: string;
  taskId: string | null;
  sourceReportId: string | null;
  title: string;
  category: string;
  state: string;
  reporterId: string;
  ownerDepartment: string | null;
  ownerId: string | null;
  dueAt: Date | null;
  raisedAt: string;
}

export interface IssuePatch {
  state?: string;
  solution?: string | null;
  ownerDepartment?: string | null;
  ownerId?: string | null;
  dueAt?: Date | null;
  closedBy?: string | null;
  closedAt?: Date | null;
}

export interface IssueEventInput {
  issueId: string;
  eventType: string;
  fromState: string | null;
  toState: string | null;
  note: string | null;
}

const ISSUE_OWNER = alias(users, "issue_owner");

const ISSUE_COLUMNS = {
  id: issues.id,
  projectId: issues.projectId,
  taskId: issues.taskId,
  sourceReportId: issues.sourceReportId,
  title: issues.title,
  category: issues.category,
  state: issues.state,
  reporterId: issues.reporterId,
  reporterName: users.displayName,
  ownerDepartment: issues.ownerDepartment,
  ownerId: issues.ownerId,
  ownerName: ISSUE_OWNER.displayName,
  dueAt: issues.dueAt,
  raisedAt: issues.raisedAt,
  solution: issues.solution,
  closedBy: issues.closedBy,
  closedAt: issues.closedAt,
  createdAt: issues.createdAt,
  updatedAt: issues.updatedAt,
  version: issues.version,
};

/**
 * 问题数据访问（M6-02 / M6-03）：列表 / 详情 / 乐观锁更新 / 处理过程留痕。
 * A3-09 幂等：自动生成走 source_report_id 唯一约束（onConflictDoNothing → 返回 null = 已生成过）。
 */
@Injectable()
export class IssueRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(
    projectId: string,
    filter: IssueFilter,
    page: number,
    limit: number,
    client: DbClient = this.database.db,
  ): Promise<{ rows: IssueRow[]; total: number }> {
    const where = this.buildWhere(projectId, filter);
    const rows = await client
      .select(ISSUE_COLUMNS)
      .from(issues)
      .leftJoin(users, eq(users.id, issues.reporterId))
      .leftJoin(ISSUE_OWNER, eq(ISSUE_OWNER.id, issues.ownerId))
      .where(where)
      .orderBy(desc(issues.raisedAt), desc(issues.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const counted = await client.select({ total: sql<number>`count(*)::int` }).from(issues).where(where);
    return { rows: rows as IssueRow[], total: counted[0]?.total ?? 0 };
  }

  async findById(projectId: string, issueId: string, client: DbClient = this.database.db): Promise<IssueRow | null> {
    const rows = await client
      .select(ISSUE_COLUMNS)
      .from(issues)
      .leftJoin(users, eq(users.id, issues.reporterId))
      .leftJoin(ISSUE_OWNER, eq(ISSUE_OWNER.id, issues.ownerId))
      .where(and(eq(issues.projectId, projectId), eq(issues.id, issueId)))
      .limit(1);
    return (rows[0] ?? null) as IssueRow | null;
  }

  /** 自动生成（A3-09）：source_report_id 冲突 = 已生成过，返回 null（不重复写事件）。 */
  async insert(input: IssueInsertInput, at: Date, client: DbClient): Promise<IssueRow | null> {
    const inserted = await client
      .insert(issues)
      .values({
        projectId: input.projectId,
        taskId: input.taskId,
        sourceReportId: input.sourceReportId,
        title: input.title,
        category: input.category,
        state: input.state,
        reporterId: input.reporterId,
        ownerDepartment: input.ownerDepartment,
        ownerId: input.ownerId,
        dueAt: input.dueAt,
        raisedAt: input.raisedAt,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing({ target: issues.sourceReportId })
      .returning({ id: issues.id });
    const id = inserted[0]?.id;
    if (id === undefined) return null;
    return this.findById(input.projectId, id, client);
  }

  /** 乐观锁更新（version 不匹配返回 false，由服务层转 409 VERSION_CONFLICT）。 */
  async updateWithVersion(issueId: string, expectedVersion: number, patch: IssuePatch, at: Date, client: DbClient): Promise<boolean> {
    const rows = await client
      .update(issues)
      .set({ ...patch, version: sql`${issues.version} + 1`, updatedAt: at })
      .where(and(eq(issues.id, issueId), eq(issues.version, expectedVersion)))
      .returning({ id: issues.id });
    return rows.length > 0;
  }

  /** 处理过程留痕（A3-13）：按时间正序下发。 */
  async listEvents(issueId: string, client: DbClient = this.database.db): Promise<IssueEventRow[]> {
    return (await client
      .select({
        id: issueEvents.id,
        issueId: issueEvents.issueId,
        eventType: issueEvents.eventType,
        fromState: issueEvents.fromState,
        toState: issueEvents.toState,
        actorId: issueEvents.actorId,
        actorName: users.displayName,
        note: issueEvents.note,
        createdAt: issueEvents.createdAt,
      })
      .from(issueEvents)
      .leftJoin(users, eq(users.id, issueEvents.actorId))
      .where(eq(issueEvents.issueId, issueId))
      .orderBy(asc(issueEvents.createdAt), asc(issueEvents.id))) as IssueEventRow[];
  }

  async insertEvent(input: IssueEventInput, actorId: string, at: Date, client: DbClient): Promise<void> {
    await client.insert(issueEvents).values({
      issueId: input.issueId,
      eventType: input.eventType,
      fromState: input.fromState,
      toState: input.toState,
      actorId,
      note: input.note,
      createdAt: at,
    });
  }

  /** 项目上下文（写路径用）：软删 / 不存在 = null（记录级 404）；status 供归档写保护判定（ADR-027）。 */
  async findProject(projectId: string, client: DbClient = this.database.db): Promise<{ id: string; status: string } | null> {
    const rows = await client
      .select({ id: projects.id, status: projects.status })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  private buildWhere(projectId: string, filter: IssueFilter) {
    const conditions = [eq(issues.projectId, projectId)];
    if (filter.states !== null) conditions.push(inArray(issues.state, filter.states));
    if (filter.categories !== null) conditions.push(inArray(issues.category, filter.categories));
    if (filter.taskId !== null) conditions.push(eq(issues.taskId, filter.taskId));
    if (filter.reportId !== null) conditions.push(eq(issues.sourceReportId, filter.reportId));
    if (filter.keyword !== null) conditions.push(ilike(issues.title, "%" + filter.keyword + "%"));
    return and(...conditions);
  }
}
