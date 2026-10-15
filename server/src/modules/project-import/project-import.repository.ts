import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
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
import { projectStakeholders, stakeholders } from "../../db/schema/stakeholders.js";

export type { ProjectImportPreviewRow };

/** 过期 pending 票据清扫：每轮最多处理条数（worker 周期任务，防止长事务 / 大结果集）。 */
export const IMPORT_PREVIEW_SWEEP_BATCH = 100;
/** 过期 pending 票据清扫周期（10 分钟）：启动即跑一次，随后周期重试。 */
export const IMPORT_PREVIEW_SWEEP_INTERVAL_MS = 10 * 60_000;

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
  /** 处理人（Push 319）：源表没有处理人字段 —— 未解决（open / in_progress）默认 = 项目经理（服务层判定），已完成 = null。 */
  ownerId: string | null;
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

/** 干系人行（Push 324）：台账 stakeholders + 项目关联 project_stakeholders 同批写。 */
export interface ImportStakeholderInsert {
  name: string;
  companyType: string;
  company: string | null;
  title: string | null;
  phone: string | null;
  wechat: string | null;
  email: string | null;
  role: string | null;
  /** 录入人（源表「填写者」匹配库内账号；匹配不到 = null）。 */
  createdBy: string | null;
  /** 提交时间（源表「提交时间」；null = 用导入时间）。 */
  createdAt: Date | null;
}

/**
 * 导入表导入数据访问：预览票据（project_import_previews：插入 / 取回 / 状态机 / 过期清扫输入）+ 读面辅助（用户 / 节点库）+ 提交批量写入。
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

  /** 过期未提交票据（worker 清理输入）：按到期时间升序限量，避免大结果集长占 worker。 */
  async listExpiredPreviews(now: Date, limit: number = IMPORT_PREVIEW_SWEEP_BATCH): Promise<ProjectImportPreviewRow[]> {
    return this.database.db
      .select()
      .from(projectImportPreviews)
      .where(and(eq(projectImportPreviews.status, "pending"), lte(projectImportPreviews.expiresAt, now)))
      .orderBy(asc(projectImportPreviews.expiresAt))
      .limit(limit);
  }

  /** 过期票据终态写入：仍限定 pending，防止清扫与提交并发时覆盖 committed。 */
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
        ownerId: row.ownerId,
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

  async insertChangeRequests(tx: DbClient, projectId: string, rows: ImportChangeInsert[], actorId: string, at: Date): Promise<string[]> {
    if (rows.length === 0) return [];
    const inserted = await tx.insert(changeRequests).values(
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
    )
      .returning({ id: changeRequests.id });
    return inserted.map((row) => row.id);
  }

  /** 干系人入库（Push 324）：台账 + 项目关联同批写（导入单事务内）；返回干系人 id（与入参同序）。 */
  async insertStakeholders(
    tx: DbClient,
    projectId: string,
    rows: ImportStakeholderInsert[],
    actorId: string,
    at: Date,
  ): Promise<string[]> {
    if (rows.length === 0) return [];
    const inserted = await tx
      .insert(stakeholders)
      .values(
        rows.map((row) => ({
          name: row.name,
          companyType: row.companyType,
          company: row.company,
          title: row.title,
          phone: row.phone,
          wechat: row.wechat,
          email: row.email,
          role: row.role,
          createdBy: row.createdBy,
          createdAt: row.createdAt ?? at,
          updatedAt: row.createdAt ?? at,
        })),
      )
      .returning({ id: stakeholders.id });
    const ids = inserted.map((row) => row.id);
    await tx.insert(projectStakeholders).values(
      ids.map((stakeholderId) => ({ projectId, stakeholderId, linkedBy: actorId, linkedAt: at })),
    );
    return ids;
  }

  /** 变更关联回写（Push 319）：把「关联」列命中的变更挂到任务 change_refs（导入的新任务，直接置为本次列表）。 */
  async attachChangeRefs(tx: DbClient, updates: readonly { taskId: string; changeIds: readonly string[] }[]): Promise<void> {
    for (const update of updates) {
      if (update.changeIds.length === 0) continue;
      await tx.update(tasks).set({ changeRefs: [...update.changeIds] }).where(eq(tasks.id, update.taskId));
    }
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
