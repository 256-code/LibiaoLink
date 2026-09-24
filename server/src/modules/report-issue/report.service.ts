import { Injectable } from "@nestjs/common";
import {
  DailyReportCreateBodySchema,
  DailyReportListQuerySchema,
  DailyReportListResponseSchema,
  DailyReportSchema,
  DailyReportUpdateBodySchema,
  z,
} from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import type { DbClient } from "../../db/db-client.js";
import { DatabaseService } from "../../db/database.service.js";
import { appendOutbox } from "../../db/outbox.js";
import { AuditService, diffRecords } from "../admin/index.js";
import { shanghaiToday } from "../task/index.js";
import { IssueRepository, type IssueRow } from "./issue.repository.js";
import { ReportRepository, type DailyReportPatch, type DailyReportRow } from "./report.repository.js";
import {
  assertReportStateWrite,
  departmentOfCategory,
  isFutureDate,
  parseReportFilter,
  resolveReportState,
} from "./report-issue.rules.js";

type DailyReport = z.infer<typeof DailyReportSchema>;
type DailyReportListQuery = z.infer<typeof DailyReportListQuerySchema>;
type DailyReportListResponse = z.infer<typeof DailyReportListResponseSchema>;
type DailyReportCreateBody = z.infer<typeof DailyReportCreateBodySchema>;
type DailyReportUpdateBody = z.infer<typeof DailyReportUpdateBodySchema>;

/** 日报快照（字段级留痕口径：九个业务字段 + 状态）。 */
function reportSnapshot(row: DailyReportRow): Record<string, unknown> {
  return {
    reportDate: row.reportDate,
    state: row.state,
    headcount: row.headcount,
    doneWork: row.doneWork,
    plan: row.plan,
    foundIssue: row.foundIssue,
    issueCategory: row.issueCategory,
    suggestion: row.suggestion,
    taskIds: row.taskIds,
  };
}

/** 问题快照（A3-09 自动生成时的字段级留痕）。 */
function issueSnapshot(row: IssueRow): Record<string, unknown> {
  return {
    title: row.title,
    category: row.category,
    state: row.state,
    taskId: row.taskId,
    sourceReportId: row.sourceReportId,
    ownerDepartment: row.ownerDepartment,
    raisedAt: row.raisedAt,
  };
}

/** 问题描述上限（issues.title CHECK 1~500）：日报原文超长时截短落库，原文仍在日报行。 */
const ISSUE_TITLE_MAX = 500;

/** 行 → 契约（taskTitles 与 taskIds 同下标；缺项由 assertTasksInProject 提前拦截，正常不会出现空串）。 */
export function toDailyReportView(row: DailyReportRow, titles: Map<string, string>): DailyReport {
  return {
    id: row.id,
    projectId: row.projectId,
    authorId: row.authorId,
    authorName: row.authorName,
    date: row.reportDate,
    state: row.state as DailyReport["state"],
    headcount: row.headcount,
    doneWork: row.doneWork,
    plan: row.plan,
    foundIssue: row.foundIssue,
    issueCategory: row.issueCategory as DailyReport["issueCategory"],
    suggestion: row.suggestion,
    taskIds: row.taskIds,
    taskTitles: row.taskIds.map((taskId) => titles.get(taskId) ?? ""),
    submittedAt: row.submittedAt === null ? null : row.submittedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

/**
 * 日报用例（M6-01 / M6-02 · A3-01 ~ A3-04 / A3-08 / A3-09）。
 * 1) 一人一项目一天一条：重复填报 409 REPORT_ALREADY_EXISTS（服务层先判、唯一键兜底）；
 * 2) 状态：draft / submitted / supplement（对过去日期首次提交 = 补填，服务端推导，不接受客户端指定）；
 * 3) 提交后两件副作用（同事务、均幂等）：A3-09 生成问题（source_report_id 唯一兜底）、A3-08 回写关联任务进展；
 * 4) 留痕：审计（对象 daily_report）+ outbox report.submitted；归档项目写保护 409 PROJECT_ARCHIVED。
 * 权限：读 = 项目可见（成员平权）；写 = report.fill（成员平权，见 permission.rules 平权例外）。
 */
@Injectable()
export class ReportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly reports: ReportRepository,
    private readonly issues: IssueRepository,
    private readonly audit: AuditService,
  ) {}

  /** GET /api/v1/projects/{id}/reports：日期区间 / 状态 / 提交人 + 分页，日期倒序。 */
  async list(projectId: string, query: DailyReportListQuery): Promise<DailyReportListResponse> {
    const filter = parseReportFilter(query);
    const { rows, total } = await this.reports.list(projectId, filter, query.page, query.limit);
    const titles = await this.reports.taskTitles(projectId, rows.flatMap((row) => row.taskIds));
    return {
      items: rows.map((row) => toDailyReportView(row, titles)),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  /** GET /api/v1/projects/{id}/reports/{reportId}：不属本项目 / 不存在统一 404。 */
  async detail(projectId: string, reportId: string): Promise<DailyReport> {
    const row = await this.requireReport(projectId, reportId, this.database.db);
    const titles = await this.reports.taskTitles(projectId, row.taskIds);
    return toDailyReportView(row, titles);
  }

  /** POST /api/v1/projects/{id}/reports：新报一天（草稿 / 提交）；提交即触发 A3-08 / A3-09。 */
  async create(projectId: string, body: DailyReportCreateBody, actorId: string): Promise<DailyReport> {
    await this.loadProjectForWrite(projectId);
    const at = new Date();
    const today = shanghaiToday(at);
    if (isFutureDate(body.date, today)) {
      throw new AppError("VALIDATION_FAILED", "不能填报未来日期的日报（A3-04）", [
        { code: "future_date", message: "填报日期不得晚于今天（" + today + "）", path: "date" },
      ]);
    }
    const state = resolveReportState(body.state, body.date, today);
    let createdId = "";
    await this.database.db.transaction(async (tx) => {
      const existing = await this.reports.findByAuthorDate(projectId, actorId, body.date, tx);
      if (existing !== null) {
        throw new AppError("REPORT_ALREADY_EXISTS", "当天日报已存在，请改用编辑（一人一项目一天一条）", [
          { code: "duplicate_report", message: "已存在日报：" + existing.id, path: "date", meta: { reportId: existing.id } },
        ]);
      }
      const taskIds = body.taskIds ?? [];
      await this.assertTasksInProject(projectId, taskIds, tx);
      const row = await this.reports.insert(
        {
          projectId,
          authorId: actorId,
          reportDate: body.date,
          state,
          headcount: body.headcount ?? null,
          doneWork: body.doneWork,
          plan: body.plan ?? null,
          foundIssue: body.foundIssue ?? null,
          issueCategory: body.issueCategory ?? null,
          suggestion: body.suggestion ?? null,
          taskIds,
          submittedAt: state === "draft" ? null : at,
        },
        at,
        tx,
      );
      createdId = row.id;
      await this.audit.record(tx, {
        actorId,
        action: "create",
        objectType: "daily_report",
        objectId: row.id,
        projectId,
        summary: "填报日报：" + row.reportDate,
        changes: diffRecords({}, reportSnapshot(row)),
        metadata: { state: row.state, taskIds: row.taskIds },
      });
      await appendOutbox(tx, {
        topic: "report.submitted",
        dedupeKey: "report.submitted:" + row.id + ":" + row.version,
        payload: { projectId, reportId: row.id, authorId: actorId, reportDate: row.reportDate, state: row.state, at: at.toISOString() },
      });
      if (row.state !== "draft") await this.afterSubmit(tx, row, actorId, at);
    });
    return this.detail(projectId, createdId);
  }

  /** PATCH /api/v1/projects/{id}/reports/{reportId}：乐观锁编辑 / 草稿提交；date 不可改（唯一键组成）。 */
  async update(projectId: string, reportId: string, body: DailyReportUpdateBody, actorId: string): Promise<DailyReport> {
    await this.loadProjectForWrite(projectId);
    const at = new Date();
    const today = shanghaiToday(at);
    await this.database.db.transaction(async (tx) => {
      const before = await this.requireReport(projectId, reportId, tx);
      assertReportStateWrite(before.state, body.state);
      if (body.taskIds !== undefined) await this.assertTasksInProject(projectId, body.taskIds, tx);
      const foundIssue = body.foundIssue === undefined ? before.foundIssue : body.foundIssue;
      const issueCategory = body.issueCategory === undefined ? before.issueCategory : body.issueCategory;
      if (foundIssue !== null && foundIssue.trim().length > 0 && issueCategory === null) {
        throw new AppError("VALIDATION_FAILED", "「现场发现问题」非空时问题归类必填（A3-04）", [
          { code: "issue_category_required", message: "请选择问题归类（C9 十项）", path: "issueCategory" },
        ]);
      }
      const patch: DailyReportPatch = {};
      if (body.headcount !== undefined) patch.headcount = body.headcount;
      if (body.doneWork !== undefined) patch.doneWork = body.doneWork;
      if (body.plan !== undefined) patch.plan = body.plan;
      if (body.foundIssue !== undefined) patch.foundIssue = body.foundIssue;
      if (body.issueCategory !== undefined) patch.issueCategory = body.issueCategory;
      if (body.suggestion !== undefined) patch.suggestion = body.suggestion;
      if (body.taskIds !== undefined) patch.taskIds = body.taskIds;
      if (body.state === "submitted") {
        patch.state = before.state === "draft" ? resolveReportState("submitted", before.reportDate, today) : before.state;
        patch.submittedAt = before.submittedAt ?? at;
      }
      const updated = await this.reports.updateWithVersion(reportId, body.version, patch, at, tx);
      if (!updated) {
        throw new AppError("VERSION_CONFLICT", "日报已被他人修改，请刷新后重试", [
          { code: "version_conflict", message: "期望 version = " + body.version, path: "version" },
        ]);
      }
      const after = await this.requireReport(projectId, reportId, tx);
      await this.audit.record(tx, {
        actorId,
        action: "update",
        objectType: "daily_report",
        objectId: reportId,
        projectId,
        summary: "编辑日报：" + after.reportDate,
        changes: diffRecords(reportSnapshot(before), reportSnapshot(after)),
        metadata: { state: after.state },
      });
      if (before.state === "draft" && after.state !== "draft") {
        await appendOutbox(tx, {
          topic: "report.submitted",
          dedupeKey: "report.submitted:" + after.id + ":" + after.version,
          payload: { projectId, reportId: after.id, authorId: actorId, reportDate: after.reportDate, state: after.state, at: at.toISOString() },
        });
      }
      if (after.state !== "draft") await this.afterSubmit(tx, after, actorId, at);
    });
    return this.detail(projectId, reportId);
  }

  /**
   * 提交后副作用（A3-08 回写任务进展 / A3-09 问题自动生成）：两件都幂等，可安全重放。
   * ① 问题：source_report_id 唯一约束兜底 —— 已生成过则 insert 返回 null（不重复写事件与留痕）；
   * ② 回写：以「【日报 <日期>】」标记判重 —— 同一任务同一天只追加一次，日报重编辑不重复追加。
   */
  private async afterSubmit(tx: DbClient, row: DailyReportRow, actorId: string, at: Date): Promise<void> {
    const foundIssue = row.foundIssue === null ? "" : row.foundIssue.trim();
    if (foundIssue.length > 0 && row.issueCategory !== null) {
      const issue = await this.issues.insert(
        {
          projectId: row.projectId,
          taskId: row.taskIds.length === 1 ? (row.taskIds[0] ?? null) : null,
          sourceReportId: row.id,
          title: foundIssue.length > ISSUE_TITLE_MAX ? foundIssue.slice(0, ISSUE_TITLE_MAX) : foundIssue,
          category: row.issueCategory,
          state: "unassigned",
          reporterId: row.authorId,
          ownerDepartment: departmentOfCategory(row.issueCategory),
          ownerId: null,
          dueAt: null,
          raisedAt: row.reportDate,
        },
        at,
        tx,
      );
      if (issue !== null) {
        await this.issues.insertEvent(
          { issueId: issue.id, eventType: "created", fromState: null, toState: "unassigned", note: null },
          actorId,
          at,
          tx,
        );
        await this.audit.record(tx, {
          actorId,
          action: "create",
          objectType: "issue",
          objectId: issue.id,
          projectId: row.projectId,
          summary: "日报自动生成问题：" + issue.title,
          changes: diffRecords({}, issueSnapshot(issue)),
          metadata: { sourceReportId: row.id, category: issue.category, state: issue.state },
        });
        await appendOutbox(tx, {
          topic: "issue.created",
          dedupeKey: "issue.created:" + issue.id,
          payload: { projectId: row.projectId, issueId: issue.id, sourceReportId: row.id, category: issue.category, at: at.toISOString() },
        });
      }
    }
    for (const taskId of row.taskIds) {
      await this.reports.appendTaskProgress(row.projectId, taskId, row.reportDate, row.doneWork, actorId, at, tx);
    }
  }

  private async requireReport(projectId: string, reportId: string, client: DbClient): Promise<DailyReportRow> {
    const row = await this.reports.findById(projectId, reportId, client);
    if (row === null) throw new AppError("NOT_FOUND", "日报不存在：" + reportId);
    return row;
  }

  /** 关联任务必须属于本项目且未软删（A3-03）；否则 400（不是 404 —— 请求体里的引用不成立）。 */
  private async assertTasksInProject(projectId: string, taskIds: readonly string[], client: DbClient): Promise<void> {
    if (taskIds.length === 0) return;
    const titles = await this.reports.taskTitles(projectId, taskIds, client);
    const missing = taskIds.filter((taskId) => !titles.has(taskId));
    if (missing.length > 0) {
      throw new AppError(
        "VALIDATION_FAILED",
        "关联任务不属于本项目或已删除",
        missing.map((taskId) => ({ code: "unknown_task", message: "任务：" + taskId, path: "taskIds" })),
      );
    }
  }

  /** 日报写入口：归档项目一律 409 PROJECT_ARCHIVED（ADR-027）。 */
  private async loadProjectForWrite(projectId: string): Promise<void> {
    const project = await this.reports.findProject(projectId);
    if (project === null) throw new AppError("NOT_FOUND", "项目不存在或不可见");
    if (project.status === "archived") throw new AppError("PROJECT_ARCHIVED", "项目已归档，禁止填报日报");
  }
}
