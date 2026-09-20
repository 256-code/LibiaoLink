import { Injectable } from "@nestjs/common";
import { STAGE_KEYS } from "@libiaolink/contracts";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient } from "../../db/db-client.js";
import { changeRequests } from "../../db/schema/change.js";
import { files } from "../../db/schema/files.js";
import { projectNodes } from "../../db/schema/flow.js";
import { users } from "../../db/schema/identity.js";
import { projectStages, projects } from "../../db/schema/projects.js";
import { taskEvents, tasks } from "../../db/schema/tasks.js";
import type { TaskListFilter, TaskSort } from "./task.query.js";

export type TaskRow = typeof tasks.$inferSelect;

export interface TaskListRow {
  task: TaskRow;
  ownerName: string | null;
  changeSummary: string | null;
}

export interface TaskFileSummaryCounts {
  total: number;
  draft: number;
  final: number;
}

export interface TaskFileBriefRow {
  id: string;
  name: string;
  status: string;
  docType: string | null;
}

export interface TaskProjectRow {
  id: string;
  managerId: string;
  stageKey: string;
  status: string;
}

export interface TaskProjectNodeRow {
  id: string;
  stageKey: string;
  status: string;
}

export interface TaskInsertInput {
  projectId: string;
  stageKey: string;
  nodeId: string | null;
  title: string;
  titleEn: string | null;
  ownerId: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  estimatedDays: number | null;
  headcount: number | null;
  priority: string | null;
  deliverable: string | null;
  note: string | null;
}

export interface TaskUpdatePatch {
  ownerId?: string;
  status?: string;
  progress?: string;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  actualEnd?: string | null;
  estimatedDays?: number | null;
  headcount?: number | null;
  priority?: string | null;
  note?: string | null;
}

export interface TaskEventInput {
  taskId: string;
  eventType: string;
  beforeValue: string | null;
  afterValue: string | null;
}

const SORT_COLUMNS = {
  plannedStart: tasks.plannedStart,
  plannedEnd: tasks.plannedEnd,
  actualEnd: tasks.actualEnd,
  progress: tasks.progress,
  title: tasks.title,
  createdAt: tasks.createdAt,
} as const;

/** 默认排序：阶段序（STAGE_KEYS 契约顺序）→ 组内 plannedStart ASC NULLS LAST → created_at → id（A8，稳定分页）。 */
const STAGE_ORDER = sql`case ${tasks.stageKey} ${sql.join(
  STAGE_KEYS.map((key, index) => sql`when ${key} then ${index}`),
  sql` `,
)} else ${STAGE_KEYS.length} end`;

/** 文件摘要口径：排除回收站（recycled）；total = 任务下全部文件，draft = 未定档，final = 已定档（final + changed）。 */
const FILE_STATUS_FOR_SUMMARY = ["draft", "final", "changed", "archived"];

/**
 * task 数据访问（M3-01 / M3-02）：列表 / 详情 / 写入 / 事件留痕 / 项目触点（ADR-022）都在本层。
 * 展示态筛选按派生定义下推 SQL（overdue / early_done 非存储态），与读时派生同一口径。
 * 项目触点单点在本层（tasks 属项目聚合视图）；ProjectToucher 统一收口随 h6 / 后续卡（避免模块循环依赖）。
 */
@Injectable()
export class TaskRepository {
  constructor(private readonly database: DatabaseService) {}

  async listPage(
    projectId: string,
    filter: TaskListFilter,
    sorts: readonly TaskSort[],
    limit: number,
    offset: number,
    today: string,
    client: DbClient = this.database.db,
  ): Promise<{ items: TaskListRow[]; total: number }> {
    const where = and(...taskConditions(projectId, filter, today));
    const items = await client
      .select({ task: tasks, ownerName: users.displayName, changeSummary: changeRequests.reason })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.ownerId))
      .leftJoin(changeRequests, eq(changeRequests.id, tasks.changeRef))
      .where(where)
      .orderBy(...taskOrderBy(sorts))
      .limit(limit)
      .offset(offset);
    const totals = await client.select({ value: count() }).from(tasks).where(where);
    return { items, total: Number(totals[0]?.value ?? 0) };
  }

  async findListRowById(taskId: string, projectId: string, client: DbClient = this.database.db): Promise<TaskListRow | null> {
    const rows = await client
      .select({ task: tasks, ownerName: users.displayName, changeSummary: changeRequests.reason })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.ownerId))
      .leftJoin(changeRequests, eq(changeRequests.id, tasks.changeRef))
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 详情文件清单：排除回收站（recycled），按创建时间倒序。 */
  async listFiles(taskId: string, client: DbClient = this.database.db): Promise<TaskFileBriefRow[]> {
    return client
      .select({ id: files.id, name: files.name, status: files.status, docType: files.docType })
      .from(files)
      .where(and(eq(files.taskId, taskId), inArray(files.status, FILE_STATUS_FOR_SUMMARY)))
      .orderBy(desc(files.createdAt));
  }

  /** 列表随行文件摘要（免 N+1）：一次按 taskId 分组统计。 */
  async fileSummaries(taskIds: readonly string[], client: DbClient = this.database.db): Promise<Map<string, TaskFileSummaryCounts>> {
    const result = new Map<string, TaskFileSummaryCounts>();
    if (taskIds.length === 0) return result;
    const rows = await client
      .select({ taskId: files.taskId, status: files.status, value: count() })
      .from(files)
      .where(and(inArray(files.taskId, [...taskIds]), inArray(files.status, FILE_STATUS_FOR_SUMMARY)))
      .groupBy(files.taskId, files.status);
    for (const row of rows) {
      if (row.taskId === null) continue;
      const entry = result.get(row.taskId) ?? { total: 0, draft: 0, final: 0 };
      const value = Number(row.value);
      entry.total += value;
      if (row.status === "draft") entry.draft += value;
      if (row.status === "final" || row.status === "changed") entry.final += value;
      result.set(row.taskId, entry);
    }
    return result;
  }

  /** 项目读（软删过滤）：任务读写都要先过项目可见性 / 归档写保护。 */
  async findProject(projectId: string, client: DbClient = this.database.db): Promise<TaskProjectRow | null> {
    const rows = await client
      .select({ id: projects.id, managerId: projects.managerId, stageKey: projects.stageKey, status: projects.status })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 来源任务节点（校验属于本项目 + 取阶段）：taskCreateBody.taskNodeId 的落点。 */
  async findProjectNode(projectId: string, nodeId: string, client: DbClient = this.database.db): Promise<TaskProjectNodeRow | null> {
    const rows = await client
      .select({ id: projectNodes.id, stageKey: projectStages.stageKey, status: projectNodes.status })
      .from(projectNodes)
      .innerJoin(projectStages, eq(projectStages.id, projectNodes.stageId))
      .where(and(eq(projectNodes.projectId, projectId), eq(projectNodes.id, nodeId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 节点判重（A10 / A11）：同一节点在项目里只留一份任务。 */
  async findTaskIdByNode(projectId: string, nodeId: string, client: DbClient = this.database.db): Promise<string | null> {
    const rows = await client
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.nodeId, nodeId)))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async lockTask(client: DbClient, taskId: string): Promise<TaskRow | null> {
    const rows = await client.select().from(tasks).where(eq(tasks.id, taskId)).for("update");
    return rows[0] ?? null;
  }

  async insert(input: TaskInsertInput, at: Date, client: DbClient): Promise<TaskRow> {
    const rows = await client
      .insert(tasks)
      .values({
        projectId: input.projectId,
        stageKey: input.stageKey,
        nodeId: input.nodeId,
        title: input.title,
        titleEn: input.titleEn,
        ownerId: input.ownerId,
        status: "pending",
        progress: "0",
        plannedStart: input.plannedStart,
        plannedEnd: input.plannedEnd,
        estimatedDays: input.estimatedDays,
        headcount: input.headcount,
        priority: input.priority,
        deliverable: input.deliverable,
        note: input.note,
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error("tasks insert 未返回行");
    return row;
  }

  /** 乐观锁更新：version 不匹配返回 null（由 service 转 409）。 */
  async updateWithVersion(
    taskId: string,
    expectedVersion: number,
    patch: TaskUpdatePatch,
    at: Date,
    client: DbClient,
  ): Promise<TaskRow | null> {
    const rows = await client
      .update(tasks)
      .set({ ...patch, version: sql`${tasks.version} + 1`, updatedAt: at })
      .where(and(eq(tasks.id, taskId), eq(tasks.version, expectedVersion)))
      .returning();
    return rows[0] ?? null;
  }

  async insertEvents(client: DbClient, events: readonly TaskEventInput[], actorId: string, at: Date): Promise<void> {
    if (events.length === 0) return;
    await client.insert(taskEvents).values(
      events.map((event) => ({
        taskId: event.taskId,
        eventType: event.eventType,
        beforeValue: event.beforeValue,
        afterValue: event.afterValue,
        actorId,
        createdAt: at,
      })),
    );
  }

  /** 项目最近活动触点（ADR-022 ④：任务变更视为项目活动；系统调度类写入不调用本方法）。 */
  async touchProject(projectId: string, at: Date, client: DbClient): Promise<void> {
    await client.update(projects).set({ updatedAt: at }).where(eq(projects.id, projectId));
  }

  /** 项目总览四格（GET /projects/{id}/summary）：当前阶段在 projects.stage_key，三个计数按任务派生。 */
  async summaryCounts(
    projectId: string,
    today: string,
    client: DbClient = this.database.db,
  ): Promise<{ overdue: number; done: number; total: number }> {
    const rows = await client
      .select({
        total: count(),
        done: sql<number>`count(*) filter (where ${tasks.status} = ${"done"})`,
        overdue: sql<number>`count(*) filter (where ${tasks.status} <> ${"done"} and ${tasks.plannedEnd} < ${today})`,
      })
      .from(tasks)
      .where(eq(tasks.projectId, projectId));
    const row = rows[0];
    return { overdue: Number(row?.overdue ?? 0), done: Number(row?.done ?? 0), total: Number(row?.total ?? 0) };
  }

  /** 阶段任务计数（GateService 阶段门禁 / 完成度用；h4 起由 task 模块提供，node 不再直读 tasks 表）。 */
  async countStageTasks(client: DbClient, projectId: string, stageKey: string): Promise<{ total: number; done: number }> {
    const rows = await client
      .select({ status: tasks.status, value: count() })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.stageKey, stageKey)))
      .groupBy(tasks.status);
    let total = 0;
    let done = 0;
    for (const row of rows) {
      const value = Number(row.value);
      total += value;
      if (row.status === "done") done += value;
    }
    return { total, done };
  }

  /** 全项目按阶段的任务计数（GET /projects/{id}/stages 的 tasks 完成度）。 */
  async taskCountsByStage(
    client: DbClient,
    projectId: string,
  ): Promise<{ stageKey: string; status: string; value: number }[]> {
    const rows = await client
      .select({ stageKey: tasks.stageKey, status: tasks.status, value: count() })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .groupBy(tasks.stageKey, tasks.status);
    return rows.map((row) => ({ stageKey: row.stageKey, status: row.status, value: Number(row.value) }));
  }
}

function taskConditions(projectId: string, filter: TaskListFilter, today: string): SQL[] {
  const conditions: SQL[] = [eq(tasks.projectId, projectId)];
  if (filter.stageKey !== null) conditions.push(eq(tasks.stageKey, filter.stageKey));
  if (filter.ownerId !== null) conditions.push(eq(tasks.ownerId, filter.ownerId));
  if (filter.keyword !== null) {
    const pattern = "%" + filter.keyword + "%";
    conditions.push(or(ilike(tasks.title, pattern), ilike(tasks.titleEn, pattern)) as SQL);
  }
  if (filter.displayStatuses !== null) {
    const parts = filter.displayStatuses.map((status) => displayStatusCondition(status, today));
    conditions.push(or(...parts) as SQL);
  }
  return conditions;
}

/** 展示态筛选下推（与 task.rules 的读时派生同口径；overdue / early_done 由存储态 + 日期判定）。 */
function displayStatusCondition(status: string, today: string): SQL {
  switch (status) {
    case "pending":
      return and(eq(tasks.status, "pending"), or(isNull(tasks.plannedEnd), gte(tasks.plannedEnd, today))) as SQL;
    case "active":
      return and(eq(tasks.status, "active"), or(isNull(tasks.plannedEnd), gte(tasks.plannedEnd, today))) as SQL;
    case "done":
      return and(
        eq(tasks.status, "done"),
        or(isNull(tasks.actualEnd), isNull(tasks.plannedEnd), gte(tasks.actualEnd, tasks.plannedEnd)),
      ) as SQL;
    case "early_done":
      return and(eq(tasks.status, "done"), lt(tasks.actualEnd, tasks.plannedEnd)) as SQL;
    default:
      return and(ne(tasks.status, "done"), lt(tasks.plannedEnd, today)) as SQL;
  }
}

/** 排序：显式 sort 走白名单列；缺省 = 阶段序 + 组内 plannedStart ASC NULLS LAST, created_at ASC, id ASC（A8）。 */
function taskOrderBy(sorts: readonly TaskSort[]): SQL[] {
  if (sorts.length === 0) {
    return [sql`${STAGE_ORDER} asc`, asc(tasks.plannedStart), asc(tasks.createdAt), asc(tasks.id)];
  }
  return sorts.map((item) =>
    item.direction === "desc" ? desc(SORT_COLUMNS[item.field]) : asc(SORT_COLUMNS[item.field]),
  ) as SQL[];
}
