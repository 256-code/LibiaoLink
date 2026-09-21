import { describe, expect, it } from "vitest";
import { AppError } from "../src/common/errors/app-error.js";
import { buildProjectFilter, parseProjectSort, type ProjectFilter } from "../src/modules/project/project.query.js";
import {
  ProjectRepository,
  isUniqueViolation,
  type ProjectRow,
  type ProjectViewRow,
} from "../src/modules/project/project.repository.js";
import { ProjectService, toProjectView } from "../src/modules/project/project.service.js";
import { DatabaseService } from "../src/db/database.service.js";
import { FlowService } from "../src/modules/project/flow.service.js";
import type { AuditService } from "../src/modules/admin/index.js";

const AT = new Date("2026-09-20T06:00:00.000Z");
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function expectAppError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error("预期抛出 AppError，但未抛出");
}

async function expectAppErrorAsync(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error("预期抛出 AppError，但未抛出");
}

function projectRow(overrides: Partial<ProjectRow> & { id: string }): ProjectRow {
  return {
    code: "CNBJ-20260708-0001",
    seqNo: 1,
    name: "XX 客户分拣项目",
    customer: "XX 客户",
    region: "华东",
    projectType: "分拣",
    managerId: UUID_A,
    stageKey: "presale",
    status: "active",
    description: null,
    version: 0,
    createdAt: AT,
    updatedAt: AT,
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

// ---------- 内存替身（不连库；与 ProjectRepository 方法签名同形） ----------

class FakeProjectRepository {
  rows: ProjectViewRow[] = [];
  lastList: { filter: ProjectFilter; sorts: unknown; limit: number; offset: number } | null = null;
  lastFacetFilter: ProjectFilter | null = null;
  lastSoftDelete: { id: string; expectedVersion: number; deletedBy: string } | null = null;
  lastTouched: { id: string; at: Date } | null = null;

  private visible(id: string): ProjectViewRow | null {
    return this.rows.find((view) => view.project.id === id && view.project.deletedAt === null) ?? null;
  }

  async listPage(filter: ProjectFilter, sorts: unknown, limit: number, offset: number): Promise<{ items: ProjectViewRow[]; total: number }> {
    this.lastList = { filter, sorts, limit, offset };
    const matched = this.rows.filter((view) => view.project.deletedAt === null);
    return { items: matched.slice(offset, offset + limit), total: matched.length };
  }

  async facets(filter: ProjectFilter): Promise<{
    total: number;
    region: Record<string, number>;
    projectType: Record<string, number>;
    managerId: Record<string, number>;
    stageKey: Record<string, number>;
    status: Record<string, number>;
  }> {
    this.lastFacetFilter = filter;
    return {
      total: 1,
      region: { "华东": 1 },
      projectType: { "分拣": 1 },
      managerId: { [UUID_A]: 1 },
      stageKey: { presale: 1 },
      status: { active: 1 },
    };
  }

  async findViewById(id: string): Promise<ProjectViewRow | null> {
    return this.visible(id);
  }

  async insert(input: { code: string; name: string; customer: string | null; region: string; projectType: string; managerId: string; stageKey: string; description: string | null }, at: Date): Promise<ProjectRow> {
    if (this.rows.some((view) => view.project.code === input.code)) {
      throw new AppError("PROJECT_CODE_EXISTS", "项目编号已存在：" + input.code);
    }
    const row = projectRow({
      id: UUID_B,
      code: input.code,
      seqNo: this.rows.length + 1,
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
    });
    this.rows.push({ project: row, managerName: "张工" });
    return row;
  }

  async updateWithVersion(id: string, patch: Record<string, unknown>, expectedVersion: number, at: Date): Promise<ProjectRow | null> {
    const found = this.visible(id);
    if (found === null || found.project.version !== expectedVersion) return null;
    Object.assign(found.project, patch, { version: found.project.version + 1, updatedAt: at });
    return found.project;
  }

  async softDeleteWithVersion(id: string, expectedVersion: number, deletedBy: string, at: Date): Promise<ProjectRow | null> {
    this.lastSoftDelete = { id, expectedVersion, deletedBy };
    const found = this.visible(id);
    if (found === null || found.project.version !== expectedVersion) return null;
    found.project.deletedAt = at;
    found.project.deletedBy = deletedBy;
    found.project.version += 1;
    return found.project;
  }

  async touch(id: string, at: Date): Promise<void> {
    this.lastTouched = { id, at };
  }

  async setStageKey(id: string, stageKey: string): Promise<void> {
    const found = this.rows.find((row) => row.project.id === id);
    if (found !== undefined) found.project.stageKey = stageKey;
  }
}

/** 审计替身（h7）：只记录写入调用；审计内容断言见 test/admin-audit.test.ts。 */
class FakeAuditService {
  entries: unknown[] = [];
  async record(_client: unknown, input: unknown): Promise<void> {
    this.entries.push(input);
  }
}

function makeService(rows: ProjectRow[] = []): { service: ProjectService; repo: FakeProjectRepository } {
  const repo = new FakeProjectRepository();
  repo.rows = rows.map((row) => ({ project: row, managerName: "张工" }));
  const fakeDb = {
    db: { transaction: (callback: (tx: unknown) => Promise<unknown>) => callback({}) },
  };
  const fakeFlow = {
    importSnapshot: (_tx: unknown, input: { requestedStageKey?: string }) =>
      Promise.resolve({
        activeStageKey: input.requestedStageKey ?? "presale",
        blueprintVersion: 1,
        stages: 9,
        nodes: 19,
        requirements: 8,
      }),
  };
  return {
    service: new ProjectService(
      fakeDb as unknown as DatabaseService,
      repo as unknown as ProjectRepository,
      fakeFlow as unknown as FlowService,
      new FakeAuditService() as unknown as AuditService,
    ),
    repo,
  };
}

// ---------- 列表筛选解析（M2-04） ----------

describe("buildProjectFilter（列表 / facets 共用口径）", () => {
  it("多值逗号拆分：去空白、丢空段；未传维度为 null", () => {
    const filter = buildProjectFilter({ "filter[region]": "华东, 华南 ,,", "filter[status]": "active,paused", page: 1, limit: 20 });
    expect(filter.regions).toEqual(["华东", "华南"]);
    expect(filter.statuses).toEqual(["active", "paused"]);
    expect(filter.projectTypes).toBeNull();
    expect(filter.managerIds).toBeNull();
    expect(filter.stageKeys).toBeNull();
    expect(filter.keyword).toBeNull();
    expect(filter.updatedFrom).toBeNull();
    expect(filter.updatedToExclusive).toBeNull();
  });

  it("非法枚举 / uuid 一律 400（不静默返回空列表）", () => {
    expectAppError(() => buildProjectFilter({ "filter[status]": "active,unknown", page: 1, limit: 20 }), "VALIDATION_FAILED");
    expectAppError(() => buildProjectFilter({ "filter[stageKey]": "presale,nope", page: 1, limit: 20 }), "VALIDATION_FAILED");
    expectAppError(() => buildProjectFilter({ "filter[managerId]": "not-a-uuid", page: 1, limit: 20 }), "VALIDATION_FAILED");
  });

  it("时间区间按 Asia/Shanghai 日界：下界含当日 00:00、上界取次日 00:00（不含）", () => {
    const filter = buildProjectFilter({ "filter[timeFrom]": "2026-09-14", "filter[timeTo]": "2026-09-15", page: 1, limit: 20 });
    expect(filter.updatedFrom?.toISOString()).toBe("2026-09-13T16:00:00.000Z");
    expect(filter.updatedToExclusive?.toISOString()).toBe("2026-09-15T16:00:00.000Z");
  });

  it("只传一端合法；timeFrom 晚于 timeTo 返回 400", () => {
    expect(buildProjectFilter({ "filter[timeFrom]": "2026-09-14", page: 1, limit: 20 }).updatedToExclusive).toBeNull();
    expect(buildProjectFilter({ "filter[timeTo]": "2026-09-15", page: 1, limit: 20 }).updatedFrom).toBeNull();
    expectAppError(() => buildProjectFilter({ "filter[timeFrom]": "2026-09-15", "filter[timeTo]": "2026-09-14", page: 1, limit: 20 }), "VALIDATION_FAILED");
  });

  it("关键字去首尾空白；空白串视同未传", () => {
    expect(buildProjectFilter({ q: "  分拣  ", page: 1, limit: 20 }).keyword).toBe("分拣");
    expect(buildProjectFilter({ q: "   ", page: 1, limit: 20 }).keyword).toBeNull();
  });
});

describe("parseProjectSort（白名单 updatedAt / createdAt / seqNo）", () => {
  it("缺省 = updatedAt:desc（最近活动在前）", () => {
    expect(parseProjectSort(undefined)).toEqual([{ field: "updatedAt", direction: "desc" }]);
    expect(parseProjectSort("")).toEqual([{ field: "updatedAt", direction: "desc" }]);
  });

  it("多字段与方向；省略方向按 asc", () => {
    expect(parseProjectSort("seqNo")).toEqual([{ field: "seqNo", direction: "asc" }]);
    expect(parseProjectSort("createdAt:asc,seqNo:desc")).toEqual([
      { field: "createdAt", direction: "asc" },
      { field: "seqNo", direction: "desc" },
    ]);
  });

  it("白名单外字段 / 非法方向 400", () => {
    expectAppError(() => parseProjectSort("name:asc"), "VALIDATION_FAILED");
    expectAppError(() => parseProjectSort("updatedAt:up"), "VALIDATION_FAILED");
  });
});

// ---------- 行 → 契约视图 ----------

describe("toProjectView", () => {
  it("camelCase 对齐 + managerName 随行下发 + ISO 时间", () => {
    const view = toProjectView({ project: projectRow({ id: UUID_A, customer: null }), managerName: null });
    expect(view.id).toBe(UUID_A);
    expect(view.seqNo).toBe(1);
    expect(view.managerName).toBeNull();
    expect(view.customer).toBeNull();
    expect(view.createdAt).toBe("2026-09-20T06:00:00.000Z");
    expect(Object.keys(view).sort()).toEqual([
      "code",
      "createdAt",
      "customer",
      "description",
      "id",
      "managerId",
      "managerName",
      "name",
      "projectType",
      "region",
      "seqNo",
      "stageKey",
      "status",
      "updatedAt",
      "version",
    ]);
  });
});

// ---------- 用例（M2-01） ----------

describe("ProjectService（M2-01 项目 CRUD）", () => {
  it("创建：缺省 stageKey = presale；seq_no 由仓储分配；返回随行 managerName", async () => {
    const { service, repo } = makeService();
    const created = await service.createProject({ code: "CNBJ-20260708-0002", name: "新项目", region: "华东", projectType: "分拣", managerId: UUID_A }, UUID_A);
    expect(created.stageKey).toBe("presale");
    expect(created.status).toBe("active");
    expect(created.seqNo).toBe(1);
    expect(created.version).toBe(0);
    expect(created.managerName).toBe("张工");
    expect(repo.rows).toHaveLength(1);
  });

  it("创建：显式 stageKey 生效；编号重复 409 PROJECT_CODE_EXISTS", async () => {
    const { service } = makeService([projectRow({ id: UUID_A })]);
    const created = await service.createProject({ code: "X-2", name: "新项目", region: "华东", projectType: "分拣", managerId: UUID_A, stageKey: "install" }, UUID_A);
    expect(created.stageKey).toBe("install");
    await expectAppErrorAsync(
      () => service.createProject({ code: "CNBJ-20260708-0001", name: "撞号", region: "华东", projectType: "分拣", managerId: UUID_A }, UUID_A),
      "PROJECT_CODE_EXISTS",
    );
  });

  it("列表：分页透传 + total；软删项目不可见（A5）", async () => {
    const alive = projectRow({ id: UUID_A, seqNo: 1 });
    const removed = projectRow({ id: UUID_B, seqNo: 2, deletedAt: AT });
    const { service, repo } = makeService([alive, removed]);
    const page = await service.listProjects({ page: 1, limit: 10 }, { kind: "all" });
    expect(page.total).toBe(1);
    expect(page.page).toBe(1);
    expect(page.limit).toBe(10);
    expect(page.items.map((item) => item.id)).toEqual([UUID_A]);
    await service.listProjects({ page: 2, limit: 10 }, { kind: "all" });
    expect(repo.lastList?.offset).toBe(10);
  });

  it("facets：与列表同筛选口径（同一 buildProjectFilter）", async () => {
    const { service, repo } = makeService([projectRow({ id: UUID_A })]);
    const facets = await service.getFacets({ "filter[status]": "active", page: 1, limit: 20 }, { kind: "all" });
    expect(facets.total).toBe(1);
    expect(facets.region).toEqual({ "华东": 1 });
    expect(repo.lastFacetFilter?.statuses).toEqual(["active"]);
  });

  it("详情：不存在 / 已软删统一 404 NOT_FOUND", async () => {
    const { service } = makeService([projectRow({ id: UUID_A, deletedAt: AT })]);
    await expectAppErrorAsync(() => service.getProject(UUID_B), "NOT_FOUND");
    await expectAppErrorAsync(() => service.getProject(UUID_A), "NOT_FOUND");
  });

  it("更新：version 匹配则 +1 并落 updatedAt；返回更新后视图", async () => {
    const { service } = makeService([projectRow({ id: UUID_A, version: 3 })]);
    const updated = await service.updateProject(UUID_A, { name: "改名", version: 3 }, UUID_A);
    expect(updated.name).toBe("改名");
    expect(updated.version).toBe(4);
    expect(updated.managerName).toBe("张工");
  });

  it("更新：version 不匹配 409 VERSION_CONFLICT；期间被删则 404", async () => {
    const { service } = makeService([projectRow({ id: UUID_A, version: 3 })]);
    await expectAppErrorAsync(() => service.updateProject(UUID_A, { name: "改名", version: 2 }, UUID_A), "VERSION_CONFLICT");
    const { service: gone } = makeService([projectRow({ id: UUID_A, version: 3, deletedAt: AT })]);
    await expectAppErrorAsync(() => gone.updateProject(UUID_A, { name: "改名", version: 3 }, UUID_A), "NOT_FOUND");
  });

  it("更新 / 删除：归档项目写保护 409 PROJECT_ARCHIVED（ADR-027）", async () => {
    const { service } = makeService([projectRow({ id: UUID_A, status: "archived" })]);
    await expectAppErrorAsync(() => service.updateProject(UUID_A, { name: "改名", version: 0 }, UUID_A), "PROJECT_ARCHIVED");
    await expectAppErrorAsync(() => service.deleteProject(UUID_A, 0, UUID_B), "PROJECT_ARCHIVED");
  });

  it("删除：If-Match version 透传 + 记录操作人；删除后列表 / 详情不可见", async () => {
    const { service, repo } = makeService([projectRow({ id: UUID_A, version: 2 })]);
    const removed = await service.deleteProject(UUID_A, 2, UUID_B);
    expect(removed.id).toBe(UUID_A);
    expect(removed.version).toBe(3);
    expect(repo.lastSoftDelete).toEqual({ id: UUID_A, expectedVersion: 2, deletedBy: UUID_B });
    await expectAppErrorAsync(() => service.getProject(UUID_A), "NOT_FOUND");
    expect((await service.listProjects({ page: 1, limit: 20 }, { kind: "all" })).total).toBe(0);
  });

  it("删除：version 不匹配 409 VERSION_CONFLICT；不存在 404", async () => {
    const { service } = makeService([projectRow({ id: UUID_A, version: 2 })]);
    await expectAppErrorAsync(() => service.deleteProject(UUID_A, 1, UUID_B), "VERSION_CONFLICT");
    await expectAppErrorAsync(() => service.deleteProject(UUID_B, 0, UUID_A), "NOT_FOUND");
  });
});


// ---------- 唯一约束违例解包（drizzle 0.45 把驱动错误包在 cause 上） ----------

describe("isUniqueViolation", () => {
  const wrapped = { name: "DrizzleQueryError", cause: { code: "23505", constraint: "projects_code_key" } };

  it("解包 cause 链后命中 projects_code_key（编号重复 → 409 PROJECT_CODE_EXISTS）", () => {
    expect(isUniqueViolation(wrapped, "projects_code_key")).toBe(true);
    expect(isUniqueViolation({ cause: wrapped }, "projects_code_key")).toBe(true);
  });

  it("约束名不符 / 非唯一违例 / 非对象 一律 false", () => {
    expect(isUniqueViolation(wrapped, "uq_projects_seq_no")).toBe(false);
    expect(isUniqueViolation({ code: "23503", constraint: "projects_code_key" }, "projects_code_key")).toBe(false);
    expect(isUniqueViolation(new Error("boom"), "projects_code_key")).toBe(false);
    expect(isUniqueViolation(null, "projects_code_key")).toBe(false);
  });
});
