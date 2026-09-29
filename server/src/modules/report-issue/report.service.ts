import { Injectable } from "@nestjs/common";
import {
  DailyReportCreateBodySchema,
  DailyReportDeleteResponseSchema,
  DailyReportListQuerySchema,
  DailyReportListResponseSchema,
  DailyReportSchema,
  DailyReportUpdateBodySchema,
  STAGE_NAMES,
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
  assertPhotoFilesInProject,
  insertReportPhotos,
  loadReportPhotos,
  moveIssuePhotosToIssue,
  purgeReportCascade,
  replaceIssuePhotos,
  replaceReportPhotos,
  type FilePhotoRefRow,
} from "./report-issue.links.js";
import {
  assertReportStateWrite,
  departmentOfCategories,
  isFutureDate,
  parseReportFilter,
  resolveReportState,
} from "./report-issue.rules.js";

type DailyReport = z.infer<typeof DailyReportSchema>;
type DailyReportDeleteResponse = z.infer<typeof DailyReportDeleteResponseSchema>;
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
    issueCategories: row.issueCategories,
    suggestion: row.suggestion,
    stageKeys: row.stageKeys,
  };
}

/** 问题快照（A3-09 自动生成时的字段级留痕）。 */
function issueSnapshot(row: IssueRow): Record<string, unknown> {
  return {
    title: row.title,
    categories: row.categories,
    state: row.state,
    taskId: row.taskId,
    sourceReportId: row.sourceReportId,
    ownerDepartment: row.ownerDepartment,
    raisedAt: row.raisedAt,
  };
}

/** 问题描述上限（issues.title CHECK 1~500）：日报原文超长时截短落库，原文仍在日报行。 */
const ISSUE_TITLE_MAX = 500;

/** 行 → 契约（stageNames 查 STAGE_NAMES；photos / issuePhotos 由调用方批量装载后传入）。 */
export function toDailyReportView(row: DailyReportRow, photos: { onsite: FilePhotoRefRow[]; issue: FilePhotoRefRow[] }): DailyReport {
  const stageNameByKey = STAGE_NAMES as Record<string, string>;
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
    issueCategories: row.issueCategories as DailyReport["issueCategories"],
    suggestion: row.suggestion,
    stageKeys: row.stageKeys as DailyReport["stageKeys"],
    stageNames: row.stageKeys.map((key) => stageNameByKey[key] ?? key),
    photos: photos.onsite,
    issuePhotos: photos.issue,
    submittedAt: row.submittedAt === null ? null : row.submittedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

/**
 * 日报用例（M6-01 / M6-02 · A3-01 ~ A3-04 / A3-09 · Push 215）。
 * 1) 同人同项目同日可多条（原「一人一天一条」与 409 REPORT_ALREADY_EXISTS 随批删除）；
 * 2) 状态：draft / submitted / supplement（对过去日期首次提交 = 补填，服务端推导，不接受客户端指定）；
 * 3) 提交后副作用（同事务、幂等）：A3-09 生成问题（source_report_id 唯一兜底），并把问题图从日报转挂到问题；
 * 4) 附图（方案一）：现场图 / 问题图都挂 file_links(report, kind=onsite|issue)，整体替换语义；
 * 5) 删除为成对删除：删日报 = 连它派生的全部问题 + 两侧附图关联（DELETE）；
 * 6) 留痕：审计（对象 daily_report + 连带问题）+ outbox report.submitted / report.deleted；归档项目写保护 409 PROJECT_ARCHIVED。
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
    const photos = await loadReportPhotos(rows.map((row) => row.id), this.database.db);
    return {
      items: rows.map((row) => toDailyReportView(row, photos.get(row.id) ?? { onsite: [], issue: [] })),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  /** GET /api/v1/projects/{id}/reports/{reportId}：不属本项目 / 不存在统一 404。 */
  async detail(projectId: string, reportId: string): Promise<DailyReport> {
    const row = await this.requireReport(projectId, reportId, this.database.db);
    const photos = await loadReportPhotos([reportId], this.database.db);
    return toDailyReportView(row, photos.get(reportId) ?? { onsite: [], issue: [] });
  }

  /** POST /api/v1/projects/{id}/reports：新报一天（草稿 / 提交）；同日多条可重复新建（Push 215）；提交即触发 A3-09。 */
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
    const stageKeys = [...new Set(body.stageKeys ?? [])];
    const foundIssueText = body.foundIssue === undefined ? "" : body.foundIssue.trim();
    const issueCategories = foundIssueText.length === 0 ? [] : (body.issueCategories ?? []);
    const photoFileIds = body.photoFileIds ?? [];
    const issuePhotoFileIds = body.issuePhotoFileIds ?? [];
    if (photoFileIds.length > 0 || issuePhotoFileIds.length > 0) {
      await assertPhotoFilesInProject(projectId, [...photoFileIds, ...issuePhotoFileIds], this.database.db);
    }
    let createdId = "";
    await this.database.db.transaction(async (tx) => {
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
          issueCategories,
          suggestion: body.suggestion ?? null,
          stageKeys,
          submittedAt: state === "draft" ? null : at,
        },
        at,
        tx,
      );
      createdId = row.id;
      await insertReportPhotos(row.id, "onsite", photoFileIds, actorId, at, tx);
      await insertReportPhotos(row.id, "issue", issuePhotoFileIds, actorId, at, tx);
      await this.audit.record(tx, {
        actorId,
        action: "create",
        objectType: "daily_report",
        objectId: row.id,
        projectId,
        summary: "填报日报：" + row.reportDate,
        changes: diffRecords({}, reportSnapshot(row)),
        metadata: { state: row.state, stageKeys: row.stageKeys },
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

  /** PATCH /api/v1/projects/{id}/reports/{reportId}：乐观锁编辑 / 草稿提交；date 不可改；附图整体替换（Push 215）。 */
  async update(projectId: string, reportId: string, body: DailyReportUpdateBody, actorId: string): Promise<DailyReport> {
    await this.loadProjectForWrite(projectId);
    const at = new Date();
    const today = shanghaiToday(at);
    const photoFileIds = body.photoFileIds;
    const issuePhotoFileIds = body.issuePhotoFileIds;
    if (photoFileIds !== undefined || issuePhotoFileIds !== undefined) {
      await assertPhotoFilesInProject(projectId, [...(photoFileIds ?? []), ...(issuePhotoFileIds ?? [])], this.database.db);
    }
    await this.database.db.transaction(async (tx) => {
      const before = await this.requireReport(projectId, reportId, tx);
      assertReportStateWrite(before.state, body.state);
      const foundIssue = body.foundIssue === undefined ? before.foundIssue : body.foundIssue;
      const issueCategories = body.issueCategories === undefined ? before.issueCategories : (body.issueCategories ?? []);
      if (foundIssue !== null && foundIssue.trim().length > 0 && issueCategories.length === 0) {
        throw new AppError("VALIDATION_FAILED", "「现场发现问题」非空时问题归类必填（A3-04）", [
          { code: "issue_category_required", message: "请选择问题归类（C9 十项）", path: "issueCategories" },
        ]);
      }
      const patch: DailyReportPatch = {};
      if (body.headcount !== undefined) patch.headcount = body.headcount;
      if (body.doneWork !== undefined) patch.doneWork = body.doneWork;
      if (body.plan !== undefined) patch.plan = body.plan;
      if (body.foundIssue !== undefined) patch.foundIssue = body.foundIssue;
      if (body.issueCategories !== undefined) patch.issueCategories = issueCategories;
      if (body.suggestion !== undefined) patch.suggestion = body.suggestion;
      if (body.stageKeys !== undefined) patch.stageKeys = [...new Set(body.stageKeys)];
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
      if (photoFileIds !== undefined) {
        await replaceReportPhotos(reportId, "onsite", photoFileIds, actorId, at, tx);
      }
      if (issuePhotoFileIds !== undefined) {
        const generated = await this.issues.findBySourceReport(reportId, tx);
        if (generated === null) await replaceReportPhotos(reportId, "issue", issuePhotoFileIds, actorId, at, tx);
        else await replaceIssuePhotos(generated.id, issuePhotoFileIds, actorId, at, tx);
      }
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
   * 提交后副作用（A3-09 问题自动生成 · Push 215 幂等可重放）：source_report_id 唯一约束兜底 ——
   * 已生成过则 insert 返回 null（不重复写事件与留痕）；新生成时把日报「当前问题附图」转挂到问题（file_links(issue)）。
   * A3-08 回写关联任务进展随「关联任务改关联阶段」停用（Push 215）。
   */
  private async afterSubmit(tx: DbClient, row: DailyReportRow, actorId: string, at: Date): Promise<void> {
    const foundIssue = row.foundIssue === null ? "" : row.foundIssue.trim();
    if (foundIssue.length === 0 || row.issueCategories.length === 0) return;
    const issue = await this.issues.insert(
      {
        projectId: row.projectId,
        taskId: null,
        sourceReportId: row.id,
        title: foundIssue.length > ISSUE_TITLE_MAX ? foundIssue.slice(0, ISSUE_TITLE_MAX) : foundIssue,
        categories: row.issueCategories,
        state: "open",
        reporterId: row.authorId,
        ownerDepartment: departmentOfCategories(row.issueCategories),
        ownerId: null,
        raisedAt: row.reportDate,
      },
      at,
      tx,
    );
    if (issue === null) return;
    await moveIssuePhotosToIssue(row.id, issue.id, actorId, at, tx);
    await this.issues.insertEvent(
      { issueId: issue.id, eventType: "created", fromState: null, toState: "open", note: null },
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
      metadata: { sourceReportId: row.id, categories: issue.categories, state: issue.state },
    });
    await appendOutbox(tx, {
      topic: "issue.created",
      dedupeKey: "issue.created:" + issue.id,
      payload: { projectId: row.projectId, issueId: issue.id, sourceReportId: row.id, categories: issue.categories, at: at.toISOString() },
    });
  }

  private async requireReport(projectId: string, reportId: string, client: DbClient): Promise<DailyReportRow> {
    const row = await this.reports.findById(projectId, reportId, client);
    if (row === null) throw new AppError("NOT_FOUND", "日报不存在：" + reportId);
    return row;
  }

  /** DELETE /api/v1/projects/{id}/reports/{reportId}：成对删除（删日报 = 连它派生的全部问题 + 两侧附图关联）。 */
  async remove(projectId: string, reportId: string, actorId: string): Promise<DailyReportDeleteResponse> {
    await this.loadProjectForWrite(projectId);
    const at = new Date();
    let cascadedIssueIds: string[] = [];
    await this.database.db.transaction(async (tx) => {
      const row = await this.requireReport(projectId, reportId, tx);
      cascadedIssueIds = await purgeReportCascade(reportId, tx);
      for (const issueId of cascadedIssueIds) {
        await this.audit.record(tx, {
          actorId,
          action: "delete",
          objectType: "issue",
          objectId: issueId,
          projectId,
          summary: "连带删除日报派生问题",
          metadata: { sourceReportId: reportId },
        });
      }
      await this.audit.record(tx, {
        actorId,
        action: "delete",
        objectType: "daily_report",
        objectId: reportId,
        projectId,
        summary: "删除日报：" + row.reportDate,
        metadata: { cascadedIssueIds },
      });
      await appendOutbox(tx, {
        topic: "report.deleted",
        dedupeKey: "report.deleted:" + reportId,
        payload: { projectId, reportId, cascadedIssueIds, at: at.toISOString() },
      });
    });
    return { id: reportId, deleted: true, cascadedIssueIds };
  }

  /** 日报写入口：归档项目一律 409 PROJECT_ARCHIVED（ADR-027）。 */
  private async loadProjectForWrite(projectId: string): Promise<void> {
    const project = await this.reports.findProject(projectId);
    if (project === null) throw new AppError("NOT_FOUND", "项目不存在或不可见");
    if (project.status === "archived") throw new AppError("PROJECT_ARCHIVED", "项目已归档，禁止填报日报");
  }
}
