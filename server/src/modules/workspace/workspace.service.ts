import { Injectable } from "@nestjs/common";
import { PRIORITY_VALUES, WORKSPACE_UPCOMING_DAYS } from "@libiaolink/contracts";
import type { WorkspaceIssueItem, WorkspaceResponse, WorkspaceTaskItem } from "@libiaolink/contracts";
import { PermissionService } from "../permission/index.js";
import { deriveDisplayStatus, shanghaiToday, type TaskDerivationInput } from "../task/index.js";
import { WorkspaceRepository, type WorkspaceIssueRow, type WorkspaceTaskRow } from "./workspace.repository.js";
import { addDays, emptyTaskGroups, taskGroupOf } from "./workspace.rules.js";

/**
 * 工作台用例（M6-05 第一刀 · A6-01 / A6-03）：
 * 一次读出口返回「我的任务三组 + 我的问题两栏」；分组口径见 workspace.rules（基准日 = Asia/Shanghai 今天，ADR-028）。
 * 记录级可见性：PermissionService.projectScope（管理员 = 全量；其余 = 可见项目 id 集合，空集短路）。
 */
@Injectable()
export class WorkspaceService {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly permission: PermissionService,
  ) {}

  /** GET /api/v1/workspace（按会话用户；无项目路径参数 —— 跨项目个人读面）。 */
  async get(actorId: string): Promise<WorkspaceResponse> {
    const today = shanghaiToday(new Date());
    const scope = await this.permission.projectScope(actorId);
    const until = addDays(today, WORKSPACE_UPCOMING_DAYS);
    const [taskRows, issueRows] = await Promise.all([
      this.repository.listMyTasks(actorId, scope, until),
      this.repository.listMyIssues(actorId, scope),
    ]);
    const myTasks = emptyTaskGroups<WorkspaceTaskItem>();
    for (const row of taskRows) {
      const group = taskGroupOf(row.plannedEnd, today);
      if (group !== null) myTasks[group].push(toTaskItem(row, today));
    }
    return {
      today,
      myTasks,
      myIssues: {
        handling: issueRows.filter((row) => row.ownerId === actorId).map(toIssueItem),
        raised: issueRows.filter((row) => row.reporterId === actorId).map(toIssueItem),
      },
    };
  }
}

/** 行 → 契约视图：displayStatus 读时派生（A1-06，含显式覆盖 · Push 179）；进度 / 优先级归一化与任务列表同口径。 */
function toTaskItem(row: WorkspaceTaskRow, today: string): WorkspaceTaskItem {
  const input: TaskDerivationInput = {
    status: row.status,
    statusOverride: row.statusOverride,
    plannedEnd: row.plannedEnd,
    actualEnd: row.actualEnd,
    storedOnTime: row.onTime,
    today,
  };
  return {
    id: row.id,
    projectId: row.projectId,
    projectCode: row.projectCode,
    projectName: row.projectName,
    stageKey: row.stageKey as WorkspaceTaskItem["stageKey"],
    title: row.title,
    titleEn: row.titleEn,
    displayStatus: deriveDisplayStatus(input),
    progress: normalizeProgress(Number(row.progress)),
    plannedStart: row.plannedStart,
    plannedEnd: row.plannedEnd,
    actualEnd: row.actualEnd,
    ownerIds: row.ownerIds,
    ownerNames: row.ownerNames ?? [],
    priority: normalizePriority(row.priority),
  };
}

/** 行 → 契约视图（枚举收窄沿用读面统一口径：库侧受 CHECK 约束，越界值理论不出现）。 */
function toIssueItem(row: WorkspaceIssueRow): WorkspaceIssueItem {
  return {
    id: row.id,
    projectId: row.projectId,
    projectCode: row.projectCode,
    projectName: row.projectName,
    taskId: row.taskId,
    title: row.title,
    categories: row.categories as WorkspaceIssueItem["categories"],
    state: row.state as WorkspaceIssueItem["state"],
    reporterId: row.reporterId,
    reporterName: row.reporterName,
    ownerDepartment: row.ownerDepartment,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    raisedAt: row.raisedAt,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

/** 进度归一化到离散五档（与 task.service 同口径：任意小数四舍五入到最近档，非法回落 0）。 */
function normalizeProgress(value: number): WorkspaceTaskItem["progress"] {
  const rounded = Math.round(value * 4) / 4;
  if (rounded === 0 || rounded === 0.25 || rounded === 0.5 || rounded === 0.75 || rounded === 1) return rounded;
  return 0;
}

/** 紧急重要度归一化（与 task.service 同口径：非三档取值回落 null）。 */
function normalizePriority(value: string | null): WorkspaceTaskItem["priority"] {
  if (value === null) return null;
  return (PRIORITY_VALUES as readonly string[]).includes(value) ? (value as WorkspaceTaskItem["priority"]) : null;
}
