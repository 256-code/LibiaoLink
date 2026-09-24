import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { users } from "../../db/schema/identity.js";
import { projects } from "../../db/schema/projects.js";
import { dailyReports } from "../../db/schema/reports.js";
import { taskEvents, tasks } from "../../db/schema/tasks.js";
import { progressMarker, type DailyReportFilter } from "./report-issue.rules.js";

/** 日报行（含提交人显示名）。 */
export interface DailyReportRow {
  id: string;
  projectId: string;
  authorId: string;
  authorName: string | null;
  reportDate: string;
  state: string;
  headcount: number | null;
  doneWork: string;
  plan: string | null;
  foundIssue: string | null;
  issueCategory: string | null;
  suggestion: string | null;
  taskIds: string[];
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface DailyReportInsertInput {
  projectId: string;
  authorId: string;
  reportDate: string;
  state: string;
  headcount: number | null;
  doneWork: string;
  plan: string | null;
  foundIssue: string | null;
  issueCategory: string | null;
  suggestion: string | null;
  taskIds: string[];
  submittedAt: Date | null;
}

export interface DailyReportPatch {
  state?: string;
  headcount?: number | null;
  doneWork?: string;
  plan?: string | null;
  foundIssue?: string | null;
  issueCategory?: string | null;
  suggestion?: string | null;
  taskIds?: string[];
  submittedAt?: Date | null;
}

const REPORT_COLUMNS = {
  id: dailyReports.id,
  projectId: dailyReports.projectId,
  authorId: dailyReports.authorId,
  authorName: users.displayName,
  reportDate: dailyReports.reportDate,
  state: dailyReports.state,
  headcount: dailyReports.headcount,
  doneWork: dailyReports.doneWork,
  plan: dailyReports.plan,
  foundIssue: dailyReports.foundIssue,
  issueCategory: dailyReports.issueCategory,
  suggestion: dailyReports.suggestion,
  taskIds: dailyReports.taskIds,
  submittedAt: dailyReports.submittedAt,
  createdAt: dailyReports.createdAt,
  updatedAt: dailyReports.updatedAt,
  version: dailyReports.version,
};

/**
 * 日报数据访问（M6-01 / M6-02）：列表 / 详情 / 唯一键判重 / 乐观锁更新。
 * 权限与可见性由调用方解析（项目上下文已由 ProjectAccessGuard 落地），本层不做记录级判定。
 */
@Injectable()
export class ReportRepository {
  constructor(private readonly database: DatabaseService) {}

  /** 列表（含总数）：项目内按日期倒序；列表与总数共用同一 where 构造器。 */
  async list(
    projectId: string,
    filter: DailyReportFilter,
    page: number,
    limit: number,
    client: DbClient = this.database.db,
  ): Promise<{ rows: DailyReportRow[]; total: number }> {
    const where = this.buildWhere(projectId, filter);
    const rows = await client
      .select(REPORT_COLUMNS)
      .from(dailyReports)
      .leftJoin(users, eq(users.id, dailyReports.authorId))
      .where(where)
      .orderBy(desc(dailyReports.reportDate), desc(dailyReports.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const counted = await client.select({ total: sql<number>`count(*)::int` }).from(dailyReports).where(where);
    return { rows: rows as DailyReportRow[], total: counted[0]?.total ?? 0 };
  }

  async findById(projectId: string, reportId: string, client: DbClient = this.database.db): Promise<DailyReportRow | null> {
    const rows = await client
      .select(REPORT_COLUMNS)
      .from(dailyReports)
      .leftJoin(users, eq(users.id, dailyReports.authorId))
      .where(and(eq(dailyReports.projectId, projectId), eq(dailyReports.id, reportId)))
      .limit(1);
    return (rows[0] ?? null) as DailyReportRow | null;
  }

  /** 一人一项目一天一条（uq_daily_reports_author_date）：判重走唯一键，重复由服务层转 409 REPORT_ALREADY_EXISTS。 */
  async findByAuthorDate(projectId: string, authorId: string, reportDate: string, client: DbClient = this.database.db): Promise<DailyReportRow | null> {
    const rows = await client
      .select(REPORT_COLUMNS)
      .from(dailyReports)
      .leftJoin(users, eq(users.id, dailyReports.authorId))
      .where(
        and(
          eq(dailyReports.projectId, projectId),
          eq(dailyReports.authorId, authorId),
          eq(dailyReports.reportDate, reportDate),
        ),
      )
      .limit(1);
    return (rows[0] ?? null) as DailyReportRow | null;
  }

  /** 当日全量行（A7-01 汇总 / A7-05 应填未填）：项目 × 日期单日；提交时刻升序（草稿 submittedAt 为空，PG 默认排最后）。 */
  async listByDate(
    projectId: string,
    reportDate: string,
    client: DbClient = this.database.db,
  ): Promise<DailyReportRow[]> {
    const rows = await client
      .select(REPORT_COLUMNS)
      .from(dailyReports)
      .leftJoin(users, eq(users.id, dailyReports.authorId))
      .where(and(eq(dailyReports.projectId, projectId), eq(dailyReports.reportDate, reportDate)))
      .orderBy(asc(dailyReports.submittedAt), asc(dailyReports.authorId));
    return rows as DailyReportRow[];
  }
  async insert(input: DailyReportInsertInput, at: Date, client: DbClient): Promise<DailyReportRow> {
    const inserted = await client
      .insert(dailyReports)
      .values({
        projectId: input.projectId,
        authorId: input.authorId,
        reportDate: input.reportDate,
        state: input.state,
        headcount: input.headcount,
        doneWork: input.doneWork,
        plan: input.plan,
        foundIssue: input.foundIssue,
        issueCategory: input.issueCategory,
        suggestion: input.suggestion,
        taskIds: input.taskIds,
        submittedAt: input.submittedAt,
        createdAt: at,
        updatedAt: at,
      })
      .returning({ id: dailyReports.id });
    const id = inserted[0]?.id;
    if (id === undefined) throw new Error("daily_reports insert 未返回 id");
    const row = await this.findById(input.projectId, id, client);
    if (row === null) throw new Error("daily_reports insert 后读回失败：" + id);
    return row;
  }

  /** 乐观锁更新（version 不匹配返回 false，由服务层转 409 VERSION_CONFLICT）。 */
  async updateWithVersion(reportId: string, expectedVersion: number, patch: DailyReportPatch, at: Date, client: DbClient): Promise<boolean> {
    const rows = await client
      .update(dailyReports)
      .set({ ...patch, version: sql`${dailyReports.version} + 1`, updatedAt: at })
      .where(and(eq(dailyReports.id, reportId), eq(dailyReports.version, expectedVersion)))
      .returning({ id: dailyReports.id });
    return rows.length > 0;
  }

  /** 关联任务标题（A3-03 展示）：只取本项目未软删任务；缺项由服务层转 400（关联任务必须属于本项目）。 */
  async taskTitles(projectId: string, taskIds: readonly string[], client: DbClient = this.database.db): Promise<Map<string, string>> {
    if (taskIds.length === 0) return new Map();
    const rows = await client
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), inArray(tasks.id, [...taskIds]), isNull(tasks.deletedAt)));
    return new Map(rows.map((row) => [row.id, row.title]));
  }

  /**
   * A3-08 回写：把日报「当日完成工作」追加到关联任务的「项目进展描述」（tasks.note，技术设计v0.2 §2.3）+ 写一条
   * task_events（note_change）留痕，标注来源日报。幂等键 = 「【日报 <日期>】」标记 —— 同一任务同一天只追加一次，
   * 日报重编辑不重复追加。
   * 口径（差异登记）：与变更记录 R01 一致 —— 只动 note、不动任务乐观锁版本（不打断正在编辑任务的人）。
   * 跨域说明：本方法直接写任务侧两表，是「日报 → 任务」单向回写的唯一落点（M6-02）；返回 false = 未追加（任务不存在 / 已追加过）。
   */
  async appendTaskProgress(
    projectId: string,
    taskId: string,
    reportDate: string,
    text: string,
    actorId: string,
    at: Date,
    client: DbClient,
  ): Promise<boolean> {
    const rows = await client
      .select({ note: tasks.note })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
      .for("update");
    const current = rows[0];
    if (current === undefined) return false;
    const marker = progressMarker(reportDate);
    const before = current.note ?? "";
    if (before.includes(marker)) return false;
    const head = before.trim().length === 0 ? "" : before.replace(/\s+$/, "") + "\n";
    const after = head + marker + text;
    await client.update(tasks).set({ note: after }).where(eq(tasks.id, taskId));
    await client.insert(taskEvents).values({
      taskId,
      eventType: "note_change",
      beforeValue: before.length === 0 ? null : before,
      afterValue: after,
      actorId,
      createdAt: at,
    });
    return true;
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

  private buildWhere(projectId: string, filter: DailyReportFilter) {
    const conditions = [eq(dailyReports.projectId, projectId)];
    if (filter.dateFrom !== null) conditions.push(gte(dailyReports.reportDate, filter.dateFrom));
    if (filter.dateTo !== null) conditions.push(lte(dailyReports.reportDate, filter.dateTo));
    if (filter.states !== null) conditions.push(inArray(dailyReports.state, filter.states));
    if (filter.authorId !== null) conditions.push(eq(dailyReports.authorId, filter.authorId));
    return and(...conditions);
  }
}
