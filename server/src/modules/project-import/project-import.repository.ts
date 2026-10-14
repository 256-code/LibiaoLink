import { Injectable } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { projectImportPreviews, type ProjectImportPreviewRow } from "../../db/schema/imports.js";
import { users } from "../../db/schema/identity.js";
import type { UserRow } from "../identity/index.js";
import { tasks } from "../../db/schema/tasks.js";
import { dailyReports, issues } from "../../db/schema/reports.js";
import { changeRequests } from "../../db/schema/change.js";
import { fileLinks, fileVersions, files } from "../../db/schema/files.js";
import { projects } from "../../db/schema/projects.js";

export type { ProjectImportPreviewRow };

export interface PreviewInsertInput {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  objectKey: string;
  payload: Record<string, unknown>;
  createdBy: string;
  expiresAt: Date;
}

export interface ImportTaskInsert {
  stageKey: string | null;
  taskNodeId: string | null;
  title: string;
  titleEn: string | null;
  ownerIds: string[];
  status: "pending" | "active" | "done";
  statusOverride: "overdue" | "early_done" | null;
  progress: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualEnd: string | null;
  estimatedDays: number | null;
  headcount: number | null;
  deliverableTypes: string[];
  note: string | null;
  onTime: boolean | null;
  sortIndex: number;
}

export interface ImportReportInsert {
  authorId: string;
  reportDate: string;
  headcount: number | null;
  doneWork: string;
  plan: string | null;
  foundIssue: string | null;
  issueCategories: string[];
  suggestion: string | null;
}

export interface ImportReportIssueInsert {
  reportIndex: number;
  title: string;
  categories: string[];
  state: "open" | "in_progress" | "done";
  solution: string | null;
  reporterId: string;
  raisedAt: string;
  ownerDepartment: string | null;
}

export interface ImportChangeInsert {
  stageKey: string | null;
  appliedAt: Date | null;
  reason: string;
  beforeSummary: string | null;
  afterSummary: string | null;
}

export interface ImportFileInsert {
  id: string;
  name: string;
  objectKey: string;
  sizeBytes: number;
  contentHash: string;
  mime: string | null;
  /** 挂接日报下标（与 insertReports 的返回同序）。 */
  reportIndex: number;
  /** 问题图且该日报生成了问题时 = 问题下标（与 insertReportIssues 的返回同序）：转挂问题侧（kind = 空串）。 */
  issueIndex: number | null;
  kind: "onsite" | "issue";
}

/**
 * 老表导入数据访问：预览票据（project_import_previews）+ 读面辅助（用户 / 节点库）+ 提交批量写入。
 * 写入方法全部接收调用方事务（tx），由服务层保证「建项目 + 全量数据」单事务。
 */
@Injectable()
export class ProjectImportRepository {
  constructor(private readonly database: DatabaseService) {}

  async insertPreview(input: PreviewInsertInput, at: Date, client: DbClient = this.database.db): Promise<ProjectImportPreviewRow> {
    const rows = await client
      .insert(projectImportPreviews)
      .values({
        id: input.id,
        fileName: input.fileName,
        fileSizeBytes: input.fileSizeBytes,
        objectKey: input.objectKey,
        payload: input.payload,
        status: "pending",
        createdBy: input.createdBy,
        createdAt: at,
        expiresAt: input.expiresAt,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error("project_import_previews insert 未返回记录");
    return row;
  }

  async findPreview(id: string): Promise<ProjectImportPreviewRow | null> {
    const rows = await this.database.db.select().from(projectImportPreviews).where(eq(projectImportPreviews.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async markCommitted(id: string, projectId: string, at: Date, client: DbClient = this.database.db): Promise<void> {
    await client
      .update(projectImportPreviews)
      .set({ status: "committed", committedAt: at, committedProjectId: projectId })
      .where(eq(projectImportPreviews.id, id));
  }

  async markExpired(id: string, at: Date): Promise<void> {
    await this.database.db
      .update(projectImportPreviews)
      .set({ status: "expired", committedAt: at })
      .where(and(eq(projectImportPreviews.id, id), eq(projectImportPreviews.status, "pending")));
  }

  /** 项目编号是否已占用（含未删行；硬删后释放 —— 与 projects_code_key 唯一约束同口径）。 */
  async projectCodeExists(code: string): Promise<boolean> {
    const rows = await this.database.db.select({ id: projects.id }).from(projects).where(eq(projects.code, code)).limit(1);
    return rows.length > 0;
  }

  async findUsersByUsernames(usernames: readonly string[]): Promise<UserRow[]> {
    if (usernames.length === 0) return [];
    return this.database.db.select().from(users).where(inArray(users.username, [...usernames]));
  }

  async findUsersByDisplayNames(names: readonly string[]): Promise<UserRow[]> {
    if (names.length === 0) return [];
    return this.database.db.select().from(users).where(inArray(users.displayName, [...names]));
  }

  async insertTasks(tx: DbClient, projectId: string, rows: ImportTaskInsert[], at: Date): Promise<string[]> {
    if (rows.length === 0) return [];
    const inserted = await tx
      .insert(tasks)
      .values(
        rows.map((row) => ({
          projectId,
          stageKey: row.stageKey,
          taskNodeId: row.taskNodeId,
          title: row.title,
          titleEn: row.titleEn,
          ownerIds: row.ownerIds,
          status: row.status,
          statusOverride: row.statusOverride,
          progress: String(row.progress),
          plannedStart: row.plannedStart,
          plannedEnd: row.plannedEnd,
          actualEnd: row.actualEnd,
          estimatedDays: row.estimatedDays,
          headcount: row.headcount,
          deliverableTypes: row.deliverableTypes,
          note: row.note,
          onTime: row.onTime,
          sortIndex: row.sortIndex,
          createdAt: at,
          updatedAt: at,
        })),
      )
      .returning({ id: tasks.id });
    return inserted.map((row) => row.id);
  }

  async insertReports(tx: DbClient, projectId: string, rows: ImportReportInsert[], at: Date): Promise<string[]> {
    if (rows.length === 0) return [];
    const inserted = await tx
      .insert(dailyReports)
      .values(
        rows.map((row) => ({
          projectId,
          authorId: row.authorId,
          reportDate: row.reportDate,
          state: "submitted",
          headcount: row.headcount,
          doneWork: row.doneWork,
          plan: row.plan,
          foundIssue: row.foundIssue,
          issueCategories: row.issueCategories,
          suggestion: row.suggestion,
          issueDrafts: [],
          stageKeys: [],
          submittedAt: at,
          createdAt: at,
          updatedAt: at,
          version: 1,
        })),
      )
      .returning({ id: dailyReports.id });
    return inserted.map((row) => row.id);
  }

  async insertReportIssues(
    tx: DbClient,
    projectId: string,
    reportIds: string[],
    rows: ImportReportIssueInsert[],
    at: Date,
  ): Promise<string[]> {
    if (rows.length === 0) return [];
    const values = rows.map((row) => {
      const reportId = reportIds[row.reportIndex];
      if (reportId === undefined) throw new Error("日报问题挂接失败：报告下标越界");
      const closed = row.state === "done";
      return {
        projectId,
        taskId: null,
        sourceReportId: reportId,
        title: row.title.length > 500 ? row.title.slice(0, 500) : row.title,
        categories: row.categories,
        state: row.state,
        reporterId: row.reporterId,
        ownerDepartment: row.ownerDepartment,
        ownerId: null,
        raisedAt: row.raisedAt,
        solution: row.solution === null ? null : row.solution.length > 2000 ? row.solution.slice(0, 2000) : row.solution,
        closedAt: closed ? at : null,
        createdAt: at,
        updatedAt: at,
        version: 1,
      };
    });
    const inserted = await tx.insert(issues).values(values).returning({ id: issues.id });
    return inserted.map((row) => row.id);
  }

  async insertChangeRequests(tx: DbClient, projectId: string, rows: ImportChangeInsert[], actorId: string, at: Date): Promise<void> {
    if (rows.length === 0) return;
    await tx.insert(changeRequests).values(
      rows.map((row) => ({
        projectId,
        nodeId: null,
        stageKey: row.stageKey,
        reason: row.reason,
        beforeSummary: row.beforeSummary,
        afterSummary: row.afterSummary,
        status: "applied",
        appliedBy: actorId,
        appliedAt: row.appliedAt ?? at,
        createdAt: at,
      })),
    );
  }

  /**
   * 文件入库（files + file_versions + file_links 挂接）：对象已在调用前上传，事务内只落元数据。
   * 挂接口径与日报模块一致：现场图挂日报（kind = onsite）；问题图随「日报已生成问题」转挂问题侧（object_type = issue、kind = 空串），
   * 未生成问题的日报问题图仍挂日报（kind = issue）。
   */
  async insertFiles(
    tx: DbClient,
    projectId: string,
    reportIds: string[],
    issueIds: string[],
    rows: ImportFileInsert[],
    actorId: string,
    at: Date,
  ): Promise<void> {
    if (rows.length === 0) return;
    await tx.insert(files).values(
      rows.map((row) => ({
        id: row.id,
        projectId,
        nodeId: null,
        taskId: null,
        docType: null,
        name: row.name,
        status: "draft",
        version: 0,
        createdBy: actorId,
        createdAt: at,
        updatedAt: at,
      })),
    );
    await tx.insert(fileVersions).values(
      rows.map((row) => ({
        fileId: row.id,
        seq: 1,
        objectKey: row.objectKey,
        sizeBytes: row.sizeBytes,
        contentHash: row.contentHash,
        mime: row.mime,
        uploadedBy: actorId,
        uploadedAt: at,
      })),
    );
    await tx.insert(fileLinks).values(
      rows.map((row) => {
        if (row.kind === "issue" && row.issueIndex !== null) {
          const issueId = issueIds[row.issueIndex];
          if (issueId === undefined) throw new Error("图片挂接失败：问题下标越界");
          return {
            fileId: row.id,
            objectType: "issue",
            objectId: issueId,
            kind: "",
            createdBy: actorId,
            createdAt: at,
          };
        }
        const reportId = reportIds[row.reportIndex];
        if (reportId === undefined) throw new Error("图片挂接失败：日报下标越界");
        return {
          fileId: row.id,
          objectType: "report",
          objectId: reportId,
          kind: row.kind,
          createdBy: actorId,
          createdAt: at,
        };
      }),
    );
    for (const row of rows) {
      await tx
        .update(files)
        .set({ currentVersionId: sql`(select id from file_versions where file_id = ${row.id} and seq = 1)`, updatedAt: at })
        .where(eq(files.id, row.id));
    }
  }
}
