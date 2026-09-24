/**
 * 任务节点库接口封装（M3-05 余 · 第一段接线）：契约 shared/src/modules/templates.ts。
 * - 列表 GET /api/v1/task-nodes?stage=<九阶段 key>（任务模板页左列与「添加任务」卡片的「任务节点」标签同源）
 * - 新增 POST /api/v1/task-nodes（写 = blueprint.manage：仅系统管理员；同阶段同名 409 NODE_ALREADY_EXISTS）
 * - 编辑 PATCH /api/v1/task-nodes/{id}（写 = blueprint.manage；乐观锁 version 必传：过期 409 VERSION_CONFLICT）
 * - 删除 DELETE /api/v1/task-nodes/{id}（写 = blueprint.manage；物理删行 + 审计留痕；已生成的项目任务不受影响）
 * 阶段名（界面板块）↔ 阶段 key 的换算复用 taskApi 的 stageKeyOfName（同一份九阶段字典，避免两处各写一份）。
 * 注意：任务侧还没有「节点库来源」字段（契约 taskNodeId 现解析为项目流程节点），
 * 「已添加」一律按「同阶段同名」折算（见 data/tasks.ts 的 addedNodeKeysOf）。
 */
import { apiRequest, apiSend } from "./api";
import { stageKeyOfName } from "./taskApi";

/** 契约 TaskNode（只取界面用得到的字段；服务端多给字段忽略即可）。 */
export type ApiTaskNode = {
  id: string;
  stageKey: string;
  seq: number;
  title: string;
  titleEn: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** 节点卡片 / 添加卡片通用的最小形状（与 data/templatePresets 的 TemplatePresetNode 同形；id = 节点库 UUID）。 */
export type TaskNodeItem = { id: string; title: string; titleEn: string; /** 编辑用的乐观锁版本（Push 181；读接口按行下发，PATCH 时原样回传） */ version: number };

export function toNodeItem(node: ApiTaskNode): TaskNodeItem {
  return { id: node.id, title: node.title, titleEn: node.titleEn ?? "", version: node.version };
}

/** 某个板块（阶段名）的节点库列表；板块名不认识 = 空列表（不发请求）。 */
export async function fetchStageNodes(stageName: string): Promise<TaskNodeItem[]> {
  const stageKey = stageKeyOfName(stageName);
  if (stageKey === null) {
    return [];
  }
  const payload = await apiRequest<{ items: ApiTaskNode[]; total: number }>(
    "/api/v1/task-nodes?stage=" + encodeURIComponent(stageKey),
  );
  return payload.items.map(toNodeItem);
}

/** 新增节点（中文名必填、英文名可空；缺省追加到该阶段末尾）；返回落库后的条目。 */
export async function createStageNode(stageName: string, title: string, titleEn: string): Promise<TaskNodeItem> {
  const stageKey = stageKeyOfName(stageName);
  if (stageKey === null) {
    throw new Error("未知阶段：" + stageName);
  }
  const payload = await apiSend<ApiTaskNode>("/api/v1/task-nodes", "POST", {
    stageKey,
    title,
    titleEn: titleEn.trim() === "" ? null : titleEn,
  });
  return toNodeItem(payload);
}

/**
 * 编辑节点（PATCH /api/v1/task-nodes/{id}）：改名 / 英文名；不动的字段不传。
 * setTitleEn = 显式传 null 表示清空英文名（undefined = 保持原样）。
 * 乐观锁 version 必传（读接口带回来的那一个）：过期 = 409 VERSION_CONFLICT，由调用方刷新重试。
 */
export async function updateStageNode(
  id: string,
  patch: { title?: string; titleEn?: string | null; version: number },
): Promise<TaskNodeItem> {
  const payload = await apiSend<ApiTaskNode>("/api/v1/task-nodes/" + encodeURIComponent(id), "PATCH", patch);
  return toNodeItem(payload);
}

/** 删除节点（物理删行；已按该节点生成的项目任务不受影响）。 */
export function deleteTaskNode(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(
    "/api/v1/task-nodes/" + encodeURIComponent(id),
    { method: "DELETE" },
  );
}

/** 节点库写入失败的统一文案（409 NODE_ALREADY_EXISTS / 403 FORBIDDEN 等；服务端仍是最终裁决）。 */
export function nodeWriteMessage(error: { code: string; message: string }): string {
  if (error.code === "NODE_ALREADY_EXISTS") {
    return "该阶段已有同名节点，换个名字试试";
  }
  if (error.code === "FORBIDDEN") {
    return "只有系统管理员能维护节点库（blueprint.manage）";
  }
  if (error.code === "VERSION_CONFLICT") {
    return "这个节点刚被别人改过，刷新后再试（version 过期）";
  }
  if (error.code === "NOT_FOUND") {
    return "这个节点已经不在节点库里了，刷新看看";
  }
  if (error.code === "VALIDATION_FAILED") {
    return "节点名称不合规：" + error.message;
  }
  return error.message;
}
