/**
 * 视图回归（M2-06 首刀 · A1-03）：列表范围透传、名称收敛、归属（个人他人 404 / 公共他人 403）、
 * 默认视图互斥（创建与更新置位）、空更新 400、物理删与契约形状（ISO 时间）。
 * 真机口径见 server/src/modules/view/README.md 与 server/scripts/m2-06-replay.mjs。
 */
import { describe, expect, it } from "vitest";
import type { DatabaseService } from "../src/db/database.service.js";
import type { ProjectViewInsert, ProjectViewPatch, ProjectViewRow } from "../src/modules/view/view.repository.js";
import { ViewService } from "../src/modules/view/view.service.js";

const ME = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const OTHER = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
const VIEW_A = "11111111-1111-4111-8111-111111111111";
const VIEW_B = "22222222-2222-4222-8222-222222222222";

class FakeViewRepository {
  rows: ProjectViewRow[] = [];
  lastListScope: string | null = "unset";
  cleared: string[] = [];
  insertCalls: ProjectViewInsert[] = [];
  updateCalls: { id: string; patch: ProjectViewPatch }[] = [];
  deleted: string[] = [];
  private seq = 0;

  async listVisible(_actorId: string, scope: string | null): Promise<ProjectViewRow[]> {
    this.lastListScope = scope;
    return this.rows;
  }

  async findById(id: string): Promise<ProjectViewRow | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async insert(input: ProjectViewInsert, at: Date): Promise<ProjectViewRow> {
    this.insertCalls.push(input);
    this.seq += 1;
    const row = makeView({
      id: this.seq === 1 ? VIEW_A : VIEW_B,
      ownerId: input.ownerId,
      scope: input.scope,
      name: input.name,
      filters: input.filters,
      columns: input.columns,
      sort: input.sort,
      grouping: input.grouping,
      isDefault: input.isDefault,
      createdAt: at,
      updatedAt: at,
    });
    this.rows.push(row);
    return row;
  }

  async update(id: string, patch: ProjectViewPatch, at: Date): Promise<ProjectViewRow> {
    this.updateCalls.push({ id, patch });
    const row = this.rows.find((item) => item.id === id);
    if (row === undefined) throw new Error("fake update: 行不存在");
    Object.assign(row, patch, { updatedAt: at });
    return row;
  }

  async delete(id: string): Promise<string | null> {
    this.deleted.push(id);
    return id;
  }

  async clearOtherDefaults(ownerId: string, keepId: string): Promise<void> {
    this.cleared.push(ownerId + "/" + keepId);
    for (const row of this.rows) {
      if (row.ownerId === ownerId && row.id !== keepId) row.isDefault = false;
    }
  }
}

/** 事务替身：直接执行回调并把 tx 置空（仓储替身忽略 tx）。 */
const fakeDatabase = {
  db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(undefined) },
} as unknown as DatabaseService;

function makeView(overrides: Partial<ProjectViewRow> = {}): ProjectViewRow {
  return {
    id: VIEW_A,
    ownerId: ME,
    ownerName: "我",
    scope: "personal",
    name: "我的视图",
    filters: { stageKey: "install" },
    columns: ["title"],
    sort: { key: "plannedEnd", order: "asc" },
    grouping: null,
    isDefault: false,
    createdAt: new Date("2026-09-27T01:00:00.000Z"),
    updatedAt: new Date("2026-09-28T02:00:00.000Z"),
    ...overrides,
  };
}

function makeService(repo: FakeViewRepository): ViewService {
  return new ViewService(repo as never, fakeDatabase);
}

describe("视图服务（M2-06 首刀 · A1-03）", () => {
  it("列表：scope 透传（缺省 null = 个人 + 公共）且行 → 契约（ISO 时间）", async () => {
    const repo = new FakeViewRepository();
    repo.rows = [makeView()];
    const service = makeService(repo);
    const response = await service.list(ME, {});
    expect(repo.lastListScope).toBeNull();
    expect(response.items[0]).toEqual({
      id: VIEW_A,
      ownerId: ME,
      ownerName: "我",
      scope: "personal",
      name: "我的视图",
      filters: { stageKey: "install" },
      columns: ["title"],
      sort: { key: "plannedEnd", order: "asc" },
      grouping: null,
      isDefault: false,
      createdAt: "2026-09-27T01:00:00.000Z",
      updatedAt: "2026-09-28T02:00:00.000Z",
    });
    await service.list(ME, { scope: "public" });
    expect(repo.lastListScope).toBe("public");
  });

  it("创建：名称剔除前后空白；isDefault 置位时清掉本人其它默认", async () => {
    const repo = new FakeViewRepository();
    repo.rows = [makeView({ id: VIEW_B, isDefault: true })];
    const service = makeService(repo);
    const created = await service.create(ME, {
      name: "  安装视图  ",
      scope: "personal",
      filters: {},
      columns: [],
      sort: null,
      grouping: null,
      isDefault: true,
    });
    expect(repo.insertCalls[0]?.name).toBe("安装视图");
    expect(created.isDefault).toBe(true);
    expect(repo.cleared).toEqual([ME + "/" + VIEW_A]);
    expect(repo.rows.find((row) => row.id === VIEW_B)?.isDefault).toBe(false);
  });

  it("创建：名称剔除后为空 → 400 VALIDATION_FAILED（不落库）", async () => {
    const repo = new FakeViewRepository();
    const service = makeService(repo);
    await expect(
      service.create(ME, { name: "   ", scope: "personal", filters: {}, columns: [], sort: null, grouping: null, isDefault: false }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(repo.insertCalls).toEqual([]);
  });

  it("更新：空对象 → 400（先于读取判定）", async () => {
    const repo = new FakeViewRepository();
    const service = makeService(repo);
    await expect(service.update(ME, VIEW_A, {})).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(repo.updateCalls).toEqual([]);
  });

  it("更新：个人视图他人 404；公共视图非创建者 403", async () => {
    const repo = new FakeViewRepository();
    repo.rows = [makeView({ id: VIEW_A, ownerId: OTHER, scope: "personal" }), makeView({ id: VIEW_B, ownerId: OTHER, scope: "public" })];
    const service = makeService(repo);
    await expect(service.update(ME, VIEW_A, { name: "改名" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.update(ME, VIEW_B, { name: "改名" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repo.updateCalls).toEqual([]);
  });

  it("更新：局部更新只带传入键；置默认 true 时清互斥；isDefault false 直接落", async () => {
    const repo = new FakeViewRepository();
    repo.rows = [makeView({ id: VIEW_A, ownerId: ME, isDefault: false }), makeView({ id: VIEW_B, ownerId: ME, isDefault: true })];
    const service = makeService(repo);
    const updated = await service.update(ME, VIEW_A, { isDefault: true, name: " 主视图 " });
    expect(repo.updateCalls[0]?.patch).toEqual({ name: "主视图", isDefault: true });
    expect(updated.isDefault).toBe(true);
    expect(repo.cleared).toEqual([ME + "/" + VIEW_A]);
    expect(repo.rows.find((row) => row.id === VIEW_B)?.isDefault).toBe(false);
  });

  it("删除：本人物理删；个人视图他人 404；公共视图非创建者 403", async () => {
    const repo = new FakeViewRepository();
    repo.rows = [makeView({ id: VIEW_A, ownerId: ME }), makeView({ id: VIEW_B, ownerId: OTHER, scope: "public" })];
    const service = makeService(repo);
    const response = await service.remove(ME, VIEW_A);
    expect(response).toEqual({ id: VIEW_A, deleted: true });
    expect(repo.deleted).toEqual([VIEW_A]);
    await expect(service.remove(ME, VIEW_B)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.remove(ME, "33333333-3333-4333-8333-333333333333")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
