/**
 * 项目接口封装（M2-07 首页联调）：
 * - 列表 GET /api/v1/projects（filter[...] + q + sort + page/limit）
 * - 分类计数 GET /api/v1/projects/facets（与列表同一套参数，禁止两套口径；《前端功能需求》§3.2）
 * - 新建 POST /api/v1/projects、编辑 PATCH /api/v1/projects/{id}（乐观锁 version）、删除 DELETE /api/v1/projects/{id}（If-Match 版本）
 * 契约 shared/src/modules/projects.ts；UI 模型见 types.ts（前端「项目描述」= 契约 name）。
 */
import { apiRequest, apiSend } from "./api";
import type { ListQueryState } from "./useHashRoute";
import type { Project } from "./types";

export type ApiProject = {
  id: string;
  code: string;
  seqNo: number;
  name: string;
  customer: string | null;
  region: string;
  projectType: string;
  managerIds: string[];
  managerNames: Array<string | null>;
  stageKey: string;
  status: string;
  description: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectListResult = { items: ApiProject[]; page: number; limit: number; total: number };

/** 首页侧边栏计数（五组固定返回；一期展示 region / projectType / managerId 三组）。 */
export type ProjectFacets = {
  total: number;
  region: Record<string, number>;
  projectType: Record<string, number>;
  managerId: Record<string, number>;
  stageKey: Record<string, number>;
  status: Record<string, number>;
};

export const EMPTY_FACETS: ProjectFacets = { total: 0, region: {}, projectType: {}, managerId: {}, stageKey: {}, status: {} };

/** 列表一次取满（契约 limit 上限 200）；总数用响应 total，超出时页面另提示。 */
export const PROJECT_PAGE_LIMIT = 200;

/**
 * 计数分组的维度：侧栏三组各自排除自己那一维、其余条件照常参与 ——
 * 选中「华东」后其它地区仍显示各自计数（不是一律 0），项目类型 / 项目经理计数则跟着收窄。
 */
export type FacetSkip = "regions" | "projectTypes" | "managerIds";

/** 组装列表 / 计数的同一套查询串（契约 §3.2 参数命名）。 */
export function buildListQuery(filters: ListQueryState, skip: FacetSkip | null = null): string {
  const parts: string[] = [];
  const pushList = (key: string, values: string[]): void => {
    if (values.length > 0) {
      parts.push(key + "=" + values.map((value) => encodeURIComponent(value)).join(","));
    }
  };
  if (skip !== "regions") {
    pushList("filter[region]", filters.regions);
  }
  if (skip !== "projectTypes") {
    pushList("filter[projectType]", filters.projectTypes);
  }
  if (skip !== "managerIds") {
    pushList("filter[managerId]", filters.managerIds);
  }
  if (filters.timeFrom !== null && filters.timeTo !== null) {
    parts.push("filter[timeFrom]=" + encodeURIComponent(filters.timeFrom));
    parts.push("filter[timeTo]=" + encodeURIComponent(filters.timeTo));
  }
  if (filters.q.trim() !== "") {
    parts.push("q=" + encodeURIComponent(filters.q.trim()));
  }
  return parts.join("&");
}

export function fetchProjectList(filters: ListQueryState): Promise<ProjectListResult> {
  const parts = [buildListQuery(filters)];
  parts.push("sort=" + (filters.sortDesc ? "updatedAt:desc" : "updatedAt:asc"));
  parts.push("page=1");
  parts.push("limit=" + String(PROJECT_PAGE_LIMIT));
  const query = parts.filter((part) => part !== "").join("&");
  return apiRequest<ProjectListResult>("/api/v1/projects?" + query);
}

export function fetchProjectFacets(filters: ListQueryState, skip: FacetSkip | null = null): Promise<ProjectFacets> {
  const query = buildListQuery(filters, skip);
  return apiRequest<ProjectFacets>("/api/v1/projects/facets" + (query === "" ? "" : "?" + query));
}

export function fetchProject(id: string): Promise<ApiProject> {
  return apiRequest<ApiProject>("/api/v1/projects/" + encodeURIComponent(id));
}

/** 写请求字段（新建 / 编辑同一套；customer / 备注 description 表单暂未采集，不发送即不改）。 */
export type ProjectWriteInput = {
  code: string;
  name: string;
  region: string;
  projectType: string;
  managerIds: string[];
};

export function createProject(input: ProjectWriteInput): Promise<ApiProject> {
  return apiSend<ApiProject>("/api/v1/projects", "POST", input);
}

export function updateProject(id: string, input: ProjectWriteInput, version: number): Promise<ApiProject> {
  const body: ProjectWriteInput & { version: number } = {
    code: input.code,
    name: input.name,
    region: input.region,
    projectType: input.projectType,
    managerIds: input.managerIds,
    version,
  };
  return apiSend<ApiProject>("/api/v1/projects/" + encodeURIComponent(id), "PATCH", body);
}

/**
 * 删除项目（软删 · A5；Push 172 接上卡片入口）：DELETE /api/v1/projects/{id} —— 版本走 **If-Match 请求头**（不是正文），
 * 缺头 / 非数字 400 VALIDATION_FAILED；版本不一致 409 VERSION_CONFLICT；归档项目 409 PROJECT_ARCHIVED；
 * 不存在 / 不可见 404。响应 = 被删项目（此后列表 / 详情 / facets 均不可见）。
 */
export function deleteProject(id: string, version: number): Promise<ApiProject> {
  return apiRequest<ApiProject>("/api/v1/projects/" + encodeURIComponent(id), {
    method: "DELETE",
    headers: { "If-Match": String(version) },
  });
}

/** ISO8601（UTC）→ 展示用「YYYY-MM-DD HH:mm」（Asia/Shanghai，时区口径 ADR-028）。 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const pick = (type: string): string => {
    const found = parts.find((part) => part.type === type);
    return found === undefined ? "" : found.value;
  };
  return pick("year") + "-" + pick("month") + "-" + pick("day") + " " + pick("hour") + ":" + pick("minute");
}

/** API 视图 → UI 模型：前端「项目描述」= 契约 name；经理姓名随行下发（卡片 / 详情不再查演示目录）。 */
export function toUiProject(view: ApiProject): Project {
  return {
    id: view.id,
    seqNo: view.seqNo,
    code: view.code,
    description: view.name,
    region: view.region,
    projectType: view.projectType,
    createdAt: formatDateTime(view.createdAt),
    updatedAt: formatDateTime(view.updatedAt),
    managerIds: view.managerIds,
    managerNames: view.managerNames,
    version: view.version,
    stageKey: view.stageKey,
    status: view.status,
  };
}
