/**
 * 任务接口封装（M3-07 任务域接线 · Push 162）：
 * - 列表 GET /api/v1/projects/{id}/tasks（15 列表格；TaskListItem 随行 ownerNames / fileSummary，不逐行反查）
 * - 详情 GET /api/v1/projects/{id}/tasks/{taskId}（抽屉全字段 + 文件清单，打开抽屉时按需请求）
 * - 编辑 PATCH /api/v1/projects/{id}/tasks/{taskId}（乐观锁 version；status 只收基础三态，进度 / 完成日期同事务联动）
 * - 进度 PATCH /api/v1/projects/{id}/tasks/{taskId}/progress（四格五档；写回 < 1 是清完成日期的唯一方式）
 * - 删除 DELETE /api/v1/projects/{id}/tasks/{taskId}（软删；重复删除 / 已删任务的写 = 404）
 * - 创建 POST /api/v1/projects/{id}/tasks（M3-07 · Push 163：从项目节点生成或手工临时任务）
 * - 汇总 GET /api/v1/projects/{id}/summary（M3-07 · Push 163：项目总览四格）
 * - 项目节点 GET /api/v1/projects/{id}/flow（M3-07 · Push 163：任务节点库 / 模板接口未落地，节点池取项目节点）
 * 契约 shared/src/modules/tasks.ts；UI 模型见 data/tasks.ts（ProjectTask）。
 */
import { apiRequest, apiSend } from "./api";
import { cnDateFromIso, type ProjectTask, type TaskPriority, type TaskStatus } from "./data/tasks";

/** 契约阶段字典（STAGE_KEYS ↔ 中文名）：只读展示用 —— 写面不含阶段（TaskUpdateBody 无 stageKey）。 */
export const STAGE_LABELS: Record<string, string> = {
  presale: "售前规划",
  design: "设计开发",
  purchase: "加工采购",
  assembly: "组装发货",
  install: "硬件实施",
  deploy: "软件部署",
  trial: "试运行",
  production: "生产阶段",
  acceptance: "验收",
};

/** 服务端展示五态（TaskDisplayStatus）→ 表格 / 抽屉的中文标签。 */
const DISPLAY_STATUS_LABELS: Record<string, TaskStatus> = {
  pending: "待开始",
  active: "进行中",
  done: "已完成",
  overdue: "已延期",
  early_done: "提前完成",
};

/**
 * 中文状态 → 契约基础三态（写面只收 pending / active / done）。
 * - 「提前完成」= done（服务端按实际 / 预计完成日期派生回「提前完成」）；
 * - 「已延期」不可写（派生优先：服务端按预计完成日期派生）→ null = 前端不提交这一档，页面提示后保持原状。
 */
export function baseStatusOf(status: TaskStatus): "pending" | "active" | "done" | null {
  if (status === "待开始") {
    return "pending";
  }
  if (status === "进行中") {
    return "active";
  }
  if (status === "已完成" || status === "提前完成") {
    return "done";
  }
  return null;
}

/**
 * 紧急重要度三档（Push 163）：**页面口径为准**（高 / 中 / 低），契约 `PRIORITY_VALUES` 与库值同步收敛 ——
 * 不再做「契约四象限 → 页面三档」的折算：页面值与契约值一一对应。
 */
export const PRIORITY_VALUES: readonly TaskPriority[] = ["高", "中", "低"];

/** 变更关联项（契约 TaskChangeLink）：列表 / 详情同形。 */
export type ApiTaskChangeLink = { id: string; reason: string | null; appliedAt: string };

/** 任务随行文件摘要（契约 TaskFileSummary）：列表不带文件名，只给三个计数。 */
export type ApiTaskFileSummary = { total: number; draft: number; final: number };

/** 任务文件摘要项（契约 TaskFileBrief）：详情接口给。 */
export type ApiTaskFileBrief = { id: string; name: string; status: string; docType: string | null };

/** 任务（契约 Task；列表 / 详情在它之上各加随行字段）。 */
export type ApiTask = {
  id: string;
  projectId: string;
  stageKey: string | null;
  sortIndex: number;
  nodeId: string | null;
  title: string;
  titleEn: string | null;
  ownerIds: string[];
  status: string;
  displayStatus: string;
  progress: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualEnd: string | null;
  estimatedDays: number | null;
  headcount: number | null;
  priority: string | null;
  deliverableTypes: string[];
  note: string | null;
  onTime: boolean | null;
  changeLinks: ApiTaskChangeLink[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiTaskListItem = ApiTask & { ownerNames: Array<string | null>; fileSummary: ApiTaskFileSummary };
export type ApiTaskDetail = ApiTask & { ownerNames: Array<string | null>; files: ApiTaskFileBrief[] };
export type ApiTaskListResponse = { items: ApiTaskListItem[]; page: number; limit: number; total: number };

/** 列表一次取满（契约 limit 上限 200）；总数用响应 total，超出时页面另提示。 */
export const TASK_PAGE_LIMIT = 200;

/**
 * 中文阶段名 → 契约阶段码（STAGE_LABELS 的反查）：创建任务时带 stageKey（服务端按来源节点再校验一致）。
 * 展示层一律用中文名（STAGE_LABELS），写面一律用阶段码 —— 两边同源，避免第三份映射。
 */
export function stageKeyOfLabel(stage: string): string | null {
  const hit = Object.entries(STAGE_LABELS).find(([, label]) => label === stage);
  return hit === undefined ? null : hit[0];
}

/**
 * 项目总览四格（契约 ProjectSummary；M3-07 · Push 163 接线）：当前阶段 = 项目 flow 的当前阶段（stageKey），
 * 整体进度 / 已完成数 = 任务派生（done / total）。overdue 服务端照常下发，汇总卡一期不展示（见前端功能需求 §3.4）。
 */
export type ApiProjectSummary = { projectId: string; currentStage: string; overdue: number; done: number; total: number };

export function fetchProjectSummary(projectId: string): Promise<ApiProjectSummary> {
  return apiRequest<ApiProjectSummary>("/api/v1/projects/" + encodeURIComponent(projectId) + "/summary");
}

/**
 * 项目流程节点（GET /projects/{id}/flow 里展平）：「添加任务」卡片的节点池数据源 ——
 * 节点 = 项目导入蓝图时实例化的流程节点，任务由它生成（TaskCreateBody.taskNodeId，判重按节点）。
 * 任务节点库 / 任务模板接口（A11：GET /task-nodes、GET /task-templates）后端尚未落地，本接口是当前唯一真节点来源。
 */
export type ApiProjectNode = { id: string; stageKey: string; name: string; seq: number; status: string };

/** 契约 ProjectNode 里本项目用到的部分：**节点上没有 stageKey**（只有 stageId）—— 阶段码挂在父级 stage 上。 */
type ApiProjectFlowNode = { id: string; name: string; seq: number; status: string };

type ApiProjectFlow = { stages: { stageKey: string; nodes: ApiProjectFlowNode[] }[] };

export async function fetchProjectNodes(projectId: string): Promise<ApiProjectNode[]> {
  const flow = await apiRequest<ApiProjectFlow>("/api/v1/projects/" + encodeURIComponent(projectId) + "/flow");
  const items: ApiProjectNode[] = [];
  for (const stage of flow.stages) {
    // 分组键取父级 stage.stageKey：节点只带 stageId，直接读 node.stageKey 会全是 undefined（Push 163 联调踩过）。
    for (const node of stage.nodes) {
      items.push({ id: node.id, stageKey: stage.stageKey, name: node.name, seq: node.seq, status: node.status });
    }
  }
  return items.sort((left, right) => left.seq - right.seq);
}

/** 创建任务（契约 TaskCreateBody · M3-07 · Push 163）：从项目节点生成（带 taskNodeId，判重 409 TASK_ALREADY_EXISTS）或手工创建。 */
export type TaskCreateBody = {
  stageKey?: string | null;
  sortIndex?: number;
  title: string;
  titleEn?: string | null;
  taskNodeId?: string;
  ownerIds?: string[];
  plannedStart?: string | null;
  plannedEnd?: string | null;
  estimatedDays?: number | null;
  headcount?: number | null;
  priority?: string | null;
  deliverableTypes?: string[];
  note?: string | null;
};

export function createTask(projectId: string, body: TaskCreateBody): Promise<ApiTask> {
  return apiSend<ApiTask>(taskPath(projectId), "POST", body);
}


function taskPath(projectId: string, taskId?: string): string {
  const base = "/api/v1/projects/" + encodeURIComponent(projectId) + "/tasks";
  return taskId === undefined ? base : base + "/" + encodeURIComponent(taskId);
}

/** 任务列表（15 列表格的数据源）。 */
export async function fetchProjectTasks(projectId: string): Promise<ApiTaskListItem[]> {
  const payload = await apiRequest<ApiTaskListResponse>(taskPath(projectId) + "?page=1&limit=" + String(TASK_PAGE_LIMIT));
  return payload.items;
}

/** 任务详情（抽屉打开时按需请求：全字段 + 文件清单）。 */
export function fetchTaskDetail(projectId: string, taskId: string): Promise<ApiTaskDetail> {
  return apiRequest<ApiTaskDetail>(taskPath(projectId, taskId));
}

/** 编辑任务（TaskUpdateBody）：只传要改的字段；version 必传（乐观锁，冲突 409 VERSION_CONFLICT）。 */
export type TaskUpdateBody = {
  ownerIds?: string[];
  sortIndex?: number;
  status?: "pending" | "active" | "done";
  plannedStart?: string | null;
  plannedEnd?: string | null;
  estimatedDays?: number | null;
  headcount?: number | null;
  priority?: string | null;
  note?: string | null;
  version: number;
};

export function updateTask(projectId: string, taskId: string, body: TaskUpdateBody): Promise<ApiTask> {
  return apiSend<ApiTask>(taskPath(projectId, taskId), "PATCH", body);
}

/** 进度更新（TaskProgressUpdateBody）：progress 只收五档；actualEnd 仅在 progress = 1 时生效。 */
export type TaskProgressBody = { progress: number; actualEnd?: string; note?: string; version: number };

export function updateTaskProgress(projectId: string, taskId: string, body: TaskProgressBody): Promise<ApiTaskListItem> {
  return apiSend<ApiTaskListItem>(taskPath(projectId, taskId) + "/progress", "PATCH", body);
}

/** 删除任务（软删）：成功回 { id, deleted: true }；前端本地移除后重新取数。 */
export function deleteTask(projectId: string, taskId: string): Promise<{ id: string; deleted: boolean }> {
  return apiSend<{ id: string; deleted: boolean }>(taskPath(projectId, taskId), "DELETE");
}

/** 负责人 id → 工号（目录随行取；取不到回落空串 —— 页面只展示姓名）。 */
export type TaskOwnerLookup = (id: string) => string;

/**
 * 契约任务 → 页面模型（ProjectTask）：
 * - `version` 有值 = 真任务（写面走本模块 API）；原型内存任务（节点 / 临时任务）没有 version，写面保持本地；
 * - 展示口径以服务端为准：状态用 displayStatus、逾期标注用 onTime + displayStatus（Push 70 定案，前端不再优先本地派生）；
 * - 日期按「M月D日」展示，同时保留服务端 ISO（dateIso）—— 写回时用它兜年份（跨年任务不被换算成 2026）。
 */
export function toUiTask(item: ApiTaskListItem | ApiTaskDetail, usernameOf?: TaskOwnerLookup): ProjectTask {
  const detail = item as ApiTaskDetail;
  const files = Array.isArray(detail.files) ? detail.files.map((file) => file.name) : [];
  const lateLabel = item.status === "done" ? (item.onTime === false ? "逾期已交付" : null) : item.displayStatus === "overdue" ? "逾期未交付" : null;
  return {
    id: item.id,
    stage: item.stageKey === null ? "" : STAGE_LABELS[item.stageKey] ?? item.stageKey,
    stageKey: item.stageKey,
    nodeId: item.nodeId,
    title: item.title,
    titleEn: item.titleEn ?? "",
    ownerIds: item.ownerIds,
    owners: item.ownerNames.map((name) => (name === null || name === "" ? "—" : name)),
    ownersEn: item.ownerIds.map((id) => (usernameOf === undefined ? "" : usernameOf(id))),
    status: item.status === "done" ? "已完成" : item.status === "active" ? "进行中" : "待开始",
    displayStatusLabel: DISPLAY_STATUS_LABELS[item.displayStatus] ?? "待开始",
    lateLabel,
    progress: item.progress,
    startDate: cnDateFromIso(item.plannedStart ?? ""),
    dueDate: cnDateFromIso(item.plannedEnd ?? ""),
    doneDate: cnDateFromIso(item.actualEnd ?? ""),
    days: item.estimatedDays ?? 0,
    deliverable: item.deliverableTypes.join("、"),
    deliverableTypes: item.deliverableTypes,
    changes: item.changeLinks.map((link) => ({ id: link.id, reason: link.reason ?? "", appliedAt: link.appliedAt.slice(0, 10) })),
    onTime: item.onTime === true ? "按时交付" : "",
    onTimeFlag: item.onTime,
    note: item.note ?? "",
    headcount: item.headcount ?? 0,
    priority: item.priority === null ? null : (item.priority as TaskPriority),
    files,
    fileSummary: (item as ApiTaskListItem).fileSummary,
    version: item.version,
    dateIso: { start: item.plannedStart, due: item.plannedEnd, done: item.actualEnd },
  };
}
