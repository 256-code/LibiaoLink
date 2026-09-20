import { Injectable } from "@nestjs/common";
import { ProjectFacetsSchema, ProjectListResponseSchema, ProjectSchema, ProjectCreateBodySchema, ProjectUpdateBodySchema, z } from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { ProjectRepository, type ProjectInsertInput, type ProjectUpdateInput, type ProjectViewRow } from "./project.repository.js";
import { buildProjectFilter, parseProjectSort, type ProjectListQueryInput } from "./project.query.js";

export type ProjectView = z.infer<typeof ProjectSchema>;
export type ProjectListResult = z.infer<typeof ProjectListResponseSchema>;
export type ProjectFacetsResult = z.infer<typeof ProjectFacetsSchema>;

type ProjectCreateBody = z.infer<typeof ProjectCreateBodySchema>;
type ProjectUpdateBody = z.infer<typeof ProjectUpdateBodySchema>;

/** 创建时未指定阶段的缺省值（按已发布蓝图导入 stages / nodes 的快照事务随 M2-02 · h3）。 */
const DEFAULT_STAGE_KEY = "presale";

/** 行 → 契约视图（camelCase 对齐；managerName 随行下发，A2）。 */
export function toProjectView(view: ProjectViewRow): ProjectView {
  const row = view.project;
  return {
    id: row.id,
    code: row.code,
    seqNo: row.seqNo,
    name: row.name,
    customer: row.customer,
    region: row.region,
    projectType: row.projectType,
    managerId: row.managerId,
    managerName: view.managerName,
    stageKey: row.stageKey as ProjectView["stageKey"],
    status: row.status as ProjectView["status"],
    description: row.description,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** project 用例（M2-01 项目 CRUD + M2-04 首页列表 / facets）。 */
@Injectable()
export class ProjectService {
  constructor(private readonly projects: ProjectRepository) {}

  /** 列表（M2-04）：筛选 / 时间区间 / 排序与 facets 同口径；软删项目不可见（A5）。 */
  async listProjects(query: ProjectListQueryInput): Promise<ProjectListResult> {
    const filter = buildProjectFilter(query);
    const sorts = parseProjectSort(query.sort);
    const { items, total } = await this.projects.listPage(filter, sorts, query.limit, (query.page - 1) * query.limit);
    return { items: items.map(toProjectView), page: query.page, limit: query.limit, total };
  }

  /** 首页分类计数（M2-04 · A6）：五组固定返回，与列表同筛选口径。 */
  async getFacets(query: ProjectListQueryInput): Promise<ProjectFacetsResult> {
    const filter = buildProjectFilter(query);
    parseProjectSort(query.sort);
    return this.projects.facets(filter);
  }

  async getProject(id: string): Promise<ProjectView> {
    const view = await this.projects.findViewById(id);
    if (view === null) {
      throw new AppError("NOT_FOUND", "项目不存在或不可见");
    }
    return toProjectView(view);
  }

  /** 创建（M2-01）：code 唯一由数据库唯一约束兜底（23505 → 409）；seq_no 由序列分配，不接受传入。 */
  async createProject(body: ProjectCreateBody): Promise<ProjectView> {
    const at = new Date();
    const input: ProjectInsertInput = {
      code: body.code,
      name: body.name,
      customer: body.customer ?? null,
      region: body.region,
      projectType: body.projectType,
      managerId: body.managerId,
      stageKey: body.stageKey ?? DEFAULT_STAGE_KEY,
      description: body.description ?? null,
    };
    // blueprintVersion：入参暂忽略（一期建项目不导入节点）；快照事务随 M2-02 · h3。
    const row = await this.projects.insert(input, at);
    const view = await this.projects.findViewById(row.id);
    return toProjectView(view ?? { project: row, managerName: null });
  }

  /** 更新（M2-01）：乐观锁（version 必须回传）；归档写保护（ADR-027）；code 变更同样校验唯一性。 */
  async updateProject(id: string, body: ProjectUpdateBody): Promise<ProjectView> {
    const current = await this.projects.findViewById(id);
    if (current === null) {
      throw new AppError("NOT_FOUND", "项目不存在或不可见");
    }
    if (current.project.status === "archived") {
      throw new AppError("PROJECT_ARCHIVED", "项目已归档，禁止修改");
    }
    const patch: ProjectUpdateInput = {};
    if (body.code !== undefined) patch.code = body.code;
    if (body.name !== undefined) patch.name = body.name;
    if (body.customer !== undefined) patch.customer = body.customer;
    if (body.region !== undefined) patch.region = body.region;
    if (body.projectType !== undefined) patch.projectType = body.projectType;
    if (body.managerId !== undefined) patch.managerId = body.managerId;
    if (body.stageKey !== undefined) patch.stageKey = body.stageKey;
    if (body.status !== undefined) patch.status = body.status;
    if (body.description !== undefined) patch.description = body.description;
    const updated = await this.projects.updateWithVersion(id, patch, body.version, new Date());
    if (updated === null) {
      const again = await this.projects.findViewById(id);
      if (again === null) {
        throw new AppError("NOT_FOUND", "项目不存在或不可见");
      }
      throw new AppError("VERSION_CONFLICT", "项目已被他人更新，请刷新后重试");
    }
    const view = await this.projects.findViewById(id);
    return toProjectView(view ?? { project: updated, managerName: current.managerName });
  }

  /** 软删（M2-01 · A5）：If-Match version 防误删；seq_no 不回收、code 唯一性保留（同编号再建仍 409）。 */
  async deleteProject(id: string, version: number, actorId: string): Promise<ProjectView> {
    const current = await this.projects.findViewById(id);
    if (current === null) {
      throw new AppError("NOT_FOUND", "项目不存在或不可见");
    }
    if (current.project.status === "archived") {
      throw new AppError("PROJECT_ARCHIVED", "项目已归档，禁止删除");
    }
    const deleted = await this.projects.softDeleteWithVersion(id, version, actorId, new Date());
    if (deleted === null) {
      const again = await this.projects.findViewById(id);
      if (again === null) {
        throw new AppError("NOT_FOUND", "项目不存在或不可见");
      }
      throw new AppError("VERSION_CONFLICT", "项目已被他人更新，请刷新后重试");
    }
    return toProjectView({ project: deleted, managerName: current.managerName });
  }
}
