import { Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { AppError } from "../../common/errors/app-error.js";
import { DatabaseService } from "../../db/database.service.js";
import { users } from "../../db/schema/identity.js";
import { projects } from "../../db/schema/projects.js";
import type { ProjectFilter, ProjectSort } from "./project.query.js";

export type ProjectRow = typeof projects.$inferSelect;

/** 列表 / 详情视图行：项目字段 + managerName（A2：随行下发；停用 / 离职仍返回姓名，取不到为 null）。 */
export interface ProjectViewRow {
  project: ProjectRow;
  managerName: string | null;
}

export interface ProjectInsertInput {
  code: string;
  name: string;
  customer: string | null;
  region: string;
  projectType: string;
  managerId: string;
  stageKey: string;
  description: string | null;
}

export interface ProjectUpdateInput {
  code?: string;
  name?: string;
  customer?: string | null;
  region?: string;
  projectType?: string;
  managerId?: string;
  stageKey?: string;
  status?: string;
  description?: string | null;
}

export interface ProjectFacetsResult {
  total: number;
  region: Record<string, number>;
  projectType: Record<string, number>;
  managerId: Record<string, number>;
  stageKey: Record<string, number>;
  status: Record<string, number>;
}

const SORT_COLUMNS = {
  updatedAt: projects.updatedAt,
  createdAt: projects.createdAt,
  seqNo: projects.seqNo,
} as const;

/** project 数据访问（M2-01 / M2-04）：软删过滤（A5）与 updated_at 触点（ADR-022）都收敛在本层。 */
@Injectable()
export class ProjectRepository {
  constructor(private readonly database: DatabaseService) {}

  async listPage(
    filter: ProjectFilter,
    sorts: readonly ProjectSort[],
    limit: number,
    offset: number,
  ): Promise<{ items: ProjectViewRow[]; total: number }> {
    const where = and(...projectConditions(filter));
    const items = await this.database.db
      .select({ project: projects, managerName: users.displayName })
      .from(projects)
      .leftJoin(users, eq(users.id, projects.managerId))
      .where(where)
      .orderBy(...projectOrderBy(sorts))
      .limit(limit)
      .offset(offset);
    const totals = await this.database.db.select({ value: count() }).from(projects).where(where);
    return { items, total: Number(totals[0]?.value ?? 0) };
  }

  async facets(filter: ProjectFilter): Promise<ProjectFacetsResult> {
    const rows = await this.database.db
      .select({
        region: projects.region,
        projectType: projects.projectType,
        managerId: projects.managerId,
        stageKey: projects.stageKey,
        status: projects.status,
        value: count(),
      })
      .from(projects)
      .where(and(...projectConditions(filter)))
      .groupBy(projects.region, projects.projectType, projects.managerId, projects.stageKey, projects.status);
    const facets: ProjectFacetsResult = { total: 0, region: {}, projectType: {}, managerId: {}, stageKey: {}, status: {} };
    for (const row of rows) {
      const value = Number(row.value);
      facets.total += value;
      bump(facets.region, row.region, value);
      bump(facets.projectType, row.projectType, value);
      bump(facets.managerId, row.managerId, value);
      bump(facets.stageKey, row.stageKey, value);
      bump(facets.status, row.status, value);
    }
    return facets;
  }

  async findViewById(id: string): Promise<ProjectViewRow | null> {
    const rows = await this.database.db
      .select({ project: projects, managerName: users.displayName })
      .from(projects)
      .leftJoin(users, eq(users.id, projects.managerId))
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async insert(input: ProjectInsertInput, at: Date): Promise<ProjectRow> {
    try {
      const rows = await this.database.db
        .insert(projects)
        .values({
          code: input.code,
          name: input.name,
          customer: input.customer,
          region: input.region,
          projectType: input.projectType,
          managerId: input.managerId,
          stageKey: input.stageKey,
          status: "active",
          description: input.description,
          createdAt: at,
          updatedAt: at,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error("projects insert 未返回记录");
      }
      return row;
    } catch (error) {
      if (isUniqueViolation(error, "projects_code_key")) {
        throw new AppError("PROJECT_CODE_EXISTS", "项目编号已存在：" + input.code);
      }
      throw error;
    }
  }

  async updateWithVersion(id: string, patch: ProjectUpdateInput, expectedVersion: number, at: Date): Promise<ProjectRow | null> {
    const set: Record<string, unknown> = { ...patch, version: sql`${projects.version} + 1`, updatedAt: at };
    try {
      const rows = await this.database.db
        .update(projects)
        .set(set)
        .where(and(eq(projects.id, id), eq(projects.version, expectedVersion), isNull(projects.deletedAt)))
        .returning();
      return rows[0] ?? null;
    } catch (error) {
      if (isUniqueViolation(error, "projects_code_key")) {
        throw new AppError("PROJECT_CODE_EXISTS", "项目编号已存在");
      }
      throw error;
    }
  }

  async softDeleteWithVersion(id: string, expectedVersion: number, deletedBy: string, at: Date): Promise<ProjectRow | null> {
    const rows = await this.database.db
      .update(projects)
      .set({ deletedAt: at, deletedBy, version: sql`${projects.version} + 1` })
      .where(and(eq(projects.id, id), eq(projects.version, expectedVersion), isNull(projects.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * ADR-022 触点（ProjectToucher 语义，仓储层单点）：任务 / 成员 / 阶段等「项目聚合视图」变更调用；
   * 主数据变更由 updateWithVersion 一并刷新；文件 / 日报 / 系统调度不调用。
   */
  async touch(id: string, at: Date): Promise<void> {
    await this.database.db
      .update(projects)
      .set({ updatedAt: at })
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)));
  }
}

/** 列表 / facets 共用的 WHERE 条件（同一 filter 构造器，禁止两套 SQL）。 */
function projectConditions(filter: ProjectFilter): SQL[] {
  const conditions: SQL[] = [isNull(projects.deletedAt)];
  if (filter.regions !== null) conditions.push(inArray(projects.region, filter.regions));
  if (filter.projectTypes !== null) conditions.push(inArray(projects.projectType, filter.projectTypes));
  if (filter.managerIds !== null) conditions.push(inArray(projects.managerId, filter.managerIds));
  if (filter.stageKeys !== null) conditions.push(inArray(projects.stageKey, filter.stageKeys));
  if (filter.statuses !== null) conditions.push(inArray(projects.status, filter.statuses));
  if (filter.keyword !== null) {
    const pattern = "%" + escapeLikePattern(filter.keyword) + "%";
    const keywordCondition = or(
      ilike(projects.code, pattern),
      ilike(projects.name, pattern),
      ilike(projects.customer, pattern),
      sql`${projects.seqNo}::text like ${pattern}`,
    );
    if (keywordCondition !== undefined) conditions.push(keywordCondition);
  }
  if (filter.updatedFrom !== null) conditions.push(gte(projects.updatedAt, filter.updatedFrom));
  if (filter.updatedToExclusive !== null) conditions.push(lt(projects.updatedAt, filter.updatedToExclusive));
  return conditions;
}

/** 排序映射 + 稳定 tie-breaker（seqNo 全库唯一，保证分页不跳行）。 */
function projectOrderBy(sorts: readonly ProjectSort[]): SQL[] {
  const clauses: SQL[] = sorts.map((sort) =>
    sort.direction === "desc" ? desc(SORT_COLUMNS[sort.field]) : asc(SORT_COLUMNS[sort.field]),
  );
  if (!sorts.some((sort) => sort.field === "seqNo")) {
    clauses.push(asc(projects.seqNo));
  }
  return clauses;
}

/** LIKE 通配符转义（PG 默认转义符为反斜杠）；避开字面反斜杠，用字符码构造。 */
function escapeLikePattern(value: string): string {
  const backslash = String.fromCharCode(92);
  return value.split(backslash).join(backslash + backslash).split("%").join(backslash + "%").split("_").join(backslash + "_");
}

function bump(target: Record<string, number>, key: string, value: number): void {
  target[key] = (target[key] ?? 0) + value;
}

/**
 * pg 唯一约束违例判定：drizzle 0.45 把驱动错误包成 DrizzleQueryError（原始错误挂在 cause 链上），
 * 因此逐层解包后再看 code / constraint（projects_code_key → 409 PROJECT_CODE_EXISTS）。
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint === constraint) return true;
    current = candidate.cause;
  }
  return false;
}
