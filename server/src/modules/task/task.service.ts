import { Injectable } from "@nestjs/common";
import {
  DOC_TYPES,
  PRIORITY_VALUES,
  ProjectSummarySchema,
  TaskCreateBodySchema,
  TaskDetailSchema,
  TaskListItemSchema,
  TaskListResponseSchema,
  TaskProgressSchema,
  TaskProgressUpdateBodySchema,
  TaskSchema,
  TaskUpdateBodySchema,
  z,
} from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import type { DbClient } from "../../db/db-client.js";
import { DatabaseService } from "../../db/database.service.js";
import { appendOutbox } from "../../db/outbox.js";
import { AuditService, diffRecords } from "../admin/index.js";
import { RoleService } from "../identity/index.js";
import { clampSortIndex } from "./task.order.js";
import { parseTaskListFilter, parseTaskSort, type TaskListQueryInput } from "./task.query.js";
import {
  applyProgressWrite,
  applyStatusWrite,
  deriveDisplayStatus,
  deriveOnTime,
  shanghaiToday,
} from "./task.rules.js";
import {
  TaskRepository,
  type TaskEventInput,
  type TaskFileSummaryCounts,
  type TaskListRow,
  type TaskProjectRow,
  type TaskRow,
  type TaskUpdatePatch,
} from "./task.repository.js";

type Task = z.infer<typeof TaskSchema>;
type TaskDetail = z.infer<typeof TaskDetailSchema>;
type TaskListItem = z.infer<typeof TaskListItemSchema>;
type TaskListResponse = z.infer<typeof TaskListResponseSchema>;
type TaskCreateBody = z.infer<typeof TaskCreateBodySchema>;
type TaskUpdateBody = z.infer<typeof TaskUpdateBodySchema>;
type TaskProgressUpdateBody = z.infer<typeof TaskProgressUpdateBodySchema>;
type TaskProgress = z.infer<typeof TaskProgressSchema>;
type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

const EMPTY_FILE_SUMMARY: TaskFileSummaryCounts = { total: 0, draft: 0, final: 0 };
const CHANGE_SUMMARY_MAX = 40;

/**
 * 任务用例（h4 · S6·task：M3-01 列表 / 详情 + M3-02 进度与状态 + 项目总览四格）。
 * 五态派生与按时交付读时计算（A1-06 / A14），状态与进度写入在同一事务内联动（A12 / A13），字段级留痕写 task_events（A1-10）。
 * 权限（h6 前口径）：读登录即可；任务编辑 / 进度为成员平权；手工创建非标准任务仅管理员（系统功能书 A1-13）；
 * 归档项目写保护 409 PROJECT_ARCHIVED（ADR-027）；任务变更写项目触点（ADR-022 ④）。
 */
@Injectable()
export class TaskService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repository: TaskRepository,
    private readonly roles: RoleService,
    private readonly audit: AuditService,
  ) {}

  /** GET /projects/{id}/summary：项目总览四格（当前阶段 / 逾期 / 已完成 / 总数）。 */
  async summary(projectId: string): Promise<ProjectSummary> {
    const project = await this.loadProjectOrFail(projectId);
    const today = shanghaiToday(new Date());
    const counts = await this.repository.summaryCounts(projectId, today);
    return {
      projectId: project.id,
      currentStage: project.stageKey as ProjectSummary["currentStage"],
      overdue: counts.overdue,
      done: counts.done,
      total: counts.total,
    };
  }

  /** GET /projects/{id}/tasks：分页 + 阶段 / 负责人 / 展示态筛选 + 关键字 + 白名单排序；items 为 TaskListItem。 */
  async list(projectId: string, query: TaskListQueryInput): Promise<TaskListResponse> {
    await this.loadProjectOrFail(projectId);
    const filter = parseTaskListFilter(query);
    const sorts = parseTaskSort(query.sort);
    const today = shanghaiToday(new Date());
    const offset = (query.page - 1) * query.limit;
    const { items, total } = await this.repository.listPage(projectId, filter, sorts, query.limit, offset, today);
    const summaries = await this.repository.fileSummaries(items.map((row) => row.task.id));
    return {
      items: items.map((row) => toListItem(row, summaries.get(row.task.id) ?? EMPTY_FILE_SUMMARY, today)),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  /** GET /projects/{id}/tasks/{taskId}：抽屉全字段 + 文件清单（A7：列表不再补第二次请求）。 */
  async detail(projectId: string, taskId: string): Promise<TaskDetail> {
    await this.loadProjectOrFail(projectId);
    const row = await this.repository.findListRowById(taskId, projectId);
    if (row === null) throw new AppError("NOT_FOUND", "任务不存在或不属于该项目");
    const files = await this.repository.listFiles(taskId);
    const today = shanghaiToday(new Date());
    return {
      ...toTaskView(row.task, today),
      ownerNames: row.ownerNames ?? [],
      changeSummary: shortenChangeSummary(row.changeSummary),
      files: files.map((file) => ({
        id: file.id,
        name: file.name,
        status: file.status as TaskDetail["files"][number]["status"],
        docType: normalizeDocType(file.docType),
      })),
    };
  }

  /**
   * POST /projects/{id}/tasks：从任务节点生成（成员）或手工创建（仅管理员，A1-13）；按节点判重 409。
   * w2 · Push 124 / A23 · Push 136：stageKey 可选（缺省 / null = 「未分组」；带节点时缺省取节点阶段）、ownerIds 显式 [] = 「待分配」、
   * sortIndex = 插入位次（越界 / 缺省 = 组尾），组内其余任务位次顺延。
   */
  async create(projectId: string, body: TaskCreateBody, actorId: string): Promise<Task> {
    const project = await this.loadProjectForWrite(projectId);
    const nodeId = body.taskNodeId ?? null;
    let stageKey: string | null = body.stageKey ?? null;
    if (nodeId !== null) {
      const node = await this.repository.findProjectNode(projectId, nodeId);
      if (node === null || node.status === "deleted") {
        throw new AppError("VALIDATION_FAILED", "taskNodeId 不属于该项目或节点已删除");
      }
      if (stageKey !== null && node.stageKey !== stageKey) {
        throw new AppError("VALIDATION_FAILED", "stageKey 与来源节点所属阶段不一致（节点阶段：" + node.stageKey + "）");
      }
      stageKey = node.stageKey;
    } else {
      await this.assertAdmin(actorId, "手工创建非标准任务");
    }
    const ownerIds = body.ownerIds !== undefined ? body.ownerIds : project.managerIds;
    const at = new Date();
    const row = await this.database.db.transaction(async (tx) => {
      if (nodeId !== null) {
        const existing = await this.repository.findTaskIdByNode(projectId, nodeId, tx);
        if (existing !== null) {
          throw new AppError("TASK_ALREADY_EXISTS", "该项目已存在该节点生成的任务：" + existing);
        }
      }
      const groupSize = await this.repository.countGroup(projectId, stageKey, tx);
      const sortIndex = clampSortIndex(body.sortIndex ?? groupSize, groupSize);
      if (sortIndex < groupSize) {
        await this.repository.shiftGroupIndexes(projectId, stageKey, sortIndex, null, 1, tx);
      }
      const created = await this.repository.insert(
        {
          projectId,
          stageKey,
          nodeId,
          title: body.title,
          titleEn: body.titleEn ?? null,
          ownerIds,
          sortIndex,
          plannedStart: body.plannedStart ?? null,
          plannedEnd: body.plannedEnd ?? null,
          estimatedDays: body.estimatedDays ?? null,
          headcount: body.headcount ?? null,
          priority: body.priority ?? null,
          deliverable: body.deliverable ?? null,
          note: body.note ?? null,
        },
        at,
        tx,
      );
      await appendOutbox(tx, {
        topic: "task.created",
        dedupeKey: "task.created:" + created.id,
        payload: {
          projectId,
          taskId: created.id,
          stageKey,
          nodeId,
          status: created.status,
          progress: Number(created.progress),
          actorId,
          at: at.toISOString(),
        },
      });
      await this.repository.touchProject(projectId, at, tx);
      await this.audit.record(tx, {
        actorId,
        action: "create",
        objectType: "task",
        objectId: created.id,
        projectId,
        summary: "创建任务：" + created.title,
        changes: [
          { field: "stageKey", from: null, to: created.stageKey },
          { field: "title", from: null, to: created.title },
          { field: "ownerIds", from: null, to: created.ownerIds },
          { field: "plannedEnd", from: null, to: created.plannedEnd },
        ].filter((change) => change.to !== null),
      });
      return created;
    });
    return toTaskView(row, shanghaiToday(at));
  }

  /**
   * PATCH /projects/{id}/tasks/{taskId}：字段编辑 +（可选）基础三态写入联动（A12）+ 组内重排（A19 / A20，Push 124）；
   * 乐观锁 + 字段留痕。ownerIds 显式 [] = 「待分配」；sortIndex = 移到该组第 N 位（越界 = 组尾）。
   */
  async update(projectId: string, taskId: string, body: TaskUpdateBody, actorId: string): Promise<Task> {
    await this.loadProjectForWrite(projectId);
    const at = new Date();
    const today = shanghaiToday(at);
    const row = await this.database.db.transaction(async (tx) => {
      if (body.sortIndex !== undefined) {
        const brief = await this.repository.findTaskBrief(taskId, tx);
        if (brief === null || brief.projectId !== projectId) {
          throw new AppError("NOT_FOUND", "任务不存在或不属于该项目");
        }
        await this.repository.listGroupOrder(projectId, brief.stageKey, tx, true);
      }
      const before = await this.repository.lockTask(tx, taskId);
      if (before === null || before.projectId !== projectId) {
        throw new AppError("NOT_FOUND", "任务不存在或不属于该项目");
      }
      if (before.version !== body.version) {
        throw new AppError("VERSION_CONFLICT", "任务已被他人更新，请刷新后重试");
      }
      const sortIndex =
        body.sortIndex === undefined ? before.sortIndex : await this.moveWithinGroup(tx, projectId, before, body.sortIndex);
      const current = { status: before.status, progress: Number(before.progress), actualEnd: before.actualEnd };
      const linked = body.status === undefined ? null : applyStatusWrite(current, body.status, today);
      const patch: TaskUpdatePatch = {
        ownerIds: body.ownerIds !== undefined ? body.ownerIds : before.ownerIds,
        status: linked === null ? before.status : linked.status,
        progress: String(linked === null ? current.progress : linked.progress),
        sortIndex,
        plannedStart: body.plannedStart !== undefined ? body.plannedStart : before.plannedStart,
        plannedEnd: body.plannedEnd !== undefined ? body.plannedEnd : before.plannedEnd,
        actualEnd: linked === null ? before.actualEnd : linked.actualEnd,
        estimatedDays: body.estimatedDays !== undefined ? body.estimatedDays : before.estimatedDays,
        headcount: body.headcount !== undefined ? body.headcount : before.headcount,
        priority: body.priority !== undefined ? body.priority : before.priority,
        note: body.note !== undefined ? body.note : before.note,
      };
      const updated = await this.repository.updateWithVersion(taskId, body.version, patch, at, tx);
      if (updated === null) {
        throw new AppError("VERSION_CONFLICT", "任务已被他人更新，请刷新后重试");
      }
      await this.repository.insertEvents(tx, buildEvents(before, patch), actorId, at);
      await appendOutbox(tx, {
        topic: "task.updated",
        dedupeKey: "task.updated:" + taskId + ":" + updated.version,
        payload: {
          projectId,
          taskId,
          status: updated.status,
          progress: Number(updated.progress),
          plannedEnd: updated.plannedEnd,
          actualEnd: updated.actualEnd,
          actorId,
          at: at.toISOString(),
        },
      });
      await this.repository.touchProject(projectId, at, tx);
      const changes = diffRecords(taskAuditSnapshot(before), taskAuditSnapshot(updated));
      await this.audit.record(tx, {
        actorId,
        action: "update",
        objectType: "task",
        objectId: taskId,
        projectId,
        summary: "修改任务：" + updated.title,
        changes: changes.length > 0 ? changes : null,
      });
      return updated;
    });
    return toTaskView(row, today);
  }

  /** PATCH /projects/{id}/tasks/{taskId}/progress：四格进度 + 完成日期（A12 / A13）；响应为 TaskListItem 同形。 */
  async updateProgress(
    projectId: string,
    taskId: string,
    body: TaskProgressUpdateBody,
    actorId: string,
  ): Promise<TaskListItem> {
    await this.loadProjectForWrite(projectId);
    const at = new Date();
    const today = shanghaiToday(at);
    const row = await this.database.db.transaction(async (tx) => {
      const before = await this.repository.lockTask(tx, taskId);
      if (before === null || before.projectId !== projectId) {
        throw new AppError("NOT_FOUND", "任务不存在或不属于该项目");
      }
      if (before.version !== body.version) {
        throw new AppError("VERSION_CONFLICT", "任务已被他人更新，请刷新后重试");
      }
      const linked = applyProgressWrite(body.progress, body.actualEnd ?? null, today);
      const patch: TaskUpdatePatch = {
        status: linked.status,
        progress: String(linked.progress),
        actualEnd: linked.actualEnd,
        note: body.note !== undefined ? body.note : before.note,
      };
      const updated = await this.repository.updateWithVersion(taskId, body.version, patch, at, tx);
      if (updated === null) {
        throw new AppError("VERSION_CONFLICT", "任务已被他人更新，请刷新后重试");
      }
      await this.repository.insertEvents(tx, buildEvents(before, patch), actorId, at);
      await appendOutbox(tx, {
        topic: "task.progress_changed",
        dedupeKey: "task.progress_changed:" + taskId + ":" + updated.version,
        payload: {
          projectId,
          taskId,
          status: updated.status,
          progress: Number(updated.progress),
          actualEnd: updated.actualEnd,
          actorId,
          at: at.toISOString(),
        },
      });
      await this.repository.touchProject(projectId, at, tx);
      const changes = diffRecords(taskAuditSnapshot(before), taskAuditSnapshot(updated));
      await this.audit.record(tx, {
        actorId,
        action: "progress",
        objectType: "task",
        objectId: taskId,
        projectId,
        summary: "更新任务进度：" + updated.title + "（进度 " + Number(updated.progress) + "）",
        changes: changes.length > 0 ? changes : null,
      });
      return updated;
    });
    const listRow = await this.repository.findListRowById(row.id, projectId);
    if (listRow === null) throw new AppError("NOT_FOUND", "任务不存在或不属于该项目");
    const summaries = await this.repository.fileSummaries([row.id]);
    return toListItem(listRow, summaries.get(row.id) ?? EMPTY_FILE_SUMMARY, today);
  }

  /**
   * 组内重排（A19 / A20 · Push 124）：把任务移到该组第 N 位（越界 = 组尾），返回落定位次。
   * 调用方必须已锁住该组（listGroupOrder lock=true）—— 只平移其余任务的位次，不逐个改版本 / updated_at。
   */
  private async moveWithinGroup(tx: DbClient, projectId: string, task: TaskRow, requested: number): Promise<number> {
    const rows = await this.repository.listGroupOrder(projectId, task.stageKey, tx);
    const currentIndex = rows.findIndex((row) => row.id === task.id);
    const from = currentIndex >= 0 ? currentIndex : Number(task.sortIndex);
    const target = clampSortIndex(requested, rows.length - 1);
    if (target !== from) {
      if (target < from) {
        await this.repository.shiftGroupIndexes(projectId, task.stageKey, target, from - 1, 1, tx);
      } else {
        await this.repository.shiftGroupIndexes(projectId, task.stageKey, from + 1, target, -1, tx);
      }
    }
    return target;
  }

  /** 项目可见性：软删 / 不存在统一 404（记录级 404 语义随 h6 策略服务）。 */
  private async loadProjectOrFail(projectId: string): Promise<TaskProjectRow> {
    const project = await this.repository.findProject(projectId);
    if (project === null) throw new AppError("NOT_FOUND", "项目不存在或不可见");
    return project;
  }

  /** 任务写入口：归档项目一律 409 PROJECT_ARCHIVED（ADR-027）。 */
  private async loadProjectForWrite(projectId: string): Promise<TaskProjectRow> {
    const project = await this.loadProjectOrFail(projectId);
    if (project.status === "archived") {
      throw new AppError("PROJECT_ARCHIVED", "项目已归档，禁止修改任务");
    }
    return project;
  }

  /** 手工创建非标准任务仅管理员（系统功能书 A1-13）。 */
  private async assertAdmin(actorId: string, action: string): Promise<void> {
    const authorization = await this.roles.getActorAuthorization(actorId);
    if (!authorization.roleCodes.includes("admin")) {
      throw new AppError("FORBIDDEN", "仅管理员可" + action + "（系统功能书 A1-13）");
    }
  }
}

/** 任务字段级留痕快照（C7-02：负责人（多位）/ 状态 / 进度 / 组内位次 / 计划与实际日期 / 工期 / 人数 / 重要度 / 备注）。 */
function taskAuditSnapshot(row: {
  ownerIds: string[];
  status: string;
  progress: string | number;
  sortIndex: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualEnd: string | null;
  estimatedDays: number | null;
  headcount: number | null;
  priority: string | null;
  note: string | null;
}): Record<string, unknown> {
  return {
    ownerIds: row.ownerIds,
    status: row.status,
    progress: Number(row.progress),
    sortIndex: row.sortIndex,
    plannedStart: row.plannedStart,
    plannedEnd: row.plannedEnd,
    actualEnd: row.actualEnd,
    estimatedDays: row.estimatedDays,
    headcount: row.headcount,
    priority: row.priority,
    note: row.note,
  };
}

/** 行 → 契约视图：displayStatus / onTime 读时派生（A12 / A14），不写回存储。 */
function toTaskView(row: TaskRow, today: string): Task {
  const input = {
    status: row.status,
    plannedEnd: row.plannedEnd,
    actualEnd: row.actualEnd,
    storedOnTime: row.onTime,
    today,
  };
  return {
    id: row.id,
    projectId: row.projectId,
    stageKey: row.stageKey as Task["stageKey"],
    sortIndex: row.sortIndex,
    nodeId: row.nodeId,
    title: row.title,
    titleEn: row.titleEn,
    ownerIds: row.ownerIds,
    status: row.status as Task["status"],
    displayStatus: deriveDisplayStatus(input),
    progress: normalizeProgress(Number(row.progress)),
    plannedStart: row.plannedStart,
    plannedEnd: row.plannedEnd,
    actualEnd: row.actualEnd,
    estimatedDays: row.estimatedDays,
    headcount: row.headcount,
    priority: normalizePriority(row.priority),
    deliverable: normalizeDocType(row.deliverable),
    note: row.note,
    onTime: deriveOnTime(input),
    changeRef: row.changeRef,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 列表项：TaskListItem（omit changeRef + ownerNames / changeSummary / fileSummary）。 */
function toListItem(row: TaskListRow, fileSummary: TaskFileSummaryCounts, today: string): TaskListItem {
  const view = toTaskView(row.task, today);
  return {
    id: view.id,
    projectId: view.projectId,
    stageKey: view.stageKey,
    sortIndex: view.sortIndex,
    nodeId: view.nodeId,
    title: view.title,
    titleEn: view.titleEn,
    ownerIds: view.ownerIds,
    status: view.status,
    displayStatus: view.displayStatus,
    progress: view.progress,
    plannedStart: view.plannedStart,
    plannedEnd: view.plannedEnd,
    actualEnd: view.actualEnd,
    estimatedDays: view.estimatedDays,
    headcount: view.headcount,
    priority: view.priority,
    deliverable: view.deliverable,
    note: view.note,
    onTime: view.onTime,
    version: view.version,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    ownerNames: row.ownerNames ?? [],
    changeSummary: shortenChangeSummary(row.changeSummary),
    fileSummary,
  };
}

/** 字段级留痕（A1-10）：状态 / 进度 / 日期 / 备注四类；before / after 为 JSON（键 = 字段名）。 */
function buildEvents(before: TaskRow, after: TaskUpdatePatch): TaskEventInput[] {
  const events: TaskEventInput[] = [];
  if (after.status !== undefined && after.status !== before.status) {
    events.push({
      taskId: before.id,
      eventType: "status_change",
      beforeValue: JSON.stringify({ status: before.status }),
      afterValue: JSON.stringify({ status: after.status }),
    });
  }
  if (after.progress !== undefined && Number(after.progress) !== Number(before.progress)) {
    events.push({
      taskId: before.id,
      eventType: "progress_change",
      beforeValue: JSON.stringify({ progress: Number(before.progress) }),
      afterValue: JSON.stringify({ progress: Number(after.progress) }),
    });
  }
  const dateBefore: Record<string, string | null> = {};
  const dateAfter: Record<string, string | null> = {};
  if (after.plannedStart !== undefined && after.plannedStart !== before.plannedStart) {
    dateBefore.plannedStart = before.plannedStart;
    dateAfter.plannedStart = after.plannedStart;
  }
  if (after.plannedEnd !== undefined && after.plannedEnd !== before.plannedEnd) {
    dateBefore.plannedEnd = before.plannedEnd;
    dateAfter.plannedEnd = after.plannedEnd;
  }
  if (after.actualEnd !== undefined && after.actualEnd !== before.actualEnd) {
    dateBefore.actualEnd = before.actualEnd;
    dateAfter.actualEnd = after.actualEnd;
  }
  if (Object.keys(dateAfter).length > 0) {
    events.push({
      taskId: before.id,
      eventType: "date_change",
      beforeValue: JSON.stringify(dateBefore),
      afterValue: JSON.stringify(dateAfter),
    });
  }
  if (after.note !== undefined && after.note !== before.note) {
    events.push({
      taskId: before.id,
      eventType: "note_change",
      beforeValue: JSON.stringify({ note: before.note }),
      afterValue: JSON.stringify({ note: after.note }),
    });
  }
  return events;
}

/** 变更摘要（列表用短文本）：取变更原因截断；详情用 changeRef 跳变更记录。 */
function shortenChangeSummary(value: string | null): string | null {
  if (value === null) return null;
  const text = value.trim();
  if (text === "") return null;
  return text.length > CHANGE_SUMMARY_MAX ? text.slice(0, CHANGE_SUMMARY_MAX) + "…" : text;
}

/** 进度归一化到离散五档（迁移 / 演示数据的任意小数先四舍五入到最近档，契约注释口径）。 */
function normalizeProgress(value: number): TaskProgress {
  const rounded = Math.round(value * 4) / 4;
  if (rounded === 0 || rounded === 0.25 || rounded === 0.5 || rounded === 0.75 || rounded === 1) {
    return rounded;
  }
  return 0;
}

function normalizePriority(value: string | null): Task["priority"] {
  if (value === null) return null;
  return (PRIORITY_VALUES as readonly string[]).includes(value) ? (value as Task["priority"]) : null;
}

function normalizeDocType(value: string | null): Task["deliverable"] {
  if (value === null) return null;
  return (DOC_TYPES as readonly string[]).includes(value) ? (value as Task["deliverable"]) : null;
}
