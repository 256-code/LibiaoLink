/**
 * 工作台接口封装（M6-06 前端接线 · 系统功能书 A6-01 / A6-03；契约 shared/src/modules/workspace.ts，Push 166 已 HTTP 落地）。
 * - 聚合读面 GET /api/v1/workspace（跨项目个人读面：无项目路径参数、仅会话）。
 * 本刀只封接口（类型 + 取数函数）；页面 / 路由接线与「契约字段 → UI 模型」的映射随接线那一刀再做。
 */
import { apiRequest } from "./api";

/** 契约 WorkspaceTaskItem：工作台任务项（跨项目；带项目编号 / 名称；三组内 plannedEnd 必非空）。 */
export type ApiWorkspaceTask = {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  stageKey: string | null;
  title: string;
  titleEn: string | null;
  displayStatus: string;
  progress: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualEnd: string | null;
  ownerIds: string[];
  ownerNames: Array<string | null>;
  priority: string | null;
};

/** 契约 WorkspaceIssueItem：工作台问题项（跨项目；保留 version —— 工作台内快速流转 / 关闭确认时带乐观锁）。 */
export type ApiWorkspaceIssue = {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  taskId: string | null;
  title: string;
  categories: string[];
  state: string;
  reporterId: string;
  reporterName: string | null;
  ownerDepartment: string | null;
  ownerId: string | null;
  ownerName: string | null;
  raisedAt: string;
  updatedAt: string;
  version: number;
};

/** 契约 WorkspaceResponse：分组基准日（Asia/Shanghai 今天）+ 我的任务三组 + 我的问题两栏。 */
export type ApiWorkspace = {
  today: string;
  myTasks: {
    today: ApiWorkspaceTask[];
    upcoming: ApiWorkspaceTask[];
    overdue: ApiWorkspaceTask[];
  };
  myIssues: {
    handling: ApiWorkspaceIssue[];
    raised: ApiWorkspaceIssue[];
  };
};

/**
 * GET /api/v1/workspace：工作台聚合读面。
 * 口径（第一刀）：任务 = 任务负责人名单内含我 + 未完成 + 预计完成日期在「今天起 7 天」窗口（含已逾期）；
 * 问题 = 我处理（ownerId 我）与我提出的（reporterId 我）两栏，同一问题两边都命中时两栏都出现；
 * 归档 / 软删项目整项目不进；排序由服务端给定（任务按 plannedEnd 升序、问题未关闭在前）。
 */
export function fetchWorkspace(): Promise<ApiWorkspace> {
  return apiRequest<ApiWorkspace>("/api/v1/workspace");
}
